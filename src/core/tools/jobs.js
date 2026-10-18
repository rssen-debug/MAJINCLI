/**
 * MAJIN — jobs. The job-search agent as tools (the skills layer composes;
 * these are the primitives):
 *   jobs.search  → find candidates (Platsbanken), dedupe against the pipeline
 *   jobs.match   → score found jobs against the CV, promote winners to matched
 *   jobs.cv.set/show → the CV in plain text
 *   jobs.list    → the pipeline, grouped by status
 *   jobs.start / jobs.skip → the user's own moves on an application
 * Submission (form-fill + proof) is the NEXT slice and will be approval-gated
 * by design — this slice inlines a refusal instead of half-a-submit.
 */
import { def } from './registry.js';
import { resolveIn } from './files.js';
import fs from 'node:fs';
import { searchPlatsbanken } from '../jobs/platsbanken.js';
import { createApplication, transition, scoreCv, cvSkills } from '../jobs/model.js';
import { loadCv, saveCv, loadApplications, saveApplications, upsertApplication } from '../jobs/store.js';

const pick = (apps, fp) => {
  const app = apps[fp];
  if (!app) {
    const near = Object.values(apps).filter((a) => JSON.stringify(a).toLowerCase().includes(String(fp).toLowerCase()))[0];
    const err = new Error(near ? `no application ${fp} — did you mean ${near.fp} (${near.title} @ ${near.company})?` : `no application ${fp} — run jobs.list to see the pipeline`);
    err.code = 'no_such_application';
    throw err;
  }
  return app;
};

export const jobTools = [
  def({
    name: 'jobs.search',
    group: 'jobs',
    desc: 'Search job sites (Platsbanken/SE for now) for candidates. NEW jobs enter the pipeline as "found" — already-seen jobs are counted, not re-shown. Returns titles/companies/deadlines/URLs + the fp you need for the other jobs.* tools.',
    risk: 'read',
    params: {
      query: 'string: search words, e.g. "webbutvecklare stockholm" or "python"',
      limit: 'number: max results (default 8, max 25, optional)',
      includeSeen: 'boolean: also list jobs already in the pipeline (default false, optional)',
    },
    required: ['query'],
    run: async ({ query, limit = 8, includeSeen = false }) => {
      const r = await searchPlatsbanken({ q: query, limit: Math.min(25, Math.max(1, limit)) });
      if (!r.ok) return { ok: false, error: r.error };
      const apps = await loadApplications();
      const fresh = [];
      let seen = 0;
      for (const job of r.jobs) {
        const app = createApplication(job);
        if (apps[app.fp]) {
          seen += 1;
          if (includeSeen) fresh.push({ ...apps[app.fp], alreadySeen: true });
          continue;
        }
        apps[app.fp] = app;
        fresh.push(app);
      }
      await saveApplications(apps);
      return {
        ok: true,
        total: fresh.length,
        seenBefore: seen,
        applications: fresh.map((a) => ({ fp: a.fp, title: a.title, company: a.company, city: a.city, deadline: a.deadline, url: a.url, apply: a.apply, alreadySeen: a.alreadySeen || undefined })),
        summary: `${fresh.filter((a) => !a.alreadySeen).length} new jobs found (${seen} seen before, hidden${includeSeen ? ' — includeSeen was on' : ''})`,
      };
    },
  }),

  def({
    name: 'jobs.match',
    group: 'jobs',
    desc: 'Score every pipeline application with status "found" against the saved CV; those at/above minScore move to "matched" with the match report attached as evidence. Needs a CV (jobs.cv.set first).',
    risk: 'read',
    params: {
      minScore: 'number: 0..1 where at/above counts as matched (default 0.4, optional)',
    },
    run: async ({ minScore = 0.4 }) => {
      const cv = await loadCv();
      if (!cv) return { ok: false, error: { code: 'no_cv', message: 'there is no CV saved yet', hint: 'save one first: jobs.cv.set with your CV text or {file: "cv.txt"}' } };
      const apps = await loadApplications();
      const fresh = Object.values(apps).filter((a) => a.status === 'found');
      if (!fresh.length) return { ok: true, matched: [], below: 0, summary: 'nothing new to score — run jobs.search first' };
      const matched = [];
      let below = 0;
      for (const app of fresh) {
        const report = scoreCv(cv.text, { title: app.title, description: app.description || '', mustHave: app.mustHave, niceToHave: app.niceToHave });
        app.score = report.score;
        if (report.score != null && report.score >= minScore) {
          transition(app, 'matched', { by: 'cv-match', evidence: report });
          matched.push({ fp: app.fp, title: app.title, company: app.company, score: report.score, matched: report.matched, missing: report.missing, apply: app.apply });
          await upsertApplication(app);
        } else {
          below += 1;
          await upsertApplication(app);
        }
      }
      return { ok: true, matched, below, minScore, summary: matched.length ? `${matched.length} job(s) matched your CV (checked ${fresh.length}, minScore ${minScore})` : `no job reached ${minScore} (checked ${fresh.length})` };
    },
  }),

  def({
    name: 'jobs.list',
    group: 'jobs',
    desc: 'Show the application pipeline grouped by status (found/matched/started/waiting/submitted/failed/skipped) with counts — your proof that each submission happened lives in each entry\'s history.',
    risk: 'read',
    params: { status: 'string: only this status [found|matched|started|waiting|submitted|failed|skipped] (optional)' },
    run: async ({ status = '' }) => {
      const apps = await loadApplications();
      const all = Object.values(apps).sort((a, b) => b.updatedAt - a.updatedAt);
      const counts = {};
      for (const a of all) counts[a.status] = (counts[a.status] || 0) + 1;
      const rows = all
        .filter((a) => !status || a.status === status)
        .slice(0, 40)
        .map((a) => `${a.fp} [${a.status}${a.score != null ? ` ${a.score}` : ''}] ${a.title} · ${a.company}${a.city ? ` · ${a.city}` : ''}${a.deadline ? ` · deadline ${String(a.deadline).slice(0, 10)}` : ''}`)
        .join('\n');
      return { ok: true, counts, applications: rows || '(empty)', summary: Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ') || 'no applications yet — run jobs.search' };
    },
  }),

  def({
    name: 'jobs.start',
    group: 'jobs',
    desc: 'Mark an application as started (you — or a follow-up task — are working on it). fp comes from jobs.search / jobs.list.',
    risk: 'write',
    params: {
      fp: 'string: the application fingerprint from jobs.search or jobs.list',
      note: 'string: what is happening, e.g. "cover letter drafted" (optional)',
    },
    required: ['fp'],
    run: async ({ fp, note = '' }) => {
      const apps = await loadApplications();
      const app = pick(apps, fp);
      transition(app, 'started', { by: 'user', evidence: note ? { note } : null });
      await upsertApplication(app);
      return { ok: true, fp: app.fp, status: app.status };
    },
  }),

  def({
    name: 'jobs.skip',
    group: 'jobs',
    desc: 'Mark an application as skipped (you decided not to pursue it). Skipped jobs never reappear in searches.',
    risk: 'write',
    params: {
      fp: 'string: the application fingerprint from jobs.search or jobs.list',
      why: 'string: one honest line why, for your own memory (optional)',
    },
    required: ['fp'],
    run: async ({ fp, why = '' }) => {
      const apps = await loadApplications();
      const app = pick(apps, fp);
      transition(app, 'skipped', { by: 'user', evidence: why ? { note: why } : null });
      await upsertApplication(app);
      return { ok: true, fp: app.fp, status: app.status };
    },
  }),

  def({
    name: 'jobs.cv.set',
    group: 'jobs',
    desc: 'Save your CV (plain text) so jobs.match can score jobs against it. Give the text directly or a workspace file ({file: "cv.txt"}). Stored inside MAJIN_HOME — never uploaded anywhere.',
    risk: 'write',
    params: {
      text: 'string: the CV as plain text (optional)',
      file: 'string: workspace file containing the CV (optional)',
    },
    run: async ({ text = '', file = '' }, ctx) => {
      let body = String(text || '');
      if (!body && file) {
        body = fs.readFileSync(resolveIn(ctx, file), 'utf8');
      }
      if (!body.trim()) return { ok: false, error: { code: 'empty_cv', message: 'the CV is empty', hint: 'pass {text: "..."} or {file: "cv.txt"}' } };
      const meta = await saveCv(body);
      return { ok: true, chars: meta.chars, skills: cvSkills(body), summary: `CV saved (${meta.chars} chars, ${cvSkills(body).length} skills recognized)` };
    },
  }),

  def({
    name: 'jobs.cv.show',
    group: 'jobs',
    desc: 'Show the saved CV summary: length, recognized skills, when it was saved. (The full text is yours — ask and it answers with the whole thing.)',
    risk: 'read',
    params: { full: 'boolean: return the entire CV text (default false, optional)' },
    run: async ({ full = false }) => {
      const cv = await loadCv();
      if (!cv) return { ok: false, error: { code: 'no_cv', message: 'there is no CV saved yet', hint: 'jobs.cv.set with your CV text or {file: "cv.txt"}' } };
      return {
        ok: true,
        chars: cv.text.length,
        updatedAt: cv.updatedAt,
        skills: cvSkills(cv.text),
        text: full ? cv.text.slice(0, 12000) : undefined,
        summary: `CV: ${cv.text.length} chars, ${cvSkills(cv.text).length} skills recognized`,
      };
    },
  }),
];
