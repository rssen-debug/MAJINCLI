/**
 * "it cannot even search a job" — the owner's report, taken literally.
 *
 * Two separate defects were behind it:
 *
 *  1. The wire path was never tested. `parseHits()` had fixtures, but the actual
 *     fetch never ran against a server in any test, so a broken request or a
 *     changed response shape shipped unnoticed. These tests serve a real
 *     Platsbanken-shaped payload over HTTP and run the real adapter.
 *
 *  2. Job search required a model to choose the tool. When the provider is
 *     rate-limited — which the owner saw repeatedly — nothing happens at all,
 *     not even a plain job search. The host now exposes `POST /api/jobs/search`
 *     that runs the same tool through the same runner with no model in the loop.
 *
 * The LinkedIn case is pinned too: a pasted job URL is not a search phrase, and
 * jobs.search must say so instead of sending the URL to Platsbanken as words.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startTestServer } from './helpers.mjs';
import { parseHits, searchPlatsbanken } from '../../src/core/jobs/platsbanken.js';
import { jobTools } from '../../src/core/tools/jobs.js';

/* A realistic hit, copied field-for-field from the shape documented in the
   adapter's header (observed against the live API 2026-10-18). */
const HIT = {
  id: 1234567,
  webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/1234567',
  headline: 'Webbutvecklare',
  application_deadline: '2026-11-30',
  publication_date: '2026-10-20T00:00:00',
  description: { text: 'Vi söker en webbutvecklare med erfarenhet av JavaScript.' },
  employer: { name: 'Exempelbolaget AB' },
  workplace_address: { municipality: 'Stockholm', city: 'Stockholm', country: 'SE' },
  application_details: { url: 'https://exempelbolaget.se/jobb/ansok' },
  must_have: { skills: [{ label: 'JavaScript' }, { label: 'HTML' }] },
  nice_to_have: { skills: [{ label: 'TypeScript' }] },
  number_of_vacancies: 2,
  experience_required: true,
};

/** A local stand-in for jobsearch.api.jobtechdev.se. */
async function fixtureApi(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    handler(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/search`;
  return { base, seen, close: () => new Promise((r) => server.close(r)) };
}

test('jobs: the real wire path parses a Platsbanken-shaped payload', async () => {
  const api = await fixtureApi((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ total: { value: 1 }, hits: [HIT] }));
  });
  try {
    const r = await searchPlatsbanken({ q: 'webbutvecklare stockholm', limit: 5, baseUrl: api.base });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.total, 1);
    assert.equal(r.jobs.length, 1);
    const [job] = r.jobs;
    assert.equal(job.title, 'Webbutvecklare');
    assert.equal(job.company, 'Exempelbolaget AB');
    assert.equal(job.city, 'Stockholm');
    assert.equal(job.deadline, '2026-11-30');
    assert.equal(job.url, HIT.webpage_url);
    assert.deepEqual(job.mustHave, ['JavaScript', 'HTML']);
    assert.deepEqual(job.niceToHave, ['TypeScript']);
    assert.deepEqual(job.apply, { url: 'https://exempelbolaget.se/jobb/ansok' });
    // The query and limit actually reach the wire, URL-encoded.
    assert.match(api.seen[0], /q=webbutvecklare%20stockholm/);
    assert.match(api.seen[0], /limit=5/);
  } finally {
    await api.close();
  }
});

test('jobs: an HTTP failure is a shaped error, never a thrown exception', async () => {
  const api = await fixtureApi((req, res) => { res.writeHead(503); res.end('nope'); });
  try {
    const r = await searchPlatsbanken({ q: 'x', baseUrl: api.base });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'site_http');
    assert.equal(r.error.status, 503);
  } finally {
    await api.close();
  }
});

test('jobs: an unreachable host is reported as unreachable, not as zero results', async () => {
  // A port that nothing listens on: connection refused, deterministically.
  const r = await searchPlatsbanken({ q: 'x', baseUrl: 'http://127.0.0.1:1/search', timeoutSec: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'site_unreachable');
  assert.match(r.error.message, /could not reach Platsbanken/);
});

test('jobs: a slow host says timeout in the message (the abort reason used to be lost)', async () => {
  const api = await fixtureApi(() => { /* never answers */ });
  try {
    const r = await searchPlatsbanken({ q: 'x', baseUrl: api.base, timeoutSec: 0.2 });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'site_unreachable');
    assert.match(r.error.message, /timeout/);
  } finally {
    await api.close();
  }
});

test('jobs.search refuses a pasted job link instead of searching for the URL as words', async () => {
  const tool = jobTools.find((t) => t.name === 'jobs.search');
  for (const query of [
    'https://www.linkedin.com/jobs/view/4012345678/',
    'http://example.com/job/1',
    'www.linkedin.com/jobs/view/1',
  ]) {
    const r = await tool.run({ query }, {});
    assert.equal(r.ok, false, query);
    assert.equal(r.error.code, 'site_unsupported', query);
    assert.match(r.error.message, /Platsbanken/);
    // The message names the host so the agent knows what it was handed.
    assert.match(r.error.message, /linkedin|example/i, query);
  }
  // …and an empty query is its own honest error, not a silent empty result.
  const empty = await tool.run({ query: '   ' }, {});
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, 'query_required');
});

test('POST /api/jobs/search searches without a model, and it is gated like every write', async () => {
  const api = await fixtureApi((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ total: { value: 1 }, hits: [HIT] }));
  });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-jobs-api-'));
  process.env.MAJIN_HOME = home;
  process.env.MAJIN_PLATSBANKEN_URL = api.base;
  const s = await startTestServer({ home });
  try {
    // No session: refused.
    const anon = await fetch(`${s.base}/api/jobs/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
      body: JSON.stringify({ query: 'webbutvecklare' }),
    });
    assert.equal(anon.status, 401);

    const { cookie } = await s.pair();

    const jobs = (body) => fetch(`${s.base}/api/jobs/search`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
      body: JSON.stringify(body),
    });

    // Before any grant: the panel must say WHICH permission is missing, not
    // "search failed" — otherwise the owner looks in the wrong place.
    const noLane = await jobs({ query: 'webbutvecklare' });
    assert.equal(noLane.status, 503);
    assert.equal((await noLane.json()).error.code, 'LANE_NOT_GRANTED');

    // Grant exactly the lane the panel needs, the way setup does.
    const grant = await fetch(`${s.base}/api/owner-mode`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
      body: JSON.stringify({ action: 'grant', lanes: ['jobs'] }),
    });
    assert.equal(grant.status, 200, await grant.text());

    // A session but no CSRF header: refused.
    const noCsrf = await fetch(`${s.base}/api/jobs/search`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: s.base },
      body: JSON.stringify({ query: 'webbutvecklare' }),
    });
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).error.code, 'CSRF_REQUIRED');

    // The real call. The provider is 'demo' and is never consulted: the model is
    // not in this path at all.
    const res = await jobs({ query: 'webbutvecklare stockholm', limit: 5 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data.error));
    assert.equal(data.applications.length, 1);
    assert.equal(data.applications[0].title, 'Webbutvecklare');
    assert.equal(data.applications[0].company, 'Exempelbolaget AB');
    assert.ok(data.applications[0].fp, 'the pipeline fingerprint comes back for the other jobs.* tools');

    // The result joined the pipeline: a second search reports it as seen.
    const again = await jobs({ query: 'webbutvecklare stockholm', limit: 5 });
    const second = await again.json();
    assert.equal(second.ok, true);
    assert.equal(second.applications.length, 0, 'no duplicate rows for the same job');
    assert.equal(second.seenBefore, 1);

    // A link is refused through HTTP too, with the tool's own message.
    const link = await jobs({ query: 'https://www.linkedin.com/jobs/view/1' });
    const linkBody = await link.json();
    assert.equal(linkBody.ok, false);
    assert.equal(linkBody.error.code, 'site_unsupported');
  } finally {
    await api.close();
    await s.close();
    delete process.env.MAJIN_PLATSBANKEN_URL;
  }
});

/* ---------------------------------------------------------------- the model -- */

/**
 * The end-to-end proof for the owner's report.
 *
 * A scripted model asks for jobs_search, exactly as the real one would. The
 * assertion is on what it receives BACK: before the fix the adapter reduced the
 * tool's structured result to `{result: null, summary: "1 new jobs found"}`, so
 * the model never saw a single title, url or fp — it could not list a job, and
 * it could not call jobs_match because it had no fp. The search "worked" and the
 * answer was still "I could not find any jobs".
 */
test('the model actually receives the job list, not just a summary', async () => {
  const { startFakeProvider, lastToolMessage } = await import('./fake-provider.mjs');
  const { postChat, readSse } = await import('./helpers.mjs');
  const api = await fixtureApi((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ total: { value: 1 }, hits: [HIT] }));
  });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-jobs-model-'));
  process.env.MAJIN_HOME = home;
  process.env.MAJIN_PLATSBANKEN_URL = api.base;

  const provider = await startFakeProvider((body) => {
    const last = lastToolMessage(body);
    if (last) return { text: 'Klart — jag hittade jobbet.' };
    return { toolCalls: [{ name: 'jobs_search', args: { query: 'webbutvecklare stockholm' } }] };
  });
  const s = await startTestServer({
    home,
    env: {
      MAJIN_V4_PROVIDER: 'openai',
      MAJIN_V4_BASE_URL: provider.url,
      MAJIN_V4_API_KEY: 'test-key-not-a-secret',
      MAJIN_V4_MODEL: 'scripted-model',
      MAJIN_V4_MAX_VISIBLE_TOOLS: '64',
      MAJIN_V4_MAX_TOOL_CALLS: '8',
      MAJIN_V4_MAX_MODEL_ROUNDS: '6',
      MAJIN_V4_RATE_REQUESTS: '1000',
      MAJIN_V4_RATE_TURNS: '1000',
    },
  });
  try {
    const { cookie } = await s.pair();
    const grant = await fetch(`${s.base}/api/owner-mode`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
      body: JSON.stringify({ action: 'grant', lanes: ['jobs'] }),
    });
    assert.equal(grant.status, 200, await grant.text());

    const events = await readSse(await postChat(s.base, cookie, {
      text: 'sök jobbet till mig',
      requestId: 'jobs-model-1',
    }));
    const results = events.filter((e) => e.type === 'tool_result').map((e) => e.data);
    const jobResult = results.find((r) => r.name === 'jobs_search');
    assert.ok(jobResult, `jobs_search never ran: ${JSON.stringify(results)}`);

    assert.equal(jobResult.ok, true, JSON.stringify(jobResult));

    /* The assertion that matters: the request the model receives after the tool
       ran. Before the fix this content was {"result":null,"summary":"1 new jobs
       found"} — the search had run and the model had nothing to report. */
    const afterTool = provider.requests
      .map((b) => lastToolMessage(b))
      .filter(Boolean)
      .map((m) => JSON.stringify(m))
      .join('\n');
    assert.ok(afterTool.length > 0, 'the model was never handed the tool result');
    assert.match(afterTool, /Webbutvecklare/, `the model never saw the job title: ${afterTool.slice(0, 400)}`);
    assert.match(afterTool, /Exempelbolaget AB/, 'the model never saw the company');
    assert.match(afterTool, /arbetsformedlingen\.se/, 'the model never saw the ad url');
    assert.match(afterTool, /\"fp\"/, 'the model never got the fp it needs for jobs.match');
  } finally {
    await api.close();
    await s.close();
    await provider.close();
    delete process.env.MAJIN_PLATSBANKEN_URL;
  }
});
