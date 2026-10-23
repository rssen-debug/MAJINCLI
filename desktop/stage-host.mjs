import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const stage = path.join(here, 'stage', 'host');
// Copy into a known workspace directory. Never copy local runtime data or keys.
fs.mkdirSync(stage, { recursive: true });
if (process.platform === 'win32') {
  fs.mkdirSync(path.join(stage, 'runtime'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(stage, 'runtime/node.exe'));
  fs.writeFileSync(path.join(stage, 'runtime/version.json'), JSON.stringify({ node: process.versions.node, arch: process.arch }));
}
for (const name of ['src', 'scripts', 'rules', 'skins', 'package.json', 'package-lock.json']) {
  const source = path.join(root, name);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(stage, name), { recursive: true });
}
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
