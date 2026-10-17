/**
 * MAJIN RE — analysmotorn.
 * En ingång: analyze(buffer) → en strukturerad rapport en modell kan läsa direkt.
 * Inget av stegen kräver extern mjukvara; extern verktyg (ghidra/rizin/objdump)
 * kopplas på automatiskt om de finns, annars fungerar allt ändå.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { entropy, strings as getStrings, classify as classifyStrings, entropyProfile } from './strings.js';
import { scanEmbedded } from './containers.js';
import { parsePe } from './pe.js';
import { parseElf, parseMachO } from './elf.js';
import { detectFormat, peekContainer } from './containers.js';
import { scan as yaraScan } from './yara.js';
import { scoreApis, detectPackers, risk } from './sigs.js';
import { opcodeScan } from './scan.js';

export const DEFAULT_RULES_TEXT = `
rule Packer_UPX : packer {
  meta:
    severity = "low"
    author = "majin"
  strings:
    $s1 = "UPX0" ascii
    $s2 = "UPX1" ascii wide
    $s3 = "UPX!" ascii
  condition:
    any of them and filesize < 200MB
}

rule Suspicious_Injection : injection behav {
  meta:
    severity = "high"
  strings:
    $a = "NtUnmapViewOfSection" ascii
    $b = "WriteProcessMemory" ascii
    $c = "CreateRemoteThread" ascii
    $d = "SetThreadContext" ascii
    $e = "VirtualAllocEx" ascii
  condition:
    2 of them
}

rule Anti_Debug : evasion {
  meta:
    severity = "medium"
  strings:
    $a = "IsDebuggerPresent" ascii
    $b = "CheckRemoteDebuggerPresent" ascii
    $c = "OutputDebugStringA" ascii
    $d = "NtQueryInformationProcess" ascii
    $e = "SeDebugPrivilege" ascii wide
  condition:
    2 of them
}

rule Ransomware_Behaviour : ransom behav {
  meta:
    severity = "high"
  strings:
    $a = "vssadmin" ascii nocase
    $b = "wbadmin" ascii nocase
    $c = "shadow copies" ascii nocase
    $d = "CryptEncrypt" ascii
    $e = "README_FOR_DECRYPT" ascii nocase
    $f = ".locked" ascii nocase
    $g = "restore your files" ascii nocase wide
  condition:
    3 of them
}

rule Downloader_Behav : c2 net {
  meta:
    severity = "high"
  strings:
    $a = "URLDownloadToFileA" ascii
    $b = "InternetOpenUrlA" ascii
    $c = "WinHttpOpen" ascii
    $d = "POST /" ascii
    $e = "User-Agent: " ascii
  condition:
    ($a or $b or $c) and ($d or $e)
}

rule Embedded_Powershell : script behav {
  meta:
    severity = "medium"
  strings:
    $a = "-EncodedCommand" ascii nocase
    $b = "frombase64string" ascii nocase
    $c = "powershell.exe" ascii nocase wide
    $d = "Invoke-Expression" ascii nocase
  condition:
    any of them
}

rule VM_Detection : evasion sandbox {
  meta:
    severity = "medium"
  strings:
    $a = "VMware, Inc" ascii
    $b = "VBOX" ascii
    $c = "VirtualBox" ascii nocase
    $d = "qemu" ascii nocase
    $e = "Sandboxie" ascii nocase
    $f = "GetSystemFirmwareTable" ascii
  condition:
    any of them
}

rule DotNet_SingleFile : framework {
  meta:
    severity = "info"
  strings:
    $a = "single-file-host" ascii nocase
    $b = "DOTNET_64" ascii
    $c = "System.Private.CoreLib" ascii
  condition:
    2 of them
}

rule Electron_App : framework {
  meta:
    severity = "info"
  strings:
    $a = "electron.asar" ascii
    $b = "chrome_100_percent.pak" ascii
    $c = "resources.pak" ascii
  condition:
    2 of them
}

rule Go_Binary : framework {
  meta:
    severity = "info"
  strings:
    $a = "go:buildid" ascii
    $b = "runtime.gopanic" ascii
    $c = "goroutine " ascii
  condition:
    2 of them
}

rule Rust_Binary : framework {
  meta:
    severity = "info"
  strings:
    $a = "rust_begin_unwind" ascii
    $b = "core::panicking" ascii
    $c = "invalid safety" ascii nocase
  condition:
    any of them
}
`;

export function analyze(buf, opts = {}) {
  const { name = 'buffer', rules = [], maxStrings = 4000 } = opts;
  const t0 = Date.now();
  if (!buf?.length) throw new Error('tom fil');
  const format = detectFormat(buf);
  const full = entropy(buf, 0, Math.min(buf.length, 4_000_000));
  const strs = getStrings(buf, { limit: maxStrings });
  const text = strs.slice(0, 1500).map((s) => s.value).join('\n');

  const report = {
    file: name,
    ext: path.extname(name).toLowerCase(),
    size: buf.length,
    kind: format.kind,
    detected: format.detected,
    entropy: { overall: full, profile: entropyProfile(buf) },
    strings: { total: strs.length, sample: strs.slice(0, 120) },
    iocs: classifyStrings(strs.slice(0, 8000).map((s) => s.value)),
    yara: yaraScan(buf, rules),
    timings: {},
  };

  let pe = null;
  let elf = null;
  let macho = null;
  if (format.kind === 'pe') {
    pe = safe(() => parsePe(buf), report);
    if (pe) {
      for (const s of pe.sections) s.entropy = entropy(buf, s.rawPointer, Math.min(buf.length, s.rawPointer + s.rawSize));
      report.arch = pe.arch;
      report.bits = pe.bits;
      report.subsystem = pe.optional.subsystem;
      report.isDll = pe.isDll;
      report.entry = pe.entryPoint;
      report.sections = pe.sections.map(({ name: n, virtualAddress, virtualSize, rawSize, rawPointer, entropy: e, flags, executable, writable, readable }) => ({ name: n, rva: virtualAddress, virtualSize, rawSize, rawPointer, entropy: e, flags, executable, writable, readable }));
      report.characteristics = pe.characteristics;
      report.timestamp = pe.timestamp;
      report.hashes = pe.hashes;
      report.imphash = pe.imphash;
      report.dllFlags = pe.optional.dllFlags;
      report.security = {
        aslr: pe.optional.dllFlags.some((f) => /DYNAMIC_BASE/.test(f.name)),
        dep: pe.optional.dllFlags.some((f) => /NX_COMPAT/.test(f.name)),
        cfg: Boolean(pe.loadConfig?.cfgEnabled),
        gs: pe.optional.dllFlags.some((f) => /INTEGRITY/.test(f.name)),
        controlFlowGuard: pe.optional.dllFlags.some((f) => /GUARD_CF/.test(f.name)),
        signed: pe.certificate?.present || false,
        certLength: pe.certificate?.bytes || 0,
        certTypeOk: pe.certificate?.typeOk ?? null,
        signers: pe.certificate?.issuers || [],
      };
      report.rich = pe.rich;
      report.imports = pe.imports.map((i) => ({ dll: i.dll, count: i.count, functions: i.functions.slice(0, 80).map((f) => f.name) }));
      report.importCount = pe.imports.reduce((n, i) => n + i.count, 0);
      report.exports = pe.exports ? { dllName: pe.exports.dllName, count: pe.exports.numNames, functions: pe.exports.functions.slice(0, 60).map((f) => f.name) } : null;
      report.delayImports = (pe.delayImports || []).map((d) => ({ dll: d.dll, count: d.count }));
      report.tls = pe.tls;
      report.resources = pe.resources;
      report.debug = pe.debug;
      report.pdb = pe.debug?.find((d) => d.pdb)?.pdb?.path || null;
      report.relocations = pe.relocations;
      report.overlay = pe.overlay;
      report.dotnet = pe.dotnet;
      report.symbols = pe.symbols?.slice(0, 40) || [];
      report.sectionsOfInterest = pe.sections
        .map((s) => ({ ...s, ratio: s.rawSize ? s.rawSize / buf.length : 0 }))
        .filter((s) => s.entropy > 7 || (s.executable && s.writable))
        .map((s) => ({ name: s.name, entropy: s.entropy, executable: s.executable, writable: s.writable, size: s.rawSize }));
    }
  } else if (format.kind === 'elf') {
    elf = safe(() => parseElf(buf), report);
    if (elf) {
      Object.assign(report, {
        arch: elf.arch,
        bits: elf.bits,
        elfType: elf.type,
        pie: elf.pie,
        interpreter: elf.interpreter,
        entry: { rva: elf.entry },
        sections: elf.sections.map((s) => ({ name: s.name, rva: s.addr, rawSize: s.size, rawPointer: s.offset, entropy: entropy(buf, s.offset, Math.min(buf.length, s.offset + s.size)), executable: s.executable, writable: s.writable })),
        segments: elf.segments,
        imports: elf.imports.slice(0, 400).map((n) => ({ name: n })),
        importCount: elf.imports.length,
        exports: elf.exports?.length ? { count: elf.exports.length, functions: elf.exports.slice(0, 60) } : null,
        dynamic: elf.dynamic,
        symbols: elf.symbols,
        stripped: elf.stripped,
        hashes: elf.hashes,
        notes: elf.notes,
      });
    }
  } else if (format.kind === 'macho') {
    macho = safe(() => parseMachO(buf), report);
    if (macho) {
      Object.assign(report, { arch: macho.cpu, bits: macho.bits, machoType: macho.filetype, sections: macho.segments, dylibs: macho.dylibs, hashes: macho.hashes, flags: macho.flags });
    }
  } else {
    report.hashes = hashLite(buf);
    report.sections = [];
  }

  const apis = scoreApis(pe ? pe.imports.map((i) => ({ dll: i.dll, functions: i.functions })) : elf ? [{ dll: 'dynsym', functions: (elf?.imports || []).map((n) => ({ name: n })) }] : []);
  report.apis = { flagged: apis.flagged, tags: apis.tags, unique: apis.unique };
  report.packers = detectPackers({ sections: report.sections || [], overlay: pe?.overlay || { size: report.overlay?.size || 0 }, strings: text, importsCount: report.importCount || 0 });
  report.containers = peekContainer(buf, { name, strings: strs.slice(0, 4000).map((s) => s.value) });
  report.embedded = scanEmbedded(buf, { limit: 18 });
  report.opcodes = pe || elf ? opcodeScan(buf, report, format.kind) : null;
  report.risk = risk(report);
  report.recommendations = nextSteps(report, format);
  report.timings.totalMs = Date.now() - t0;
  return report;
}

function safe(fn, report) {
  try {
    return fn();
  } catch (err) {
    report.parseError = { message: err.message, code: err.code || null, hint: err.hint || null, offset: err.offset ?? null };
    return null;
  }
}

function hashLite(buf) {
  const h = (a) => crypto.createHash(a).update(buf).digest('hex');
  return { md5: h('md5'), sha1: h('sha1'), sha256: h('sha256'), size: buf.length };
}

/**
 * Stegen en RE-person skulle taga härnäst — genererat från rapporten, inte gissat.
 */
function nextSteps(r, format) {
  const out = [];
  if (r.parseError) out.push(`Huvudet kallas fel (${r.parseError.message}). Försök ${r.kind === 'pe' ? 'kontrollera e_lfanew/section alignment' : 'klip first 4 KB till en hex-dump'}.`);
  if (r.packers?.some((p) => /UPX/.test(p.packer))) out.push('Probabelt UPX: kör `upx -d fil` (eller re.unpack med upx installerat) och analysera den unpackade kopian.');
  if (r.packers?.some((p) => /VMProtect|Themida|Enigma/.test(p.packer))) out.push('Kommersiell protector: statisk analys är värdelös först. Kör i sandbox (uleast) och följ API-anrop i stället.');
  if ((r.sections || []).some((s) => s.executable && s.writable)) out.push('Sektion som är både skrivbar och körbar — packa upp den eller dumpa processminnet och analysera det blocket.');
  if (r.entry && r.entry.inImage === false) out.push('Entry point utanför image: kontrollera overlay och TLS-callbacks; trolig self-extractor.');
  if (r.tls?.count) out.push(`${r.tls.count} TLS-callback(s) — dekoder dessa först, de kör före main och döljer ofta avpackningskod.`);
  if (r.importCount < 10 && (r.entropy?.overall || 0) > 7) out.push('Få imports + hög entropi: nästan garanterat packad/krypterad payload. Försök dynamic analysis.');
  if (r.apis.flagged.some((f) => f.tags.includes('inject'))) out.push('Injectering: sätt breakpoint på WriteProcessMemory/CreateRemoteThread i x64dbg och dumpa den skrivna bufferten.');
  if (r.apis.flagged.some((f) => f.tags.includes('downloader'))) out.push('Downloader: extrahera URL:erna, kontrollera domänens ålder och hämta payloaden i en sandbox (aldrig på värden).');
  if (r.apis.flagged.some((f) => f.tags.includes('ransom'))) out.push('Ransomware-mönster: kör i isolerad miljö med dokument som lockbete; dokumentera krypteringsbeteende, nyckelhämtning och utpressningsfil.');
  if (r.security && r.security.signed === false && r.kind === 'pe') out.push('Osignerat: matchar imphash mot kända familjer och kör filen genom en sandbox innan du litar på den.');
  if (r.dotnet?.managed) out.push('.NET: använd ilspycmd/dnSpy (dotnet tool install -g ilspycmd) — hanterad kod är lätt att läsa, slösa inte tid på assembly.');
  if (r.containers?.some((c) => c.kind === 'apk')) out.push('APK: packa upp med apktool, läs AndroidManifest.xml, leta efter url/permission-strängar och dekompile classes.dex.');
  if (r.containers?.some((c) => c.kind === 'asar')) out.push('Electron: montera asar-arkivet (npx @electron/asar extract) och läs JS-bundlen — logiken ligger där, inte i exet.');
  if (r.overlay?.size > 100000) out.push(`Overlay på ${Math.round(r.overlay.size / 1024)} kB efter sista sektionen: dumpa offset ${r.overlay.offset} och kör entropi på den delen.`);
  if (r.iocs?.urls?.length) out.push(`${r.iocs.urls.length} URL:er — kontrollera DOMÄN-ålder/ssl-certifikat och hämta med web.fetch i sand-box-läge.`);
  if (!out.length && format.kind === 'text') out.push('Textfiler: kör den genom majin.syntax / grep för hårdkodade nycklar, endpoint:er och hemliga strängar.');
  return out.slice(0, 8);
}

export { entropy, getStrings };
