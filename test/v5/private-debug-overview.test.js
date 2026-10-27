import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, markdownOverview } from '../../scripts/v5/private-debug-overview.mjs';

test('private observer retains execution metadata but never reproduces sensitive source strings', () => {
  const secret = 'secret-lav-123@gmail.com';
  const cvPath = 'C:\\private\\personal-cv.pdf';
  const sample = {
    messages: [{ content: 'PRIVATE_PROMPT ' + secret }],
    goal: {
      objective: 'Apply to ' + secret, status: 'BLOCKED', blocker: secret,
      model_reply: secret, resume_count: 2,
      browser_handoff: { kind: 'BROWSER_ORIGIN', url: 'https://private.example/?token=' + secret },
      cost: { modelCalls: 4, inputTokens: 100, outputTokens: 20 },
      verification_evidence: [{ url: 'https://private.example/' + secret }],
      criteria: [{ path: cvPath }],
      tool_results: [
        { tool: 'browser_upload', ok: true, args: { filename: cvPath }, output: secret },
        { tool: 'browser_click', ok: false, errorCode: 'BLOCKED_ORIGIN', error: secret },
      ],
      trace: [
        { type: 'goal_started', seq: 1, objective: secret },
        { type: 'tool_call_started', seq: 2, tool: 'browser_upload', args: cvPath },
        { type: 'tool_call_finished', seq: 3, tool: 'browser_upload', ok: true, output: secret },
        { type: 'model_output_delta', seq: 4, text: secret },
        { type: 'waiting_user', seq: 5, kind: 'BROWSER_ORIGIN', origin: secret },
      ],
    },
  };
  const report = buildOverview(sample);
  assert.equal(report.goal.status, 'BLOCKED');
  assert.equal(report.goal.resume_count, 2);
  assert.equal(report.metrics.tool_calls, 2);
  assert.equal(report.metrics.tool_failures, 1);
  assert.equal(report.goal.verification_count, 1);
  assert.equal(report.recent_timeline.length, 4);
  assert.equal(report.recent_tools[0].tool, 'browser_upload');
  const all = JSON.stringify(report) + markdownOverview(report);
  for (const forbidden of [secret, cvPath, 'PRIVATE_PROMPT', 'private.example', 'model_output_delta'])
    assert.ok(!all.includes(forbidden), 'Sensitive content was leaked: ' + forbidden);
});

test('untrusted event properties never enter the private report', () => {
  const report = buildOverview({
    goal: { status: 'COMPLETED', tool_results: [{ tool: 'browser_fill|password', ok: true }],
      trace: [
        { type: 'tool_call_finished', tool: 'browser_fill\nSECRET', status: 'SENT|SECRET', errorCode: 'SECRET/LEAK', seq: 1 },
        { type: 'provider_secret', text: 'SECRET', seq: 2 },
      ] },
  });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('SECRET'));
  assert.equal(report.recent_timeline.length, 1);
  assert.equal(report.recent_timeline[0].tool, 'unknown');
  assert.equal(report.recent_timeline[0].status, 'unknown');
});
