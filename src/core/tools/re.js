/**
 * MAJIN RE — verktygen.
 * Allt är alltid på. Varje verktyg är medvetet litet och returnerar något en
 * modell kan läsa utan att spränga kontexten: tallrikar, inte råa buffers.
 */
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { def } from './registry.js';
import { resolveIn, hexdump } from './files.js';
import { analyze, DEFAULT_RULES_TEXT } from '../binary/index.js';
import { entropy, strings as extractStrings, classify as classifyStrings } from '../binary/strings.js';
import { parsePe } from '../binary/pe.js';
import { findBytes, entropyWindow, zipEntries, zipRead, apkPeek, pcapSummary, peResources, peVersionInfo, peOverlay } from '../binary/extract.js';
import { parseRules, scan as yaraScan, rulesToText } from '../binary/yara.js';
import { scoreApis } from '../binary/sigs.js';
import { opcodeScan, findCodeIslands } from '../binary/scan.js';
import { detect as detectTools, call as callTool, TOOL_SPECS } from '../binary/external.js';
import { bus } from '../log.js';
import { dirs, pkgRules } from '../paths.js';
import { jaccard, shingles } from '../moa.js';

async function load(ctx, p) {
  const { abs } = resolveIn(ctx, p);
  const st = await fs.stat(abs);
  const max = ctx.cfg.get('tools.re.maxFileBytes') || 268435456;
  if (st.size > max) throw new Error(`the file is ${fmt(st.size)}, the limit is ${fmt(max)}. Lower tools.re.maxFileBytes or carve a piece with re.hexdump.`);
  if (!st.isFile()) throw new Error(`${abs} is not a file (directory: ${st.isDirectory()})`);
  return { abs, buf: await fs.readFile(abs), st };
}

const fmt = (n) => (n > 1024 * 1024 ? `${(n / 1048576).toFixed(2)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`);

function userRules(ctx) {
  const out = [DEFAULT_RULES_TEXT];
  const extra = ctx.cfg.get('tools.re.yaraRules') || [];
  for (const r of [path.join(dirs.rules, 'majin.yar'), path.join(pkgRules, 'majin.yar'), ...(Array.isArray(extra) ? extra : [])]) {
    try {
      out.push(fss.readFileSync(r, 'utf8'));
    } catch {
      /* ingen regel-fil — lugnt */
    }
  }
  return out.join('\n');
}

export const reTools = [
  def({
    name: 're.analyze',
    group: 'reverse',
    risk: 'read',
    desc: 'Full triage of a binary: format, headers, sections+entropy, imports/exports, packers, YARA, IOC strings, opcode patterns, a risk score and suggested next steps. Start here.',
    params: { path: 'string: file to analyse', maxStrings: 'number: max number of strings (default 4000)', rules: 'string: "builtin", "builtin+user" or [auto|builtin|builtin+user]' },
    examples: ['re.analyze({path:"downloads/suspect.exe"})'],
    async run({ path: p, maxStrings = 4000, rules = 'builtin+user' }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const parsed = parseRules(rules === 'builtin' ? DEFAULT_RULES_TEXT : userRules(ctx));
      const r = analyze(buf, { name: abs, rules: parsed, maxStrings: Number(maxStrings) });
      const file = path.join(dirs.out, `re-${Date.now().toString(36)}-${path.basename(abs)}.json`);
      await fs.mkdir(dirs.out, { recursive: true });
      await fs.writeFile(file, JSON.stringify(r, null, 1));
      const compact = {
        file: path.basename(abs),
        size: r.size,
        format: `${r.kind} ${r.arch || ''} ${r.bits ? `${r.bits}-bit` : ''}`.trim(),
        hash: r.hashes?.sha256,
        imphash: r.imphash,
        entropy: r.entropy?.overall,
        risk: r.risk,
        packers: (r.packers || []).map((x) => `${x.packer}${x.evidence ? ` (${x.evidence})` : ''}`),
        sections: (r.sections || []).slice(0, 12).map((s) => `${s.name} ${fmt(s.rawSize || s.size || 0)} ent=${s.entropy?.toFixed?.(2) ?? s.entropy}${s.executable ? ' X' : ''}${s.writable ? ' W' : ''}`),
        imports: (r.imports || []).slice(0, 12).map((i) => (i.dll ? `${i.dll} (${i.count ?? i.functions?.length ?? 0})` : i.name)).filter(Boolean),
        flaggedApis: (r.apis?.flagged || []).slice(0, 12).map((f) => `${f.dll ? `${f.dll}!` : ''}${f.api} [${f.severity}] ${f.why}`),
        yara: (r.yara || []).map((y) => `${y.rule}${y.meta?.severity ? `/${y.meta.severity}` : ''}`),
        opcodes: (r.opcodes?.hits || []).slice(0, 8).map((h) => `${h.name} x${h.count}`),
        embedded: (r.embedded || []).slice(0, 8).map((e) => `${e.name}@${e.offset}`),
        containers: (r.containers || []).map((c) => `${c.kind}${c.entries ? ` (${c.entries} poster)` : ''}`),
        strings: (r.strings?.sample || []).slice(0, 25).map((s) => s.value),
        iocs: Object.fromEntries(Object.entries(r.iocs || {}).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => [k, v.slice(0, 8)])),
        security: r.security,
        overlay: r.overlay?.size ? `${fmt(r.overlay.size)} @${r.overlay.offset}` : null,
        pdb: r.pdb,
        dotnet: r.dotnet ? { managed: true, version: r.dotnet.version, types: (r.dotnet.typeNames || []).length } : null,
        next: r.recommendations,
      };
      return {
        result: `RE ${path.basename(abs)} — hel rapport: ${file}\n${JSON.stringify(compact, null, 1)}`,
        meta: { report: file, risk: r.risk?.score, format: r.kind, path: abs },
        summary: `${path.basename(abs)}: ${r.kind}, risk ${r.risk?.score}/100 (${r.risk?.level})`,
      };
    },
  }),

  def({
    name: 're.strings',
    group: 'reverse',
    risk: 'read',
    desc: 'Extract strings (ascii + utf16) with offsets. Filter with a regex. Used to find URLs, paths, mutexes and important API names.',
    params: {
      path: 'string: fil',
      min: 'number: minimum length (default 5)',
      filter: 'string: regex the string must match',
      encoding: 'string: ascii | utf16 | both [ascii|utf16|both]',
      limit: 'number: max count (default 400)',
      classify: 'boolean: also group as IOCs',
    },
    async run({ path: p, min = 5, filter = '', encoding = 'both', limit = 400, classify: cl = false }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const all = extractStrings(buf, { min: Number(min), encodings: encoding === 'both' ? ['ascii', 'utf16'] : [encoding === 'utf16' ? 'utf16' : 'ascii'], limit: 200000 });
      let rows = all;
      if (filter) {
        const re = new RegExp(filter, 'i');
        rows = all.filter((s) => re.test(s.value));
      }
      const shown = rows.slice(0, Number(limit));
      const body = shown.map((s) => `0x${s.offset.toString(16).padStart(8, '0')} ${s.encoding === 'utf16le' ? 'u16' : '   '} ${s.value.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
      const extra = cl ? `\n\nIOC-kluster:\n${JSON.stringify(classifyStrings(rows.map((s) => s.value)), null, 1).slice(0, 3000)}` : '';
      return { result: `${path.basename(abs)}: ${rows.length} strings (${all.length} total), showing ${shown.length}\n${body}${extra}`, meta: { total: all.length, matched: rows.length }, summary: `${rows.length} strings in ${path.basename(abs)}` };
    },
  }),

  def({
    name: 're.hexdump',
    group: 'reverse',
    risk: 'read',
    desc: 'Hex dump at an offset. Used for headers, the overlay, packer signatures and raw comparison.',
    params: { path: 'string: fil', offset: 'string: 0x40 eller 64', length: 'number: bytes to read (default 512, max 8192)' },
    async run({ path: p, offset = '0', length = 512 }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const off = typeof offset === 'number' ? offset : parseInt(String(offset).replace(/^0x/i, ''), 16) || 0;
      const n = Math.min(8192, Math.max(16, Number(length) || 512));
      const slice = buf.subarray(off, Math.min(buf.length, off + n));
      return { result: `${path.basename(abs)} @0x${off.toString(16)} (${fmt(slice.length)} av ${fmt(buf.length)})\n${hexdump(slice)}`, summary: `hexdump ${fmt(slice.length)} @0x${off.toString(16)}` };
    },
  }),

  def({
    name: 're.search',
    group: 'reverse',
    risk: 'read',
    desc: 'Pattern hunt in bytes: "4d 5a ?? (e8|eb)" or a text string. Returns offset + context.',
    params: { path: 'string: file', pattern: 'string: hex pattern or text', max: 'number: max hits (default 60)', context: 'number: bytes around each hit (default 24)' },
    async run({ path: p, pattern, max = 60, context = 24 }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const isHex = /^[\s0-9a-fx?,;()|]+$/i.test(String(pattern).replace(/ /g, '')) && /[0-9a-f]{2}/i.test(String(pattern));
      const hits = isHex ? findBytes(buf, pattern, { limit: Number(max) }) : allIndexes(buf, Buffer.from(String(pattern), 'latin1'), Number(max));
      const body = hits
        .map((o) => `0x${o.toString(16).padStart(8, '0')}\n  ${buf.subarray(Math.max(0, o - 4), o).toString('hex').replace(/../g, '$1 ').trim()} │ ${hexdump(buf.subarray(o, Math.min(buf.length, o + Number(context)))).split('\n')[0]}`)
        .join('\n');
      return { result: `${hits.length} hits for ${pattern} in ${path.basename(abs)}${hits.length ? `\n${body}` : ''}`, meta: { hits: hits.length, pattern, mode: isHex ? 'hex' : 'text' }, summary: `${hits.length} hits` };
    },
  }),

  def({
    name: 're.entropy',
    group: 'reverse',
    risk: 'read',
    desc: 'Entropy profile per section + block. High entropy = packed or encrypted. Used to decide what to unpack.',
    params: { path: 'string: file', block: 'number: block size in bytes (default 1024)', threshold: 'number: flag above this (default 7.0)' },
    async run({ path: p, block = 1024, threshold = 7.0 }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const win = entropyWindow(buf, { block: Number(block), threshold: Number(threshold) });
      let sections = [];
      try {
        const pe = parsePe(buf);
        sections = pe.sections.map((s) => ({ name: s.name, size: s.rawSize, entropy: Number(entropy(buf, s.rawPointer, Math.min(buf.length, s.rawPointer + s.rawSize))).toFixed(3) }));
      } catch {
        /* inte en PE */
      }
      const islands = findCodeIslands(buf, { minBytes: Math.max(128, Number(block)), max: 8 });
      return {
        result: `${path.basename(abs)}: total entropy ${entropy(buf).toFixed(3)} across ${fmt(buf.length)}\n${sections.length ? `Sections:\n${sections.map((s) => `  ${s.name.padEnd(9)} ${fmt(s.size).padStart(10)}  H=${s.entropy}${s.entropy > 7.2 ? ' ← high' : ''}`).join('\n')}\n` : ''}Blocks above threshold (${threshold}): ${win.length ? `${win.length} blocks, first @0x${win[0]?.offset.toString(16)}, total ${fmt(win.length * block)}` : 'none'}\n${islands.length ? `Non-text islands (shellcode candidates):\n${islands.map((i) => `  ${i.offset} ${i.bytes} byte, printable ${i.printable}\n    ${i.head}`).join('\n')}` : ''}`,
        meta: { blocks: win.length, islands: islands.length },
        summary: `entropy ${entropy(buf).toFixed(2)}, ${win.length} high blocks`,
      };
    },
  }),

  def({
    name: 're.sections',
    group: 'reverse',
    risk: 'read',
    desc: 'Section table with flags, entropy and deviation (name/size/perm). The deviations are what to look at.',
    params: { path: 'string: fil' },
    async run({ path: p }, ctx) {
      const { abs, buf } = await load(ctx, p);
      let pe;
      try {
        pe = parsePe(buf);
      } catch (err) {
        return { ok: false, error: { code: 'not_pe', message: err.message, hint: 'use re.analyze for ELF/Mach-O' } };
      }
      const rows = pe.sections.map((s) => {
        const e = entropy(buf, s.rawPointer, Math.min(buf.length, s.rawPointer + s.rawSize));
        return `${(s.name || '?').padEnd(9)} VA=0x${s.virtualAddress.toString(16).padStart(8, '0')} rawSz=${String(s.rawSize).padStart(9)} virSz=${String(s.virtualSize).padStart(9)} H=${e.toFixed(3).padStart(6)} ${s.executable ? 'X' : '-'}${s.writable ? 'W' : '-'}${s.readable ? 'R' : '-'} ${s.flags.join(',')}`;
      });
      const anomalies = [];
      for (const s of pe.sections) {
        if (s.executable && s.writable) anomalies.push(`${s.name}: executable AND writable`);
        if (s.rawSize === 0 && s.virtualSize > 0) anomalies.push(`${s.name}: empty on disk but ${s.virtualSize} bytes in memory (BSS/packer)`);
        if (/\.text$/.test(s.name) && s.rawSize % 0x200) anomalies.push(`${s.name}: rawSize inte alignerad — manipulering?`);
      }
      return {
        result: `${path.basename(abs)} — ${pe.sections.length} sektioner (${pe.arch}, ${pe.optional.subsystem}, ${pe.isDll ? 'DLL' : 'EXE'})\n${rows.join('\n')}\n\nAnomalier: ${anomalies.length ? `\n- ${anomalies.join('\n- ')}` : 'inga uppenbara'}`,
        summary: `${pe.sections.length} sektioner, ${anomalies.length} anomalier`,
      };
    },
  }),

  def({
    name: 're.imports',
    group: 'reverse',
    risk: 'read',
    desc: 'Import tables (DLL → functions) with risk flags. Delay imports included.',
    params: { path: 'string: file', dll: 'string: filter on dll name', flagged: 'boolean: only risky ones' },
    async run({ path: p, dll = '', flagged = false }, ctx) {
      const { abs, buf } = await load(ctx, p);
      let pe;
      try {
        pe = parsePe(buf);
      } catch {
        return { ok: false, error: { code: 'not_pe', message: 'no PE import table (for ELF use re.analyze)', hint: 'use re.analyze' } };
      }
      const score = scoreApis(pe.imports);
      const all = [...pe.imports, ...(pe.delayImports || []).map((d) => ({ ...d, delayed: true }))];
      let rows = all;
      if (dll) rows = rows.filter((i) => new RegExp(dll, 'i').test(i.dll));
      const body = flagged
        ? score.flagged.map((f) => `${'!'.repeat(f.severity)} ${f.dll}!${f.api} — ${f.why}`).join('\n') || 'nothing flagged'
        : rows.map((i) => `${i.delayed ? '@delay ' : ''}${i.dll} (${i.count})\n  ${(i.functions || []).slice(0, 40).map((f) => f.name).join(', ')}`).join('\n');
      return { result: `${path.basename(abs)} — ${rows.length} DLLs, ${score.flagged.length} risky calls, imphash ${pe.imphash || 'n/a'}\n\n${body}`, meta: { dlls: rows.length, flagged: score.flagged.length }, summary: `${rows.length} DLL-imports, ${score.flagged.length} flaggade` };
    },
  }),

  def({
    name: 're.exports',
    group: 'reverse',
    risk: 'read',
    desc: 'Export table (for DLLs) + forwarded exports. Used to list hook and backend functions.',
    params: { path: 'string: fil', limit: 'number: max count (default 200)' },
    async run({ path: p, limit = 200 }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const pe = parsePe(buf);
      if (!pe.exports) return { result: `${path.basename(abs)}: no export table (typical for an EXE)`, summary: 'no exports' };
      const e = pe.exports;
      return {
        result: `${path.basename(abs)} — exports (${e.numNames} namngivna av ${e.numFunctions} funksjoner, bas ${e.ordinalBase})\n${(e.functions || []).slice(0, limit).map((f) => `  #${f.ordinal} 0x${f.rva?.toString(16) || '?'} ${f.name}${f.forwarder ? ` → ${f.forwarder}` : ''}`).join('\n')}`,
        summary: `${e.numNames} exports`,
      };
    },
  }),

  def({
    name: 're.yara',
    group: 'reverse',
    risk: 'read',
    desc: 'Run YARA rules with the built-in mini engine — no yara binary needed. Add your own rules in rules/majin.yar.',
    params: { path: 'string: file', ruleText: 'string: your own rules in YARA syntax', only: 'string: filter on rule name (regex)' },
    async run({ path: p, ruleText = '', only = '' }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const rules = parseRules(ruleText || userRules(ctx));
      const hits = yaraScan(buf, rules).filter((h) => (only ? new RegExp(only, 'i').test(h.rule) : true));
      return {
        result: `${path.basename(abs)}: ${hits.length}/${rules.length} rules matched\n${hits.map((h) => `${h.rule}${h.tags.length ? ` [${h.tags.join(',')}]` : ''} ${h.meta?.severity ? `sev=${h.meta.severity}` : ''}\n${h.strings.map((s) => `   ${s.name} x${s.count} @ ${s.offsets.map((o) => `0x${o.toString(16)}`).join(', ')}`).join('\n')}`).join('\n') || 'no hits'}`,
        meta: { rules: rules.length, hits: hits.length },
        summary: `YARA ${hits.length}/${rules.length} hits`,
      };
    },
  }),

  def({
    name: 're.iocs',
    group: 'reverse',
    risk: 'read',
    desc: 'Pull out and group IOCs (URLs, IPs, file paths, registry keys, mutexes, e-mail, GUIDs) and resolve domains when asked.',
    params: { path: 'string: file', resolve: 'boolean: resolve the domains via DNS', save: 'boolean: write the list to workspace/re/<name>-iocs.json' },
    async run({ path: p, resolve = false, save = false }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const strs = extractStrings(buf, { limit: 120000 });
      const c = classifyStrings(strs.map((s) => s.value));
      const domains = [...new Set([...c.urls, ...c.files].flatMap((x) => (String(x).match(/https?:\/\/([^\/\s"']+)/gi) || []).map((u) => u.replace(/^https?:\/\//i, '').split('/')[0])))];
      const out = { file: path.basename(abs), urls: c.urls, ips: c.ips, domains, files: c.files.slice(0, 40), registry: c.registry, mutexes: c.mutexes, emails: c.emails, suspicious: c.suspicious };
      if (resolve && domains.length) {
        const dns = await import('node:dns').then((m) => m.default);
        out.dns = {};
        for (const d of domains.slice(0, 12)) {
          try {
            out.dns[d] = await dns.promises.resolve4(d);
          } catch (err) {
            out.dns[d] = `error: ${err.code || err.message}`;
          }
        }
      }
      let file = null;
      if (save) {
        file = path.join(ctx.cfg.get('workspace'), 're', `${path.basename(abs)}-iocs.json`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(out, null, 1));
      }
      const total = Object.values(out).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
      return { result: `IOC: ${total} indikatorer${file ? ` → ${file}` : ''}\n${JSON.stringify(out, null, 1).slice(0, 12000)}`, meta: { file, total }, summary: `${total} IOC-poster` };
    },
  }),

  def({
    name: 're.overlay',
    group: 'reverse',
    risk: 'read',
    desc: 'Read (and optionally extract) the data after the last section — where packers and self-extractors hide.',
    params: { path: 'string: fil', extract: 'boolean: skriv overlayen till workspace/re/<namn>.overlay', maxPeek: 'number: byte att visa (default 256)' },
    async run({ path: p, extract = false, maxPeek = 256 }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const pe = parsePe(buf);
      const data = peOverlay(buf, pe);
      if (!data.length) return { result: `${path.basename(abs)}: no overlay (the last section ends the file)`, summary: 'no overlay' };
      let file = null;
      if (extract) {
        file = path.join(ctx.cfg.get('workspace'), 're', `${path.basename(abs)}.overlay`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, data);
      }
      const e = entropy(data);
      const zip = data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      return {
        result: `overlay ${fmt(data.length)} @0x${pe.overlay.offset.toString(16)} (entropy ${e.toFixed(3)})${zip ? ' — it is a ZIP!' : ''}${file ? `\nsparad: ${file}` : ''}\n${hexdump(data.subarray(0, Math.min(data.length, Number(maxPeek))))}`,
        meta: { size: data.length, offset: pe.overlay.offset, entropy: e, file, zip },
        summary: `overlay ${fmt(data.length)} (H=${e.toFixed(2)})`,
      };
    },
  }),

  def({
    name: 're.extract',
    group: 'reverse',
    risk: 'write',
    desc: 'Extract ZIP/APK/asar entries or a PE resource into the workspace. Used to reach embedded content.',
    params: { path: 'string: archive or PE', entry: 'string: entry name (regex) inside the archive', all: 'boolean: take every match', resourceType: 'string: PE resource to dump (RCDATA, MANIFEST, VERSION)', out: 'string: target folder (default workspace/re/<name>)' },
    async run({ path: p, entry = '', all = false, resourceType = '', out = '' }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const base = resolveIn(ctx, out || path.join('re', `${path.basename(abs)}.extracted`));
      await fs.mkdir(base.abs, { recursive: true });
      const entries = zipEntries(buf);
      if (entries) {
        let picked = entries.filter((e) => !e.name.endsWith('/'));
        if (entry) picked = picked.filter((e) => new RegExp(entry, 'i').test(e.name));
        if (!all) picked = picked.slice(0, 60);
        const written = [];
        for (const e of picked) {
          const data = zipRead(buf, e);
          if (!data) continue;
          const dest = path.join(base.abs, e.name.replace(/[\\:*?"<>|]/g, '_'));
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, data);
          written.push(`${e.name} (${fmt(e.usize)})`);
        }
        return { result: `extraherade ${written.length} poster till ${base.abs}\n${written.slice(0, 80).join('\n')}`, summary: `${written.length} poster extraherade` };
      }
      try {
        const pe = parsePe(buf);
        const res = peResources(buf, pe, { max: 200 }).filter((r) => (resourceType ? String(r.typeName).toLowerCase().includes(String(resourceType).toLowerCase()) : true));
        if (!res.length) return { ok: false, error: { code: 'nothing', message: 'neither an archive nor selectable PE resources' } };
        const written = [];
        for (const r of res.slice(0, all ? 400 : 40)) {
          const dest = path.join(base.abs, `${r.typeName}_${r.id}_${r.offset}.bin`);
          await fs.writeFile(dest, buf.subarray(r.offset, r.offset + r.size));
          written.push(dest);
        }
        const vi = peVersionInfo(buf, peResources(buf, pe, { max: 200 }));
        return { result: `dumpade ${written.length} resurser till ${base.abs}\n${written.map((w) => path.basename(w)).join('\n')}${vi ? `\n\nVersionInfo:\n${JSON.stringify(vi, null, 1)}` : ''}`, summary: `${written.length} resurser` };
      } catch (err) {
        return { ok: false, error: { code: 'extract_failed', message: err.message } };
      }
    },
  }),

  def({
    name: 're.apk',
    group: 'reverse',
    risk: 'read',
    desc: 'Android package: permissions, components, DEX sizes, signer — no apktool needed.',
    params: { path: 'string: .apk/.aab' },
    async run({ path: p }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const a = apkPeek(buf);
      if (!a) return { ok: false, error: { code: 'not_apk', message: 'no ZIP/APK structure in the file' } };
      return {
        result: `${path.basename(abs)} — APK/AAB\n  entries: ${a.entries}\n  dex: ${a.dex.map((d) => `${d.name} ${fmt(d.size)}`).join(', ') || 'none'}\n  package: ${a.packageGuess || '?'}\n  debuggable: ${a.debuggable ? 'YES (test build!)' : 'no'}\n  network security: ${a.networkSecurity ? 'network_security_config.xml present' : 'none'}\n  signer: ${a.v2Signer ? 'RSA/DSA blobs in META-INF' : 'unknown'}\n  permissions (${a.permissions.length}):\n    ${a.permissions.join('\n    ')}\n  komponenter (${a.components.length}):\n    ${a.components.slice(0, 40).join('\n    ')}\n  lib: ${a.libs.slice(0, 12).join(', ')}`,
        meta: a,
        summary: `APK ${a.entries} poster, ${a.permissions.length} permissions`,
      };
    },
  }),

  def({
    name: 're.pcap',
    group: 'reverse',
    risk: 'read',
    desc: 'Summarize a pcap/pcapng: hosts, ports, HTTP requests and DNS names. Used for C2 traffic from a sandbox run.',
    params: { path: 'string: .pcap/.cap' },
    async run({ path: p }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const s = pcapSummary(buf);
      if (!s) return { ok: false, error: { code: 'not_pcap', message: 'no pcap magic in the file' } };
      return { result: `${path.basename(abs)}: ${s.packets} packets (link type ${s.linkType})\nHosts: ${s.hosts.join(', ')}\nPorts: ${s.ports.join(', ')}\nHTTP:\n  ${s.http.join('\n  ')}\nDNS:\n  ${s.dns.join('\n  ')}`, meta: s, summary: `${s.packets} packets, ${s.hosts.length} hosts` };
    },
  }),

  def({
    name: 're.diff',
    group: 'reverse',
    risk: 'read',
    desc: 'Compare two binaries (versions, variants, clean vs injected). Gives hash/import/string deltas plus a section diff.',
    params: { a: 'string: the first file', b: 'string: the second file', strings: 'number: how many strings to compare' },
    async run({ a, b, strings = 6000 }, ctx) {
      const A = await load(ctx, a);
      const B = await load(ctx, b);
      const ea = tryParse(A.buf);
      const eb = tryParse(B.buf);
      const sa = new Set(extractStrings(A.buf, { limit: Number(strings) }).map((s) => s.value));
      const sb = new Set(extractStrings(B.buf, { limit: Number(strings) }).map((s) => s.value));
      const ia = new Set((ea?.imports || []).flatMap((i) => (i.functions || []).map((f) => `${i.dll}!${f.name}`)));
      const ib = new Set((eb?.imports || []).flatMap((i) => (i.functions || []).map((f) => `${i.dll}!${f.name}`)));
      const strSim = jaccard(sa, sb);
      const impSim = jaccard(ia, ib);
      const onlyA = [...ia].filter((x) => !ib.has(x));
      const onlyB = [...ib].filter((x) => !ia.has(x));
      const sOnlyA = [...sa].filter((x) => !sb.has(x)).slice(0, 40);
      const sOnlyB = [...sb].filter((x) => !sa.has(x)).slice(0, 40);
      return {
        result: `DIFF ${path.basename(A.abs)} ↔ ${path.basename(B.abs)}
  storlek: ${fmt(A.buf.length)} ↔ ${fmt(B.buf.length)} (${B.buf.length - A.buf.length >= 0 ? '+' : ''}${B.buf.length - A.buf.length} byte)
  sha256: ${A.buf.length === B.buf.length && A.buf.equals(B.buf) ? 'IDENTISKA' : 'olika'}
  string similarity: ${strSim.toFixed(3)} · import similarity: ${impSim.toFixed(3)}
  imphash: ${ea?.imphash || '-'} ↔ ${eb?.imphash || '-'}${ea && eb && ea.imphash && ea.imphash === eb.imphash ? '  ← SAME IMPORT PATTERN' : ''}
  entropi: ${entropy(A.buf).toFixed(3)} ↔ ${entropy(B.buf).toFixed(3)}
  imports bara i A: ${onlyA.slice(0, 20).join(', ') || '-'}
  imports bara i B: ${onlyB.slice(0, 20).join(', ') || '-'}
  strings only in A: ${sOnlyA.slice(0, 12).join(' | ') || '-'}
  strings only in B: ${sOnlyB.slice(0, 12).join(' | ') || '-'}`,
        meta: { strSim, impSim, sameImphash: ea?.imphash === eb?.imphash },
        summary: `diff: strings ${strSim.toFixed(2)}, imports ${impSim.toFixed(2)}`,
      };
    },
  }),

  def({
    name: 're.modules',
    group: 'reverse',
    risk: 'read',
    desc: 'Modules/DLLs loaded in a running process + unusual paths. Used to see injection or hooking live.',
    params: { process: 'string: process name or pid', filter: 'string: regex on the module path' },
    async run({ process: proc = '', filter = '' }) {
      const { runShell, IS_WIN } = await import('./shell.js');
      if (!IS_WIN) return { ok: false, error: { code: 'windows_only', message: 'the module list uses Get-Process Modules', hint: 'on Linux: read /proc/<pid>/maps via shell.run' } };
      const sel = /^\d+$/.test(String(proc)) ? `(Get-Process -Id ${proc})` : proc ? `(Get-Process -Name '${String(proc).replace(/'/g, "''")}')` : '(Get-Process | Select -First 1)';
      const cmd = `${sel} | ForEach-Object { $_.Modules | ForEach-Object { "{0}|{1}|{2}" -f $_.ModuleName,$_.FileName,$_.Size } }`;
      const r = await runShell(cmd, { timeoutSec: 45, maxChars: 80000 });
      let lines = String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (filter) lines = lines.filter((l) => new RegExp(filter, 'i').test(l));
      const suspicious = lines.filter((l) => /(\\Temp\\|\\AppData\\Local\\Temp|\\Users\\Public|\\ProgramData\\|NoLoad|rundll|\\Windows\\Help|\.tmp$|\.dat$)/i.test(l));
      return {
        result: `${lines.length} moduler${suspicious.length ? `\n\nUnusual paths (${suspicious.length}):\n${suspicious.slice(0, 25).join('\n')}` : '\nno suspicious paths'}\n\nFirst 40:\n${lines.slice(0, 40).join('\n')}`,
        meta: { modules: lines.length, suspicious: suspicious.length },
        summary: `${lines.length} modules, ${suspicious.length} unexpected`,
      };
    },
  }),

  def({
    name: 're.tool',
    group: 'reverse',
    risk: 'exec',
    desc: 'Hook up external RE tools when you need real power: ghidra (decompile), rizin, objdump, binwalk, upx, yara, jadx, apktool, ilspycmd. Auto-detects what is installed.',
    params: {
      tool: 'string: ghidra | rizin | objdump | binwalk | upx | yara | jadx | apktool | ilspycmd | nm',
      path: 'string: filen som behandlas',
      commands: 'string: rizin-kommandon (semikollon) eller objdump-flaggor',
      args: 'array: extra CLI-argument',
      extract: 'boolean: binwalk -e',
      out: 'string: target folder/file',
      timeoutSec: 'number: timeout (ghidra kan ta minuter)',
    },
    examples: ['re.tool({tool:"rizin",path:"a.exe",commands:"aa;afl;s entry0;pdf"})'],
        required: ['tool'],
async run({ tool, path: p = '', commands = '', args = '', extract = false, out = '', timeoutSec = 0 }, ctx) {
      const { abs } = resolveIn(ctx, p);
      const avail = await detectTools({});
      if (!avail[tool]?.available) {
        const spec = TOOL_SPECS.find((s) => s.id === tool);
        return {
          ok: false,
          error: { code: 'tool_missing', message: `${tool} is not installed on this machine`, hint: `${spec?.hint || 'install the tool'}\navailabliga nu: ${Object.values(avail).filter((v) => v.available).map((v) => v.label).join(', ') || 'inga'}` },
        };
      }
      const res = await callTool(tool, { file: abs, commands: commands ? String(commands).split(';') : undefined, args, extract, out: out ? resolveIn(ctx, out).abs : undefined, timeoutMs: timeoutSec ? Number(timeoutSec) * 1000 : undefined }, ctx.cfg);
      if (!res.ok) return { ok: false, error: { code: 'tool_failed', message: res.error || res.stderr || `exit ${res.exitCode}`, hint: res.cmd ? `kommando: ${res.cmd}` : null, ...{ stdout: res.stdout?.slice(0, 3000) } } };
      const file = path.join(dirs.out, `re-tool-${tool}-${Date.now().toString(36)}.txt`);
      await fs.mkdir(dirs.out, { recursive: true });
      await fs.writeFile(file, `${res.cmd}\n\n${res.stdout || ''}${res.stderr ? `\n--stderr--\n${res.stderr}` : ''}`);
      return { result: `${tool} ran (${fmt((res.stdout || '').length)}, ${res.ms}ms) → full output: ${file}\n\n${clipText(res.stdout || '', 6000)}${res.stderr ? `\n--stderr--\n${clipText(res.stderr, 1200)}` : ''}`, meta: { file, tool }, summary: `${tool} klart (${res.ms}ms)` };
    },
  }),

  def({
    name: 're.tools',
    group: 'reverse',
    risk: 'read',
    desc: 'Which external RE tools exist and what is missing. The built-in parser needs nothing — this is for deeper work.',
    params: { refresh: 'boolean: look it up in PATH again' },
    async run({ refresh = false }) {
      const d = await detectTools({ refresh: Boolean(refresh) });
      const rows = Object.entries(d).map(([id, v]) => `${v.available ? '✓' : '·'} ${id.padEnd(9)} ${v.label}${v.available ? ` — ${v.path}` : ` — ${v.hint || 'inte installerad'}`}`);
      return { result: `externa RE-verktyg:\n${rows.join('\n')}\n\nInbyggt (ingen installation): PE/ELF/Mach-O-parser, entropi, strings, mini-YARA, opcode-skanning, ZIP/APK, pcap, diff.`, summary: `${Object.values(d).filter((v) => v.available).length}/${rows.length} verktyg hittade` };
    },
  }),

  def({
    name: 're.disasm',
    group: 'reverse',
    risk: 'read',
    desc: 'Disassemble at an address/offset. Uses rizin/objdump when present — otherwise bytes + pattern analysis, never guesses.',
    params: { path: 'string: fil', address: 'string: 0x401000 eller offset', count: 'number: antal instruktioner (default 80)', mode: 'string: auto | rizin | objdump | bytes' },
    async run({ path: p, address = '0', count = 80, mode = 'auto' }, ctx) {
      const { abs, buf } = await load(ctx, p);
      const avail = await detectTools({});
      const off = typeof address === 'number' ? address : parseInt(String(address).replace(/^0x/i, ''), 16) || 0;
      if (mode !== 'bytes' && avail.rizin?.available) {
        const cmd = mode === 'objdump' && avail.objdump ? null : `s 0x${off.toString(16)};pd ${Math.min(400, Number(count))}`;
        const res = await callTool('rizin', { file: abs, commands: [cmd] }, ctx.cfg);
        if (res.ok) return { result: `rizin @0x${off.toString(16)}\n${clipText(res.stdout || '', 6000)}`, summary: `disasm ${count} instruktioner` };
      }
      if (mode !== 'bytes' && avail.objdump?.available) {
        const res = await callTool('objdump', { file: abs, flags: ['-d', '--start-address', `0x${off.toString(16)}`, '--stop-address', `0x${(off + Number(count) * 8).toString(16)}`] }, ctx.cfg);
        if (res.ok) return { result: `objdump @0x${off.toString(16)}\n${clipText(res.stdout || '', 6000)}`, summary: 'disasm via objdump' };
      }
      const slice = buf.subarray(off, Math.min(buf.length, off + Number(count) * 4));
      const hits = opcodeScan(buf, { sections: [{ name: 'slice', rawPointer: off, rawSize: buf.length, executable: true }] }, 'pe');
      return {
        result: `NO disassembler installed — raw bytes @0x${off.toString(16)}:\n${hexdump(slice, { width: 16 })}\n\nPatterns in the whole file: ${hits.hits.map((h) => `${h.name} x${h.count}`).join(', ') || 'none'}\nInstall one for real coverage: winget install rizin.rizin  (or binutils for objdump)`,
        meta: { raw: true },
        summary: `bytes @0x${off.toString(16)} (ingen disassembler)`,
      };
    },
  }),

  def({
    name: 're.unpack',
    group: 'reverse',
    risk: 'write',
    desc: 'Try to unpack known packers. UPX works directly; otherwise: entropy/section assessment + carving the overlay.',
    params: { path: 'string: file', out: 'string: target file' },
    async run({ path: p, out }, ctx) {
      const abs = resolveIn(ctx, p).abs;
      const buf = await fs.readFile(abs);
      const isUpx = /UPX[01!]/.test(buf.subarray(0, 4096).toString('latin1')) || /UPX[01]/.test(buf.subarray(Math.max(0, buf.length - 4096)).toString('latin1'));
      const avail = await detectTools({});
      if (isUpx && avail.upx?.available) {
        const res = await callTool('upx', { file: abs, out: out ? resolveIn(ctx, out).abs : undefined }, ctx.cfg);
        if (res.ok) {
          const target = out ? resolveIn(ctx, out).abs : `${abs}.unpacked`;
          if (fss.existsSync(target)) {
            const r = analyze(fss.readFileSync(target), { name: path.basename(target), rules: parseRules(DEFAULT_RULES_TEXT) });
            return { result: `UPX unpacked → ${target} (${fmt(fss.statSync(target).size)}). Risk ${r.risk.score}/100, imports ${r.importCount}, ${r.strings?.total || 0} strings.\nNext: re.analyze({path:"${target}"})`, summary: `unpacked to ${path.basename(target)}` };
          }
        }
        return { ok: false, error: { code: 'upx_failed', message: res.stderr || res.error || 'unknown error', hint: res.cmd } };
      }
      const pe = tryParse(buf);
      const overlay = pe ? peOverlay(buf, pe) : Buffer.alloc(0);
      return {
        result: `${isUpx ? 'UPX signature present but the upx binary is not installed' : 'no UPX signature'}.\nEntropy ${entropy(buf).toFixed(3)}, ${pe ? `${pe.sections.length} sections, overlay ${fmt(overlay.length)}`   : 'no PE header'}.\nProva: re.tool({tool:"binwalk", path:"${path.relative(ctx.cfg.get('workspace'), abs)}", extract:true}) for embedded archives, or run the file in a sandbox and dump memory (ghidra/rizin will not beat VMProtect/Themida statically).`,
        summary: isUpx ? 'UPX present, no upx binary' : 'no simple packer found',
      };
    },
  }),

  def({
    name: 're.hash',
    group: 'reverse',
    risk: 'read',
    desc: 'MD5/SHA1/SHA256 + imphash for one or more files. Used to look up known samples.',
    params: { path: 'string: fil, eller mapp med glob', glob: 'string: bara vid mapp (default *)' },
    async run({ path: p, glob = '*' }, ctx) {
      const { abs } = resolveIn(ctx, p);
      const st = await fs.stat(abs);
      const files = st.isDirectory() ? (await fs.readdir(abs)).filter((f) => new RegExp(glob.replace(/\*/g, '.*'), 'i').test(f)).map((f) => path.join(abs, f)) : [abs];
      const rows = [];
      const hashes = [];
      for (const f of files.slice(0, 300)) {
        try {
          const b = await fs.readFile(f);
          const h = (a) => crypto.createHash(a).update(b).digest('hex');
          const pe = tryParse(b);
          const md5 = h('md5');
          const sha256 = h('sha256');
          rows.push(`${md5}  ${sha256.slice(0, 32)}…  ${fmt(b.length).padStart(10)}  ${path.basename(f)}${pe?.imphash ? `  imphash=${pe.imphash}` : ''}`);
          hashes.push({ file: f, md5, sha1: h('sha1'), sha256, size: b.length, imphash: pe?.imphash || null });
        } catch (e) {
          rows.push(`—  could not read ${path.basename(f)}: ${e.code || e.message}`);
        }
      }
      return { result: rows.join('\n'), meta: { hashes, count: hashes.length }, summary: `${rows.length} files hashed` };
    },
  }),

  def({
    name: 're.rules',
    group: 'reverse',
    risk: 'read',
    desc: 'List and save YARA rules in <home>/rules/majin.yar (MAJIN\'s own rule database).',
    params: { action: 'string: list | save | delete [list|save|delete]', name: 'string: rule name', text: 'string: rule text (saved into the file)' },
    async run({ action = 'list', name = '', text = '' }, ctx) {
      const file = path.join(dirs.rules, 'majin.yar');
      const cur = fss.existsSync(file) ? fss.readFileSync(file, 'utf8') : '';
      if (action === 'list') {
        const builtin = parseRules(DEFAULT_RULES_TEXT).map((r) => `${r.name} (built-in)`);
        const user = parseRules(cur).map((r) => `${r.name} (yours)`);
        return { result: `${builtin.length + user.length} rules available\n${[...builtin, ...user].join('\n')}`, meta: { builtin: builtin.length, user: user.length }, summary: `${builtin.length + user.length} YARA rules` };
      }
      const rulesFile = file;
      await fs.mkdir(path.dirname(rulesFile), { recursive: true });
      if (action === 'delete') {
        const kept = parseRules(cur).filter((r) => r.name !== name);
        await fs.writeFile(rulesFile, kept.length ? `${rulesToText(kept)}\n` : '');
        return { result: kept.length ? `removed ${name}, ${kept.length} rules left in ${rulesFile}` : `tog bort ${name} (the file is now empty)`, summary: `regel ${name} bort` };
      }
      const parsed = parseRules(text || '');
      if (!parsed.length) return { ok: false, error: { code: 'bad_rule', message: 'could not parse the rule text', hint: 'format: rule Namn { strings: $a = "x" } condition: any of them }' } };
      await fs.appendFile(rulesFile, `\n${(text || '').trim()}\n`);
      bus.info('yara.add', { name: parsed[0].name, file: rulesFile });
      return { result: `saved ${parsed.length} rule(s) in ${rulesFile}. They now run automatically in re.analyze and re.yara.`, summary: `${parsed.length} rules sparade` };
    },
  }),
];

function tryParse(buf) {
  try {
    return parsePe(buf);
  } catch {
    return null;
  }
}

function clipText(s, n) {
  return s.length > n ? `${s.slice(0, n)}\n…[${s.length - n} tecken klippt — se filen]` : s;
}

void shingles;
