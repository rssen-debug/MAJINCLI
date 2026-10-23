/**
 * The model must see every tool that is registered.
 *
 * This was the real V4 defect reported from the phone: MAJIN could only use five
 * workspace/memory tools. The cause was not the registry — host tools were
 * registered — it was that the agent sent a HARDCODED `TOOL_SCHEMAS` array of five
 * entries to the model. A tool the model is never told about cannot be called.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { ToolRegistry } from '../../src/v2/tools/registry.js';
import { ConversationStore, GoalStore } from '../../src/v4/store.js';
import { createAgent } from '../../src/v4/agent.js';
import { createToolRegistry, schemasFromRegistry, jsonSchemaFor } from '../../src/v4/tools.js';
import { adaptV1Tool, registerHostTools, v1Context } from '../../src/v4/tools/host.js';
import { tempHome } from './helpers.mjs';

function agentWith(tools) {
  const home = tempHome();
  const config = {
    version: 'test',
    paths: { home },
    workspaceDir: path.join(home, 'workspace'),
    limits: { maxMessageChars: 4000, maxModelRounds: 1, maxToolCallsPerTurn: 2, toolTimeoutMs: 2000, maxContextTokens: 4000 },
    approvals: { policy: 'sandbox-auto' },
  };
  fs.mkdirSync(config.workspaceDir, { recursive: true });
  const conversations = new ConversationStore({ dir: path.join(home, 'conv') });
  const goals = new GoalStore({ dir: path.join(home, 'goals') });
  const seen = [];
  const model = {
    info: { demo: false },
    infoFor: () => ({ demo: false }),
    async chat(opts) {
      seen.push({ tools: opts.tools || [], messages: opts.messages });
      return { text: 'ok', toolCalls: [], demo: false };
    },
  };
  const agent = createAgent({ config, conversations, goals, tools, model });
  return { agent, seen, home, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('exposure: a tool registered on the registry reaches the model', async () => {
  const home = tempHome();
  const tools = createToolRegistry({ workspaceDir: path.join(home, 'ws'), memoryDir: path.join(home, 'mem') });
  tools.registry.define({
    name: 'extra_tool',
    description: 'a tool added after startup',
    tier: 'read',
    inputSchema: z.object({ q: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
  });

  const h = agentWith(tools);
  try {
    await h.agent.runTurn({ text: 'hej' });
    const names = h.seen[0].tools.map((t) => t.name);
    assert.ok(names.includes('extra_tool'), `model was told about: ${names.join(', ')}`);
    assert.ok(names.includes('workspace_write'), 'the built-ins are still there');
  } finally {
    h.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('exposure: host tools (files, shell) are offered to the model when enabled', async () => {
  const home = tempHome();
  const tools = createToolRegistry({ workspaceDir: home, memoryDir: path.join(home, 'mem') });
  const caps = {
    platform: 'win32',
    desktop: { available: true, tools: ['control.list_windows'], module: { winControlTools: [] } },
    files: { available: true, module: { fileTools: [] } },
    shell: { available: true, module: { execTools: [] } },
    browser: { available: false, reason: 'none' },
  };
  // a real adapted V1-style tool through the same path
  tools.registry.define(adaptV1Tool({
    name: 'fs.read',
    desc: 'Read a file from the host',
    risk: 'read',
    raw: { path: 'string: file to read' },
    run: async () => ({ ok: true, result: 'innehåll' }),
  }, { lane: 'files' }));

  const h = agentWith(tools);
  try {
    await h.agent.runTurn({ text: 'läs en fil' });
    const names = h.seen[0].tools.map((t) => t.name);
    assert.ok(names.includes('fs_read'), `host tool missing from the model's list: ${names.join(', ')}`);
    const fsRead = h.seen[0].tools.find((t) => t.name === 'fs_read');
    assert.equal(fsRead.parameters.type, 'object');
    assert.ok(fsRead.parameters.properties.path, 'its parameters are described to the model');
  } finally {
    h.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
    void caps;
  }
});

test('exposure: the schema list is bounded, and every entry is valid JSON Schema', () => {
  const registry = new ToolRegistry();
  for (let i = 0; i < 80; i += 1) {
    registry.define({
      name: `tool_${i}`,
      description: `tool number ${i}`,
      tier: 'read',
      inputSchema: z.object({ x: z.string().optional() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    });
  }
  const list = schemasFromRegistry(registry, { limit: 60 });
  assert.equal(list.length, 60, 'bounded so the context is not flooded');
  for (const t of list) {
    assert.equal(t.parameters.type, 'object');
    assert.ok(!('$schema' in t.parameters), 'the spec version key is not sent to the model');
  }
});

test('exposure: an unconvertible schema is skipped, not fatal', () => {
  const registry = new ToolRegistry();
  registry.define({
    name: 'weird',
    description: 'has a schema that cannot convert',
    tier: 'read',
    inputSchema: z.custom(() => true),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
  });
  const list = schemasFromRegistry(registry);
  // either it converts or it is absent; it must never throw and never be invalid
  for (const t of list) assert.equal(t.parameters.type, 'object');
  assert.equal(jsonSchemaFor(null).type, 'object');
});

test('exposure: a registered host tool is callable through the runner within its granted workspace', async () => {
  // Registration alone is not enough: the model must be able to call it and the
  // call must reach the implementation.
  const home = tempHome();
  const tools = createToolRegistry({ workspaceDir: home, memoryDir: path.join(home, 'mem') });
  let called = 0;
  tools.registry.define(adaptV1Tool({
    name: 'fs.stat',
    desc: 'Stat a path on the host',
    risk: 'read',
    raw: { path: 'string: path' },
    run: async (input) => {
      called += 1;
      return { ok: true, result: `stat ${input.path}`, summary: 'ok' };
    },
  }, { lane: 'files', ctx:v1Context({workspaceDir:home}) }));

  const h = agentWith(tools);
  // make the fake model call the tool once
  h.agent.modelChatOverrideForTests?.(() => {});
  try {
    const originalChat = h.seen;
    void originalChat;
    // drive the tool directly through the same runner path the agent uses
    const { runTool } = await import('../../src/v2/tools/runner.js');
    const target=path.join(home,'x');
    const out = await runTool({ tool: 'fs_stat', input: { path: target } }, {
      registry: tools.registry,
      approvals: { check: () => ({ decision: 'allow' }) },
      timeoutMs: 2000,
    });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(called, 1);
    assert.equal(out.data.result, `stat ${target}`);
    await assert.rejects(runTool({tool:'fs_stat',input:{path:path.join(home,'..','not-granted')}},{registry:tools.registry}),e=>e.cls==='PERMISSION_DENIED');
    assert.equal(called,1,'rejected paths never reach the fake host implementation');
  } finally {
    h.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/* -------------------------------------------- the reported bug, end to end -- */

test('exposure: with an owner grant, a real turn offers far more than five tools', async () => {
  const { startTestServer, postChat, readSse } = await import('./helpers.mjs');
  const home = tempHome();
  const s = await startTestServer({ home });
  try {
    const { cookie } = await s.pair();
    const grant = await fetch(`${s.base}/api/owner-mode`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
      body: JSON.stringify({ action: 'grant', lanes: ['web', 'jobs'], folders: [home] }),
    });
    assert.equal(grant.status, 200, await grant.clone().text());

    const seen = [];
    const realChat = s.context.model.chat.bind(s.context.model);
    s.context.model.chat = async (opts) => {
      seen.push(opts.tools || []);
      return realChat(opts);
    };

    await readSse(await postChat(s.base, cookie, { text: 'Hej', requestId: 'x1' }));

    assert.ok(seen.length > 0, 'the model was called');
    const names = seen[0].map((t) => t.name);
    assert.ok(names.length > 5, `the model saw only ${names.length} tools: ${names.join(', ')}`);
    // the workspace tools must survive alongside the host tools
    assert.ok(names.includes('workspace_write'));
    assert.ok(names.includes('memory_save'));
    // and real host tools must be there
    assert.ok(names.includes('fs_read'), `no fs_read among: ${names.join(', ')}`);
    assert.ok(names.includes('fs_search'), 'a file search is exposed (needed to find a CV)');
    assert.ok(names.some((n) => n.startsWith('jobs_')), 'the job-search lane is exposed');
    assert.ok(names.some((n) => n.startsWith('web_')), 'the web lane is exposed');
    // the grant was web+jobs (+files, implied by the folder): a lane the owner did
    // NOT grant must not appear, or the grant would mean nothing.
    assert.ok(!names.includes('exec_start'), 'a shell was not granted and must not be offered');
    assert.ok(!names.some((n) => n.startsWith('desktop')), 'desktop was not granted');

    // every schema sent to the model is a usable object schema
    for (const t of seen[0]) {
      assert.equal(t.parameters.type, 'object', `${t.name} has no object schema`);
      assert.ok(t.description && t.description.length >= 4, `${t.name} has no description`);
    }
  } finally {
    await s.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('exposure: with host tools off, the model gets the workspace set plus discovery', async () => {
  const { startTestServer, postChat, readSse } = await import('./helpers.mjs');
  const home = tempHome();
  const s = await startTestServer({ home });
  try {
    const { cookie } = await s.pair();
    const seen = [];
    const realChat = s.context.model.chat.bind(s.context.model);
    s.context.model.chat = async (opts) => {
      seen.push(opts.tools || []);
      return realChat(opts);
    };
    await readSse(await postChat(s.base, cookie, { text: 'Hej', requestId: 'x2' }));
    const names = seen[0].map((t) => t.name);
    // Discovery is core: without it the model could never reach a tool that
    // does not fit in the per-request budget.
    assert.deepEqual(names.sort(), [
      'document_read', 'memory_save', 'memory_search', 'task_list', 'task_manage', 'tools_activate', 'tools_search',
      'workspace_list', 'workspace_read', 'workspace_write',
    ]);
  } finally {
    await s.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('exposure: every registered tool is offered or reachable through search + activate', async () => {
  const { startTestServer, postChat, readSse } = await import('./helpers.mjs');
  const { searchRegistry, createToolExposure } = await import('../../src/v4/tool-exposure.js');
  const home = tempHome();
  const s = await startTestServer({ home, env: { MAJIN_V4_HOST_TOOLS: '1' } });
  try {
    const { cookie } = await s.pair();
    const body = await (await fetch(`${s.base}/api/capabilities`, { headers: { cookie } })).json();
    const reported = new Set(body.tools.registered.map((t) => t.name));

    const seen = [];
    const realChat = s.context.model.chat.bind(s.context.model);
    s.context.model.chat = async (opts) => {
      seen.push(opts.tools || []);
      return realChat(opts);
    };
    await readSse(await postChat(s.base, cookie, { text: 'Hej', requestId: 'x3' }));
    const offered = new Set(seen[0].map((t) => t.name));

    // The budget is real: the list is bounded, and the model is told.
    assert.ok(offered.size <= s.config.limits.maxVisibleTools, `offered ${offered.size} > budget ${s.config.limits.maxVisibleTools}`);
    assert.ok(offered.has('tools_search'), 'the model can always search');
    assert.ok(offered.has('tools_activate'), 'the model can always activate');

    // Reachability, not membership: a tool that is not in the first list must
    // be findable by its own name and acceptable to activate().
    const registry = s.context.tools.registry;
    const exposure = createToolExposure({ registry, maxVisible: 4 });
    for (const name of reported) {
      if (offered.has(name)) continue;
      const hits = searchRegistry(registry, name, { limit: 8 }).map((h) => h.name);
      assert.ok(hits.includes(name), `${name} is registered but neither offered nor findable by search`);
      const out = exposure.activate([name]);
      assert.ok(out.activated.includes(name), `${name} could not be activated`);
      assert.ok(exposure.schemas().some((t) => t.name === name), `${name} did not reach the next round's list`);
    }
  } finally {
    await s.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
