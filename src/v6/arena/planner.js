/**
 * MAJIN V6 — Arena planner.
 *
 * The honest architecture question "who runs the loop?" is answered here: this
 * chat cannot. A chat turn is bounded, this sandbox has no route to the PC and
 * no reachable model endpoint (measured — see docs/v6/ARENA_BRIDGE.md §7), so
 * the loop runs locally on the owner's machine and this module is its brain.
 *
 * It reuses MAJIN's existing provider transport (`src/core/provider/chat.js`):
 * same dialects, same retry/rate-limit handling, same token and cost accounting.
 * No second provider stack is created, and nothing here touches OpenCode's
 * configuration.
 *
 * The model is asked for ONE decision per turn, as strict JSON. We never ask for
 * chain-of-thought and never store it; the only reasoning kept is a short,
 * owner-readable rationale that is written to the mission journal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { complete as providerComplete } from '../../core/provider/chat.js';
import { chatUrl, PRESETS as PROVIDER_PRESETS } from '../../core/presets.js';

export const PLANNER_SCHEMA = 'majin.v6.arena.planner/v1';
export const DECISION_SCHEMA = 'majin.v6.arena.decision/v1';
const MAX_RATIONALE = 240;

export const DECISION_ACTIONS = Object.freeze([
  'tool', 'job.discover', 'job.evaluate', 'job.submit', 'gmail.verify', 'health.delay', 'wait', 'stop',
]);

/** One sentence, bounded, no newlines: the only model text that gets stored. */
export function trimRationale(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.slice(0, MAX_RATIONALE);
}

/**
 * Load the planner configuration. A key is required; a missing key is BLOCKED,
 * never a silent fallback to a mock.
 */
export function loadPlannerConfig({ policy = null, env = process.env, fsImpl = fs, keyFile = null } = {}) {
  const provider = String(
    env.MAJIN_ARENA_PROVIDER || policy?.planner?.provider || 'deepseek',
  ).toLowerCase();
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) {
    return {
      ok: false,
      error: {
        code: 'PLANNER_PROVIDER_UNKNOWN',
        reason: `Unknown provider "${provider}". Known: ${Object.keys(PROVIDER_PRESETS).join(', ')}`,
      },
    };
  }

  const file = keyFile || env.MAJIN_ARENA_KEY_FILE || null;
  let apiKey = env[preset.keyEnv] || null;
  let source = apiKey ? preset.keyEnv : null;
  if (!apiKey && file && fsImpl.existsSync(file)) {
    try {
      apiKey = fsImpl.readFileSync(file, 'utf8').trim() || null;
      source = file;
    } catch { /* treated as missing below */ }
  }
  if (!apiKey) {
    return {
      ok: false,
      error: {
        code: 'PLANNER_KEY_MISSING',
        reason: `No API key for ${preset.label}. Set ${preset.keyEnv} or save the key to ${file || '<v6>/arena/planner-key'} (mode 600).`,
      },
    };
  }

  const model = String(env.MAJIN_ARENA_MODEL || policy?.planner?.model || preset.models?.[0] || '');
  if (!model) {
    return { ok: false, error: { code: 'PLANNER_MODEL_MISSING', reason: `${preset.label} has no default model configured` } };
  }

  const baseUrl = String(policy?.planner?.baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
  const route = {
    kind: preset.kind || 'openai',
    providerName: preset.label || provider,
    provider,
    baseUrl,
    endpoint: policy?.planner?.endpoint || chatUrl({ baseUrl, kind: preset.kind || 'openai' }),
    apiKey,
    model,
    maxTokens: Number(policy?.planner?.maxTokens) || 1200,
    temperature: Number(policy?.planner?.temperature) || 0.1,
    pricing: policy?.planner?.pricing || null,
  };
  return {
    ok: true,
    config: {
      schema: PLANNER_SCHEMA,
      provider,
      model,
      route,
      keySource: source,
      offline: false,
    },
  };
}

function systemPrompt(mission, catalog) {
  return [
    'You are the planning half of MAJIN. You do not execute tools yourself: you choose exactly one next action and MAJIN runs it on the owner\'s machine.',
    'Answer with ONE JSON object and nothing else. No markdown, no prose, no code fences.',
    'Shape: {"action": "<one of the allowed actions>", "payload": {...}, "rationale": "one short sentence", "done": false, "summary": "optional"}',
    `Allowed actions in this mission: ${mission.allowedActions.join(', ')}.`,
    mission.allowedTools.length ? `Allowed tools inside a "tool" action: ${mission.allowedTools.join(', ')}.` : 'No tool action is allowed in this mission.',
    catalog ? `Tool catalogue (name: what it does):\n${catalog}` : '',
    'Rules you must follow:',
    '- Choose "stop" with "done": true when the goal is reached or is impossible; put the reason in "summary".',
    '- Never claim something happened. Judge only from the results MAJIN returned.',
    '- If a required owner decision is missing, choose "stop" and say what the owner must do.',
    '- Do not repeat an action that already failed twice with the same error; choose something else or stop.',
    `Mission goal: ${mission.goal}`,
    mission.stopWhen ? `Stop when: ${mission.stopWhen}` : '',
    mission.constraints.length ? `Owner constraints:\n- ${mission.constraints.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}

/** Build the prompt from real persisted state. No secrets, no CV text, no email bodies. */
export function buildMessages({ mission, state, catalog = '' }) {
  const digest = {
    missionId: mission.id,
    step: state.step,
    budgetLeft: state.budgetLeft,
    tasks: state.tasks,
    applications: state.applications,
    lastResult: state.lastResult,
    notes: state.notes,
  };
  return [
    { role: 'system', content: systemPrompt(mission, catalog) },
    { role: 'user', content: `Current state (real, from MAJIN's store):\n${JSON.stringify(digest, null, 2)}\n\nChoose the single next action.` },
  ];
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

/**
 * Turn a raw model answer into a validated decision.
 * Malformed JSON, an unknown action or an unlisted tool is an error — never a
 * guessed action, because the next step executes on the owner's machine.
 */
export function parseDecision(text, { mission }) {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: { code: 'PLANNER_NOT_JSON', reason: 'The model did not return a JSON object' } };
  }
  const action = String(parsed.action || '').trim();
  if (!DECISION_ACTIONS.includes(action)) {
    return { ok: false, error: { code: 'PLANNER_ACTION_UNKNOWN', reason: `Unknown action "${action}"` } };
  }
  if (action !== 'stop' && !mission.allowedActions.includes(action)) {
    return { ok: false, error: { code: 'PLANNER_ACTION_NOT_ALLOWED', reason: `Action "${action}" is not allowed in mission ${mission.id}` } };
  }
  const payload = parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload) ? parsed.payload : {};
  if (action === 'tool') {
    const tool = String(payload.tool || '');
    if (!tool) return { ok: false, error: { code: 'PLANNER_TOOL_MISSING', reason: 'A tool action must name a tool' } };
    if (!mission.allowedTools.includes(tool)) {
      return { ok: false, error: { code: 'PLANNER_TOOL_NOT_ALLOWED', reason: `Tool "${tool}" is not allowed in mission ${mission.id}` } };
    }
  }
  return {
    ok: true,
    decision: {
      schema: DECISION_SCHEMA,
      action,
      payload,
      rationale: trimRationale(parsed.rationale),
      done: parsed.done === true || action === 'stop',
      summary: trimmed(parsed.summary, 400),
    },
  };
}

function trimmed(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Ask the planner for one decision.
 * `completeFn` is injectable so a test can drive the loop through a real HTTP
 * endpoint without pretending a real model was consulted.
 */
export async function askPlanner({ config, mission, state, catalog = '', signal = null, completeFn = providerComplete }) {
  const messages = buildMessages({ mission, state, catalog });
  const startedAt = Date.now();
  let response;
  try {
    response = await completeFn({ route: config.route, messages, signal, job: 'arena.planner' });
  } catch (error) {
    return {
      ok: false,
      usage: null,
      error: {
        code: error?.majin?.kind ? `PLANNER_${String(error.majin.kind).toUpperCase()}` : (error?.code || 'PLANNER_ERROR'),
        reason: String(error?.majin?.human || error?.message || error).slice(0, 300),
        retryable: error?.majin ? error.majin.retryable === true : false,
      },
    };
  }
  const parsed = parseDecision(response?.text, { mission });
  const usage = {
    input: Number(response?.usage?.input) || 0,
    output: Number(response?.usage?.output) || 0,
    costUsd: Number(response?.usage?.costUsd) || 0,
    elapsedMs: Date.now() - startedAt,
  };
  if (!parsed.ok) return { ok: false, error: parsed.error, usage, text: String(response?.text || '').slice(0, 2000) };
  return { ok: true, decision: parsed.decision, usage, model: response?.raw?.model || config.model };
}
