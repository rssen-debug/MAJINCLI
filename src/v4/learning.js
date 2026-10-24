/**
 * MAJIN V4 — learned operational skills.
 *
 * The owner's rule: teach MAJIN by giving it goals, never by writing a new
 * master prompt. That only works if a verified execution can become a durable,
 * reusable procedure — and if an unverified one can never pretend to be one.
 *
 * This module is that engine. It deliberately does NOT introduce a second agent,
 * a second memory or a second skill format:
 *
 *   execution      the existing V4 turn (tool trace) + V2 goal receipts
 *   verification   the existing V2 verifiers, via the goal's verified receipts
 *   storage        the existing skills directory (skill.json + SKILL.md),
 *                  extended with a `learned` block, so `discoverSkills`,
 *                  `usableSkills` and the phone's skill list keep working
 *   retrieval      the existing prompt section, ordered by relevance to the goal
 *
 * Lifecycle, and why each state exists:
 *
 *   EXPERIMENTAL   one verified success. Narrow. Offered as "this worked once".
 *   VERIFIED       a second, independent verified success for the same task
 *                  type, in the same environment.
 *   REUSABLE       three or more distinct verified scenarios, no failure since
 *                  the last promotion.
 *   STALE          the environment changed (platform, lane set, tool set) since
 *                  the last validation. Still readable, never trusted blindly.
 *   FAILED         failures outnumber successes since the last validation. The
 *                  procedure is kept as evidence, not as advice.
 *
 * Hard rules enforced here, not documented:
 *   - a skill is only created from a goal that reached COMPLETED *and* carries
 *     at least one verified receipt — a model's own claim is not evidence;
 *   - argument VALUES are never stored, only which tools were used with which
 *     argument names, so credentials, personal data and brittle selectors cannot
 *     become universal instructions;
 *   - a learned skill's `requires` is the intersection of the lanes that were
 *     granted and the lanes the successful path actually used. Learning can
 *     therefore never widen permission;
 *   - a failed strategy that a later step replaced is recorded as an `avoid`
 *     entry, so the next attempt does not start over with the same idea.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LEARNING_SCHEMA = 'majin.v4.learned-skill/v1';
export const SKILL_SCHEMA = 'majin.v4.skill/v1';

export const SKILL_STATES = Object.freeze({
  EXPERIMENTAL: 'EXPERIMENTAL',
  VERIFIED: 'VERIFIED',
  REUSABLE: 'REUSABLE',
  STALE: 'STALE',
  FAILED: 'FAILED',
});

const STATE_ORDER = [SKILL_STATES.EXPERIMENTAL, SKILL_STATES.VERIFIED, SKILL_STATES.REUSABLE];

export const LEARNING_LIMITS = Object.freeze({
  /** successes needed for VERIFIED, and for REUSABLE */
  verifiedAfter: 2,
  reusableAfter: 3,
  /** distinct scenario signatures needed before REUSABLE is fair */
  reusableScenarios: 2,
  /** a procedure is demoted to FAILED once failures lead by this margin */
  failedMargin: 2,
  maxProcedureSteps: 12,
  maxAvoid: 8,
  maxEvidence: 8,
  maxBodyChars: 3500,
});

/** Failure classes that a retry may legitimately clear; they never become `avoid`. */
// Truly transient: the same action may legitimately work on a retry. A
// DEPENDENCY_MISSING or a "that file is not there" class is NOT transient — it
// means the idea itself was wrong, which is exactly what must be remembered.
const TRANSIENT = /TIMEOUT|NETWORK_FAILURE|MODEL_RATE_LIMIT|MODEL_FAILURE|MODEL_CONTEXT_LIMIT/;

const KEEP_SHORT = new Set(['cv', 'ai', 'db', 'ui', 'os']);

// Language *input* vocabulary, never rendered as product copy. Each line that
// contains a non-English word carries the marker the i18n gate looks for.
const STOPWORDS = new Set([
  ...'a an and are as at be but by for from has have i in into is it its me my of on or that the this to with you your please could would'.split(' '), // input vocabulary, never rendered
  ...'jag och att det som den med for till kan ska vill har min mitt mina pa är en ett om'.split(' '), // input vocabulary, never rendered
  ...'igenom gärna snälla sedan också alla hela några någon'.split(' '), // input vocabulary, never rendered
]);

/* ------------------------------------------------------------- sanitising -- */

/** Patterns that must never reach a stored instruction. */
const SECRET_PATTERNS = [
  /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{8,}\b/g,            // provider style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,                 // github tokens
  /\boc_sk_[A-Za-z0-9_-]{10,}\b/g,                   // opencode keys
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\b[A-Za-z0-9+/=_-]{40,}\b/g,                      // long opaque blobs
  /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g,                 // e-mail addresses
  /\b(?:\+?\d[\s-]?){7,15}\b/g,                      // phone-like digit runs
];

const PERSONAL_PATHS = [
  /[A-Za-z]:\\Users\\[^\\\s]+\\[^\s]*/g,
  /\/Users\/[^/\s]+\/[^\s]*/g,
  /\/home\/[^/\s]+\/[^\s]*/g,
];

/** CSS/framework selectors are exactly the kind of brittle detail we refuse. */
const SELECTOR_PATTERNS = [
  /#[\w-]+(?:\s*[>+~]?\s*\.[\w-]+)+/g,
  /(?:\.[\w-]+){2,}\s*>\s*[^\s,;]+/g,
  /:nth-(?:child|of-type)\([^)]*\)/g,
  /\b(?:div|span|section|article|form|input|button|a)(?:\.[\w-]+|#[\w-]+)+(?:\s*>\s*[^\s,;]+)*/g,
];

/**
 * Strip anything that must not become a universal instruction.
 *
 * Returns the sanitised text plus what was removed, so the caller can record
 * *that* redaction happened without recording the secret itself.
 */
export function sanitizeInstruction(text, { maxChars = 600 } = {}) {
  let out = String(text ?? '');
  const redactions = [];
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p, () => {
      redactions.push('secret');
      return '[redacted]';
    });
  }
  for (const p of PERSONAL_PATHS) {
    out = out.replace(p, () => {
      redactions.push('personal-path');
      return '[path]';
    });
  }
  for (const p of SELECTOR_PATTERNS) {
    out = out.replace(p, () => {
      redactions.push('selector');
      return '[element by role/label]';
    });
  }
  out = out.replace(/\s+/g, ' ').trim().slice(0, maxChars);
  return { text: out, redactions: [...new Set(redactions)] };
}

/* --------------------------------------------------------- goal signature -- */

/** Significant words of a goal: lowercased, stopwords and numbers removed. */
export function goalKeywords(goalText) {
  return String(goalText || '')
    .toLowerCase()
    .replace(/[_./\\-]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(/\s+/)
    // Two-letter tokens are noise in Swedish, but a few of them carry the whole
    // meaning of a goal ("cv"), so they are kept explicitly.
    .filter((w) => (w.length >= 3 || KEEP_SHORT.has(w)) && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

const shortHash = (value, len = 10) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, len);

/**
 * A stable signature for "this kind of task".
 *
 * Two runs of the same kind of request must land on the same signature or a
 * procedure could never be confirmed twice. The signature deliberately uses the
 * tool sequence plus the goal's topic words, not the exact wording.
 */
export function taskSignature({ goalText, tools = [] }) {
  // Identity of the PROCEDURE: the tool path. Two differently worded requests
  // that need the same steps are the same procedure, which is what makes a
  // second verified success meaningful.
  const seq = tools.filter(Boolean).join('>');
  void goalText;
  return shortHash(`procedure|${seq}`, 12);
}

/**
 * Identity of a SCENARIO: the topic of the goal. Several distinct scenarios
 * behind one procedure are what justify REUSABLE, one is only EXPERIMENTAL.
 */
export function scenarioSignature(goalText) {
  const words = [...new Set(goalKeywords(goalText))].sort().slice(0, 12);
  return shortHash(words.join(','), 12);
}

/** Environment identity: a skill validated elsewhere is STALE, not trusted. */
export function environmentFingerprint({ platform = process.platform, arch = process.arch, node = process.versions.node, lanes = [], tools = [] } = {}) {
  const major = String(node).split('.')[0];
  return shortHash(JSON.stringify({
    platform,
    arch,
    node: major,
    lanes: [...lanes].sort(),
    tools: [...tools].sort(),
  }), 12);
}

/* ------------------------------------------------------------- diagnosing -- */

/**
 * Read a turn's tool trace the way an operator would: what failed, what was
 * repeated, and what finally worked.
 */
export function diagnoseTrace(trace = []) {
  const failures = [];
  const repeats = [];
  const seen = new Map();
  let successIndex = -1;
  trace.forEach((step, i) => {
    const signature = `${step.name}|${step.argsShape || ''}`;
    if (seen.has(signature)) repeats.push({ signature, name: step.name, first: seen.get(signature), at: i });
    else seen.set(signature, i);
    if (!step.ok) failures.push({ index: i, name: step.name, cls: step.cls || 'UNKNOWN', argsShape: step.argsShape || '' });
    else if (successIndex < 0) successIndex = i;
  });
  // A failure that happened before the successful path and was replaced by a
  // different action is a strategy that did not work here.
  const replaced = failures.filter((f) => !TRANSIENT.test(f.cls));
  const changed = new Set(trace.filter((s) => s.ok).map((s) => s.name));
  /**
   * A failure is an abandoned STRATEGY only when that action never worked later
   * in the same run and the work moved to a different tool.
   *
   * The first version OR-ed a "more than one tool succeeded" clause into this,
   * which made every failure look abandoned. A real Go run exposed the damage:
   * `fs_read` failed once with a wrong path, then succeeded with the right one,
   * and the learned skill still told the next turn "do not repeat fs_read" —
   * actively discouraging the correct step. A tool that proves itself later in
   * the same run is not a dead end.
   */
  const abandoned = replaced.filter((f) => {
    const laterSameToolSucceeded = trace.slice(f.index + 1).some((s) => s.ok && s.name === f.name);
    return !laterSameToolSucceeded && changed.size > 1;
  });
  return {
    failures,
    repeats,
    replaced,
    abandoned,
    transientFailures: failures.filter((f) => TRANSIENT.test(f.cls)),
    anySuccess: successIndex >= 0,
    successIndex,
  };
}

/* ----------------------------------------------------------- the extractor -- */

function nameFor({ category, signature }) {
  const safe = String(category || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'task';
  return `learn-${safe}-${shortHash(signature, 6)}`.slice(0, 41);
}

/** Which lane does a tool belong to, using the registry definition. */
function laneOf(registry, toolName) {
  const def = registry?.get?.(toolName);
  return def?.lane || null;
}

/**
 * Turn a verified turn into a candidate skill, or return the reason it cannot.
 *
 * This is the single place that decides "is this an achieved skill". It refuses
 * anything that is not independently verified, and it never stores values.
 */
export function extractCandidate({
  goal,
  trace = [],
  registry = null,
  grantedLanes = [],
  fingerprint = null,
  now = () => new Date().toISOString(),
  limits = LEARNING_LIMITS,
  // V2's ToolDefinition.parse strips unknown keys, so `lane` does not survive on
  // a registered definition. The caller supplies the real lane map, which is the
  // only way `requires` can be honest.
  laneFor = null,
} = {}) {
  if (!goal) return { ok: false, reason: 'no goal' };
  if (goal.state !== 'COMPLETED') return { ok: false, reason: `goal is ${goal.state}, not COMPLETED` };

  // Independent verification: a receipt that was re-checked by a V2 verifier.
  const verified = (goal.receipts || []).filter((r) => r.verified && r.result === 'success');
  if (!verified.length) {
    return { ok: false, reason: 'no independently verified receipt — a model claim is not evidence' };
  }

  const successful = trace.filter((s) => s.ok && s.name && s.name !== 'skill_note' && s.name !== 'learning_reflect');
  if (!successful.length) return { ok: false, reason: 'the turn used no tool, so there is no procedure to learn' };

  const diagnosis = diagnoseTrace(trace);
  const tools = [...new Set(successful.map((s) => s.name))];
  const signature = taskSignature({ goalText: goal.objective, tools });
  const resolveLane = typeof laneFor === 'function' ? laneFor : (name) => laneOf(registry, name);
  const lanes = [...new Set(tools.map((t) => resolveLane(t)).filter(Boolean))];
  // Permission can only narrow: a learned skill requires what was granted AND used.
  const granted = new Set(grantedLanes);
  const requires = lanes.filter((lane) => granted.has(lane) || lane === 'workspace');

  const category = lanes[0] || 'workspace';
  const name = nameFor({ category, signature });

  // The procedure is described as tool + argument NAMES. Values never enter it.
  const procedure = [];
  const seenStep = new Set();
  for (const step of successful.slice(0, limits.maxProcedureSteps)) {
    const key = `${step.name}(${step.argsShape || ''})`;
    if (seenStep.has(key)) continue;
    seenStep.add(key);
    procedure.push(`Call ${step.name}${step.argsShape ? ` with ${step.argsShape}` : ''}.`);
  }

  const avoid = diagnosis.abandoned.slice(0, limits.maxAvoid).map((f) => ({
    action: `${f.name}${f.argsShape ? `(${f.argsShape})` : ''}`,
    failedWith: f.cls,
    why: 'This action failed before the working path and was replaced. Choose the recorded path instead of repeating it.',
  }));

  const failurePatterns = diagnosis.failures.slice(0, limits.maxAvoid).map((f) => ({
    symptom: `${f.name} returned ${f.cls}`,
    recovery: TRANSIENT.test(f.cls)
      ? 'Transient class: one bounded retry is legitimate.'
      : 'Choose a different action; this one failed in a verified run.',
  }));

  // Evidence is provenance, not a place to keep personal data: the file name a
  // receipt pointed at is sanitised, the hash and the verifier stay.
  const evidence = verified.slice(0, limits.maxEvidence).map((r) => ({
    receiptId: r.id,
    action: r.action,
    // The receipt id and the hash are the proof. The file name a receipt pointed
    // at is personal data, so only its kind survives.
    targetKind: r.target && typeof r.target === 'string'
      ? (r.target.includes('.') ? `file${r.target.slice(r.target.lastIndexOf('.'))}`.slice(0, 12) : 'record')
      : null,
    evidence: r.evidence
      ? {
        verifier: r.evidence.verifier || null,
        kind: r.evidence.kind || null,
        bytes: r.evidence.bytes ?? null,
        sha256: r.evidence.sha256 || null,
      }
      : null,
  }));

  const verificationMethod = describeVerification(verified);
  const title = sanitizeInstruction(String(goal.objective || '').slice(0, 70)).text || 'Learned procedure';

  const candidate = {
      schema: SKILL_SCHEMA,
      name,
      title,
      summary: sanitizeInstruction(String(goal.objective || '').slice(0, 160)).text,
      requires,
      tools,
      prefers: [],
      experimental: true,
      learned: {
        schema: LEARNING_SCHEMA,
        state: SKILL_STATES.EXPERIMENTAL,
        category,
        categories: [...new Set([category, 'learned'])],
        signature,
        keywords: [...new Set(goalKeywords(goal.objective))].slice(0, 12),
        preconditions: [
          `The tools ${tools.join(', ')} are available and permitted.`,
          ...(requires.length ? [`The lane(s) ${requires.join(', ')} are granted.`] : []),
        ],
        procedure,
        example: {
          goal: sanitizeInstruction(goal.objective).text,
          steps: successful.slice(0, limits.maxProcedureSteps).map((s) => ({
            tool: s.name,
            args: s.argsShape || null,
            ok: true,
          })),
        },
        failurePatterns,
        avoid,
        verification: { method: verificationMethod, evidence },
        environment: { fingerprint, platform: process.platform, tools },
        evidence,
        confidence: 0,
        successes: 1,
        failures: 0,
        scenarios: [scenarioSignature(goal.objective)],
        lastValidatedAt: now(),
        createdAt: now(),
        limits: { maxToolCalls: Math.max(4, successful.length), maxAttempts: 2 },
        source: 'verified-goal',
      },
      body: renderBody({ title, procedure, avoid, failurePatterns, verificationMethod }),
    };
  // Slots, per-step failure counts and an integrity hash are what make the
  // procedure reusable and auditable rather than a transcript of one run.
  candidate.learned.slots = induceSlots(candidate.learned.example.steps);
  candidate.learned.stepFailures = {};
  candidate.learned.revisions = [];
  candidate.learned.integrity = skillIntegrity(candidate);
  return { ok: true, candidate };
}

function describeVerification(verified) {
  const kinds = [...new Set(verified.map((r) => r.evidence?.verifier || r.evidence?.kind || 'receipt').filter(Boolean))];
  return `Independent check by the V2 verifier (${kinds.join(', ') || 'receipt'}) on ${verified.length} receipt(s).`;
}

function renderBody({ title, procedure, avoid, failurePatterns, verificationMethod }) {
  const lines = [
    `# ${title}`,
    '',
    'Learned from a verified execution. Follow it when the request matches; adapt it when the environment differs.',
    '',
    '## Procedure',
    ...procedure.map((step, i) => `${i + 1}. ${step}`),
    '',
    '## Verification',
    verificationMethod,
  ];
  if (avoid.length) {
    lines.push('', '## Do not repeat');
    for (const item of avoid) lines.push(`- ${item.action} → ${item.failedWith}. ${item.why}`);
  }
  if (failurePatterns.length) {
    lines.push('', '## If something fails');
    for (const p of failurePatterns) lines.push(`- ${p.symptom}: ${p.recovery}`);
  }
  return lines.join('\n').slice(0, LEARNING_LIMITS.maxBodyChars);
}

/* ------------------------------------------------- parameter slots (AWM) -- */

/**
 * AWM (zorazrw/agent-workflow-memory, Apache-2.0, ICML 2025) induces reusable
 * workflows with *variable slots* rather than a fixed narration of one run. That
 * is the difference between "call fs_find with path,name" and a template a later,
 * different task can fill in.
 *
 * A slot is a named hole with the tool and argument it feeds. The procedure keeps
 * only structure; values are bound per use, so nothing personal is ever stored
 * and one procedure serves many files, folders and pages.
 */
export function induceSlots(exampleSteps = [], { maxSlots = 8 } = {}) {
  const slots = [];
  const seen = new Set();
  for (const step of exampleSteps) {
    for (const arg of String(step.args || '').split(',').map((a) => a.trim()).filter(Boolean)) {
      const key = `${step.tool}.${arg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (slots.length >= maxSlots) break;
      slots.push({ name: `$${arg}${slots.length + 1}`, tool: step.tool, argument: arg, bind: 'from-goal' });
    }
  }
  return slots;
}

/** Render a slot-aware procedure: structure plus what must be supplied. */
export function renderProcedure(procedure = [], slots = []) {
  if (!slots.length) return procedure;
  return procedure.map((step) => {
    const relevant = slots.filter((slot) => step.includes(slot.tool));
    if (!relevant.length) return step;
    return `${step.replace(/\.$/, '')} — fill ${relevant.map((s) => `${s.name} (${s.argument})`).join(', ')} from this request.`;
  });
}

/* ------------------------------------ step-level attribution (SkillAdaptor) -- */

/**
 * SkillAdaptor (zjunlp/SkillAdaptor, MIT) showed that revising a whole skill
 * from a failed session is coarse: the failure belongs to ONE step. Attributing
 * it there keeps the rest of a working procedure intact and produces an
 * auditable revision instead of silently degrading the whole skill.
 */
export function attributeFailure({ skill, trace = [], maxStepFailures = 2 }) {
  const learned = skill?.learned || {};
  const procedure = learned.procedure || [];
  const failed = trace.filter((step) => step.ok === false);
  if (!failed.length) return { attributable: false, reason: 'the turn recorded no failed step' };

  const first = failed[0];
  const stepIndex = procedure.findIndex((line) => line.includes(first.name));
  const transient = TRANSIENT.test(first.cls || '');
  const nextCount = stepIndex >= 0 ? Number((learned.stepFailures || {})[stepIndex] || 0) + 1 : 0;

  return {
    attributable: stepIndex >= 0 && !transient,
    tool: first.name,
    failureClass: first.cls || 'UNKNOWN',
    stepIndex,
    step: stepIndex >= 0 ? procedure[stepIndex] : null,
    transient,
    occurrences: nextCount,
    proposal: stepIndex < 0
      ? { kind: 'unlisted-step', detail: `${first.name} is not part of the stored procedure; the task may have changed shape.` }
      : nextCount >= maxStepFailures
        ? { kind: 'revalidate-step', detail: `step ${stepIndex + 1} (${first.name}) failed ${nextCount} time(s); revalidate it before relying on it.` }
        : { kind: 'note-step', detail: `step ${stepIndex + 1} (${first.name}) failed once with ${first.cls}.` },
  };
}

/* ------------------------------------- contrastive insight (ExpeL) --------- */

/**
 * ExpeL (LeapLabTHU/ExpeL, Apache-2.0, AAAI 2024) extracts insights by comparing
 * a successful and a failed attempt at the same kind of task rather than reading
 * one trace in isolation.
 *
 * When the same action succeeded elsewhere and failed here, the action is not
 * universally wrong — the CONTEXT differs. Recording it as a blanket "avoid"
 * would be exactly the hardcoded special case the brief warns against, so this
 * returns a contextual note instead.
 */
export function contrastiveInsight({ successTrace = [], failureTrace = [] } = {}) {
  const worked = new Set();
  for (const step of successTrace) if (step.ok && step.name) worked.add(`${step.name}(${step.argsShape || ''})`);
  const failedFirst = failureTrace.find((step) => step.ok === false && !TRANSIENT.test(step.cls || ''));
  if (!failedFirst) return null;
  const key = `${failedFirst.name}(${failedFirst.argsShape || ''})`;
  if (!worked.has(key)) return null;
  return {
    kind: 'context-dependent',
    action: key,
    failedWith: failedFirst.cls || 'UNKNOWN',
    detail: `${key} succeeded in a verified run but failed with ${failedFirst.cls} here; the difference is in the input or the environment, not the tool.`,
  };
}

/* ------------------------------------ prior experience (workflow step 1) --- */

/**
 * "Search existing verified skills AND PREVIOUS TASK EXPERIENCES."
 *
 * The agent already searched learned skills; it never looked at what happened on
 * earlier tasks of the same kind. The material is already on disk — the V2 goals
 * with their objectives, final states and receipts — so this reads it rather than
 * introducing another store.
 *
 * What it returns is deliberately narrow: the outcome, the tools that were used,
 * and what failed. No message text, no paths, no values, and the objective is
 * sanitised, because an experience note is a prompt section like any other.
 */
export function recallExperiences({ goals = [], goalText = '', limit = 3 } = {}) {
  const words = new Set(goalKeywords(goalText));
  if (!words.size) return [];

  const scored = [];
  for (const goal of goals) {
    if (!goal || typeof goal.objective !== 'string') continue;
    const objectiveWords = goalKeywords(goal.objective);
    if (!objectiveWords.length) continue;
    let overlap = 0;
    for (const w of objectiveWords) if (words.has(w)) overlap += 1;
    if (overlap < 2) continue; // one shared word is noise, not a precedent

    const receipts = Array.isArray(goal.receipts) ? goal.receipts : [];
    const toolReceipts = receipts.filter((r) => typeof r.action === 'string' && r.action.startsWith('tool:'));
    const okTools = [...new Set(toolReceipts.filter((r) => r.result === 'success').map((r) => r.action.slice(5)))];
    const failed = [...new Set(toolReceipts.filter((r) => r.result === 'failure').map((r) => `${r.action.slice(5)} (${r.errorClass || 'failed'})`))];
    const verified = receipts.filter((r) => r.verified).length;

    scored.push({
      score: overlap * 2 + (goal.state === 'COMPLETED' ? 1 : 0),
      entry: {
        objective: sanitizeInstruction(goal.objective, { maxChars: 140 }).text,
        outcome: goal.state || 'UNKNOWN',
        verified,
        worked: okTools.slice(0, 6),
        failed: failed.slice(0, 6),
        at: goal.createdAt || goal.updatedAt || null,
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map((x) => x.entry);
}

/** Render prior experience for the prompt. Never a lesson the engine did not observe. */
export function renderExperiences(entries = []) {
  if (!entries.length) return '';
  const lines = entries.map((e, i) => {
    const parts = [`${i + 1}. "${e.objective}" → ${e.outcome}${e.verified ? ` (${e.verified} verified receipt(s))` : ''}`];
    if (e.worked.length) parts.push(`   tools that worked: ${e.worked.join(', ')}`);
    if (e.failed.length) parts.push(`   what failed: ${e.failed.join(', ')}`);
    return parts.join('\n');
  });
  return [
    '## What happened last time you did something similar',
    'These are real earlier tasks, not suggestions. Reuse what worked, and do not start with what already failed for this kind of request.',
    ...lines,
  ].join('\n');
}

/* ------------------------------------------ integrity (skill-provenance) --- */

/** A tiny bundle hash so an out-of-band edit of a learned skill is visible. */
export function skillIntegrity(skill) {
  const payload = JSON.stringify({
    name: skill?.name || '',
    procedure: skill?.learned?.procedure || [],
    avoid: (skill?.learned?.avoid || []).map((a) => a.action),
    state: skill?.learned?.state || '',
    tools: skill?.tools || [],
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/* -------------------------------------------------------------- the store -- */

/**
 * Learned skills live in the same directory tree as hand-written ones, so one
 * loader (`discoverSkills`) serves both and the phone sees a single list.
 */
export class LearnedSkillStore {
  constructor({ dir, fingerprint = null, logger = null }) {
    this.dir = dir;
    this.fingerprint = fingerprint;
    this.logger = logger;
    fs.mkdirSync(dir, { recursive: true });
  }

  #file(name) {
    return path.join(this.dir, name, 'skill.json');
  }

  list() {
    const out = [];
    let entries = [];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      return out;
    }
    for (const entry of entries) {
      const file = path.join(this.dir, entry.name, 'skill.json');
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      if (!manifest?.learned || manifest.learned.schema !== LEARNING_SCHEMA) continue;
      out.push({ ...manifest, dir: path.join(this.dir, entry.name) });
    }
    return out.sort((a, b) => String(b.learned.lastValidatedAt || '').localeCompare(String(a.learned.lastValidatedAt || '')));
  }

  get(name) {
    return this.list().find((s) => s.name === name) || null;
  }

  #write(skill, body) {
    const dir = path.join(this.dir, skill.name);
    fs.mkdirSync(dir, { recursive: true });
    const tmpJson = path.join(dir, '.skill.json.tmp');
    fs.writeFileSync(tmpJson, `${JSON.stringify(skill, null, 2)}\n`);
    fs.renameSync(tmpJson, path.join(dir, 'skill.json'));
    const tmpBody = path.join(dir, '.SKILL.md.tmp');
    fs.writeFileSync(tmpBody, `${body}\n`);
    fs.renameSync(tmpBody, path.join(dir, 'SKILL.md'));
    return dir;
  }

  /**
   * Fold one finished turn into the store.
   *
   * Returns a structured outcome so the caller can emit it, log it and prove it
   * in a test — never a boolean that hides what happened.
   */
  observe({ goal, trace = [], registry = null, grantedLanes = [], laneFor = null, now = () => new Date().toISOString() } = {}) {
    const result = { action: 'none', name: null, state: null, reason: null, learning: false };

    if (goal?.state !== 'COMPLETED') {
      // A failed turn is still evidence: remember the abandoned strategies so the
      // next attempt does not start from the same idea.
      const diagnosis = diagnoseTrace(trace);
      if (diagnosis.replaced.length) {
        result.action = 'recorded-failure';
        result.reason = `${diagnosis.replaced.length} failed action(s) noted`;
        result.failures = diagnosis.replaced.map((f) => ({ action: f.name, cls: f.cls }));
      }
      return result;
    }

    const extracted = extractCandidate({ goal, trace, registry, grantedLanes, laneFor, fingerprint: this.fingerprint, now });
    if (!extracted.ok) {
      result.reason = extracted.reason;
      return result;
    }
    const candidate = extracted.candidate;

    const existing = this.get(candidate.name);
    if (!existing) {
      const skill = { ...candidate };
      skill.learned.confidence = confidenceOf(skill.learned);
      this.#write(skill, candidate.body);
      result.action = 'created';
      result.name = skill.name;
      result.state = skill.learned.state;
      result.learning = true;
      return result;
    }

    // Same task type, another verified success (or a repeat of the same one).
    const learned = existing.learned;
    learned.successes = Number(learned.successes || 0) + 1;
    learned.lastValidatedAt = now();
    const scenarios = new Set([...(learned.scenarios || []), scenarioSignature(goal.objective)]);
    learned.scenarios = [...scenarios];
    // Keep the newest verified evidence, bounded.
    learned.evidence = [...candidate.learned.evidence, ...(learned.evidence || [])].slice(0, LEARNING_LIMITS.maxEvidence);
    learned.verification = candidate.learned.verification;
    // A tool may have been added by the successful path; permission still only narrows.
    learned.procedure = mergeProcedures(learned.procedure || [], candidate.learned.procedure);
    learned.avoid = mergeAvoid(learned.avoid || [], candidate.learned.avoid);
    learned.environment = candidate.learned.environment;

    const nextState = promote(learned);
    const stateChanged = nextState !== learned.state;
    learned.state = nextState;
    learned.confidence = confidenceOf(learned);
    existing.experimental = nextState === SKILL_STATES.EXPERIMENTAL;

    const body = renderBody({
      title: existing.title,
      procedure: learned.procedure,
      avoid: learned.avoid,
      failurePatterns: learned.failurePatterns || [],
      verificationMethod: learned.verification?.method || 'Independent verification.',
    });
    this.#write(existing, body);
    result.action = 'updated';
    result.name = existing.name;
    result.state = learned.state;
    result.stateChanged = stateChanged;
    result.learning = true;
    return result;
  }

  /**
   * Learn from a FAILED turn that had retrieved one or more skills.
   *
   * This is the half that was missing: a failure only ever incremented a counter
   * (and nothing even called it). Now the failure is attributed to a specific
   * step, the rest of the procedure is left alone, and a bounded revision is
   * written down — so "the website/API/environment changed" becomes a concrete
   * statement about one step instead of the whole skill quietly rotting.
   */
  observeFailure({ skills = [], trace = [], now = () => new Date().toISOString() } = {}) {
    const out = [];
    for (const retrieved of skills) {
      const skill = this.get(retrieved.name || retrieved);
      if (!skill) continue;
      const attribution = attributeFailure({ skill, trace });
      const learned = skill.learned;
      learned.failures = Number(learned.failures || 0) + 1;
      learned.lastFailureAt = now();
      learned.lastFailureReason = sanitizeInstruction(String(attribution.failureClass || 'not verified'), { maxChars: 80 }).text;

      if (attribution.attributable) {
        learned.stepFailures = learned.stepFailures || {};
        learned.stepFailures[attribution.stepIndex] = attribution.occurrences;
        if (attribution.proposal?.kind === 'revalidate-step') {
          // A step that keeps failing makes the skill STALE: still readable, not
          // trusted. Never a silent deletion of the procedure.
          learned.state = SKILL_STATES.STALE;
          learned.staleSince = now();
        }
        learned.revisions = [...(learned.revisions || []), {
          at: now(),
          step: attribution.stepIndex + 1,
          tool: attribution.tool,
          failedWith: attribution.failureClass,
          proposal: attribution.proposal,
        }].slice(-10);
      }

      if (learned.failures - Number(learned.successes || 0) >= LEARNING_LIMITS.failedMargin) {
        learned.state = SKILL_STATES.FAILED;
      }
      learned.confidence = confidenceOf(learned);
      skill.experimental = learned.state === SKILL_STATES.EXPERIMENTAL;
      skill.integrityChanged = skill.learned.integrity !== skillIntegrity(skill);
      learned.integrity = skillIntegrity(skill);
      this.#write(skill, readBody(skill));
      out.push({
        name: skill.name,
        state: learned.state,
        attribution,
        failures: learned.failures,
      });
    }
    return out;
  }

  /** Record that a retrieved skill did not work this time. */
  penalise(name, { reason = 'not verified', now = () => new Date().toISOString() } = {}) {
    const skill = this.get(name);
    if (!skill) return { ok: false, reason: 'unknown skill' };
    const learned = skill.learned;
    learned.failures = Number(learned.failures || 0) + 1;
    learned.lastFailureAt = now();
    learned.lastFailureReason = sanitizeInstruction(reason, { maxChars: 160 }).text;
    if (learned.failures - Number(learned.successes || 0) >= LEARNING_LIMITS.failedMargin) {
      learned.state = SKILL_STATES.FAILED;
    }
    learned.confidence = confidenceOf(learned);
    skill.experimental = learned.state === SKILL_STATES.EXPERIMENTAL;
    const body = fs.existsSync(path.join(skill.dir, 'SKILL.md'))
      ? fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8')
      : '';
    this.#write(skill, body);
    return { ok: true, state: learned.state, failures: learned.failures };
  }

  /**
   * Compare the environment a skill was validated in with this one.
   * A mismatch is STALE, and STALE is never silently offered as trusted.
   */
  revalidate(now = () => new Date().toISOString()) {
    const changed = [];
    for (const skill of this.list()) {
      const stored = skill.learned.environment?.fingerprint || null;
      const current = this.fingerprint;
      if (!stored || !current) continue;
      if (stored === current) {
        if (skill.learned.state === SKILL_STATES.STALE) {
          skill.learned.state = SKILL_STATES.EXPERIMENTAL;
          skill.learned.revalidatedAt = now();
          skill.experimental = true;
          this.#write(skill, readBody(skill));
          changed.push({ name: skill.name, to: SKILL_STATES.EXPERIMENTAL });
        }
        continue;
      }
      if (skill.learned.state !== SKILL_STATES.STALE) {
        skill.learned.state = SKILL_STATES.STALE;
        skill.learned.staleSince = now();
        this.#write(skill, readBody(skill));
        changed.push({ name: skill.name, to: SKILL_STATES.STALE });
      }
    }
    return changed;
  }
}

function readBody(skill) {
  try {
    return fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8').trim();
  } catch {
    return renderBody({
      title: skill.title,
      procedure: skill.learned?.procedure || [],
      avoid: skill.learned?.avoid || [],
      failurePatterns: skill.learned?.failurePatterns || [],
      verificationMethod: skill.learned?.verification?.method || 'Independent verification.',
    });
  }
}

function mergeProcedures(a = [], b = []) {
  const out = [...a];
  for (const step of b) if (!out.includes(step)) out.push(step);
  return out.slice(0, LEARNING_LIMITS.maxProcedureSteps);
}

function mergeAvoid(a = [], b = []) {
  const out = [...a];
  for (const entry of b) {
    if (!out.some((x) => x.action === entry.action && x.failedWith === entry.failedWith)) out.push(entry);
  }
  return out.slice(0, LEARNING_LIMITS.maxAvoid);
}

export function confidenceOf(learned = {}) {
  const s = Number(learned.successes || 0);
  const f = Number(learned.failures || 0);
  if (s + f === 0) return 0;
  // Laplace-smoothed with a prior of two observations, so one success is a
  // hint (about 0.4 with one scenario) and never a certainty.
  const base = (s + 0.5) / (s + f + 2);
  const scenarios = new Set(learned.scenarios || []).size;
  const breadth = Math.min(1, 0.6 + 0.2 * scenarios);
  return Math.round(base * breadth * 100) / 100;
}

/** Promotion is a function of evidence, never of intent. */
export function promote(learned) {
  const successes = Number(learned.successes || 0);
  const failures = Number(learned.failures || 0);
  const scenarios = new Set(learned.scenarios || []).size;
  if (failures - successes >= LEARNING_LIMITS.failedMargin) return SKILL_STATES.FAILED;
  const known = STATE_ORDER.includes(learned.state) ? learned.state : SKILL_STATES.EXPERIMENTAL;
  let state = known;
  if (successes >= LEARNING_LIMITS.verifiedAfter) state = SKILL_STATES.VERIFIED;
  if (successes >= LEARNING_LIMITS.reusableAfter && scenarios >= LEARNING_LIMITS.reusableScenarios) {
    state = SKILL_STATES.REUSABLE;
  }
  // Never silently demote a REUSABLE skill to EXPERIMENTAL on a count alone.
  return STATE_ORDER.indexOf(state) < STATE_ORDER.indexOf(known) ? known : state;
}

/* ------------------------------------------------------------ retrieving -- */

/**
 * Rank skills for a goal. This is what makes a learned procedure come back for
 * a *related* task (step F of the acceptance), not only for the identical one.
 */
export function rankSkills(skills = [], { goalText = '', limit = 4 } = {}) {
  const words = new Set(goalKeywords(goalText));
  const scored = skills.map((skill) => {
    const learned = skill.learned || {};
    const own = new Set([...(learned.keywords || []), ...goalKeywords(`${skill.title} ${skill.summary}`)]);
    let overlap = 0;
    for (const w of words) if (own.has(w)) overlap += 1;
    const sameCategory = (learned.categories || []).some((c) => words.has(c)) ? 1 : 0;
    const stateScore = {
      [SKILL_STATES.REUSABLE]: 3,
      [SKILL_STATES.VERIFIED]: 2,
      [SKILL_STATES.EXPERIMENTAL]: 1,
      [SKILL_STATES.STALE]: 0.5,
      [SKILL_STATES.FAILED]: 0,
    }[learned.state] ?? 0;
    // Without a topical link the state and confidence are meaningless: an
    // unrelated skill must not be offered just because it is well tested.
    const topical = overlap * 2 + sameCategory * 2;
    if (topical === 0) return { skill, score: 0, overlap };
    const score = topical + stateScore + Number(learned.confidence || 0);
    return { skill, score, overlap };
  });
  return scored
    .filter((s) => s.score > 0 && s.skill.learned?.state !== SKILL_STATES.FAILED)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.skill);
}

/** Render learned skills for the prompt, including what not to repeat. */
export function renderLearned(ranked = []) {
  if (!ranked.length) return '';
  const blocks = ranked.map((skill) => {
    const learned = skill.learned || {};
    const stateLine = {
      [SKILL_STATES.EXPERIMENTAL]: 'STATUS: experimental — verified once. Adapt rather than trust.',
      [SKILL_STATES.VERIFIED]: 'STATUS: verified in this environment.',
      [SKILL_STATES.REUSABLE]: 'STATUS: reusable, verified across several scenarios.',
      [SKILL_STATES.STALE]: 'STATUS: STALE — validated in a different environment. Revalidate before relying on it, and say so if a step no longer applies.',
    }[learned.state] || 'STATUS: unknown.';
    const avoid = (learned.avoid || []).length
      ? `\nDo not repeat (these failed in the verified run): ${learned.avoid.map((a) => `${a.action} → ${a.failedWith}`).join('; ')}.`
      : '';
    // A procedure with slots is a template: state what must be supplied for
    // THIS request, which is what makes one skill serve many similar tasks.
    const slots = learned.slots || [];
    const slotLine = slots.length
      ? `\nFill these from the current request before calling: ${slots.map((x) => `${x.name}→${x.tool}.${x.argument}`).join(', ')}.`
      : '';
    return `#### ${skill.title} (${skill.name})\n${stateLine}${slotLine}\n${String(skill.body || '').trim().slice(0, 1200)}${avoid}`;
  });
  return [
    '## Skills learned from verified work',
    'These were extracted automatically from executions that passed independent verification. '
    + 'Use one when the request is related; adapt it when something differs, and never repeat a listed failure.',
    ...blocks,
  ].join('\n\n');
}

/** The public, serialisable view for the phone. */
export function describeLearned(skills = []) {
  return skills.map((s) => ({
    name: s.name,
    title: s.title,
    state: s.learned.state,
    category: s.learned.category || null,
    confidence: s.learned.confidence ?? 0,
    successes: s.learned.successes ?? 0,
    failures: s.learned.failures ?? 0,
    scenarios: (s.learned.scenarios || []).length,
    tools: s.tools || [],
    requires: s.requires || [],
    lastValidatedAt: s.learned.lastValidatedAt || null,
    verification: s.learned.verification?.method || null,
    avoid: (s.learned.avoid || []).map((a) => a.action),
    slots: (s.learned.slots || []).map((x) => `${x.name}→${x.tool}.${x.argument}`),
    revisions: (s.learned.revisions || []).length,
    integrity: s.learned.integrity || null,
  }));
}
