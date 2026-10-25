/**
 * MAJIN — verktygsslingan.
 * Samma loop för huvudagenten och subagenter. Stegvisa beslut:
 *   kör → om fel ≥2: eskalera till tyngre modell → komprimera kontext → upprepa.
 * Godkända verktyg erbjuds tills sista steget, som reserveras för ett färdigt svar.
 */
import { complete, explainError } from './provider/chat.js';
import { routeFor } from './router.js';
import { compact, estimateTokens } from './context.js';
import { bus } from './log.js';

export async function loop({ cfg, registry, messages, job = 'tasks', onEvent = () => {}, signal, maxSteps, usage, ctx, allowTools = true, label = 'agent' }) {
  const agent = cfg.get('agent') || {};
  const requestedLimit = Number(maxSteps) || Number(agent.maxSteps) || 40;
  const limit = Math.max(1, Math.min(200, Math.floor(requestedLimit)));
  const toolLog = [];
  let steps = 0;
  let errors = 0;
  let escalated = false;
  const whoIs = (r) => r?.label || r?.providerName || 'The provider';
  let answer = '';
  let brief = messages.find((m) => m.role === 'system' && String(m.content).startsWith('ARBETSMINNESBRIEF'))?.content || '';
  const tally = { input: 0, output: 0, costUsd: 0 };
  // Keep signatures across model turns so retries cannot silently re-run a failed action forever.
  const attempts = new Map();

  while (steps < limit) {
    if (signal?.aborted) {
      bus.warn('loop.aborted', { label, steps });
      return { text: answer || '(avbruten)', steps, toolLog, usage: tally, aborted: true, escalated };
    }
    await waitIfPaused(ctx, signal, onEvent, label);
    if (signal?.aborted) continue;
    steps += 1;
    // Keep the specialist route for follow-up reasoning unless the user explicitly chose another step route.
    // The last budgeted step is always a tool-free final answer, so the agent does not stop after doing work.
    const finalStep = limit > 1 && steps === limit;
    const followupJob = !agent.stepJob || agent.stepJob === 'same' ? job : agent.stepJob;
    const stepJob = finalStep ? 'final' : escalated ? cfg.get('routing.escalateJob') || 'analysis' : steps === 1 ? job : followupJob;
    const route = routeFor(cfg, stepJob);
    if (!route) throw new Error('no provider with an API key yet — open the Providers card, pick one and paste the key');
    if (finalStep) messages.push({ role: 'system', content: 'FINAL STEP: do not call tools. Finish the task now using only verified evidence already in the conversation. State what is completed, what is not, and any exact blocker; do not claim actions that did not succeed.' });
    const offeredTools = allowTools && !finalStep ? registry.schemas({ readOnly: Boolean(ctx?.readOnly) }) : [];
    onEvent({ type: 'step', label, step: steps, of: limit, job: stepJob, model: route.ref, escalated, finalizing: finalStep });

    let res;
    try {
      res = await complete({
        route,
        job: `${label}:${stepJob}`,
        messages,
        tools: offeredTools,
        toolChoice: offeredTools.length ? undefined : 'none',
        stream: true,
        maxTokens: agent.maxTokens || 6000,
        temperature: agent.temperature ?? 0.2,
        retries: agent.retries ?? 2,
        signal,
        onEvent: (ev) => {
          if (ev.type === 'delta') onEvent({ type: 'delta', label, text: ev.text });
          else if (ev.type === 'thinking') onEvent({ type: 'thinking', label, text: ev.text });
          else onEvent({ type: 'tool', label, name: ev.name });
        },
      });
    } catch (err) {
      errors += 1;
      const info = err.majin || explainError(err, route);
      bus.error('loop.provider', { label, step: steps, error: err.message, code: err.code, kind: info.kind });
      onEvent({ type: 'error', label, where: 'provider', message: info.human || err.message, hint: err.hint || null, kind: info.kind });
      // fel som aldrig lost sig (nyckel, krediter, modellnamn, for langt) far
      // inte kosta fyra steg till — anvandaren ska fa svaret direkt
      if (info.stop) {
        return {
          text: answer || info.human || `${whoIs(route)} could not answer: ${err.message}`,
          steps, toolLog, usage: tally, error: err.message,
          errorKind: info.kind, errorHint: err.hint || info.human || null, needsKey: info.needsKey || undefined, fatal: true,
        };
      }
      if (errors >= 2) escalated = true;
      if (errors >= 4) return { text: answer || `${whoIs(route)} did not answer after ${errors} tries: ${info.human || err.message}`, steps, toolLog, usage: tally, error: err.message, errorKind: info.kind, errorHint: err.hint || null, escalated };
      messages.push({ role: 'user', content: `The previous call failed (${err.code || 'error'}: ${String(err.message).slice(0, 200)}). Try again, simpler.` });
      continue;
    }

    tally.input += res.usage?.input || 0;
    tally.output += res.usage?.output || 0;
    tally.costUsd += res.usage?.costUsd || 0;
    usage?.record({ job: `${label}:${stepJob}`, ref: res.route || route.ref, usage: res.usage, ms: res.elapsedMs, escalated });
    answer = res.text || answer;
    onEvent({ type: 'usage', label, step: steps, model: route.ref, tokensIn: res.usage?.input || 0, tokensOut: res.usage?.output || 0, costUsd: res.usage?.costUsd || 0, ms: res.elapsedMs });

    const calls = res.toolCalls || [];
    if (finalStep && calls.length) {
      onEvent({ type: 'tool_blocked', label, step: steps, reason: 'the final budget step is reserved for a user-facing answer' });
      const text = summarizePartial(toolLog, limit);
      return { text, steps, toolLog, usage: tally, escalated, incomplete: true, finalizedAtLimit: true, stopReason: 'tool_call_blocked' };
    }
    if (!calls.length) {
      if (res.text) messages.push({ role: 'assistant', content: res.text });
      return { text: res.text || answer, steps, toolLog, usage: tally, escalated, finalizedAtLimit: finalStep, stopReason: res.stopReason };
    }

    messages.push({ role: 'assistant', content: res.text || '', tool_calls: calls.map((c) => ({ id: c.id, name: c.name, args: safeParse(c.argsJson) })) });

    const runOne = async (c) => {
      const args = safeParse(c.argsJson);
      const signature = `${c.name}:${stableJson(args)}`;
      const prior = attempts.get(signature);
      const risk = registry.byName?.get(c.name)?.risk || 'unknown';
      const repeatedAction = prior?.ok === true && prior.risk !== 'read';
      if (prior?.running || prior?.count >= 2 || prior?.ok === false || repeatedAction) {
        const message = prior?.ok === false
          ? 'This exact tool call already failed. Do not repeat it unchanged; inspect the error and change the arguments or use a different approach.'
          : prior?.running
            ? 'This exact tool call is already in progress. Do not launch a duplicate; wait for its result and continue from there.'
            : repeatedAction
              ? 'This exact state-changing tool call already succeeded. Do not run it again; verify the outcome with a read-only tool or move on.'
              : 'This exact read-only tool call has already been made twice. Stop repeating it and make progress with a different tool or explain the blocker.';
        const out = { ok: false, tool: c.name, error: { code: 'repeat_blocked', message, hint: 'Change the selector/path/arguments, or use another tool.' }, ms: 0, result: message };
        bus.warn('loop.repeat_blocked', { label, step: steps, tool: c.name });
        return { id: c.id, name: c.name, args, out };
      }
      attempts.set(signature, { count: (prior?.count || 0) + 1, running: true, ok: null, risk });
      await waitIfPaused(ctx, signal, onEvent, label);
      if (signal?.aborted) {
        const out = { ok: false, tool: c.name, error: { code: 'aborted', message: 'the run was stopped before this tool could execute' }, ms: 0 };
        attempts.set(signature, { count: (prior?.count || 0) + 1, running: false, ok: false, risk });
        return { id: c.id, name: c.name, args, out };
      }
      const out = await registry.exec(c.name, args, { ...ctx, session: ctx?.session ?? 'desktop', step: steps, readOnly: Boolean(ctx?.readOnly) });
      attempts.set(signature, { count: (prior?.count || 0) + 1, running: false, ok: out.ok !== false, risk });
      return { id: c.id, name: c.name, args, out };
    };
    const parallelSafe = calls.length > 1 && calls.every((c) => {
      const tool = registry.byName?.get(c.name);
      return tool?.risk === 'read' && !['browser', 'screen', 'agent'].includes(tool.group);
    });
    const parallel = cfg.get('agent.parallel') !== false && parallelSafe;
    const results = parallel ? await Promise.all(calls.map(runOne)) : await sequential(calls, runOne);
    if (calls.length > 1) onEvent({ type: 'tool_batch', label, step: steps, parallel, count: calls.length });

    for (const r of results) {
      const ok = r.out.ok !== false;
      if (!ok) errors += 1;
      else errors = Math.max(0, errors - 1);
      toolLog.push({ tool: r.name, args: r.args ?? {}, ok, error: ok ? null : r.out.error?.message || 'unknown error', ms: r.out.ms, summary: summarize(r.out) });
      onEvent({ type: 'tool_result', label, tool: r.name, ok, error: r.out.error || null, spilled: r.out.spilled || null, summary: summarize(r.out), meta: r.out.meta || null });
      messages.push({
        role: 'tool',
        tool_call_id: r.id,
        content: ok ? String(r.out.result ?? '(ok)') : `ERROR [${r.out.error?.code || 'error'}]: ${r.out.error?.message}\n${r.out.error?.hint ? `HINT: ${r.out.error.hint}` : ''}`,
      });
    }

    const failedCalls = results.filter((r) => r.out.ok === false);
    if (failedCalls.length && steps < limit) {
      messages.push({
        role: 'system',
        content: `RECOVERY REQUIRED: ${failedCalls.length} tool call(s) failed (${failedCalls.map((r) => `${r.name}: ${r.out.error?.code || 'error'}`).join(', ')}). Read the exact errors above. Do not repeat a failed call unchanged; fix its arguments, inspect a prerequisite, or switch tools. Continue toward the user's goal if a safe alternative exists.`,
      });
    }

    const escalateAfter = Number(cfg.get('routing.escalateAfterErrors')) || 2;
    if (!escalated && errors >= escalateAfter) {
      escalated = true;
      onEvent({ type: 'escalate', label, step: steps, to: cfg.get('routing.escalateJob') || 'analysis', why: `${errors} tool errors in a row` });
      bus.info('loop.escalate', { label, step: steps, errors });
    }

    if (estimateTokens(messages) > (agent.contextTokens || 48000) * 0.72) {
      const c = await compact({ cfg, messages, brief });
      messages.length = 0;
      messages.push(...c.messages);
      brief = c.brief || brief;
      onEvent({ type: 'compact', label, step: steps, tokens: c.tokens });
    }
  }

  onEvent({ type: 'loop.limit', label, steps, toolCalls: toolLog.length });
  return {
    text: summarizePartial(toolLog, limit, answer),
    steps,
    toolLog,
    usage: tally,
    escalated,
    incomplete: true,
  };
}

async function sequential(calls, runOne) {
  const out = [];
  for (const c of calls) out.push(await runOne(c));
  return out;
}

export function safeParse(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try {
    return JSON.parse(s);
  } catch {
    const fixed = String(s)
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/['‘’“”]/g, '"');
    try {
      return JSON.parse(fixed);
    } catch {
      const kv = {};
      for (const m of String(s).matchAll(/(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/g)) {
        const v = m[2];
        kv[m[1]] = /^".*"$/.test(v) ? JSON.parse(v) : v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : Number(v);
      }
      return kv;
    }
  }
}

function summarize(out) {
  if (out?.summary) return out.summary;
  const t = String(out?.result ?? '');
  return t.length ? t.split('\n')[0].slice(0, 160) : 'done';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function summarizePartial(toolLog, limit, priorAnswer = '') {
  if (!toolLog.length) return priorAnswer || `I reached the ${limit}-step limit before I could verify a final result. No tool action was recorded.`;
  const recent = toolLog.slice(-6).map((item) => `- ${item.ok ? 'Completed' : 'Failed'} ${item.tool}: ${item.summary || item.error || 'no details returned'}`).join('\n');
  return `I reached the ${limit}-step limit before I could fully finish and verify the task. Here is the recorded progress:\n${recent}\nPlease let me continue or narrow the remaining work.`;
}

async function waitIfPaused(ctx, signal, onEvent, label) {
  let announced = false;
  while (ctx?.paused?.() && !signal?.aborted) {
    if (!announced) {
      onEvent({ type: 'paused', label, message: 'Paused at a safe boundary; resume to continue.' });
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
