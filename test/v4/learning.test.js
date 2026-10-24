/**
 * Learned operational skills — the A–H acceptance, executed.
 *
 * The requirement: teach MAJIN by giving goals, never by writing a new master
 * prompt. That is only true if a verified execution becomes a reusable
 * procedure and an unverified one never does. Every test here drives the real
 * chain: a scripted OpenAI-compatible provider → the real V4 server → the real
 * registry, goal, verifier and skill store.
 *
 * The A–H flow from the brief:
 *   A  an unfamiliar safe task fails
 *   B  MAJIN diagnoses the failure and changes strategy
 *   C  a later attempt succeeds and is independently verified
 *   D  MAJIN saves the resulting skill
 *   E  the host restarts
 *   F  a related but changed task arrives
 *   G  the saved skill is retrieved and adapted
 *   H  the failed strategy is not blindly repeated
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { startTestServer, postChat, readSse, tempHome } from './helpers.mjs';
import { startFakeProvider, lastToolMessage, offeredTools } from './fake-provider.mjs';
import {
  LEARNING_SCHEMA, SKILL_STATES, confidenceOf, diagnoseTrace, environmentFingerprint,
  extractCandidate, goalKeywords, promote, rankSkills, sanitizeInstruction, scenarioSignature, taskSignature,
} from '../../src/v4/learning.js';

const isChild = (body) => (body.messages || [])
  .some((m) => m.role === 'system' && /MAJIN subagent/.test(String(m.content)));

const env = (provider) => ({
  MAJIN_V4_PROVIDER: 'openai',
  MAJIN_V4_BASE_URL: provider.url,
  MAJIN_V4_API_KEY: 'test-key-not-a-secret',
  MAJIN_V4_MODEL: 'scripted-model',
  MAJIN_V4_MAX_VISIBLE_TOOLS: '40',
  MAJIN_V4_MAX_TOOL_CALLS: '12',
  MAJIN_V4_MAX_MODEL_ROUNDS: '8',
  MAJIN_V4_RATE_REQUESTS: '1000',
  MAJIN_V4_RATE_TURNS: '1000',
});

function grantLanes(home, lanes) {
  fs.mkdirSync(path.join(home, 'v4'), { recursive: true });
  fs.writeFileSync(path.join(home, 'v4', 'owner-mode.json'), JSON.stringify({
    schema: 'majin.v4.owner-mode/v1',
    version: 1,
    lanes,
    folders: [],
    grantedAt: new Date().toISOString(),
    revokedAt: null,
    history: [],
  }));
}

/* ---------------------------------------------------- unit: the guarantees -- */

test('learning: sanitising removes secrets, personal paths and brittle selectors', () => {
  const dirty = 'Använd sk-abc123456789XYZ och ghp_abcdefghijklmnopqrstuvwxyz0123, '
    + 'Bearer abcdefghijklmnop123456, filen C:\\Users\\anders\\Documents\\cv.pdf, '
    + 'maila anders@example.com, klicka #submit .btn.primary > div:nth-child(2) '
    + 'eller form#login input[name="user"]';
  const { text, redactions } = sanitizeInstruction(dirty);
  assert.ok(!text.includes('sk-abc'), 'provider key survived');
  assert.ok(!text.includes('ghp_'), 'github token survived');
  assert.ok(!text.includes('Bearer abc'), 'bearer token survived');
  assert.ok(!text.includes('anders'), 'personal path or e-mail survived');
  assert.ok(!text.includes('cv.pdf'), 'personal file name survived');
  assert.ok(!text.includes('nth-child'), 'a brittle selector survived');
  assert.ok(!text.includes('#submit'), 'a brittle selector survived');
  assert.ok(redactions.includes('secret'));
  assert.ok(redactions.includes('personal-path'));
  assert.ok(redactions.includes('selector'));
});

test('learning: keywords, signatures and fingerprints are stable and useful', () => {
  assert.deepEqual(goalKeywords('Hitta mitt CV och läs det'), ['hitta', 'cv', 'läs']);
  // Identity is the procedure (tool path); the scenario is the topic.
  const a = taskSignature({ goalText: 'Hitta mitt CV och läs det', tools: ['fs_find', 'fs_read'] });
  const b = taskSignature({ goalText: 'hitta CV:t och läs igenom det', tools: ['fs_find', 'fs_read'] });
  const c = taskSignature({ goalText: 'Skriv en rapport', tools: ['workspace_write'] });
  assert.equal(a, b, 'the same procedure must share a signature');
  assert.notEqual(a, c, 'a different procedure must not share a signature');
  assert.equal(
    scenarioSignature('Hitta mitt CV och läs det'),
    scenarioSignature('hitta cv:t och läs igenom det'),
    'the same topic must share a scenario',
  );

  const fp1 = environmentFingerprint({ platform: 'win32', arch: 'x64', node: '22.1.0', lanes: ['files'], tools: ['fs_read'] });
  const fp2 = environmentFingerprint({ platform: 'win32', arch: 'x64', node: '22.9.0', lanes: ['files'], tools: ['fs_read'] });
  const fp3 = environmentFingerprint({ platform: 'linux', arch: 'x64', node: '22.1.0', lanes: ['files'], tools: ['fs_read'] });
  assert.equal(fp1, fp2, 'a patch Node upgrade is not a different environment');
  assert.notEqual(fp1, fp3, 'a different platform is a different environment');
});

test('learning: nothing is extracted from an unverified or failed turn', () => {
  const base = {
    id: 'goal_x',
    objective: 'Skriv en fil',
    state: 'COMPLETED',
    receipts: [],
  };
  const trace = [{ name: 'workspace_write', argsShape: 'content,fileName', ok: true, verified: true }];

  // No verified receipt: a model's claim is not evidence.
  const withoutReceipt = extractCandidate({ goal: base, trace });
  assert.equal(withoutReceipt.ok, false);
  assert.match(withoutReceipt.reason, /verified/i);

  // Not completed.
  const notDone = extractCandidate({
    goal: { ...base, state: 'FAILED', receipts: [{ id: 'r1', verified: true, result: 'success' }] },
    trace,
  });
  assert.equal(notDone.ok, false);
  assert.match(notDone.reason, /COMPLETED/);

  // No tools used: nothing to learn.
  const noTools = extractCandidate({
    goal: { ...base, receipts: [{ id: 'r1', verified: true, result: 'success' }] },
    trace: [],
  });
  assert.equal(noTools.ok, false);
});

test('learning: an extracted procedure stores argument names, never values', () => {
  const goal = {
    id: 'goal_y',
    objective: 'Hitta mitt CV i Documents och läs det',
    state: 'COMPLETED',
    receipts: [{
      id: 'r1', action: 'tool:fs_read', target: 'cv.pdf', result: 'success', verified: true,
      evidence: { verifier: 'v2.file', sha256: 'abc' },
    }],
  };
  const trace = [
    { name: 'fs_find', argsShape: 'name,path', ok: false, cls: 'PERMISSION_DENIED' },
    { name: 'fs_find', argsShape: 'name,path', ok: true },
    { name: 'fs_read', argsShape: 'path', ok: true, verified: true },
  ];
  const out = extractCandidate({
    goal, trace, grantedLanes: ['files'], fingerprint: 'fp1',
  });
  assert.equal(out.ok, true, out.reason);
  const skill = out.candidate;
  const serialised = JSON.stringify(skill);
  assert.ok(!serialised.includes('C:\\'), 'an absolute path leaked into the skill');
  assert.ok(!serialised.includes('cv.pdf'), 'a personal file name leaked into the skill');
  assert.match(skill.learned.procedure.join(' '), /fs_find with name,path/, 'the procedure must name the arguments');
  assert.equal(skill.learned.state, SKILL_STATES.EXPERIMENTAL);
  assert.ok(skill.learned.avoid.some((a) => a.failedWith === 'PERMISSION_DENIED'), 'the failed strategy was not recorded');
  assert.ok(skill.learned.evidence.length >= 1);
});

test('learning: promotion follows evidence, and confidence is smoothed', () => {
  assert.equal(promote({ state: SKILL_STATES.EXPERIMENTAL, successes: 1, failures: 0, scenarios: ['a'] }), SKILL_STATES.EXPERIMENTAL);
  assert.equal(promote({ state: SKILL_STATES.EXPERIMENTAL, successes: 2, failures: 0, scenarios: ['a'] }), SKILL_STATES.VERIFIED);
  assert.equal(promote({ state: SKILL_STATES.VERIFIED, successes: 3, failures: 0, scenarios: ['a'] }), SKILL_STATES.VERIFIED);
  assert.equal(promote({ state: SKILL_STATES.VERIFIED, successes: 3, failures: 0, scenarios: ['a', 'b'] }), SKILL_STATES.REUSABLE);
  assert.equal(promote({ state: SKILL_STATES.REUSABLE, successes: 3, failures: 5, scenarios: ['a', 'b'] }), SKILL_STATES.FAILED);

  const one = confidenceOf({ successes: 1, failures: 0, scenarios: ['a'] });
  const many = confidenceOf({ successes: 6, failures: 0, scenarios: ['a', 'b', 'c'] });
  assert.ok(one < 0.6, `one success must not look certain (${one})`);
  assert.ok(many > one, 'more verified scenarios must raise confidence');
});

test('learning: diagnosing a trace separates transient failures from abandoned strategy', () => {
  const trace = [
    { name: 'web_fetch', argsShape: 'url', ok: false, cls: 'TIMEOUT' },
    { name: 'fs_find', argsShape: 'name,path', ok: false, cls: 'PERMISSION_DENIED' },
    { name: 'fs_read', argsShape: 'path', ok: true },
  ];
  const d = diagnoseTrace(trace);
  assert.equal(d.failures.length, 2);
  assert.equal(d.transientFailures.length, 1, 'a timeout is transient');
  assert.ok(d.replaced.every((f) => f.cls !== 'TIMEOUT'), 'a timeout must not become a permanent "avoid"');
  assert.ok(d.replaced.some((f) => f.name === 'fs_find'));
});

test('learning: retrieval matches a related goal, not only an identical one', () => {
  const make = (name, keywords, state, confidence) => ({
    name,
    title: name,
    summary: '',
    body: '',
    learned: { keywords, categories: ['files'], state, confidence, avoid: [] },
  });
  const skills = [
    make('learn-files-aaa', ['cv', 'hitta', 'dokument'], SKILL_STATES.VERIFIED, 0.8),
    make('learn-web-bbb', ['web', 'sök', 'pris'], SKILL_STATES.VERIFIED, 0.8),
    make('learn-files-ccc', ['cv', 'hitta', 'dokument'], SKILL_STATES.FAILED, 0.2),
  ];
  const ranked = rankSkills(skills, { goalText: 'Hitta ett dokument som liknar mitt CV' });
  assert.equal(ranked[0].name, 'learn-files-aaa');
  assert.ok(!ranked.some((s) => s.name === 'learn-web-bbb'), 'an unrelated skill was retrieved');
  assert.ok(!ranked.some((s) => s.name === 'learn-files-ccc'), 'a FAILED skill was offered');
});

/* ------------------------------------------------- A–H, end to end -- */

test('learning A–H: fail, adapt, verify, store, restart, retrieve, avoid repeating', async () => {
  const home = tempHome();
  const documents = path.join(home, 'Documents');
  fs.mkdirSync(documents, { recursive: true });
  // The note lives OUTSIDE the workspace, in a folder the owner granted. That
  // is what makes the obvious first idea fail and a real search necessary.
  fs.writeFileSync(path.join(documents, 'anteckning.txt'), 'INNEHÅLL FRÅN FILEN');
  grantLanes(home, ['files']);
  const ownerFile = path.join(home, 'v4', 'owner-mode.json');
  const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  owner.folders = [documents];
  fs.writeFileSync(ownerFile, JSON.stringify(owner));

  let parentRound = -1;
  const provider = await startFakeProvider((body) => {
    if (isChild(body)) return { text: 'delresultat' };
    parentRound += 1;
    const last = lastToolMessage(body);

    // A: the obvious idea — read it from the workspace by name. It fails,
    // because the file was never in the sandbox.
    if (parentRound === 0) {
      return { toolCalls: [{ name: 'workspace_read', args: { fileName: 'anteckning.txt' } }] };
    }
    // B: diagnose and change strategy — search the granted folder by name.
    if (parentRound === 1) {
      assert.equal(last?.ok, false, 'A: the first strategy was supposed to fail');
      return { toolCalls: [{ name: 'fs_find', args: { path: documents, name: 'anteckning' } }] };
    }
    // C: the changed strategy succeeds, then the file is read and verified.
    if (parentRound === 2) {
      assert.equal(last?.ok, true, `B: fs_find failed: ${JSON.stringify(last)}`);
      const hit = last?.data?.meta?.hits?.[0]?.path;
      assert.ok(hit, 'fs_find returned no hit');
      return { toolCalls: [{ name: 'fs_read', args: { path: hit } }] };
    }
    if (parentRound === 3) {
      assert.match(String(last?.data?.result || ''), /INNEHÅLL FRÅN FILEN/, 'C: the file was not read');
      return { text: 'KLART: jag hittade filen genom att söka i den godkända mappen och läste den.' };
    }
    return { text: 'ok' };
  });

  let s = null;
  let after = null;
  let learnedName = null;
  try {
    s = await startTestServer({ home, env: env(provider) });
    const { cookie } = await s.pair();
    const events = await readSse(await postChat(s.base, cookie, {
      text: 'Hitta anteckningen om projektet i min mapp och läs den.',
      requestId: 'learn-1',
    }));

    // A/B/C: the turn completed, with the failure and the adaptation visible.
    const done = events.find((e) => e.type === 'done')?.data;
    assert.equal(done?.status, 'completed', `turn failed: ${JSON.stringify(events.filter((e) => e.type === 'error'))}`);
    const results = events.filter((e) => e.type === 'tool_result').map((e) => e.data);
    assert.ok(results.some((r) => r.name === 'workspace_read' && r.ok === false), 'A: no failed first attempt recorded');
    assert.ok(results.some((r) => r.name === 'fs_find' && r.ok === true), 'B: the changed strategy did not run');
    assert.ok(results.some((r) => r.name === 'fs_read' && r.ok === true), 'C: the read did not succeed');

    // D: MAJIN saved the resulting skill.
    assert.ok(done.learned, 'D: the turn reported no learned skill');
    learnedName = done.learned.name;

    const dir = path.join(home, 'v4', 'learned-skills', learnedName);
    assert.ok(fs.existsSync(path.join(dir, 'skill.json')), 'D: no skill.json on disk');
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), 'D: no SKILL.md on disk');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'skill.json'), 'utf8'));
    assert.equal(manifest.learned.schema, LEARNING_SCHEMA);
    assert.equal(manifest.learned.state, SKILL_STATES.EXPERIMENTAL);
    assert.deepEqual(manifest.requires, ['files']);
    assert.ok(manifest.tools.includes('fs_find') && manifest.tools.includes('fs_read'));
    assert.ok(manifest.learned.avoid.some((a) => a.action.startsWith('workspace_read')),
      'D: the failed strategy was not stored as a thing to avoid');
    assert.ok(manifest.learned.evidence.length >= 1, 'D: no evidence references');
    assert.ok(manifest.learned.verification?.method, 'D: no verification method');
    const text = fs.readFileSync(path.join(dir, 'skill.json'), 'utf8');
    assert.ok(!text.includes('INNEHÅLL FRÅN FILEN'), 'a file value leaked into the skill');
    assert.ok(!text.includes(home), 'an absolute host path leaked into the skill');

    // E: the host restarts (same data dir, new process). `keep` is what makes
    // it a restart rather than a fresh install.
    await s.close({ keep: true });
    s = null;

    after = await startTestServer({ home, env: env(provider) });
    const session = after.existingSession();
    const listed = await (await fetch(`${after.base}/api/learning`, { headers: { session: undefined, cookie: session } })).json();
    assert.ok(listed.skills.some((x) => x.name === learnedName), 'E: the learned skill did not survive the restart');

    // F: a related but changed task.
    parentRound = -1;
    const promptBefore = provider.requests.length;
    const events2 = await readSse(await postChat(after.base, session, {
      text: 'Läs den anteckning som ligger i mappen också.',
      requestId: 'learn-2',
    }));

    // G: the saved skill was retrieved into the prompt.
    const systemText = provider.requests.slice(promptBefore)
      .map((r) => (r.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n'))
      .join('\n');
    assert.match(systemText, /Skills learned from verified work/, 'G: learned skills never reached the prompt');
    assert.ok(systemText.includes(learnedName), 'G: the specific learned skill was not offered');

    const done2 = events2.find((e) => e.type === 'done')?.data;
    assert.equal(done2?.status, 'completed', JSON.stringify(events2.filter((e) => e.type === 'error')));
    const results2 = events2.filter((e) => e.type === 'tool_result').map((e) => e.data);

    // H: the failed strategy was not executed again. A refused attempt is the
    // guard working, not a repeat; only a real execution would be a regression.
    const repeated = results2.filter((r) => r.name === 'workspace_read'
      && r.summary !== 'LEARNED_AVOID' && r.ok === true);
    assert.deepEqual(repeated, [], `H: the strategy that already failed was executed again: ${JSON.stringify(repeated)}`);
    const refusal = results2.find((r) => r.name === 'workspace_read' && r.summary === 'LEARNED_AVOID');
    const avoidedEvent = events2.find((e) => e.type === 'learning' && e.data?.event === 'avoided');
    assert.ok(refusal || avoidedEvent,
      `H: nothing showed that the failed strategy was recognised and avoided: ${JSON.stringify(results2.map((r) => [r.name, r.ok, r.summary]))}`);
    assert.ok(results2.some((r) => r.name === 'fs_find'), 'G: the learned procedure was not followed');
  } finally {
    if (s) await s.close();
    if (after) await after.close();
    await provider.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ the guard --- */

test('learning: a recorded failed strategy is refused, not executed again', async () => {
  const home = tempHome();
  const workspace = path.join(home, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'data.txt'), 'x');
  // A granted folder is what activates the files lane; without one the skill
  // would (correctly) never be offered, and the guard could not be tested.
  const granted = path.join(home, 'Documents');
  fs.mkdirSync(granted, { recursive: true });
  grantLanes(home, ['files']);
  const ownerFile = path.join(home, 'v4', 'owner-mode.json');
  const ownerState = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  ownerState.folders = [granted];
  fs.writeFileSync(ownerFile, JSON.stringify(ownerState));

  // Seed one learned skill whose `avoid` names the exact action.
  const learnedDir = path.join(home, 'v4', 'learned-skills', 'learn-files-seeded');
  fs.mkdirSync(learnedDir, { recursive: true });
  fs.writeFileSync(path.join(learnedDir, 'skill.json'), JSON.stringify({
    schema: 'majin.v4.skill/v1',
    name: 'learn-files-seeded',
    title: 'Hitta och läs en anteckning',
    summary: 'Sök i den godkända mappen och läs filen.',
    requires: ['files'],
    tools: ['fs_find', 'fs_read'],
    prefers: [],
    experimental: false,
    learned: {
      schema: LEARNING_SCHEMA,
      state: SKILL_STATES.VERIFIED,
      category: 'files',
      categories: ['files'],
      keywords: ['hitta', 'anteckning', 'läsa'],
      procedure: ['Call fs_find with name,path.', 'Call fs_read with path.'],
      avoid: [{ action: 'fs_grep(path,pattern)', failedWith: 'PERMISSION_DENIED', why: 'it failed in the verified run' }],
      verification: { method: 'V2 file verifier', evidence: [] },
      environment: { fingerprint: 'seeded' },
      confidence: 0.8,
      successes: 2,
      failures: 0,
      scenarios: ['a'],
      lastValidatedAt: new Date().toISOString(),
    },
  }, null, 2));
  fs.writeFileSync(path.join(learnedDir, 'SKILL.md'), '# procedure\ntext\n');

  let parentRound = -1;
  const provider = await startFakeProvider((body) => {
    if (isChild(body)) return { text: 'x' };
    parentRound += 1;
    const last = lastToolMessage(body);
    if (parentRound === 0) {
      return { toolCalls: [{ name: 'fs_grep', args: { path: workspace, pattern: 'x' } }] };
    }
    if (parentRound === 1) {
      assert.equal(last?.ok, false);
      assert.match(String(last?.error || ''), /not repeated/i, `the guard did not explain itself: ${JSON.stringify(last)}`);
      return { text: 'Jag undviker den metoden och väljer en annan.' };
    }
    return { text: 'ok' };
  });

  const s = await startTestServer({ home, env: env(provider) });
  try {
    const { cookie } = await s.pair();
    const events = await readSse(await postChat(s.base, cookie, {
      text: 'Hitta anteckningen och läs den.',
      requestId: 'guard-1',
    }));
    const guard = events.find((e) => e.type === 'learning');
    assert.ok(guard, 'no learning event was emitted for the refused action');
    assert.equal(guard.data.event, 'avoided');

    const result = events.find((e) => e.type === 'tool_result' && e.data?.name === 'fs_grep')?.data;
    assert.equal(result?.ok, false);
    assert.match(String(result?.error || ''), /not repeated/i);
    // It was refused locally: the tool never ran, so it cannot have produced output.
    assert.equal(result?.verified, false);
  } finally {
    await s.close();
    await provider.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/* ------------------------------------------------- lifecycle and staleness -- */

test('learning: a changed environment marks a skill STALE, not trusted', async () => {
  const home = tempHome();
  grantLanes(home, ['files']);
  const learnedDir = path.join(home, 'v4', 'learned-skills', 'learn-files-old');
  fs.mkdirSync(learnedDir, { recursive: true });
  fs.writeFileSync(path.join(learnedDir, 'skill.json'), JSON.stringify({
    schema: 'majin.v4.skill/v1',
    name: 'learn-files-old',
    title: 'Gammal miljö',
    summary: '',
    requires: [],
    tools: [],
    prefers: [],
    experimental: false,
    learned: {
      schema: LEARNING_SCHEMA,
      state: SKILL_STATES.VERIFIED,
      category: 'files',
      categories: ['files'],
      keywords: ['fil'],
      procedure: ['Call fs_read with path.'],
      avoid: [],
      environment: { fingerprint: 'a-very-old-fingerprint' },
      confidence: 0.9,
      successes: 4,
      failures: 0,
      scenarios: ['a', 'b'],
      lastValidatedAt: new Date().toISOString(),
    },
  }, null, 2));
  fs.writeFileSync(path.join(learnedDir, 'SKILL.md'), '# gammal\n');

  const provider = await startFakeProvider({ text: 'ok' });
  const s = await startTestServer({ home, env: env(provider) });
  try {
    const { cookie } = await s.pair();
    await (await fetch(`${s.base}/api/learning?revalidate=1`, { headers: { cookie } })).json();
    const body = await (await fetch(`${s.base}/api/learning`, { headers: { cookie } })).json();
    const skill = body.skills.find((x) => x.name === 'learn-files-old');
    assert.ok(skill, 'the skill disappeared instead of going stale');
    assert.equal(skill.state, SKILL_STATES.STALE);

    // Still readable, so a human sees what was learned — the prompt marks it STALE.
    const prompt = await import('../../src/v4/learning.js').then((m) => m.renderLearned([
      { ...JSON.parse(fs.readFileSync(path.join(learnedDir, 'skill.json'), 'utf8')), body: 'x', dir: learnedDir },
    ]));
    assert.match(prompt, /STALE/);
    assert.match(prompt, /[Rr]evalidate/);
  } finally {
    await s.close();
    await provider.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('learning: a learned skill cannot require a lane the owner never granted', async () => {
  const home = tempHome();
  // Only the workspace + files are granted; the skill's tools are workspace-only.
  const provider = await startFakeProvider((body) => {
    if (isChild(body)) return { text: 'x' };
    const last = lastToolMessage(body);
    if (!last) return { toolCalls: [{ name: 'workspace_write', args: { fileName: 'bevis.txt', content: 'x' } }] };
    return { text: 'klart' };
  });
  // No lane is granted at all: the workspace sandbox needs none. That is the
  // narrowest possible environment, and learning must not invent a lane.
  grantLanes(home, []);
  const s = await startTestServer({ home, env: env(provider) });
  try {
    const { cookie } = await s.pair();
    const events = await readSse(await postChat(s.base, cookie, { text: 'Skriv filen bevis.txt.', requestId: 'lane-1' }));
    const done = events.find((e) => e.type === 'done')?.data;
    assert.equal(done?.status, 'completed');
    assert.ok(done.learned, 'a verified workspace write should be learnable');
    if (done.learned) {
      const manifest = JSON.parse(fs.readFileSync(
        path.join(home, 'v4', 'learned-skills', done.learned.name, 'skill.json'), 'utf8',
      ));
      const ownerState = JSON.parse(fs.readFileSync(path.join(home, 'v4', 'owner-mode.json'), 'utf8'));
      const granted = new Set(ownerState.lanes || []);
      for (const lane of manifest.requires) {
        assert.ok(granted.has(lane) || lane === 'workspace', `learning claimed an ungranted lane: ${lane}`);
      }
      for (const tool of manifest.tools) {
        assert.ok(s.context.tools.registry.get(tool), `learning named a tool that is not registered: ${tool}`);
      }
    }
  } finally {
    await s.close();
    await provider.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
