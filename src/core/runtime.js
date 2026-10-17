/**
 * MAJIN — runtime.
 * Ensam monteringspunkt: config → minne → färdigheter → registry → agent →
 * schemaläggare → kanaler. Servern och CLI:n byder båda hit, så det bara finns
 * ett sätt att starta allt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { load } from './config.js';
import { bus } from './log.js';
import { dirs, ensureDirs } from './paths.js';
import { Memory, Skills } from './memory.js';
import { Usage } from './usage.js';
import { buildRegistry, ALL_TOOLS } from './tools/index.js';
import { Agent } from './agent.js';
import { Scheduler } from './schedule.js';
import { approvals } from './guard.js';
import { readHistory } from './context.js';

export const VERSION = '0.1.0';

export async function createRuntime({ channels = true, scheduler = true, open = null } = {}) {
  ensureDirs();
  const cfg = load();
  const memory = new Memory(cfg);
  const skills = new Skills(cfg);
  const usage = new Usage(cfg);

  const ctx = { cfg, bus, memory, skills, usage, approvals, agent: null, channels: null, scheduler: null, emit: (ev) => bus.emit(`tool.${ev.type}`, ev) };
  const registry = buildRegistry(ctx);

  const agent = new Agent({ cfg, registry, memory, skills, usage, bus, shared: ctx });
  ctx.agent = agent;
  ctx.pause = () => agent.pause();
  ctx.resume = () => agent.resume();
  ctx.statusProviders = () => cfg.providerStatus();
  ctx.setPlan = (session, plan, note) => agent.setPlan(session, plan, note);
  ctx.registryCount = () => registry.list().length;

  let sched = null;
  if (scheduler && cfg.get('schedule.enabled') !== false) {
    sched = new Scheduler(cfg, {
      runTask: (task) => runTask(task),
    });
    ctx.scheduler = sched;
    sched.start();
  }

  let chans = null;
  if (channels && (cfg.get('channels.telegram.enabled') || cfg.get('channels.whatsapp.enabled'))) {
    const { Channels } = await import('./channels/index.js');
    chans = new Channels({ cfg, agent, registry, scheduler: sched, bus });
    ctx.channels = chans;
    agent.channels = chans;
    chans.start().catch((err) => bus.warn('channels.start', { error: err.message }));
  }

  async function runTask({ input, session = 'desktop', source = 'schedule', deliver = 'auto', model = null } = {}) {
    try {
      const res = await agent.turn({
        input,
        session,
        source,
        history: readHistory(session, 30),
        onEvent: (ev) => bus.emit(`turn.${ev.type}`, { session, ...ev }),
      });
      const mode = deliver === true ? 'auto' : deliver || 'auto';
      const target = resolveTarget(mode, session);
      if (mode !== 'silent' && target && chans) await chans.deliver(target, res.text).catch(() => {});
      if (model && res) res.requestedModel = model;
      bus.emit('answer', { session, text: res.text, source, delivered: mode !== 'silent' ? target || null : 'silent', steps: res.steps });
      return res;
    } catch (err) {
      bus.error('schedule.run', { error: err.message, session });
      if (chans && session.includes(':')) await chans.deliver(session, `Schemat misslyckades: ${err.message}`).catch(() => {});
      return { error: err.message };
    }
  }

  function resolveTarget(mode, session) {
    if (session && session.includes(':') && session !== `schedule:${session.split(':')[1]}`) return session;
    const pinned = cfg.get('channels.shared.deliverTo');
    if (pinned) return pinned;
    if (mode === 'telegram' || mode === 'auto') {
      const chats = cfg.get('channels.telegram.allowedChatIds') || [];
      if (chats.length) return `telegram:${chats[chats.length - 1]}`;
    }
    if (mode === 'whatsapp' || mode === 'auto') {
      const jids = cfg.get('channels.whatsapp.allowedJids') || [];
      if (jids.length) return `whatsapp:${jids[jids.length - 1]}`;
    }
    return mode === 'telegram' || mode === 'whatsapp' ? null : null;
  }

  function state({ includeTools = true } = {}) {
    const moa = cfg.get('moa');
    return {
      version: VERSION,
      name: cfg.get('name'),
      up: Math.round(process.uptime()),
      pid: process.pid,
      node: process.version,
      config: cfg.redacted(),
      configFile: cfg.file,
      dirs: { root: dirs.root, workspace: cfg.get('workspace'), memory: dirs.memory, out: dirs.out, uploads: dirs.uploads, logs: dirs.logs },
      providers: cfg.providerStatus(),
      routes: cfg.routeTable(),
      needsSetup: cfg.needsSetup?.() ?? !cfg.providerStatus().some((p) => p.ready),
      moa: { policy: moa.policy, enabled: moa.enabled, width: moa.width, refs: moa.references.map((r) => r.model), aggregator: moa.aggregator, disagreementFloor: moa.disagreementFloor },
      guard: { mode: cfg.get('guard.mode'), pending: approvals.list().length, recent: approvals.recent(8) },
      tools: includeTools ? registry.list().map((t) => ({ name: t.name, group: t.group, risk: t.risk, desc: t.desc })) : { count: ALL_TOOLS.length },
      groups: includeTools ? registry.groups() : null,
      memory: memory.stats?.() || null,
      skills: skills.list?.() || [],
      usage: usage.summary(),
      schedule: sched ? sched.list() : [],
      channels: chans ? chans.status() : { telegram: { online: false, state: 'off' }, whatsapp: { online: false, state: 'off' } },
      events: bus.tail(120).map(prettyEvent),
    };
  }

  return {
    cfg,
    bus,
    memory,
    skills,
    usage,
    registry,
    agent,
    scheduler: sched,
    channels: chans,
    approvals,
    ctx,
    state,
    runTask,
    version: VERSION,
    async shutdown() {
      sched?.stop();
      chans?.stop();
      try {
        fs.writeFileSync(path.join(dirs.root, 'last-shutdown.json'), JSON.stringify({ at: new Date().toISOString() }));
      } catch {
        /* struntar i */
      }
      await bus.close?.();
    },
  };
}

function prettyEvent(ev) {
  const { id, ts, type, level, msg, ...rest } = ev;
  return { id, ts, type, level, msg: msg || null, ...Object.fromEntries(Object.entries(rest).slice(0, 8)) };
}
