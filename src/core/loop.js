import { withTimeout, RepeatDetector, TurnClock } from './watchdog.js';
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
import { isFreeRoute, priceKnownForRoute } from './pricing.js';
import { guardToolContent } from './injection.js';

/*
 * Väljer vilka scheman modellen får se detta steg. Standard: hela den synliga
 * ytan (oförändrat beteende). Slår agent.toolSubset på blir det deterministiskt
 * urval per turn (se agent.toolSelection) — urvalet och storleken raporteras
 * ärligt i steg-händelsen så inget spar visas utan mätning.
 */
function pickSchemas(registry, ctx) {
  const all = registry.schemas({ readOnly: Boolean(ctx?.readOnly) });
  const names = ctx?.toolSubsetNames;
  if (!Array.isArray(names) || !names.length) return all;
  const wanted = new Set(names.filter((n) => registry.has(n)));
  return all.filter((t) => wanted.has(t.name));
}

/** Del 6A: ONE guard, two call sites. Monthly ledger check before a call costs
   anything; per-task check after each measured step. Returns null to proceed,
   or a result object hard-stopping the loop HONESTLY (errorKind 'budget'). */
export function budgetGate({ cfg, usageCtx = null, route, tally = null }) {
  if (usageCtx?.overBudget?.() && cfg.get('budget.mode') === 'cap' && !isFreeRoute(route)) {
    const capUsd = Number(cfg.get('budget.monthlyUsd')) || 0;
    const human = route.pricing && (route.pricing.in || route.pricing.out)
      ? `The monthly budget of $${capUsd} is reached — paid models stop here. Free models and your own server still answer, or say "budget <new> USD" to raise it.`
      : `The monthly budget of $${capUsd} is reached, and "${route.model || 'this model'}" has no known price — under a cap, unknown never spends. Free models and your own server still answer, or say "budget <new> USD" to raise it.`;
    return { kind: 'monthly', text: human, error: 'budget cap reached', errorKind: 'budget', fatal: true, stopReason: 'budget' };
  }
  /* per-task: ONLY real measured cost can trip this — free routes spend $0 and never do. */
  const perTask = Number(cfg.get('budget.perTaskUsd')) || 0;
  if (tally && perTask > 0 && cfg.get('budget.mode') === 'cap' && (tally.costUsd || 0) > perTask) {
    const human = `This task's budget of $${perTask} is spent ($${(tally.costUsd || 0).toFixed(4)} measured so far) — the task stops here instead of compounding silently. Raise it with "budget.task <new> USD" or run a cheaper model.`;
    return { kind: 'task', text: human, error: 'task budget cap reached', errorKind: 'budget', fatal: true, stopReason: 'task-budget' };
  }
  return null;
}

export async function loop({ cfg, registry, messages, job = 'tasks', onEvent = () => {}, signal, maxSteps, usage, ctx, allowTools = true, label = 'agent', providerErrorCap = 4, providerRetries = null, modelCall = null }) {
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
  const turnRoutes = new Map(); // stepJob -> route pinned for this turn
  /* W13 never-stuck machinery: per-tool hard timeout + repeat-loop detector + turn time-box. */
  const wdToolTimeoutMs = Math.max(1000, Number(cfg.get('agent.toolTimeoutSec') || 300) * 1000);
  const wdTurnMaxMs = Math.max(250, Number(cfg.get('agent.maxTurnSec') || 1800) * 1000);
  const wdDetect = new RepeatDetector(Math.max(2, Number(cfg.get('agent.maxRepeatCalls') || 3)));
  const wdClock = new TurnClock();
  let wdRepeatBlocked = false;

  while (steps < limit) {
    const wdBox = wdClock.over(wdTurnMaxMs);
    if (wdBox.over) {
      bus.warn('loop.turn_timeout', { label, steps, elapsedMs: wdBox.elapsedMs, wdTurnMaxMs });
      onEvent({ type: 'turn_timeout', label, steps, elapsedMs: wdBox.elapsedMs, limitMs: wdTurnMaxMs });
      return { text: answer || '(time-boxed turn)', steps, toolLog, usage: tally, escalated, stopReason: 'turn_timeout', blocked: 'the turn exceeded its time box — split the work or raise agent.maxTurnSec deliberately' };
    }
    if (wdRepeatBlocked) {
      bus.warn('loop.repeat_block', { label, steps });
      return { text: answer || '(blocked: repeated identical tool call — see toolLog)', steps, toolLog, usage: tally, escalated, stopReason: 'repeat_block', blocked: 'no progress: identical tool call repeated >= maxRepeatCalls' };
    }
    if (signal?.aborted) {
      bus.warn('loop.aborted', { label, steps });
      return { text: answer || '(avbruten)', steps, toolLog, usage: tally, aborted: true, escalated };
    }
    steps += 1;
    const stepJob = escalated ? cfg.get('routing.escalateJob') || 'analysis' : steps === 1 ? job : agent.stepJob || 'tasks';
    /* P0: a TURN keeps the route chosen at its start. Resolving fresh on every
       step meant a provider switch mid-turn silently changed which model
       finished the running work (handover: picker wrote globally; every step
       re-read). Escalation keeps its own deliberate swap via its own key. */
    let route = turnRoutes.get(stepJob) || null;
    if (!route) {
      route = routeFor(cfg, stepJob, { session: ctx?.session });
      if (route) turnRoutes.set(stepJob, route);
    }
    if (!route) throw new Error('no provider with an API key yet — open the Providers card, pick one and paste the key');
    /* A cap is a promise: over the monthly line, PAID calls stop right here,
       before they cost anything. Free routes keep working. */
    const monthlyBlock = budgetGate({ cfg, usageCtx: usage, route });
    if (monthlyBlock) {
      bus.warn('loop.budget', { label, kind: monthlyBlock.kind });
      onEvent({ type: 'error', label, where: 'budget', message: monthlyBlock.text, kind: 'budget' });
      return { text: monthlyBlock.text, steps, toolLog, usage: tally, error: monthlyBlock.error, errorKind: 'budget', fatal: true, stopReason: monthlyBlock.stopReason };
    }

    const sentTools = allowTools ? pickSchemas(registry, ctx) : [];
    onEvent({ type: 'step', label, step: steps, of: limit, job: stepJob, model: route.ref, escalated, toolsSent: sentTools.length, toolChars: sentTools.reduce((a, t) => a + t.description.length + JSON.stringify(t.parameters).length, 0) });

    let res;
    if (typeof modelCall === 'function') {
      /* test/offline seam (same spirit as mission workerOverride): the fake
         model is caller-injected; live paths always go through complete(). */
      res = await modelCall({ messages, stepJob, step: steps, tools: sentTools });
    } else try {
      res = await complete({
        route,
        job: `${label}:${stepJob}`,
        messages,
        tools: sentTools,
        toolChoice: allowTools ? undefined : 'none',
        stream: true,
        maxTokens: agent.maxTokens || 6000,
        temperature: agent.temperature ?? 0.2,
        retries: providerRetries ?? agent.retries ?? 2,
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
      if (errors >= providerErrorCap) return { text: answer || `${whoIs(route)} did not answer after ${errors} tries: ${info.human || err.message}`, steps, toolLog, usage: tally, error: err.message, errorKind: info.kind, errorHint: err.hint || null, escalated };
      messages.push({ role: 'user', content: `The previous call failed (${err.code || 'error'}: ${String(err.message).slice(0, 200)}). Try again, simpler.` });
      continue;
    }

    tally.input += res.usage?.input || 0;
    tally.output += res.usage?.output || 0;
    tally.costUsd += res.usage?.costUsd || 0;
    tally.priceKnown = priceKnownForRoute(route);
    const taskBlock = budgetGate({ cfg, usageCtx: null, route, tally });
    if (taskBlock) {
      bus.warn('loop.budget.task', { label, costUsd: tally.costUsd, steps });
      onEvent({ type: 'error', label, where: 'budget', message: taskBlock.text, kind: 'budget' });
      return { text: taskBlock.text, steps, toolLog, usage: tally, error: taskBlock.error, errorKind: 'budget', fatal: true, stopReason: taskBlock.stopReason };
    }
    usage?.record({ job: `${label}:${stepJob}`, ref: res.route || route.ref, usage: res.usage, ms: res.elapsedMs, escalated, unpriced: !route.pricing && !isFreeRoute(route) });
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
      const rep = wdDetect.hit(c.name, args);
      let out;
      if (rep.repeat) {
        out = { ok: false, ms: 0, error: { code: 'repeat_loop', message: `same call "${c.name}" repeated ${rep.count}x with identical args — stopped, never silently retried (change approach)`, key: rep.key } };
        wdRepeatBlocked = true;
      } else {
        try {
          out = await withTimeout(registry.exec(c.name, args, { ...ctx, session: ctx?.session ?? 'desktop', step: steps, readOnly: Boolean(ctx?.readOnly) }), { ms: wdToolTimeoutMs, label: `tool ${c.name}` });
        } catch (werr) {
          out = { ok: false, ms: wdToolTimeoutMs, error: { code: werr.code === 'tool_timeout' ? 'tool_timeout' : werr.code || 'tool_error', message: werr.message } };
        }
      }
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
      onEvent({ type: 'tool_result', label, step: steps, callId: r.id, tool: r.name, ok, ms: r.out.ms ?? null, error: r.out.error || null, spilled: r.out.spilled || null, summary: summarize(r.out), meta: r.out.meta || null });
      /* Del 10C: outside data is scanned for override attempts. Clean
         results stay byte-identical (zero token tax); a hit is annotated in
         the very message the model reads AND surfaced as an event. */
      const guarded = guardToolContent(r.name, ok ? String(r.out.result ?? '(ok)') : `ERROR [${r.out.error?.code || 'error'}]: ${r.out.error?.message}\n${r.out.error?.hint ? `HINT: ${r.out.error.hint}` : ''}`);
      if (guarded.hits.length) onEvent({ type: 'injection_warning', label, step: steps, tool: r.name, patterns: guarded.hits.map((h) => h.id) });
      messages.push({
        role: 'tool',
        tool_call_id: r.id,
        content: guarded.text,
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
