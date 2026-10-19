/**
 * MAJIN — GRAND ARCHITECT mission compiler.
 *
 * Pipeline: fritt mal → shouldMission (deterministisk heuristik) → compileMission
 * (EN modellkall som ber om ren JSON) → validateGraph + analyzer beslutar i KOD
 * hur manga workers → HYPERSWARM kor. Om vilken niva som helst brister:
 * { kind:'single' } — vanilla turn tar vid. GENESIS ZERO overlever alltid.
 */
import { complete } from './provider/chat.js';
import { routeFor } from './router.js';
import { analyzeSwarm, runSwarm, subagentWorker, validateGraph } from './swarm.js';

const LIST_RE = /(?:^|\n)\s*(?:\d{1,2}[.):\-]|[-*•])\s*\S+/g;
/* inline-listor: "(1) x, (2) y, (3) z" i EN rad. Radbrudnent-listre
   rad reaktionen missade detta (bug 2026-10-18). Krav for att skara mot
   decimaler och littlösa tal: >= 3 items, samma marker-familj, sekvensen
   stiger steg ett frn start (1/a). */
export function splitInlineItems(t) {
  const src = String(t || '').replace(/\s+/g, ' ').trim();
  const re = /(?:^|[\s(])(\d{1,2}|[a-z])[.)]\s/gu;
  const hits = [];
  for (const m of src.matchAll(re)) {
    const markerStart = m.index + m[0].indexOf(m[1]);
    const numeric = /\d/.test(m[1]);
    hits.push({ start: markerStart, after: m.index + m[0].length, mark: m[1], numeric });
  }
  if (hits.length < 3) return null;
  const kinds = new Set(hits.map((h) => h.numeric));
  if (kinds.size !== 1) return null;
  const isNum = hits[0].numeric;
  const seq = hits.map((h) => (isNum ? parseInt(h.mark, 10) : h.mark.charCodeAt(0) - 96));
  if (seq[0] !== 1) return null;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1] + 1) return null;
  const items = [];
  for (let i = 0; i < hits.length; i++) {
    const from = hits[i].after;
    const to = i + 1 < hits.length ? hits[i + 1].start : src.length;
    const piece = src.slice(from, to).replace(/[\s),;.-]+$/, '').trim();
    if (piece.length < 4) return null;
    items.push(piece);
  }
  return items;
}

const ACTION_RE = /(skriv|skapa|rensa|sortera|flytta|kopiera|zip|packa|stalla|fixa|bygg|research|lista|sok|leta|install|test|kolla|sammanfatta|sammanfatt|rapport|check|analys|rakna|dela|cut|g[oö]r|starta|stoppa|render|kompil|deploy|merge|commit|push|bekr[aä]fta|granska|write|summar|build|gather|collect|rename|move|copy|delet|create|generate|produc|draw|paint|compar|count|read|open|close|searc|look)/iu;

/* regelren heuristik: minst tva sektioner med verbeslaktat innehall */
export function shouldMission(input) {
  const t = String(input || '').trim();
  if (t.length < 24) return { mission: false, reason: 'too short to split' };
  const list = t.match(LIST_RE) || [];
  if (list.length >= 2) return { mission: true, reason: `${list.length} list items` };
  const inline = splitInlineItems(t);
  if (inline && inline.length >= 3) return { mission: true, reason: `${inline.length} inline list items` };
  const segments = t
    .split(/[;.]\s+|\s{2,}|,\s+(?:och|and)\s+|\s+(?:och sedan|and then|then|sedan|samtidigt|meanwhile)\b/iu)
    .map((x) => x.trim())
    .filter((x) => x.length > 8 && ACTION_RE.test(x));
  if (segments.length >= 3) return { mission: true, reason: `${segments.length} action segments` };
  /* kommaseparerade verbar utan lankverben */
  const commas = t.split(/,\s+/u).map((x) => x.trim()).filter((x) => x.length > 6 && ACTION_RE.test(x));
  if (commas.length >= 3) return { mission: true, reason: `${commas.length} comma action items` };
  return { mission: false, reason: 'single objective' };
}

/* REALITY ENGINE step 1 (mission-scale): a part that onsker claim a workspace
   artifact (fs.write-niva) ska inte kunna deklarera sig klar utan att filen
   faktiskt finns. Deterministisk verifierare — ingen modellkall. */
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { dirs as missionDirs } from './paths.js';

const WRITE_VERB_RE = /(skriv|skapa|spara|write|creat|save|generat|produc|build|bygg)/i;
const FILE_TOKEN_RE = /([A-Za-z0-9_\-.\u00e5\u00e4\u00f6\/]{1,80}\.[A-Za-z0-9]{1,5})\b/g;

/** plockar ut det fil-targeten som delen PASSTAAR att den ska skriva */
export function findClaimedArtifact(input) {
  const t = String(input || '');
  if (!WRITE_VERB_RE.test(t)) return null;
  const hits = [];
  for (const m of t.matchAll(FILE_TOKEN_RE)) {
    const tok = m[1];
    if (/^https?|www\./i.test(tok)) continue;
    if (!/\.[a-z0-9]{1,5}$/i.test(tok)) continue;
    hits.push(tok.replace(/^\.*\/+/, ''));
  }
  return hits.length ? hits[0] : null;
}

export function missionWorkspace(cfg) {
  return nodePath.resolve(cfg?.get?.('workspace') || missionDirs.workspace || process.cwd());
}

/** verifierar att pAsstaadd fil finns + har innehall (0 bytes = inte skriven) */
export function verifyClaimedArtifact(claimed, { cfg }) {
  if (!claimed) return { verifiable: false };
  const root = missionWorkspace(cfg);
  const abs = nodePath.resolve(root, claimed);
  const rel = nodePath.relative(root, abs);
  if (rel.startsWith('..') || nodePath.isAbsolute(rel)) {
    return { verifiable: true, ok: false, reason: 'path escapes the workspace', path: claimed };
  }
  try {
    const st = nodeFs.statSync(abs);
    if (st.isFile() && st.size > 0) return { verifiable: true, ok: true, path: claimed, abs, size: st.size };
  } catch { /* missing */ }
  return { verifiable: true, ok: false, reason: 'file missing or empty after run', path: claimed };
}

/* VERIFICATION CONTRACTS (Del 4A): claims are typed, evidence has provenance,
   and every verdict string names what was actually checked. Never trust the
   worker's prose — recompute. */
export function buildContracts(input) {
  const t = String(input || '');
  const contracts = [];
  const file = findClaimedArtifact(t);
  if (file) contracts.push({ type: 'file_exists', path: file });
  const cont = /contain(?:ing|s)?\s+(?:the\s+(?:exact\s+)?(?:word|text|string|phrase|line)\s+)?["']([^"']{1,80})["']/i.exec(t);
  if (file && cont) contracts.push({ type: 'file_contains', path: file, needle: cont[1] });
  const cnt = /(?:report\s+the\s+number\s+of|count|how\s+many|antal)\s+([a-z]+)?\s*files?\s+in\s+([^(\s,.)]+\/?)/i.exec(t);
  if (cnt) contracts.push({ type: 'count', dir: cnt[2], unit: cnt[1] || null });
  return contracts;
}

function countFiles(dir) {
  try {
    return nodeFs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).length;
  } catch { return null; }
}

/** verify ONE contract against real evidence; never against worker claims */
export function verifyContract(c, { cfg, partText = '' } = {}) {
  const ws = missionWorkspace(cfg);
  if (c.type === 'file_exists') {
    const abs = nodePath.resolve(ws, c.path);
    const rel = nodePath.relative(ws, abs);
    if (rel.startsWith('..') || nodePath.isAbsolute(rel)) return { ...c, ok: false, evidence: 'path escapes the workspace' };
    try {
      const st = nodeFs.statSync(abs);
      if (st.isFile() && st.size > 0) return { ...c, ok: true, evidence: `${c.path} (${st.size} bytes, sha:${shaOf(abs)})` };
    } catch { /* fall through */ }
    return { ...c, ok: false, evidence: 'missing or empty after run' };
  }
  if (c.type === 'file_contains') {
    const abs = nodePath.resolve(ws, c.path);
    try {
      const text = nodeFs.readFileSync(abs, 'utf8');
      return text.includes(c.needle)
        ? { ...c, ok: true, evidence: `${c.path} contains "${c.needle}"` }
        : { ...c, ok: false, evidence: `${c.path} does NOT contain "${c.needle}"` };
    } catch {
      return { ...c, ok: false, evidence: `${c.path} unreadable` };
    }
  }
  if (c.type === 'count') {
    const abs = nodePath.resolve(ws, c.dir);
    const actual = countFiles(abs);
    const m = /(\d+)\s*files?/i.exec(partText);
    const claimed = m ? parseInt(m[1], 10) : null;
    if (actual === null) return { ...c, ok: false, evidence: `directory ${c.dir} unreadable` };
    if (claimed === null) return { ...c, ok: false, evidence: `worker gave no "N files" number (actual ${actual})` };
    return claimed === actual
      ? { ...c, ok: true, evidence: `${c.dir} has ${actual} files (independently counted)` }
      : { ...c, ok: false, evidence: `${c.dir} has ${actual} files — worker claimed ${claimed}` };
  }
  return { ...c, ok: false, evidence: `unknown contract type ${c.type}` };
}

function shaOf(abs) {
  try {
    const crypto = nodeCrypto;
    return crypto.createHash('sha256').update(nodeFs.readFileSync(abs)).digest('hex').slice(0, 8);
  } catch { return 'n/a'; }
}
import nodeCrypto from 'node:crypto';

const COMPILE_SYS = `You extract a SMALL parallel task graph from a goal. Reply with ONLY the JSON, no prose, no fences.
Schema: {"nodes":[{"id":"snake_case","input":"<self-contained worker instruction>","deps":[],"estMs":30000}]}
Rules: 2-6 nodes. deps = ids that must finish first; [] when independent. estMs: honest wall estimate in ms (20000-60000 typical model-work). Every input must be self-contained - a worker sees ONLY its own input. Never include secrets or file paths you were not given.`;

// Deterministisk grafreserv: list-items blir oberoende noder. Beslutet foljer
// forfarande EXAKT kod - modell bara nar den kan. Modell misslyckas != mission dør.
function heuristicNodes(input, maxNodes) {
  const lines = String(input || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const items = [];
  for (const l of lines) {
    const m = /^(?:\d{1,2}[.):\-]|[-*•])\s*(.+)$/.exec(l);
    if (m && m[1].length > 4) items.push(m[1].trim());
  }
  if (items.length >= 2 && items.length <= maxNodes) {
    return items.map((input, i) => ({ id: 'item' + (i + 1), input, deps: [], estMs: 30000 }));
  }
  /* radbruden saknas men missionen trig gades av inline-lista — dela upp den ocksa */
  const inline = splitInlineItems(lines.join(' '));
  if (inline && inline.length >= 2 && inline.length <= maxNodes) {
    return inline.map((input, i) => ({ id: 'item' + (i + 1), input, deps: [], estMs: 30000 }));
  }
  return null;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fence ? fence[1] : raw;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

function validateCompiled(nodes, maxNodes) {
  if (!Array.isArray(nodes) || nodes.length < 2) return 'fewer than 2 nodes';
  if (nodes.length > maxNodes) return `too many nodes (${nodes.length} > ${maxNodes})`;
  const out = [];
  for (const [i, n] of nodes.entries()) {
    const id = String(n?.id || `n${i + 1}`).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const input = String(n?.input || '').trim().slice(0, 2000);
    if (!input) return `node ${id}: empty input`;
    const deps = Array.isArray(n?.deps) ? n.deps.map((d) => String(d)) : [];
    const estMs = Number.isFinite(n?.estMs) && n.estMs > 0 ? Math.min(600000, n.estMs) : 30000;
    out.push({ id, input, deps, estMs });
  }
  try { validateGraph(out); } catch (err) { return `invalid graph: ${err.message}`; }
  return out;
}

export async function compileMission(input, { cfg, maxNodes = 6, modelCall = null } = {}) {
  const gate = shouldMission(input);
  if (!gate.mission) return { kind: 'single', reason: gate.reason };
  if (!cfg) return { kind: 'single', reason: 'no cfg' };
  const route = routeFor(cfg, 'tasks');
  if (!route) return { kind: 'single', reason: 'no route for the compiler call' };

  const callModel = modelCall || (async () => {
    const res = await complete({
      route,
      job: 'mission',
      mockKey: 'mission:compile',
      messages: [
        { role: 'system', content: COMPILE_SYS },
        { role: 'user', content: `GOAL:\n${String(input).slice(0, 3000)}\n\nExtract the graph now.` },
      ],
      maxTokens: 900,
      temperature: 0,
      retries: 1,
    });
    return res.text || '';
  });

  let text = '';
  try { text = await callModel(); } catch (err) {
    return { kind: 'single', reason: `compiler call failed: ${String(err.message || err).slice(0, 120)}` };
  }
  const parsed = extractJson(text);
  const rawNodes = parsed && Array.isArray(parsed.nodes) ? parsed.nodes : heuristicNodes(input, maxNodes);
  if (!rawNodes) return { kind: 'single', reason: 'compiler returned no JSON graph (parse failed) and no deterministic list graph could be extracted' };
  const nodes = validateCompiled(rawNodes, maxNodes);
  if (typeof nodes === 'string') return { kind: 'single', reason: `invalid graph (${nodes})` };
  const origin = parsed && Array.isArray(parsed.nodes) ? 'model' : 'heuristic-fallback';
  return { kind: 'mission', nodes, gate, origin };
}

/**
 * Kor en kor en kompilerad mission: analyzer i KOD bestammer antalet workers;
 * inget annat tillats fatta beslutet. Blocked/fail rapporteras aarligt.
 */
function verifyContractLegacy(c, { cfg, part }) {
  return verifyContract(c, { cfg, partText: String(part?.value?.text || '') });
}
function contractFailureNames(results) {
  return results.filter((r) => !r.ok).map((r) => `${r.type}(${r.path || r.dir || '?'}): ${r.evidence}`);
}
function contractVerdict(contracts, results) {
  if (!results.length) return { ok: true, summary: 'no contracts' };
  const fail = results.filter((r) => !r.ok);
  if (fail.length) return { ok: false, reason: `${fail.length}/${results.length} contracts failed`, summary: results.map((r) => r.evidence).join('; ') };
  return { ok: true, summary: results.map((r) => r.evidence).join('; ') };
}

/** Del 4C: the hard caps a mission runs under. One policy object, read from
   config, enforced in CODE (never by asking the model to restrain itself).
   0 means OFF for time/token caps; repair rounds default to 1. */
export function missionLimits(cfg) {
  const num = (v, dflt, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  return {
    repairRounds: num(cfg?.get?.('mission.limits.repairRounds'), 1, 0, 3),
    transientRetries: num(cfg?.get?.('mission.limits.transientRetries'), 1, 0, 3),
    timeoutMs: num(cfg?.get?.('mission.limits.timeoutMs'), 0, 0, 3600000),
    tokenBudget: num(cfg?.get?.('mission.limits.tokenBudget'), 0, 0, 1000000000),
  };
}

export async function runMission({ cfg, registry, session, input, emit = () => {}, memory = null, maxNodes = 6, modelCall = null, capOverride = 0 }) {
  const compiled = await compileMission(input, { cfg, maxNodes, modelCall });
  if (compiled.kind !== 'mission') return { kind: 'single', compiled };
  const analysis = analyzeSwarm(compiled.nodes, { overheadMs: Number(cfg.get('agent.swarm.workerOverheadMs')) || 1500 });
  const worker = subagentWorker({ cfg, registry, sessionPrefix: `${(session || 'sw')}:mission`, emit, memory });

  /* Del 4C: hard limits, enforced in code. budgetHit/timeoutHit are set by the
     wrappers below, never by the model. */
  const limits = missionLimits(cfg);
  const controller = new AbortController();
  const limitsHit = new Set();
  let usedTokens = 0;
  let budgetHit = false;
  let timeoutHit = false;
  const usageOf = (v) => {
    const u = v?.usage;
    return (Number(u?.input) || 0) + (Number(u?.output) || 0);
  };
  const chargeBudget = (v) => {
    usedTokens += usageOf(v);
    if (limits.tokenBudget > 0 && usedTokens > limits.tokenBudget && !budgetHit) {
      budgetHit = true;
      limitsHit.add('budget');
      emit({ type: 'mission_limit', limit: 'budget', usedTokens, cap: limits.tokenBudget });
      controller.abort();
      return true;
    }
    return false;
  };
  const budgetedWorker = async (node, ctx) => {
    if (budgetHit) throw new Error('LIMIT:BUDGET — token cap already spent');
    const v = await worker(node, ctx);
    chargeBudget(v);
    return v;
  };
  let timeoutTimer = null;
  if (limits.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timeoutHit = true;
      limitsHit.add('timeout');
      emit({ type: 'mission_limit', limit: 'timeout', timeoutMs: limits.timeoutMs });
      controller.abort();
    }, limits.timeoutMs);
    timeoutTimer.unref?.();
  }

  const r = await runSwarm({
    nodes: compiled.nodes.map((n) => ({ id: n.id, deps: n.deps, estMs: n.estMs, input: n.input, run: budgetedWorker })),
    cap: capOverride > 0 ? capOverride : analysis.workers,
    timeoutMs: limits.timeoutMs,
    signal: controller.signal,
    maxAttempts: 1 + limits.transientRetries,
    onEvent: (e) => emit({ ...e, mission: true }),
  });
  const parts = [...r.results.values()];
  if (limits.timeoutMs > 0) {
    for (const p of parts) if (p && p.blocked && p.reason === 'deadline') { timeoutHit = true; limitsHit.add('timeout'); break; }
  }

  /* VERIFY→REPAIR (max 1 per del, maskin i koden): pAsstaadda artefakter mAste
     kunna pekas ut i workspace efter kastning, annars aer delen ärligt misslyckad. */
  let verifiedCount = 0;
  let repairedCount = 0;
  for (let i = 0; i < compiled.nodes.length; i++) {
    const n = compiled.nodes[i];
    const p = parts[i];
    if (!p || p.ok !== true) continue;
    /* Del 4A: typed contracts for every claim in the node input; every failing
       contract names its own evidence. */
    const contracts = buildContracts(n.input);
    if (!contracts.length) continue;
    let results = contracts.map((c) => verifyContractLegacy(c, { cfg, part: p }));
    let vr = contractVerdict(contracts, results);
    if (vr.ok) { p.verified = vr; verifiedCount += 1; continue; }
    emit({ type: 'mission_verify_fail', id: n.id, reason: contractFailureNames(results).join('; ') });
    /* Del 4C: bounded repair. Each round is charged to the same budget, the
       loop honors the mission timeout, and after repairRounds the part fails
       HONESTLY with a LIMIT marker — never an endless retry. */
    try {
      let roundsUsed = 0;
      while (roundsUsed < limits.repairRounds && !vr.ok) {
        if (budgetHit) { limitsHit.add('budget'); p.limit = 'budget'; break; }
        if (timeoutHit) { p.limit = 'timeout'; break; }
        roundsUsed += 1;
        const why = contractFailureNames(results).join('; ');
        const repairInput = `${n.input}\\n\\n[VERIFICATION FAILED on contracts: ${why}. Do it FOR REAL now: for every failing contract, produce the real evidence (fs.write the file again with the EXACT required content; report NO number or fact you cannot prove). Do not claim success before the evidence exists on disk or in your answer.]`;
        const value = await worker({ ...n, input: repairInput }, { signal: null });
        p.value = value;
        chargeBudget(value);
        results = contracts.map((c) => verifyContractLegacy(c, { cfg, part: p }));
        vr = contractVerdict(contracts, results);
      }
      if (vr.ok) {
        p.verified = vr;
        p.repaired = true;
        p.repairRounds = roundsUsed;
        repairedCount += 1;
        verifiedCount += 1;
        emit({ type: 'mission_repaired', id: n.id, contracts: contracts.length, rounds: roundsUsed });
      } else if (p.limit === 'budget' || p.limit === 'timeout') {
        p.ok = false;
        limitsHit.add(p.limit);
        p.error = `verification halted by [LIMIT:${p.limit.toUpperCase()}] with dead contracts: ${contractFailureNames(results).join('; ')}`;
        r.failCount += 1;
        r.okCount -= 1;
        emit({ type: 'mission_verify_failed', id: n.id, reason: p.error });
      } else {
        p.ok = false;
        limitsHit.add('retry');
        p.error = `verification failed on contracts after ${roundsUsed} repair round(s) [LIMIT:RETRY]: ${contractFailureNames(results).join('; ')}`;
        r.failCount += 1;
        r.okCount -= 1;
        emit({ type: 'mission_verify_failed', id: n.id, reason: p.error });
      }
    } catch (err) {
      p.ok = false;
      p.error = `verification/repair error: ${String(err && err.message || err).slice(0, 220)}`;
      r.failCount += 1;
      r.okCount -= 1;
    }
  }

  if (timeoutTimer) clearTimeout(timeoutTimer);
  return {
    kind: 'mission',
    compiled,
    analysis,
    result: r,
    okCount: r.okCount,
    failCount: r.failCount,
    blockedCount: r.blockedCount,
    verifiedCount,
    repairedCount,
    limits,
    limitsHit: [...limitsHit],
    usedTokens,
    workers: analysis.workers,
    nodes: compiled.nodes.length,
    textSummary: parts.map((p, i) => {
      const n = compiled.nodes[i];
      if (p && p.ok === true && p.verified) return `✓ ${n.id}: ${String(p.value?.text || '').slice(0, 220)} [VERIFIED: ${p.verified.summary}${p.repaired ? ', after repair' : ''}]`;
      if (p && p.ok === true) return `✓ ${n.id}: ${String(p.value?.text || '').slice(0, 220)} [reported, not independently verifiable]`;
      if (p && p.ok === false) return `✗ ${n.id}: ${p.error}`;
      if (p && p.blocked) {
        const limitTag = p.reason === 'deadline' ? ' [LIMIT:TIMEOUT]' : (p.reason === 'cancelled' && budgetHit ? ' [LIMIT:BUDGET]' : (p.reason === 'cancelled' && timeoutHit ? ' [LIMIT:TIMEOUT]' : ''));
        return `↷ ${n.id}: blocked — ${p.reason}${limitTag}`;
      }
      return `? ${n.id}: unknown`;
    }),
  };
}
