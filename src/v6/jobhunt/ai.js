import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, newId, nowIso, readJson } from '../util.js';
import { DEFAULT_MODEL, parseOpenCodeOutput, runOpenCodeRound } from '../goal/opencode.js';

export const AI_SCHEMA = 'majin.v6.ai-message/v1';

function activeFile(home) { return path.join(home, 'jobhunt', 'ai-active.json'); }
function logFile(home) { return path.join(home, 'jobhunt', 'ai.jsonl'); }

export function readAiLog(home, limit = 50) {
  try {
    return fs.readFileSync(logFile(home), 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export function readAiActive(home) {
  return readJson(activeFile(home), null);
}

export function summarizeJobs(applications = [], limit = 25) {
  return applications.slice(0, limit).map((app) => ({
    applicationId: app.id,
    company: app.job?.company || null,
    title: app.job?.title || null,
    city: app.job?.city || null,
    state: app.state,
    score: app.score,
  }));
}

function candidateContext(home) {
  try { return fs.readFileSync(path.join(home, 'jobhunt', 'candidate-context.md'), 'utf8').slice(0, 5000); } catch { return ''; }
}

export function buildHeadPrompt({ mission, session, queue, jobs, checkpoint, allowSubmit = false, context = '' }) {
  const recent = summarizeJobs(jobs, 25);
  return [
    'You are MAJIN V6 Head Orchestrator. You are a real DeepSeek Flash decision-maker, not a timer.',
    'Decide the next bounded work for the mission and return one JSON object only.',
    '',
    `MISSION_ID: ${mission.id}`,
    `MISSION_KIND: ${mission.kind || 'jobhunt'}`,
    `MISSION_GOAL: ${mission.goal || 'Find jobs'}`,
    `DEADLINE: ${mission.deadlineAt}`,
    `ROUND: ${session.round || 0}`,
    `QUEUE: ${JSON.stringify(queue.byState || {})}`,
    `COUNTS: ${JSON.stringify(session.counts || {})}`,
    `CANDIDATE: ${session.candidateId || mission.candidateId || 'lavinia'}`,
    `REGION_FOCUS: Copenhagen / Greater Copenhagen; Malmo / Skane is acceptable; Stockholm only hybrid/remote.`,
    `CANDIDATE_CONTEXT: ${String(context || '').slice(0, 4000)}`,
    `OWNER_REVIEW: ${allowSubmit ? 'submit adapter available only for approved applications' : 'do not submit; collect approval evidence and continue other safe work'}`,
    '',
    'RECENT APPLICATIONS:',
    JSON.stringify(recent, null, 2),
    '',
    'LAST CHECKPOINT:',
    String(checkpoint || '(none)').slice(0, 8000),
    '',
    'ALLOWED TASK KINDS:',
    '- job.discover: {"kind":"job.discover","query":"...","limit":50}',
    '- job.evaluate: {"kind":"job.evaluate","applicationId":"..."}',
    '- gmail.verify: {"kind":"gmail.verify","applicationId":"..."}',
    'Never invent an applicationId. Never return job.submit unless it is explicitly allowed above.',
    'Prefer verification of previously submitted applications and new relevant searches.',
    'If no meaningful task exists, return an empty tasks array and say why.',
    '',
    'Return ONLY this JSON shape:',
    '{"message":"brief natural Swedish update","strategy":"brief strategy","tasks":[{"kind":"job.discover","query":"content creator","limit":50}]}',
  ].join('\n');
}

export function parseHeadResponse(text = '') {
  const raw = String(text || '').trim();
  let candidate = raw;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1].trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    return {
      message: typeof parsed.message === 'string' ? parsed.message.slice(0, 4000) : null,
      strategy: typeof parsed.strategy === 'string' ? parsed.strategy.slice(0, 2000) : null,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      validJson: true,
    };
  } catch {
    return { message: raw.slice(0, 2000) || null, strategy: null, tasks: [], validJson: false };
  }
}

function validTask(task) {
  if (!task || typeof task !== 'object') return null;
  if (task.kind === 'job.discover' && typeof task.query === 'string' && task.query.trim()) {
    return { kind: 'job.discover', query: task.query.trim().slice(0, 150), limit: Math.max(1, Math.min(50, Number(task.limit) || 50)) };
  }
  if (['job.evaluate', 'gmail.verify'].includes(task.kind) && typeof task.applicationId === 'string' && task.applicationId.startsWith('app_')) {
    return { kind: task.kind, applicationId: task.applicationId };
  }
  return null;
}

function usageFrom(events = []) {
  const finish = [...events].reverse().find((event) => event.type === 'step_finish');
  return finish?.part?.tokens || null;
}

export async function askHead({
  home, mission, session, queue, jobs = [], checkpoint = null, model = DEFAULT_MODEL,
  workspace = process.cwd(), timeoutMs = 120000, allowSubmit = false,
  runRound = runOpenCodeRound, now = Date.now,
} = {}) {
  const invocationId = newId('ai', () => now());
  const startedAt = nowIso(now);
  const active = { invocationId, missionId: mission.id, provider: 'opencode-go', modelId: model, startedAt, status: 'THINKING' };
  atomicWriteJson(activeFile(home), active);
  let result;
  try {
    const prompt = buildHeadPrompt({ mission, session, queue, jobs, checkpoint, allowSubmit, context: candidateContext(home) });
    result = await runRound({
      prompt, sessionId: null, model, workspace, timeoutMs, agent: 'plan',
    });
  } catch (error) {
    result = { ok: false, text: '', error: String(error?.message || error), events: [], sessionId: null };
  }
  const parsed = parseHeadResponse(result.text);
  const tasks = parsed.tasks.map(validTask).filter(Boolean).slice(0, 20);
  const record = {
    schema: AI_SCHEMA,
    missionId: mission.id,
    invocationId,
    provider: 'opencode-go',
    exactModelId: model,
    opencodeSessionId: result.sessionId || null,
    createdAt: startedAt,
    completedAt: nowIso(now),
    status: result.ok ? 'COMPLETED' : 'FAILED',
    messageText: parsed.message || (result.ok ? 'AI returned no message.' : 'AI call failed.'),
    strategy: parsed.strategy,
    tasks,
    relatedTaskIds: [],
    usage: usageFrom(result.events),
    error: result.error || null,
    validJson: parsed.validJson,
  };
  fs.appendFileSync(logFile(home), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  fs.rmSync(activeFile(home), { force: true });
  return { ...record, ok: result.ok === true, rawText: result.text, result };
}

export { activeFile, logFile, validTask, usageFrom };
