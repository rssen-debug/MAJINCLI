/**
 * MAJIN V6 — local mission orchestrator.
 *
 * This is the loop the chat cannot host: plan → execute on this machine →
 * read the real result → plan again. It stops on its own terms (budget, owner
 * decision needed, repeated failure, goal reached) and it never guesses that
 * something succeeded.
 *
 * Guarantees:
 *  - every action is validated against the mission before anything is queued;
 *  - irreversible work needs an explicit opt-in and a per-application effect
 *    key, so a restart can never send a second application;
 *  - the journal is written before and after each step, so a crash resumes
 *    instead of repeating;
 *  - the model never sees secrets, CV contents or email bodies.
 */
import { buildStateDigest } from './mission.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED_FINAL', 'BLOCKED', 'UNCERTAIN', 'CANCELLED']);
const IRREVERSIBLE_ACTIONS = new Set(['job.submit']);

export const STOP_REASONS = Object.freeze([
  'done', 'budget_steps', 'budget_tokens', 'budget_time', 'budget_cost', 'budget_submissions',
  'needs_owner', 'stuck', 'planner_error', 'stop_requested', 'error',
]);

export class MissionOrchestrator {
  constructor({
    mission, planner, queue, log, journal, runWork, readTask, readApplications,
    clock = Date.now, allowIrreversible = false, maxConsecutiveErrors = 2, maxStuck = 3,
  } = {}) {
    if (!mission) throw Object.assign(new Error('orchestrator needs a mission'), { code: 'MISSION_MISSING' });
    if (!planner) throw Object.assign(new Error('orchestrator needs a planner'), { code: 'PLANNER_MISSING' });
    if (!queue) throw Object.assign(new Error('orchestrator needs the task queue'), { code: 'QUEUE_MISSING' });
    if (!runWork) throw Object.assign(new Error('orchestrator needs a way to run work'), { code: 'RUNNER_MISSING' });
    this.mission = mission;
    this.planner = planner;
    this.queue = queue;
    this.log = log;
    this.journal = journal;
    this.runWork = runWork;
    this.readTask = readTask || (async (id) => queue.get(id));
    this.readApplications = readApplications || (async () => []);
    this.clock = clock;
    this.allowIrreversible = allowIrreversible === true;
    this.maxConsecutiveErrors = maxConsecutiveErrors;
    this.maxStuck = maxStuck;
  }

  #journal(entry) {
    try { return this.journal?.append(entry); } catch { return null; }
  }

  async #taskView(taskId) {
    const task = await this.readTask(taskId);
    if (!task) return null;
    return {
      id: task.id,
      kind: task.kind,
      state: task.state,
      summary: task.result?.summary || null,
      output: task.result?.output ?? null,
      receipt: task.result?.receipt || null,
      errorCode: task.lastError?.code || null,
      blocked: task.blocked || null,
    };
  }

  /**
   * Run (or resume) the mission.
   * `resume` re-reads the journal and continues after the last recorded step
   * without re-executing completed work.
   */
  async run({ resume = false, signal = null, catalog = '' } = {}) {
    const started = this.clock();
    const history = resume && this.journal ? this.journal.read() : [];
    const doneSteps = new Set(history.filter((entry) => TERMINAL.has(entry.state)).map((entry) => Number(entry.step) || 0));
    // Resume after the last step that actually finished. A step that was
    // journalled but never reached a terminal state is retried, and its
    // dedupeKey + effectKey keep that retry from doing anything twice.
    const lastFinished = doneSteps.size ? Math.max(...doneSteps) : 0;
    let step = lastFinished;
    let tokens = history.reduce((sum, entry) => sum + (entry.usage?.tokens || 0), 0);
    let costUsd = history.reduce((sum, entry) => sum + (entry.usage?.costUsd || 0), 0);
    let submissions = history.filter((entry) => entry.action === 'job.submit' && TERMINAL.has(entry.state)).length;

    const spent = () => ({ tokens, costUsd, wallMs: this.clock() - started });
    const stop = (reason, detail = null) => ({
      missionId: this.mission.id,
      resumedFrom: lastFinished,
      steps: step,
      stopReason: reason,
      detail,
      spent: spent(),
      submissions,
      journalFile: this.journal?.file || null,
    });

    let consecutiveErrors = 0;
    let lastFailureSignature = null;
    let stuckCount = 0;

    for (;;) {
      if (signal?.aborted) return stop('stop_requested');
      if (step >= this.mission.budget.maxSteps) return stop('budget_steps', `maxSteps=${this.mission.budget.maxSteps}`);
      if (tokens >= this.mission.budget.maxTokens) return stop('budget_tokens', `used ${tokens} tokens`);
      if (costUsd >= this.mission.budget.maxCostUsd) return stop('budget_cost', `spent $${costUsd.toFixed(4)}`);
      if (this.clock() - started >= this.mission.budget.maxWallMs) return stop('budget_time');

      const applications = await this.readApplications();
      const tasks = await this.queue.list({});
      const digest = buildStateDigest({
        mission: this.mission,
        step,
        tasks: tasks.map((task) => ({
          step: history.find((entry) => entry.taskId === task.id)?.step ?? null,
          kind: task.kind,
          state: task.state,
          summary: task.result?.summary || null,
          output: task.result?.output ?? null,
          errorCode: task.lastError?.code || null,
        })),
        applications,
        lastResult: history.at(-1) || null,
        spent: { tokens, costUsd },
        counters: { submissions },
      });

      const answer = await this.planner.ask({ mission: this.mission, state: digest, catalog, signal });
      step += 1;
      if (answer.usage) {
        tokens += (answer.usage.input || 0) + (answer.usage.output || 0);
        costUsd += answer.usage.costUsd || 0;
      }

      if (!answer.ok) {
        consecutiveErrors += 1;
        this.#journal({ step, phase: 'planner_error', error: answer.error, usage: { tokens: (answer.usage?.input || 0) + (answer.usage?.output || 0), costUsd: answer.usage?.costUsd || 0 } });
        this.log?.append?.('arena.refused', { workerId: 'orchestrator', code: answer.error?.code || 'PLANNER_ERROR', missionId: this.mission.id });
        if (consecutiveErrors >= this.maxConsecutiveErrors) return stop('planner_error', answer.error?.reason || null);
        continue;
      }
      consecutiveErrors = 0;

      const decision = answer.decision;
      this.#journal({ step, phase: 'decision', action: decision.action, rationale: decision.rationale, done: decision.done, usage: { tokens: (answer.usage?.input || 0) + (answer.usage?.output || 0), costUsd: answer.usage?.costUsd || 0 } });

      if (decision.done || decision.action === 'stop') {
        this.#journal({ step, phase: 'complete', state: 'COMPLETED', summary: decision.summary || decision.rationale || 'mission reported done' });
        return stop('done', decision.summary || decision.rationale || null);
      }

      if (decision.action === 'wait') {
        // A deliberate no-op step: useful when the agent is waiting for an
        // external event, and it must not be able to spin for free forever.
        if (step >= this.mission.budget.maxSteps) return stop('budget_steps');
        continue;
      }

      const irreversible = IRREVERSIBLE_ACTIONS.has(decision.action);
      if (irreversible) {
        if (!this.allowIrreversible) {
          this.#journal({ step, phase: 'refused', action: decision.action, error: { code: 'MISSION_IRREVERSIBLE_NOT_ENABLED' } });
          return stop('needs_owner', 'Irreversible action requested but the mission was not started with --allow-irreversible');
        }
        if (submissions >= this.mission.budget.maxSubmissions) return stop('budget_submissions');
      }

      const dedupeKey = `mission:${this.mission.id}:s${step}`;
      const effectKey = irreversible
        ? (decision.payload?.applicationId ? `submit:${decision.payload.applicationId}` : `mission:${this.mission.id}:e${step}`)
        : null;

      let added;
      try {
        added = await this.queue.add({
          kind: decision.action === 'tool' ? 'tool' : decision.action,
          title: `${this.mission.id} step ${step}`,
          payload: decision.payload,
          dedupeKey,
          effectKey,
          irreversible,
          by: 'arena-orchestrator',
        });
      } catch (error) {
        this.#journal({ step, phase: 'enqueue_failed', action: decision.action, error: { code: error.code || 'ENQUEUE_FAILED' } });
        return stop('error', String(error.message || error).slice(0, 300));
      }

      if (doneSteps.has(step)) {
        // Resumed mission: this step already ran; never execute it again.
        const existing = await this.#taskView(added.task.id);
        this.#journal({ step, phase: 'skipped_resumed', action: decision.action, taskId: added.task.id, state: existing?.state || added.task.state });
        continue;
      }

      this.#journal({ step, phase: 'dispatch', action: decision.action, taskId: added.task.id, payload: decision.payload, irreversible });
      this.log?.append?.('arena.accepted', { workerId: 'orchestrator', kind: decision.action, missionId: this.mission.id, taskId: added.task.id });

      await this.runWork({ maxTasks: 1 });
      const view = await this.#taskView(added.task.id);

      if (!view) {
        this.#journal({ step, phase: 'result_missing', action: decision.action, taskId: added.task.id });
        return stop('error', 'the task vanished from the queue');
      }

      if (irreversible && ['COMPLETED', 'UNCERTAIN', 'FAILED_FINAL', 'BLOCKED'].includes(view.state)) submissions += 1;
      this.#journal({
        step, phase: 'result', action: decision.action, taskId: view.id, state: view.state,
        summary: view.summary, errorCode: view.errorCode, receiptKind: view.receipt?.kind || null,
      });

      if (view.state === 'UNCERTAIN' || (view.state === 'BLOCKED' && view.blocked?.requiresOwner)) {
        return stop('needs_owner', `${view.state}: ${view.blocked?.code || view.errorCode || 'owner decision required'}`);
      }
      if (view.state !== 'COMPLETED') {
        const signature = `${decision.action}:${view.errorCode || view.state}`;
        stuckCount = signature === lastFailureSignature ? stuckCount + 1 : 1;
        lastFailureSignature = signature;
        if (stuckCount >= this.maxStuck) return stop('stuck', `${stuckCount}× ${signature}`);
      } else {
        lastFailureSignature = null;
        stuckCount = 0;
      }
    }
  }
}
