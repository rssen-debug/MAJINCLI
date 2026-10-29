/**
 * MAJIN V6 — Arena envelopes.
 *
 * Arena (or any external planner) never gets a shell. It gets the ability to
 * drop a *signed, expiring, single-use* task envelope. The Windows side decides
 * what a valid envelope may contain; an unknown key, a replay, an expired
 * envelope or a task kind outside the owner policy is refused before any tool
 * runs.
 */
import path from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../util.js';

export const ENVELOPE_SCHEMA = 'majin.v6.arena.task/v1';
export const POLICY_SCHEMA = 'majin.v6.arena.policy/v1';

/** Tasks a remote planner may request. Anything else is not addressable. */
export const ARENA_TASK_KINDS = Object.freeze([
  'tool',
  'health.delay',
  'job.discover',
  'job.evaluate',
  'job.submit',
  'gmail.verify',
]);

/** Kinds that can change the outside world. Off unless the owner enables them. */
export const IRREVERSIBLE_KINDS = Object.freeze(['job.submit']);

export const MAX_ENVELOPE_BYTES = 64 * 1024;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

export function createSecret() {
  return randomBytes(32).toString('base64url');
}

export function generateKeyId(clock = Date.now) {
  return `ark_${new Date(clock()).toISOString().slice(0, 10)}_${randomBytes(4).toString('hex')}`;
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function signEnvelope({ secret, keyId, task, ttlMs = 15 * 60 * 1000, now = Date.now, policy = {} }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new ArenaError('Signing secret is missing or too short', 'ARENA_SECRET_MISSING');
  const issuedAt = new Date(now()).toISOString();
  const ttl = Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Number(ttlMs) || 15 * 60 * 1000));
  const envelope = {
    schema: ENVELOPE_SCHEMA,
    id: task.id || randomUUID(),
    keyId,
    issuedAt,
    expiresAt: new Date(now() + ttl).toISOString(),
    nonce: randomBytes(16).toString('base64url'),
    kind: String(task.kind || ''),
    title: String(task.title || task.kind || '').slice(0, 200),
    payload: task.payload && typeof task.payload === 'object' ? task.payload : {},
    dedupeKey: task.dedupeKey == null ? null : String(task.dedupeKey).slice(0, 200),
    irreversible: task.irreversible === true,
    maxAttempts: Math.max(1, Math.min(5, Number(task.maxAttempts) || 1)),
    policy: {
      allowTools: Array.isArray(policy.allowTools) ? policy.allowTools.map(String) : [],
    },
  };
  const body = canonicalJson(envelope);
  if (Buffer.byteLength(body) > MAX_ENVELOPE_BYTES) throw new ArenaError('Envelope is too large', 'ARENA_ENVELOPE_TOO_LARGE');
  return { ...envelope, signature: hmac(secret, body) };
}

export class ArenaError extends Error {
  constructor(message, code = 'ARENA_ERROR') {
    super(message);
    this.name = 'ArenaError';
    this.code = code;
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validate an envelope against the owner policy. Pure apart from `seen`.
 * Returns the envelope; throws ArenaError with a machine-readable code.
 */
export function verifyEnvelope(envelope, {
  secret, keyId, policy, seen = null, now = Date.now, allowIrreversible = false,
} = {}) {
  if (!envelope || typeof envelope !== 'object') throw new ArenaError('Envelope is not an object', 'ARENA_ENVELOPE_INVALID');
  if (envelope.schema !== ENVELOPE_SCHEMA) throw new ArenaError(`Unsupported envelope schema ${envelope.schema}`, 'ARENA_SCHEMA_UNSUPPORTED');
  if (typeof envelope.signature !== 'string') throw new ArenaError('Envelope has no signature', 'ARENA_SIGNATURE_MISSING');
  if (!secret) throw new ArenaError('No verification secret is configured on this host', 'ARENA_SECRET_MISSING');
  const ownerKey = keyId || policy?.keyId || null;
  if (ownerKey && envelope.keyId !== ownerKey) throw new ArenaError(`Envelope key ${envelope.keyId} is not the owner key`, 'ARENA_UNKNOWN_KEY');

  const { signature, ...unsigned } = envelope;
  const expected = hmac(secret, canonicalJson(unsigned));
  if (!safeEqual(signature, expected)) throw new ArenaError('Envelope signature does not verify', 'ARENA_BAD_SIGNATURE');

  const clock = typeof now === 'function' ? now : () => Number(now);
  const issued = Date.parse(envelope.issuedAt);
  const expires = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) throw new ArenaError('Envelope timestamps are invalid', 'ARENA_TIMESTAMP_INVALID');
  const skew = Number(policy?.clockSkewMs ?? 60_000);
  if (issued > clock() + skew) throw new ArenaError('Envelope is issued in the future', 'ARENA_NOT_YET_VALID');
  if (expires + skew < clock()) throw new ArenaError('Envelope has expired', 'ARENA_EXPIRED');
  if (expires <= issued) throw new ArenaError('Envelope expires before it was issued', 'ARENA_TIMESTAMP_INVALID');
  if (expires - issued > MAX_TTL_MS) throw new ArenaError('Envelope lifetime is too long', 'ARENA_TTL_TOO_LONG');

  const allowedKinds = Array.isArray(policy?.allowedKinds) && policy.allowedKinds.length ? policy.allowedKinds : ARENA_TASK_KINDS;
  if (!allowedKinds.includes(envelope.kind)) {
    throw new ArenaError(`Task kind ${envelope.kind} is not allowed by owner policy`, 'ARENA_KIND_NOT_ALLOWED');
  }
  if (IRREVERSIBLE_KINDS.includes(envelope.kind) || envelope.irreversible === true) {
    if (IRREVERSIBLE_KINDS.includes(envelope.kind) && envelope.irreversible !== true) {
      throw new ArenaError('A submission must be declared irreversible so it is never replayed', 'ARENA_IRREVERSIBLE_FLAG_REQUIRED');
    }
    if (!allowIrreversible || policy?.allowIrreversible !== true) {
      throw new ArenaError('Owner policy does not allow irreversible tasks', 'ARENA_IRREVERSIBLE_NOT_ALLOWED');
    }
  }
  if (envelope.kind === 'tool') {
    const tool = envelope.payload?.tool;
    if (typeof tool !== 'string' || !tool) throw new ArenaError('tool tasks need payload.tool', 'ARENA_TOOL_MISSING');
    const ownerTools = Array.isArray(policy?.allowedTools) ? policy.allowedTools : [];
    if (!ownerTools.includes(tool)) throw new ArenaError(`Tool ${tool} is not in the owner allowlist`, 'ARENA_TOOL_NOT_ALLOWED');
    const envelopeTools = Array.isArray(envelope.policy?.allowTools) ? envelope.policy.allowTools : [];
    if (envelopeTools.length && !envelopeTools.includes(tool)) {
      throw new ArenaError('Envelope tool list does not cover the payload tool', 'ARENA_TOOL_NOT_ALLOWED');
    }
    const args = envelope.payload?.arguments;
    if (args != null && (typeof args !== 'object' || Array.isArray(args))) {
      throw new ArenaError('payload.arguments must be an object', 'ARENA_ARGUMENTS_INVALID');
    }
    if (args && Object.hasOwn(args, 'operationId')) throw new ArenaError('operationId is assigned by MAJIN, not by the envelope', 'ARENA_ARGUMENTS_INVALID');
  }
  if (envelope.dedupeKey && envelope.dedupeKey.length > 200) throw new ArenaError('dedupeKey is too long', 'ARENA_ENVELOPE_INVALID');
  if (seen && seen.has(envelope.id)) throw new ArenaError(`Envelope ${envelope.id} was already consumed`, 'ARENA_REPLAY');

  return envelope;
}

/** Small persistent replay ledger; pruned by age. */
export class ReplayLedger {
  constructor({ file, fs, clock = Date.now, ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    this.file = file;
    this.fs = fs;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.entries = this.#load();
  }

  #load() {
    try { return JSON.parse(this.fs.readFileSync(this.file, 'utf8')); } catch { return {}; }
  }

  #prune() {
    const cutoff = this.clock() - this.ttlMs;
    for (const [id, at] of Object.entries(this.entries)) {
      if (new Date(at).getTime() < cutoff) delete this.entries[id];
    }
  }

  has(id) { return Object.hasOwn(this.entries, id); }

  add(id) {
    this.entries[id] = new Date(this.clock()).toISOString();
    this.#prune();
    this.fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    this.fs.writeFileSync(this.file, `${JSON.stringify(this.entries, null, 2)}\n`, { mode: 0o600 });
    return this;
  }
}

export function loadArenaSecret(file, fs) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8').trim(); } catch {
    throw new ArenaError(`Arena signing secret not found at ${file}`, 'ARENA_SECRET_MISSING');
  }
  if (raw.length < 32) throw new ArenaError('Arena signing secret is too short', 'ARENA_SECRET_MISSING');
  return raw;
}
