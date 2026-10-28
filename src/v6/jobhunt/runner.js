import path from 'node:path';
import { buildHandlers } from '../handlers.js';
import { Supervisor } from '../supervisor.js';
import { sleep } from '../util.js';
import { writeJobHuntReports } from './report.js';
import { askHead, readAiLog } from './ai.js';

export const DEFAULT_QUERIES = Object.freeze([
  'content creator',
  'social media',
  'digital marketing',
  'kommunikatÃ¶r',
  'marknadsfÃ¶rare',
  'influencer marketing',
  'UGC',
  'videoproduktion',
  'SEO content',
  'e-handel content',
]);

const ACTIVE_STATES = new Set(['QUEUED', 'RUNNING', 'FAILED_RETRYABLE']);
const SUBMITTED_STATES = new Set(['SUBMITTED_UNCONFIRMED', 'EMAIL_VERIFICATION_PENDING', 'CONFIRMED_RECEIVED']);

function activeCount(stats) {
  return [...ACTIVE_STATES].reduce((total, state) => total + (stats.byState?.[state] || 0), 0);
}

async function checkpoint(ctx, session, now) {
  const queue = await ctx.queue.stats();
  const jobs = await ctx.jobs.stats();
  const byState = jobs.byState || {};
  await session.checkpoint({
    counts: {
      discovered: jobs.total || 0,
      evaluated: (byState.MATCHED || 0) + (byState.APPROVED || 0) + (byState.FORM_STARTED || 0) + (byState.FORM_PREPARED || 0) + (byState.SUBMITTING || 0),
      submitted: [...SUBMITTED_STATES].reduce((total, state) => total + (byState[state] || 0), 0),
      verified: byState.CONFIRMED_RECEIVED || 0,
      blocked: byState.BLOCKED || 0,
      failed: (byState.FAILED_FINAL || 0) + (queue.byState?.FAILED_FINAL || 0),
    },
  }, { now });
}

export async function planJobHunt({ ctx, session, queries = DEFAULT_QUERIES, maxRounds = 10_000, now = Date.now(), includeDiscovery = true, discoveryCooldownMs = 300000 } = {}) {
  const state = await session.read();
  if (!state) throw Object.assign(new Error('No Job Hunter session exists'), { code: 'JOBHUNT_NOT_FOUND' });
  const applications = await ctx.jobs.list({ candidateId: state.candidateId, limit: 5000 });
  let added = 0;
  const add = async (task) => {
    const result = await ctx.queue.add(task);
    if (!result.deduplicated) added += 1;
  };

  for (const app of applications) {
    if (app.state === 'DISCOVERED') {
      await add({
        kind: 'job.evaluate',
        title: `Evaluate ${app.job?.company || 'unknown'} â€” ${app.job?.title || app.id}`,
        payload: { applicationId: app.id, candidateId: state.candidateId },
        dedupeKey: `jobhunt:${state.id}:evaluate:${app.id}`,
        priority: 20,
      });
    } else if (app.state === 'APPROVED') {
      await add({
        kind: 'job.submit',
        title: `Submit ${app.job?.company || 'unknown'} â€” ${app.job?.title || app.id}`,
        payload: { applicationId: app.id, candidateId: state.candidateId },
        dedupeKey: `jobhunt:${state.id}:submit:${app.id}`,
        effectKey: `job-submit:${app.id}`,
        irreversible: true,
        priority: 30,
      });
    } else if (['SUBMITTED_UNCONFIRMED', 'EMAIL_VERIFICATION_PENDING'].includes(app.state) && ctx.gmailStatus?.state === 'CONFIGURED') {
      await add({
        kind: 'gmail.verify',
        title: `Verify ${app.job?.company || 'unknown'} â€” ${app.job?.title || app.id}`,
        payload: { applicationId: app.id, candidateId: state.candidateId },
        dedupeKey: `jobhunt:${state.id}:verify:${app.id}`,
        priority: 25,
      });
    }
  }
  if (added > 0) return added;
  if (!includeDiscovery) return 0;

  if (state.round >= maxRounds) return 0;
  if (state.lastDiscoveryAt && now - new Date(state.lastDiscoveryAt).getTime() < discoveryCooldownMs) return 0;
  const round = state.round + 1;
  const list = [...new Set((queries.length ? queries : DEFAULT_QUERIES).map(String).filter(Boolean))];
  for (const query of list) {
    await add({
      kind: 'job.discover',
      title: `Discover: ${query}`,
      payload: { candidateId: state.candidateId, query, limit: 50 },
      dedupeKey: `jobhunt:${state.id}:discover:${round}:${query}`,
      priority: 10,
    });
  }
  if (added > 0) await session.checkpoint({ round, lastDiscoveryAt: new Date(now).toISOString() }, { now });
  return added;
}


async function applyHeadTasks({ ctx, session, tasks, invocationId }) {
  const current = await session.read();
  const applications = await ctx.jobs.list({ candidateId: current.candidateId, limit: 5000 });
  const byId = new Map(applications.map((app) => [app.id, app]));
  let added = 0;
  const add = async (task) => {
    const result = await ctx.queue.add(task);
    if (!result.deduplicated) added += 1;
  };
  for (const task of tasks || []) {
    if (task.kind === 'job.discover') {
      await add({
        kind: 'job.discover',
        title: `Head search: ${task.query}`,
        payload: { candidateId: current.candidateId, query: task.query, limit: task.limit || 50 },
        dedupeKey: `jobhunt:head:${current.id}:${task.query}:${invocationId}`,
        priority: 10,
      });
    } else if (task.kind === 'job.evaluate') {
      const app = byId.get(task.applicationId);
      if (!app || app.state !== 'DISCOVERED') continue;
      await add({
        kind: 'job.evaluate',
        title: `Head evaluate: ${app.job?.company || app.id}`,
        payload: { applicationId: app.id, candidateId: current.candidateId },
        dedupeKey: `jobhunt:head:evaluate:${app.id}`,
        priority: 20,
      });
    } else if (task.kind === 'gmail.verify') {
      if (ctx.gmailStatus?.state !== 'CONFIGURED') continue;
      const app = byId.get(task.applicationId);
      if (!app || !['SUBMITTED_UNCONFIRMED', 'EMAIL_VERIFICATION_PENDING'].includes(app.state)) continue;
      await add({
        kind: 'gmail.verify',
        title: `Head verify: ${app.job?.company || app.id}`,
        payload: { applicationId: app.id, candidateId: current.candidateId },
        dedupeKey: `jobhunt:head:verify:${app.id}`,
        priority: 25,
      });
    }
  }
  return added;
}

export async function runJobHunt({
  ctx,
  session,
  queries = null,
  clock = Date.now,
  sleepFn = sleep,
  replanMs = 30_000,
  maxBatch = 20,
  maxRounds = 10_000,
  planner = null,
  supervisorFactory = null,
  writeReportFn = writeJobHuntReports,
  submitAdapter = null,
  runnerPid = process.pid,
  head = null,
  headModel = process.env.MAJIN_HEAD_MODEL || 'opencode-go/deepseek-v4.1-flash',
  headTimeoutMs = 120_000,
  headBackoffMs = 60_000,
  maxAiCalls = process.env.MAJIN_V6_AI_DISABLED === '1' ? 0 : 80,
  maxNoProgress = 3,
  workspace = process.env.MAJIN_WORKSPACE || process.cwd(),
} = {}) {
  const state = await session.read();
  if (!state) throw Object.assign(new Error('No Job Hunter session exists'), { code: 'JOBHUNT_NOT_FOUND' });
  if (state.aiDisabled === true || process.env.MAJIN_V6_AI_DISABLED === '1') maxAiCalls = 0;
  const found = ctx.hunter?.profile(state.candidateId);
  if (!found?.ok) {
    throw Object.assign(new Error(found?.error?.reason || 'Candidate profile is not available'), {
      code: found?.error?.code || 'PROFILES_MISSING',
    });
  }
  const selectedQueries = (queries || state.queries || DEFAULT_QUERIES).map(String).filter(Boolean);
  const headFn = head || askHead;
  let aiCalls = readAiLog(ctx.home, 2000).filter((item) => item.missionId === state.id).length;
  let lastHeadAt = 0;
  let lastJobTotal = (await ctx.jobs.stats()).total;
  let noProgress = 0;
  let lastProgressKey = null;
  const invokeHead = async () => {
    if (aiCalls >= maxAiCalls) return 0;
    const current = await session.read();
    const queue = await ctx.queue.stats();
    const applications = await ctx.jobs.list({ candidateId: current.candidateId, limit: 5000 });
    let result;
    try {
      result = await headFn({
        home: ctx.home,
        mission: { id: current.id, kind: 'jobhunt', goal: 'SÃ¶k jobb', candidateId: current.candidateId, deadlineAt: current.deadlineAt },
        session: current, queue, jobs: applications, checkpoint: current.lastSummary || null,
        model: headModel, workspace, timeoutMs: headTimeoutMs,
      });
    } catch (error) {
      aiCalls += 1;
      lastHeadAt = clock();
      return 0;
    }
    aiCalls += 1;
    lastHeadAt = clock();
    const planned = await applyHeadTasks({ ctx, session, tasks: result?.tasks || [], invocationId: result?.invocationId || `ai_${aiCalls}` });
    if (planned > 0) {
      await session.checkpoint({ round: (current.round || 0) + 1 }, { now: clock() });
      return planned;
    }
    return 0;
  };
  await session.acquireRunner(runnerPid);
  let finalStatus = null;
  let failure = null;
  let supervisor = null;
  const wait = async (ms) => {
    const end = clock() + Math.max(0, Number(ms) || 0);
    await session.checkpoint({ nextWakeAt: new Date(end).toISOString() }, { now: clock() });
    while (clock() < end) {
      const current = await session.read();
      if (!current || current.status === 'STOPPED' || session.stopRequested()) return;
      if (new Date(current.deadlineAt).getTime() <= clock()) return;
      await sleepFn(Math.min(1000, Math.max(1, end - clock())));
    }
    await session.checkpoint({ nextWakeAt: null }, { now: clock() });
  };
  try {
    if (state.round === 0) {
      const headPlanned = await invokeHead();
      if (!headPlanned) await planJobHunt({ ctx, session, queries: selectedQueries, maxRounds, now: clock() });
    }
    const handlers = buildHandlers({ hunter: ctx.hunter, submitAdapter: submitAdapter || ctx.submitAdapter || null });
    supervisor = supervisorFactory
      ? supervisorFactory({ handlers, session, ctx })
      : new Supervisor({
        queue: ctx.queue,
        log: ctx.log,
        handlers: handlers instanceof Map ? handlers : new Map(Object.entries(handlers)),
        workerId: `jobhunt-${state.id}`,
        heartbeatFile: path.join(ctx.workersDir, `jobhunt-${state.id}.json`),
        stopFile: session.stopFile,
        limits: { maxTasks: maxBatch, maxRuntimeMs: 5 * 60 * 1000, taskTimeoutMs: 5 * 60 * 1000 },
        clock,
        onTaskSettled: async () => { await checkpoint(ctx, session, clock()); },
        shouldClaim: async () => {
          const current = await session.read();
          return current?.status === 'RUNNING' && new Date(current.deadlineAt).getTime() > clock() && !session.stopRequested();
        },
      });

    while (true) {
      const current = await session.read();
      const now = clock();
      const deadline = new Date(current.deadlineAt).getTime();
      if (!current || current.status === 'STOPPED' || session.stopRequested()) {
        finalStatus = 'STOPPED';
        break;
      }
      if (deadline <= now) {
        finalStatus = 'EXPIRED';
        break;
      }
      if (current.status === 'PAUSED') {
        await wait(Math.min(1000, Math.max(1, deadline - now)));
        continue;
      }
      if (current.status !== 'RUNNING') {
        finalStatus = current.status;
        break;
      }

      let stats = await ctx.queue.stats();
      if (activeCount(stats) === 0) {
        let planned = await planJobHunt({ ctx, session, queries: selectedQueries, maxRounds, now: clock(), includeDiscovery: false });
        if (!planned && aiCalls < maxAiCalls && (clock() - lastHeadAt) >= Math.min(5 * 60_000, headBackoffMs * (2 ** Math.min(noProgress, 5)))) {
          planned = await invokeHead();
        }
        if (!planned) {
          planned = planner
            ? await planner({ ctx, session, queries: selectedQueries, maxRounds, now })
            : await planJobHunt({ ctx, session, queries: selectedQueries, maxRounds, now: clock() });
        }
        if (!planned) {
          const waitMs = Math.min(replanMs, Math.max(1, deadline - clock()));
          await wait(waitMs);
          continue;
        }
      }

      const remaining = new Date(current.deadlineAt).getTime() - clock();
      if (remaining <= 0) {
        finalStatus = 'EXPIRED';
        break;
      }
      const result = await supervisor.run({
        maxTasks: maxBatch,
        maxRuntimeMs: Math.min(remaining, 5 * 60 * 1000),
        untilEmpty: true,
      });
      await checkpoint(ctx, session, clock());
      const jobStats = await ctx.jobs.stats();
      if (jobStats.total > lastJobTotal) {
        lastJobTotal = jobStats.total;
        noProgress = 0;
      } else {
        noProgress += 1;
      }
      const jobNow = await ctx.jobs.stats();
      const progressKey = `${jobNow.total}|${jobNow.byState?.MATCHED || 0}|${jobNow.byState?.SUBMITTED_UNCONFIRMED || 0}|${jobNow.byState?.CONFIRMED_RECEIVED || 0}`;
      if (progressKey === lastProgressKey) {
        noProgress += 1;
      } else {
        lastProgressKey = progressKey;
        noProgress = 0;
      }
      // Empty searches are paced by the persisted discovery cooldown, not a
      // premature terminal STOPPED status. Keep watching until the deadline.
      stats = await ctx.queue.stats();
      if (activeCount(stats) === 0 && ['queue empty', 'no eligible tasks'].includes(result.reason) && clock() < deadline) {
        await wait(Math.min(replanMs, Math.max(1, deadline - clock())));
      }
    }
  } catch (error) {
    failure = error;
    finalStatus = 'FAILED';
  } finally {
    let report = null;
    try {
      report = await writeReportFn({ ctx, session, finalStatus: finalStatus || 'FAILED', now: clock() });
    } catch (error) {
      failure = failure || error;
    }
    await session.complete({
      status: finalStatus || 'FAILED',
      reports: report ? { html: report.html, xlsx: report.xlsx } : null,
      error: failure ? String(failure.message || failure) : null,
      now: clock(),
    });
    await session.releaseRunner(runnerPid);
    await supervisor?.heartbeat?.beat?.({ state: 'STOPPED', currentTaskId: null, lastAction: `jobhunt ${finalStatus}` });
  }
  if (failure) throw failure;
  return { status: finalStatus, session: await session.describe(undefined, clock()) };
}

export { activeCount };
