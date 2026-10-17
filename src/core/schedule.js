/**
 * MAJIN — schemaläggning.
 * Ett jobb = { when, task, deliver }.  "07:30 daily", "every 30m", "10:00 mån",
 * eller femfältscron (0/15 min m å man). Cron parsas här — ingen dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dirs } from './paths.js';
import { bus } from './log.js';

const FILE = path.join(dirs.root, 'schedule.json');
const CRON_NAMES = { daily: '0 0 * * *', hourly: '0 * * * *', weekly: '0 0 * * 1', monthly: '0 0 1 * *' };

export function parseWhen(input) {
  const raw = String(input || '').trim();
  const s = raw.toLowerCase().replace(/\s+/g, ' ');
  if (CRON_NAMES[s]) return { kind: 'cron', spec: CRON_NAMES[s], display: s };
  const every = /(?:^|\s)(?:varje|var|every)\s+(\d+)\s*(s|sek|sekund|sekunder|m|min|minuter|h|tim|timme|timmar|d|dag|dagar)\b/.exec(s);
  if (every) {
    const n = Number(every[1]);
    const unit = { s: 1000, sek: 1000, sekund: 1000, sekunder: 1000, m: 60000, min: 60000, minuter: 60000, h: 3600000, tim: 3600000, timme: 3600000, timmar: 3600000, d: 86400000, dag: 86400000, dagar: 86400000 }[every[2]];
    if (!n || !unit) throw new Error(`could not parse intervallet i "${raw}"`);
    const label = unit === 60000 ? ' min' : unit === 3600000 ? ' h' : unit === 86400000 ? ' dag' : ' s';
    return { kind: 'every', everyMs: n * unit, display: `var ${n}${label}` };
  }
  const at = /(\d{4}-\d{2}-\d{2})[t ](\d{1,2}):(\d{2})/.exec(s);
  if (at) {
    const t = new Date(`${at[1]}T${String(at[2]).padStart(2, '0')}:${at[3]}:00`).getTime();
    if (!Number.isFinite(t)) throw new Error(`ogiltigt datum: ${raw}`);
    return { kind: 'at', at: t, display: `kl ${at[1]} ${at[2]}:${at[3]}` };
  }
  const clock = /^(\d{1,2}):(\d{2})(\s*(daily|varje dag|dagligen|every day|om dagen))?$/.exec(s);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    if (h > 23 || m > 59) throw new Error(`orimlig klocktid: ${raw}`);
    return { kind: 'cron', spec: `${m} ${h} * * *`, display: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} varje dag` };
  }
  const dayTime = /^(\d{1,2}):(\d{2})\s+(\S+)$/.exec(s);
  if (dayTime) {
    const dayNames = { sun: 0, sön: 0, man: 1, mån: 1, tis: 2, tue: 2, ons: 3, wed: 3, tor: 4, tors: 4, thu: 4, fre: 5, fri: 5, lör: 6, sat: 6 };
    const key = String(dayTime[3]).slice(0, 3).toLowerCase();
    const dow = dayNames[key];
    const h = Number(dayTime[1]);
    const m = Number(dayTime[2]);
    if (h <= 23 && m <= 59 && dow !== undefined) return { kind: 'cron', spec: `${m} ${h} * * ${dow}`, display: `${dayTime[1]}:${dayTime[2]} ${dayTime[3]}` };
  }
  const cron = s.split(/\s+/);
  if (cron.length === 5 && /^[\d*,\/-]+$/.test(cron.join(''))) return { kind: 'cron', spec: cron.join(' '), display: cron.join(' ') };
  throw new Error(`could not parse "${raw}" — use "07:30 daily", "every 30m", "10:00 mån", "2026-01-01 09:00" or cron "0/15 * * * *"`);
}

export function nextRun(spec, from = Date.now()) {
  if (spec.kind === 'every') return from + spec.everyMs;
  if (spec.kind === 'at') return spec.at > from ? spec.at : null;
  return nextCron(spec.spec, from);
}

const CRON_FIELD = (field, min, max) => {
  const set = new Set();
  for (const part of String(field).split(',')) {
    const m = /^\*(?:\/(\d+))?$|^(\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    if (m[0].startsWith('*')) {
      const step = Number(m[1] || 1);
      for (let v = min; v <= max; v += step) set.add(v);
    } else {
      const a = Number(m[2]);
      const b = m[3] ? Number(m[3]) : a;
      const step = Number(m[4] || 1);
      for (let v = a; v <= b; v += step) set.add(v);
    }
  }
  return set;
};

export function cronMatch(spec, date) {
  const parts = String(spec).trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mi, ho, dom, mo, dow] = parts.map((p, i) => CRON_FIELD(p, [0, 0, 1, 1, 0][i], [59, 23, 31, 12, 6][i]));
  if (!mi || !ho || !dom || !mo || !dow) return false;
  return mi.has(date.getMinutes()) && ho.has(date.getHours()) && dom.has(date.getDate()) && mo.has(date.getMonth() + 1) && dow.has(date.getDay());
}

function nextCron(spec, from) {
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 400; i += 1) {
    d.setMinutes(d.getMinutes() + 1);
    if (cronMatch(spec, d)) return d.getTime();
  }
  return null;
}

export class Scheduler {
  constructor(cfg, { runTask }) {
    this.cfg = cfg;
    this.runTask = runTask;
    this.jobs = load();
    this.timer = null;
    this.enabled = cfg.get('schedule.enabled') !== false;
    this.running = new Set();
  }

  list() {
    return this.jobs.map((j) => ({ ...j, nextRunHuman: j.nextRun ? new Date(j.nextRun).toLocaleString('sv-SE') : null }));
  }

  add({ name, when, task, deliver = 'silent', model = null, readOnly = null }) {
    const spec = parseWhen(when);
    const job = {
      id: `j-${Math.random().toString(36).slice(2, 8)}`,
      name: name || String(task).slice(0, 48),
      when: spec.display,
      spec,
      task,
      deliver,
      readOnly: readOnly == null ? Boolean(this.cfg.get('schedule.readOnlyDefault')) : Boolean(readOnly),
      model,
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastStatus: null,
      nextRun: nextRun(spec),
      paused: false,
    };
    this.jobs.push(job);
    this.save();
    this.arm();
    bus.info('schedule.add', { id: job.id, when: job.when });
    return { ...job, nextRunHuman: job.nextRun ? new Date(job.nextRun).toLocaleString('sv-SE') : null };
  }

  remove(id) {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id && j.name !== id);
    this.save();
    return this.jobs.length < before;
  }

  setPaused(id, paused) {
    const j = this.jobs.find((x) => x.id === id || x.name === id);
    if (!j) return false;
    j.paused = paused;
    if (!paused) j.nextRun = nextRun(j.spec);
    this.save();
    this.arm();
    return true;
  }

  async runNow(id) {
    const j = this.jobs.find((x) => x.id === id || x.name === id);
    if (!j) return { error: `unknown job ${id}` };
    return this.fire(j, { manual: true });
  }

  save() {
    try {
      fs.writeFileSync(FILE, JSON.stringify(this.jobs.map(({ spec, ...j }) => ({ ...j, spec })), null, 1));
    } catch (err) {
      bus.warn('schedule.save_failed', { error: err.message });
    }
  }

  arm() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.enabled) return;
    const soon = this.jobs.filter((j) => !j.paused && j.nextRun).reduce((a, b) => (a && a.nextRun <= b.nextRun ? a : b), null);
    if (!soon) return;
    const wait = Math.max(500, Math.min(soon.nextRun - Date.now(), 2 ** 31 - 1));
    this.timer = setTimeout(() => this.tick(), wait);
    this.timer.unref?.();
  }

  async tick() {
    const now = Date.now();
    for (const j of this.jobs) {
      if (j.paused || !j.nextRun || j.nextRun > now || this.running.has(j.id)) continue;
      await this.fire(j);
    }
    this.arm();
  }

  async fire(j, { manual = false } = {}) {
    this.running.add(j.id);
    j.lastRun = new Date().toISOString();
    try {
      const res = await this.runTask({ input: j.task, session: `schedule:${j.id}`, source: { type: 'schedule', job: j.name }, deliver: j.deliver, model: j.model, readOnly: Boolean(j.readOnly) });
      j.lastStatus = res.error ? `error: ${res.error}` : 'ok';
      j.lastSummary = String(res.text || '').slice(0, 400);
      bus.info('schedule.done', { id: j.id, status: j.lastStatus, chars: (res.text || '').length });
      this.running.delete(j.id);
      this.save();
      return res;
    } catch (err) {
      j.lastStatus = `error: ${err.message}`;
      bus.error('schedule.failed', { id: j.id, error: err.message });
      this.running.delete(j.id);
      this.save();
      return { error: err.message };
    } finally {
      j.nextRun = manual ? j.nextRun : nextRun(j.spec);
      this.save();
    }
  }

  start() {
    this.enabled = true;
    this.arm();
    this.interval = setInterval(() => this.tick(), 30000);
    this.interval.unref?.();
    return this.jobs.length;
  }

  stop() {
    this.enabled = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
  }
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return raw.map((j) => ({ ...j, spec: j.spec || parseWhen(j.when), nextRun: j.nextRun || nextRun(j.spec || parseWhen(j.when)) }));
  } catch {
    return [];
  }
}
