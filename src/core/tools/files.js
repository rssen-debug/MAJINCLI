/**
 * MAJIN — file tools. Always on, no root required.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { def } from './registry.js';
import { entropy, strings as extract } from '../binary/strings.js';
import { dirs } from '../paths.js';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'target', '.cache', 'Library', 'AppData', '$RECYCLE.BIN', 'System Volume Information', '.pnpm-store', 'venv']);

export function resolveIn(ctx, p, { allowEmpty = false, never = [] } = {}) {
  if ((p == null || String(p).trim() === '') && !allowEmpty) {
    const err = new Error('path missing — give a path (absolute or workspace-relative)');
    err.code = 'bad_args';
    err.hint = 'example: path:"C:\\Users\\you\\Downloads" or path:"report.txt"';
    throw err;
  }
  const raw = String(p ?? '.').trim() || '.';
  const expanded = raw.replace(/^~(?=[/\\]|$)/, os.homedir());
  const root = path.resolve(ctx.cfg.get?.('workspace') || dirs.workspace || process.cwd());
  const abs = path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(root, expanded);
  const rel = path.relative(root, abs);
  const outside = !!rel && (rel.startsWith('..') || path.isAbsolute(rel));
  for (const stop of [...never, root, path.parse(abs).root, path.resolve(os.homedir())]) {
    if (stop && path.resolve(stop) === abs && (never.length || abs === path.parse(abs).root)) {
      const err = new Error(`refusing to touch ${abs} — key directory (workspace/root/home)`);
      err.code = 'protected';
      throw err;
    }
  }
  return { abs, rel: outside ? abs : rel, root, outside, bare: path.basename(abs) };
}

function sizeOf(abs) {
  try {
    return fs.statSync(abs).size;
  } catch {
    return null;
  }
}

export const fileTools = [
  def({
    name: 'fs.list',
    group: 'files',
    risk: 'read',
    desc: 'List a directory: names, sizes, dates. Use `kind` to get only executables or only folders.',
    params: { path: 'string: folder to list (workspace-relative or absolute)' },
    examples: ['fs.list({path:"downloads"})'],
    async run({ path: p = '.' }, ctx) {
      const { abs } = resolveIn(ctx, p, { allowEmpty: true });
      const ents = await fsp.readdir(abs, { withFileTypes: true });
      const rows = await Promise.all(
        ents.map(async (e) => {
          const full = path.join(abs, e.name);
          let st = null;
          try {
            st = await fsp.stat(full);
          } catch {
            /* trasig symlink */
          }
          return { name: e.name, dir: e.isDirectory(), size: st?.size ?? 0, mtime: st?.mtime?.toISOString?.()?.slice(0, 19) ?? '', ext: path.extname(e.name).toLowerCase() };
        }),
      );
      rows.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
      return { result: `${abs} — ${rows.length} entries\n${rows.map((r) => `${r.dir ? 'd' : '-'} ${String(r.size).padStart(11)} ${r.mtime}  ${r.name}`).join('\n')}`, meta: { count: rows.length, dir: abs }, summary: `${rows.length} entries in ${path.basename(abs)}` };
    },
  }),

  def({
    name: 'fs.read',
    group: 'files',
    risk: 'read',
    desc: 'Read a file. Returns numbered lines (or a hex dump for binary files) plus entropy and a file hash when it is binary.',
    params: { path: 'string: file to read', maxBytes: 'number: how much to read (default 200000)', mode: 'string: auto | text | hex | strings [auto|text|hex|strings]' },
    async run({ path: p, maxBytes = 200000, mode = 'auto' }, ctx) {
      const { abs } = resolveIn(ctx, p);
      const cap = ctx.cfg.get('tools.files.maxReadBytes') || 4000000;
      const size = sizeOf(abs);
      if (size == null) {
        const err = new Error(`not found: ${abs}`);
        err.code = 'ENOENT';
        throw err;
      }
      const fd = await fsp.open(abs, 'r');
      try {
        const n = Math.min(size, maxBytes, cap);
        const buf = Buffer.alloc(n);
        await fd.read(buf, 0, n, 0);
        const kind = pickKind(buf);
        if (mode === 'hex' || (mode === 'auto' && kind === 'bin')) {
          const strs = extract(buf, { limit: 300 });
          return {
            result: `BINARY ${abs} (${size} bytes, entropy ${entropy(buf).toFixed(3)})\n-- first ${Math.min(n, 2048)} bytes --\n${hexdump(buf.subarray(0, 2048))}\n-- strings --\n${strs.map((s) => `@${s.offset} ${s.value}`).join('\n')}`,
            meta: { size, binary: true, entropi: entropy(buf) },
            summary: `${path.basename(abs)} binary ${size} bytes`,
          };
        }
        const text = buf.toString('utf8');
        const lines = text.split('\n');
        const numbered = lines.map((l, i) => `${String(i + 1).padStart(5)} | ${l}`).join('\n');
        return { result: `${abs} (lines 1-${lines.length}${size > n ? ` of ${size} bytes` : ''})\n${numbered}`, meta: { lines: lines.length, size, truncated: size > n }, summary: `${path.basename(abs)} ${lines.length} lines` };
      } finally {
        await fd.close();
      }
    },
  }),

  def({
    name: 'fs.write',
    group: 'files',
    risk: 'write',
    desc: 'Write a file (missing folders are created). Overwrites — for small edits use fs.patch.',
    params: { path: 'string: target file', content: 'string: the full file content', append: 'boolean: append instead of overwriting' },
    async run({ path: p, content = '', append = false }, ctx) {
      const { abs } = resolveIn(ctx, p);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, String(content), { flag: append ? 'a' : 'w' });
      const size = sizeOf(abs);
      ctx.bus?.emit?.('file.write', { path: abs, bytes: size });
      return { result: `wrote ${abs} (${size} bytes)`, meta: { path: abs, bytes: size }, summary: `wrote ${path.basename(abs)}` };
    },
  }),

  def({
    name: 'fs.patch',
    group: 'files',
    risk: 'write',
    desc: 'Exact search/replace in a file. Simple, traceable, no fuzzy matching. Returns a diff.',
    params: {
      path: 'string: file',
      edits: 'array: [{"find":"old text","replace":"new text"}] — exact match, line boundaries respected',
      dry: 'boolean: show what would happen without writing',
    },
    async run({ path: p, edits = [], dry = false }, ctx) {
      const { abs } = resolveIn(ctx, p);
      const before = await fsp.readFile(abs, 'utf8');
      let after = before;
      const log = [];
      for (const e of edits) {
        const find = String(e.find ?? e.old ?? '');
        const replace = String(e.replace ?? e.new ?? '');
        if (!find) throw new Error('editt without "find"');
        const count = after.split(find).length - 1;
        if (!count) {
          const near = nearestLine(after, find);
          throw new Error(`found no "${find.slice(0, 40)}" i ${path.basename(abs)}. ${near ? `closest line: ${near}` : ''}`);
        }
        after = after.split(find).join(replace);
        log.push({ find: find.slice(0, 60), replace: replace.slice(0, 60), count });
      }
      if (!dry) await fsp.writeFile(abs, after);
      const diff = simpleDiff(before, after);
      return { result: `${dry ? 'DRY-RUN ' : ''}${path.basename(abs)}: ${log.map((l) => `${l.count}× "${l.find}"`).join(', ')}\n${diff}`, meta: { edits: log, applied: !dry }, summary: `${edits.length} edits${dry ? ' (dry run)' : ''} in ${path.basename(abs)}` };
    },
  }),

  def({
    name: 'fs.search',
    group: 'files',
    risk: 'read',
    desc: 'Regex search across files under a folder. Returns file:line:match. Use this before reading whole files.',
    params: {
      path: 'string: root to search in (default: workspace)',
      pattern: 'string: regex (javascript), or a plain word when regex:false',
      glob: 'string: filter file names, e.g. *.ts, *.py, *.dll',
      ignoreCase: 'boolean: case sensitive? default true = insensitive',
      maxFiles: 'number: maximum files with hits (default 60)',
      regex: 'boolean: treat the pattern as regex (default true)',
    },
    async run({ path: root = '.', pattern = '', glob = '', ignoreCase = true, maxFiles = 60, regex = true }, ctx) {
      const { abs } = resolveIn(ctx, root);
      if (!pattern) throw new Error('pattern missing');
      const re = regex ? safeRe(pattern, ignoreCase ? 'i' : '') : new RegExp(escapeRe(pattern), ignoreCase ? 'i' : '');
      if (!re) throw new Error(`olycklig regex: ${re}`);
      const files = await walk(abs, { glob, limit: 12000 });
      const hits = [];
      const bytes = new Map();
      let scanned = 0;
      for (const f of files) {
        if (hits.length >= maxFiles) break;
        try {
          const st = await fsp.stat(f);
          if (st.size > 2_000_000) continue;
          const buf = await fsp.readFile(f);
          if (looksBinary(buf)) continue;
          scanned += 1;
          const lines = buf.toString('utf8').split('\n');
          for (let i = 0; i < lines.length; i += 1) {
            if (re.test(lines[i])) {
              const key = path.relative(abs, f) || path.basename(f);
              if (!hits.some((h) => h.file === key)) hits.push({ file: key, lines: [] });
              const row = hits.find((h) => h.file === key);
              row.lines.push({ line: i + 1, text: lines[i].trim().slice(0, 240) });
              if (row.lines.length >= 6) break;
            }
          }
        } catch {
          /* skip unreadable files */
        }
      }
      bytes.set('scanned', scanned);
      const out = hits.length
        ? hits.map((h) => `${h.file}\n${h.lines.map((l) => `  ${String(l.line).padStart(5)}: ${l.text}`).join('\n')}`).join('\n\n')
        : `no hits for ${pattern} in ${files.length} files (${abs})`;
      return { result: `${hits.length} files with hits (scanned ${scanned}/${files.length})\n\n${out}`, meta: { hits: hits.length, scanned, files: files.length }, summary: `${hits.length} file hits for ${pattern}` };
    },
  }),

  def({
    name: 'fs.grep',
    group: 'files',
    risk: 'read',
    desc: 'Fast content search in ONE file (or every file under a folder) with context. Good for following flow in logs or source.',
    params: { path: 'string: file or folder', pattern: 'string: regex or word', context: 'number: lines around each hit (default 2)', limit: 'number: max hits (default 30)' },
    async run({ path: p, pattern = '', context = 2, limit = 30 }, ctx) {
      const { abs } = resolveIn(ctx, p);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        const files = await walk(abs, { glob: '', limit: 4000 });
        const hits = [];
        for (const f of files) {
          let txt = '';
          try {
            txt = await fsp.readFile(f, 'utf8');
          } catch {
            continue;
          }
          if (txt.includes('\0')) continue;
          const lines = txt.split('\n');
          const re = safeRe(pattern, 'i');
          for (let i = 0; i < lines.length; i += 1) {
            if (!re?.test(lines[i])) continue;
            const from = Math.max(0, i - context);
            const to = Math.min(lines.length, i + context + 1);
            hits.push(`${path.relative(abs, f)}:${i + 1}\n${lines.slice(from, to).map((l, k) => `${from + k + 1}| ${l}`).join('\n')}`);
            if (hits.length >= limit) break;
          }
          if (hits.length >= limit) break;
        }
        return {
          result: hits.length ? `${hits.length} hits in ${abs}:\n\n${hits.join('\n\n')}` : `no hits for ${pattern} (${files.length} files)`,
          meta: { hits: hits.length, files: files.length, dir: abs },
          summary: `${hits.length} hits in ${path.basename(abs)}/`,
        };
      }
      const lines = (await fsp.readFile(abs, 'utf8')).split('\n');
      const re = safeRe(pattern, 'i');
      const out = [];
      for (let i = 0; i < lines.length && out.length < limit; i += 1) {
        if (re?.test(lines[i])) {
          const from = Math.max(0, i - context);
          const to = Math.min(lines.length, i + context + 1);
          out.push(`— ${i + 1}\n${lines.slice(from, to).map((l, k) => `${from + k + 1}| ${l}`).join('\n')}`);
        }
      }
      return { result: out.length ? out.join('\n') : `no hits for ${pattern} in ${path.basename(abs)} (${lines.length} lines)`, summary: `${out.length} hits` };
    },
  }),

  def({
    name: 'fs.move',
    group: 'files',
    risk: 'write',
    desc: 'Move or rename a file/folder. Creates the target folders.',
    params: { from: 'string: source', to: 'string: destination' },
    async run({ from, to }, ctx) {
      const a = resolveIn(ctx, from);
      const b = resolveIn(ctx, to);
      await fsp.mkdir(path.dirname(b.abs), { recursive: true });
      await fsp.rename(a.abs, b.abs);
      return { result: `flyttade ${a.abs} → ${b.abs}`, summary: `flyttade ${a.bare}` };
    },
  }),

  def({
    name: 'fs.copy',
    group: 'files',
    risk: 'write',
    desc: 'Copy a file or folder (recursive).',
    params: { from: 'string: source', to: 'string: destination', overwrite: 'boolean: overwrite what exists' },
    async run({ from, to, overwrite = false }, ctx) {
      const a = resolveIn(ctx, from);
      const b = resolveIn(ctx, to);
      await fsp.cp(a.abs, b.abs, { recursive: true, force: Boolean(overwrite), errorOnExist: !overwrite });
      return { result: `kopierrade ${a.abs} → ${b.abs}`, summary: `kopierrade ${a.bare}` };
    },
  }),

  def({
    name: 'fs.delete',
    group: 'files',
    risk: 'destructive',
    desc: 'Delete a file or folder. Moves to the recycle bin where possible (Win/mac), otherwise permanent. Always goes through the guard.',
    params: { path: 'string: path', permanent: 'boolean: true = erase now, no recycle bin' },
    async run({ path: p, permanent = false }, ctx) {
      const { abs } = resolveIn(ctx, p, { never: [ctx.cfg.get('workspace'), dirs.root, dirs.memory, dirs.sessions] });
      const st = await fsp.stat(abs);
      if (String(p ?? '').trim() === '' || String(p).trim() === '.' || String(p).trim() === '*') {
        const err = new Error(`refusing to delete "${p}" — name a specific file or folder, not a root`);
        err.code = 'protected';
        throw err;
      }
      if (!permanent) {
        const trash = await toTrash(abs, st.isDirectory());
        if (trash.ok) return { result: `papperskorgen ← ${abs}`, summary: `kastade ${path.basename(abs)}` };
        ctx.bus?.warn?.('trash.unavailable', { why: trash.error, hint: 'use permanent:true (or install the `trash` package)' });
      }
      await fsp.rm(abs, { recursive: true, force: true });
      return { result: `deleted permanently ${abs}`, summary: `deleted ${path.basename(abs)} (permanent)` };
    },
  }),

  def({
    name: 'fs.stat',
    group: 'files',
    risk: 'read',
    desc: 'Metadata: size, dates, permissions, hash, entropy, file-type magic.',
    params: { path: 'string: file' },
    async run({ path: p }, ctx) {
      const { abs } = resolveIn(ctx, p);
      const st = await fsp.stat(abs);
      const head = await readHead(abs, 4096);
      const crypto = await import('node:crypto');
      const hash = st.size < 64 * 1024 * 1024 ? crypto.createHash('sha256').update(await fsp.readFile(abs)).digest('hex') : null;
      return {
        result: JSON.stringify({ path: abs, size: st.size, mtime: st.mtime.toISOString(), ctime: st.ctime.toISOString(), mode: (st.mode & 0o777).toString(8), dir: st.isDirectory(), entropy: head.length ? Number(entropy(head).toFixed(3)) : 0, magic: head.subarray(0, 8).toString('hex'), sha256: hash }, null, 1),
        summary: `${path.basename(abs)} ${st.size} byte`,
      };
    },
  }),

  def({
    name: 'fs.mkdir',
    group: 'files',
    risk: 'write',
    desc: 'Create a folder (recursive).',
    params: { path: 'string: new folder' },
    async run({ path: p }) {
      const { abs } = { abs: path.resolve(String(p)) };
      await fsp.mkdir(abs, { recursive: true });
      return { result: `skapade ${abs}` };
    },
  }),

  def({
    name: 'fs.tar',
    group: 'files',
    risk: 'write',
    desc: 'Pack or unpack with the system tar (built into Windows 10+). Use it to move a folder around or extract an archive.',
    params: { op: 'string: create | extract [create|extract]', archive: 'string: archive file .tar.gz/.zip', path: 'string: folder or file to work on', cwd: 'string: working directory' },
    async run({ op, archive, path: p = '.', cwd }, ctx) {
      const { spawnSync } = await import('node:child_process');
      const a = resolveIn(ctx, archive);
      const src = resolveIn(ctx, p);
      const work = cwd ? resolveIn(ctx, cwd).abs : op === 'create' ? src.root : path.dirname(a.abs);
      const rel = path.relative(work, src.abs) || '.';
      const args = op === 'extract' ? ['-xf', a.abs, '-C', src.abs] : ['-czf', a.abs, '-C', work, ...(a.abs.startsWith(work) ? [`--exclude=${path.relative(work, a.abs)}`] : []), rel];
      const r = spawnSync('tar', args, { encoding: 'utf8', windowsHide: true });
      if (r.error) throw new Error(`tar could not run: ${r.error.message}`);
      const warnings = /file changed as we read it|Removing leading/i.test(r.stderr || '');
      const ok = r.status === 0 || (op === 'create' && r.status === 1 && warnings && (sizeOf(a.abs) || 0) > 0);
      return {
        ok,
        result: `${ok ? 'ok' : 'failed'}: tar ${args.join(' ')}\n${(r.stderr || '').slice(0, 2000)}\n${sizeOf(a.abs) || 0} byte i arkiv`,
        meta: { archive: a.abs, bytes: sizeOf(a.abs) || 0, op },
        summary: `${op} ${path.basename(a.abs)} (${sizeOf(a.abs) || 0} byte)`,
        ...(ok ? {} : { error: { code: 'tar_failed', message: (r.stderr || `tar exit ${r.status}`).slice(0, 400) } }),
      };
    },
  }),
];

function pickKind(buf) {
  let bin = 0;
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i += 1) {
    const c = buf[i];
    if (c === 0 || (c < 9 && c !== 0) || (c > 13 && c < 32)) bin += 1;
  }
  return n && bin / n > 0.06 ? 'bin' : 'txt';
}

export function looksBinary(buf) {
  return pickKind(buf) === 'bin';
}

export function hexdump(buf, { width = 16 } = {}) {
  const lines = [];
  for (let i = 0; i < buf.length; i += width) {
    const slice = buf.subarray(i, i + width);
    const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(width * 3 - 1, ' ');
    const ascii = [...slice].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`);
  }
  return lines.join('\n');
}

export async function readHead(abs, n = 4096) {
  try {
    const fd = await fsp.open(abs, 'r');
    try {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fd.read(buf, 0, n, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
  } catch {
    return Buffer.alloc(0);
  }
}

export async function walk(root, { glob = '', limit = 5000, dirs = false } = {}) {
  const out = [];
  const re = glob ? globToRe(glob) : null;
  async function step(cur) {
    if (out.length >= limit) return;
    let ents = [];
    try {
      ents = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (out.length >= limit) return;
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (dirs) out.push(full);
        await step(full);
      } else if (!re || re.test(e.name) || re.test(path.relative(root, full).replace(/\\/g, '/'))) out.push(full);
    }
  }
  await step(root);
  return out;
}

/**
 * Glob till RegExp. Stjarnan tacker en niva, dubbel-stjarna godtyckliga mappar,
 * och fragetecknet ett tecken. Slash och backslash ar likvardiga (Windows + POSIX).
 */
export function globToRe(g) {
  const flat = String(g).trim().replace(/\\/g, '/');
  const esc = flat.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = esc
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '\u0003')
    .replace(/\?/g, '\u0004')
    .replace(/\//g, '[\\\\/]')
    .replace(/\u0001/g, '(?:.*[\\\\/])?')
    .replace(/\u0002/g, '.*')
    .replace(/\u0003/g, '[^\\\\/]*')
    .replace(/\u0004/g, '[^\\\\/]');
  return new RegExp(`^${body}$`, 'i');
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeRe(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    return `olycklig regex: ${err.message}`;
  }
}

function nearestLine(text, find) {
  const key = find.split('\n')[0].trim().slice(0, 30);
  if (!key) return null;
  for (const l of text.split('\n')) if (l.includes(key)) return l.trim().slice(0, 120);
  return null;
}

function simpleDiff(a, b, max = 18) {
  const al = a.split('\n');
  const bl = b.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(al.length, bl.length) && out.length < max; i += 1) {
    if (al[i] === bl[i]) continue;
    if (al[i] !== undefined) out.push(`- ${i + 1}: ${String(al[i]).slice(0, 160)}`);
    if (bl[i] !== undefined) out.push(`+ ${i + 1}: ${String(bl[i]).slice(0, 160)}`);
  }
  return out.length ? out.join('\n') : 'no visible line change';
}

async function toTrash(abs, isDir) {
  const win = process.platform === 'win32';
  if (win) {
    const src = abs.replace(/'/g, "''");
    const script = `$sh=New-Object -ComObject Shell.Application;$f=$sh.Namespace((Split-Path -Parent '${src}'));$i=$f.ParseName((Split-Path -Leaf '${src}'));$i.InvokeVerb('delete')`;
    return new Promise((res) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
      let err = '';
      child.stderr?.on('data', (d) => (err += d));
      child.on('error', (e) => res({ ok: false, error: e.message }));
      child.on('close', (code) => res(code === 0 ? { ok: true } : { ok: false, error: err.slice(0, 200) || `exit ${code}` }));
      void isDir;
    });
  }
  if (process.platform === 'darwin') {
    return new Promise((res) => {
      const child = spawn('osascript', ['-e', `tell app "Finder" to delete POSIX file "${abs.replace(/"/g, '\\"')}"`]);
      child.on('error', (e) => res({ ok: false, error: e.message }));
      child.on('close', (c) => res(c === 0 ? { ok: true } : { ok: false, error: `exit ${c}` }));
    });
  }
  const trashDir = path.join(os.homedir(), '.local', 'share', 'Trash', 'files');
  try {
    await fsp.mkdir(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '');
    await fsp.rename(abs, path.join(trashDir, `${stamp}-${path.basename(abs)}`));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

