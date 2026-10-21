/**
 * V2 memory store (master brief section 8).
 *
 * JSON-file-backed, namespaced, user-controllable memory. Zero dependencies
 * (unit of truth = one file per namespace inside a store directory; the
 * node:sqlite decision is documented and deferred to alpha packaging).
 * Families match the brief: conversation / project / task / preference /
 * tool-success / failure-pattern / workflow / environment.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MEMORY_KINDS = Object.freeze([
  'conversation', 'project', 'task', 'preference',
  'tool-success', 'failure-pattern', 'workflow', 'environment',
]);

export const MEMORY_SCHEMA = 'majin.v2.memory/v1';

export class MemoryStore {
  constructor(dir, { maxEntriesPerNs = 2000 } = {}) {
    if (!dir) throw new Error('MemoryStore requires a directory');
    this.dir = dir;
    this.maxEntriesPerNs = maxEntriesPerNs;
    fs.mkdirSync(dir, { recursive: true });
    this._cache = new Map(); // ns -> array entries
  }

  #fileFor(ns) { return path.join(this.dir, `${ns}.json`); }

  #loadNs(ns) {
    if (this._cache.has(ns)) return this._cache.get(ns);
    let entries = [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.#fileFor(ns), 'utf8'));
      if (raw && raw.schema === MEMORY_SCHEMA && Array.isArray(raw.entries)) entries = raw.entries;
    } catch { /* missing/corrupt -> empty namespace; never fail a goal over memory */ }
    this._cache.set(ns, entries);
    return entries;
  }

  #writeNs(ns, entries) {
    const tmp = this.#fileFor(ns) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ schema: MEMORY_SCHEMA, kind: ns, entries }, null, 2));
    fs.renameSync(tmp, this.#fileFor(ns));
    this._cache.set(ns, entries);
  }

  /**
   * Store an entry. ns must be a known kind; key dedupes within ns.
   * Entry: { key, text, tags[], importance 0..1, sensitive? (never serialized when true), meta? }
   */
  put(ns, { key, text, tags = [], importance = 0.5, sensitive = false, meta = null }) {
    if (!MEMORY_KINDS.includes(ns)) throw new Error(`unknown memory kind: ${ns}`);
    if (!key || text == null) throw new Error('memory entry requires key and text');
    if (sensitive === true) throw new Error('sensitive memory must never be stored (brief 8/57): invent a redacted form first');
    const entries = this.#loadNs(ns).filter((e) => e.key !== key);
    entries.push({
      key, text: String(text), tags: [...tags], importance: Math.max(0, Math.min(1, Number(importance) || 0)),
      meta, at: new Date().toISOString(),
      id: crypto.createHash('sha256').update(`${ns}:${key}`).digest('hex').slice(0, 16),
    });
    // retention: keep highest importance, newest first within ties
    entries.sort((a, b) => (b.importance - a.importance) || (b.at < a.at ? -1 : 1));
    const capped = entries.slice(0, this.maxEntriesPerNs);
    this.#writeNs(ns, capped);
    return capped[capped.findIndex((e) => e.key === key)];
  }

  get(ns, key) { return this.#loadNs(ns).find((e) => e.key === key) || null; }
  list(ns, { last = 50 } = {}) { return this.#loadNs(ns).slice(0, last); }

  delete(ns, key) {
    const entries = this.#loadNs(ns).filter((e) => e.key !== key);
    this.#writeNs(ns, entries);
    return true;
  }

  /**
   * Substring search over text+tags, ranked: tag hit > text hit, importance desc.
   * (Full-text/semantic ranking upgrades ride the sqlite/embedding decision —
   *  the API already accepts queries so the upgrade is invisible to callers.)
   */
  search(ns, query, { limit = 10 } = {}) {
    if (!query) return [];
    const q = String(query).toLowerCase();
    const hits = [];
    for (const e of this.#loadNs(ns)) {
      const tagHit = e.tags.some((t) => t.toLowerCase().includes(q)) ? 2 : 0;
      const textHit = e.text.toLowerCase().includes(q) ? 1 : 0;
      if (tagHit || textHit) hits.push({ e, score: tagHit || textHit });
    }
    return hits
      .sort((a, b) => (b.score - a.score) || (b.e.importance - a.e.importance))
      .slice(0, limit)
      .map((h) => h.e);
  }

  /** Export everything (user data ownership, brief 173). */
  exportAll() {
    const out = { schema: MEMORY_SCHEMA, exportedAt: new Date().toISOString(), kinds: {} };
    for (const k of MEMORY_KINDS) out.kinds[k] = this.#loadNs(k);
    return out;
  }

  /** Wipe one kind or the whole store (user control, brief 8.3). */
  clear(ns = null) {
    if (ns) { this.#writeNs(ns, []); return; }
    for (const k of MEMORY_KINDS) this.#writeNs(k, []);
  }
}
