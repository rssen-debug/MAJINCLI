/**
 * MAJIN V6 — task relay transports.
 *
 * Arena cannot reach the Windows host directly, so work travels over a relay
 * the Windows host polls *outbound*. Two transports implement the same tiny
 * interface:
 *
 *   GitHubRelay  — a private repository (Arena writes; Windows polls over HTTPS)
 *   HttpRelay    — a plain authenticated HTTP endpoint (local bridge / LAN)
 *
 * Interface:
 *   listInbox()                 -> [{ id, path }]
 *   fetch(id)                   -> envelope object
 *   acknowledge(id, meta)       -> moves the item out of the inbox
 *   publish(id, result)         -> writes the result for the planner
 *
 * The relay only carries envelopes and sanitized results. It never carries the
 * signing secret, credentials, CV contents or email bodies.
 */
import { ArenaError } from './envelope.js';
import { verifyPrivateRepo } from '../sync.js';

const API = 'https://api.github.com';
const MAX_RESULT_BYTES = 64 * 1024;

async function githubFetch({ token, route, method = 'GET', body = null, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${API}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'MAJIN-V6-arena',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  let json = null;
  try { json = await response.json(); } catch { /* empty body is fine */ }
  return { ok: response.ok, status: response.status, json };
}

const encodePath = (value) => String(value).split('/').map(encodeURIComponent).join('/');

export class GitHubRelay {
  constructor({ token, repo, root = 'arena', branch = null, fetchImpl = globalThis.fetch, log = null } = {}) {
    if (!token || !repo) throw new ArenaError('GitHubRelay needs a token and repo', 'ARENA_RELAY_CONFIG');
    this.token = token;
    this.repo = repo;
    this.root = root.replace(/^\/+|\/+$/g, '');
    this.branch = branch;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.verified = null;
  }

  async #verify() {
    if (this.verified) return this.verified;
    const result = await verifyPrivateRepo({ token: this.token, repo: this.repo, fetchImpl: this.fetchImpl });
    if (!result.ok) throw new ArenaError(`Relay repository is not usable: ${result.error.reason}`, result.error.code);
    this.verified = result;
    this.branch = this.branch || result.defaultBranch;
    return result;
  }

  async #get(file) {
    await this.#verify();
    const route = `/repos/${this.repo}/contents/${encodePath(file)}${this.branch ? `?ref=${encodeURIComponent(this.branch)}` : ''}`;
    return githubFetch({ token: this.token, route, fetchImpl: this.fetchImpl });
  }

  async #put(file, value, message) {
    await this.#verify();
    const existing = await this.#get(file);
    const sha = existing.status === 200 ? existing.json?.sha : null;
    if (existing.status !== 200 && existing.status !== 404) {
      throw new ArenaError(`Relay read failed for ${file} (HTTP ${existing.status})`, 'ARENA_RELAY_READ_FAILED');
    }
    const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8').toString('base64');
    const result = await githubFetch({
      token: this.token, method: 'PUT',
      route: `/repos/${this.repo}/contents/${encodePath(file)}`,
      body: { message, content, branch: this.branch, ...(sha ? { sha } : {}) },
      fetchImpl: this.fetchImpl,
    });
    if (!result.ok) throw new ArenaError(`Relay write failed for ${file} (HTTP ${result.status})`, 'ARENA_RELAY_WRITE_FAILED');
    return result.json;
  }

  async #delete(file, sha, message) {
    await this.#verify();
    const result = await githubFetch({
      token: this.token, method: 'DELETE',
      route: `/repos/${this.repo}/contents/${encodePath(file)}`,
      body: { message, sha, branch: this.branch },
      fetchImpl: this.fetchImpl,
    });
    if (!result.ok && result.status !== 404) {
      throw new ArenaError(`Relay delete failed for ${file} (HTTP ${result.status})`, 'ARENA_RELAY_WRITE_FAILED');
    }
  }

  async listInbox() {
    const dir = `${this.root}/inbox`;
    const result = await this.#get(dir);
    if (result.status === 404) return [];
    if (!result.ok) throw new ArenaError(`Relay inbox listing failed (HTTP ${result.status})`, 'ARENA_RELAY_READ_FAILED');
    const entries = Array.isArray(result.json) ? result.json : [];
    return entries
      .filter((entry) => entry.type === 'file' && /\.json$/.test(entry.name))
      .map((entry) => ({ id: entry.name.replace(/\.json$/, ''), path: entry.path, sha: entry.sha }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async fetch(id) {
    const file = `${this.root}/inbox/${id}.json`;
    const result = await this.#get(file);
    if (result.status === 404) throw new ArenaError(`Envelope ${id} is no longer in the inbox`, 'ARENA_ENVELOPE_MISSING');
    if (!result.ok) throw new ArenaError(`Envelope read failed (HTTP ${result.status})`, 'ARENA_RELAY_READ_FAILED');
    try {
      return JSON.parse(Buffer.from(result.json.content, 'base64').toString('utf8'));
    } catch {
      throw new ArenaError('Envelope is not valid JSON', 'ARENA_ENVELOPE_INVALID');
    }
  }

  async acknowledge(id, meta = {}) {
    await this.#put(`${this.root}/acks/${id}.json`, {
      envelopeId: id,
      acknowledgedAt: new Date().toISOString(),
      ...meta,
    }, `v6 arena: acknowledge ${id}`);
    const file = `${this.root}/inbox/${id}.json`;
    const current = await this.#get(file);
    if (current.status === 200 && current.json?.sha) {
      await this.#delete(file, current.json.sha, `v6 arena: consume ${id}`);
    }
    return { ok: true };
  }

  async publish(id, result) {
    const body = JSON.stringify(result);
    if (Buffer.byteLength(body) > MAX_RESULT_BYTES) {
      throw new ArenaError('Result is too large for the relay', 'ARENA_RESULT_TOO_LARGE');
    }
    await this.#put(`${this.root}/outbox/${id}.json`, result, `v6 arena: result ${id}`);
    return { ok: true, path: `${this.root}/outbox/${id}.json` };
  }

  /**
   * Real round trip against the configured repository.
   *   read  — repository is visible, private, and has a default branch
   *   write — a tiny probe object is written, read back and deleted
   * Never writes when `write` is false, so a read-only diagnosis stays read-only.
   */
  async probe({ id = `probe-${Date.now()}`, write = false } = {}) {
    const verified = await this.#verify();
    const base = { repo: verified.repo, branch: this.branch, path: `${this.root}/.probe/${id}.json`, readable: true };
    if (!write) return { ok: true, repo: verified.repo, ...base, wrote: false };
    const payload = { schema: 'majin.v6.arena.probe/v1', id, at: new Date().toISOString() };
    await this.#put(base.path, payload, `v6 arena: probe ${id}`);
    const read = await this.#get(base.path);
    if (!read.ok) throw new ArenaError(`Probe written but not readable back (HTTP ${read.status})`, 'ARENA_RELAY_READ_FAILED');
    const body = JSON.parse(Buffer.from(read.json.content, 'base64').toString('utf8'));
    if (body?.id !== id) throw new ArenaError('Probe read back a different object', 'ARENA_RELAY_PROBE_MISMATCH');
    await this.#delete(base.path, read.json.sha, `v6 arena: probe cleanup ${id}`);
    return { ok: true, repo: verified.repo, branch: this.branch, path: base.path, wrote: true, readBack: true, cleanedUp: true };
  }
}

/**
 * HTTP relay: same interface over a JSON API. Used by the local bridge and by
 * controlled end-to-end tests. Requires bearer auth and refuses redirects to
 * other origins (the token must not leak).
 */
export class HttpRelay {
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, log = null } = {}) {
    if (!baseUrl) throw new ArenaError('HttpRelay needs a baseUrl', 'ARENA_RELAY_CONFIG');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new ArenaError('Relay must be http(s)', 'ARENA_RELAY_CONFIG');
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new ArenaError('Plain HTTP is only allowed for a loopback relay; use HTTPS', 'ARENA_RELAY_INSECURE');
    }
    this.baseUrl = url.toString().replace(/\/+$/, '');
    this.token = token || '';
    this.fetchImpl = fetchImpl;
    this.log = log;
  }

  async #request(path, { method = 'GET', body = null } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401 || response.status === 403) throw new ArenaError('Relay rejected the bridge token', 'ARENA_RELAY_UNAUTHORIZED');
    let json = null;
    try { json = await response.json(); } catch { /* optional body */ }
    if (!response.ok) throw new ArenaError(`Relay ${method} ${path} failed (HTTP ${response.status})`, 'ARENA_RELAY_HTTP');
    return json;
  }

  async listInbox() {
    const json = await this.#request('/relay/inbox');
    return (json?.items || []).map((item) => ({ id: String(item.id) }));
  }

  async fetch(id) {
    return this.#request(`/relay/inbox/${encodeURIComponent(id)}`);
  }

  async acknowledge(id, meta = {}) {
    return this.#request(`/relay/ack/${encodeURIComponent(id)}`, { method: 'POST', body: meta });
  }

  async publish(id, result) {
    const body = JSON.stringify(result);
    if (Buffer.byteLength(body) > MAX_RESULT_BYTES) throw new ArenaError('Result is too large for the relay', 'ARENA_RESULT_TOO_LARGE');
    return this.#request(`/relay/outbox/${encodeURIComponent(id)}`, { method: 'PUT', body: result });
  }

  /** Real round trip: write a probe object, read it back, remove it when supported. */
  async probe({ id = `probe-${Date.now()}` } = {}) {
    const payload = { schema: 'majin.v6.arena.probe/v1', id, at: new Date().toISOString() };
    const pathName = `/relay/outbox/${encodeURIComponent(id)}`;
    await this.#request(pathName, { method: 'PUT', body: payload });
    const back = await this.#request(pathName).catch(() => null);
    const readBack = Boolean(back && back.id === id);
    let cleanedUp = false;
    try {
      await this.#request(pathName, { method: 'DELETE' });
      cleanedUp = true;
    } catch { /* the relay may not implement DELETE; the probe object is inert */ }
    if (!readBack) throw new ArenaError('Relay accepted the probe but did not return it', 'ARENA_RELAY_PROBE_MISMATCH');
    return { ok: true, path: pathName, wrote: true, readBack, cleanedUp };
  }
}

export function relayFromPolicy({ policy, token, fetchImpl = globalThis.fetch, log = null }) {
  const relay = policy?.relay;
  if (!relay || !relay.type) throw new ArenaError('Owner policy has no relay configuration', 'ARENA_RELAY_CONFIG');
  if (relay.type === 'github') {
    if (!token) throw new ArenaError('GitHub relay needs MAJIN_V6_SYNC_TOKEN or arena/github-token', 'ARENA_TOKEN_MISSING');
    return new GitHubRelay({ token, repo: relay.repo, root: relay.path || 'arena', branch: relay.branch || null, fetchImpl, log });
  }
  if (relay.type === 'http') {
    return new HttpRelay({ baseUrl: relay.url, token: token || relay.token, fetchImpl, log });
  }
  throw new ArenaError(`Unknown relay type ${relay.type}`, 'ARENA_RELAY_CONFIG');
}
