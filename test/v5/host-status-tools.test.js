import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GrandArchitect } from '../../src/v5/architect.js';
import { createHostStatusTools } from '../../src/v5/host-status-tools.js';

const SECRET = 'sk-host-status-secret-1234567890';
const URL_PASSWORD = 'url-password-secret';
const URL_QUERY = 'query-secret-value';

function snapshotFiles(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) {
        files[path.relative(root, target)] = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      }
    }
  };
  walk(root);
  return files;
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-host-status-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const architect = new GrandArchitect({ dataDir: root });
  await architect.providers.configureProvider({
    providerId: 'opencode-go',
    apiKey: SECRET,
    baseUrl: `https://owner:${URL_PASSWORD}@example.test/v1?token=${URL_QUERY}#fragment`,
    discover: false,
  });
  architect.providers.selectModel({
    providerId: 'opencode-go',
    modelId: 'host-status-model',
    allowManualFallback: true,
  });
  architect.files.enableOwnerMode({ folders: [architect.workspaceDir] });
  architect.memoryStore.put('preference', {
    key: 'report-style',
    text: 'Owner prefers concise reports with independent evidence.',
    tags: ['report', 'evidence'],
    importance: 0.95,
  });
  architect.memoryStore.put('project', {
    key: 'majin-cli',
    text: 'The CLI release marker is HOST-STATUS-MEMORY-42.',
    tags: ['majin', 'cli'],
    importance: 0.8,
  });
  const goal = {
    goal_id: 'goal-host-status',
    objective: 'Inspect the MAJIN host safely',
    status: 'RUNNING',
    criteria: [{ kind: 'file', path: 'proof.txt' }],
    budget: { maxRounds: 20 },
    cost: { modelCalls: 2, inputTokens: 100, outputTokens: 25 },
    tool_results: [{ tool: 'fs_read', ok: true, status: 'completed', operationId: 'op-1' }],
    verification_evidence: [],
    trace: [{ seq: 1, type: 'goal_started' }],
    adaptive: { mode: 'direct', needsReplan: false, verificationFailures: 0, plan: [] },
    delegation: { batches: [], tasks: {} },
    context: { compacted: false, sentMessages: 3 },
  };
  const tools = createHostStatusTools({
    architect,
    goal,
    getRuntimeSnapshot: () => ({
      controller: 'provider',
      driverToolCount: 42,
      hostTools: ['majin_status', 'majin_doctor', 'majin_provider', 'majin_memory'],
      visibleToolCount: 40,
      maxVisibleTools: 64,
      browserAvailable: true,
    }),
  });
  return { root, architect, goal, tools };
}

test('read-only host status tools expose useful V5 state without secrets or writes', async (t) => {
  const { root, architect, tools } = await fixture(t);
  assert.deepEqual([...tools.keys()], ['majin_status', 'majin_doctor', 'majin_provider', 'majin_memory']);
  for (const tool of tools.values()) assert.equal(tool.inputSchema.additionalProperties, false);

  const before = snapshotFiles(root);
  const status = await tools.get('majin_status').run({ detail: 'full' });
  const doctor = await tools.get('majin_doctor').run({});
  const providers = await tools.get('majin_provider').run({ action: 'list' });
  const models = await tools.get('majin_provider').run({ action: 'models' });
  const memoryStatus = await tools.get('majin_memory').run({ action: 'status' });
  const memorySearch = await tools.get('majin_memory').run({ action: 'read', query: 'HOST-STATUS-MEMORY-42' });
  const memoryKey = await tools.get('majin_memory').run({ action: 'read', kind: 'preference', key: 'report-style' });
  const after = snapshotFiles(root);

  assert.deepEqual(after, before, 'host status tools must not write any state file');
  const serialized = JSON.stringify({ status, doctor, providers, models, memoryStatus, memorySearch, memoryKey });
  assert.doesNotMatch(serialized, new RegExp(SECRET));
  assert.doesNotMatch(serialized, /maskedKey/);
  assert.doesNotMatch(serialized, new RegExp(URL_PASSWORD));
  assert.doesNotMatch(serialized, new RegExp(URL_QUERY));
  assert.equal(architect.providers.getPublicState().providers['opencode-go'].hasKey, true);

  assert.equal(status.readOnly, true);
  assert.equal(status.workspaceDir, architect.workspaceDir);
  assert.equal(status.provider.canonicalSelection, 'opencode-go/host-status-model');
  assert.equal(status.provider.activeProviderHasKey, true);
  assert.equal(status.provider.active.baseUrl, 'https://example.test/v1');
  assert.equal(status.goal.id, 'goal-host-status');
  assert.equal(status.goal.toolResults.ok, 1);
  assert.ok(status.skills.totalSkills > 0);
  assert.equal(status.memory.total, 2);

  assert.equal(doctor.readOnly, true);
  assert.equal(doctor.healthy, true, JSON.stringify(doctor.checks.filter((item) => item.status === 'fix')));
  assert.equal(doctor.broken, 0);
  assert.ok(!doctor.nextActions.some((action) => /writable/.test(action)), 'healthy directories must not produce fix actions');
  assert.equal(doctor.checks.find((item) => item.id === 'provider-key')?.status, 'ok');
  assert.equal(doctor.checks.find((item) => item.id === 'provider-verified')?.status, 'note');
  assert.equal(doctor.checks.find((item) => item.id === 'tool-exposure')?.status, 'ok');

  assert.equal(providers.activeModelId, 'host-status-model');
  assert.equal(providers.providers.find((item) => item.id === 'opencode-go')?.hasKey, true);
  assert.equal(providers.routing.parentModel, 'opencode-go/host-status-model');
  assert.equal(providers.routing.independentPerJobRoutes, false);
  assert.deepEqual(models.models.map((model) => model.id), ['host-status-model']);
  assert.equal(models.models[0].discovered, false);
  assert.equal(models.models[0].capabilities.streaming, true);

  assert.equal(memoryStatus.total, 2);
  assert.equal(memoryStatus.byKind.preference, 1);
  assert.equal(memorySearch.entries[0].text, 'The CLI release marker is HOST-STATUS-MEMORY-42.');
  assert.equal(memoryKey.entries[0].key, 'report-style');
  assert.equal(memoryKey.trusted, false);
});

test('host status schemas reject provider mutation, API keys and destructive memory actions', async (t) => {
  const { tools } = await fixture(t);
  assert.throws(
    () => tools.get('majin_provider').run({ action: 'add', apiKey: SECRET }),
    (error) => error?.name === 'ZodError',
  );
  assert.throws(
    () => tools.get('majin_provider').run({ action: 'remove' }),
    (error) => error?.name === 'ZodError',
  );
  assert.throws(
    () => tools.get('majin_memory').run({ action: 'clear' }),
    (error) => error?.name === 'ZodError',
  );
  assert.throws(
    () => tools.get('majin_memory').run({ action: 'read', kind: 'secrets', query: 'key' }),
    (error) => error?.name === 'ZodError',
  );
  assert.throws(
    () => tools.get('majin_status').run({ detail: 'full', includeSecrets: true }),
    (error) => error?.name === 'ZodError',
  );
});
