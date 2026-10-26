import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/v5/cli-live-accept.mjs', import.meta.url));

test('installed-CLI live acceptance reports NOT VERIFIED without attempting a request when the key env is absent', () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      MAJIN_LIVE_KEY_ENV: 'MAJIN_TEST_MISSING_LIVE_KEY',
      MAJIN_TEST_MISSING_LIVE_KEY: '',
    },
  });
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.verified, false);
  assert.equal(parsed.stage, 'credential');
  assert.match(parsed.error, /NOT VERIFIED/);
  assert.equal(result.stderr, '');
});
