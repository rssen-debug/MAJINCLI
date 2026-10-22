/**
 * MAJIN V4 — versioned kernel and capability contracts.
 *
 * The point of this file is that MAJIN should not need a V5: tools, providers,
 * memory, voice engines and UI surfaces register against a versioned interface,
 * and experimental work ships behind flags.
 *
 * What is real here:
 *  - strict manifest + capability validation before anything is registered
 *  - permission declarations and refusal of undeclared capabilities
 *  - try/catch activation with automatic rollback (nothing half-registered)
 *  - quarantine of a broken plugin so the host keeps serving
 *
 * What is NOT claimed:
 *  - plugins are not a security sandbox. They run in-process with the host's
 *    privileges. Loading is therefore opt-in (MAJIN_V4_PLUGINS=1) and every
 *    plugin must declare what it needs. Process-level isolation is future work
 *    and is written down as such in docs/v4/ARCHITECTURE.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const KERNEL_API_VERSION = 1;
export const CAPABILITY_KINDS = Object.freeze(['tool', 'provider', 'voice', 'memory', 'surface']);

export const PluginManifest = z.object({
  name: z.string().min(2).max(48).regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  // A newer plugin is not malformed — it is incompatible, and the loader says so.
  kernelApi: z.number().int().min(1),
  description: z.string().min(4).max(200),
  permissions: z.array(z.enum(['workspace', 'network', 'memory', 'voice'])).default([]),
  capabilities: z.array(z.object({
    kind: z.enum(CAPABILITY_KINDS),
    name: z.string().min(2).max(64).regex(/^[a-z][a-z0-9_]*$/),
  })).min(1).max(20),
  experimental: z.boolean().default(false),
});

export class KernelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KernelError';
    this.code = code;
  }
}

/**
 * The registry. One instance per host process; capabilities are frozen once
 * registered so a plugin cannot mutate another plugin's contract.
 */
export class Kernel {
  constructor({ features = {}, pluginsEnabled = false, allowlist = [] } = {}) {
    this.apiVersion = KERNEL_API_VERSION;
    this.features = { ...features };
    this.pluginsEnabled = pluginsEnabled;
    this.allowlist = new Set(allowlist);
    this.capabilities = new Map(); // `${kind}:${name}` -> {plugin, impl}
    this.plugins = new Map(); // name -> { manifest, status, error }
    this.loadedAt = null;
  }

  flag(name) {
    return Boolean(this.features[name]);
  }

  get(kind, name) {
    return this.capabilities.get(`${kind}:${name}`)?.impl || null;
  }

  list() {
    return [...this.capabilities.entries()].map(([key, value]) => {
      const [kind, name] = key.split(':');
      return { kind, name, plugin: value.plugin };
    });
  }

  /**
   * Register one capability with rollback semantics: either it is registered
   * and listed, or the call throws and nothing changed.
   */
  register({ plugin, manifest, capability, impl }) {
    if (!manifest.permissions && !Array.isArray(manifest.permissions)) {
      throw new KernelError('MANIFEST_INVALID', 'manifest.permissions must be an array');
    }
    if (!manifest.capabilities.some((c) => c.kind === capability.kind && c.name === capability.name)) {
      throw new KernelError('PERMISSION_UNDECLARED', `capability ${capability.kind}:${capability.name} was not declared in the manifest`);
    }
    const key = `${capability.kind}:${capability.name}`;
    if (this.capabilities.has(key)) {
      throw new KernelError('DUPLICATE_CAPABILITY', `capability ${key} is already registered by ${this.capabilities.get(key).plugin}`);
    }
    const frozen = Object.freeze({ ...capability, impl: undefined });
    this.capabilities.set(key, { plugin, impl: Object.freeze({ ...frozen, impl }) });
    return key;
  }

  /**
   * Load every plugin directory under `dir`. Each failure is contained: the
   * plugin is marked failed/quarantined and the host keeps running.
   */
  async loadPlugins(dir) {
    const results = [];
    if (!this.pluginsEnabled) return results;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (this.allowlist.size && !this.allowlist.has(entry.name)) continue;
      const pluginDir = path.join(dir, entry.name);
      const manifestFile = path.join(pluginDir, 'plugin.json');
      let manifest;
      try {
        manifest = PluginManifest.parse(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
      } catch (err) {
        this.plugins.set(entry.name, { status: 'rejected', error: `manifest: ${err.message}` });
        results.push({ name: entry.name, status: 'rejected', error: err.message });
        continue;
      }
      if (manifest.name !== entry.name) {
        this.plugins.set(entry.name, { status: 'rejected', error: 'directory name must equal manifest name' });
        results.push({ name: entry.name, status: 'rejected', error: 'name mismatch' });
        continue;
      }
      if (manifest.experimental && !this.flag('experimental-plugins')) {
        this.plugins.set(entry.name, { status: 'flagged-off', manifest });
        results.push({ name: entry.name, status: 'flagged-off' });
        continue;
      }
      if (manifest.kernelApi > this.apiVersion) {
        this.plugins.set(entry.name, { status: 'incompatible', manifest });
        results.push({ name: entry.name, status: 'incompatible' });
        continue;
      }
      const before = new Set(this.capabilities.keys());
      try {
        const mod = await import(path.join(pluginDir, 'index.js'));
        const activate = mod.activate || mod.default;
        if (typeof activate !== 'function') throw new Error('index.js must export activate(ctx)');
        const ctx = this.#contextFor(manifest);
        await activate(ctx);
        this.plugins.set(entry.name, { status: 'active', manifest });
        results.push({ name: entry.name, status: 'active' });
      } catch (err) {
        for (const key of [...this.capabilities.keys()]) {
          if (!before.has(key)) this.capabilities.delete(key); // rollback
        }
        this.plugins.set(entry.name, { status: 'failed', manifest, error: String(err.message || err) });
        results.push({ name: entry.name, status: 'failed', error: String(err.message || err) });
      }
    }
    this.loadedAt = new Date().toISOString();
    return results;
  }

  #contextFor(manifest) {
    const kernel = this;
    const register = (capability, impl) => kernel.register({ plugin: manifest.name, manifest, capability, impl });
    const granted = new Set(manifest.permissions);
    return Object.freeze({
      apiVersion: this.apiVersion,
      plugin: Object.freeze({ name: manifest.name, version: manifest.version }),
      flag: (name) => kernel.flag(name),
      hasPermission: (p) => granted.has(p),
      registerTool: ({ name, description, tier = 'read', inputSchema, outputSchema, execute }) => {
        if (!granted.has('workspace') && tier !== 'read') {
          throw new KernelError('PERMISSION_UNDECLARED', `tool ${name} needs the "workspace" permission`);
        }
        return register({ kind: 'tool', name }, { description, tier, inputSchema, outputSchema, execute });
      },
      registerProvider: ({ name, chat }) => {
        if (!granted.has('network')) throw new KernelError('PERMISSION_UNDECLARED', `provider ${name} needs the "network" permission`);
        return register({ kind: 'provider', name }, { chat });
      },
      registerVoice: ({ name, speak, transcribe }) => {
        if (!granted.has('voice')) throw new KernelError('PERMISSION_UNDECLARED', `voice ${name} needs the "voice" permission`);
        return register({ kind: 'voice', name }, { speak, transcribe });
      },
      registerMemory: ({ name, put, search }) => {
        if (!granted.has('memory')) throw new KernelError('PERMISSION_UNDECLARED', `memory ${name} needs the "memory" permission`);
        return register({ kind: 'memory', name }, { put, search });
      },
      registerSurface: ({ name, render }) => register({ kind: 'surface', name }, { render }),
    });
  }

  summary() {
    return {
      apiVersion: this.apiVersion,
      pluginsEnabled: this.pluginsEnabled,
      plugins: [...this.plugins.entries()].map(([name, p]) => ({ name, status: p.status, ...(p.error ? { error: p.error } : {}) })),
      capabilities: this.list(),
      flags: this.features,
      loadedAt: this.loadedAt,
    };
  }
}

/** Feature flags: stable features default on, experimental default off. */
export function parseFlags(raw) {
  const flags = {
    voice: true,
    pwa: true,
    'experimental-plugins': false,
    'experimental-desktop': false,
  };
  if (!raw) return flags;
  for (const token of String(raw).split(',').map((t) => t.trim()).filter(Boolean)) {
    const [name, value] = token.split('=');
    if (!name) continue;
    const on = value == null ? true : /^(1|true|on|yes)$/i.test(value);
    flags[name] = on;
  }
  return flags;
}
