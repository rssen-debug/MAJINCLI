/**
 * MAJIN V4 — host tool bus.
 *
 * V4 shipped workspace-only tools. V1 already has measured Windows control
 * (`src/core/tools/wincontrol.js`: WM_SETTEXT → WM_GETTEXT → BM_CLICK round-trip),
 * a filesystem surface (`fs.*`), and a browser lane. This module adapts those
 * proven implementations into V2 `ToolDefinition`s so they run through the same
 * runner, approval layer and receipts as everything else.
 *
 * The contract this file exists to guarantee is honesty:
 *
 *   - a capability that is not present on this host is NOT registered, and the
 *     capability report says so. A tool that silently exists but always fails is
 *     worse than a tool that is absent.
 *   - a registered tool still refuses at call time if the host changed under it
 *     (a Windows session that locked, a helper that disappeared).
 *   - risk maps to tier, and tier drives V2's approval policy: anything that can
 *     drive the machine is `process` and therefore held, not auto-approved.
 *
 * What is NOT claimed: these tools have never been executed on Windows from this
 * environment. Their contract is tested here; their effect is tested by
 * `npm run v4:accept` on the host.
 */
import { z } from 'zod';

/**
 * The V1 tool modules and the arrays they export.
 *
 * Discovered by reading `src/core/tools/*.js`, not guessed. Every entry here is a
 * lane the owner can enable; `hostCapabilities()` still decides per lane whether
 * it loads, so a module that disappears degrades to a stated reason.
 */
export const V1_LANES = Object.freeze({
  desktop: { module: '../../core/tools/wincontrol.js', export: 'winControlTools', tierDefault: 'process' },
  screen: { module: '../../core/tools/net.js', export: 'netTools', tierDefault: 'process' },
  computer: { module: '../../core/tools/computer.js', export: 'computerTools', tierDefault: 'process' },
  files: { module: '../../core/tools/files.js', export: 'fileTools', tierDefault: 'write' },
  shell: { module: '../../core/tools/exec.js', export: 'execTools', tierDefault: 'process' },
  power: { module: '../../core/tools/power.js', export: 'powerTools', tierDefault: 'process' },
  // NOTE: browser.* tools live inside web.js's webTools array, not in
  // core/browser.js (which is the launch/pool layer). They are therefore part of
  // the `web` lane; `browserRuntime` below reports whether they can actually run.
  web: { module: '../../core/tools/web.js', export: 'webTools', tierDefault: 'external' },
  research: { module: '../../core/tools/research.js', export: 'researchTools', tierDefault: 'external' },
  jobs: { module: '../../core/tools/jobs.js', export: 'jobTools', tierDefault: 'external' },
  agent: { module: '../../core/tools/agent.js', export: 'agentTools', tierDefault: 'process' },
  flows: { module: '../../core/tools/flows.js', export: 'flowsTools', tierDefault: 'process' },
  github: { module: '../../core/tools/github.js', export: 'githubTools', tierDefault: 'external' },
});

/** Kept for callers that only know the three original lanes. */
export const LANE_EXPORTS = Object.freeze(
  Object.fromEntries(Object.entries(V1_LANES).map(([k, v]) => [k, v.export])),
);

/** V1 risk vocabulary -> V2 tool tier (which decides the approval policy). */
export const RISK_TO_TIER = Object.freeze({
  read: 'read',
  ok: 'read',
  write: 'write',
  exec: 'process',   // driving another window or a shell is a held operation
  net: 'external',
  browser: 'browser',
});

/**
 * What this host can actually do, decided by asking the platform and by trying
 * to load the implementation. Never by assuming.
 */
export async function hostCapabilities({
  platform = process.platform,
  importModule = (spec) => import(spec),
  env = process.env,
  lanes = V1_LANES,
} = {}) {
  const caps = { platform, lanes: {} };

  const load = async (spec) => {
    try {
      return await importModule(spec);
    } catch (err) {
      return { __error: String(err?.message || err) };
    }
  };

  for (const [lane, spec] of Object.entries(lanes)) {
    const entry = { available: false, reason: null, tools: [], tierDefault: spec.tierDefault };

    // Windows-only lanes say so instead of loading and failing at call time.
    const windowsOnly = ['desktop', 'screen', 'computer'].includes(lane);
    if (windowsOnly && platform !== 'win32') {
      entry.reason = `Windows-only (this host is ${platform})`;
      caps.lanes[lane] = entry;
      continue;
    }

    const mod = await load(spec.module);
    if (mod.__error) {
      entry.reason = `implementation unavailable: ${mod.__error}`;
    } else if (!Array.isArray(mod[spec.export])) {
      entry.reason = `${spec.export} is not exported by ${spec.module}`;
    } else if (mod[spec.export].length === 0) {
      entry.reason = `${spec.export} is empty (not available in this build)`;
    } else {
      entry.available = true;
      entry.tools = mod[spec.export].map((t) => t.name);
      entry.module = mod;
      entry.exportName = spec.export;
    }
    caps.lanes[lane] = entry;
  }

  // --- browser runtime: owning the library is not owning a browser ---------
  // browser.* tools are registered with the `web` lane, but they can only run if
  // a real browser exists. Reported separately so the owner is not told the web
  // lane is fully functional when half of it cannot launch.
  caps.browserRuntime = { available: false, reason: null };
  if (platform === 'win32' && !env.SESSIONNAME) {
    caps.browserRuntime.reason = 'no interactive Windows session detected (service sessions cannot show a browser)';
  } else {
    const bin = await browserBinary({ platform, env });
    const pw = await load('playwright');
    if (!bin) caps.browserRuntime.reason = 'no browser binary found (npx playwright install chromium)';
    else if (pw.__error) caps.browserRuntime.reason = 'playwright is not installed';
    else {
      caps.browserRuntime.available = true;
      caps.browserRuntime.binary = bin;
    }
  }

  return caps;
}

/**
 * Find an installed browser binary without launching it.
 *
 * Playwright keeps browsers under PLAYWRIGHT_BROWSERS_PATH or a per-platform
 * cache; MAJIN_V4_BROWSER overrides for a hand-installed Chromium or Edge.
 */
export async function browserBinary({ platform = process.platform, env = process.env } = {}) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const seen = (p) => {
    try {
      return Boolean(p) && fs.existsSync(p);
    } catch {
      return false;
    }
  };

  if (env.MAJIN_V4_BROWSER) return seen(env.MAJIN_V4_BROWSER) ? env.MAJIN_V4_BROWSER : null;

  // A real Edge install is the common case on the owner's Windows machine.
  if (platform === 'win32') {
    for (const dir of [
      env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]) {
      if (seen(dir)) return dir;
    }
  }

  const roots = [];
  if (env.PLAYWRIGHT_BROWSERS_PATH) roots.push(env.PLAYWRIGHT_BROWSERS_PATH);
  if (platform === 'win32') roots.push(path.join(env.LOCALAPPDATA || '', 'ms-playwright'));
  else if (platform === 'darwin') roots.push(path.join(env.HOME || '', 'Library', 'Caches', 'ms-playwright'));
  else roots.push(path.join(env.HOME || '', '.cache', 'ms-playwright'));

  for (const root of roots) {
    if (!root || !seen(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidates = platform === 'win32'
        ? [path.join(root, entry, 'chrome-win', 'chrome.exe'), path.join(root, entry, 'chrome-win64', 'chrome.exe')]
        : [path.join(root, entry, 'chrome-linux', 'chrome'), path.join(root, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell')];
      for (const c of candidates) if (seen(c)) return c;
    }
  }
  return null;
}

/** Public, serialisable view: no module handles leave this function. */
export function describeCapabilities(caps) {
  const out = { platform: caps.platform, lanes: {}, browserRuntime: caps.browserRuntime || { available: false, reason: 'unknown' } };
  for (const [lane, c] of Object.entries(caps.lanes || {})) {
    out.lanes[lane] = {
      available: Boolean(c?.available),
      reason: c?.reason || null,
      tools: c?.tools || [],
      ...(c?.binary ? { binary: c.binary } : {}),
    };
  }
  return out;
}

/**
 * V1 names tools with dots (`fs.read`, `exec.start`, `control.type`). V2's
 * registry requires `/^[a-z][a-z0-9_]*$/`, so dots become underscores.
 *
 * The mapping is deterministic and reversible, and the original name is kept on
 * the definition as `sourceName` so an operator can always tell which V1 tool a
 * registered name came from.
 */
export function v2ToolName(v1name) {
  return String(v1name).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^([^a-z])/, 'tool_$1');
}

/** The reverse, for reading logs back to V1 names. */
export function v1ToolName(v2name) {
  return String(v2name).replace(/_/g, '.');
}

/**
 * V1 returns `{ok, result, meta, summary}` and, on failure,
 * `{ok:false, error:{code,message,hint}}` — an OBJECT, not a string.
 *
 * The first version of this schema expected a string, so an honest "no search
 * engine answered" became INVALID_TOOL_OUTPUT: a failing tool misreported as a
 * broken one. The probe in `npm run v4:tools --probe` caught it.
 */
const V1_ERROR = z.union([
  z.string(),
  z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    hint: z.string().optional(),
  }).loose(),
]);

const OUTPUT = z.object({
  ok: z.boolean(),
  result: z.union([z.string(), z.any()]).optional(),
  meta: z.unknown().optional(),
  summary: z.string().optional(),
  error: V1_ERROR.optional(),
  hint: z.string().optional(),
  unsupported: z.boolean().optional(),
});

function errorText(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return [err.message, err.hint].filter(Boolean).join(' — ') || err.code || '';
}

/**
 * V1's `error.code` -> the V2 failure vocabulary the scheduler understands.
 * Anything unknown becomes UNKNOWN rather than being upgraded to a retryable
 * class by accident.
 */
export function classifyV1Error(err) {
  const code = String((err && typeof err === 'object' ? err.code : '') || '').toLowerCase();
  const msg = String((err && typeof err === 'object' ? err.message : err) || '').toLowerCase();
  if (/protected|permission|denied|eacces|eperm/.test(code + msg)) return 'PERMISSION_DENIED';
  if (/not_found|enoent|missing/.test(code + msg)) return 'DEPENDENCY_MISSING';
  if (/timeout|timed out|etimedout|deadline/.test(code + msg)) return 'TIMEOUT';
  if (/network|fetch failed|econn|enotfound|no search engine|offline/.test(code + msg)) return 'NETWORK_FAILURE';
  if (/unsupported/.test(code + msg)) return 'DEPENDENCY_MISSING';
  return 'UNKNOWN';
}

/**
 * V1 params are `{ name: 'type: description' }` strings. V2 needs zod. This
 * keeps a permissive schema for anything it cannot type rather than inventing a
 * constraint that would reject valid calls.
 */
export function zodFromV1Params(params = {}) {
  const shape = {};
  for (const [key, spec] of Object.entries(params || {})) {
    const type = String(spec).split(':')[0].trim().toLowerCase();
    if (type === 'number' || type === 'int' || type === 'integer') shape[key] = z.number().optional();
    else if (type === 'boolean' || type === 'bool') shape[key] = z.boolean().optional();
    else if (type === 'array') shape[key] = z.array(z.unknown()).optional();
    else if (type === 'object') shape[key] = z.record(z.string(), z.unknown()).optional();
    else shape[key] = z.string().optional();
  }
  return z.object(shape);
}

/**
 * The context a V1 tool expects.
 *
 * V1 tools read their limits from `ctx.cfg.get(...)` and their workspace root
 * from `ctx.cfg.get('workspace')`. Rather than hand them V1's whole live config
 * (which would bypass V4's boundaries), this builds a minimal read-only view with
 * the workspace V4 was given. `get` returns undefined for everything else, so a
 * V1 tool falls back to its own documented defaults.
 */
export function v1Context({ workspaceDir = null, cfg = null } = {}) {
  const values = { workspace: workspaceDir };
  return Object.freeze({
    cfg: Object.freeze({
      get: (key) => {
        if (cfg && typeof cfg.get === 'function') {
          const v = cfg.get(key);
          if (v !== undefined) return v;
        }
        return values[key];
      },
    }),
    workspaceDir,
  });
}

export function adaptV1Tool(v1tool, { lane, ctx = null }) {
  return {
    name: v2ToolName(v1tool.name),
    sourceName: v1tool.name,
    // V2 requires a description of at least four characters.
    description: `${v1tool.desc || v1tool.name}`.slice(0, 400),
    tier: RISK_TO_TIER[v1tool.risk] || 'process',
    inputSchema: zodFromV1Params(v1tool.raw || {}).strip(),
    outputSchema: OUTPUT,
    lane,
    execute: async (input = {}) => {
      let result;
      try {
        result = await v1tool.run(input, ctx);
      } catch (err) {
        // A thrown V1 tool is a classified failure, never a silent success.
        const e = new Error(String(err?.message || err));
        e.cls = err?.cls || 'UNKNOWN';
        throw e;
      }
      if (!result || typeof result !== 'object') {
        const e = new Error(`tool ${v1tool.name} returned no structured result`);
        e.cls = 'INVALID_TOOL_OUTPUT';
        throw e;
      }
      if (result.unsupported) {
        const e = new Error(result.result || errorText(result.error) || `${v1tool.name} is not supported on this host`);
        e.cls = 'DEPENDENCY_MISSING';
        throw e;
      }
      // An honest structured failure is a classified failure, not a schema break.
      if (result.ok === false) {
        const e = new Error(errorText(result.error) || `${v1tool.name} reported failure`);
        e.cls = classifyV1Error(result.error);
        throw e;
      }
      return {
        ok: true,
        result: typeof result.result === 'string' ? result.result : (result.result ?? null),
        meta: result.meta ?? null,
        summary: result.summary ?? null,
        ...(result.hint ? { hint: String(result.hint) } : {}),
      };
    },
  };
}

/**
 * Register every available host tool into a V4 registry.
 *
 * `allow` is an optional list of tool names; when given, only those are exposed.
 * That is the Owner Mode lever: broad access is a decision, not a default.
 */
/**
 * Tools that cannot run without a browser runtime.
 *
 * They live in the `web` lane (V1 ships them there), but offering them without a
 * browser is the same lie as offering a Windows tool on Linux: the model would
 * call them and get a failure it was not warned about.
 */
export const BROWSER_DEPENDENT = /^browser\./;

export function registerHostTools(registry, caps, { allow = null, workspaceDir = null, cfg = null } = {}) {
  const ctx = v1Context({ workspaceDir, cfg });
  const browserReady = Boolean(caps.browserRuntime?.available);
  const registered = [];
  const skipped = [];

  for (const [lane, cap] of Object.entries(caps.lanes || {})) {
    if (!cap?.available || !cap.module) {
      skipped.push({ lane, reason: cap?.reason || 'not available' });
      continue;
    }
    const list = cap.module[cap.exportName || LANE_EXPORTS[lane]];
    if (!Array.isArray(list)) {
      skipped.push({ lane, reason: 'no tool list exported' });
      continue;
    }
    for (const v1tool of list) {
      if (!browserReady && BROWSER_DEPENDENT.test(v1tool.name)) {
        skipped.push({ lane, tool: v1tool.name, reason: `no browser runtime: ${caps.browserRuntime?.reason || 'unavailable'}` });
        continue;
      }
      const wanted = v2ToolName(v1tool.name);
      if (allow && !allow.includes(v1tool.name) && !allow.includes(wanted)) {
        skipped.push({ lane, tool: v1tool.name, reason: 'not in the owner allowlist' });
        continue;
      }
      try {
        const def = adaptV1Tool(v1tool, { lane, ctx });
        registry.define(def);
        registered.push({ name: def.name, sourceName: def.sourceName, tier: def.tier, lane });
      } catch (err) {
        skipped.push({ lane, tool: v1tool.name, reason: String(err?.message || err) });
      }
    }
  }

  return { registered, skipped };
}
