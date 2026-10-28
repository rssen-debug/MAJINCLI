import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_MODEL = 'opencode-go/deepseek-v4.1-flash';

export function resolveOpenCodeCommand(env = process.env) {
  const configured = env.MAJIN_OPENCODE_BIN || env.OPENCODE_BIN || null;
  if (configured) {
    const exists = fs.existsSync(configured);
    return { command: configured, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(configured), exists };
  }
  const candidates = [
    path.join(env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    path.join(env.LOCALAPPDATA || '', 'Programs', 'opencode', 'opencode.exe'),
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (found) return { command: found, shell: false, exists: true };
  return { command: 'opencode', shell: process.platform === 'win32', exists: false };
}

export function buildGoalPrompt({ goal, kind, round, deadlineAt, remainingHuman, checkpoint, sessionId }) {
  return [
    'You are MAJIN V6 Goal Runner. You perform real work, not a plan-only response.',
    `GOAL: ${goal}`,
    `KIND: ${kind || 'generic'}`,
    `ROUND: ${round}`,
    `ABSOLUTE DEADLINE: ${deadlineAt}`,
    `TIME REMAINING: ${remainingHuman}`,
    `OPENCODE SESSION: ${sessionId || 'new session'}`,
    '',
    'PREVIOUS CHECKPOINT:',
    String(checkpoint || 'No previous round. Start with the smallest real, verifiable step.').slice(0, 12000),
    '',
    'RULES:',
    '- Use the existing OpenCode tools and permissions; do not invent a new AI system.',
    '- Do actual work in this round. Persist evidence before claiming success.',
    '- Reuse the V6 queue/supervisor where relevant. Irreversible actions need stable operation IDs and idempotency checks.',
    '- Do not repeat an external effect if evidence already exists. If it is uncertain, reconcile instead of retrying.',
    '- Respect owner-review, credentials, portal login/MFA/CAPTCHA and the original deadline.',
    '- If one path is blocked, continue with an independent useful task.',
    '- Keep the checkpoint compact: what changed, what was verified, what is blocked, next action.',
    '- End with exactly one status line: CONTINUE or GOAL_DONE.',
    '- Use GOAL_DONE only when the goal is actually complete and verified.',
  ].join('\n');
}

export function parseOpenCodeOutput(stdout = '', stderr = '') {
  const events = [];
  let sessionId = null;
  let text = '';
  let error = null;
  let finished = false;
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try { event = JSON.parse(trimmed); } catch { continue; }
    events.push(event);
    if (event.sessionID) sessionId = event.sessionID;
    if (event.type === 'text' && event.part?.text) text += `${text ? '\n' : ''}${event.part.text}`;
    if (event.type === 'step_finish') finished = true;
    if (event.type === 'error') error = event.error?.data?.message || event.error?.message || event.error?.name || 'OpenCode error';
  }
  if (!error && stderr.trim()) {
    const tail = String(stderr).trim().split(/\r?\n/).slice(-3).join(' ');
    if (/\berror\b|invalid credential|failed/i.test(tail)) error = tail.slice(0, 500);
  }
  return { events, sessionId, text: text.trim(), error, finished };
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    return;
  }
  try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
}

export async function runOpenCodeRound({
  prompt, sessionId = null, model = DEFAULT_MODEL, workspace = process.cwd(), timeoutMs = 10 * 60 * 1000,
  env = process.env, onEvent = null, agent = null,
} = {}) {
  const resolved = resolveOpenCodeCommand(env);
  const args = ['run', '--format', 'json', '--model', model, '--dir', workspace];
  if (sessionId) args.push('--session', sessionId);
  if (agent) args.push('--agent', agent);
  args.push(prompt);
  const child = spawn(resolved.command, args, {
    cwd: workspace,
    shell: resolved.shell,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, MAJIN_GOAL_RUNNER: '1' },
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let aborted = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, Math.max(1000, Number(timeoutMs) || 10 * 60 * 1000));
  child.stdout.on('data', (chunk) => {
    const value = chunk.toString();
    stdout += value;
    if (onEvent) {
      for (const line of value.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { onEvent(JSON.parse(line)); } catch { /* partial line or human output */ }
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const exit = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }));
    child.once('exit', (code) => resolve({ code, error: null }));
  });
  clearTimeout(timer);
  const parsed = parseOpenCodeOutput(stdout, stderr);
  const error = parsed.error || (exit.error ? exit.error.message : null) || (exit.code && !parsed.finished ? `OpenCode exited with code ${exit.code}` : null);
  return {
    ok: !timedOut && !aborted && !error && Boolean(parsed.finished || parsed.text),
    timedOut, aborted, exitCode: exit.code,
    sessionId: parsed.sessionId || sessionId,
    text: parsed.text,
    error,
    events: parsed.events,
    stderr: stderr.trim().slice(-2000),
  };
}
