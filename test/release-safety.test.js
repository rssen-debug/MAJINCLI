import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('release publishing targets MAJINCLI and cannot overwrite a version tag', () => {
  const ps = read('scripts/publish.ps1');
  assert.match(ps, /\$Repo = 'rssen-debug\/MAJINCLI'/);
  assert.match(ps, /\$Branch = 'main'/);
  assert.doesNotMatch(ps, /git tag -f|git push -f/);
  assert.match(ps, /git push origin \$Tag/);
});

test('a pull request runs the real Windows build and smoke verifier without creating a release', () => {
  const wf = read('.github/workflows/build-exe.yml');
  assert.match(wf, /pull_request:\s*\n\s*branches: \[main\]/);
  assert.match(wf, /npm test/);
  assert.match(wf, /npm run check/);
  assert.match(wf, /build-on-windows\.ps1 -SkipBuild -Ci/);
  assert.match(wf, /if: \$\{\{ github\.event_name == 'workflow_dispatch'.*github\.event_name == 'push' \}\}/);
  assert.doesNotMatch(wf, /github\.com\/rssen-debug\/slurps\/releases/);
});
