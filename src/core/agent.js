/**
 * LENT — agentturn.
 * 1) naturallyspråk → config (gratis, ingen LLM)  2) klassa jobb  3) verktygsslinga
 * 4) MOA-final  5) minne + färdighet + historik. Overskott är bortskuret; allt körs på samma loop.
 */
import os from 'node:os';
import { bus as globalBus } from './log.js';
import { classify, llmClassify, plan as planTurn } from './router.js';
import { parseIntent } from './routes.js';
import { JOBS } from './config.js';
import { loop } from './loop.js';
import { run as moaRun } from './moa.js';
import { estimateTokens, appendHistory } from './context.js';
import { dirs } from './paths.js';
import { approvals } from './guard.js';

export class Agent {
  constructor({ cfg, registry, memory, skills, usage, channels = null, bus = globalBus, scheduler = null, shared = {} }) {
    this.cfg = cfg;
    this.registry = registry;
    this.memory = memory;
    this.skills = skills;
    this.usage = usage;
    this.channels = channels;
    this.scheduler = scheduler;
    this.bus = bus;
    this.plans = new Map();
    this.abort = new Map();
    this.paused = false;
    this.shared = shared;
  }

  setPlan(session, plan, note) {
    if (!plan?.length) this.plans.delete(session);
    else this.plans.set(session, plan);
    this.bus.emit('plan', { session, plan: plan || [], note: note || null });
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  stop(session) {
    this.abort.get(session)?.abort();
  }

  systemPrompt({ session, decision, turnPlan, attachments }) {
    const cfg = this.cfg;
    const tools = this.registry.list();
    const groups = [...new Set(tools.map((t) => t.group))];
    const guard = cfg.get('guard.mode');
    const now = new Date();
    return [
      `Du är ${cfg.get('name')} — en agent som kör direkt på användarens Windows-maskin. Plattform ${os.platform()} ${os.arch()}, nod ${process.version}. Lokal tid ${now.toISOString().slice(0, 16).replace('T', ' ')} (${now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}).`,
      `Workspace ${cfg.get('workspace')} · data ${dirs.root}.`,
      '',
      cfg.get('persona.identity'),
      cfg.get('persona.style'),
      cfg.get('persona.safety'),
      '',
      `VERKTYG: alla ${tools.length} är alltid på — det finns inget att aktivera. Grupper: ${groups.join(', ')}.`,
      'Använd verktyg i stället för att gissa. Flera oberoende anrop i samma svar körs parallellt — batcha dem. Vid fel: läs felet, rätta argumenten, kör igen (efter två fel i rad eskalerar modellen automatiskt).',
      'Sökvägar: absolut eller relativt workspacet. Skriv aldrig över något du inte läst, och radera inte det du inte skapat.',
      'RE: re.analyze = headers, sektioner+entropi, imports med riskmarkering, YARA, IOC-strängar, opkodsmönster och "nästa steg". re.strings/re.search/re.yara/re.diff är mikrofonen. re.tool kopplar på ghidra/rizin/objdump om de finns på maskinen.',
      'Om användaren beskriver en inställning på naturligt språk ("använd X för Y alltid", "kör moa på allt", "fråga inte mer") → kör lent.configure med intent, eller säg exakt vad du ändrade.',
      '',
      `ROUTING (jobb → modell): ${Object.entries(routeSummary(cfg)).map(([k, v]) => `${k}:${v}`).join('  ')}`,
      `Den här turen: jobb=${decision.job} (säkerhet ${decision.confidence}), primär=${turnPlan.route?.ref || '?'}, ${turnPlan.moa?.enabled ? `MOA ${turnPlan.moa.width} referenser → aggregator ${turnPlan.moa.aggregator}` : 'MOA av för den här typen'}.`,
      `Guard: ${guard === 'off' ? 'AV — inga bekräftelser, du äger konsekvensen' : 'frågar bara före irreversible åtgärder'}.`,
      '',
      this.skills.prompt(),
      this.memory?.digest?.() || '',
      attachments?.length ? `BILAGOR (redan sparade på disk):\n${attachments.map((a) => `- ${a.name} · ${a.kind} · ${a.size} byte${a.path ? ` · ${a.path}` : ''}${a.note ? ` · ${a.note}` : ''}`).join('\n')}` : '',
      this.plans.get(session)?.length ? `AKTIV PLAN:\n${this.plans.get(session).map((p) => `[${p.status === 'done' ? 'x' : p.status === 'doing' ? '~' : p.status === 'blocked' ? '!' : ' '}] ${p.text}`).join('\n')}` : '',
      '',
      'Svara på användarens språk. Kort före långt. Ingen metadata om dig själv.',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  async turn({ input, session = 'desktop', attachments = [], onEvent = () => {}, history = [], source = null }) {
    const cfg = this.cfg;
    const ctrl = new AbortController();
    this.abort.set(session, ctrl);
    const emit = (ev) => {
      try {
        onEvent(ev);
      } catch {
        /* frånvarande UI får inte sänka agenten */
      }
      this.bus.emit(`agent.${ev.type}`, { session, ...ev });
    };

    try {
      /* 1) naturallyspråk → direkt config utan modell */
      const intent = parseIntent(input, cfg);
      let intentNote = null;
      if (intent.matched) {
        const applied = cfg.patch(intent.patch, { source: `intent:${session}` });
        if (applied.ok) {
          intentNote = intent.notes.join('; ');
          emit({ type: 'config', notes: intent.notes, patch: intent.patch, file: cfg.file });
          if (onlyConfig(input, intent)) {
            const changed = cfg.routeTable().filter((r) => intent.notes.some((n) => n.startsWith(`${r.job} →`)));
            const text = [
              `Klart. ${intent.notes.join(', ')}.`,
              changed.length ? changed.map((r) => `${r.job} → ${r.ref}${r.ready ? '' : '  (ingen nyckel ännu)'}`).join('\n') : '',
              cfg.get('moa.policy') === 'always' ? 'MOA: på — varje svar går genom referenser + aggregator.' : '',
              'Sparat i config, gäller från och med nu.',
            ]
              .filter(Boolean)
              .join('\n');
            appendHistory(session, { role: 'user', content: input, source });
            appendHistory(session, { role: 'assistant', content: text, fastPath: true });
            this.memory?.event?.('config', { summary: intent.notes.join(', ') });
            emit({ type: 'answer', text, fastPath: true });
            return { text, fastPath: true, steps: 0, tools: [], usage: { input: 0, output: 0, costUsd: 0 }, job: 'config', intent: intent.notes };
          }
        } else {
          emit({ type: 'config_error', errors: applied.errors });
        }
      }

      /* 2) klassa jobbet (ingen blockering: vid tvekan, en liten modell frågar) */
      let decision = classify(input, { cfg, attachments, history, source });
      if (decision.needsLlm) {
        const llm = await llmClassify(input, { cfg });
        if (llm && llm !== decision.job) decision = { ...decision, job: llm, llmTiebreak: true };
      }
      const turnPlan = planTurn(cfg, decision);
      emit({ type: 'route', job: decision.job, confidence: decision.confidence, model: turnPlan.route?.ref, moa: turnPlan.moa, reasons: decision.reasons, alt: decision.alt, tiebreak: Boolean(decision.llmTiebreak) });

      /* 3) verktygsslingan */
      const sys = this.systemPrompt({ session, decision, turnPlan, attachments });
      const ctx = {
        ...this.shared,
        cfg,
        session,
        agent: this,
        emit,
        bus: this.bus,
        registry: this.registry,
        memory: this.memory,
        skills: this.skills,
        usage: this.usage,
        approvals,
        channels: this.channels,
        scheduler: this.scheduler,
        paused: () => this.paused,
        statusProviders: () => cfg.providerStatus(),
        plan: this.plans.get(session) || [],
        setPlan: (plan, note) => this.setPlan(session, plan, note),
        stop: () => this.stop(session),
      };
      const messages = [
        { role: 'system', content: sys },
        ...history.filter((m) => m.role !== 'system').slice(-((cfg.get('agent.historyInPrompt') || 40) - 2)),
        ...(intentNote ? [{ role: 'system', content: `CONFIG ÄNDRAD DENNA TURN: ${intentNote}` }] : []),
        { role: 'user', content: formatUser(input, attachments) },
      ];

      const res = await loop({
        cfg,
        registry: this.registry,
        messages,
        job: decision.job,
        onEvent: emit,
        signal: ctrl.signal,
        usage: this.usage,
        ctx,
        label: 'main',
      });

      /* 4) MOA-final — kort prat utan verktyg hoppar över, det kostar mer än det ger */
      const toolsUsed = res.toolLog.length > 0;
      const trivial = decision.job === 'chat' && !toolsUsed && (res.text || '').length < 200;
      let finalText = res.text;
      let moaInfo = null;
      if (turnPlan.moa.enabled && !res.aborted && !trivial) {
        const evidence = summarizeRun(res, messages);
        const moaRes = await moaRun({
          cfg,
          question: `${input}\n\nBEVIS FRÅN DENNA TURN (verktyg, inte gissningar):\n${evidence}`,
          context: [{ role: 'system', content: sys }],
          job: 'final',
          onEvent: emit,
          signal: ctrl.signal,
          maxTokens: cfg.get('moa.aggregatorMaxTokens') || 3000,
          usage: this.usage,
        });
        if (moaRes.answer) finalText = moaRes.answer;
        moaInfo = { agreement: moaRes.agreement, refs: moaRes.refs.length, escalated: moaRes.escalated, ms: moaRes.elapsedMs };
        for (const k of ['input', 'output', 'costUsd']) res.usage[k] = (res.usage[k] || 0) + (moaRes.usage?.[k] || 0);
      }

      /* 5) historik, minne, färdighet */
      appendHistory(session, { role: 'user', content: input, source, job: decision.job });
      appendHistory(session, { role: 'assistant', content: finalText, steps: res.steps, tools: res.toolLog.length });
      if (cfg.get('memory.auto') && toolsUsed) {
        this.memory?.event?.('turn', { summary: firstLine(input), tools: [...new Set(res.toolLog.map((t) => t.tool))].slice(0, 8).join(','), ok: !res.error });
        const facts = res.toolLog.filter((t) => t.ok).length >= 4 ? await this.harvestFacts(input, res, messages) : [];
        for (const f of facts) this.memory?.remember?.(f, [decision.job]);
      }
      if (cfg.get('skills.auto') && res.steps >= 5 && !res.error) {
        const skill = suggestSkill(input, res);
        if (skill) {
          const saved = this.skills.save(skill);
          if (saved.ok) emit({ type: 'skill_auto', name: skill.name, file: saved.file });
        }
      }

      const out = {
        text: finalText,
        steps: res.steps,
        tools: res.toolLog,
        usage: res.usage,
        job: decision.job,
        route: turnPlan.route,
        moa: moaInfo,
        escalated: res.escalated,
        incomplete: res.incomplete,
        error: res.error,
        contextTokens: estimateTokens(messages),
        aborted: res.aborted,
      };
      emit({ type: 'answer', text: out.text, meta: { steps: out.steps, tools: out.tools.length, moa: out.moa, job: out.job, usage: out.usage } });
      if (this.usage?.overBudget?.()) emit({ type: 'budget', used: this.usage.summary().costUsd, cap: cfg.get('budget.monthlyUsd') });
      return out;
    } catch (err) {
      this.bus.error('agent.turn', { session, error: err.message, stack: String(err.stack).split('\n').slice(0, 3).join(' | ') });
      emit({ type: 'error', message: err.message, hint: err.hint || null });
      throw err;
    } finally {
      this.abort.delete(session);
    }
  }

  async harvestFacts(input, res, messages) {
    try {
      const { complete } = await import('./provider/chat.js');
      const route = (await import('./router.js')).routeFor(this.cfg, 'summarize');
      if (!route) return [];
      const r = await complete({
        route,
        job: 'memory',
        stream: false,
        maxTokens: 220,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Extrahera HÖGST 3 bestående fakta om användaren eller dennes projekt från konversationen.Endast sådant som gäller imorgon också (preferenser, hårdvara, sökvägar, beslut). En rad per faktum, ingen prefix eller numrering. Inget att spara → svara exakt: TOMT' },
          { role: 'user', content: `${String(input).slice(0, 800)}\n\nVERKTYG: ${res.toolLog.map((t) => `${t.tool}:${t.ok ? 'ok' : 'fel'}`).join(', ').slice(0, 600)}\n\nSVAR: ${String(res.text).slice(0, 1500)}` },
        ],
      });
      const text = String(r.text || '').trim();
      if (!text || /^TOMT$/i.test(text)) return [];
      return text
        .split('\n')
        .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
        .filter((l) => l.length > 12 && l.length < 260)
        .slice(0, 3);
    } catch {
      return [];
    }
  }
}

function formatUser(input, attachments) {
  if (!attachments?.length) return input;
  const head = attachments.map((a) => `[bilaga ${a.name} · ${a.kind} · ${a.size}${a.path ? ` · sökväg ${a.path}` : ''}]`).join('\n');
  return `${head}\n\n${input}`.trim();
}

function summarizeRun(res, messages) {
  const lines = [];
  for (const t of res.toolLog.slice(-14)) lines.push(`- ${t.tool}: ${t.ok ? 'ok' : 'FEL'} — ${String(t.summary || '').slice(0, 220)}`);
  const last = [...messages].reverse().find((m) => m.role === 'assistant')?.content;
  if (last) lines.push(`- utkast till svar: ${String(last).slice(0, 1200)}`);
  return lines.join('\n') || '(inga verktyg körda)';
}

const firstLine = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 160);

function suggestSkill(input, res) {
  const uniq = [...new Set(res.toolLog.map((t) => t.tool))];
  if (uniq.length < 3) return null;
  const name = firstLine(input)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(' ')
    .slice(0, 5)
    .join('-')
    .slice(0, 40);
  if (!name) return null;
  return {
    name: `flöde: ${name}`,
    when: firstLine(input).slice(0, 120),
    tools: uniq.slice(0, 8),
    steps: `Körd sekvens (${res.steps} steg):\n${uniq.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nNotera: genererad av LENT efter en lyckad körning — förfina vid behov.`,
  };
}

function routeSummary(cfg) {
  const byJob = {};
  for (const r of cfg.routeTable()) byJob[r.job] = r.model;
  return byJob;
}

const STOP = new Set(
  `använd anvand use sätt satt set välj valj byt till ändra andra kör nu
   för pa på av i om och sen then efter med utan mot från frän av
   alltid permanent forever always varje every dag days gång time gånger
   allt all alla hela hela allt whole alltihop allting
   ska shall kan could vill want borde should måste
   ja nej tack okej ok ok fy bra fine toppen galen
   moa guard minne minnen memory skill skills färdighet fardighet
   spara galöm glöm radera ta bort fråga fraga inte ej innan
   du dig ert mitt vår var
   slå slogs avstängning påslagning enable disable aktivera avaktivera
   referens referenser modell modeller prompt steg max budget kr sek
   that this the a an to of for with about please now always`
    .split(/\s+/)
    .filter(Boolean),
);

/** Hela meningen handlade bara om inställningar → inget LLM-anrop behövs. */
const JOBS_SV = ['kod','koda','filer','fil','uppgifter','analys','undersök','undersok','planering','plan','sammanfattning','jämförelse','jamforelse','vision','bild','slut','slutlig','klassning','verktyg','reverse','binärt','binart','skiss','ordning','stök','stok'];

const MODEL_WORDS = new Set(['deepseek', 'openrouter', 'groq', 'openai', 'anthropic', 'gemini', 'nous', 'ollama', 'lmstudio', 'demo', 'pro', 'flash', 'max', 'mini', 'chat', 'reasoner', 'v4', 'v3', '1m', 'preview', 'latest', 'default', 'model', 'models', 'modell', 'modeller']);

export function onlyConfig(text, intent) {
  const allowed = new Set([...STOP, ...JOBS, ...JOBS_SV, ...MODEL_WORDS]);
  for (const note of intent?.notes || []) for (const w of String(note).toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w) allowed.add(w);
  const words = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return false;
  const left = words.filter((w) => !allowed.has(w) && !/^\d+$/.test(w));
  return left.length === 0;
}


export { routeSummary };
