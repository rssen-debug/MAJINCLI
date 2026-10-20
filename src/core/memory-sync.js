/**
 * MAJIN W9 MEMORY SYNC — bidirectional, conflict-safe sync between two
 * Memory stores (e.g. this machine's MAJIN and a server/shared drive).
 *
 * Contract majin-memory-sync/1:
 * - every store has a persistent spawnId (own sidecar file, no core-memory
 *   schema change → backward compatible)
 * - sync = export deltas since last-applied origin rev, both directions
 * - replay is CONTENT-IDEMPOTENT: remember() skips identical facts (its own
 *   proof inside memory.js), forget() on an absent fact is a no-op — that is
 *   why the engine needs no vector clocks
 * - tombstone rule: a forget-delta replays forget(query) locally; a LATER
 *   re-add wins because it is a later delta in replay order
 * - dryRun measures everything and writes NOTHING (mirrors reset.plan)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Memory } from './memory.js';

export const VERSION = 'majin-memory-sync/1';

function sidecar(dir, name) { return path.join(dir, name); }

export function spawnId(mem) {
  const f = sidecar(mem.dir, 'memory-sync-id.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).id; } catch { /* mint */ }
  const id = 'mem-' + crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(f, JSON.stringify({ id, createdAt: new Date().toISOString() }) + '\n');
  return id;
}

function ledger(mem) {
  const f = sidecar(mem.dir, 'memory-sync-ledger.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { appliedFrom: {} }; }
}
function noteApplied(mem, originId, rev) {
  const f = sidecar(mem.dir, 'memory-sync-ledger.json');
  const l = ledger(mem);
  l.appliedFrom[originId] = Math.max(l.appliedFrom[originId] || 0, rev);
  fs.writeFileSync(f, JSON.stringify(l) + '\n');
}

export function exportBundle(mem, { fromRev = 0 } = {}) {
  return {
    version: VERSION,
    origin: spawnId(mem),
    fromRev,
    toRev: mem.rev(),
    deltas: mem.deltaSince(fromRev, { limit: 500 }),
  };
}

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

/* Resurrected-echo guard: my own newest local delta about this fact says
   FORGET, and the incoming (re-)add predates it → the add is the echo of
   something I deleted, not new information. Skipping it is what makes
   tombstones win without vector clocks. */
function localTombstoneTs(mem, factText) {
  const n = norm(factText);
  let ts = null;
  for (const d of mem.deltaSince(0, { limit: 2000 })) {
    if (d.kind === 'forget' && (n.includes(norm(d.text)) || norm(d.text).includes(n)) && norm(d.text)) {
      ts = d.ts; // keep the LATEST forget
    }
  }
  return ts;
}

export function applyBundle(mem, bundle, { dryRun = false } = {}) {
  const out = { applied: 0, skippedDup: 0, skippedSeen: 0, skippedResurrected: 0, errors: [] };
  if (!bundle || bundle.origin === spawnId(mem)) { out.skippedSelf = true; return out; }
  const seenFrom = ledger(mem).appliedFrom[bundle.origin] || 0;
  for (const d of bundle.deltas || []) {
    if (!Number.isFinite(d.rev) || d.rev <= seenFrom) { out.skippedSeen++; continue; }
    try {
      if (d.kind === 'add' || d.kind === 'update') {
        const tomb = localTombstoneTs(mem, d.text);
        if (tomb && (!d.ts || d.ts <= tomb)) { out.skippedResurrected++; continue; }
        if (dryRun) { out.applied++; continue; }
        const r = mem.remember(d.text);
        if (r.unchanged) out.skippedDup++; else out.applied++;
      } else if (d.kind === 'forget') {
        if (dryRun) { out.applied++; continue; }
        mem.forget(d.text);
        out.applied++;
      } else {
        out.skippedKind = (out.skippedKind || 0) + 1;
      }
    } catch (e) {
      out.errors.push({ rev: d.rev, error: String(e?.message || e) });
    }
  }
  /* dryRun writes NOTHING — not even the ledger. Intent is enforced, not assumed. */
  if (!dryRun && !out.errors.length && Number.isFinite(bundle.toRev)) {
    noteApplied(mem, bundle.origin, Math.max(seenFrom, bundle.toRev));
  }
  return out;
}

/** Two-way sync between two Memory dirs. Returns the measured report. */
export function syncPair(memA, memB, { dryRun = false } = {}) {
  const idA = spawnId(memA), idB = spawnId(memB);
  if (idA === idB) return { ok: false, error: { code: 'same_store', message: 'both stores share a spawnId — cloning a memory dir means the second copy must be re-minted (delete its memory-sync-id.json)' } };
  const ledA = ledger(memA), ledB = ledger(memB);
  const bundleBtoA = exportBundle(memB, { fromRev: ledA.appliedFrom[idB] || 0 });
  const bundleAtoB = exportBundle(memA, { fromRev: ledB.appliedFrom[idA] || 0 });
  const rA = applyBundle(memA, bundleBtoA, { dryRun });
  const rB = applyBundle(memB, bundleAtoB, { dryRun });
  return {
    ok: true,
    stores: { a: { id: idA, rev: memA.rev(), dir: memA.dir }, b: { id: idB, rev: memB.rev(), dir: memB.dir } },
    aReceived: rA, bReceived: rB,
    factsNow: dryRun ? { a: '(not modified)', b: '(not modified)' } : { a: memA.facts().length, b: memB.facts().length },
    dryRun: Boolean(dryRun),
  };
}
