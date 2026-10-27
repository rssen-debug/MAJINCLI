#!/usr/bin/env node
/**
 * OpenCode stdio MCP bridge -> MAJIN's EXISTING V5 deterministic CodexDriver.
 * This is not a second model runtime. No provider/model is changed.
 * Only the owner's already-persisted MAJIN grants are honored; never writes grants.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CodexDriver } from '../src/v5/codex-driver.js';
import { OwnerMode } from '../src/v4/owner-mode.js';
import { isAuthorized, filterCatalog, fingerprintGrants } from '../src/v5/opencode-bridge-policy.js';

export const MCP_TOOLS = Object.freeze([
  {
    name: 'majin_status', description: 'Read the actual MAJIN tool bridge status, configured grants and available tool count. No actions are performed.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'majin_tools_search', description: 'Search the actual owner-authorized MAJIN tool catalog (not a fabricated list of 1000). Call majin_tool_schema for input shape, then majin_tool_call.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Search name, capability, or description' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'majin_tool_schema', description: 'Read the exact inputSchema for one available MAJIN tool. This does not execute the tool.',
    inputSchema: { type: 'object', properties: {
      name: { type: 'string', description: 'Exact name from majin_tools_search' },
    }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'majin_tool_call', description: 'Execute an owner-authorized MAJIN tool through its existing persistent, idempotent driver. First read its schema. Supply a stable operationId; NEVER reuse a new ID to retry an uncertain job submission. Inspect receipts/operation state instead.',
    inputSchema: { type: 'object', properties: {
      name: { type: 'string', description: 'Exact tool name' },
      operationId: { type: 'string', minLength: 1, maxLength: 160, description: 'Stable ID for exactly this effect, reused only for the same arguments' },
      arguments: { type: 'object', description: 'Exact tool-specific arguments from majin_tool_schema', additionalProperties: true },
    }, required: ['name', 'operationId', 'arguments'], additionalProperties: false },
  },
]);

const textResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
const fault = error => ({ content: [{ type: 'text', text: String(error?.message || error).slice(0, 500) }], isError: true });

export function parseBridgeOptions(argv = process.argv.slice(2), env = process.env) {
  const arg = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : argv[index + 1];
  };
  const root = arg('--workspace', process.cwd());
  const data = arg('--data-dir', env.MAJIN_V5_DATA_DIR || path.join(env.LOCALAPPDATA || path.join(env.HOME || process.cwd(), '.local', 'share'), 'MAJIN', 'v5'));
  if (!root || !data) throw new Error('workspace and MAJIN V5 data dir must be defined');
  return {
    workspace: path.resolve(root),
    dataDir: path.resolve(data),
    doctor: argv.includes('--doctor'),
  };
}

export function createBridge({ workspace, dataDir, Driver = CodexDriver, getOwner = null } = {}) {
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    throw new Error('Existing MAJIN V5 data directory not found; refusing to create a new profile');
  }
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error('OpenCode workspace directory not found');
  }
  const grantFile = path.join(dataDir, 'owner-mode.json');
  // Read fresh grants on each action, so a later owner revocation fails closed.
  const rights = getOwner || (() => {
    const owner = new OwnerMode({ file: grantFile });
    return { lanes: owner.activeLanes(), folders: owner.folders() };
  });
  const first = rights();
  const initial = fingerprintGrants(first);
  const opts = {
    workspace,
    stateDir: path.join(dataDir, 'opencode-driver'),
    allowedFolders: first.folders,
    grantedLanes: first.lanes,
    browser: first.lanes.includes('browser'),
    desktop: first.lanes.includes('desktop') || first.lanes.includes('computer'),
    processAccess: first.lanes.includes('shell') || first.lanes.includes('shelltools'),
    browserWriteOrigins: [], // Crucial: revocable grants are read LIVE from owner-mode.json by worker.
    browserWriteOriginsFile: grantFile,
    browserVisible: true,
    timeoutMs: 120000,
  };
  let driver = null;
  let boot = null;
  async function start() {
    if (driver?.catalog) return driver;
    if (!boot) boot = (async () => {
      const instance = new Driver(opts);
      try {
        await instance.start();
        driver = instance;
        return instance;
      } catch (e) {
        await instance.close().catch(() => {});
        throw e;
      }
    })().catch(e => { boot = null; throw e; });
    return boot;
  }
  function assertUnchanged() {
    const now = rights();
    if (fingerprintGrants(now) !== initial) {
      throw new Error('MAJIN owner permissions changed. Restart OpenCode to apply grants/revocations before any further tool call.');
    }
    return now.lanes;
  }
  async function operate(name, args = {}) {
    try {
      if (!MCP_TOOLS.some(x => x.name === name)) throw new Error('Unknown bridge tool');
      const d = await start();
      const lanes = assertUnchanged();
      const catalog = d.list();
      if (name === 'majin_status') {
        const available = catalog.filter(t => isAuthorized(t, lanes));
        return textResult({ bridge: 'MAJIN OpenCode MCP', operational: true,
          provider: 'OpenCode retains its existing model (no MAJIN provider started)',
          registered: catalog.length, authorized: available.length, ownerGrantedLanes: lanes,
          note: 'Tools registered or authorized are not proof that a live job or Gmail operation works.' });
      }
      if (name === 'majin_tools_search') {
        if (typeof args.query !== 'string') throw new Error('query must be a string');
        return textResult({ matches: filterCatalog(catalog, lanes, args.query, args.limit || 20),
          note: 'This is the real available tool catalog; other legacy tools may be unavailable.' });
      }
      if (name === 'majin_tool_schema') {
        const entry = catalog.find(t => t.name === args.name && isAuthorized(t, lanes));
        if (!entry) throw new Error('MAJIN tool not found or not authorized');
        return textResult({ name: entry.name, source: entry.source || null, lane: entry.lane || null, inputSchema: entry.inputSchema });
      }
      if (typeof args.name !== 'string' || typeof args.operationId !== 'string' ||
          !args.operationId || args.operationId.length > 160 ||
          !args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments)) {
        throw new Error('majin_tool_call needs exact name, stable operationId and object arguments');
      }
      const entry = catalog.find(t => t.name === args.name && isAuthorized(t, lanes));
      if (!entry) throw new Error('Tool missing or owner permission denied');
      if (Object.hasOwn(args.arguments, 'operationId')) throw new Error('Put operationId only at the outer MCP call level');
      return await d.call(entry.name, { ...args.arguments, operationId: args.operationId });
    } catch (error) {
      return fault(error);
    }
  }
  async function cancel(opId) {
    if (driver?.active?.record?.operationId === opId) return driver.cancel(opId);
  }
  async function close() {
    if (driver) await driver.close();
    driver = null;
  }
  return { operate, start, close, cancel };
}

export async function serveBridge(argv = process.argv.slice(2)) {
  const opts = parseBridgeOptions(argv);
  const bridge = createBridge(opts);
  if (opts.doctor) {
    const result = await bridge.operate('majin_status');
    process.stdout.write(result.content[0].text + '\n');
    await bridge.close();
    if (result.isError) process.exitCode = 1;
    return;
  }
  // MCP reserves stdout; every nonprotocol message goes to stderr.
  console.log = (...args) => console.error(...args);
  const write = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const inflight = new Map();
  let initialized = false;
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const respond = async msg => {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.method === 'notifications/cancelled') {
      const opId = inflight.get(msg.params?.requestId);
      if (opId) await bridge.cancel(opId).catch(() => {});
      return;
    }
    if (msg.id == null) return;
    try {
      let result;
      if (msg.method === 'initialize') {
        initialized = true;
        result = {
          protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(msg.params?.protocolVersion)
            ? msg.params.protocolVersion : '2025-06-18',
          serverInfo: { name: 'majin-opencode-tools', version: '1.0.0' },
          capabilities: { tools: {} },
        };
      } else if (!initialized) throw new Error('MCP initialize required');
      else if (msg.method === 'ping') result = {};
      else if (msg.method === 'tools/list') result = { tools: MCP_TOOLS };
      else if (msg.method === 'tools/call') {
        const args = msg.params?.arguments || {};
        if (msg.params?.name === 'majin_tool_call') inflight.set(msg.id, args.operationId);
        try { result = await bridge.operate(msg.params?.name, args); }
        finally { inflight.delete(msg.id); }
      } else { write({ id: msg.id, error: { code: -32601, message: 'Method not found' } }); return; }
      write({ id: msg.id, result });
    } catch (error) {
      write({ id: msg.id, error: { code: -32603, message: String(error.message).slice(0, 400) } });
    }
  };
  rl.on('line', line => {
    if (Buffer.byteLength(line) > 4 * 1024 * 1024) return;
    try { respond(JSON.parse(line)).catch(e => console.error(e.message)); }
    catch { write({ id: null, error: { code: -32700, message: 'Invalid JSON' } }); }
  });
  let closing = false;
  const cleanup = async () => {
    if (closing) return;
    closing = true;
    await bridge.close().catch(e => console.error(e.message));
  };
  rl.once('close', () => { cleanup().catch(() => {}); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => cleanup().finally(() => process.exit(0)));
}

// Import-safe: tests can exercise policy without running a long-lived MCP process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveBridge().catch(error => { console.error('MAJIN MCP: ' + error.message); process.exitCode = 1; });
}
