/**
 * MAJIN V6 — Arena agent (runs on the owner's Windows machine).
 *
 * Loop: poll relay -> verify signature/policy/replay -> enqueue durable task ->
 * acknowledge -> execute through the existing V6 supervisor -> publish a
 * sanitized result back to the relay.
 *
 * Nothing here reasons about the task. Arena plans; MAJIN executes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ArenaError, loadArenaSecret, verifyEnvelope, POLICY_SCHEMA, ARENA_TASK_KINDS } from './envelope.js';
import { scrub, findSyncViolations } from '../redact.js';
import { atomicWriteJson, readJson } from '../util.js';

export const RESULT_SCHEMA = 'majin.v6.arena.result/v1';
const TERMINAL = new Set(['COMPLETED', 'FAILED_FINAL', 'BLOCKED', 'UNCERTAIN', 'CANCELLED']);

export function loadArenaPolicy(file = null, { fsImpl = fs } = {}) {
  if (!file) return { ok: false, policy: null, error: { code: 'ARENA_POLICY_MISSING', reason: 'No arena policy path configured' } };
  if (!fsImpl.existsSync(file)) {
    return { ok: false, policy: null, error: { code: 'ARENA_POLICY_MISSING', reason: `Arena policy not found: ${file}` } };
  }
  let raw;
  try { raw = JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch (error) {
    return { ok: false, policy: null, error: { code: 'ARENA_POLICY_INVALID', reason: `Policy is not valid JSON: ${error.message}` } };
  }
  if (!raw || raw.schema !== POLICY_SCHEMA) {
    return { ok: false, policy: null, error: { code: 'ARENA_POLICY_INVALID', reason: `Expected schema ${POLICY_SCHEMA}` } };
  }
  const kinds = Array.isArray(raw.allowedKinds) ? raw.allowedKinds.filter((kind) => ARENA_TASK_KINDS.includes(kind)) : [];
  if (!kinds.length) {
    return { ok: false, policy: null, error: { code: 'ARENA_POLICY_INVALID', reason: 'allowedKinds must contain at least one supported task kind' } };
  }
  const policy = {
    schema: POLICY_SCHEMA,
    keyId: typeof raw.keyId === 'string' ? raw.keyId : null,
    allowedKinds: kinds,
    allowedTools: Array.isArray(raw.allowedTools) ? raw.allowedTools.map(String) : [],
    allowIrreversible: raw.allowIrreversible === true,
    clockSkewMs: Number.isFinite(Number(raw.clockSkewMs)) ? Number(raw.clockSkewMs) : 60000,
    envelopeTtlMs: Number.isFinite(Number(raw.envelopeTtlMs)) ? Number(raw.envelopeTtlMs) : 900000,
    pollIntervalMs: Number.isFinite(Number(raw.pollIntervalMs)) ? Math.max(2000, Number(raw.pollIntervalMs)) : 15000,
    maxTasksPerPoll: Math.max(1, Math.min(20, Number(raw.maxTasksPerPoll) || 5)),
    relay: raw.relay || null,
    server: raw.server || { port: 8787 },
    submission: raw.submission || null,
    // Optional planner block (provider/model/baseUrl). Never contains a key:
    // keys come from the environment or a mode-600 file, not from the policy.
    planner: raw.planner && typeof raw.planner === 'object' ? { ...raw.planner } : null,
    profilesFile: raw.profilesFile || null,
    candidates: Array.isArray(raw.candidates) ? raw.candidates.map(String) : [],
  };
  if (!policy.keyId) return { ok: false, policy: null, error: { code: 'ARENA_POLICY_INVALID', reason: 'keyId is required so a foreign key cannot sign work' } };
  return { ok: true, policy, error: null };
}

export function sanitizeResult(result) {
  const scrubbed = scrub(result);
  const violations = findSyncViolations(scrubbed);
  if (violations.length) {
    return {
      ...scrubbed,
      receipt: scrubbed.receipt ? { kind: scrubbed.receipt.kind || 'withheld', withheld: true } : null,
      redacted: true,
      redactionNote: 'Receipt details withheld by the privacy gate before relay publication.',
    };
  }
  return scrubbed;
}

export class ArenaAgent {
  constructor({
    relay, secret, policy, queue, log, runWork, ledgerFile, workerId = 'arena-agent',
    clock = Date.now, fsImpl = fs, maxTasksPerPoll = null,
  } = {}) {
    if (!relay) throw new ArenaError('ArenaAgent needs a relay', 'ARENA_RELAY_CONFIG');
    if (!queue) throw new ArenaError('ArenaAgent needs a task queue', 'ARENA_QUEUE_MISSING');
    if (!policy) throw new ArenaError('ArenaAgent needs an owner policy', 'ARENA_POLICY_MISSING');
    this.relay = relay;
    this.secret = secret;
    this.policy = policy;
    this.queue = queue;
    this.log = log;
    this.runWork = runWork || (async () => ({ executed: 0 }));
    this.ledgerFile = ledgerFile;
    this.workerId = workerId;
    this.clock = clock;
    this.fs = fsImpl;
    this.maxTasksPerPoll = maxTasksPerPoll || policy.maxTasksPerPoll || 5;
    this.ledger = this.#loadLedger();
  }

  #loadLedger() {
    if (!this.ledgerFile) return { envelopes: {} };
    const state = readJson(this.ledgerFile, { envelopes: {} });
    if (!state || typeof state !== 'object' || typeof state.envelopes !== 'object' || state.envelopes === null) {
      return { envelopes: {} };
    }
    return state;
  }

  #saveLedger() {
    if (!this.ledgerFile) return;
    atomicWriteJson(this.ledgerFile, { schema: 'majin.v6.arena.ledger/v1', updatedAt: new Date(this.clock()).toISOString(), envelopes: this.ledger.envelopes });
  }

  #seenIds() {
    return new Set(Object.keys(this.ledger.envelopes));
  }

  #emit(type, data) {
    try { this.log?.append(type, { workerId: this.workerId, ...data }); } catch { /* telemetry never blocks work */ }
  }

  /**
   * One polling pass. Returns a truthful summary: what was accepted, refused,
   * enqueued and published. Refusals are logged with their reason code.
   */
  async pollOnce({ maxItems = null } = {}) {
    const limit = Math.max(1, Math.min(20, maxItems || this.maxTasksPerPoll));
    const inbox = await this.relay.listInbox();
    const summary = { inbox: inbox.length, accepted: 0, refused: [], enqueued: [], published: 0, work: null };

    for (const item of inbox.slice(0, limit)) {
      let envelope;
      try {
        envelope = await this.relay.fetch(item.id);
      } catch (error) {
        summary.refused.push({ id: item.id, code: error.code || 'ARENA_FETCH_FAILED' });
        this.#emit('arena.refused', { envelopeId: item.id, code: error.code || 'ARENA_FETCH_FAILED' });
        continue;
      }
      try {
        verifyEnvelope(envelope, {
          secret: this.secret,
          keyId: this.policy.keyId,
          policy: this.policy,
          seen: this.#seenIds(),
          now: this.clock,
          allowIrreversible: this.policy.allowIrreversible,
        });
      } catch (error) {
        summary.refused.push({ id: item.id, code: error.code || 'ARENA_REJECTED', reason: error.message });
        this.#emit('arena.refused', { envelopeId: item.id, code: error.code || 'ARENA_REJECTED', reason: error.message });
        // A refused envelope stays in the relay for the owner to inspect. It is
        // never acknowledged as if it had been accepted.
        continue;
      }

      const added = await this.queue.add({
        kind: envelope.kind,
        title: envelope.title,
        payload: envelope.payload,
        dedupeKey: `arena:${envelope.id}`,
        effectKey: envelope.irreversible ? `arena-effect:${envelope.id}` : null,
        irreversible: envelope.irreversible === true,
        maxAttempts: envelope.maxAttempts,
        by: 'arena',
      });
      this.ledger.envelopes[envelope.id] = {
        envelopeId: envelope.id,
        taskId: added.task.id,
        kind: envelope.kind,
        acceptedAt: new Date(this.clock()).toISOString(),
        keyId: envelope.keyId,
        publishedAt: null,
      };
      this.#saveLedger();
      summary.accepted += 1;
      summary.enqueued.push({ envelopeId: envelope.id, taskId: added.task.id, kind: envelope.kind, deduplicated: added.deduplicated });
      this.#emit('arena.accepted', {
        envelopeId: envelope.id, taskId: added.task.id, kind: envelope.kind, deduplicated: added.deduplicated,
      });
      await this.relay.acknowledge(envelope.id, { taskId: added.task.id, keyId: envelope.keyId }).catch((error) => {
        this.#emit('arena.ack_failed', { envelopeId: envelope.id, code: error.code || 'ARENA_ACK_FAILED' });
      });
    }

    summary.work = await this.runWork({ maxTasks: this.maxTasksPerPoll });
    summary.published = await this.publishResults();
    return summary;
  }

  /** Publish results for accepted envelopes whose tasks reached a terminal state. */
  async publishResults({ limit = 20 } = {}) {
    let published = 0;
    for (const entry of Object.values(this.ledger.envelopes).slice(-limit)) {
      if (entry.publishedAt) continue;
      const task = await this.queue.get(entry.taskId);
      if (!task || !TERMINAL.has(task.state)) continue;
      const result = sanitizeResult({
        schema: RESULT_SCHEMA,
        envelopeId: entry.envelopeId,
        taskId: task.id,
        kind: task.kind,
        state: task.state,
        attempts: task.attempts,
        summary: task.result?.summary || null,
        output: task.result?.output ?? null,
        receipt: task.result?.receipt || null,
        error: task.lastError || null,
        blocked: task.blocked ? { code: task.blocked.code, requiresOwner: task.blocked.requiresOwner === true } : null,
        finishedAt: task.updatedAt,
        publishedAt: new Date(this.clock()).toISOString(),
        executor: { platform: process.platform, engine: 'majin-v6', worker: this.workerId },
      });
      try {
        await this.relay.publish(entry.envelopeId, result);
        entry.publishedAt = result.publishedAt;
        this.#saveLedger();
        published += 1;
        this.#emit('arena.published', { envelopeId: entry.envelopeId, taskId: task.id, state: task.state });
      } catch (error) {
        this.#emit('arena.publish_failed', { envelopeId: entry.envelopeId, code: error.code || 'ARENA_PUBLISH_FAILED' });
      }
    }
    if (published) this.#saveLedger();
    return published;
  }
}

export function createArenaPaths(home) {
  const root = path.join(home, 'arena');
  return {
    root,
    policy: path.join(root, 'policy.json'),
    secret: path.join(root, 'secret'),
    ledger: path.join(root, 'ledger.json'),
    evidence: path.join(root, 'evidence'),
    outbox: path.join(root, 'outbox'),
    token: path.join(root, 'bridge-token'),
    inbox: path.join(root, 'inbox'),
  };
}

export function readArenaSecret(paths, { fsImpl = fs } = {}) {
  return loadArenaSecret(paths.secret, fsImpl);
}
