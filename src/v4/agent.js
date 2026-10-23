/**
 * MAJIN V4 — the turn engine.
 *
 * One user message becomes one durable V2 Goal:
 *
 *   REQUESTED(=CREATED) -> PLANNING -> READY -> RUNNING
 *        -> [WAITING_FOR_TOOL -> RUNNING]*
 *        -> WAITING_FOR_APPROVAL?  (strict policy)
 *        -> VERIFYING -> COMPLETED
 *
 * Every tool call is a receipt. A workspace write is only called done after
 * the V2 file verifier re-read the file from disk and matched its SHA-256.
 * The model's own words are never the evidence.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Approvals } from '../v2/safety/approvals.js';
import { Goal } from '../v2/runtime/goal.js';
import { STATES } from '../v2/runtime/states.js';
import { runVerifier } from '../v2/runtime/verifiers.js';
import { runTool } from '../v2/tools/runner.js';
import { TOOL_SCHEMAS, safeFileName } from './tools.js';
import { publicGoal, newId } from './store.js';
import { explainModelError } from './model.js';
import { t } from './ui/strings.js';

const SYSTEM_PROMPT = `You are MAJIN, a private assistant running on the owner's own Windows machine.
You speak in the language the user writes in (Swedish or English) and you are brief.
You have tools: workspace_write (create a NEW text file), workspace_read, workspace_list,
memory_save (durable preference) and memory_search. The workspace is a flat, create-only sandbox.

Rules:
- Never say a file was created, saved or changed unless the tool result confirms it.
- If a tool fails, say exactly what failed and what you did NOT change.
- Ask at most one short clarifying question, and only when the request cannot be executed safely.
- Never invent file paths, URLs, prices, job listings or test results.
- Never reveal secrets, API keys or system internals.`;

function createBus() {
  const handlers = new Set();
  return {
    emit(type, payload) {
      for (const fn of handlers) {
        try {
          fn(type, payload);
        } catch { /* a broken listener must not break a turn */ }
      }
    },
    on(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
  };
}

function parseArgs(json) {
  if (json == null || json === '') return {};
  if (typeof json === 'object') return json;
  try {
    const v = JSON.parse(String(json));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return null;
  }
}

/**
 * True when this message continues the same work rather than starting
 * something else: same artifact, an explicit correction word, or a short
 * follow-up. Deliberately conservative — a wrong "correction" would hide a
 * genuinely new task.
 */
export function looksLikeCorrection(message, priorGoal) {
  const text = String(message || '').toLowerCase();
  if (!priorGoal) return false;
  const artifacts = (priorGoal.acceptance || [])
    .map((a) => String(a.id).replace(/^artifact:/, '').toLowerCase())
    .filter(Boolean);
  const mentionsArtifact = artifacts.some((name) => name && text.includes(name));
  const correctionWord = /\b(nej|inte|rätt|ändra|istället|i stället|glöm|instead|actually|no,|rather|change|fix)\b/.test(text);
  const followUp = /\b(igen|också|too|again|also|continue|fortsätt)\b/.test(text);
  return mentionsArtifact || correctionWord || followUp;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return 'null';
  }
}

export function createAgent({ config, conversations, goals, tools, model }) {
  const bus = createBus();
  const approvals = new Approvals(bus);
  if (config.approvals.policy === 'sandbox-auto') {
    // Workspace writes are create-only inside the sandbox and verified after
    // the fact, so they are auto-approved in the default policy. `strict`
    // requires a human confirmation per call.
    approvals.grant('tool:workspace_write', { user: 'owner', mode: 'session', maxUses: 1_000_000 });
    approvals.grant('tool:memory_save', { user: 'owner', mode: 'session', maxUses: 1_000_000 });
  }

  const running = new Map(); // conversationId -> AbortController
  const lastGoal = new Map(); // conversationId -> goalId (the goal the user is working on)
  // Idempotency survives a dropped connection: the same requestId returns the
  // stored turn instead of running tools twice. Bounded and ordered.
  const recentRequests = new Map();

  function historyFor(conv) {
    return conv.messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.meta?.error)
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async function executeToolCall({ call, goal, conversationId, emit }) {
    const args = parseArgs(call.argsJson);
    if (args === null) {
      return { ok: false, error: 'tool arguments were not valid JSON', code: 'INVALID_JSON', name: call.name };
    }
    const toolName = String(call.name || '');
    if (toolName === 'workspace_write' && typeof args.fileName === 'string') {
      const acceptanceId = `artifact:${args.fileName}`;
      if (!goal.acceptance.some((a) => a.id === acceptanceId)) {
        goal.acceptance.push({
          id: acceptanceId,
          description: `Create and verify ${args.fileName}`,
          coveredBy: [],
        });
      }
    }
    emit('tool_start', { id: call.id, name: toolName, input: redactInput(toolName, args) });

    goal.transition(STATES.WAITING_FOR_TOOL, `tool ${toolName}`);
    let result;
    try {
      result = await runTool(
        { tool: toolName, input: args, callId: call.id },
        {
          registry: tools.registry,
          approvals,
          mode: 'balanced',
          timeoutMs: config.limits.toolTimeoutMs,
          events: bus,
        },
      );
    } catch (err) {
      // The runner throws classified ToolErrors (unknown tool, schema mismatch,
      // timeout, executor crash). The goal must leave WAITING_FOR_TOOL, record
      // the failure and keep the turn honest — never stay mid-flight.
      const cls = err?.cls || 'UNKNOWN';
      goal.transition(STATES.RUNNING, `tool ${toolName} threw ${cls}`);
      goal.addReceipt({
        action: `tool:${toolName}`,
        target: args.fileName || null,
        result: 'failure',
        errorClass: cls,
      });
      emit('tool_result', { id: call.id, name: toolName, ok: false, verified: false, summary: cls, error: String(err?.message || err) });
      return { ok: false, error: err?.message || String(err), code: cls, name: toolName };
    }

    if (!result.ok && result.decision === 'waiting') {
      // WAITING_FOR_TOOL can only go back to RUNNING; the approval wait is
      // entered from RUNNING. Skipping the hop left the goal stuck.
      goal.transition(STATES.RUNNING, 'tool requires consent');
      goal.transition(STATES.WAITING_FOR_APPROVAL, `consent required for ${toolName}`);
      return { ok: false, waiting: true, scope: result.pendingScope, reason: result.reason, name: toolName, input: args, call };
    }

    goal.transition(STATES.RUNNING, `tool ${toolName} finished`);

    if (!result.ok) {
      const cls = result.error?.cls || 'TOOL_FAILURE';
      goal.addReceipt({ action: `tool:${toolName}`, target: args.fileName || null, result: 'failure', errorClass: cls });
      emit('tool_result', { id: call.id, name: toolName, ok: false, verified: false, summary: cls });
      return { ok: false, error: result.error || 'tool failed', code: cls, name: toolName };
    }

    const data = result.data;
    const evidence = data?.sha256
      ? { bytes: data.bytes, sha256: data.sha256, path: data.path }
      : { summary: summarize(data) };
    const receipt = goal.addReceipt({
      action: `tool:${toolName}`,
      target: data?.fileName || args.fileName || toolName,
      result: 'success',
      evidence,
      acceptanceId: data?.fileName ? `artifact:${data.fileName}` : null,
    });

    let verified = false;
    let verification = null;
    if (toolName === 'workspace_write' && data?.path) {
      verification = await runVerifier('file', { path: data.path, minBytes: data.bytes, hash: data.sha256 });
      if (verification.verified) {
        goal.verifyReceipt(receipt.id, { ...verification.evidence, verifier: 'v2.file', expectedSha256: data.sha256 });
        verified = true;
      } else {
        goal.addReceipt({
          action: 'verification.file',
          target: data.fileName,
          result: 'failure',
          errorClass: verification.error?.cls || 'VERIFICATION_FAILURE',
          acceptanceId: `artifact:${data.fileName}`,
        });
      }
    } else if (toolName === 'workspace_read' && data?.content != null) {
      // Verify a read against the file itself: same size, same bytes.
      const target = path.join(tools.root, safeFileName(data.fileName));
      const check = await runVerifier('file', {
        path: target,
        minBytes: data.bytes,
        hash: crypto.createHash('sha256').update(Buffer.from(data.content, 'utf8')).digest('hex'),
      });
      if (check.verified) {
        goal.verifyReceipt(receipt.id, { ...check.evidence, verifier: 'v2.file', kindOfRead: true });
        verified = true;
      }
    } else if (toolName === 'workspace_list' && Array.isArray(data?.files)) {
      // Verify a listing against the directory: same names, same count.
      const actual = fs.readdirSync(tools.root, { withFileTypes: true })
        .filter((e) => e.isFile()).map((e) => e.name).sort();
      const claimed = data.files.map((f) => f.name).sort();
      if (actual.length === claimed.length && actual.every((n, i) => n === claimed[i])) {
        goal.verifyReceipt(receipt.id, { kind: 'listing', entries: actual.length, verifier: 'v4.workspace-list' });
        verified = true;
      }
    } else if (toolName === 'memory_save' && data?.saved) {
      const stored = tools.memory ? tools.memory.get('preference', data.key) : null;
      if (stored) {
        goal.verifyReceipt(receipt.id, { kind: 'memory', key: data.key, at: stored.at });
        verified = true;
      }
    } else if (!data?.path && !data?.fileName) {
      // Nothing external happened (e.g. a search): the receipt stays unverified
      // on purpose rather than being marked verified without a check.
      verified = false;
    }

    emit('tool_result', {
      id: call.id,
      name: toolName,
      ok: true,
      verified,
      summary: summarize(data),
      receiptId: receipt.id,
    });
    return { ok: true, data, verified, receiptId: receipt.id, name: toolName };
  }

  function redactInput(toolName, args) {
    if (toolName === 'workspace_write') {
      return { fileName: args.fileName, chars: typeof args.content === 'string' ? args.content.length : 0 };
    }
    return args;
  }

  function summarize(data) {
    if (!data || typeof data !== 'object') return String(data ?? '');
    if (data.status === 'created') return `${data.fileName} · ${data.bytes} byte`;
    if (Array.isArray(data.files)) return t('agent.files', { count: data.files.length });
    if (Array.isArray(data.matches)) return t('agent.matches', { count: data.matches.length });
    if (data.saved) return `sparad: ${data.key}`;
    if (typeof data.content === 'string') return `${data.fileName} · ${data.bytes} byte`;
    return t('agent.summaryDone');
  }

  /**
   * Run one turn. `emit(type, payload)` is the SSE sink. Returns a summary the
   * HTTP layer can log without leaking content.
   */
  async function runTurn({ conversationId, text, requestId = null, signal, emit = () => {} }) {
    const conv = conversationId ? conversations.get(conversationId) : null;
    if (conversationId && !conv) throw Object.assign(new Error('conversation not found'), { status: 404 });

    const conversation = conv || conversations.create();
    const message = String(text ?? '').trim();
    if (!message) throw Object.assign(new Error('message is empty'), { status: 400 });
    if (message.length > config.limits.maxMessageChars) {
      throw Object.assign(new Error(`message exceeds ${config.limits.maxMessageChars} characters`), { status: 413 });
    }

    /**
     * A repeated requestId must never re-run tools (side effects are real), so
     * the answer is replayed from storage. But storage is bounded: after enough
     * turns the answer may have been truncated away. Sending an empty replay
     * would look like MAJIN answered nothing, so that case gets its own status.
     */
    const replayOf = (conversationIdForReplay, messageId, found) => {
      if (found) {
        emit('replay', { messageId, content: found.content, conversationId: conversationIdForReplay });
        emit('done', { status: 'replayed', conversationId: conversationIdForReplay, messageId });
        return { status: 'replayed', conversationId: conversationIdForReplay, messageId };
      }
      emit('replay', { messageId, content: '', truncated: true, conversationId: conversationIdForReplay });
      emit('done', { status: 'already_handled', conversationId: conversationIdForReplay, messageId });
      return { status: 'already_handled', conversationId: conversationIdForReplay, messageId };
    };

    const inMemory = requestId ? recentRequests.get(requestId) : null;
    if (inMemory?.messageId) {
      const conv = conversations.get(inMemory.conversationId);
      const found = conv?.messages.find((m) => m.id === inMemory.messageId);
      if (conv) return replayOf(inMemory.conversationId, inMemory.messageId, found);
    }

    const prior = conversations.getRequest(conversation.id, requestId);
    if (prior?.status === 'completed' && prior.messageId) {
      const found = conversations.get(conversation.id).messages.find((m) => m.id === prior.messageId);
      return replayOf(conversation.id, prior.messageId, found);
    }

    conversations.appendMessage(conversation.id, { role: 'user', content: message });
    emit('user', { content: message });

    // A correction is not a new task. When the previous goal in this
    // conversation is still the user's active context, the new turn is recorded
    // as a revision of it so history shows one thread instead of orphans.
    const priorGoalId = lastGoal.get(conversation.id) || null;
    const priorGoal = priorGoalId ? goals.get(priorGoalId) : null;
    const lineage = priorGoal && looksLikeCorrection(message, priorGoal)
      ? { revisionOf: priorGoal.id, revision: (priorGoal.revision || 0) + 1 }
      : null;

    const goal = goals.track(new Goal({
      objective: message.slice(0, 500),
      acceptance: [],
      risk: 'low',
      permissions: ['workspace.file:create', 'workspace.file:read', 'memory.preference:write'],
      budgets: { toolCalls: config.limits.maxToolCallsPerTurn, modelRounds: config.limits.maxModelRounds },
    }));
    goal.revisionOf = lineage?.revisionOf || null;
    goal.revision = lineage?.revision || 0;
    lastGoal.set(conversation.id, goal.id);
    goal.transition(STATES.PLANNING, lineage ? `revision ${goal.revision} of ${lineage.revisionOf}` : 'turn accepted');
    goals.save(goal);
    emit('goal', publicGoal(goal));

    const modelMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyFor(conversations.get(conversation.id)),
    ];

    let finalText = '';
    let toolCallsUsed = 0;
    let rounds = 0;
    let assistantMessageId = null;
    // A turn may not end in a confident sentence after an unrecovered tool
    // failure. The last tool outcome decides whether the answer is allowed to
    // be treated as a success.
    let lastOutcome = null;
    let lastRefusal = null;

    try {
      goal.transition(STATES.READY, 'model route resolved');
      goal.transition(STATES.RUNNING, 'executing turn');
      goals.save(goal);

      while (rounds < config.limits.maxModelRounds) {
        rounds += 1;
        if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' });

        emit('state', { state: 'thinking', round: rounds });
        const response = await model.chat({
          messages: modelMessages,
          tools: TOOL_SCHEMAS,
          signal,
          modelId: conversation.modelId || null,
          onEvent: (ev) => {
            if (signal?.aborted) return;
            if (ev.type === 'delta') emit('delta', { text: ev.text });
            else if (ev.type === 'thinking') emit('thinking', { text: ev.text });
          },
        });

        if (response.text) finalText += response.text;
        if (response.refused) lastRefusal = response.refused;

        if (!response.toolCalls?.length) break;

        if (toolCallsUsed + response.toolCalls.length > config.limits.maxToolCallsPerTurn) {
          throw Object.assign(new Error(`tool budget exceeded (${config.limits.maxToolCallsPerTurn})`), { code: 'TOOL_BUDGET' });
        }

        const toolMessages = [];
        for (const call of response.toolCalls) {
          if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' });
          toolCallsUsed += 1;
          const outcome = await executeToolCall({ call, goal, conversationId: conversation.id, emit });
          goals.save(goal);
          emit('goal', publicGoal(goal));

          lastOutcome = outcome;
          if (outcome.waiting) {
            conversation.pendingApproval = {
              turnId: newId('turn'),
              goalId: goal.id,
              tool: outcome.name,
              input: outcome.input,
              callId: outcome.call.id,
              scope: outcome.scope,
              reason: outcome.reason,
              requestedAt: new Date().toISOString(),
            };
            conversations.save(conversation);
            emit('approval_required', {
              scope: outcome.scope,
              tool: outcome.name,
              reason: outcome.reason,
              input: redactInput(outcome.name, outcome.input),
            });
            emit('goal', publicGoal(goal));
            emit('done', { status: 'awaiting_approval', conversationId: conversation.id, goalId: goal.id });
            return { status: 'awaiting_approval', conversationId: conversation.id, goalId: goal.id };
          }

          toolMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: safeJson(outcome.ok ? { ok: true, data: outcome.data } : { ok: false, error: outcome.error }),
          });
        }

        modelMessages.push({ role: 'assistant', content: response.text || null, tool_calls: response.toolCalls });
        modelMessages.push(...toolMessages);
      }

      if (lastRefusal && toolCallsUsed === 0) {
        throw Object.assign(new Error(lastRefusal.reason || t('common.toolFailed')), {
          code: 'REQUEST_REFUSED',
          cls: lastRefusal.code || 'INVALID_TOOL_INPUT',
        });
      }

      if (lastOutcome && !lastOutcome.ok && !lastOutcome.verified) {
        throw Object.assign(new Error(lastOutcome.error || t('common.toolFailed')), {
          code: 'TOOL_FAILED_UNRECOVERED',
          cls: lastOutcome.code || 'TOOL_FAILURE',
        });
      }

      if (!finalText.trim()) {
        finalText = t('common.done');
      }

      emit('state', { state: 'verifying' });
      const stored = conversations.appendMessage(conversation.id, {
        role: 'assistant',
        content: finalText,
        meta: {
          goalId: goal.id,
          model: model.info.label,
          demo: model.info.demo,
          requests: rounds,
          toolCalls: toolCallsUsed,
        },
      });
      assistantMessageId = stored.id;

      // Independent check that the answer really landed in durable storage.
      const reread = conversations.get(conversation.id)?.messages.find((m) => m.id === stored.id);
      if (!reread || reread.content !== finalText) {
        throw Object.assign(new Error('assistant message did not persist'), { code: 'PERSIST_FAILURE' });
      }

      goal.transition(STATES.VERIFYING, 'checking acceptance and receipts');
      const receipt = goal.addReceipt({
        action: 'chat.reply',
        target: stored.id,
        result: 'success',
        evidence: { messageId: stored.id, chars: finalText.length, model: model.info.model },
        acceptanceId: null,
      });
      goal.verifyReceipt(receipt.id, { kind: 'persistence', messageId: stored.id, bytes: Buffer.byteLength(finalText) });

      const uncovered = goal.uncoveredAcceptance();
      if (uncovered.length) throw Object.assign(new Error(`missing evidence for: ${uncovered.map((u) => u.id).join(', ')}`), { code: 'EVIDENCE_MISSING' });

      goal.complete();
      goals.save(goal);
      conversations.rememberRequest(conversation.id, requestId, {
        status: 'completed',
        messageId: stored.id,
        goalId: goal.id,
      });
      if (requestId) {
        recentRequests.set(requestId, {
          conversationId: conversation.id,
          messageId: stored.id,
          goalId: goal.id,
          at: Date.now(),
        });
        if (recentRequests.size > 200) recentRequests.delete(recentRequests.keys().next().value);
      }

      emit('goal', publicGoal(goal));
      emit('done', {
        status: 'completed',
        conversationId: conversation.id,
        messageId: stored.id,
        goalId: goal.id,
        demo: model.info.demo,
      });
      return { status: 'completed', conversationId: conversation.id, messageId: stored.id, goalId: goal.id };
    } catch (err) {
      const aborted = err?.code === 'ABORTED' || err?.name === 'AbortError' || signal?.aborted;
      const reason = aborted ? 'cancelled by the user' : explainModelError(err);

      if (![STATES.FAILED, STATES.CANCELLED, STATES.COMPLETED].includes(goal.state)) {
        try {
          goal.transition(aborted ? STATES.CANCELLED : STATES.FAILED, reason.slice(0, 200));
          goals.save(goal);
        } catch {
          /* keep the stored state if the hop is not legal */
        }
      }

      const note = aborted
        ? t('msg.cancelled')
        : t('agent.failed', { reason });
      const stored = conversations.appendMessage(conversation.id, {
        role: 'assistant',
        content: note,
        meta: { error: true, goalId: goal.id },
      });
      emit('goal', publicGoal(goal));
      emit(aborted ? 'cancelled' : 'error', { message: reason, messageId: stored.id, goalId: goal.id });
      emit('done', { status: aborted ? 'cancelled' : 'failed', conversationId: conversation.id, goalId: goal.id });
      return { status: aborted ? 'cancelled' : 'failed', conversationId: conversation.id, goalId: goal.id };
    }
  }

  /**
   * Resume a goal that the host marked BLOCKED (crash, restart, or a failed
   * verification). The resume is evidence-driven: every acceptance item that
   * can be re-checked is re-checked against reality. If all of them pass, the
   * goal completes. If not, it stays BLOCKED with the reason — a resume never
   * turns into a silent success.
   */
  async function resumeGoal({ goalId, emit = () => {} }) {
    const goal = goals.get(goalId);
    if (!goal) throw Object.assign(new Error('goal not found'), { status: 404 });
    if (![STATES.BLOCKED, STATES.RECOVERING].includes(goal.state)) {
      throw Object.assign(new Error(`goal is ${goal.state}, only BLOCKED goals can be resumed`), { status: 409 });
    }

    goal.transition(STATES.RUNNING, 'owner requested resume');
    goals.save(goal);
    emit('goal', publicGoal(goal));

    const results = [];
    for (const item of goal.acceptance) {
      const name = String(item.id).startsWith('artifact:') ? item.id.slice('artifact:'.length) : null;
      if (!name) {
        results.push({ id: item.id, verified: false, reason: 'no independent verifier for this item' });
        continue;
      }
      let fileName;
      try {
        fileName = safeFileName(name);
      } catch (err) {
        results.push({ id: item.id, verified: false, reason: err.message });
        continue;
      }
      const target = path.join(tools.root, fileName);
      if (!fs.existsSync(target)) {
        results.push({ id: item.id, verified: false, reason: 'artifact is missing on disk' });
        continue;
      }
      // Compare against the hash recorded when the work was done. Hashing the
      // file and comparing it with itself would always pass and prove nothing.
      const recorded = [...goal.receipts]
        .reverse()
        .find((r) => r.verified && r.acceptanceId === item.id && r.evidence?.sha256);
      const expectedSha = recorded?.evidence?.sha256 || null;
      const expectedBytes = Number(recorded?.evidence?.bytes ?? 0);
      if (!expectedSha) {
        results.push({ id: item.id, verified: false, reason: 'no recorded hash to compare against' });
        continue;
      }
      const verification = await runVerifier('file', { path: target, minBytes: expectedBytes, hash: expectedSha });
      if (!verification.verified) {
        results.push({ id: item.id, verified: false, reason: verification.error?.message || 'verification failed' });
        continue;
      }
      // Receipts are legal in RUNNING, so the goal stays in one state while
      // every acceptance item is re-checked. Only the final hop is VERIFYING.
      const receipt = goal.addReceipt({
        action: 'resume.verify',
        target: fileName,
        result: 'success',
        evidence: { ...verification.evidence, verifier: 'v2.file', resumed: true },
        acceptanceId: item.id,
      });
      goal.verifyReceipt(receipt.id, { ...verification.evidence, verifier: 'v2.file', resumed: true });
      results.push({ id: item.id, verified: true, sha256: expectedSha });
    }
    goals.save(goal);

    const missing = goal.uncoveredAcceptance();
    // Old receipts are history, not proof that the world still looks the same.
    // A resume only succeeds when EVERY acceptance item was re-verified in this
    // pass, even if a previous run had already marked it covered.
    const allFresh = results.length > 0 && results.every((r) => r.verified);
    if (missing.length === 0 && allFresh) {
      goal.transition(STATES.VERIFYING, 'all acceptance items re-verified after resume');
      goal.complete();
      goals.save(goal);
      emit('goal', publicGoal(goal));
      return { status: 'completed', goal: publicGoal(goal), results };
    }

    const failed = results.filter((r) => !r.verified).map((r) => r.id);
    // "missing" answers one question: what is not verified right now?
    const notVerified = [...new Set([...missing.map((m) => m.id), ...failed])];
    goal.transition(STATES.BLOCKED, `resume could not verify: ${notVerified.join(', ')}`.slice(0, 180));
    goals.save(goal);
    emit('goal', publicGoal(goal));
    return { status: 'blocked', goal: publicGoal(goal), results, missing: notVerified };
  }

  /** Resolve a pending strict-policy approval for a conversation. */
  async function resolveApproval({ conversationId, approve, emit = () => {} }) {
    const conversation = conversations.get(conversationId);
    if (!conversation) throw Object.assign(new Error('conversation not found'), { status: 404 });
    const pending = conversation.pendingApproval;
    if (!pending) throw Object.assign(new Error('no pending approval'), { status: 409 });
    const goal = goals.get(pending.goalId);

    conversation.pendingApproval = null;
    conversations.save(conversation);
    emit('approval_resolved', { approve: Boolean(approve), tool: pending.tool });

    if (!approve) {
      if (goal && goal.state === STATES.WAITING_FOR_APPROVAL) {
        goal.transition(STATES.CANCELLED, 'approval denied by the owner');
        goals.save(goal);
      }
      const stored = conversations.appendMessage(conversation.id, {
        role: 'assistant',
        content: t('agent.denied'),
        meta: { error: true, goalId: pending.goalId },
      });
      emit('goal', publicGoal(goal));
      emit('done', { status: 'denied', conversationId, messageId: stored.id });
      return { status: 'denied', conversationId };
    }

    approvals.grant(pending.scope, { user: 'owner', mode: 'once', maxUses: 1 });
    if (goal && goal.state === STATES.WAITING_FOR_APPROVAL) {
      goal.transition(STATES.RUNNING, 'approval granted by the owner');
    }

    emit('state', { state: 'working' });
    const outcome = await executeToolCall({
      call: { id: pending.callId, name: pending.tool, argsJson: JSON.stringify(pending.input) },
      goal,
      conversationId,
      emit,
    });

    if (goal && goal.state === STATES.VERIFYING) {
      const uncovered = goal.uncoveredAcceptance();
      if (!uncovered.length) goal.complete();
    } else if (goal && goal.state === STATES.RUNNING) {
      goal.transition(STATES.VERIFYING, 'approved action finished');
      if (!goal.uncoveredAcceptance().length) goal.complete();
    }
    if (goal) goals.save(goal);

    const summary = outcome.ok
      ? t('agent.approved', { tool: pending.tool })
      : t('agent.notExecuted', { error: outcome.error || t('common.unknownError') });
    const stored = conversations.appendMessage(conversation.id, {
      role: 'assistant',
      content: summary,
      meta: { goalId: pending.goalId, approval: 'granted' },
    });
    emit('goal', publicGoal(goal));
    emit('done', { status: 'completed', conversationId, messageId: stored.id, goalId: pending.goalId });
    return { status: 'completed', conversationId, messageId: stored.id };
  }

  function beginTurn(conversationId) {
    const controller = new AbortController();
    if (conversationId) {
      running.get(conversationId)?.abort();
      running.set(conversationId, controller);
    }
    return controller;
  }

  function endTurn(conversationId, controller) {
    if (conversationId && running.get(conversationId) === controller) running.delete(conversationId);
  }

  function cancel(conversationId) {
    const controller = running.get(conversationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /** Change the model for one conversation only (never the global route). */
  function setConversationModel({ conversationId, modelId }) {
    const conv = conversations.get(conversationId);
    if (!conv) throw Object.assign(new Error('conversation not found'), { status: 404 });
    conv.modelId = modelId || null;
    conversations.save(conv);
    return { conversationId, modelId: conv.modelId, info: model.infoFor(conv.modelId) };
  }

  return {
    approvals,
    bus,
    setConversationModel,
    resumeGoal,
    runTurn,
    resolveApproval,
    beginTurn,
    endTurn,
    cancel,
    isRunning: (id) => running.has(id),
    modelInfo: model.info,
  };
}
