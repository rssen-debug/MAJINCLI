/**
 * MAJIN — config.
 * One JSON file is the whole brain: providers, keys, routes, MOA, channels, guard.
 * The agent can read and write it itself (tool: majin.configure), which is why
 * every value here is plain JSON and every write is validated + backed up.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dirs, expand } from './paths.js';
import { PRESETS, presetNames, splitModel, chatUrl } from './presets.js';

/** Model routing table keys. A "job" is any of these; a route is provider/model. */
export const JOBS = [
  'chat',
  'tools',
  'tasks',
  'summarize',
  'router',
  'vision',
  'code',
  're',
  'plan',
  'research',
  'analysis',
  'final',
  'aggregator',
];

export const DEFAULTS = {
  version: 1,
  name: 'MAJIN',
  workspace: null,
  persona: {
    identity:
      'Du är MAJIN — en personlig agent som kör på användarens egen Windows-maskin. Du pratar kort, på användarens språk, utan att förklara vad du ska göra innan du gjort det.',
    style:
      'Agera först, rapportera sedan. Korta meningar. Ingen fluff, inga ursäkter. Siffror och sökvägar före adjektiv. Om du är osäker: säg exakt vad som är osäkert, inte att du är ledsen.',
    safety: 'Du har tillgång till hela maskinen. Verifiera innan du förstör. Radera aldrig något du inte själv skapat.',
  },
  providers: {
    /* Alla presets finns från början med tom nyckel — UI:t och "lägg till provider"
       ska visa vad som går att välja, och naturallyspråk ("använd openrouter …") ska
       kunna peka en rutt på dem direkt. */
    ...Object.fromEntries(
      Object.entries(PRESETS)
        .filter(([name]) => name !== 'deepseek' && name !== 'mock')
        .map(([name, p]) => [name, { label: p.label, kind: p.kind, baseUrl: p.baseUrl, apiKey: null, models: [...(p.models || [])], keyEnv: p.keyEnv || null, keyUrl: p.keyUrl || null }]),
    ),
    deepseek: {
      label: 'DeepSeek',
      kind: 'openai',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '{env:DEEPSEEK_API_KEY}',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
    },
    demo: { label: 'Demo (lokal)', kind: 'mock', baseUrl: 'mock://local', apiKey: 'demo', models: ['demo-fast', 'demo-pro'] },
  },
  models: {
    provider: 'deepseek',
    fallbackOrder: ['deepseek', 'demo'],
    routes: {
      chat: 'deepseek/deepseek-flash',
      tasks: 'deepseek/deepseek-flash',
      tools: 'deepseek/deepseek-flash',
      summarize: 'deepseek/deepseek-flash',
      router: 'deepseek/deepseek-flash',
      vision: 'deepseek/deepseek-flash',
      code: 'deepseek/deepseek-v4-pro',
      re: 'deepseek/deepseek-v4-pro',
      analysis: 'deepseek/deepseek-v4-pro',
      plan: 'deepseek/deepseek-v4-pro',
      research: 'deepseek/deepseek-v4-pro',
      final: 'deepseek/deepseek-v4-pro',
      aggregator: 'deepseek/deepseek-v4-pro',
    },
    defaults: { temperature: 0.2, maxTokens: 4096 },
  },
  pricing: {
    'deepseek/deepseek-flash': { in: 0.14, out: 0.28 },
    'deepseek/deepseek-v4-pro': { in: 1.7, out: 8 },
  },
  routing: {
    auto: true,
    escalateAfterErrors: 2,
    escalateJob: 'analysis',
    llmTiebreak: true,
    llmTiebreakAbove: 0.45,
    escalateOnDisagreement: 0.35,
    escalateOnErrors: true,
    rules: [
      { id: 're', match: '/(reverse|ghidra|ida|rizin|binary|binär|exe|dll|malware|virus|packer|unpack|dump|disassembl|reversing|apk|firmware)/i', job: 're', note: 'reverse engineer-jobb → tung modell' },
      { id: 'code', match: '/(\\bcode\\b|kod(a|e)?\\b|bugg|bug|error|exception|typescript|python|js|refactor|test|build|compile)/i', job: 'code', note: 'kod → tung modell' },
      { id: 'research', match: '/(sök|search|hitta|research|vad är|latest|nyaste|källa|webb)/i', job: 'research', note: 'webbresearch' },
      { id: 'tasks', match: '/(fil|mapp|copy|flytta|sortera|batch|rename|döp om|rens(a|a)|zip|packa)/i', job: 'tasks', note: 'filsnack → billig snabb modell' },
      { id: 'chat', match: '/^(tack|okej|ok|ja|nej|hej|hmm|vet inte)\\b.{0,25}$/i', job: 'chat', note: 'prat → billigast' },
    ],
  },
  moa: {
    enabled: true,
    policy: 'always',
    hardJobs: ['re', 'code', 'analysis', 'plan', 'final', 'research'],
    width: 3,
    references: [
      { model: 'deepseek/deepseek-flash', temperature: 0.1 },
      { model: 'deepseek/deepseek-flash', temperature: 0.8 },
      { model: 'deepseek/deepseek-v4-pro', temperature: 0.3 },
    ],
    aggregator: 'deepseek/deepseek-v4-pro',
    referenceMaxTokens: 900,
    aggregatorMaxTokens: 3000,
    referenceTemperature: 0.5,
    disagreementFloor: 0.25,
  },
  tools: {
    allow: '*',
    maxOutputChars: 9000,
    shell: { timeoutSec: 150, maxOutputChars: 12000, requireApproval: 'dangerous', allowlist: [] },
    files: { maxReadBytes: 4000000, followSymlinks: false },
    web: { provider: 'auto', searxng: null, timeoutSec: 25, maxChars: 60000, fetchRetry: 1 },
    re: {
      maxFileBytes: 268435456,
      stringsMax: 20000,
      capstone: true,
      external: 'auto',
      yaraRules: [],
      ghidraProjectDir: null,
      headlessTimeoutSec: 900,
    },
    http: { allowPrivate: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MAJIN/1.0' },
  },
  guard: {
    mode: 'confirm',
    askOn: ['/(?<![a-z])(rm\\s+-[rf]{2,}|del\\s+/[sq]|format\\s+[a-z]:|diskpart|shutdown\\s+/[sr]|Remove-Item[^\\n]*(Recurse|Force)[^\\n]*(windows|system32)|reg\\s+delete|netsh\\s+advfirewall\\s+(set|delete)|cipher\\s+/w|vssadmin\\s+delete|rmdir\\s+/s)(?![a-z])/i'],
    neverOn: ['/\\b(mkfs|ntfsutil\\s+security\\s+query)\\b|:\\(\\)\\s*\\{[^}]*\\}\\s*;\\s*:/i', '/\\b(dd\\s+if=\\S+\\s+of=/dev/[a-z]{2,}|clean all)\\b/i'],
    protectedPaths: ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\boot', '/boot', '/etc'],
    pathWriteRoots: ['auto'],
  },
  memory: {
    dir: 'memory',
    auto: true,
    maxDigestChars: 2400,
    sessionCap: 400,
    facts: [
      'Användaren vill att alla verktyg är alltid på — inget enable/disable.',
      'Agenten får ändra sin egen config när användaren säger saker som "använd X för Y alltid".',
    ],
  },
  skills: { dir: 'skills', auto: true, maxInPrompt: 12 },
  schedule: { enabled: true, timezone: 'local', maxConcurrent: 2, tickMs: 20000 },
  tasks: { concurrency: 3, approvalTimeoutMs: 180000 },
  channels: {
    telegram: { enabled: true, botToken: null, apiBase: 'https://api.telegram.org', allowedChatIds: [], pairingCode: null, pollTimeoutSec: 30, parseMode: 'HTML', proxy: null, reactions: true },
    whatsapp: {
      enabled: true,
      transport: 'baileys',
      baileys: { sessionDir: 'whatsapp', verbose: false },
      cloud: { accessToken: null, phoneNumberId: null, verifyToken: null, apiVersion: 'v23.0', appSecret: null, allowedNumbers: [] },
      allowedJids: [],
      replyPrefix: '',
      maxMessageChars: 4000,
    },
    shared: { forwardToChat: true, requirePairing: true, idleSessionCloseMin: 720, deliverTo: null, replyWhileStreaming: false },
    webhook: { enabled: false, host: '0.0.0.0', port: 8788, path: '/whatsapp', tunnel: 'none' },
  },
  agent: {
    maxSteps: 60,
    parallel: true,
    contextTokens: 48000,
    keepRecent: 12,
    summarizeAbove: 20000,
    autoReflect: true,
    reflectEvery: 8,
    subagents: { enabled: true, maxParallel: 3, maxSteps: 14, shareMemory: true },
    retries: 2,
    timeoutMs: 120000,
    temperature: 0.2,
    maxTokens: 6000,
    historyInPrompt: 40,
    stepJob: 'tasks',
  },
  ui: {
    title: 'MAJIN',
    tagline: 'allt på — alltid redo',
    theme: 'jarvis',
    voice: { enabled: true, lang: 'sv-SE', wakeWord: 'majin', tts: true, ttsVoice: null, rate: 1.05, pitch: 0.95 },
    transparency: { showTools: 'verbose', showThinking: 'summary', showTokens: true },
    density: 'comfortable',
    autoOpen: true,
  },
  budget: { mode: 'track', monthlyUsd: 0, warnAt: 0.8 },
  logging: { level: 'info', keepDays: 14, jsonl: true },
  server: { host: '0.0.0.0', port: 8787, token: null, openBrowser: true, allowRemote: false, trustLocal: true },
};

const SECRET_KEYS = /(^|\.)(apikey|key|token|secret|bottoken|accesstoken|password|appsecret|verifytoken)$/i;
const ENV_REF = /^\{env:([A-Z0-9_]+)\}$/i;

/* ------------------------------- utils ----------------------------------- */

export function clone(o) {
  return structuredClone(o);
}

export function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/** Plain data object (RegExp/Buffer/Map are NOT plain — never walk into them). */
export function isPlain(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

export function merge(base, patch) {
  if (patch === undefined) return base;
  if (Array.isArray(patch) || !isPlain(patch) || !isPlain(base)) return clone(patch);
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = isPlain(v) && isPlain(base[k]) ? merge(base[k], v) : clone(v);
  }
  return out;
}

/** Deep-merge that keeps user arrays intact but merges array-of-objects by identity key. */
export function smartMerge(base, patch) {
  return merge(base, patch);
}

export function getPath(obj, dotted) {
  return dotted.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
}

export function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys.at(-1)] = value;
  return obj;
}

export function expandEnv(v) {
  if (typeof v === 'string') {
    const m = ENV_REF.exec(v);
    if (m) return process.env[m[1]] || '';
    return v;
  }
  if (Array.isArray(v)) return v.map(expandEnv);
  if (isPlain(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = expandEnv(val);
    return out;
  }
  return v;
}

export function redact(v, keyName = '') {
  if (typeof v === 'string') {
    if (!v) return '';
    if (SECRET_KEYS.test(keyName)) return `${v.slice(0, 2)}${'•'.repeat(Math.min(12, Math.max(3, v.length - 2)))}`;
    return v;
  }
  if (v instanceof RegExp) return String(v);
  if (Array.isArray(v)) return v.map((x) => redact(x, keyName));
  if (isPlain(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = redact(val, k);
    return out;
  }
  return v;
}

/* ------------------------------- store ------------------------------------- */

export class Config {
  constructor(data, file) {
    if (data && !data.workspace) data.workspace = dirs.workspace;
    this.data = data;
    this.file = file;
    this.subs = new Set();
    this.errors = [];
  }

  get(key) {
    return key ? getPath(this.data, key) : this.data;
  }

  raw() {
    return this.data;
  }

  json() {
    return clone(this.data);
  }

  redacted() {
    return redact(jsonable(clone(this.data)));
  }

  patch(obj, { dry = false, source = 'api' } = {}) {
    const errors = validatePatch(obj, this.data);
    const diff = flattenDiff(this.data, obj);
    if (errors.length) return { ok: false, errors, diff };
    if (dry) return { ok: true, errors: [], diff, preview: merge(this.data, obj) };
    const prev = this.data;
    this.data = merge(this.data, obj);
    this.errors = [];
    this.save();
    for (const fn of this.subs) {
      try {
        fn({ patch: obj, source, prev });
      } catch (err) {
        void err;
      }
    }
    return { ok: true, errors: [], diff, applied: obj };
  }

  onChange(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  save() {
    const file = this.file || dirs.config;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
      fs.writeFileSync(file, JSON.stringify(jsonable(this.data), null, 2) + '\n', 'utf8');
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* Windows: nope */
      }
      return true;
    } catch {
      return false;
    }
  }

  /** provider + model + kind for a route reference like "deepseek/deepseek-flash". */
  resolveModel(ref, job) {
    const r = ref || (job && this.data.models.routes[job]) || this.data.models.routes.tools;
    const parsed = splitModel(r, this.data);
    const name = parsed.provider;
    const provider = { label: name, kind: 'openai', baseUrl: '', apiKey: '', ...(this.data.providers[name] || {}) };
    const pricing = this.data.pricing?.[`${name}/${parsed.model}`] || null;
    return {
      ref: `${name}/${parsed.model}`,
      providerName: name,
      model: parsed.model,
      kind: provider.kind || PRESETS[provider.preset]?.kind || 'openai',
      baseUrl: provider.baseUrl,
      endpoint: provider.endpoint || chatUrl({ kind: provider.kind || PRESETS[provider.preset]?.kind || 'openai', baseUrl: provider.baseUrl }),
      apiKey: provider.apiKey,
      extraHeaders: provider.headers || {},
      pricing,
      job,
    };
  }

  /** All routes as a flat table, with mock/unknown providers flagged. */
  routeTable() {
    const out = [];
    for (const [job, ref] of Object.entries(this.data.models.routes)) {
      const r = this.resolveModel(ref, job);
      out.push({ job, ref, provider: r.providerName, model: r.model, kind: r.kind, ready: hasKey(r) });
    }
    return out;
  }

  rules() {
    return this.compiled?.rules || compileRuntime(this).rules;
  }

  guardPatterns(kind) {
    return this.compiled?.[kind] || compileRuntime(this)[kind] || [];
  }

  moaConfig() {
    const m = this.data.moa;
    if (!m || !m.enabled || m.policy === 'off') return { enabled: false, references: [], policy: 'off' };
    return {
      enabled: true,
      policy: m.policy,
      hardJobs: m.hardJobs || [],
      width: m.width || m.references.length,
      references: (m.references || []).map((r) => ({ ...r, model: this.usableRef(r.model), maxTokens: r.maxTokens ?? m.referenceMaxTokens ?? 900 })),
      aggregator: this.usableRef(m.aggregator || this.data.models.routes.aggregator),
      aggregatorMaxTokens: m.aggregatorMaxTokens ?? 4096,
      disagreementFloor: m.disagreementFloor ?? 0.25,
    };
  }

  /** Sant när ingen riktig (icke-mock) provider har nyckel — demo räknas inte. */
  needsSetup() {
    const providers = Object.values(this.data.providers);
    return !providers.some((p) => hasKey(p) && (p.kind || PRESETS[p.preset]?.kind || 'openai') !== 'mock');
  }

  realProviders() {
    return this.providerStatus().filter((p) => p.kind !== 'mock');
  }

  /** Ref varsas ur en provider utan nyckel ersätts av det som faktiskt är igång. */
  usableRef(ref) {
    const want = String(ref || '');
    if (!want) return this.defaultRef();
    const [name] = want.split('/');
    const prov = this.data.providers[name];
    if (prov && hasKey(prov)) return want;
    const alt = this.defaultRef();
    return alt || want;
  }

  defaultRef() {
    const prim = this.data.models?.provider;
    const candidates = [prim && `${prim}/${this.data.models?.routes?.tools?.split('/')[1] || 'default'}`, this.data.models?.routes?.tools, this.data.models?.routes?.chat];
    for (const c of candidates) {
      if (!c) continue;
      const [name] = c.split('/');
      const prov = this.data.providers[name];
      if (prov && hasKey(prov)) return c;
    }
    const open = Object.entries(this.data.providers).find(([, p]) => hasKey(p));
    return open ? `${open[0]}/${open[1].models?.[0] || 'default'}` : null;
  }

  providerStatus() {
    return Object.entries(this.data.providers).map(([name, p]) => {
      const kind = p.kind || PRESETS[p.preset]?.kind || 'openai';
      return { name, label: p.label || name, kind, baseUrl: p.baseUrl || '', ready: kind === 'mock' ? true : hasKey(p), models: p.models || [], hasKey: hasKey(p) };
    });
  }
}

export function hasKey(provider) {
  if (!provider) return false;
  if (provider.kind === 'mock') return true;
  const raw = String(provider.apiKey || '').trim();
  if (!raw) return false;
  if (/^\{env:[A-Z0-9_]+\}$/i.test(raw)) return Boolean(process.env[raw.slice(5, -1)]);
  return true;
}

function jsonable(v) {
  if (v instanceof RegExp) return { $re: v.source, flags: v.flags };
  if (Array.isArray(v)) return v.map(jsonable);
  if (isPlain(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonable(val);
    return out;
  }
  return v;
}

/* ------------------------------ validation -------------------------------- */

const ALLOWED = new Set(Object.keys(DEFAULTS));
const RE_STRING = /^\/(.+)\/([gimsuy]*)$/;

export function toRegex(spec) {
  if (spec instanceof RegExp) return spec;
  if (isPlain(spec) && typeof spec.$re === 'string') {
    try {
      return new RegExp(spec.$re, spec.flags || 'i');
    } catch {
      return null;
    }
  }
  if (!spec) return null;
  const m = RE_STRING.exec(String(spec).trim());
  if (m) {
    try {
      return new RegExp(m[1], m[2]);
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(String(spec).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  } catch {
    return null;
  }
}

export function validatePatch(patch, current) {
  const errors = [];
  if (!isObj(patch)) return [{ path: '', msg: 'patch måste vara ett objekt' }];
  for (const key of Object.keys(patch)) {
    if (!ALLOWED.has(key)) errors.push({ path: key, msg: `okänd toppnyckel. Tillåtna: ${[...ALLOWED].join(', ')}` });
  }
  const walk = (obj, prefix = '') => {
    if (!isPlain(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (p === 'models.routes' && isObj(v)) {
        for (const [job, ref] of Object.entries(v)) {
          if (!JOBS.includes(job)) errors.push({ path: `${p}.${job}`, msg: `okänd jobbrutt. Tillåtna: ${JOBS.join(', ')}` });
          if (typeof ref !== 'string' || !/^[a-z0-9._-]+\/[^\s]+$/i.test(ref)) errors.push({ path: `${p}.${job}`, msg: `"${ref}" — format provider/model` });
          else if (current && !current.providers[ref.split('/')[0]]) errors.push({ path: `${p}.${job}`, msg: `okänd provider "${ref.split('/')[0]}". Lägg till i providers först.` });
        }
      }
      if (p === 'providers' && isObj(v)) {
        for (const [name, prov] of Object.entries(v)) {
          if (!isObj(prov)) errors.push({ path: p, msg: 'provider måste vara ett objekt' });
          else {
            const cur = (current && current.providers && current.providers[name]) || {};
            const kind = prov.kind || cur.kind || PRESETS[prov.preset || cur.preset]?.kind || 'openai';
            const base = prov.baseUrl || cur.baseUrl || PRESETS[prov.preset]?.baseUrl || PRESETS[cur.preset]?.baseUrl;
            if (kind !== 'mock' && !base) errors.push({ path: `${p}.${name}.baseUrl`, msg: 'saknar baseUrl (eller välj ett preset med en)' });
            if (prov.kind && !['openai', 'anthropic', 'mock'].includes(prov.kind)) errors.push({ path: `${p}.${name}.kind`, msg: 'kind: openai | anthropic | mock' });
            if (prov.preset && !presetNames().includes(prov.preset)) errors.push({ path: `${p}.${name}.preset`, msg: `okänt preset: ${prov.preset}` });
            if (prov.models && !Array.isArray(prov.models)) errors.push({ path: `${p}.${name}.models`, msg: 'models måste vara en array' });
          }
        }
      }
      if (p === 'moa.references' && Array.isArray(v)) {
        v.forEach((r, i) => {
          if (!isObj(r) || typeof r.model !== 'string') errors.push({ path: `${p}[${i}]`, msg: 'varje referens behöver model "provider/model"' });
        });
        if (v.length < 2) errors.push({ path: p, msg: 'MOA behöver minst 2 referenser' });
      }
      if (p === 'moa.policy' && !['always', 'hard', 'off'].includes(v)) errors.push({ path: p, msg: 'policy: always | hard | off' });
      if (p === 'guard.mode' && !['confirm', 'off', 'strict'].includes(v)) errors.push({ path: p, msg: 'mode: confirm | strict | off' });
      if (p === 'routing.rules' && Array.isArray(v)) {
        v.forEach((r, i) => {
          if (!isObj(r) || typeof r.match !== 'string' || !r.job) errors.push({ path: `${p}[${i}]`, msg: '{ match, job } krävs' });
          else {
            if (!toRegex(r.match)) errors.push({ path: `${p}[${i}].match`, msg: 'olycklig regex' });
            if (!JOBS.includes(r.job)) errors.push({ path: `${p}[${i}].job`, msg: `okänt jobb "${r.job}"` });
          }
        });
      }
      if (p === 'server.port' && (typeof v !== 'number' || v < 1 || v > 65535)) errors.push({ path: p, msg: 'port måste vara 1-65535' });
      if (p === 'channels.telegram.enabled' || p === 'channels.whatsapp.enabled') {
        if (typeof v !== 'boolean') errors.push({ path: p, msg: 'boolean' });
      }
      if (p === 'channels.telegram.botToken' && v && !/^\d+:[\w-]{30,}$/.test(String(v))) errors.push({ path: p, msg: 'ser inte ut som en Telegram bot-token (123456:ABC-DEF…)' });
      if (p === 'tools.allow' && v !== '*' && !Array.isArray(v)) errors.push({ path: p, msg: 'tools.allow: "*" eller array av verktygsnamn' });
      if (isPlain(v)) walk(v, p);
    }
  };
  walk(patch);
  void current;
  return errors;
}

function flattenDiff(base, patch, prefix = '', out = []) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isPlain(v)) flattenDiff(getPath(base, k) ?? {}, v, p, out);
    else out.push({ path: p, from: getPath(base, k), to: v });
  }
  return out;
}

/* -------------------------------- loader ---------------------------------- */

/** Data stays pure JSON; compiled RegExps live beside it, rebuilt on every change. */
export function compileRuntime(cfg) {
  const data = cfg.data;
  const MODE = { ask: 'confirm', manual: 'confirm', auto: 'off', none: 'off', every: 'strict', all: 'strict', always: 'strict' };
  const want = String(data?.guard?.mode || 'confirm').toLowerCase();
  if (data?.guard) data.guard.mode = MODE[want] || (['confirm', 'strict', 'off'].includes(want) ? want : 'confirm');
  cfg.compiled = {
    rules: (data.routing.rules || [])
      .map((r) => ({ ...r, re: toRegex(r.match) }))
      .filter((r) => r.re && r.job),
    askOn: (data.guard.askOn || []).map(toRegex).filter(Boolean),
    neverOn: (data.guard.neverOn || []).map(toRegex).filter(Boolean),
  };
  return cfg.compiled;
}

export function configFile() {
  if (process.env.MAJIN_CONFIG) return path.resolve(expand(process.env.MAJIN_CONFIG));
  if (process.env.MAJIN_HOME) return path.join(path.resolve(expand(process.env.MAJIN_HOME)), 'config.json');
  if (fs.existsSync(dirs.devConfig)) return dirs.devConfig;
  return dirs.config;
}

export function load() {
  const file = configFile();
  let stored = {};
  let fresh = false;
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fresh = true;
  }
  const data = expandEnv(merge(clone(DEFAULTS), stored));
  if (!data.server.token) data.server.token = genToken();
  if (!data.workspace) data.workspace = dirs.workspace;
  const cfg = new Config(data, file);
  compileRuntime(cfg);
  cfg.onChange(() => compileRuntime(cfg));
  cfg.isFresh = fresh;
  if (fresh) cfg.save();
  return cfg;
}

export function genToken() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export { PRESETS };
