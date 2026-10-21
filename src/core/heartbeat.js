/**
 * MAJIN W9 HEARTBEAT — proactive, honest, rate-limited alerting.
 *
 * Watches the bus for events that matter (errors, stalls, turn timeouts,
 * approvals waiting, scheduled runs, budget warnings), aggregates them into
 * bounded digests and surfaces them through: (1) the desktop UI stream,
 * (2) optional outbound channel (discord/slack/... via channels/send).
 *
 * Ground rules (Master Directive W9: "proactive — warn BEFORE failure"):
 *  - ONLY real events — never invented health.
 *  - Rate-limited + deduped + sized caps. Silence is the default state.
 *  - All sends go through approval-gated tools or the same channel senders
 *    with explicit config; missing config = honest 'no channel' note, not spam.
 *  - Everything measurable: state dir heartbeats/ with log + last-sent stamp.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { bus as globalBus } from './log.js';
import { CHANNELS_OUT } from './channels/send.js';

export const VERSION = 'majin-heartbeat/1';

const DEFAULT_WATCH = [
  'loop.turn_timeout', 'loop.repeat_block', 'loop.budget', 'loop.provider',
  'approval:request', 'scheduler.run.budget_blocked', 'exec.error',
  'research.*.failed', 'channels.*.error',
];

export class Heartbeat {
  constructor({
    workspaceDir,
    cfg = null,
    bus = globalBus,
    fetchFn = fetch,
    tickMs = 15 * 60_000,     /* 15 min default digest rhythm */
    minGapMs = 5 * 60_000,     /* spam protection: never outpace 5 min between two alerts */
    cap = 50,
    now = () => Date.now(),
    quietPatterns = DEFAULT_WATCH,
  } = {}) {
    this.ws = workspaceDir;
    this.cfg = cfg;
    this.bus = bus;
    this.fetchFn = fetchFn;
    this.tickMs = tickMs;
    this.minGapMs = minGapMs;
    this.cap = cap;
    this.now = now;
    this.queue = [];           /* pending event digests */
    this.seen = new Map();     /* dedupe: key -> at */
    this.lastSentAt = 0;
    this.off = [];
    this.timer = null;
    this._patterns = quietPatterns;
  }

  dir() { return path.join(this.ws, 'heartbeats'); }
  statePath() { return path.join(this.dir(), 'state.json'); }
  logPath() { return path.join(this.dir(), 'log.jsonl'); }

  matches(pattern, event) {
    if (!pattern) return false;
    if (pattern.endsWith('*')) return event.startsWith(pattern.slice(0, -1));
    return event === pattern;
  }

  start() {
    if (this.timer || this._noAudio) return this;
    fs.mkdirSync(this.dir(), { recursive: true });
    /* bus.on() only matches exact types — wildcard patterns live here, on top
       of the raw sub() stream, so 'research.*.failed' style config actually
       works instead of silently dead-listening. */
    const off = this.bus.sub((ev) => {
      const t = String(ev?.type || '');
      for (const pat of this._patterns) {
        if (this.matches(pat, t)) { this.ingest(t, ev); return; }
      }
    });
    this.off.push(off);
    this.timer = setInterval(() => void this.tick().catch(() => {}), this.tickMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    this.off.forEach((fn) => { try { fn?.(); } catch { /* */ } });
    this.off = [];
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    return this;
  }

  /* Deduped, hop-counted event ingestion — nothing stored that is not
     a real bus event with a real payload. */
  ingest(pattern, ev) {
    // Event-bus timestamps differ between identical events on a fast machine,
    // especially Windows. Deduplicate by semantic payload, not volatile clock
    // metadata. Keep the original event in the queue for accurate evidence.
    const stable = ev && typeof ev === 'object' ? { ...ev } : ev;
    if (stable && typeof stable === 'object') {
      delete stable.ts;
      delete stable.timestamp;
    }
    const key = `${pattern}:${JSON.stringify(stable ?? {}).slice(0, 160)}`;
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    const prevAt = this.seen.get(hash) || 0;
    if (prevAt !== 0 && this.now() - prevAt < this.minGapMs) return false; /* prevAt===0 = never seen before — first sighting always counts */
    this.seen.set(hash, this.now());
    if (this.seen.size > 500) { const first = this.seen.keys().next().value; if (first) this.seen.delete(first); }
    this.queue.push({ at: new Date(this.now()).toISOString(), event: pattern, detail: ev ?? {} });
    if (this.queue.length > this.cap) this.queue = this.queue.slice(-this.cap);
    return true;
  }

  /* Compose the user-facing alert text (bounded; never token-hungry). */
  digestText(entries) {
    const lines = entries.slice(0, 8).map((e) => {
      const label = String(e.event);
      const m = e.detail?.message || e.detail?.error || e.detail?.text || '';
      return `• ${label}${m ? ` — ${String(m).slice(0, 140)}` : ''}`;
    });
    const more = entries.length > 8 ? `\n  … +${entries.length - 8} more` : '';
    return `MAJIN heartbeat: ${entries.length} notable event(s) since last check-in\n${lines.join('\n')}${more}`;
  }

  async deliver(text, { dryRun = false } = {}) {
    const targets = (() => {
      const out = [];
      const outPref = this.cfg?.get?.('heartbeat.channels');
      if (Array.isArray(outPref) && outPref.length) {
        for (const ch of outPref) if (CHANNELS_OUT[ch]) out.push(ch);
      }
      return out;
    })();
    if (dryRun) return { ok: true, dryRun: true, targets, text: String(text).slice(0, 600) };
    if (!targets.length) {
      /* Honest: no channel configured = desktop-only via bus stream. */
      this.bus.info('heartbeat.alert', { channels: 'desktop-only', textLength: String(text).length });
      return { ok: true, channels: 'desktop-only', textLength: String(text).length };
    }
    const results = [];
    for (const ch of targets) {
      const fn = CHANNELS_OUT[ch];
      try {
        const r = await fn(this.cfg, { channelId: this.cfg.get(`channels.${ch}.channelId`) || this.cfg.get(`channels.${ch}.channel`) || this.cfg.get(`channels.${ch}.room`), channel: this.cfg.get(`channels.${ch}.channel`), room: this.cfg.get(`channels.${ch}.room`), text }, this.fetchFn);
        results.push({ ch, ok: r.ok || false, status: r.status ?? null, error: r.error?.message ?? null });
      } catch (e) {
        results.push({ ch, ok: false, error: String(e?.message || e).slice(0, 160) });
      }
    }
    return { ok: results.some((r) => r.ok) || !results.length, channels: 'configured', results };
  }

  persist(entry) {
    try {
      fs.mkdirSync(this.dir(), { recursive: true });
      fs.appendFileSync(this.logPath(), JSON.stringify(entry) + '\n');
      fs.writeFileSync(this.statePath(), JSON.stringify({ lastAt: entry.at, queued: this.queue.length, version: VERSION }, null, 2));
    } catch { /* filesystem hiccup never crashes the watcher */ }
  }

  /* One tick = check rate + newer entries; send if anything real accumulated. */
  async tick({ force = false, dryRun = false } = {}) {
    const since = this.queue;
    this.queue = [];
    if (!since.length) {
      const quiet = { ok: true, sent: false, reason: 'nothing real accumulated — silence is the default' };
      this.persist({ at: new Date(this.now()).toISOString(), tick: true, sent: false });
      return quiet;
    }
    const gap = this.now() - this.lastSentAt;
    if (!force && gap < this.minGapMs) {
      const held = { ok: true, sent: false, reason: `rate-limited, ${Math.round((this.minGapMs - gap) / 1000)}s left of the mandatory quiet`, held: since.length };
      this.persist({ at: new Date(this.now()).toISOString(), tick: true, sent: false, held: since.length });
      return held;
    }
    const text = this.digestText(since);
    const delivery = await this.deliver(text, { dryRun });
    this.lastSentAt = this.now();
    this.persist({ at: new Date(this.now()).toISOString(), tick: true, sent: true, count: since.length, delivery: { ok: delivery.ok, channels: delivery.channels } });
    return { ok: true, sent: true, text, delivery, count: since.length };
  }

  status() {
    let state = null;
    try { state = JSON.parse(fs.readFileSync(this.statePath(), 'utf8')); } catch { state = null; }
    return {
      running: Boolean(this.timer),
      queued: this.queue.length,
      lastSentAt: this.lastSentAt ? new Date(this.lastSentAt).toISOString() : null,
      tickMs: this.tickMs,
      minGapMs: this.minGapMs,
      watch: this._patterns,
      persisted: state,
      version: VERSION,
    };
  }
}
