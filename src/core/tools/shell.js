/**
 * MAJIN — shell.
 * Auto-detekterar skallet (pwsh > powershell > cmd på Windows, bash/zsh annars) och
 * kör med tyst timeout + output-cap. Alltid på. Farliga mönster går via guarden.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { def } from './registry.js';
import { bus } from '../log.js';

const WIN = process.platform === 'win32';
let chosen = null;

export function shell() {
  if (chosen) return chosen;
  const pref = process.env.MAJIN_SHELL || 'auto';
  const candidates = WIN
    ? pref === 'cmd'
      ? [['cmd.exe', '/d', '/c']]
      : [
          ['pwsh.exe', '-NoProfile', '-NonInteractive', '-Command'],
          ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command'],
          ['cmd.exe', '/d', '/c'],
        ]
    : pref === 'sh'
      ? [['/bin/sh', '-c']]
      : [['bash', '-lc'], ['zsh', '-lc'], ['/bin/sh', '-c']];
  chosen = { cmd: candidates[0][0], args: candidates[0].slice(1), name: path.basename(candidates[0][0]) };
  return chosen;
}

function quotePowerShell(cmd) {
  return `'${String(cmd).replace(/'/g, "''")}'`;
}

function build(command, { cwd, env } = {}) {
  const s = shell();
  const isPwsh = /pwsh|powershell/i.test(s.cmd);
  const wrapped = isPwsh ? `$ErrorActionPreference='continue'; ${command}` : command;
  const args = isPwsh ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped] : [...s.args, command];
  return { cmd: s.cmd, args, cwd: cwd || process.cwd(), env: { ...process.env, ...(env || {}), MAJIN: '1', TERM: 'dumb', NO_COLOR: '1' } };
}

export function runShell(command, { cwd, timeoutSec = 150, maxChars = 40000, env, onChunk } = {}) {
  const t0 = Date.now();
  const { cmd, args, cwd: wdf, env: wenv } = build(command, { cwd, env });
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: wdf, env: wenv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: `spawn: ${err.message}`, exitCode: -1, ms: 0, cmd: `${cmd}` });
      return;
    }
    let out = '';
    let err = '';
    let truncated = false;
    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* red */
      }
    }, Math.max(1, timeoutSec) * 1000);
    timer.unref?.();
    let killed = false;
    const onData = (d, target) => {
      const s = String(d);
      onChunk?.(s, target);
      if (target === 'out' ? out.length > maxChars * 2 : err.length > 20000) {
        truncated = true;
        return;
      }
      if (target === 'out') out += s;
      else err += s;
    };
    child.stdout?.on('data', (d) => onData(d, 'out'));
    child.stderr?.on('data', (d) => onData(d, 'err'));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `${cmd}: ${e.message}`, hint: /ENOENT/.test(e.message) ? 'skallet hittades inte' : null, exitCode: -1, ms: Date.now() - t0 });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        exitCode: code,
        signal: signal || null,
        killed,
        stdout: truncated ? `${out.slice(0, maxChars)}\n…[klippt]` : out,
        stderr: err,
        ms: Date.now() - t0,
        shell: path.basename(cmd),
        command,
      });
    });
  });
}

const jobs = new Map();

export const shellTools = [
  def({
    name: 'shell.run',
    group: 'shell',
    risk: 'exec',
    desc: 'Kör ett kommando och väntar. Allt är tillåtet — guarden stoppar bara det som är irreversibelt. cwd är workspace om inget annat anges.',
    params: {
      command: 'string: kommandot som körs i systemets skal (PowerShell på Windows)',
      cwd: 'string: arbetskatalog (valfritt)',
      timeoutSec: 'number: sekunder innan det dödas (default 150)',
      env: 'object: extra miljövariabler',
    },
    examples: ['shell.run({command:"git -C . status -s"})', 'shell.run({command:"Get-Process | sort CPU | select -last 5"})'],
    async run({ command, cwd, timeoutSec = 150, env }, ctx) {
      const dir = cwd ? path.resolve(String(cwd)) : ctx.cfg.get('workspace') || process.cwd();
      const max = ctx.cfg.get('tools.shell.maxOutputChars') || 12000;
      ctx.emit?.({ type: 'shell', command: command.slice(0, 200), cwd: dir });
      const r = await runShell(command, { cwd: dir, timeoutSec, maxChars: max * 3, env });
      if (r.error) return { ok: false, error: { code: 'spawn_failed', message: r.error, hint: r.hint } };
      const out = `${r.stdout || ''}${r.stderr ? `\n-- stderr --\n${r.stderr}` : ''}`.trim();
      const status = r.ok ? 'ok' : `exit ${r.exitCode}${r.killed ? ' (dödad efter timeout)' : ''}`;
      return {
        ok: true,
        result: `$ ${command}\n[${status} · ${r.ms}ms · ${r.shell}${out.length ? ` · ${out.length} tecken` : ''}]\n${out || '(ingen output)'}`,
        meta: { exitCode: r.exitCode, ms: r.ms, killed: r.killed, cwd: dir, outChars: out.length },
        summary: `${path.basename(command.split(/\s+/)[0] || 'shell')} → ${status}`,
      };
    },
  }),

  def({
    name: 'shell.bg',
    group: 'shell',
    risk: 'exec',
    desc: 'Starta långlivat jobb i bakgrunden och få ett id. Används för servrar, watchers, ghidra-headless, capture.',
    params: { command: 'string: kommando', name: 'string: etikett (valfritt)', cwd: 'string: katalog' },
    async run({ command, name, cwd }, ctx) {
      const id = name || `bg-${Date.now().toString(36)}`;
      const dir = cwd ? path.resolve(String(cwd)) : ctx.cfg.get('workspace') || process.cwd();
      const { cmd, args, env } = build(command, { cwd: dir, env: {} });
      const child = spawn(cmd, args, { cwd: dir, env, windowsHide: true, detached: !WIN });
      const job = { id, command, started: Date.now(), out: [], pid: child.pid, status: 'running', exit: null };
      jobs.set(id, job);
      child.stdout?.on('data', (d) => push(job, String(d)));
      child.stderr?.on('data', (d) => push(job, String(d)));
      child.on('error', (e) => {
        job.status = 'error';
        push(job, `\n${e.message}`);
      });
      child.on('close', (code) => {
        job.status = code === 0 ? 'done' : 'exited';
        job.exit = code;
        ctx.emit?.({ type: 'shell.bg.done', id, code });
      });
      ctx.emit?.({ type: 'shell.bg.start', id, command: command.slice(0, 160), pid: child.pid });
      return { result: `bakgrundsjobb ${id} startat (pid ${child.pid})\n$ ${command}`, meta: { id, pid: child.pid }, summary: `bg ${id} igång` };
    },
  }),

  def({
    name: 'shell.jobs',
    group: 'shell',
    risk: 'read',
    desc: 'Lista bakgrundsjobb + deras senaste output. Används för att följa servrar/captures.',
    params: { id: 'string: filtrera på ett jobb-id', tail: 'number: rader output per jobb (default 30)' },
    async run({ id = '', tail = 30 }) {
      const list = [...jobs.values()].filter((j) => !id || j.id === id);
      if (!list.length) return { result: 'inga bakgrundsjobb', summary: '0 jobb' };
      const out = list
        .map((j) => {
          const secs = Math.round((Date.now() - j.started) / 1000);
          return `${j.id} [${j.status}${j.exit != null ? ` exit ${j.exit}` : ''} · ${secs}s · pid ${j.pid}]\n$ ${j.command}\n${j.out.join('').split('\n').slice(-tail).join('\n')}`;
        })
        .join('\n\n');
      return { result: out, meta: { count: list.length }, summary: `${list.length} jobb` };
    },
  }),

  def({
    name: 'shell.stop',
    group: 'shell',
    risk: 'exec',
    desc: 'Stoppa ett bakgrundsjobb (SIGTERM sedan SIGKILL).',
    params: { id: 'string: jobb-id från shell.bg' },
    async run({ id }) {
      const j = jobs.get(id);
      if (!j) return { ok: false, error: { code: 'no_job', message: `okänt jobb ${id}`, hint: `kända: ${[...jobs.keys()].join(', ') || 'inga'}` } };
      try {
        process.kill(-j.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(j.pid, 'SIGTERM');
        } catch {
          /* redan död */
        }
      }
      setTimeout(() => {
        try {
          process.kill(j.pid, 'SIGKILL');
        } catch {
          /* d */
        }
      }, 1500).unref?.();
      j.status = 'stopped';
      return { result: `stoppade ${id}`, summary: `stop ${id}` };
    },
  }),

  def({
    name: 'shell.env',
    group: 'shell',
    risk: 'read',
    desc: 'Läs miljövariabler och shell-val. Användbart innan du bygger kommandon.',
    params: { name: 'string: en specifik variabel (valfritt)' },
    async run({ name }) {
      if (name) return { result: `${name}=${process.env[name] ?? '(ej satt)'}` };
      const keys = Object.keys(process.env).filter((k) => !/TOKEN|KEY|SECRET|PASSWORD/i.test(k)).sort();
      return { result: `shell: ${shell().cmd}\n${keys.map((k) => `${k}=${String(process.env[k]).slice(0, 120)}`).join('\n')}`, summary: `${keys.length} variabler` };
    },
  }),
];

function push(job, s) {
  job.out.push(s);
  const joined = job.out.join('').length;
  if (joined > 200000) job.out.splice(0, Math.ceil(job.out.length / 2));
}

const bootTime = Date.now();

export { jobs, quotePowerShell, build as shellArgs };
export const IS_WIN = WIN;
export function osName() {
  return WIN ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}
void bus;
