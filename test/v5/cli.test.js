import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProviderManager } from '../../src/v5/providers.js';

const BIN = fileURLToPath(new URL('../../bin/majin-v5.mjs', import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-cli-'));
  const dataDir = path.join(root, 'data');
  const workspace = path.join(dataDir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dataDir, workspace };
}

function runCli(args, { root, timeoutMs = 120000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        MAJIN_HOME: path.join(root, 'majin-home'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out: ${args.join(' ')}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    assert.fail(`expected JSON stdout, got status=${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
}

const toolCall = (id, name, args) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

async function fakeProvider(t, respond) {
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (req.method === 'GET') {
      requests.push({ body: {}, headers: req.headers, url: req.url, method: req.method });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [
        { id: 'deepseek-v4-pro', tools: true },
        { id: 'deepseek-v4-flash', tools: true },
      ] }));
      return;
    }
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ body, headers: req.headers, url: req.url, method: req.method });
    const message = await respond(body, requests.length);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'cli-local-response',
      model: body.model,
      choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(async () => new Promise((resolve) => upstream.close(resolve)));
  return { requests, baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` };
}

async function configureProvider(dataDir, baseUrl) {
  const providers = new ProviderManager({ dataDir });
  await providers.configureProvider({ providerId: 'opencode-go', apiKey: 'local-test-key', baseUrl });
  providers.selectModel({ providerId: 'opencode-go', modelId: 'deepseek-v4-pro', allowManualFallback: true });
}

test('CLI grants persist, doctor reports parity, and tools call executes through the isolated driver', async (t) => {
  const fx = fixture(t);

  const help = await runCli(['help'], fx);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /majin-v5 run "Gör XYZ"/);
  assert.match(help.stdout, /tools call <tool_name>/);
  assert.match(help.stdout, /grants grant/);

  const version = await runCli(['version'], fx);
  assert.equal(version.status, 0, version.stderr);
  assert.doesNotMatch(version.stdout, /undefined/);

  const granted = await runCli(['grants', 'grant', '--data-dir', fx.dataDir, '--lanes', 'files,sys,re', '--json'], fx);
  assert.equal(granted.status, 0, granted.stderr);
  const grantJson = parseJson(granted);
  assert.deepEqual(new Set(grantJson.grantedLanes), new Set(['files', 'sys', 're']));
  assert.ok(grantJson.grantedFolders.includes(fx.workspace));

  const doctor = await runCli(['doctor', '--data-dir', fx.dataDir, '--json'], fx);
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorJson = parseJson(doctor);
  assert.equal(doctorJson.toolParity.universe, 155);
  assert.ok(doctorJson.toolParity.available >= 35, `expected bridge lanes in doctor parity, got ${doctorJson.toolParity.available}`);
  assert.equal(doctorJson.provider.activeModelId, null);

  fs.writeFileSync(path.join(fx.workspace, 'sample.bin'), 'cli proof');
  const call = await runCli([
    'tools', 'call', 're_hash',
    '--data-dir', fx.dataDir,
    '--args', JSON.stringify({ path: 'sample.bin' }),
    '--operation-id', 'cli-test-re-hash',
    '--json',
  ], fx);
  assert.equal(call.status, 0, call.stderr);
  const callJson = parseJson(call);
  assert.equal(callJson.structuredContent.status, 'completed');
  assert.equal(callJson.structuredContent.result.meta.hashes[0].sha256.length, 64);

  const unavailable = await runCli(['tools', 'call', 'research_run', '--data-dir', fx.dataDir, '--json'], fx);
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /Tool is not available in this driver: research_run/);
});

test('CLI run refuses to fake a free-form goal when no provider model is configured', async (t) => {
  const fx = fixture(t);
  const result = await runCli(['run', 'Create a file', '--data-dir', fx.dataDir], fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No active provider model is configured/);
  assert.match(result.stderr, /tools call/);
});

test('CLI run, bare goal form, logs and completed resume use the live provider agent end to end', async (t) => {
  const fx = fixture(t);
  const script = { round: 0, file: 'cli-proof.txt', content: 'verified cli' };
  const provider = await fakeProvider(t, () => {
    script.round += 1;
    if (script.round === 1) return toolCall('write-proof', 'fs_write', { path: script.file, content: script.content });
    return { role: 'assistant', content: `Created ${script.file}.` };
  });
  await configureProvider(fx.dataDir, provider.baseUrl);

  const criteria = JSON.stringify([{ kind: 'file', path: 'cli-proof.txt', contains: 'verified cli' }]);
  const run = await runCli(['run', 'Create cli-proof.txt with verified cli content', '--data-dir', fx.dataDir, '--criteria', criteria, '--lanes', 'sys,re', '--json'], fx);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(parseJson(run).status, 'COMPLETED');
  assert.equal(fs.readFileSync(path.join(fx.workspace, 'cli-proof.txt'), 'utf8'), 'verified cli');
  assert.equal(new Set(provider.requests.map((r) => r.headers['x-opencode-session'])).size, 1);
  const advertised = new Set(provider.requests[0].body.tools.map((tool) => tool.function?.name || tool.name));
  assert.ok(advertised.has('sys_info'), 'explicit CLI sys lane must reach the live provider catalog');
  assert.ok(advertised.has('re_hash'), 'explicit CLI re lane must reach the live provider catalog');
  const grants = await runCli(['grants', 'show', '--data-dir', fx.dataDir, '--json'], fx);
  assert.equal(grants.status, 0, grants.stderr);
  assert.ok(parseJson(grants).grantedLanes.includes('sys'));
  assert.ok(parseJson(grants).grantedLanes.includes('re'));

  script.round = 0;
  script.file = 'bare-proof.txt';
  script.content = 'verified bare';
  const bareCriteria = JSON.stringify([{ kind: 'file', path: 'bare-proof.txt', contains: 'verified bare' }]);
  const bare = await runCli(['Create bare-proof.txt with verified bare content', '--data-dir', fx.dataDir, '--criteria', bareCriteria, '--json'], fx);
  assert.equal(bare.status, 0, `${bare.stdout}\n${bare.stderr}`);
  assert.equal(parseJson(bare).status, 'COMPLETED');
  assert.equal(fs.readFileSync(path.join(fx.workspace, 'bare-proof.txt'), 'utf8'), 'verified bare');

  const logs = await runCli(['logs', '--data-dir', fx.dataDir, '--json'], fx);
  assert.equal(logs.status, 0, logs.stderr);
  const logsJson = parseJson(logs);
  assert.equal(logsJson.goal.status, 'COMPLETED');
  assert.match(logsJson.goal.objective, /bare-proof/);
  assert.ok(logsJson.goal.tool_results.some((row) => row.tool === 'fs_write' && row.ok));

  const beforeResume = provider.requests.length;
  const resumed = await runCli(['resume', '--data-dir', fx.dataDir, '--json'], fx);
  assert.equal(resumed.status, 0, `${resumed.stdout}\n${resumed.stderr}`);
  assert.equal(parseJson(resumed).goal.status, 'COMPLETED');
  assert.equal(provider.requests.length, beforeResume, 'completed resume must not call the model or replay tools');
});

test('CLI model commands configure from env, discover a live catalog, and never echo the secret', async (t) => {
  const fx = fixture(t);
  const provider = await fakeProvider(t, () => ({ role: 'assistant', content: 'not used in this test' }));

  const rawKey = await runCli([
    'model', 'configure', '--data-dir', fx.dataDir, '--provider', 'opencode-go', '--api-key', 'do-not-print-me',
  ], fx);
  assert.equal(rawKey.status, 1);
  assert.match(rawKey.stderr, /Refusing --api-key in argv/);
  assert.doesNotMatch(rawKey.stderr, /do-not-print-me/);

  const configured = await runCli([
    'model', 'configure',
    '--data-dir', fx.dataDir,
    '--provider', 'opencode-go',
    '--base-url', provider.baseUrl,
    '--api-key-env', 'TEST_PROVIDER_KEY',
    '--discover',
    '--json',
  ], { ...fx, env: { TEST_PROVIDER_KEY: 'local-test-key' } });
  assert.equal(configured.status, 0, `${configured.stdout}\n${configured.stderr}`);
  assert.doesNotMatch(configured.stdout, /local-test-key/);
  const configuredJson = parseJson(configured);
  assert.equal(configuredJson.discovery.ok, true);
  assert.deepEqual(configuredJson.discovery.models, ['deepseek-v4-pro', 'deepseek-v4-flash']);
  assert.equal(configuredJson.provider.activeProvider, 'opencode-go');
  assert.equal(configuredJson.provider.activeModelId, 'deepseek-v4-pro');
  assert.equal(configuredJson.provider.connectionVerified, true);
  assert.equal(configuredJson.provider.providers['opencode-go'].hasKey, true);
  assert.equal(configuredJson.provider.providers['opencode-go'].maskedKey, 'loc••••ey');

  const selected = await runCli(['model', 'select', 'deepseek-v4-flash', '--data-dir', fx.dataDir, '--json'], fx);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(parseJson(selected).activeModelId, 'deepseek-v4-flash');
  assert.equal(parseJson(selected).canonicalSelection, 'opencode-go/deepseek-v4-flash');

  const listed = await runCli(['model', 'list', '--data-dir', fx.dataDir, '--json'], fx);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(parseJson(listed).providers['opencode-go'].discoveredModels, ['deepseek-v4-pro', 'deepseek-v4-flash']);

  const status = await runCli(['model', 'status', '--data-dir', fx.dataDir], fx);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Active model: opencode-go\/deepseek-v4-flash/);
  assert.doesNotMatch(status.stdout, /local-test-key/);
});
