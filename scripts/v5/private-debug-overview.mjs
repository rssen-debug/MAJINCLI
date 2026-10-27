#!/usr/bin/env node
/**
 * MAJIN V5 private debug observer.
 * Local source: V5's persisted provider-agent checkpoint.
 * GitHub destination: a repo proven PRIVATE by GitHub API before EVERY upload.
 * The remote report is an allowlisted timeline of metadata, never source logs.
 * No remote commands are executed. No model private reasoning is accessible.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const SAFE_STATUSES = new Set(['RUNNING', 'COMPLETED', 'PARTIAL', 'BLOCKED', 'PAUSED', 'WAITING_USER', 'FAILED', 'CANCELLED']);
const SAFE_EVENT_TYPES = new Set([
  'goal_started', 'goal_resumed', 'goal_finished', 'mode_selected',
  'model_round_started', 'model_thinking_started', 'model_tool_started', 'model_stream_retry',
  'tool_call_started', 'tool_call_finished', 'criteria_registered',
  'verification_started', 'verification_passed', 'verification_failed',
  'verification_unsupported', 'verification_completed', 'repair_requested',
  'delegate_batch_started', 'delegate_task_started', 'delegate_task_finished',
  'delegate_batch_finished', 'waiting_user', 'context_compacted',
  'owner_steering_applied', 'browser_blocked_request',
]);
const SAFE_SYMBOL = /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/;
function tag(value, fallback = 'unknown') {
  const s = String(value ?? '');
  return SAFE_SYMBOL.test(s) ? s : fallback;
}
function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
function status(value) {
  return SAFE_STATUSES.has(value) ? value : 'UNKNOWN';
}
function countBy(values) {
  const result = Object.create(null);
  for (const v of values) result[v] = (result[v] || 0) + 1;
  return { ...result };
}

/** Strict projection; do not spread source objects or serialize unknown fields. */
export function buildOverview(checkpoint) {
  const goal = checkpoint?.goal && typeof checkpoint.goal === 'object' ? checkpoint.goal : {};
  const tools = Array.isArray(goal.tool_results) ? goal.tool_results : [];
  const trace = Array.isArray(goal.trace) ? goal.trace : [];
  const events = trace.filter(e => e && SAFE_EVENT_TYPES.has(e.type));
  const timeline = events.slice(-120).map(e => ({
    seq: number(e.seq),
    type: e.type,
    ...(e.tool ? { tool: tag(e.tool) } : {}),
    ...(e.mode ? { mode: tag(e.mode) } : {}),
    ...(e.status ? { status: tag(e.status) } : {}),
    ...(e.kind ? { kind: tag(e.kind) } : {}),
    ...(e.errorCode ? { error_code: tag(e.errorCode) } : {}),
    ...(typeof e.ok === 'boolean' ? { ok: e.ok } : {}),
    ...(e.durationMs != null ? { duration_ms: number(e.durationMs) } : {}),
    ...(e.round != null ? { round: number(e.round) } : {}),
  }));
  const toolStates = tools.map(t => ({
    tool: tag(t?.tool),
    ok: t?.ok === true,
    ...(t?.status ? { status: tag(t.status) } : {}),
    ...(t?.errorCode ? { error_code: tag(t.errorCode) } : {}),
  }));
  const counts = countBy(toolStates.map(t => t.tool));
  const last = timeline[timeline.length - 1] || null;
  return {
    schema: 'majin.private-debug.v1',
    privacy: 'allowlisted metadata only; no goal text, CV, email, paths, tool inputs/outputs, URLs, tokens or model text',
    goal: {
      status: status(goal.status),
      resume_count: number(goal.resume_count),
      created_at: /^\d{4}-\d\d-\d\dT/.test(String(goal.created_at || '')) ? String(goal.created_at).slice(0, 10) : null,
      browser_handoff: goal.browser_handoff ? tag(goal.browser_handoff.kind, 'owner_action') : null,
      criteria_count: Array.isArray(goal.criteria) ? goal.criteria.length : 0,
      verification_count: Array.isArray(goal.verification_evidence) ? goal.verification_evidence.length : 0,
      last_event: last,
    },
    metrics: {
      tool_calls: tools.length,
      tool_failures: toolStates.filter(t => !t.ok).length,
      tools_by_name: counts,
      event_types: countBy(events.map(e => e.type)),
      model_calls: number(goal.cost?.modelCalls),
      input_tokens: number(goal.cost?.inputTokens),
      output_tokens: number(goal.cost?.outputTokens),
    },
    recent_tools: toolStates.slice(-60),
    recent_timeline: timeline,
  };
}

export function markdownOverview(report) {
  const lines = [
    '# MAJIN V5 — Private debug overview',
    '',
    '> Sanitized operational metadata only. See local /logs for the full trace.',
    '',
    '| Metric | Value |',
    '|---|---|',
    '| Goal status | ' + report.goal.status + ' |',
    '| Resume attempts | ' + report.goal.resume_count + ' |',
    '| Tool calls | ' + report.metrics.tool_calls + ' |',
    '| Tool failures | ' + report.metrics.tool_failures + ' |',
    '| Verification evidence | ' + report.goal.verification_count + ' |',
    '| Model calls | ' + report.metrics.model_calls + ' |',
    '| Owner handoff | ' + (report.goal.browser_handoff || 'none') + ' |',
    '',
    '## Observed events (latest 120)',
    '',
    '| Seq | Event | Tool | Result |',
    '|---:|---|---|---|',
  ];
  for (const e of report.recent_timeline) {
    lines.push('| ' + e.seq + ' | ' + e.type + ' | ' + (e.tool || '-') + ' | '
      + (e.ok === true ? 'ok' : e.ok === false ? 'failed' : e.error_code || e.status || '-') + ' |');
  }
  lines.push('', 'No internal chain-of-thought, page text, credentials, email or applicant data is included.', '');
  return lines.join('\n');
}
function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1] || fallback;
}
function defaultDataDir() {
  if (process.env.MAJIN_V5_DATA_DIR) return path.resolve(process.env.MAJIN_V5_DATA_DIR);
  if (process.env.MAJIN_HOME) return path.resolve(process.env.MAJIN_HOME, 'v5');
  return process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'MAJIN', 'v5')
    : path.join(os.homedir(), '.majin', 'v5');
}
function gh(args) {
  return execFileSync(process.platform === 'win32' ? 'gh.exe' : 'gh', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 25000, maxBuffer: 1024 * 1024,
    windowsHide: true,
  }).trim();
}
function privateRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw Error('Invalid repository name');
  const meta = JSON.parse(gh(['api', 'repos/' + repo]));
  if (meta.private !== true || meta.full_name?.toLowerCase() !== repo.toLowerCase()) {
    throw Error('Upload REFUSED: target repository is not verified private');
  }
  if (meta.permissions?.push !== true) throw Error('Upload REFUSED: insufficient permission to private repository');
}
function uploadPrivate(repo, remotePath, content) {
  // Re-check visibility at the moment of upload: never fall back to MAJINCLI.
  privateRepo(repo);
  let sha;
  try {
    const existing = JSON.parse(gh(['api', 'repos/' + repo + '/contents/' + remotePath]));
    if (existing.sha) sha = existing.sha;
  } catch (error) {
    const stderr = String(error?.stderr || '');
    if (!/\b404\b|Not Found/i.test(stderr)) throw error;
  }
  const args = ['api', '-X', 'PUT', 'repos/' + repo + '/contents/' + remotePath,
    '-f', 'message=chore(debug): update private sanitized MAJIN overview',
    '-f', 'content=' + Buffer.from(content, 'utf8').toString('base64')];
  if (sha) args.push('-f', 'sha=' + sha);
  gh(args);
}
export function readSnapshot(dataDir) {
  const filename = path.join(dataDir, 'provider-agent', 'current.json');
  if (!fs.existsSync(filename)) return null;
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
function saveLocal(outputDir, report) {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(outputDir, 'overview.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(outputDir, 'OVERVIEW.md'), markdownOverview(report), { mode: 0o600 });
}
function main() {
  const dataDir = path.resolve(arg('--data-dir', defaultDataDir()));
  const repo = arg('--private-repo');
  const watch = process.argv.includes('--watch');
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Invalid --private-repo');
  if (!fs.existsSync(dataDir)) throw Error('V5 data directory not found: ' + dataDir);
  const outputDir = path.join(dataDir, 'private-debug');
  if (repo) privateRepo(repo); // fail closed before reading any checkpoint
  let lastContentHash = '';
  let lastPush = 0;
  const publish = () => {
    const snapshot = readSnapshot(dataDir);
    if (!snapshot) {
      console.log('No V5 checkpoint yet; waiting for a real goal.');
      return;
    }
    const overview = buildOverview(snapshot);
    const json = JSON.stringify(overview, null, 2) + '\n';
    const fingerprint = createHash('sha256').update(json).digest('hex');
    saveLocal(outputDir, overview);
    if (!repo || fingerprint === lastContentHash || Date.now() - lastPush < 60000) return;
    uploadPrivate(repo, 'debug/majin-v5/latest.json', json);
    uploadPrivate(repo, 'debug/majin-v5/OVERVIEW.md', markdownOverview(overview));
    lastContentHash = fingerprint;
    lastPush = Date.now();
    console.log('Private debug overview updated; status: ' + overview.goal.status +
      '; tools: ' + overview.metrics.tool_calls + '; failures: ' + overview.metrics.tool_failures);
  };
  // Upload failure stays visible; the observer cannot affect the MAJIN process.
  publish();
  if (watch) {
    console.log('Watching existing V5 checkpoint. Ctrl+C stops this observer only.');
    setInterval(() => {
      try { publish(); }
      catch (err) { console.error('Private debug update FAILED: ' + (err?.message || String(err))); }
    }, 15000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error('Private debug observer refused: ' + (error?.message || String(error))); process.exitCode = 1; }
}
