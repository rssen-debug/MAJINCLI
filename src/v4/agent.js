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
import { Approvals } from '../v2/safety/approvals.js';
import { Goal } from '../v2/runtime/goal.js';
import { STATES } from '../v2/runtime/states.js';
import { runVerifier } from '../v2/runtime/verifiers.js';
import { runTool } from '../v2/tools/runner.js';
import { TOOL_SCHEMAS } from './tools.js';
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
    const result = await runTool(
      { tool: toolName, input: args, callId: call.id },
      {
        registry: tools.registry,
        approvals,
        mode: 'balanced',
        timeoutMs: config.limits.toolTimeoutMs,
        events: bus,
      },
    );

    if (!result.ok && result.decision === 'waiting') {
      goal.transition(STATES.WAITING_FOR_APPROVAL, `consent required for ${toolName}`);
      return { ok: false, waiting: true, scope: result.pendingScope, reason: result.reason, name: toolName, input: args, call };
    }

    goal.transition(STATES.RUNNING, `tool ${toolName} finished`);

    if (!result.ok) {
      goal.addReceipt({ action: `tool:${toolName}`, target: args.fileName || null, result: 'failure', errorClass: 'TOOL_FAILURE' });
      return { ok: false, error: result.error || 'tool failed', code: result.code || 'TOOL_FAILURE', name: toolName };
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

    const inMemory = requestId ? recentRequests.get(requestId) : null;
    if (inMemory?.messageId) {
      const storedMsg = conversations.get(inMemory.conversationId)?.messages.find((m) => m.id === inMemory.messageId);
      if (storedMsg) {
        emit('replay', { messageId: inMemory.messageId, content: storedMsg.content, conversationId: inMemory.conversationId });
        emit('done', { status: 'replayed', conversationId: inMemory.conversationId, messageId: inMemory.messageId });
        return { status: 'replayed', conversationId: inMemory.conversationId, messageId: inMemory.messageId };
      }
    }

    const prior = conversations.getRequest(conversation.id, requestId);
    if (prior?.status === 'completed' && prior.messageId) {
      const stored = conversations.get(conversation.id).messages.find((m) => m.id === prior.messageId);
      emit('replay', { messageId: prior.messageId, content: stored?.content || '' });
      emit('done', { status: 'replayed', conversationId: conversation.id, messageId: prior.messageId });
      return { status: 'replayed', conversationId: conversation.id, messageId: prior.messageId };
    }

    conversations.appendMessage(conversation.id, { role: 'user', content: message });
    emit('user', { content: message });

    const goal = goals.track(new Goal({
      objective: message.slice(0, 500),
      acceptance: [],
      risk: 'low',
      permissions: ['workspace.file:create', 'workspace.file:read', 'memory.preference:write'],
      budgets: { toolCalls: config.limits.maxToolCallsPerTurn, modelRounds: config.limits.maxModelRounds },
    }));
    goal.transition(STATES.PLANNING, 'turn accepted');
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
    runTurn,
    resolveApproval,
    beginTurn,
    endTurn,
    cancel,
    isRunning: (id) => running.has(id),
    modelInfo: model.info,
  };
}
