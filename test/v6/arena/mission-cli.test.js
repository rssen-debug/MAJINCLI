/**
 * The mission CLI, in a real subprocess, against a local OpenAI-compatible
 * endpoint. The endpoint is a scripted stub (that is the fixture); the CLI, the
 * queue, the supervisor, the V5 drivers and the journal are production code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { POLICY_SCHEMA } from '../../../src/v6/arena/envelope.js';

const run = promisify(execFile);
const BIN = path.resolve('bin/majin-v6.mjs');

/** A non-zero exit is data here: budget_steps is 3, needs_owner is 2. */
async function runTolerant(file, args, options) {
  try {
    return await run(file, args, options);
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.trim()) {
      return { stdout: error.stdout, stderr: error.stderr || '', code: error.code };
    }
    throw error;
  }
}

async function stubModel(t) {
  let calls = 0;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const digest = String(body.messages?.at(-1)?.content || '');
    calls += 1;
    let decision;
    if (/sha256/.test(digest) && /note\.txt/.test(digest)) decision = { action: 'stop', done: true, summary: 'hash produced' };
    else if (/note\.txt/.test(digest)) decision = { action: 'tool', payload: { tool: 're_hash', arguments: { path: 'note.txt' } }, rationale: 'hash the note' };
    else decision = { action: 'tool', payload: { tool: 'fs_write', arguments: { path: 'note.txt', content: 'cli mission\n' } }, rationale: 'write the note' };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      model: 'stub-local',
      choices: [{ message: { content: JSON.stringify(decision) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 300, completion_tokens: 25 },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, calls: () => calls };
}

function buildHome(t, { plannerUrl, actions = ['tool'], tools = ['fs_write', 're_hash'] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-mission-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'v6');
  const workspace = path.join(root, 'work');
  const dataDir = path.join(root, 'v5');
  fs.mkdirSync(path.join(home, 'arena'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'owner-mode.json'), JSON.stringify({
    schema: 'majin.v4.owner-mode/v1', version: 1, lanes: ['files', 're'], folders: [workspace], browserOrigins: [], history: [],
  }));
  fs.writeFileSync(path.join(home, 'arena', 'policy.json'), JSON.stringify({
    schema: POLICY_SCHEMA,
    keyId: 'ark_cli_mission',
    allowedKinds: ['tool'],
    allowedTools: tools,
    allowIrreversible: false,
    planner: { provider: 'openai', baseUrl: `${plannerUrl}/v1`, model: 'stub-local', maxTokens: 512 },
  }));
  const missionFile = path.join(root, 'mission.json');
  fs.writeFileSync(missionFile, JSON.stringify({
    schema: 'majin.v6.arena.mission/v1',
    id: 'cli-mission',
    goal: 'Write a note in the workspace and hash it with MAJIN.',
    constraints: ['stay inside the workspace'],
    allowedActions: actions,
    allowedTools: tools,
    stopWhen: 'the hash exists',
    budget: { maxSteps: 6, maxTokens: 50000, maxWallMs: 120000, maxCostUsd: 1, maxSubmissions: 0 },
  }));
  return { root, home, workspace, dataDir, missionFile };
}

function env(home) {
  return { ...process.env, MAJIN_V6_HOME: home, OPENAI_API_KEY: 'local-stub-key', MAJIN_ARENA_PROVIDER: 'openai' };
}

test('a mission runs, stops on budget and resumes without repeating work', { timeout: 120000 }, async (t) => {
  const stub = await stubModel(t);
  const fixture = buildHome(t, { plannerUrl: stub.url });

  const first = await runTolerant(process.execPath, [
    BIN, 'arena', 'mission', '--mission', fixture.missionFile, '--json',
    '--workspace', fixture.workspace, '--data-dir', fixture.dataDir, '--max-steps', '1',
  ], { timeout: 60000, env: env(fixture.home) });
  const firstSummary = JSON.parse(first.stdout);
  assert.equal(firstSummary.stopReason, 'budget_steps', first.stdout);
  assert.equal(firstSummary.steps, 1);
  assert.equal(fs.readFileSync(path.join(fixture.workspace, 'note.txt'), 'utf8'), 'cli mission\n');

  const second = await run(process.execPath, [
    BIN, 'arena', 'mission', '--mission', fixture.missionFile, '--json', '--resume',
    '--workspace', fixture.workspace, '--data-dir', fixture.dataDir,
  ], { timeout: 60000, env: env(fixture.home) });
  const secondSummary = JSON.parse(second.stdout);
  assert.equal(secondSummary.stopReason, 'done', second.stdout);
  assert.equal(secondSummary.resumedFrom, 1, 'the resume must start after the finished step');

  const listed = await run(process.execPath, [BIN, 'queue', 'list', '--json'], { timeout: 30000, env: env(fixture.home) });
  const tasks = JSON.parse(listed.stdout);
  const list = Array.isArray(tasks) ? tasks : tasks.tasks;
  assert.equal(list.length, 2, 'step 1 was not enqueued twice');
  assert.ok(list.every((task) => task.state === 'COMPLETED'));

  const content = fs.readFileSync(path.join(fixture.workspace, 'note.txt'));
  const hashed = list.find((task) => task.result?.output?.meta?.hashes);
  assert.ok(hashed, 'the hash task kept its real output');
  assert.equal(hashed.result.output.meta.hashes[0].sha256, createHash('sha256').update(content).digest('hex'));

  const journal = fs.readFileSync(path.join(fixture.home, 'arena', 'missions', 'cli-mission.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(journal.some((entry) => entry.phase === 'complete'));
  assert.ok(journal.every((entry) => typeof entry.rationale !== 'string' || entry.rationale.length <= 240));
});

test('an irreversible mission refuses to start without the explicit flag', { timeout: 60000 }, async (t) => {
  const stub = await stubModel(t);
  const fixture = buildHome(t, { plannerUrl: stub.url, actions: ['tool', 'job.submit'], tools: ['fs_write'] });
  let failure = null;
  try {
    await run(process.execPath, [
      BIN, 'arena', 'mission', '--mission', fixture.missionFile, '--json',
      '--workspace', fixture.workspace, '--data-dir', fixture.dataDir,
    ], { timeout: 30000, env: env(fixture.home) });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'the mission must fail fast');
  const payload = JSON.parse(failure.stdout);
  assert.equal(payload.code, 'MISSION_IRREVERSIBLE_NOT_ENABLED');
  assert.equal(stub.calls(), 0, 'no model call is made for a mission that cannot start');
});

test('--dry-run shows the state without calling a model or queueing work', { timeout: 60000 }, async (t) => {
  const stub = await stubModel(t);
  const fixture = buildHome(t, { plannerUrl: stub.url });
  const result = await run(process.execPath, [
    BIN, 'arena', 'mission', '--mission', fixture.missionFile, '--json', '--dry-run',
    '--workspace', fixture.workspace, '--data-dir', fixture.dataDir,
  ], { timeout: 30000, env: env(fixture.home) });
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.wouldStartAtStep, 0);
  assert.equal(stub.calls(), 0, 'a dry run never calls the provider');
  assert.equal(fs.existsSync(path.join(fixture.workspace, 'note.txt')), false, 'a dry run executes nothing');
});
