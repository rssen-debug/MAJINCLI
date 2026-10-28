import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, ensureDir, newId, nowIso, readJson, withFileLock } from '../util.js';
import { formatDuration } from './duration.js';

export const JOBHUNT_SCHEMA = 'majin.v6.jobhunt/v1';
const TERMINAL = new Set(['STOPPED', 'COMPLETED', 'EXPIRED', 'FAILED']);

function emptyCounts() {
  return { discovered: 0, evaluated: 0, submitted: 0, verified: 0, blocked: 0, failed: 0 };
}

function mergeCounts(current, patch) {
  const next = { ...emptyCounts(), ...(current || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (Number.isFinite(Number(value))) next[key] = Math.max(0, Math.trunc(Number(value)));
  }
  return next;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export class JobHuntSession {
  constructor({ home, clock = Date.now } = {}) {
    if (!home) throw new Error('JobHuntSession requires a V6 home directory');
    this.home = path.resolve(home);
    this.clock = clock;
    this.dir = path.join(this.home, 'jobhunt');
    this.file = path.join(this.dir, 'session.json');
    this.stopFile = path.join(this.dir, 'STOP');
    ensureDir(this.dir);
  }

  read() {
    return readJson(this.file, null);
  }

  async #withLock(fn) {
    return withFileLock(`${this.file}.lock`, async () => {
      const state = this.read();
      const next = await fn(state);
      if (next !== undefined) atomicWriteJson(this.file, next);
      return next;
    }, { clock: this.clock });
  }

  #active(state, now) {
    return state && ['RUNNING', 'PAUSED'].includes(state.status) && new Date(state.deadlineAt).getTime() > now;
  }

  async start({ durationMs, candidateId, queries = [], workerId = null, aiDisabled = false, now = this.clock() } = {}) {
    return this.#withLock((current) => {
      if (this.#active(current, now)) {
        throw Object.assign(new Error(`Job Hunter is already ${current.status} until ${current.deadlineAt}`), {
          code: 'JOBHUNT_ALREADY_RUNNING',
          session: this.describe(current, now),
        });
      }
      const at = nowIso(now);
      const deadlineAt = new Date(now + Number(durationMs)).toISOString();
      const state = {
        schema: JOBHUNT_SCHEMA,
        id: newId('jh', () => now),
        status: 'RUNNING',
        durationMs: Math.trunc(Number(durationMs)),
        startedAt: at,
        deadlineAt,
        pausedAt: null,
        pausedTotalMs: 0,
        stoppedAt: null,
        completedAt: null,
        candidateId: String(candidateId || ''),
        aiDisabled: aiDisabled === true,
        queries: [...new Set((queries || []).map(String).filter(Boolean))],
        round: 0,
        runnerPid: null,
        counts: emptyCounts(),
        lastCheckpointAt: at,
        lastError: null,
        reports: null,
        workerId,
        updatedAt: at,
      };
      fs.rmSync(this.stopFile, { force: true });
      return state;
    });
  }

  describe(state = this.read(), now = this.clock()) {
    if (!state) return null;
    const deadline = new Date(state.deadlineAt).getTime();
    const remainingMs = Math.max(0, deadline - now);
    const effectiveStatus = ['RUNNING', 'PAUSED'].includes(state.status) && remainingMs === 0 ? 'EXPIRED' : state.status;
    return {
      ...state,
      effectiveStatus,
      elapsedMs: Math.max(0, now - new Date(state.startedAt).getTime()),
      remainingMs,
      remainingHuman: formatDuration(remainingMs),
      runnerAlive: pidAlive(state.runnerPid),
      deadlinePassed: remainingMs === 0,
    };
  }

  async pause({ now = this.clock() } = {}) {
    return this.#withLock((current) => {
      if (!current) throw Object.assign(new Error('No Job Hunter session exists'), { code: 'JOBHUNT_NOT_FOUND' });
      if (new Date(current.deadlineAt).getTime() <= now) throw Object.assign(new Error('Job Hunter deadline has passed'), { code: 'JOBHUNT_EXPIRED' });
      if (current.status !== 'RUNNING') throw Object.assign(new Error(`Cannot pause from ${current.status}`), { code: 'JOBHUNT_STATE_INVALID' });
      current.status = 'PAUSED';
      current.pausedAt = nowIso(now);
      current.updatedAt = nowIso(now);
      return current;
    });
  }

  async resume({ now = this.clock() } = {}) {
    return this.#withLock((current) => {
      if (!current) throw Object.assign(new Error('No Job Hunter session exists'), { code: 'JOBHUNT_NOT_FOUND' });
      if (new Date(current.deadlineAt).getTime() <= now) {
        current.status = 'EXPIRED';
        current.updatedAt = nowIso(now);
        throw Object.assign(new Error('The original deadline has passed; the session cannot be resumed'), { code: 'JOBHUNT_EXPIRED' });
      }
      if (current.status === 'RUNNING') {
        fs.rmSync(this.stopFile, { force: true });
        return current;
      }
      if (current.status === 'FAILED' || current.status === 'STOPPED') {
        current.status = 'RUNNING';
        current.completedAt = null;
        current.stoppedAt = null;
        current.lastError = null;
        current.updatedAt = nowIso(now);
        fs.rmSync(this.stopFile, { force: true });
        return current;
      }
      if (current.status !== 'PAUSED') throw Object.assign(new Error(`Cannot resume from ${current.status}`), { code: 'JOBHUNT_STATE_INVALID' });
      const pausedMs = current.pausedAt ? Math.max(0, now - new Date(current.pausedAt).getTime()) : 0;
      current.status = 'RUNNING';
      current.pausedTotalMs = Math.max(0, Number(current.pausedTotalMs || 0) + pausedMs);
      current.pausedAt = null;
      current.updatedAt = nowIso(now);
      fs.rmSync(this.stopFile, { force: true });
      return current;
    });
  }

  async extend({ ms, now = this.clock() } = {}) {
    return this.#withLock((current) => {
      if (!current) throw Object.assign(new Error('No Job Hunter session exists'), { code: 'JOBHUNT_NOT_FOUND' });
      if (!['RUNNING', 'PAUSED'].includes(current.status)) throw Object.assign(new Error(`Cannot extend from ${current.status}`), { code: 'JOBHUNT_STATE_INVALID' });
      const extra = Math.max(1, Math.trunc(Number(ms) || 0));
      current.deadlineAt = new Date(new Date(current.deadlineAt).getTime() + extra).toISOString();
      current.durationMs = Math.max(1, Math.trunc(Number(current.durationMs) || 0) + extra);
      current.updatedAt = nowIso(now);
      return current;
    });
  }

  async stop({ now = this.clock(), reason = 'owner' } = {}) {
    return this.#withLock((current) => {
      if (!current) throw Object.assign(new Error('No Job Hunter session exists'), { code: 'JOBHUNT_NOT_FOUND' });
      if (!TERMINAL.has(current.status)) {
        current.status = 'STOPPED';
        current.stoppedAt = nowIso(now);
        current.stopReason = String(reason);
        current.updatedAt = nowIso(now);
      }
      fs.writeFileSync(this.stopFile, `${JSON.stringify({ requestedAt: nowIso(now), reason })}\n`, { mode: 0o600 });
      return current;
    });
  }

  async checkpoint(patch = {}, { now = this.clock() } = {}) {
    return this.#withLock((current) => {
      if (!current) return null;
      if (TERMINAL.has(current.status)) {
        if (patch.reports !== undefined) {
          current.reports = patch.reports;
          current.updatedAt = nowIso(now);
        }
        return current;
      }
      if (patch.counts) current.counts = mergeCounts(current.counts, patch.counts);
      if (Number.isFinite(Number(patch.round))) current.round = Math.max(current.round || 0, Math.trunc(Number(patch.round)));
      if (patch.lastError !== undefined) current.lastError = patch.lastError;
      if (patch.reports !== undefined) current.reports = patch.reports;
      if (patch.nextWakeAt !== undefined) current.nextWakeAt = patch.nextWakeAt;
        if (patch.lastDiscoveryAt !== undefined && Number.isFinite(Date.parse(patch.lastDiscoveryAt))) current.lastDiscoveryAt = patch.lastDiscoveryAt;
      current.lastCheckpointAt = nowIso(now);
      current.updatedAt = nowIso(now);
      return current;
    });
  }

  async complete({ status = 'COMPLETED', reports = null, error = null, now = this.clock() } = {}) {
    return this.#withLock((current) => {
      if (!current) return null;
      current.status = TERMINAL.has(status) ? status : 'COMPLETED';
      current.completedAt = nowIso(now);
      current.reports = reports || current.reports || null;
      current.lastError = error ? String(error).slice(0, 500) : current.lastError;
      current.runnerPid = null;
      current.nextWakeAt = null;
      current.updatedAt = nowIso(now);
      fs.rmSync(this.stopFile, { force: true });
      return current;
    });
  }

  async acquireRunner(pid = process.pid, { now = this.clock() } = {}) {
    return this.#withLock((current) => {
      if (!current) throw Object.assign(new Error('No Job Hunter session exists'), { code: 'JOBHUNT_NOT_FOUND' });
      if (current.status !== 'RUNNING') throw Object.assign(new Error(`Cannot run from ${current.status}`), { code: 'JOBHUNT_STATE_INVALID' });
      if (new Date(current.deadlineAt).getTime() <= now) throw Object.assign(new Error('Job Hunter deadline has passed'), { code: 'JOBHUNT_EXPIRED' });
      if (current.runnerPid && current.runnerPid !== pid && pidAlive(current.runnerPid)) {
        throw Object.assign(new Error(`Another Job Hunter worker is active (pid ${current.runnerPid})`), { code: 'JOBHUNT_WORKER_ACTIVE' });
      }
      current.runnerPid = pid;
      current.updatedAt = nowIso(now);
      return current;
    });
  }

  async releaseRunner(pid = process.pid, { now = this.clock() } = {}) {
    return this.#withLock((current) => {
      if (current?.runnerPid === pid) {
        current.runnerPid = null;
        current.updatedAt = nowIso(now);
      }
      return current;
    });
  }

  clearStop() {
    fs.rmSync(this.stopFile, { force: true });
  }

  stopRequested() {
    return fs.existsSync(this.stopFile);
  }
}
