/**
 * MAJIN — job-search persistence. Everything under <MAJIN_HOME>/jobs/:
 *   cv.txt            the user's CV (plain text — the matcher reads words)
 *   applications.json { fp → application }  — fp = the dedupe key, so the
 *                     dedupe memory and the pipeline are the same file:
 *                     a job seen once is never shown twice unless asked for.
 * Writes are tmp-then-rename, reads treat a missing/corrupt file as empty —
 * a torn store must never cost the user their pipeline.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../paths.js';

export function jobsDir() {
  return path.join(dataDir(), 'jobs');
}

async function writeAtomic(abs, data) {
  const tmp = `${abs}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, abs);
}

async function readJson(abs, fallback) {
  try {
    return JSON.parse(await fsp.readFile(abs, 'utf8'));
  } catch {
    return fallback; // missing OR corrupt behaves like empty — never like fatal
  }
}

export const cvPath = () => path.join(jobsDir(), 'cv.txt');
export const appsPath = () => path.join(jobsDir(), 'applications.json');

export async function loadCv() {
  try {
    const text = await fsp.readFile(cvPath(), 'utf8');
    const stat = await fsp.stat(cvPath());
    return { text, updatedAt: stat.mtimeMs };
  } catch {
    return null;
  }
}

export async function saveCv(text) {
  await fsp.mkdir(jobsDir(), { recursive: true });
  await writeAtomic(cvPath(), String(text));
  const stat = await fsp.stat(cvPath());
  return { chars: String(text).length, updatedAt: stat.mtimeMs };
}

export async function loadApplications() {
  return readJson(appsPath(), {});
}

export async function saveApplications(apps) {
  await fsp.mkdir(jobsDir(), { recursive: true });
  await writeAtomic(appsPath(), JSON.stringify(apps, null, 1));
  return Object.keys(apps).length;
}

/** Upsert without a read-modify-write race *inside this module*: callers are
    tools, and tool execution is already serialized per session; cross-task
    collisions are on the roadmap as a named lock (TODO browser-context note
    covers the pattern). */
export async function upsertApplication(app) {
  const apps = await loadApplications();
  const existed = Boolean(apps[app.fp]);
  apps[app.fp] = app;
  await saveApplications(apps);
  return { existed, app };
}

/** Test + doctor helper: wipe every job file. fs sync on purpose (tests). */
export function _resetJobsFiles(target = jobsDir()) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* gone */ }
}
