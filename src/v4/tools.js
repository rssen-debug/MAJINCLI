/**
 * MAJIN V4 — the tool surface.
 *
 * Every tool is a V2 `ToolDefinition` and every call goes through the V2
 * runner: input schema -> approval policy -> execute with timeout -> output
 * schema. V4 adds only the workspace boundary and the JSON schemas the model
 * sees. Nothing here can reach outside the workspace sandbox.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ToolRegistry } from '../v2/tools/registry.js';
import { runTool } from '../v2/tools/runner.js';
import { MemoryStore } from '../v2/memory/store.js';

export const MAX_FILE_BYTES = 1_000_000;
export const MAX_READ_BYTES = 200_000;

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SEPARATORS = /[\\/]/;

export class WorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    // Map onto the V2 failure-class vocabulary so the scheduler and receipts
    // speak one language (src/v2/runtime/errors.js).
    this.cls = code === 'INVALID_PATH' || code === 'PERMISSION_DENIED'
      ? 'PERMISSION_DENIED'
      : code === 'TOO_LARGE' || code === 'INVALID_INPUT'
        ? 'INVALID_TOOL_OUTPUT'
        : code === 'FILE_EXISTS' || code === 'NOT_FOUND' || code === 'NOT_A_FILE'
          ? 'STALE_STATE'
          : 'UNKNOWN';
  }
}

/** A flat, create-only workspace: leaf filenames only, no traversal. */
export function safeFileName(raw) {
  if (typeof raw !== 'string') throw new WorkspaceError('INVALID_INPUT', 'fileName must be a string');
  const name = raw.trim();
  if (!name) throw new WorkspaceError('INVALID_INPUT', 'fileName is empty');
  if (name.length > 120) throw new WorkspaceError('INVALID_INPUT', 'fileName is too long');
  if (SEPARATORS.test(name) || name.includes('\0')) {
    throw new WorkspaceError('INVALID_PATH', 'fileName must be a leaf name without path separators');
  }
  if (name === '.' || name === '..' || name.startsWith('.')) {
    throw new WorkspaceError('INVALID_PATH', 'fileName may not start with a dot');
  }
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) {
    throw new WorkspaceError('INVALID_PATH', 'fileName contains characters that are invalid on Windows');
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    throw new WorkspaceError('INVALID_PATH', 'fileName may not end with a dot or space');
  }
  if (RESERVED.test(name)) throw new WorkspaceError('INVALID_PATH', 'fileName is a reserved Windows device name');
  return name;
}

export function workspaceRoot(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return fs.realpathSync(dir);
}

function targetFor(root, rawName) {
  const name = safeFileName(rawName);
  const target = path.join(root, name);
  if (path.dirname(target) !== root) {
    throw new WorkspaceError('INVALID_PATH', 'resolved path escapes the workspace');
  }
  return { name, target };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Build the registry. `workspaceDir` is resolved once; `memory` is the V2
 * store so preferences written by MAJIN are readable by the rest of MAJIN.
 */
export function createToolRegistry({ workspaceDir, memoryDir }) {
  const root = workspaceRoot(workspaceDir);
  const memory = new MemoryStore(memoryDir);
  const registry = new ToolRegistry();

  registry.define({
    name: 'workspace_write',
    description: 'Create a new text file in the user workspace. Fails if the file already exists; never overwrites.',
    tier: 'write',
    inputSchema: z.object({
      fileName: z.string().min(1).max(120),
      content: z.string().max(MAX_FILE_BYTES),
    }),
    outputSchema: z.object({
      status: z.literal('created'),
      fileName: z.string(),
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().length(64),
    }),
    execute: async ({ fileName, content }) => {
      const { name, target } = targetFor(root, fileName);
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > MAX_FILE_BYTES) throw new WorkspaceError('TOO_LARGE', `content exceeds ${MAX_FILE_BYTES} bytes`);
      let fd;
      try {
        fd = fs.openSync(target, 'wx', 0o600);
      } catch (err) {
        if (err.code === 'EEXIST') throw new WorkspaceError('FILE_EXISTS', `"${name}" already exists in the workspace`);
        if (err.code === 'EACCES' || err.code === 'EPERM') throw new WorkspaceError('PERMISSION_DENIED', `permission denied writing "${name}"`);
        throw err;
      }
      try {
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return { status: 'created', fileName: name, path: target, bytes, sha256: sha256(Buffer.from(content, 'utf8')) };
    },
  });

  registry.define({
    name: 'workspace_read',
    description: 'Read a text file from the user workspace.',
    tier: 'read',
    inputSchema: z.object({ fileName: z.string().min(1).max(120) }),
    outputSchema: z.object({
      fileName: z.string(),
      content: z.string(),
      bytes: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }),
    execute: async ({ fileName }) => {
      const { name, target } = targetFor(root, fileName);
      let stat;
      try {
        stat = fs.lstatSync(target);
      } catch {
        throw new WorkspaceError('NOT_FOUND', `"${name}" does not exist in the workspace`);
      }
      if (!stat.isFile()) throw new WorkspaceError('NOT_A_FILE', `"${name}" is not a regular file`);
      const buf = fs.readFileSync(target);
      const truncated = buf.length > MAX_READ_BYTES;
      return {
        fileName: name,
        content: buf.subarray(0, MAX_READ_BYTES).toString('utf8'),
        bytes: buf.length,
        truncated,
      };
    },
  });

  registry.define({
    name: 'workspace_list',
    description: 'List files in the user workspace with size and modification time.',
    tier: 'read',
    inputSchema: z.object({}),
    outputSchema: z.object({
      files: z.array(z.object({
        name: z.string(),
        bytes: z.number().int().nonnegative(),
        modifiedAt: z.string(),
      })).max(500),
    }),
    execute: async () => {
      const files = [];
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const st = fs.statSync(path.join(root, entry.name));
        files.push({ name: entry.name, bytes: st.size, modifiedAt: st.mtime.toISOString() });
      }
      return { files: files.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1)).slice(0, 500) };
    },
  });

  registry.define({
    name: 'memory_save',
    description: 'Remember a durable user preference or fact (key + short text) for future conversations.',
    tier: 'write',
    inputSchema: z.object({
      key: z.string().min(1).max(80),
      text: z.string().min(1).max(500),
      tags: z.array(z.string().max(24)).max(6).optional(),
    }),
    outputSchema: z.object({ saved: z.literal(true), key: z.string() }),
    execute: async ({ key, text, tags = [] }) => {
      memory.put('preference', { key, text, tags, importance: 0.8 });
      return { saved: true, key };
    },
  });

  registry.define({
    name: 'memory_search',
    description: 'Search remembered preferences and facts.',
    tier: 'read',
    inputSchema: z.object({ query: z.string().min(1).max(120), limit: z.number().int().min(1).max(20).optional() }),
    outputSchema: z.object({
      matches: z.array(z.object({ key: z.string(), text: z.string() })).max(20),
    }),
    execute: async ({ query, limit = 8 }) => ({
      matches: memory.search('preference', query, { limit }).map((e) => ({ key: e.key, text: e.text })),
    }),
  });

  return { registry, memory, root };
}

/** Tool descriptions in the shape the OpenAI-compatible adapters expect. */
export const TOOL_SCHEMAS = [
  {
    name: 'workspace_write',
    description: 'Create a new text file in the user workspace (create-only, never overwrites).',
    parameters: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'Leaf filename, e.g. "rapport.txt". No folders.' },
        content: { type: 'string', description: 'Full UTF-8 text content of the file.' },
      },
      required: ['fileName', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'workspace_read',
    description: 'Read a text file from the user workspace.',
    parameters: {
      type: 'object',
      properties: { fileName: { type: 'string', description: 'Leaf filename to read.' } },
      required: ['fileName'],
      additionalProperties: false,
    },
  },
  {
    name: 'workspace_list',
    description: 'List files in the user workspace.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'memory_save',
    description: 'Remember a durable user preference or fact for later conversations.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short stable key, e.g. "language".' },
        text: { type: 'string', description: 'The fact or preference in one sentence.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
      },
      required: ['key', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_search',
    description: 'Search remembered preferences and facts.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

export { runTool };
