#!/usr/bin/env node
/**
 * MAJIN — bygger en fristående körbar (.exe på Windows, binär på linux/mac).
 *
 *   node scripts/build-exe.mjs                 # win-x64 (standard)
 *   node scripts/build-exe.mjs --all           # win + linux + macos
 *   node scripts/build-exe.mjs --no-pkg        # bara bundlat CJS (snabbt)
 *
 * Steg: 1) src/ui + rules kopplas till dist/  2) esbuild paketerar CLI:t till
 * dist/majin.cjs  3) @yao-pkg/pkg snapshotar det till en binär med node inbakat.
 * Inga nativa beroenden — Baileys/qrcode hålls externa (valfria).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const argv = process.argv.slice(2);
const all = argv.includes('--all');
const noPkg = argv.includes('--no-pkg');

function run(cmd, args, opts = {}) {
  process.stdout.write(`$ ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} exit ${r.status}`);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
  return true;
}

fs.mkdirSync(dist, { recursive: true });
for (const f of fs.readdirSync(dist)) {
  if (f === 'node-sea') continue;
  fs.rmSync(path.join(dist, f), { recursive: true, force: true });
}

/* 1) resurser bredvid bundlen */
copyDir(path.join(root, 'src', 'ui'), path.join(dist, 'ui'));
copyDir(path.join(root, 'rules'), path.join(dist, 'rules'));
copyDir(path.join(root, 'assets'), path.join(dist, 'assets'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(dist, 'package.json'));

/* 2) esbuild */
const out = path.join(dist, 'majin.cjs');
run(process.execPath, [
  '-e',
  `import('esbuild').then(async (esbuild) => {
    const r = await esbuild.build({
      entryPoints: ['src/cli/majin.js'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node' + process.versions.node.split('.')[0],
      outfile: '${out.split(path.sep).join('/')}',
      external: ['@whiskeysockets/baileys', 'qrcode', 'sharp'],
      keepNames: true,
      legalComments: 'none',
      minify: false,
      logLevel: 'warning',
    });
    if (r.errors && r.errors.length) process.exit(1);
  }).catch((e) => { console.error(String(e.message || e)); process.exit(1); });`,
]);
const bundleBytes = fs.statSync(out).size;
process.stdout.write(`\nbundle: dist/majin.cjs (${(bundleBytes / 1024).toFixed(0)} kB)\n\n`);
if (noPkg) {
  process.stdout.write('klart (--no-pkg). Testa: node dist/majin.cjs doctor\n');
  process.exit(0);
}

/* 3) pkg */
const major = process.versions.node.split('.')[0];
const targets = all
  ? [`node${major}-win-x64`, `node${major}-linuxstatic-x64`, `node${major}-macos-x64`]
  : [process.env.PKG_TARGET || `node${process.versions.node.split('.')[0]}-win-x64`];
const cfg = path.join(dist, 'pkg.config.json');
fs.writeFileSync(
  cfg,
  `${JSON.stringify(
    {
      name: 'majin',
      version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      bin: 'majin.cjs',
      pkg: {
        assets: ['ui/**/*', 'rules/**/*', 'assets/**/*', 'package.json'],
        scripts: [],
        targets,
        bytecode: false,
      },
    },
    null,
    2,
  )}\n`,
);

const pkgBin = ['node_modules/@yao-pkg/pkg/lib-es5/bin.js', 'node_modules/@yao-pkg/pkg/lib-es/bin.js', 'node_modules/@yao-pkg/pkg/lib/bin.js']
  .map((r) => path.join(root, ...r.split('/')))
  .find((f) => fs.existsSync(f));
if (!pkgBin) throw new Error('pkg hittades inte — kör: npm i -D @yao-pkg/pkg');

for (const t of targets) {
  const name = t.includes('win') ? 'majin-win-x64.exe' : t.includes('linux') ? 'majin-linux-x64' : 'majin-macos-x64';
  try {
    run(process.execPath, [pkgBin, out, '--config', cfg, '--targets', t, '--output', path.join(dist, name)], {
      env: { ...process.env, PKG_CACHE_PATH: path.join(root, '.pkg-cache') },
    });
  } catch (e) {
    process.stdout.write(`\n! ${t} kunde inte byggas: ${e.message}\n  (nätet till github.com/nodejs-krävs för node-binären; kör om eller använd "node dist/majin.cjs")\n`);
    continue;
  }
  const p2 = path.join(dist, name);
  if (fs.existsSync(p2)) process.stdout.write(`\n✔ ${name} (${(fs.statSync(p2).size / 1024 / 1024).toFixed(1)} MB)\n`);
  if (name === 'majin-linux-x64') fs.chmodSync(p2, 0o755);
}
process.stdout.write('\nKlart. Filerna ligger i dist/ (inte i git).\n');
