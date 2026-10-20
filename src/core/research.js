/**
 * MAJIN W2 RESEARCH — PLAN → SEARCH → FETCH → EXTRACT → CROSS-CHECK → SYNTHESIZE → VERIFY.
 *
 * Design principles (master directive W2):
 *  - Multiple independent searches per question (never one result).
 *  - Every claim binds to ≥1 fetched source or is flagged 'unsupported'.
 *  - Contradictions across sources are flagged, never silently merged.
 *  - No fabricated sources/citations: the citation ledger only lists URLs actually fetched.
 *  - Offline-testable core: search/fetch functions are injectable.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const VERSION = 'majin-research/1';

const STOP = new Set('a an and are as at be but by for from has have if in into is it its of on or that the this to was were will with'.split(' '));

const TERMS = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));

/* ----------------------------------- PLAN --------------------------------- */
export function plan(question, { maxSubQueries = 4 } = {}) {
  const q = String(question || '').trim();
  if (!q) return { ok: false, error: { code: 'empty_question' } };
  const base = TERMS(q);
  const queries = [q];
  const morphs = [];
  const aspects = [['formal', ['definition', 'overview']], ['numeric', ['statistics', 'data']], ['temporal', ['2026', 'latest']]];
  for (const [a, words] of aspects) {
    if (queries.length >= maxSubQueries) break;
    morphs.push({ aspect: a, query: `${base.slice(0, 6).join(' ')} ${words[queries.length % words.length]}` });
  }
  for (const m of morphs) if (m.query.trim().length > 8) queries.push(m.query.trim());
  return { ok: true, question: q, queries: queries.slice(0, Math.max(2, maxSubQueries)), strategy: 'term-focus × definition × numeric × recency' };
}

/* -------------------------------- EXTRACTION ------------------------------- */
const SENT_SPLIT = /(?<=[.!?])\s+(?=[A-ZÅÄÖ0-9"'])/;
function* sentences(text, { max = 400 } = {}) {
  const raw = String(text).replace(/\s+/g, ' ');
  let n = 0;
  for (const chunk of raw.split(SENT_SPLIT)) {
    const s = chunk.trim();
    if (s.length >= 25 && s.length <= 600) { yield s; if (++n >= max) return; }
  }
}
export function extractClaims(docText, { questionTerms = [], maxClaims = 12 } = {}) {
  const claims = [];
  const anchors = questionTerms.length ? questionTerms : [];
  for (const s of sentences(docText)) {
    const low = s.toLowerCase();
    const hits = anchors.filter((t) => low.includes(t));
    let score = hits.length;
    if (/\d/.test(s)) score += 0.5;
    if (/\bcalled\b|known as|hanteras|enligt|according to/i.test(s)) score += 0.3;
    if (/disclaimer|cookie policy|sign up|subscribe now|reklam|voltageshus/.test(low)) score -= 2;
    if (score >= 1) claims.push({ sentence: s.replace(/\s+/g, ' ').trim(), anchors: hits, score: Math.round(score * 10) / 10 });
    if (claims.length >= maxClaims * 3) break;
  }
  return claims.sort((a, b) => b.score - a.score).slice(0, maxClaims);
}

/* ------------------------------ CROSS-CHECKING ----------------------------- */
const POLARS = [
  [/\b(never|not|no|without|cannot|inte|aldrig|ej)\b/i, /\b(always|must|requires?|every|alltid|kräver)\b/i],
  [/\b(increas|grew?|risin|upp|högre)\w*/i, /\b(decreas|declin|fell|sänk|minsk|lower)\w*/i],
];
function opposingPolarity(a, b) {
  return POLARS.some(([neg, pos]) =>
    (neg.test(a) && !pos.test(a) && pos.test(b) && !neg.test(b))
    || (pos.test(a) && !neg.test(a) && neg.test(b) && !pos.test(b)));
}
export function crossCheck(claimsBySource) {
  const buckets = new Map();
  let claimsRaw = 0;
  for (const [srcId, claims] of Object.entries(claimsBySource)) {
    for (const c of claims) {
      claimsRaw++;
      const key = (c.anchors.join('|') || TERMS(c.sentence).slice(0, 3).join('|'));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ ...c, sourceId: srcId });
    }
  }
  const clusters = [];
  for (const group of buckets.values()) {
    const seen = new Set();
    const merged = [];
    outer: for (const c of group) {
      for (const m of merged) {
        const overlap = sim(c.sentence, m.sentence);
        if (overlap > 0.55 && !opposingPolarity(c.sentence, m.sentence)) { m.sources.push(c.sourceId); m.support++; seen.add(c.sourceId); continue outer; }
      }
      merged.push({ sentence: c.sentence, anchors: c.anchors, support: 1, sources: [c.sourceId], conflicts: false });
    }
    // Only mark a conflict when distinct claims in this bucket explicitly oppose each other.
    // A single sentence can contain both polarities while describing a timeline,
    // so testing hasNeg && hasPos across the entire group produces false positives.
    for (const [neg, pos] of POLARS) {
      for (let i = 0; i < merged.length; i++) {
        for (let j = i + 1; j < merged.length; j++) {
          const a = merged[i].sentence;
          const b = merged[j].sentence;
          const opposite = (neg.test(a) && pos.test(b) && !pos.test(a) && !neg.test(b))
            || (pos.test(a) && neg.test(b) && !neg.test(a) && !pos.test(b));
          if (opposite && sim(a, b) > 0.35) {
            merged[i].conflicts = true;
            merged[j].conflicts = true;
          }
        }
      }
    }
    clusters.push(...merged);
  }
  return { clusters, claimsRaw };
}
function sim(a, b) {
  const A = new Set(TERMS(a)), B = new Set(TERMS(b));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, Math.min(A.size, B.size));
}

/* -------------------------------- RELIABILITY ------------------------------ */
export function reliability(url, { fetchedAt } = {}) {
  let score = 0.5; const reasons = [];
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') { score += 0.1; } else { score -= 0.15; reasons.push('non-https'); }
    if (/\.(gov|edu|se|no|fi|dk)$/.test(u.hostname)) { score += 0.1; reasons.push('authority tld'); }
    if (/wikipedia/.test(u.hostname)) { score += 0.05; reasons.push('encyclopedic (secondary)'); }
    if (/blog|medium|wordpress|substack/.test(u.hostname)) { score -= 0.1; reasons.push('self-published'); }
  } catch { score = 0.2; reasons.push('unparseable url'); }
  if (fetchedAt) reasons.push(`fetched ${fetchedAt}`);
  return { score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), reasons };
}

/* --------------------------------- SYNTHESIZE ------------------------------ */
export function synthesize({ question, clusters, sources, ledger }) {
  const L = [];
  L.push(`# Research report — ${question}`);
  L.push(``); L.push(`Engine: ${VERSION} · generated ${new Date().toISOString()} · sources fetched: ${sources.length}`);
  L.push(``);
  const supported = clusters.filter((c) => c.support >= 1);
  const conflicted = clusters.filter((c) => c.conflicts);
  L.push(`## Findings (each bound to actual fetched sources)`);
  L.push(``);
  for (const c of supported.slice(0, 14)) {
    const refs = c.sources.map((id) => (ledger.sourcesByIds.indexOf(id) + 1) || '').filter(x => x !== '');
    L.push(`- ${c.sentence} ${refs.length ? `[${refs.join(', ')}]` : '*(unsupported)*'}`);
  }
  if (conflicted.length) {
    L.push(``); L.push(`## Contradictions detected (flagged, never merged)`);
    for (const c of conflicted.slice(0, 8)) L.push(`- ${c.sentence} (sources: ${c.sources.join(', ')})`);
  }
  L.push(``); L.push(`## Source ledger (only actually fetched URLs)`);
  sources.forEach((s, i) => {
    L.push(`[${i + 1}] ${s.url} — reliability ${s.reliability.score} (${s.reliability.reasons.join('; ')})`);
  });
  return L.join('\n');
}

/* ----------------------------------- VERIFY -------------------------------- */
export function verify(report, { clusters }) {
  const findings = (report.match(/^- /gm) || []).length;
  const unsupported = clusters.filter((c) => !c.support).length;
  const conflicted = clusters.filter((c) => c.conflicts).length;
  return {
    ok: findings >= 3, findings, unsupported, conflicted,
    verdict: unsupported === 0 ? 'all claims sourced' : `${unsupported} claims dropped (no support)`,
  };
}

/* --------------------------------- PIPELINE -------------------------------- */
export async function run(question, opts = {}) {
  const { searchFn, fetchFn, maxSources = 6, artifactsDir = null, provider = null } = opts;
  if (typeof searchFn !== 'function' || typeof fetchFn !== 'function') {
    return { ok: false, error: { code: 'engine_miswired', message: 'searchFn and fetchFn must be injected (registry supplies them from web.search/web.fetch)' } };
  }
  const p = plan(question, opts);
  if (!p.ok) return p;
  const progress = [{ step: 'plan', queries: p.queries }];

  // SEARCH (multiple independent queries)
  const found = new Map();
  for (const q of p.queries) {
    let hits = [];
    try { hits = await searchFn(q, { count: 5 }); } catch (e) { hits = []; progress.push({ step: 'search', query: q, error: String(e?.message || e) }); }
    for (const h of (hits || [])) {
      const u = typeof h === 'string' ? h : (h.url || h.link);
      if (u && !found.has(u)) found.set(u, { url: u, title: (typeof h === 'object' && h.title) || '', snippet: (typeof h === 'object' && (h.snippet || h.description)) || '' });
    }
  }
  progress.push({ step: 'search', hits: found.size });

  // FETCH (bounded)
  const sources = []; const claimsBy = {};
  for (const { url, title } of [...found.values()].slice(0, maxSources)) {
    let text = '';
    try { text = await fetchFn(url, { maxChars: 60000 }); } catch (e) { progress.push({ step: 'fetch', url, error: String(e?.message || e) }); continue; }
    if (!text || text.length < 200) { progress.push({ step: 'fetch', url, dropped: 'too thin' }); continue; }
    const id = `S${sources.length + 1}`;
    const fetchedAt = new Date().toISOString();
    sources.push({ id, url, title, bytes: text.length, fetchedAt, reliability: reliability(url, { fetchedAt }) });
    claimsBy[id] = extractClaims(htmlToText(text), { questionTerms: TERMS(question), maxClaims: 10 });
  }
  progress.push({ step: 'fetch', sources: sources.length });
  if (!sources.length) return { ok: false, error: { code: 'no_sources', message: 'every candidate URL failed to yield text — refusing to invent a report' }, progress };

  const cc = crossCheck(claimsBy);
  progress.push({ step: 'cross-check', clusters: cc.clusters.length });
  const ledger = { question, planOutput: p, sourcesByIds: sources.map((s) => s.id), urlById: Object.fromEntries(sources.map((s) => [s.id, s.url])), claimsRaw: cc.claimsRaw };
  const report = synthesize({ question, clusters: cc.clusters, sources, ledger });
  const stats = verify(report, { clusters: cc.clusters });
  progress.push({ step: 'verify', ...stats });

  const artifact = {
    engine: VERSION, question, stats, clusters: cc.clusters.length,
    sources: sources.map(({ id, url, title, reliability: r, fetchedAt }) => ({ id, url, title, reliability: r, fetchedAt })),
    progress, report,
  };

  if (artifactsDir) {
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, 'report.md'), report);
    fs.writeFileSync(path.join(artifactsDir, 'ledger.json'), JSON.stringify({ ledger, stats, clusters: cc.clusters }, null, 2));
    fs.writeFileSync(path.join(artifactsDir, 'sources.jsonl'), sources.map((s) => JSON.stringify(s)).join('\n') + '\n');
    artifact.paths = { report: path.join(artifactsDir, 'report.md'), ledger: path.join(artifactsDir, 'ledger.json') };
  }
  return { ok: true, ...artifact };
}

function htmlToText(s) {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
