/**
 * MAJIN V4 — durable conversation + goal storage.
 *
 * One JSON document per conversation, written atomically (tmp + rename).
 * Messages are the source of truth for the transcript; goals live in the V2
 * goal directory so the existing evidence machinery (`Goal.load`, receipts)
 * keeps working unchanged.
 *
 * Idempotency: each client turn carries a requestId. A completed requestId is
 * remembered with its outcome, so a retried request after a dropped connection
 * returns the stored answer instead of executing the tools twice.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Goal } from '../v2/runtime/goal.js';
import { STATES, TERMINAL } from '../v2/runtime/states.js';

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export const CONVERSATION_CACHE_MAX = 200;
export const CONVERSATION_LIST_MAX = 100;

export class ConversationStore {
  constructor({ dir, maxMessages = 400, cacheMax = CONVERSATION_CACHE_MAX } = {}) {
    this.dir = dir;
    this.maxMessages = maxMessages;
    this.cacheMax = cacheMax;
    fs.mkdirSync(dir, { recursive: true });
    // LRU: insertion order is the recency order because every hit re-inserts.
    // The file on disk is the source of truth, so eviction never loses data.
    this.cache = new Map();
  }

  #remember(conv) {
    this.cache.delete(conv.id);
    this.cache.set(conv.id, conv);
    while (this.cache.size > this.cacheMax) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    return conv;
  }

  #file(id) {
    if (!/^conv_[a-z0-9_]+$/.test(String(id))) throw new Error('invalid conversation id');
    return path.join(this.dir, `${id}.json`);
  }

  create({ title = 'Ny konversation' } = {}) {
    const now = new Date().toISOString();
    const conv = {
      schema: 'majin.v4.conversation/v1',
      id: newId('conv'),
      title,
      createdAt: now,
      updatedAt: now,
      version: 1,
      messages: [],
      goalIds: [],
      pendingApproval: null,
      requests: {},
    };
    this.save(conv);
    return conv;
  }

  save(conv) {
    conv.updatedAt = new Date().toISOString();
    conv.version = (conv.version || 0) + 1;
    if (conv.messages.length > this.maxMessages) {
      conv.messages = conv.messages.slice(conv.messages.length - this.maxMessages);
    }
    writeAtomic(this.#file(conv.id), conv);
    return this.#remember(conv);
  }

  get(id) {
    if (this.cache.has(id)) {
      const hit = this.cache.get(id);
      this.cache.delete(id); // re-insert = most recently used
      this.cache.set(id, hit);
      return hit;
    }
    const conv = readJson(this.#file(id));
    if (!conv || conv.schema !== 'majin.v4.conversation/v1') return null;
    return this.#remember(conv);
  }

  list() {
    const out = [];
    let files = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.startsWith('conv_') && f.endsWith('.json'));
    } catch {
      return out;
    }
    for (const f of files) {
      const conv = readJson(path.join(this.dir, f));
      if (!conv) continue;
      out.push({
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        messages: conv.messages.length,
        last: conv.messages.filter((m) => m.role !== 'system').slice(-1)[0]?.content?.slice(0, 120) || '',
      });
    }
    // Bounded: the phone's drawer never needs every conversation ever written,
    // and an unbounded list turns the menu into a full scan of the data dir.
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, CONVERSATION_LIST_MAX);
  }

  remove(id) {
    const file = this.#file(id);
    let removed = false;
    try {
      fs.unlinkSync(file);
      removed = true;
    } catch {
      removed = false;
    }
    this.cache.delete(id);
    return removed;
  }

  appendMessage(id, message) {
    const conv = this.get(id);
    if (!conv) throw new Error('conversation not found');
    const entry = {
      id: message.id || newId('msg'),
      at: new Date().toISOString(),
      role: message.role,
      content: String(message.content ?? ''),
      ...(message.meta ? { meta: message.meta } : {}),
    };
    conv.messages.push(entry);
    if (conv.title === 'Ny konversation' && entry.role === 'user') {
      conv.title = entry.content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Ny konversation';
    }
    this.save(conv);
    return entry;
  }

  /** Remember a completed turn for duplicate-request detection. */
  rememberRequest(id, requestId, outcome) {
    if (!requestId) return;
    const conv = this.get(id);
    if (!conv) return;
    conv.requests = conv.requests || {};
    conv.requests[requestId] = { at: new Date().toISOString(), ...outcome };
    const keys = Object.keys(conv.requests);
    if (keys.length > 50) delete conv.requests[keys[0]];
    this.save(conv);
  }

  getRequest(id, requestId) {
    if (!requestId) return null;
    return this.get(id)?.requests?.[requestId] || null;
  }
}

/**
 * Goals on disk, using the V2 Goal class verbatim. `reconcileOnBoot` is the
 * honest crash story: a goal saved as RUNNING when the process died did not
 * complete, and is marked BLOCKED (not silently resumed and not reported done).
 */
export const GOAL_CACHE_MAX = 200;

/**
 * States where a goal is actively being mutated by a turn. Those objects must
 * stay in memory; everything else is safely reloadable from disk (including
 * BLOCKED, which a resume loads fresh on purpose).
 */
const ACTIVE_STATES = new Set([
  STATES.RUNNING,
  STATES.WAITING_FOR_TOOL,
  STATES.WAITING_FOR_APPROVAL,
  STATES.VERIFYING,
  STATES.RECOVERING,
]);

export class GoalStore {
  constructor({ dir, cacheMax = GOAL_CACHE_MAX }) {
    this.dir = dir;
    this.cacheMax = cacheMax;
    fs.mkdirSync(dir, { recursive: true });
    // Live goal objects are a cache, not a registry: they exist so a turn keeps
    // mutating one instance. Loading is cheap and the file is the truth, so the
    // map is bounded like the conversation cache. Nothing is lost on eviction.
    this.live = new Map();
  }

  #remember(goal) {
    this.live.delete(goal.id);
    this.live.set(goal.id, goal);
    while (this.live.size > this.cacheMax) {
      // Only finished goals are evicted: an in-flight goal is the object an
      // active turn is mutating, and dropping it would orphan running work.
      // Finished goals reload from disk cheaply.
      const evictable = [...this.live.entries()].find(([id, g]) => id !== goal.id && !ACTIVE_STATES.has(g.state));
      if (evictable) {
        this.live.delete(evictable[0]);
        continue;
      }
      // Everything is actively executing. That is a burst, not normal operation:
      // allow a bounded overshoot rather than losing live work.
      if (this.live.size <= this.cacheMax * 4) break;
      const oldest = this.live.keys().next().value;
      if (oldest === goal.id) break;
      this.live.delete(oldest);
    }
    return goal;
  }

  track(goal) {
    return this.#remember(goal);
  }

  save(goal) {
    goal.save(this.dir);
    return this.#remember(goal);
  }

  get(id) {
    if (!/^goal_[a-z0-9_]+$/.test(String(id))) return null;
    if (this.live.has(id)) {
      const hit = this.live.get(id);
      this.live.delete(id);
      this.live.set(id, hit);
      return hit;
    }
    const file = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      const goal = Goal.load(file);
      return this.#remember(goal);
    } catch {
      return null;
    }
  }

  list() {
    return Goal.list(this.dir);
  }

  /** Mark goals that were mid-flight when the host stopped. Returns the ids. */
  reconcileOnBoot() {
    const blocked = [];
    for (const summary of this.list()) {
      if (summary.state !== STATES.RUNNING && summary.state !== STATES.VERIFYING) continue;
      const goal = this.get(summary.id);
      if (!goal) continue;
      try {
        goal.transition(STATES.BLOCKED, 'host restarted mid-task; resume explicitly');
        this.save(goal);
        blocked.push(goal.id);
      } catch {
        /* a goal that cannot be reconciled is reported by its stored state */
      }
    }
    return blocked;
  }
}

export function publicGoal(goal) {
  if (!goal) return null;
  const json = goal.toJSON();
  return {
    id: json.id,
    objective: json.objective,
    state: json.state,
    risk: json.risk,
    acceptance: json.acceptance,
    receipts: json.receipts.map((r) => ({
      id: r.id,
      action: r.action,
      target: r.target,
      result: r.result,
      verified: r.verified,
      acceptanceId: r.acceptanceId || null,
      evidence: r.evidence || null,
      errorClass: r.errorClass || null,
      at: r.at,
    })),
    history: json.history,
    ...(goal.revisionOf ? { revisionOf: goal.revisionOf, revision: goal.revision || 0 } : {}),
  };
}
