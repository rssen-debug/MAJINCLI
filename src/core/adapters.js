/* MAJIN — SAFE ADAPTERS (Del 7B).
   An adapter is a DECLARATIVE json descriptor for one external HTTP JSON
   endpoint. It contains NO executable code, is never eval'd, and its
   permission class tells callers what may ever happen: read = GET only,
   external-write = POST writing user data (approval territory),
   external-post = public submission (hard approval). Validation is HARD:
   an invalid adapter is never written to disk. */
import fs from 'node:fs';
import path from 'node:path';
import { dirs, resolveData } from './paths.js';
import { bus } from './log.js';

export const PERMISSIONS = Object.freeze(['read', 'external-write', 'external-post']);
export const METHODS = Object.freeze({ read: ['GET'], 'external-write': ['POST', 'PUT', 'PATCH'], 'external-post': ['POST'] });

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_\-]{0,63}$/;
const PATH_RE = /^[a-zA-Z0-9_.\[\]-]{1,120}$/;

export function validateAdapter(spec) {
  const issues = [];
  const s = spec && typeof spec === 'object' ? spec : {};
  if (!SLUG_RE.test(String(s.name || ''))) issues.push(`name must be a lowercase slug like "my-source" (got ${JSON.stringify(s.name || '')})`);
  if (s.kind !== 'http-json') issues.push(`kind must be "http-json" — adapters never run code (got ${JSON.stringify(s.kind)})`);
  const url = String(s.baseUrl || '');
  try {
    const u = new URL(url);
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
    if (u.protocol === 'javascript:' || u.protocol === 'data:') issues.push(`forbidden scheme ${u.protocol}`);
    else if (u.protocol !== 'https:' && !local) issues.push(`baseUrl must be https (or localhost in dev) — got ${u.protocol}//${u.host}`);
    if ((u.username || u.password)) issues.push('credentials must never live inside baseUrl');
  } catch {
    issues.push(`baseUrl is not a URL (got ${JSON.stringify(url)})`);
  }
  if (!PERMISSIONS.includes(s.permission)) issues.push(`permission must be one of ${PERMISSIONS.join(' | ')} (got ${JSON.stringify(s.permission)})`);
  const headers = s.headers && typeof s.headers === 'object' ? s.headers : {};
  for (const [k, v] of Object.entries(headers)) {
    if (!/^[!#$%&'*+\-.^_`|~a-zA-Z0-9]{1,64}$/.test(k)) issues.push(`odd header name ${JSON.stringify(k)}`);
    const val = String(v);
    if (/Bearer\s+(?!{env:[A-Z0-9_]+})/i.test(val) || /^sk-[A-Za-z0-9]/i.test(val)) {
      issues.push(`header ${k} looks like a raw secret — use {env:NAME} placeholders only`);
    }
    if (/javascript:|data:\/|<script/i.test(val)) issues.push(`header ${k} carries an executable payload — refused`);
  }
  /* mapping: response-field → flat where-to-put rows. Strings ONLY, paths ONLY. */
  const mapping = s.mapping && typeof s.mapping === 'object' ? s.mapping : {};
  for (const [out, from] of Object.entries(mapping)) {
    if (!FIELD_RE.test(out)) issues.push(`mapping output field ${JSON.stringify(out)} is not a plain field name`);
    if (!PATH_RE.test(String(from))) issues.push(`mapping source ${JSON.stringify(from)} must be a dotted path like items.0.title — never code`);
  }
  const timeoutMs = Number(s.timeoutMs ?? 15000);
  if (!(timeoutMs >= 1000 && timeoutMs <= 120000)) issues.push('timeoutMs must sit inside 1000..120000');
  const rate = s.rate && typeof s.rate === 'object' ? Number(s.rate.maxPerHour) : 60;
  if (!(rate >= 1 && rate <= 10000)) issues.push('rate.maxPerHour must sit inside 1..10000');
  return issues;
}

export class Adapters {
  constructor(cfg) {
    this.cfg = cfg;
    this.dir = resolveData(cfg?.get('adapters.dir'), dirs.adapters);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list() {
    try {
      return fs.readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try { return { ...JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')), file: f }; } catch { return { file: f, broken: true }; }
        });
    } catch { return []; }
  }

  /** HARD validation before write — an invalid adapter never touches disk. */
  create(spec) {
    const issues = validateAdapter(spec);
    if (issues.length) return { ok: false, issues };
    const file = path.join(this.dir, `${String(spec.name)}.json`);
    const clean = {
      name: String(spec.name),
      kind: 'http-json',
      baseUrl: String(spec.baseUrl),
      permission: String(spec.permission),
      headers: spec.headers && typeof spec.headers === 'object' ? spec.headers : {},
      mapping: spec.mapping && typeof spec.mapping === 'object' ? spec.mapping : {},
      timeoutMs: Math.max(1000, Math.min(120000, Number(spec.timeoutMs ?? 15000))),
      rate: { maxPerHour: Math.max(1, Math.min(10000, Number(spec.rate?.maxPerHour ?? 60))) },
      created: new Date().toISOString(),
    };
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n');
    fs.renameSync(tmp, file); /* atomic */
    bus.info('adapter.create', { name: clean.name, permission: clean.permission });
    return { ok: true, adapter: clean, file };
  }

  remove(name) {
    const file = path.join(this.dir, `${name}.json`);
    if (!fs.existsSync(file)) return { ok: false, why: `no adapter ${name}` };
    fs.unlinkSync(file);
    bus.info('adapter.remove', { name });
    return { ok: true };
  }
}
