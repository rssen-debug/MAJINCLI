/**
 * MAJIN V6 — mission definition and journal.
 *
 * A mission is the owner's single instruction ("find and prepare applications
 * for X"), with an explicit budget and an explicit list of what the agent may
 * do. The journal is the durable record of every step, so a mission survives a
 * crash, a reboot or a closed laptop and can be resumed without repeating an
 * irreversible action.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DECISION_ACTIONS } from './planner.js';

export const MISSION_SCHEMA = 'majin.v6.arena.mission/v1';
export const JOURNAL_SCHEMA = 'majin.v6.arena.journal/v1';

const SLUG = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const MISSION_ACTIONS = DECISION_ACTIONS.filter((action) => action !== 'stop');

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function validateMission(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: { code: 'MISSION_INVALID', reason: 'Mission must be a JSON object' } };
  }
  if (raw.schema !== MISSION_SCHEMA) {
    return { ok: false, error: { code: 'MISSION_INVALID', reason: `Expected schema ${MISSION_SCHEMA}` } };
  }
  const id = String(raw.id || '').trim();
  if (!SLUG.test(id)) {
    return { ok: false, error: { code: 'MISSION_ID_INVALID', reason: 'id must be a short lowercase slug (a-z0-9._-), 3-64 chars' } };
  }
  const goal = String(raw.goal || '').trim();
  if (goal.length < 10) {
    return { ok: false, error: { code: 'MISSION_GOAL_MISSING', reason: 'goal must describe what should be achieved' } };
  }
  const allowedActions = Array.isArray(raw.allowedActions) ? raw.allowedActions.map(String) : [];
  if (!allowedActions.length) {
    return { ok: false, error: { code: 'MISSION_ACTIONS_MISSING', reason: 'allowedActions must list what the agent may do' } };
  }
  const unknown = allowedActions.filter((action) => !MISSION_ACTIONS.includes(action));
  if (unknown.length) {
    return { ok: false, error: { code: 'MISSION_ACTION_UNKNOWN', reason: `Unsupported action(s): ${unknown.join(', ')}` } };
  }
  const allowedTools = Array.isArray(raw.allowedTools) ? raw.allowedTools.map(String) : [];
  if (allowedActions.includes('tool') && !allowedTools.length) {
    return { ok: false, error: { code: 'MISSION_TOOLS_MISSING', reason: 'a mission that allows "tool" must list allowedTools' } };
  }
  const budget = raw.budget && typeof raw.budget === 'object' ? raw.budget : {};
  return {
    ok: true,
    mission: {
      schema: MISSION_SCHEMA,
      id,
      goal: goal.slice(0, 2000),
      constraints: (Array.isArray(raw.constraints) ? raw.constraints : []).map((line) => String(line).slice(0, 300)).slice(0, 20),
      allowedActions,
      allowedTools,
      stopWhen: raw.stopWhen ? String(raw.stopWhen).slice(0, 500) : null,
      budget: {
        maxSteps: int(budget.maxSteps, 10, { min: 1, max: 200 }),
        maxTokens: int(budget.maxTokens, 60000, { min: 1000 }),
        maxWallMs: int(budget.maxWallMs, 30 * 60 * 1000, { min: 10000 }),
        maxCostUsd: Number.isFinite(Number(budget.maxCostUsd)) ? Math.max(0, Number(budget.maxCostUsd)) : 1,
        maxSubmissions: int(budget.maxSubmissions, 0, { min: 0, max: 50 }),
      },
      notes: raw.notes ? String(raw.notes).slice(0, 1000) : null,
    },
  };
}

export function loadMission(file, { fsImpl = fs } = {}) {
  let raw;
  try {
    raw = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, error: { code: 'MISSION_UNREADABLE', reason: `${file}: ${error.message}` } };
  }
  return validateMission(raw);
}

/**
 * Append-only journal, one JSON object per line. Written with mode 600: it
 * contains employer names and summaries, never CV text or email bodies.
 */
export class MissionJournal {
  constructor({ dir, missionId, fsImpl = fs, clock = Date.now }) {
    this.dir = dir;
    this.missionId = missionId;
    this.fs = fsImpl;
    this.clock = clock;
    this.file = path.join(dir, `${missionId}.jsonl`);
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  read() {
    let text = '';
    try { text = this.fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    const entries = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch { /* a torn trailing line is skipped, never guessed */ }
    }
    return entries;
  }

  append(entry) {
    const record = { schema: JOURNAL_SCHEMA, missionId: this.missionId, at: new Date(this.clock()).toISOString(), ...entry };
    this.fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    return record;
  }
}

/** Compact, real state for the prompt: no secrets, no CV text, no email bodies. */
export function buildStateDigest({ mission, step, tasks = [], applications = [], lastResult = null, spent = {}, counters = {} }) {
  const taskSummary = tasks.slice(-8).map((task) => ({
    step: task.step ?? null,
    kind: task.kind,
    state: task.state,
    summary: task.summary ? String(task.summary).slice(0, 240) : null,
    output: task.output ? JSON.stringify(task.output).slice(0, 600) : null,
    errorCode: task.errorCode || null,
  }));
  const byState = {};
  for (const app of applications) byState[app.state] = (byState[app.state] || 0) + 1;
  return {
    step,
    budgetLeft: {
      steps: Math.max(0, mission.budget.maxSteps - step),
      tokens: Math.max(0, mission.budget.maxTokens - (spent.tokens || 0)),
      costUsd: Math.max(0, Number((mission.budget.maxCostUsd - (spent.costUsd || 0)).toFixed(4))),
      submissions: Math.max(0, mission.budget.maxSubmissions - (counters.submissions || 0)),
    },
    tasks: taskSummary,
    applications: {
      counts: byState,
      recent: applications.slice(-5).map((app) => ({
        id: app.id,
        company: app.job?.company || null,
        title: app.job?.title || null,
        state: app.state,
      })),
    },
    lastResult: lastResult
      ? {
        step: lastResult.step,
        action: lastResult.action,
        state: lastResult.state,
        summary: lastResult.summary ? String(lastResult.summary).slice(0, 240) : null,
        output: lastResult.output ? JSON.stringify(lastResult.output).slice(0, 600) : null,
      }
      : null,
    notes: mission.notes,
  };
}
