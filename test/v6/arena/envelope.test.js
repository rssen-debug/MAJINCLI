import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  signEnvelope, verifyEnvelope, createSecret, generateKeyId,
  ReplayLedger, ArenaError, ENVELOPE_SCHEMA, POLICY_SCHEMA,
} from '../../../src/v6/arena/envelope.js';
import { loadArenaPolicy } from '../../../src/v6/arena/agent.js';

const policy = {
  keyId: 'ark_test',
  allowedKinds: ['tool', 'health.delay', 'job.discover'],
  allowedTools: ['fs_read', 're_hash'],
  allowIrreversible: false,
  clockSkewMs: 1000,
};

function signed(overrides = {}, { keyId = 'ark_test' } = {}) {
  return signEnvelope({
    secret: createSecret(),
    keyId,
    task: { kind: 'health.delay', payload: { ms: 1 }, ...overrides },
  });
}

test('a signed envelope verifies only with the owner key and policy', () => {
  const secret = createSecret();
  const envelope = signEnvelope({ secret, keyId: 'ark_test', task: { kind: 'health.delay', payload: { ms: 1 } } });
  assert.equal(verifyEnvelope(envelope, { secret, policy }).kind, 'health.delay');

  assert.throws(
    () => verifyEnvelope(envelope, { secret: createSecret(), policy }),
    (error) => error.code === 'ARENA_BAD_SIGNATURE',
  );
  assert.throws(
    () => verifyEnvelope(envelope, { secret, policy: { ...policy, keyId: 'ark_other' } }),
    (error) => error.code === 'ARENA_UNKNOWN_KEY',
  );
});

test('tampering with any field invalidates the signature', () => {
  const secret = createSecret();
  const envelope = signEnvelope({ secret, keyId: 'ark_test', task: { kind: 'tool', payload: { tool: 'fs_read', arguments: { path: 'a' } } } });
  for (const mutate of [
    (copy) => { copy.payload.arguments.path = 'etc/passwd'; },
    (copy) => { copy.kind = 'job.submit'; },
    (copy) => { copy.expiresAt = new Date(Date.now() + 10 * 60_000).toISOString(); },
    (copy) => { copy.policy.allowTools = ['shell_run']; },
  ]) {
    const copy = structuredClone(envelope);
    mutate(copy);
    assert.throws(() => verifyEnvelope(copy, { secret, policy }), (error) => error.code === 'ARENA_BAD_SIGNATURE');
  }
});

test('expiry, clock skew and excessive lifetime are enforced', () => {
  const secret = createSecret();
  // Fixed base clock: a wall-clock jump in the sandbox must never turn this
  // security assertion into a flake in either direction.
  const base = Date.parse('2026-10-29T12:00:00.000Z');
  const short = signEnvelope({ secret, keyId: 'ark_test', task: { kind: 'health.delay' }, ttlMs: 30_000, now: () => base });
  assert.throws(
    () => verifyEnvelope(short, { secret, policy, now: base + 60_000 }),
    (error) => error.code === 'ARENA_EXPIRED',
  );
  const future = signEnvelope({ secret, keyId: 'ark_test', task: { kind: 'health.delay' }, now: () => base + 120_000 });
  assert.throws(
    () => verifyEnvelope(future, { secret, policy, now: base }),
    (error) => error.code === 'ARENA_NOT_YET_VALID',
  );
  // Signing clamps to the 24 h horizon; verifying rejects anything beyond it.
  const longLived = signEnvelope({ secret, keyId: 'ark_test', task: { kind: 'health.delay' }, ttlMs: 48 * 60 * 60 * 1000, now: () => base });
  const lifetime = Date.parse(longLived.expiresAt) - Date.parse(longLived.issuedAt);
  assert.equal(lifetime, 24 * 60 * 60 * 1000);
  assert.equal(verifyEnvelope(longLived, { secret, policy, now: base }).kind, 'health.delay');
});

test('task kinds, tool allowlists and irreversible work are owner-controlled', () => {
  const secret = createSecret();
  const shell = signEnvelope({
    secret, keyId: 'ark_test',
    task: { kind: 'tool', payload: { tool: 'shell_run', arguments: { command: 'whoami' } } },
    policy: { allowTools: ['shell_run'] },
  });
  assert.throws(
    () => verifyEnvelope(shell, { secret, policy }),
    (error) => error.code === 'ARENA_TOOL_NOT_ALLOWED',
  );

  const unknownKind = signEnvelope({ secret, keyId: 'ark_test', task: { kind: 'agent.self_modify' } });
  assert.throws(
    () => verifyEnvelope(unknownKind, { secret, policy }),
    (error) => error.code === 'ARENA_KIND_NOT_ALLOWED',
  );

  const submission = signEnvelope({
    secret, keyId: 'ark_test',
    task: { kind: 'job.submit', payload: { applicationId: 'app_1' }, irreversible: true },
  });
  assert.throws(
    () => verifyEnvelope(submission, { secret, policy: { ...policy, allowedKinds: ['job.submit'] } }),
    (error) => error.code === 'ARENA_IRREVERSIBLE_NOT_ALLOWED',
  );
  const allowed = verifyEnvelope(submission, {
    secret, policy: { ...policy, allowedKinds: ['job.submit'], allowIrreversible: true }, allowIrreversible: true,
  });
  assert.equal(allowed.irreversible, true);

  const sneaky = signEnvelope({ secret, keyId: 'ark_test', task: { kind: 'job.submit', payload: { applicationId: 'a' }, irreversible: false } });
  assert.throws(
    () => verifyEnvelope(sneaky, { secret, policy: { ...policy, allowedKinds: ['job.submit'], allowIrreversible: true }, allowIrreversible: true }),
    (error) => error.code === 'ARENA_IRREVERSIBLE_FLAG_REQUIRED',
  );
});

test('operationId cannot be injected through envelope arguments', () => {
  const secret = createSecret();
  const envelope = signEnvelope({
    secret, keyId: 'ark_test',
    task: { kind: 'tool', payload: { tool: 'fs_read', arguments: { path: 'a', operationId: 'reuse-me' } } },
    policy: { allowTools: ['fs_read'] },
  });
  assert.throws(
    () => verifyEnvelope(envelope, { secret, policy }),
    (error) => error.code === 'ARENA_ARGUMENTS_INVALID',
  );
});

test('the replay ledger refuses a consumed envelope and persists across instances', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'ledger.json');
  const ledger = new ReplayLedger({ file, fs });
  assert.equal(ledger.has('env-1'), false);
  ledger.add('env-1');
  assert.equal(ledger.has('env-1'), true);
  const reopened = new ReplayLedger({ file, fs });
  assert.equal(reopened.has('env-1'), true);

  const secret = createSecret();
  const envelope = signEnvelope({ secret, keyId: 'ark_test', task: { kind: 'health.delay' } });
  const seen = new Set([envelope.id]);
  assert.throws(() => verifyEnvelope(envelope, { secret, policy, seen }), (error) => error.code === 'ARENA_REPLAY');
});

test('oversized envelopes are refused before they leave the sender', () => {
  const secret = createSecret();
  assert.throws(
    () => signEnvelope({
      secret, keyId: 'ark_test',
      task: { kind: 'tool', payload: { tool: 'fs_read', arguments: { path: 'x'.repeat(70_000) } } },
      policy: { allowTools: ['fs_read'] },
    }),
    (error) => error.code === 'ARENA_ENVELOPE_TOO_LARGE',
  );
});

test('policy loading rejects a missing schema, an empty kind list and a missing keyId', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (value) => {
    const file = path.join(dir, `p-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  assert.equal(loadArenaPolicy(path.join(dir, 'nope.json')).error.code, 'ARENA_POLICY_MISSING');
  assert.equal(loadArenaPolicy(write({ schema: 'other' })).error.code, 'ARENA_POLICY_INVALID');
  assert.equal(loadArenaPolicy(write({ schema: POLICY_SCHEMA, keyId: 'k', allowedKinds: [] })).error.code, 'ARENA_POLICY_INVALID');
  assert.equal(loadArenaPolicy(write({ schema: POLICY_SCHEMA, allowedKinds: ['tool'] })).error.code, 'ARENA_POLICY_INVALID');
  const ok = loadArenaPolicy(write({ schema: POLICY_SCHEMA, keyId: 'k', allowedKinds: ['tool', 'not-a-kind'], allowedTools: ['fs_read'] }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.policy.allowedKinds, ['tool']);
  assert.equal(ENVELOPE_SCHEMA, 'majin.v6.arena.task/v1');
  assert.ok(ArenaError);
});
