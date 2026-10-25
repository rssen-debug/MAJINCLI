/**
 * MAJIN — agentturn.
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

  systemPrompt({ session, decision, turnPlan, attachments, readOnly = false }) {
    const cfg = this.cfg;
    const tools = this.registry.list({ readOnly: Boolean(readOnly) });
    const groups = [...new Set(tools.map((t) => t.group))];
    const guard = cfg.get('guard.mode');
    const now = new Date();
    return [
      `You are ${cfg.get('name')} — an agent running directly on the user's machine (Windows first). Platform ${os.platform()} ${os.arch()}, node ${process.version}. Local time ${now.toISOString().slice(0, 16).replace('T', ' ')} (${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`,
      `Workspace ${cfg.get('workspace')} · data ${dirs.root}.`,
      '',
      cfg.get('persona.identity'),
      cfg.get('persona.style'),
      cfg.get('persona.safety'),
      '',
      readOnly
        ? 'THIS TURN IS READ-ONLY: you may inspect anything, but every tool that changes state is refused. Say so plainly if the task actually needs a write.'
        : `TOOLS: all ${tools.length} are always on — there is nothing to enable. Groups: ${groups.join(', ')}.`,
      'PRIMARY RULE: finish the user’s requested outcome, not merely explain how to do it. If the goal is clear and safe, inspect the situation, act with tools, verify the result, then report what actually happened. A plan is not completion unless the user asked only for a plan.',
      'For multi-part work (more than 3 meaningful actions), call agent.plan with a short ordered checklist, then update it as work progresses. Do not spend a tool step planning simple requests.',
      'When something fails: understand the error, change the arguments or approach, and retry only when the retry is meaningfully different. Never repeat the same failed tool call unchanged. Try a useful alternative before declaring defeat; if blocked, state the exact blocker and the smallest action needed from the user.',
      'Before ending, check the requested outcome: read back changed files, inspect the browser form state, or verify the command/result as appropriate. Never claim success unless a tool confirms it. If the step budget is nearly used, stop starting new work and summarize verified progress plus what remains.',
      'Do not ask for information that is already in the conversation, attachments, workspace, config, or a safe read-only tool. Ask only when a consequential choice or genuinely missing information cannot be inferred safely.',
      'Use the best matching tools: web.fetch for static pages, browser.* for interactive pages, fs.* for files, shell.run for commands, screen.capture + vision for visual state. Independent read-only calls may run together; state-changing calls are serialized.',
      'Paths: absolute or workspace-relative. Read before overwriting; never delete something you did not create. Respect approval prompts and report when a requested action is intentionally blocked.',
      'RE: re.analyze = headers, sections+entropy, imports with risk flags, YARA, IOC strings, opcode patterns and "next steps". re.strings/re.search/re.yara/re.diff are the microscope. re.tool hooks up ghidra/rizin/objdump when they are installed on the machine.',
      'If the user describes a setting in natural language ("use X for Y always", "run moa on everything", "stop asking") → run majin.configure with the intent, or state exactly what you changed.',
      '',
      `ROUTING (job → model): ${Object.entries(routeSummary(cfg)).map(([k, v]) => `${k}:${v}`).join('  ')}`,
      `This turn: job=${decision.job} (confidence ${decision.confidence}), primary=${turnPlan.route?.ref || '?'}, ${turnPlan.moa?.enabled ? `MOA ${turnPlan.moa.width} references → aggregator ${turnPlan.moa.aggregator}` : 'MOA off for this kind of turn'}.`,
      `Guard: ${guard === 'off' ? 'OFF — no confirmations, you own the consequences' : 'asks only before irreversible actions'}.`,
      '',
      this.skills.prompt(),
      this.memory?.digest?.() || '',
      attachments?.length ? `ATTACHMENTS (already saved to disk):\n${attachments.map((a) => `- ${a.name} · ${a.kind} · ${a.size} byte${a.path ? ` · ${a.path}` : ''}${a.note ? ` · ${a.note}` : ''}`).join('\n')}` : '',
      this.plans.get(session)?.length ? `ACTIVE PLAN:\n${this.plans.get(session).map((p) => `[${p.status === 'done' ? 'x' : p.status === 'doing' ? '~' : p.status === 'blocked' ? '!' : ' '}] ${p.text}`).join('\n')}` : '',
      '',
      'Reply in English unless the user clearly writes another language. Short before long. No metadata about yourself.',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  /** A verdict-only turn is a label, not a task — spend no tokens on it. */
  maybeRate(input, session, emit) {
    if (!this.shared?.dataset?.on) return false;
    const s = String(input || '').trim().toLowerCase().replace(/[.!]+$/, '');
    if (!s || s.length > 32) return false;

    const good = /^(good|great|nice|perfect|yes|exactly|thanks|tack|bra|bra jobbat|korrekt|👍|\+1|nice one)$/.test(s);
    const bad = /^(wrong|bad|no|useless|fel|dåligt|nejs|👎|-1)$/.test(s);
    if (!good && !bad) return false;
    const r = this.shared.dataset.rate('', good ? 1 : -1);
    if (!r.ok) return false;
    const text = good
      ? `Logged as a good run (${r.id}).`
      : `Logged as a bad run (${r.id}). Tell me what was wrong and I can retry — that correction becomes part of the label.`;
    emit({ type: 'answer', text, meta: { rating: good ? 1 : -1, fastPath: true } });
    return { text, rating: good ? 1 : -1, id: r.id };
  }

  async turn({ input, session = 'desktop', attachments = [], onEvent = () => {}, history = [], source = null, readOnly = false, model = null }) {
    const cfg = this.cfg;
    const ctrl = new AbortController();
    this.abort.set(session, ctrl);
    const emit = (ev) => {
      try {
        onEvent(ev);
      } catch {
        /* a missing UI must not take the agent down */
      }
      this.bus.emit(`agent.${ev.type}`, { session, ...ev });
    };

    try {
      /* 0) a bare verdict labels the last captured turn and stops there */
      const rated = this.maybeRate(input, session, emit);
      if (rated) return { ...rated, steps: 0, tools: [], usage: null, fastPath: true };

      /* 1) natural language → direct config, no model */
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
              `Done. ${intent.notes.join(', ')}.`,
              changed.length ? changed.map((r) => `${r.job} → ${r.ref}${r.ready ? '' : '  (no key yet)'}`).join('\n') : '',
              cfg.get('moa.policy') === 'always' ? 'MOA: on — every answer goes through references + aggregator.' : '',
              'Saved in config, applies from now on.',
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
      let turnPlan = planTurn(cfg, decision);
      /* ett modelsvar från t.ex. ett schemalagt jobb måste faktiskt gälla — annars är fältet dekorering */
      if (model && /\S+\/\S+/.test(String(model))) {
        turnPlan = { ...turnPlan, route: cfg.resolveModel(String(model), decision.job), modelOverride: String(model) };
        decision = { ...decision, modelOverride: String(model) };
      }
      // inget MOA-brak mot en demo-hjarna: utan riktig nyckel ar de extra
      // samtalen bara spegelningar av samma mock, och svaret blir byggstallning
      if (cfg.needsSetup?.() && turnPlan.moa?.enabled) {
        turnPlan = { ...turnPlan, moa: { ...turnPlan.moa, enabled: false, skipped: 'setup' } };
      }
      emit({ type: 'route', job: decision.job, confidence: decision.confidence, model: turnPlan.route?.ref, moa: turnPlan.moa, reasons: decision.reasons, alt: decision.alt, tiebreak: Boolean(decision.llmTiebreak) });

      /* 3) verktygsslingan */
      const sys = this.systemPrompt({ session, decision, turnPlan, attachments, readOnly });
      const ctx = {
        ...this.shared,
        cfg,
        session,
        readOnly: Boolean(readOnly),
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
        ...(intentNote ? [{ role: 'system', content: `CONFIG CHANGED THIS TURN: ${intentNote}` }] : []),
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
      if (turnPlan.moa.enabled && !res.aborted && !res.finalizedAtLimit && !trivial) {
        const evidence = summarizeRun(res, messages);
        const moaRes = await moaRun({
          cfg,
          question: `${input}\n\nEVIDENCE FROM THIS TURN (tools, not guesses):\n${evidence}`,
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
        // en patch från naturspråk måste synas även där det bara finns text (telegram/whatsapp)
        text: intentNote && finalText && !finalText.includes(intentNote) ? `${finalText}\n\n(config: ${intentNote})` : finalText,
        steps: res.steps,
        tools: res.toolLog,
        usage: res.usage,
        job: decision.job,
        route: turnPlan.route,
        moa: moaInfo,
        escalated: res.escalated,
        incomplete: res.incomplete,
        finalizedAtLimit: res.finalizedAtLimit,
        error: res.error,
        errorKind: res.errorKind,
        errorHint: res.errorHint,
        needsKey: res.needsKey,
        contextTokens: estimateTokens(messages),
        aborted: res.aborted,
      };
      emit({ type: 'answer', text: out.text, meta: { steps: out.steps, tools: out.tools.length, moa: out.moa, job: out.job, usage: out.usage } });
      // Turn-slutsrad = träningslabel. Bara när användaren slagit på capture; redaction och
      // opt-out hanteras inne i Dataset.capture.
      try {
        const cap = this.shared?.dataset?.capture?.(input, {
          session, plan: this.plans.get(session), job: out.job, model: turnPlan.route?.ref,
          moa: out.moa ? { on: true, refs: out.moa.refs, aggregator: out.moa.aggregator } : null,
          tools: res.toolLog, text: out.text, usage: out.usage, costUsd: this.usage?.summary?.().costUsd,
          stopped: out.aborted, error: out.error ? String(out.error).slice(0, 300) : null,
        });
        if (cap?.ok) emit({ type: 'dataset', id: cap.record.id, bytes: cap.record.answer?.length });
      } catch { /* insamling får aldrig sänka ett svar */ }
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
          { role: 'system', content: 'Extract AT MOST 3 durable facts about the user or their project from this conversation. Only things that still matter tomorrow (preferences, hardware, paths, decisions). One line per fact, no prefix and no numbering. Nothing worth saving → answer exactly: NONE' },
          { role: 'user', content: `${String(input).slice(0, 800)}\n\nTOOLS: ${res.toolLog.map((t) => `${t.tool}:${t.ok ? 'ok' : 'errors'}`).join(', ').slice(0, 600)}\n\nANSWER: ${String(res.text).slice(0, 1500)}` },
        ],
      });
      const text = String(r.text || '').trim();
      if (!text || /^(NONE|TOMT)$/i.test(text)) return [];
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
  const head = attachments.map((a) => `[attachment ${a.name} · ${a.kind} · ${a.size}${a.path ? ` · path ${a.path}` : ''}]`).join('\n');
  return `${head}\n\n${input}`.trim();
}

function summarizeRun(res, messages) {
  const lines = [];
  for (const t of res.toolLog.slice(-14)) lines.push(`- ${t.tool}: ${t.ok ? 'ok' : 'FAILED'} — ${String(t.summary || '').slice(0, 220)}`);
  const last = [...messages].reverse().find((m) => m.role === 'assistant')?.content;
  if (last) lines.push(`- draft answer: ${String(last).slice(0, 1200)}`);
  return lines.join('\n') || '(no tools run)';
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
    name: `flow: ${name}`,
    when: firstLine(input).slice(0, 120),
    tools: uniq.slice(0, 8),
    steps: `Executed sequence (${res.steps} steps):\n${uniq.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nNotera: generated by MAJIN after a successful run — refine as needed.`,
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
