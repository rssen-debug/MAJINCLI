import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRequestedArtifact } from '../src/core/goal-artifact.js';
import { forwardsJoinedRuntimeThroughLocal } from '../src/core/argv-joined-dataflow.js';

const goal = 'Create a working Node.js CLI agent in qa-two-hop.mjs. Export function respond(message) and a CLI using process.argv with DIFFERENT inputs.';
const header = "export function respond(message) { return 'Reply: ' + message; }\n";
function check(t, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-two-hop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'qa-two-hop.mjs'), header + body);
  return inspectRequestedArtifact(goal, dir);
}
test('real two-hop argv local is accepted', t => {
  const body = "const args = process.argv.slice(2); const response = args.length ? args.join(' ') : 'No arguments'; console.log(respond(response));";
  assert.equal(check(t, body).ok, true);
});
test('disconnected or hardcoded two-hop arguments rejected', t => {
  const cases = [
    "const args = process.argv.slice(2); const response = args.length ? 'QA_PING' : 'No arguments'; console.log(respond(response));",
    "const args = ['QA_PING']; const response = args.join(' '); console.log(respond(response));",
    "const args = process.argv.slice(2); const response = args.join(' '); console.log(respond('QA_PING'));",
    "const args = process.argv.slice(2); const response = other.join(' '); console.log(respond(response));",
    "const args = process.argv.slice(2); const response = args.join(' '); console.log('QA_PING');",
    "const args = process.argv.slice(2); const response = args.join(' '); // console.log(respond(response));"
  ];
  for (const source of cases) assert.equal(forwardsJoinedRuntimeThroughLocal(source), false, source);
});
