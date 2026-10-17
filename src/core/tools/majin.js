/**
 * MAJIN — agentens egen kontrollpanel.
 * Allt som finns i config filen kan agenten ändra, med validering + backup.
 * Ett enda verktyg (majin.configure) räcker för resten; de andra är genvägar.
 */
import fs from 'node:fs';
import os from 'node:os';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { def } from './registry.js';
import { validatePatch, JOBS } from '../config.js';
import { parseIntent } from '../routes.js';
import { PRESETS, listModelsUrl } from '../presets.js';
import { complete } from '../provider/chat.js';
import { dirs } from '../paths.js';
import { bus } from '../log.js';
import { detect as detectRe } from '../binary/external.js';

const mask = (v) => (!v ? '' : v.length <= 6 ? '•••' : `${v.slice(0, 3)}…${v.slice(-2)}`);

export const majinTools = [
  def({
    name: 'majin.configure',
    group: 'majin',
    risk: 'write',
    desc: 'Ändra LENTs egen config (routes, moa, providers, channels, guard, agent, tools, ui, budget, persona). Validerad JSON-patch; ogiltig patch avvisas med skäl. Använd intent för naturallyspråk.',
    params: {
      patch: 'object: JSON-patch av config-trädet, t.ex. {"models":{"routes":{"code":"deepseek/deepseek-v4-pro"}}}',
      intent: 'string: en instruktion på vanligt språk som översätts till patch, t.ex. "använd deepseek pro för kod alltid"',
      dry: 'boolean: visa diff utan att spara',
      note: 'string: varför ändringen görs (hamnar i loggen)',
    },
    examples: ['majin.configure({intent:"använd deepseek flash för tasks alltid"})', 'majin.configure({patch:{moa:{policy:"hard"}}})'],
    async run({ patch = null, intent = '', dry = false, note = '' }, ctx) {
      let payload = patch;
      let notes = [];
      if (intent && (!patch || (typeof patch === 'object' && !Object.keys(patch).length))) {
        const r = parseIntent(intent, ctx.cfg);
        if (!r.matched) return { ok: false, error: { code: 'no_intent', message: `kunde inte översätta "${String(intent).slice(0, 80)}" till en config-ändring`, hint: 'använd patch med explicit JSON i stället' } };
        payload = r.patch;
        notes = r.notes;
      }
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (err) {
          return { ok: false, error: { code: 'bad_json', message: `patch är inte json: ${err.message}` } };
        }
      }
      if (!payload || typeof payload !== 'object' || !Object.keys(payload).length) return { ok: false, error: { code: 'empty', message: 'varken patch eller intent gav något att ändra' } };
      const errors = validatePatch(payload, ctx.cfg.data);
      if (errors.length) return { ok: false, error: { code: 'invalid_config', message: errors.map((e) => `${e.path}: ${e.msg}`).join('; '), hint: 'rätt format: providers={<namn>:{baseUrl,apiKey,kind}}, models.routes={<jobb>:"provider/model"}' } };
      const applied = ctx.cfg.patch(payload, { dry, source: `tool${note ? `:${note}` : ''}` });
      if (!applied.ok) return { ok: false, error: { code: 'rejected', message: applied.errors.map((e) => `${e.path}: ${e.msg}`).join('; ') } };
      const diff = applied.diff.map((x) => `${dry ? '?' : '✓'} ${x.path}: ${short(x.from)} → ${short(x.to)}`).join('\n');
      return {
        result: `${dry ? 'DRY-RUN' : 'Tillämpat'} (${ctx.cfg.file})${notes.length ? `\nIntent: ${notes.join(', ')}` : ''}\n${diff}\n\nNuläge:\n${routeLines(ctx)}`,
        meta: { diff: applied.diff, dry, file: ctx.cfg.file },
        summary: `${dry ? 'torr' : 'sparad'} config-ändring (${applied.diff.length} värden)`,
      };
    },
  }),

  def({
    name: 'majin.routes',
    group: 'majin',
    risk: 'write',
    desc: 'Modellrouting: visa, sätt eller testa jobben (chat, tasks, tools, code, re, research, plan, analysis, final, summarize, aggregator, router, vision).',
    params: {
      action: 'string: show | set | test | show_all [show|set|test|show_all]',
      job: 'string: vilket jobb (krävs för set)',
      model: 'string: "provider/model" (krävs för set)',
      all: 'boolean: sätt samma modell på alla jobb',
      note: 'string: varför',
    },
    examples: ['majin.routes({action:"set",job:"code",model:"deepseek/deepseek-v4-pro"})'],
    async run({ action = 'show', job = '', model = '', all = false, note = '' }, ctx) {
      if (action === 'show_all' || action === 'show') {
        const t = ctx.cfg.routeTable();
        return { result: `Routing (${ctx.cfg.get('moa.policy') === 'always' ? 'MOA: alltid' : ctx.cfg.get('moa.policy') === 'hard' ? 'MOA: svåra jobb' : 'MOA: av'}):\n${t.map((r) => `${r.ready ? '✓' : '·'} ${r.job.padEnd(11)} ${r.ref}${r.ready ? '' : '  ← ingen nyckel'}`).join('\n')}\n\nProvider:\n${providerLines(ctx)}`, meta: { table: t }, summary: `${t.length} routes` };
      }
      if (action === 'set') {
        if (!model) return { ok: false, error: { code: 'no_model', message: 'ange model som "provider/model"' } };
        const [pname] = String(model).split('/');
        if (!ctx.cfg.get(`providers.${pname}`)) return { ok: false, error: { code: 'unknown_provider', message: `okänd provider "${pname}"`, hint: `kända: ${Object.keys(ctx.cfg.get('providers') || {}).join(', ')} — lägg till med majin.provider` } };
        const routes = {};
        if (all) for (const j of JOBS) routes[j] = model;
        else {
          if (!job) return { ok: false, error: { code: 'no_job', message: `ange jobb: ${JOBS.join(', ')}` } };
          routes[job] = model;
        }
        const res = ctx.cfg.patch({ models: { routes } }, { source: `routes:${note || ''}` });
        if (!res.ok) return { ok: false, error: { code: 'invalid', message: res.errors.map((e) => `${e.path}: ${e.msg}`).join('; ') } };
        return { result: `satte ${Object.keys(routes).length} route(r) → ${model}\n${routeLines(ctx)}`, summary: `route ${job || 'alla'} → ${model}` };
      }
      if (action === 'test') {
        const route = ctx.cfg.resolveModel(model || ctx.cfg.get(`models.routes.${job || 'tasks'}`), job || 'tasks');
        if (route.kind !== 'mock' && !route.apiKey) return { ok: false, error: { code: 'no_key', message: `${route.providerName} har ingen nyckel` } };
        const t0 = Date.now();
        try {
          const r = await complete({ route, job: 'test', stream: false, maxTokens: 24, temperature: 0, messages: [{ role: 'user', content: 'Svara med exakt: OK' }] });
          return { result: `${route.ref} svarade på ${Date.now() - t0}ms: "${(r.text || '').trim().slice(0, 60)}" (tokens ${r.usage.input}/${r.usage.output})`, summary: `${route.ref} OK` };
        } catch (err) {
          return { ok: false, error: { code: 'provider_failed', message: err.message, hint: err.hint || null }, result: `${route.ref} FALSADE efter ${Date.now() - t0}ms: ${err.message}` };
        }
      }
      return { ok: false, error: { code: 'bad_action', message: `action ${action} finns inte`, hint: 'show | set | test | show_all' } };
    },
  }),

  def({
    name: 'majin.provider',
    group: 'majin',
    risk: 'write',
    desc: 'Hantera providers: list | add | remove | test | models (lista tillgängliga modeller från /models).',
    params: {
      action: 'string: list | add | remove | test | models [list|add|remove|test|models]',
      name: 'string: providernamn (nyckel i config)',
      preset: 'string: använd en förinställning (deepseek, openrouter, groq, openai, anthropic, nous, ollama, lmstudio, mock)',
      baseUrl: 'string: https://…',
      apiKey: 'string: sk-…  (sparas i config på disk)',
      env: 'string: i stället för nyckel — spara som {env:VAR}',
      models: 'string: komma-separerade modellnamn',
      kind: 'string: openai | anthropic | mock [openai|anthropic|mock]',
    },
    examples: ['majin.provider({action:"add",name:"deepseek",apiKey:"sk-…"})'],
    async run({ action = 'list', name = '', preset = '', baseUrl = '', apiKey = '', env = '', models = null, kind = '' }, ctx) {
      const providers = { ...ctx.cfg.get('providers') };
      if (action === 'list') {
        return { result: `providers:\n${Object.entries(providers).map(([k, p]) => `  ${k}: ${p.kind || 'openai'} ${p.baseUrl} nyckel=${p.apiKey ? mask(p.apiKey) : 'SAKNAS'} modeller=${(p.models || []).join(', ') || '-'}`).join('\n')}\n\nförinställningar: ${Object.keys(PRESETS).join(', ')}`, meta: providers, summary: `${Object.keys(providers).length} providers` };
      }
      if (action === 'models') {
        const p = providers[name];
        if (!p) return { ok: false, error: { code: 'no_provider', message: `okänd provider ${name}` } };
        const url = listModelsUrl({ kind: p.kind, baseUrl: p.baseUrl });
        if (!url) return { ok: false, error: { code: 'unsupported', message: `${p.kind} har inget /models-endpoint`, hint: 'ange modeller manuellt' } };
        const r = await fetch(url, { headers: { authorization: `Bearer ${p.apiKey}` } }).catch((e) => ({ ok: false, err: e }));
        if (!r.ok) return { ok: false, error: { code: 'list_failed', message: (r.err?.message || `HTTP ${r.status}`), hint: 'kontrollera nyckel och baseUrl' } };
        const j = await r.json().catch(() => ({}));
        const ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
        await ctx.cfg.patch({ providers: { [name]: { models: ids.slice(0, 400) } } });
        return { result: `${name}: ${ids.length} modeller (sparade ${Math.min(400, ids.length)} i config)\n${ids.slice(0, 120).join('\n')}`, summary: `${ids.length} modeller` };
      }
      if (action === 'add') {
        if (!name) return { ok: false, error: { code: 'no_name', message: 'ange name' } };
        const base = PRESETS[preset || name] || {};
        const entry = {
          label: base.label || name,
          kind: kind || base.kind || 'openai',
          baseUrl: baseUrl || base.baseUrl || '',
          apiKey: env ? `{env:${env}}` : apiKey || base.apiKey || '',
          models: models ? String(models).split(',').map((x) => x.trim()).filter(Boolean) : base.models || [],
        };
        if (entry.kind !== 'mock' && !entry.baseUrl) return { ok: false, error: { code: 'no_url', message: 'baseUrl krävs (eller välj ett preset)' } };
        const res = ctx.cfg.patch({ providers: { [name]: entry } }, { source: 'provider.add' });
        if (!res.ok) return { ok: false, error: { code: 'invalid', message: res.errors.map((e) => `${e.path}: ${e.msg}`).join('; ') } };
        const routes = { ...(ctx.cfg.get('models.routes') || {}) };
        const first = entry.models[0];
        if (first) {
          for (const j of ['chat', 'tasks', 'tools', 'summarize', 'router', 'vision']) routes[j] = `${name}/${first}`;
          const strong = entry.models.find((m) => /pro|max|think|reason|sonnet|opus|5\.|4\./.test(m)) || first;
          for (const j of ['code', 're', 'analysis', 'plan', 'research', 'final', 'aggregator']) routes[j] = `${name}/${strong}`;
          await ctx.cfg.patch({ models: { routes, provider: name } });
        }
        bus.info('provider.add', { name, kind: entry.kind, baseUrl: entry.baseUrl });
        return { result: `lade till ${name} (${entry.kind} ${entry.baseUrl}) och rutade ${first ? `${entry.models.length} förslag` : 'ingen modell'} →\n${routeLines(ctx)}\n\nTesta: majin.routes({action:"test",model:"${name}/${first || '?'}"})`, summary: `provider ${name} tillagd` };
      }
      if (action === 'remove') {
        const { [name]: gone, ...rest } = providers;
        void gone;
        ctx.cfg.patch({ providers: rest });
        return { result: `tog bort ${name}. Kvar: ${Object.keys(rest).join(', ')}`, summary: `provider ${name} bort` };
      }
      if (action === 'test') {
        const p = providers[name] || {};
        const route = ctx.cfg.resolveModel(`${name}/${(p.models || ['x'])[0]}`, 'test');
        const t0 = Date.now();
        try {
          const r = await complete({ route, job: 'test', stream: false, maxTokens: 16, temperature: 0, messages: [{ role: 'user', content: 'svara OK' }] });
          return { result: `${name} OK (${Date.now() - t0}ms): ${(r.text || '').trim().slice(0, 40)}`, summary: `${name} svarar` };
        } catch (err) {
          return { ok: false, error: { code: 'provider_failed', message: err.message, hint: err.hint }, summary: `${name} svarar inte` };
        }
      }
      return { ok: false, error: { code: 'bad_action', message: action } };
    },
  }),

  def({
    name: 'majin.moa',
    group: 'majin',
    risk: 'write',
    desc: 'Mixture-of-Agents: show | on | off | hard (bara svåra jobb) | set (references/aggregator/width). Alt är på.',
    params: {
      action: 'string: show | on | off | hard | set [show|on|off|hard|set]',
      references: 'array: [{"model":"provider/model","temperature":0.3}]',
      aggregator: 'string: provider/model som sammanför',
      width: 'number: hur många referenser som körs',
    },
    async run({ action = 'show', references = null, aggregator = '', width = 0 }, ctx) {
      const m = ctx.cfg.get('moa');
      if (action === 'show') {
        return { result: `MOA: ${m.enabled ? 'PÅ' : 'av'} (policy=${m.policy}, bredd=${m.width})\nreferenser:\n${(m.references || []).map((r, i) => `  ${i + 1}. ${r.model} (temp ${r.temperature ?? '-'})`).join('\n')}\naggregator: ${m.aggregator}\nsvåra jobb: ${(m.hardJobs || []).join(', ')}\nenighetsgolv: ${m.disagreementFloor}`, meta: m, summary: `MOA ${m.enabled ? m.policy : 'off'}` };
      }
      if (action === 'on') return done(ctx, { moa: { enabled: true, policy: 'always' } }, 'MOA på — alla svar går genom referenser + aggregator');
      if (action === 'off') return done(ctx, { moa: { enabled: false, policy: 'off' } }, 'MOA av');
      if (action === 'hard') return done(ctx, { moa: { enabled: true, policy: 'hard' } }, 'MOA körs bara på svåra jobb (re/code/plan/research/final)');
      const patch = { moa: { enabled: true, policy: m.policy === 'off' ? 'always' : m.policy } };
      if (references) patch.moa.references = (Array.isArray(references) ? references : []).map((r) => (typeof r === 'string' ? { model: r } : r));
      if (aggregator) patch.moa.aggregator = aggregator;
      if (width) patch.moa.width = Math.max(1, Math.min(8, Number(width)));
      return done(ctx, patch, `MOA uppdaterad: ${Object.entries(patch.moa).map(([k, v]) => `${k}=${Array.isArray(v) ? v.map((x) => x.model || x).join('|') : v}`).join(', ')}`);
    },
  }),

  def({
    name: 'majin.guard',
    group: 'majin',
    risk: 'write',
    desc: 'Säkerhetsglaset: status | mode(confirm|strict|off) | allow(verktyg) | disallow. Agenten kan INTE godkänna sina egna farliga åtgärder — det gör alltid människan.',
    params: { action: 'string: status | mode | allow | disallow [status|mode|allow|disallow]', mode: 'string: confirm | strict | off', tool: 'string: verktygsnamn' },
    async run({ action = 'status', mode = '', tool = '' }, ctx) {
      const g = ctx.cfg.get('guard');
      if (action === 'status') {
        return {
          result: `guard: ${g.mode}\nautoApprove: ${(g.autoApprove || []).join(', ') || 'ingen'}\nskyddade sökvägar: ${(g.protectedPaths || []).join(', ')}\nfråga-mönster: ${g.askOn.length}\nalltid-nekade: ${g.neverOn.length}\n\nväntande godkännanden: ${ctx.approvals?.list().length || 0}${(ctx.approvals?.list() || []).map((a) => `\n  ${a.id} ${a.tool} — ${a.reason}`).join('') || ''}`,
          meta: g,
          summary: `guard ${g.mode}`,
        };
      }
      if (action === 'mode') {
        if (!['confirm', 'strict', 'off'].includes(mode)) return { ok: false, error: { code: 'bad_mode', message: 'mode: confirm | strict | off' } };
        return done(ctx, { guard: { mode } }, `guard = ${mode}${mode === 'off' ? ' — nu körs även irreversible åtgärder utan att fråga' : ''}`);
      }
      if (action === 'allow') {
        const list = [...new Set([...(g.autoApprove || []), tool])].filter(Boolean);
        return done(ctx, { guard: { autoApprove: list } }, `${tool} auto-godkänns nu (${list.length} i listan)`);
      }
      if (action === 'disallow') {
        const list = (g.autoApprove || []).filter((x) => x !== tool);
        return done(ctx, { guard: { autoApprove: list } }, `${tool} kräver igen (${list.length} i listan)`);
      }
      return { ok: false, error: { code: 'bad_action', message: action } };
    },
  }),

  def({
    name: 'majin.memory',
    group: 'majin',
    risk: 'write',
    desc: 'Långtidshamnet: remember(text) | recall(query) | forget(query) | list | clear. Agenten sparar preferenser, projekt och lösningar här.',
    params: { action: 'string: remember | recall | forget | list | clear [remember|recall|forget|list|clear]', text: 'string: vad som ska minnas', query: 'string: vad du letar efter', tags: 'array: taggar' },
    async run({ action = 'list', text = '', query = '', tags = [] }, ctx) {
      const m = ctx.memory;
      if (action === 'remember') {
        if (!text) return { ok: false, error: { code: 'no_text', message: 'text saknas' } };
        const r = m.remember(text, Array.isArray(tags) ? tags : [String(tags)]);
        return { result: `${r.ok ? 'sparat' : 'kunde inte spara'} i minnet (${r.count} poster totalt)${r.replaced ? `\nersatte: ${r.replaced}` : ''}\n${m.facts().slice(0, 8).map((f) => `- ${f}`).join('\n')}`, summary: 'minne uppdaterat' };
      }
      if (action === 'recall') {
        const hits = m.recall(query || text || '', 10);
        return { result: hits.length ? hits.map((h) => `[${h.score.toFixed(2)}] ${h.text}`).join('\n') : `inga minnen matchar "${query}"`, meta: { hits: hits.length }, summary: `${hits.length} minnen` };
      }
      if (action === 'forget') return { result: `tog bort ${(m.forget(query || text || '') || {}).removed} minnesrader`, summary: 'glömde' };
      if (action === 'clear') {
        fs.writeFileSync(m.factsFile, '# Minnen\n\n');
        return { result: 'minnet tömt (facts.md). Historik och loggar är kvar.', summary: 'minne tömt' };
      }
      const f = m.facts();
      return { result: `${f.length} minnen (${m.dir}):\n${f.slice(0, 40).map((x) => `- ${x}`).join('\n')}\n\nstatistik: ${JSON.stringify(m.stats())}`, meta: m.stats(), summary: `${f.length} minnen` };
    },
  }),

  def({
    name: 'majin.skill',
    group: 'majin',
    risk: 'write',
    desc: 'Inlärda färdigheter (markdown i data/skills): list | save | read | delete | match. En färdighet = hur en typ av uppgift görs, steg för steg.',
    params: { action: 'string: list | save | read | delete | match [list|save|read|delete|match]', name: 'string: namn', when: 'string: när den ska användas', steps: 'string: stegen (markdown)', tools: 'array: verktyg den använder', query: 'string: för match' },
    async run({ action = 'list', name = '', when = '', steps = '', tools = '', query = '' }, ctx) {
      const s = ctx.skills;
      if (action === 'save') {
        if (!name || !steps) return { ok: false, error: { code: 'incomplete', message: 'name + steps krävs' } };
        const r = s.save({ name, when, steps, tools });
        return { result: `sparade färdighet "${name}" → ${r.file}`, summary: `skill ${name} sparad` };
      }
      if (action === 'delete') {
        try {
          await fsp.unlink(path.join(s.dir, `${name}.md`));
          return { result: `tog bort ${name}`, summary: `skill ${name} bort` };
        } catch (err) {
          return { ok: false, error: { code: 'delete_failed', message: err.message } };
        }
      }
      if (action === 'read') {
        try {
          return { result: fs.readFileSync(path.join(s.dir, `${name}.md`), 'utf8') };
        } catch {
          return { ok: false, error: { code: 'not_found', message: `ingen ${name}.md` } };
        }
      }
      if (action === 'match') {
        const hits = s.match(query || '', 5);
        return { result: hits.length ? hits.map((h) => `${h.name} (${h.score}) — ${h.when}`).join('\n') : 'inga matchande färdigheter', meta: { hits: hits.length }, summary: `${hits.length} match` };
      }
      const list = s.list();
      return { result: `${list.length} färdigheter i ${s.dir}:\n${list.map((x) => `- ${x.name}${x.when ? ` — ${x.when}` : ''}${x.tools ? ` [${x.tools}]` : ''}`).join('\n') || '(tom)'}`, meta: { count: list.length }, summary: `${list.length} skills` };
    },
  }),

  def({
    name: 'majin.schedule',
    group: 'majin',
    risk: 'write',
    desc: 'Schemalagt arbete: add | list | remove | run | pause | resume. Anrop som "varje morgon 07:30: gör X och skicka till telegram" ska hamna här.',
    params: {
      action: 'string: add | list | remove | run | pause | resume [add|list|remove|run|pause|resume]',
      id: 'string: jobb-id (för remove/pause/run)',
      when: 'string: "07:30 daily" | "every 30m" | "*/15 * * * *" | "2026-01-01T09:00"',
      task: 'string: vad som ska köras (hela prompten)',
      deliver: 'string: telegram | whatsapp | silent (var svaret skickas)',
      model: 'string: valfri route/apping för jobbet',
    },
    examples: ['majin.schedule({action:"add",when:"07:30 daily",task:"Korta morgonrapporten: vädret, mina ärenden, nya security-ADS. Skicka till telegram"})'],
    async run({ action = 'list', id = '', when = '', task = '', deliver = 'silent', model = '' }, ctx) {
      const sch = ctx.scheduler;
      if (!sch) return { ok: false, error: { code: 'no_scheduler', message: 'schemaläggaren kör inte (server-läge krävs)' } };
      if (action === 'add') {
        if (!when || !task) return { ok: false, error: { code: 'incomplete', message: 'when + task krävs' } };
        try {
          const job = sch.add({ when, task, deliver, model, name: id });
          return { result: `schemalade "${job.name}" (${job.when}) → ${job.nextRun} (nästa: ${job.nextRunHuman})\nid=${job.id} leverans=${job.deliver}`, meta: job, summary: `jobb ${job.name} schemalagt` };
        } catch (err) {
          return { ok: false, error: { code: 'bad_schedule', message: err.message, hint: 'exempel: "07:30 daily", "every 30m", "*/15 * * * *"' } };
        }
      }
      if (action === 'remove') return { result: sch.remove(id) ? `tog bort ${id}` : `hittade inte ${id}`, summary: 'jobb bort' };
      if (action === 'pause' || action === 'resume') return { result: sch.setPaused(id, action === 'pause') ? `${action}d ${id}` : `hittade inte ${id}` };
      if (action === 'run') {
        const r = await sch.runNow(id);
        return r?.error ? { ok: false, error: { code: 'run_failed', message: r.error } } : { result: `körde ${id}: ${String(r.text).slice(0, 2000)}`, summary: `jobb ${id} körd` };
      }
      const jobs = sch.list();
      return { result: `${jobs.length} schemalagda jobb (enabled=${sch.enabled}):\n${jobs.map((j) => `- ${j.id} "${j.name}" ${j.when}${j.paused ? ' [PAUSAD]' : ''}\n    nästa: ${j.nextRun || '?'} | förra: ${j.lastRun || 'aldrig'} ${j.lastStatus || ''}\n    uppgift: ${String(j.task).slice(0, 100)}`).join('\n') || '(inga)'}`, meta: { jobs }, summary: `${jobs.length} jobb` };
    },
  }),

  def({
    name: 'majin.channel',
    group: 'majin',
    risk: 'write',
    desc: 'Kanaler: status | telegram | whatsapp | send | pair. Sätter bot-nycklar, kopplar enheter och skickar meddelanden.',
    params: {
      action: 'string: status | telegram | whatsapp | send | pair | unpair [status|telegram|whatsapp|send|pair|unpair]',
      token: 'string: Telegram bot-token (123456:ABC…)',
      transport: 'string: baileys | cloud (WhatsApp) [baileys|cloud]',
      phoneNumberId: 'string: WhatsApp Cloud API phone-number-id',
      accessToken: 'string: WhatsApp Cloud API token',
      verifyToken: 'string: valfri sträng för webhook-verifiering',
      to: 'string: dit (chat-id eller telefonnummer)',
      text: 'string: meddelandets innehåll',
      channel: 'string: telegram | whatsapp',
      enable: 'boolean: starta/stoppa kanalen',
    },
    examples: ['majin.channel({action:"telegram",token:"123:ABC",enable:true})'],
    async run({ action = 'status', token = '', transport = '', phoneNumberId = '', accessToken = '', verifyToken = '', to = '', text = '', channel = '', enable = null }, ctx) {
      const ch = ctx.channels;
      if (action === 'status') {
        const s = ch?.status?.() || {};
        return {
          result: `KANALER\n${Object.entries(s).map(([k, v]) => `${v.online ? '✓' : '·'} ${k}: ${v.state}${v.detail ? ` — ${v.detail}` : ''}`).join('\n') || '(inga)'}\n\nwhatsapp transport: ${ctx.cfg.get('channels.whatsapp.transport')}\ntelegram tillåtna chat: ${(ctx.cfg.get('channels.telegram.allowedChatIds') || []).join(', ') || '(inga — para ihop först)'}\nwebhook för WhatsApp Cloud: http://<din-ip>:${ctx.cfg.get('server.port')}/whatsapp (verify-token = ${ctx.cfg.get('channels.whatsapp.cloud.verifyToken') || 'inte satt'})`,
          meta: s,
          summary: Object.entries(s).map(([k, v]) => `${k}:${v.state}`).join(' ') || 'inga kanaler',
        };
      }
      if (action === 'telegram') {
        const patch = { channels: { telegram: { enabled: enable !== false } } };
        if (token) patch.channels.telegram.botToken = token;
        const res = ctx.cfg.patch(patch, { source: 'channel.telegram' });
        if (!res.ok) return { ok: false, error: { code: 'invalid', message: res.errors.map((e) => `${e.path}: ${e.msg}`).join('; ') } };
        const ok = await ch?.telegram?.start?.();
        const me = await ch?.telegram?.getMe?.();
        return { result: ok ? `telegram uppgick (@${me?.username || me?.first_name}) — skicka "/start ${ch?.telegram?.pairingCode || ''}" till botten för att para ihop dig` : `sparade, men polling kunde inte starta: ${ch?.telegram?.lastError || 'okänt fel'}`, summary: ok ? 'telegram ansluten' : 'telegram fel' };
      }
      if (action === 'whatsapp') {
        const patch = { channels: { whatsapp: { enabled: enable !== false, transport: transport || ctx.cfg.get('channels.whatsapp.transport') || 'baileys' } } };
        if (accessToken) patch.channels.whatsapp.cloud = { ...(ctx.cfg.get('channels.whatsapp.cloud') || {}), accessToken };
        if (phoneNumberId) patch.channels.whatsapp.cloud = { ...(ctx.cfg.get('channels.whatsapp.cloud') || {}), phoneNumberId };
        if (verifyToken) patch.channels.whatsapp.cloud = { ...(ctx.cfg.get('channels.whatsapp.cloud') || {}), verifyToken };
        const res = ctx.cfg.patch(patch, { source: 'channel.whatsapp' });
        if (!res.ok) return { ok: false, error: { code: 'invalid', message: res.errors.map((e) => `${e.path}: ${e.msg}`).join('; ') } };
        const ok = await ch?.whatsapp?.start?.();
        const qr = ch?.whatsapp?.qr?.() || null;
        return {
          result: `${ok ? 'whatsapp igång' : 'whatsapp kunde inte starta'} (transport ${patch.channels.whatsapp.transport})${qr ? `\nQR att skanna (länk-kod): ${qr}` : ''}${!ok && !qr ? `\n${ch?.whatsapp?.lastError || 'okänt fel — kolla att optionalDependencies är installerade (npm i)'}` : ''}`,
          meta: { qr, transport: patch.channels.whatsapp.transport },
          summary: ok ? 'whatsapp igång' : 'whatsapp stoppad',
        };
      }
      if (action === 'send') {
        const target = to || (channel === 'whatsapp' ? undefined : ctx.cfg.get('channels.telegram.allowedChatIds')?.[0]);
        if (!text) return { ok: false, error: { code: 'no_text', message: 'text saknas' } };
        if (!target) return { ok: false, error: { code: 'no_target', message: 'ange to (chat-id eller tel.nr)' } };
        const r = await ch?.send?.(channel || 'telegram', target, text);
        return r?.ok ? { result: `skickat till ${channel || 'telegram'}:${target}`, summary: 'meddelande skickat' } : { ok: false, error: { code: 'send_failed', message: r?.error || 'ingen kanal aktiv' } };
      }
      if (action === 'pair') {
        const code = ch?.pair?.(channel || 'telegram', to);
        return { result: code ? `parningskod ${code} — användaren skickar "pair ${code}" till botten` : 'parning stöds inte för den kanalen' };
      }
      if (action === 'unpair') {
        const list = (ctx.cfg.get('channels.telegram.allowedChatIds') || []).filter((x) => String(x) !== String(to));
        ctx.cfg.patch({ channels: { telegram: { allowedChatIds: list } } });
        return { result: `tog bort ${to} från tillåtna (${list.length} kvar)` };
      }
      return { ok: false, error: { code: 'bad_action', message: action } };
    },
  }),

  def({
    name: 'majin.status',
    group: 'majin',
    risk: 'read',
    desc: 'Full status: config, routes, MOA, kanaler, externa RE-verktyg, budget, minne, färdigheter, jobb, loggsökväg. Används när användaren frågar "hur mår du?".',
    params: { verbose: 'boolean: med allt' },
    async run({ verbose = false }, ctx) {
      const cfg = ctx.cfg;
      const re = await detectRe({}).catch(() => ({}));
      const u = ctx.usage?.summary?.() || {};
      const out = {
        version: '0.1.0',
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        uptimeS: Math.round(process.uptime()),
        pid: process.pid,
        workspace: cfg.get('workspace'),
        config: cfg.file,
        dataDir: dirs.root,
        providers: ctx.statusProviders(),
        routes: Object.fromEntries(cfg.routeTable().map((r) => [r.job, `${r.ref}${r.ready ? '' : ' (no key)'}`])),
        moa: cfg.get('moa'),
        guard: { mode: cfg.get('guard.mode'), autoApprove: cfg.get('guard.autoApprove') },
        tools: { total: ctx.registry.tools.length, groups: Object.keys(ctx.registry.groups()).length, filter: cfg.get('tools.allow') },
        channels: ctx.channels?.status?.() || {},
        reTools: Object.fromEntries(Object.entries(re).map(([k, v]) => [k, v.available ? v.path : 'saknas'])),
        memory: ctx.memory?.stats?.(),
        skills: ctx.skills?.list?.().length,
        schedule: { jobs: ctx.scheduler?.list?.().length ?? 0, enabled: ctx.scheduler?.enabled },
        usage: u,
        approvals: (ctx.approvals?.list?.() || []).map((a) => ({ id: a.id, tool: a.tool, reason: a.reason })),
      };
      if (!verbose) {
        for (const k of ['moa', 'tools', 'reTools', 'memory']) delete out[k];
      }
      return { result: JSON.stringify(out, null, 1), meta: out, summary: `routes ${Object.keys(out.routes).length} · uppgick ${out.channels ? Object.values(out.channels).filter((c) => c.online).length : 0} kanaler · ${out.usage.requests || 0} anrop ${out.usage.costUsd || 0} USD` };
    },
  }),

  def({
    name: 'majin.selftest',
    group: 'majin',
    risk: 'read',
    desc: 'Diagnostik: provider-nycklar, en verklig minianrop per provider, verktygsregister, RE-kontroll på en egen binär, kanalstatus, port, skrivbarhet. Kör detta när något beter sig konstigt.',
    params: { level: 'string: quick | full [quick|full]' },
    async run({ level = 'quick' }, ctx) {
      const out = [];
      const push = (ok, label, detail = '') => out.push(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
      try {
        fs.accessSync(ctx.cfg.file, fs.constants.R_OK | fs.constants.W_OK);
        push(true, 'config skrivbar', ctx.cfg.file);
      } catch (e) {
        push(false, 'config skrivbar', e.message);
      }
      const routes = ctx.cfg.routeTable();
      const ready = routes.filter((r) => r.ready);
      push(ready.length > 0, 'providers med nyckel', ready.map((r) => r.provider).filter(unique).join(', ') || 'INGEN — sätt en nyckel');
      if (level === 'full' && ready.length) {
        for (const p of [...new Set(ready.map((r) => r.provider))]) {
          const route = ctx.cfg.resolveModel(ctx.cfg.get('models.routes.tasks').startsWith(`${p}/`) ? ctx.cfg.get('models.routes.tasks') : `${p}/${(ctx.cfg.get(`providers.${p}.models`) || [])[0]}`, 'test');
          const t0 = Date.now();
          try {
            const r = await complete({ route, job: 'selftest', stream: false, maxTokens: 12, temperature: 0, messages: [{ role: 'user', content: 'Svara exakt: OK' }] });
            push(true, `anrop ${route.ref}`, `${Date.now() - t0}ms "${(r.text || '').trim().slice(0, 20)}"`);
          } catch (err) {
            push(false, `anrop ${route.ref}`, `${err.message.slice(0, 120)}`);
          }
        }
      }
      const n = ctx.registry.tools.length;
      push(n > 20, 'verktygsregister', `${n} verktyg, alla på (filter: ${ctx.cfg.get('tools.allow') === '*' ? 'av' : 'på'})`);
      try {
        const self = fs.readFileSync(process.execPath);
        const { analyze } = await import('../binary/index.js');
        const r = analyze(self.subarray(0, 4_000_000), { name: 'node', rules: [] });
        push(true, 'RE-motorn', `läste node (${r.kind}, ${r.sections?.length || 0} sektioner, ${r.importCount || 0} imports)`);
      } catch (err) {
        push(false, 'RE-motorn', err.message);
      }
      const re = await detectRe({}).catch(() => ({}));
      push(true, 'externa RE-verktyg', Object.values(re).filter((v) => v.available).map((v) => v.label.split(' ')[0]).join(', ') || 'inga (ingen nödvändig)');
      const st = ctx.channels?.status?.() || {};
      for (const [k, v] of Object.entries(st)) push(v.online !== false && v.state !== 'error', `kanal ${k}`, v.detail || v.state);
      const port = ctx.cfg.get('server.port');
      push(true, 'ui-port', `http://127.0.0.1:${port} (token i config, maskad)`);
      try {
        fs.mkdirSync(ctx.cfg.get('workspace'), { recursive: true });
        fs.accessSync(ctx.cfg.get('workspace'), fs.constants.W_OK);
        push(true, 'workspace skrivbar', ctx.cfg.get('workspace'));
      } catch (e) {
        push(false, 'workspace skrivbar', e.message);
      }
      const fails = out.filter((l) => l.startsWith('✗')).length;
      return { result: `Självtest ${level} (${fails} fel):\n${out.join('\n')}`, ok: fails === 0, meta: { fails }, summary: fails ? `${fails} fel i självtest` : 'allt grönt' };
    },
  }),

  def({
    name: 'majin.tools',
    group: 'majin',
    risk: 'read',
    desc: 'Lista alla verktyg med beskrivning och risknivå. Alltid alla på — det finns ingen avstängningsknapp.',
    params: { group: 'string: filtrera på grupp', describe: 'string: skrivverktygsnamn för full beskrivning' },
    async run({ group = '', describe = '' }, ctx) {
      if (describe) {
        const t = ctx.registry.byName.get(describe);
        if (!t) return { ok: false, error: { code: 'no_tool', message: `inget verktyg ${describe}`, hint: ctx.registry.list().map((x) => x.name).slice(0, 20).join(', ') } };
        return { result: `${t.name} [${t.risk}] — ${t.desc}\nparametrar:\n${JSON.stringify(t.parameters, null, 1)}${t.examples?.length ? `\n\nexempel:\n${t.examples.join('\n')}` : ''}`, summary: t.name };
      }
      const groups = ctx.registry.groups();
      const body = Object.entries(groups)
        .filter(([g]) => !group || g.includes(group))
        .map(([g, list]) => `${g} (${list.length}):\n${list.map((t) => `  ${t.name.padEnd(18)} ${t.risk.padEnd(12)} ${t.desc.split('. ')[0].slice(0, 110)}`).join('\n')}`)
        .join('\n\n');
      return { result: `${ctx.registry.tools.length} verktyg, alla på:\n\n${body}`, meta: { total: ctx.registry.tools.length, groups: Object.keys(groups).length }, summary: `${ctx.registry.tools.length} verktyg` };
    },
  }),

  def({
    name: 'majin.backup',
    group: 'majin',
    risk: 'write',
    desc: 'Exportera/importera allt MAJIN vet (config, minne, färdigheter, scheman) som en tar.gz i workspace/backups.',
    params: { action: 'string: export | list | restore [export|list|restore]', file: 'string: arkiv för restore' },
    async run({ action = 'list', file }, ctx) {
      const dir = path.join(ctx.cfg.get('workspace'), 'backups');
      await fsp.mkdir(dir, { recursive: true });
      if (action === 'list') {
        const items = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.startsWith('majin-backup'));
        return { result: `${items.length} backuper i ${dir}\n${items.map((i) => `- ${i}`).join('\n') || '(inga)'}`, meta: { dir, items }, summary: `${items.length} backuper` };
      }
      const { spawnSync } = await import('node:child_process');
      const stamp = new Date().toISOString().replace(/[:.]/g, '');
      if (action === 'export') {
        const out = path.join(dir, `majin-backup-${stamp}.tar.gz`);
        const roots = [ctx.cfg.file, dirs.memory, dirs.skills, dirs.sessions, dirs.rules].filter((p) => fs.existsSync(p));
        const r = spawnSync('tar', ['-czf', out, '-C', dirs.root, ...roots.map((p) => path.relative(dirs.root, p))], { encoding: 'utf8' });
        if (r.status !== 0) return { ok: false, error: { code: 'tar_failed', message: r.stderr || 'tar saknas' } };
        return { result: `backupeade ${roots.length} delar → ${out} (${fs.statSync(out).size} byte)`, summary: 'backup klar' };
      }
      const src = file ? path.resolve(file) : null;
      if (!src || !fs.existsSync(src)) return { ok: false, error: { code: 'no_archive', message: 'ange file som pekar på en backup' } };
      const r = spawnSync('tar', ['-xzf', src, '-C', dirs.root], { encoding: 'utf8' });
      if (r.status !== 0) return { ok: false, error: { code: 'restore_failed', message: r.stderr || 'okänt fel' } };
      return { result: `återskapade från ${src}. Laddar om config: starta om MAJIN för full effekt.`, summary: 'restore klar' };
    },
  }),

  def({
    name: 'majin.ui',
    group: 'majin',
    risk: 'read',
    desc: 'Öppna UI:t: annars ett eget Edge-/Chrome-fönster (UIA app-läge) på Windows. action=open.|theme|voice.',
    params: { action: 'string: open | theme | voice | wake [open|theme|voice|wake]', theme: 'string: jarvis | arc | minimal', voice: 'boolean: tts på/av', wake: 'boolean: wake word på/av' },
    async run({ action = 'open', theme = '', voice = null, wake = '' }, ctx) {
      if (action !== 'open') {
        const ui = { ...(ctx.cfg.get('ui') || {}) };
        if (theme) ui.theme = theme;
        if (voice !== undefined) ui.voice = Boolean(voice);
        if (wake !== undefined) ui.wake = Boolean(wake);
        ctx.cfg.patch({ ui });
        return { result: `ui: ${Object.entries(ui).map(([k, v]) => `${k}=${v}`).join(', ')}`, summary: 'ui uppdaterad' };
      }
      const url = `http://127.0.0.1:${ctx.cfg.get('server.port')}/?token=${ctx.cfg.get('server.token')}`;
      const { spawn } = await import('node:child_process');
      const isWin = process.platform === 'win32';
      const candidates = isWin
        ? [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'chrome.exe']
        : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'xdg-open'];
      for (const c of candidates) {
        try {
          const args = c.endsWith('xdg-open') ? [url] : [`--app=${url}`, '--window-size=1280,860', '--user-data-dir=' + path.join(dirs.cache, 'browser')];
          const child = spawn(c, args, { detached: true, stdio: 'ignore', windowsHide: false });
          child.unref();
          return { result: ` öppnade ${c} → ${url}`, summary: 'ui öppnad' };
        } catch {
          /* nästa kandidat */
        }
      }
      return { ok: false, error: { code: 'no_browser', message: 'hittade ingen webbläsare', hint: `öppna ${url} manuellt` } };
    },
  }),

  def({
    name: 'majin.control',
    group: 'majin',
    risk: 'write',
    desc: 'Kontrollera agenten själv: restart | stop | pause | resume | clear (session) | sessions | history.',
    params: { action: 'string: restart | stop | pause | resume | clear | sessions | history [restart|stop|pause|resume|clear|sessions|history]', session: 'string: sessionen (default aktiv)', limit: 'number: rader vid history' },
    async run({ action = 'sessions', session = 'desktop', limit = 40 }, ctx) {
      if (action === 'sessions') {
        const list = await fsp.readdir(dirs.sessions).catch(() => []);
        return { result: list.map((f) => `- ${f.replace(/\.jsonl$/, '')} (${fs.statSync(path.join(dirs.sessions, f)).size} byte)`).join('\n') || '(inga sessioner)', meta: { list }, summary: `${list.length} sessioner` };
      }
      if (action === 'history') {
        const file = path.join(dirs.sessions, `${session}.jsonl`);
        try {
          const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-Number(limit));
          return { result: lines.map((l) => {
            const o = JSON.parse(l);
            return `${o.ts?.slice(11, 19) || ''} ${o.role}: ${String(o.content).replace(/\s+/g, ' ').slice(0, 160)}`;
          }).join('\n'), summary: `${lines.length} rader historik` };
        } catch {
          return { ok: false, error: { code: 'no_history', message: `ingen historik för ${session}` } };
        }
      }
      if (action === 'clear') {
        await fsp.rm(path.join(dirs.sessions, `${session}.jsonl`), { force: true });
        return { result: `rensade sessionen ${session} (minne och färdigheter är kvar)`, summary: 'session rensad' };
      }
      if (action === 'pause') {
        ctx.pause();
        return { result: 'pausad — jag tar inga nya turer förrän du säger resume', summary: 'pausad' };
      }
      if (action === 'resume') {
        ctx.resume();
        return { result: 'återupptagen', summary: 'återupptagen' };
      }
      if (action === 'restart' || action === 'stop') {
        bus.warn('agent.self', { action });
        setTimeout(() => process.exit(action === 'restart' ? 75 : 0), 400).unref?.();
        return { result: action === 'restart' ? 'startar om nu (majin start —window startar igen om det är en launcher)' : 'stänger ner', summary: action };
      }
      return { ok: false, error: { code: 'bad_action', message: action } };
    },
  }),
];

function done(ctx, patch, msg) {
  const res = ctx.cfg.patch(patch, { source: 'tool' });
  if (!res.ok) return { ok: false, error: { code: 'invalid', message: res.errors.map((e) => `${e.path}: ${e.msg}`).join('; ') } };
  bus.info('config.changed', { patch, notes: msg });
  return { result: `${msg}\nDiff:\n${res.diff.map((d) => `  ${d.path}: ${short(d.from)} → ${short(d.to)}`).join('\n')}`, meta: { diff: res.diff }, summary: msg.slice(0, 80) };
}

export function routeLines(ctx) {
  return ctx.cfg
    .routeTable()
    .map((r) => `  ${r.job.padEnd(11)} ${r.ref}${r.ready ? '' : '   ← ingen nyckel'}`)
    .join('\n');
}

function providerLines(ctx) {
  return ctx.cfg
    .providerStatus()
    .map((p) => `  ${p.ready ? '✓' : '·'} ${p.name.padEnd(12)} ${p.kind.padEnd(8)} ${p.baseUrl || '-'} ${p.ready ? '' : '(SAKNAR NYCKEL)'}`)
    .join('\n');
}

function short(v) {
  const s = typeof v === 'object' && v ? JSON.stringify(v) : String(v ?? '—');
  return s.length > 60 ? `${s.slice(0, 57)}…` : s || '—';
}

function unique(x, i, a) {
  return a.indexOf(x) === i;
}
