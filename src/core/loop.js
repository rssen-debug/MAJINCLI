/**
 * MAJIN — verktygsslingan.
 * Samma loop för huvudagenten och subagenter. Stegvisa beslut:
 *   kör → om fel ≥2: eskalera till tyngre modell → komprimera kontext → upprepa.
 * Inget tröskel-jagar: modellen får alla verktyg, alltid.
 */
import { complete, explainError } from './provider/chat.js';
import { routeFor } from './router.js';
import { compact, estimateTokens } from './context.js';
import { bus } from './log.js';

export async function loop({ cfg, registry, messages, job = 'tasks', onEvent = () => {}, signal, maxSteps, usage, ctx, allowTools = true, label = 'agent' }) {
  const agent = cfg.get('agent') || {};
  const limit = Number(maxSteps) || agent.maxSteps || 40;
  const toolLog = [];
  let steps = 0;
  let errors = 0;
  let escalated = false;
  const whoIs = (r) => r?.label || r?.providerName || 'The provider';
  let answer = '';
  let brief = messages.find((m) => m.role === 'system' && String(m.content).startsWith('ARBETSMINNESBRIEF'))?.content || '';
  const tally = { input: 0, output: 0, costUsd: 0 };

  while (steps < limit) {
    if (signal?.aborted) {
      bus.warn('loop.aborted', { label, steps });
      return { text: answer || '(avbruten)', steps, toolLog, usage: tally, aborted: true, escalated };
    }
    steps += 1;
    const stepJob = escalated ? cfg.get('routing.escalateJob') || 'analysis' : steps === 1 ? job : agent.stepJob || 'tasks';
    const route = routeFor(cfg, stepJob);
    if (!route) throw new Error('no provider with an API key yet — open the Providers card, pick one and paste the key');
    onEvent({ type: 'step', label, step: steps, of: limit, job: stepJob, model: route.ref, escalated });

    let res;
    try {
      res = await complete({
        route,
        job: `${label}:${stepJob}`,
        messages,
        tools: allowTools ? registry.schemas({ readOnly: Boolean(ctx?.readOnly) }) : [],
        toolChoice: allowTools ? undefined : 'none',
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
    if (!calls.length) {
      if (res.text) messages.push({ role: 'assistant', content: res.text });
      return { text: res.text || answer, steps, toolLog, usage: tally, escalated, stopReason: res.stopReason };
    }

    messages.push({ role: 'assistant', content: res.text || '', tool_calls: calls.map((c) => ({ id: c.id, name: c.name, args: safeParse(c.argsJson) })) });

    const runOne = async (c) => {
      const args = safeParse(c.argsJson);
      onEvent({ type: 'tool_begin', label, step: steps, callId: c.id, name: c.name });
      const out = await registry.exec(c.name, args, { ...ctx, session: ctx?.session ?? 'desktop', step: steps, readOnly: Boolean(ctx?.readOnly) });
      // args följer med i loggen: utan dem är en spårning värdelös som träningsdata
      // (och trådhistoriken kan inte återskapa *varför* verktyget kördes).
      return { id: c.id, name: c.name, args, out };
    };
    const results = allowTools && cfg.get('agent.parallel') !== false ? await Promise.all(calls.map(runOne)) : await sequential(calls, runOne);

    for (const r of results) {
      const ok = r.out.ok !== false;
      if (!ok) errors += 1;
      else errors = Math.max(0, errors - 1);
      toolLog.push({ tool: r.name, args: r.args ?? {}, ok, error: ok ? null : r.out.error?.message || 'unknown error', ms: r.out.ms, summary: summarize(r.out) });
      onEvent({ type: 'tool_result', label, step: steps, callId: r.id, tool: r.name, ok, error: r.out.error || null, spilled: r.out.spilled || null, summary: summarize(r.out), meta: r.out.meta || null });
      messages.push({
        role: 'tool',
        tool_call_id: r.id,
        content: ok ? String(r.out.result ?? '(ok)') : `ERROR [${r.out.error?.code || 'error'}]: ${r.out.error?.message}\n${r.out.error?.hint ? `HINT: ${r.out.error.hint}` : ''}`,
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
    text: answer || `Step limit ${limit} reached without a final answer (${toolLog.length} tool runs). Raise agent.maxSteps or split the task.`,
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
