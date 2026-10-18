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
export async function runMission({ cfg, registry, session, input, emit = () => {}, memory = null, maxNodes = 6, modelCall = null, capOverride = 0 }) {
  const compiled = await compileMission(input, { cfg, maxNodes, modelCall });
  if (compiled.kind !== 'mission') return { kind: 'single', compiled };
  const analysis = analyzeSwarm(compiled.nodes, { overheadMs: Number(cfg.get('agent.swarm.workerOverheadMs')) || 1500 });
  const worker = subagentWorker({ cfg, registry, sessionPrefix: `${(session || 'sw')}:mission`, emit, memory });
  const r = await runSwarm({
    nodes: compiled.nodes.map((n) => ({ id: n.id, deps: n.deps, estMs: n.estMs, input: n.input, run: worker })),
    cap: capOverride > 0 ? capOverride : analysis.workers,
    signal: null,
    onEvent: (e) => emit({ ...e, mission: true }),
  });
  const parts = [...r.results.values()];
  return {
    kind: 'mission',
    compiled,
    analysis,
    result: r,
    okCount: r.okCount,
    failCount: r.failCount,
    blockedCount: r.blockedCount,
    workers: analysis.workers,
    nodes: compiled.nodes.length,
    textSummary: parts.map((p, i) => {
      const n = compiled.nodes[i];
      if (p && p.ok === true) return `✓ ${n.id}: ${String(p.value?.text || '').slice(0, 220)}`;
      if (p && p.ok === false) return `✗ ${n.id}: ${p.error}`;
      if (p && p.blocked) return `↷ ${n.id}: blocked — ${p.reason}`;
      return `? ${n.id}: unknown`;
    }),
  };
}
