/**
 * MAJIN — agentverktyg: plan, delegering, manuell MOA.
 * Delegering = en isolerad subagent med eget stegbudschet och egen kontext.
 */
import { def } from './registry.js';
import { run } from '../subagent.js';

export const agentTools = [
  def({
    name: 'agent.plan',
    group: 'agent',
    risk: 'read',
    desc: 'Skriv och uppdatera den synliga arbetslistan för sessionen. Används för mer än 3 steg; UI:t visar den live.',
    params: {
      items: 'array: [{"text":"gör detta","status":"todo|doing|done|blocked"}]',
      mode: 'string: replace | merge [replace|merge]',
      note: 'string: kort varför planen ser ut så här',
    },
    async run({ items = [], mode = 'replace', note }, ctx) {
      const norm = items.map((it, i) => ({
        id: it.id || `t${i + 1}`,
        text: String(it.text || it.title || '').slice(0, 300),
        status: ['todo', 'doing', 'done', 'blocked'].includes(it.status) ? it.status : 'todo',
      }));
      let plan = mode === 'merge' ? [...(ctx.plan || []), ...norm] : norm;
      const seen = new Set();
      plan = plan.filter((p) => !seen.has(p.id) && seen.add(p.id));
      ctx.plan = plan;
      ctx.setPlan?.(plan, note);
      const done = plan.filter((p) => p.status === 'done').length;
      return { result: `plan (${done}/${plan.length} klara)${note ? ` — ${note}` : ''}\n${plan.map((p) => `[${p.status === 'done' ? 'x' : p.status === 'doing' ? '~' : p.status === 'blocked' ? '!' : ' '}] ${p.text}`).join('\n')}`, meta: { plan }, summary: `plan ${done}/${plan.length}` };
    },
  }),

  def({
    name: 'agent.delegate',
    group: 'agent',
    risk: 'read',
    desc: 'Skicka ett delproblem till en subagent med eget stegbudschet (den ser dina verktyg men inte din historik). Används för parallellt gräv — t.ex. "analysera dessa 3 filer".',
    params: {
      tasks: 'array: [{"task":"beskriv uppgiften","job":"code|re|tasks|research","maxSteps":12}]',
      parallel: 'boolean: kör alla samtidigt (default true)',
    },
    examples: ['agent.delegate({tasks:[{task:"triage a.exe",job:"re"},{task:"triage b.exe",job:"re"}]})'],
    async run({ tasks = [], parallel = true }, ctx) {
      const max = ctx.cfg.get('agent.subagents.maxParallel') || 3;
      const list = (Array.isArray(tasks) ? tasks : [tasks]).slice(0, Math.max(1, max)).map((t) => (typeof t === 'string' ? { task: t } : t));
      if (!list.length) throw new Error('tomma tasks');
      const exec = async (t) => {
        const t0 = Date.now();
        try {
          const res = await run({ cfg: ctx.cfg, task: String(t.task).slice(0, 4000), job: t.job, maxSteps: Number(t.maxSteps) || 10, registry: ctx.registry, session: `${ctx.session}-sub-${Math.random().toString(36).slice(2, 6)}`, emit: ctx.emit, memory: ctx.memory });
          return { task: t.task, ok: true, answer: res.text, steps: res.steps, ms: Date.now() - t0, tools: res.tools };
        } catch (err) {
          return { task: t.task, ok: false, error: err.message, ms: Date.now() - t0 };
        }
      };
      const out = parallel ? await Promise.all(list.map(exec)) : [];
      if (!parallel) for (const t of list) out.push(await exec(t));
      const body = out.map((r, i) => `--- subagent ${i + 1}: ${r.task.slice(0, 90)}\n${r.ok ? r.answer : `FEL: ${r.error}`}\n(${r.steps || 0} steg, ${((r.ms || 0) / 1000).toFixed(1)}s)`).join('\n\n');
      return { result: `${out.length} subagenter:\n\n${body}`, meta: { count: out.length, failed: out.filter((x) => !x.ok).length }, summary: `${out.length} subagenter klara` };
    },
  }),

  def({
    name: 'agent.moa',
    group: 'agent',
    risk: 'read',
    desc: 'Kör en extra Mixture-of-Agents-runda på ett delproblem (flera modeller parallellt + aggregator). Används vid svåra beslut, inte för allt.',
    params: { question: 'string: underfrågan', context: 'string: bakgrund som behövs', width: 'number: antal referenser (default config)' },
    async run({ question, context, width }, ctx) {
      const { run: moaRun } = await import('../moa.js');
      const res = await moaRun({ cfg: ctx.cfg, question: String(question), context: context ? [{ role: 'system', content: String(context).slice(0, 6000) }] : [], job: ctx.cfg.get('routing.auto') === false ? 'analysis' : 'analysis', forceWidth: width ? Number(width) : undefined, emit: ctx.emit });
      return {
        result: `MOA (enighet ${res.agreement?.score ?? '-'}${res.escalated ? ', eskalerade' : ''}):\n${res.answer}\n\nReferenser: ${res.refs.map((r) => `${r.ref}${r.error ? ' ✗' : ` ${r.text.length}t`}`).join(', ')}`,
        meta: { agreement: res.agreement, escalated: res.escalated, ms: res.elapsedMs },
        summary: `MOA-svar (enighet ${res.agreement?.score ?? '?'})`,
      };
    },
  }),

  def({
    name: 'agent.approve',
    group: 'agent',
    risk: 'read',
    desc: 'Svara på en väntande bekräftelse i UI:t (godkänn/avslå). Endast när användaren uttryckligen bett dig göra det.',
    params: { id: 'string: approvals-id', approved: 'boolean: godkänn?', note: 'string: varför' },
    async run({ id, approved, note }, ctx) {
      const { approvals } = await import('../guard.js');
      const ok = approvals.respond(String(id), Boolean(approved), note);
      return { ok, result: ok ? `${approved ? 'godkände' : 'avslog'} ${id}` : `ingen väntande förfrågan med id ${id} (kanske redan besvarad)`, meta: { pending: approvals.list().map((p) => p.id) } };
    },
  }),
];
