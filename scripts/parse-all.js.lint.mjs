#!/usr/bin/env node
/**
 * syntax-kontroll utan beroenden: varje .js körs genom vm.Script.
 * Fångar det som är dyrast i den här koden — trasig syntax i en modul ingen importerat ännu.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', '.lent', 'data', 'dist', 'build']);
const files = [];
walk(root);

async function check(src, file) {
  try {
    new vm.Script(src, { filename: file });
    return { ok: true };
  } catch (err) {
    const esm = /Cannot use import statement|Unexpected token 'export'|await is only valid|export only/i.test(err.message);
    if (!esm) return { ok: false, message: String(err.message).split('\n')[0] };
    /* ESM: skriv till tillfällig fil och låt parsern granska den som modul */
    const tmp = file + '.lint.mjs';
    try {
      fs.writeFileSync(tmp, src);
      await import('data:text/javascript;base64,' + Buffer.from('0').toString('base64')).catch(() => {});
      const { createRequire } = await import('node:module');
      void createRequire;
      const { parse } = { parse: null };
      void parse;
      const ok = await syntaxViaImport(tmp);
      return ok ? { ok: true } : { ok: false, message: 'ESM-syntaxfel (se filen)' };
    } catch (e2) {
      return { ok: false, message: String(e2.message).split('\n')[0] };
    } finally {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* */
      }
    }
  }
}

async function syntaxViaImport(file) {
  /* Importera modulen — om den bara har ett syntaxfel kastar det före körning;
     ett körningsfel (saknad miljö) räknas som att syntaxen är ok. */
  try {
    await import('file://' + file.replace(/\\/g, '/'));
    return true;
  } catch (err) {
    const m = String(err && err.message ? err.message : err);
    return !/SyntaxError|Unexpected token|Invalid or unexpected token|Missing initializer|await is not allowed/i.test(m);
  }
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) files.push(p);
  }
}

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const parsed = await check(src, f);
  if (parsed.ok) console.log(`· ${path.relative(root, f)}`);
  else {
    console.log(`✖ ${path.relative(root, f)} — ${parsed.message}`);
    bad += 1;
  }
}
process.stdout.write(`\n${files.length - bad}/${files.length} filer ren syntax.\n`);
process.exitCode = bad ? 1 : 0;
