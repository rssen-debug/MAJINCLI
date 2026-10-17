/**
 * MAJIN RE — signaturdatabas + riskpoäng.
 * Målet är inte att vara en antivirus. Målet är att ge en modell en ärlig
 * förstahandsbild: vad filen är, vad den kan göra, och vad som är värt att gräva i.
 */

/** Win32-API:er som betyder något. severity 1..5, tags för aggregering. */
export const API_RISK = [
  { re: /^CreateRemoteThread(Ex)?$/, sev: 5, why: 'kodinjectering', tags: ['inject'] },
  { re: /^WriteProcessMemory$/, sev: 5, why: 'skriver in minne i annan process', tags: ['inject'] },
  { re: /^ReadProcessMemory$/, sev: 3, why: 'läser annans minne', tags: ['steal'] },
  { re: /^VirtualAlloc(Ex)?$/, sev: 3, why: 'reserverar körbart minne — shellcode-steg 1', tags: ['mem'] },
  { re: /^VirtualProtect(Ex)?$/, sev: 4, why: 'ändrar skydd på minne — packare/klargör shellcode', tags: ['mem'] },
  { re: /^NtUnmapViewOfSection$/, sev: 5, why: 'process hollowing', tags: ['inject', 'hollow'] },
  { re: /^SetWindowsHookEx[AW]?$/, sev: 4, why: 'keylogger/mhook', tags: ['keylog'] },
  { re: /^GetAsyncKeyState$/, sev: 3, why: ' tangenttryckningar', tags: ['keylog'] },
  { re: /^(URL)?DownloadTo(CacheFile|File)[AW]?$/, sev: 5, why: 'downloads code', tags: ['downloader'] },
  { re: /^InternetReadFile$/, sev: 3, why: 'hämtar data över nätet', tags: ['net'] },
  { re: /^WinHttp.*/, sev: 2, why: 'http-klient', tags: ['net'] },
  { re: /^URLDownloadToFileWithProgress$/, sev: 5, why: 'downloader', tags: ['downloader'] },
  { re: /^(CreateFile|WriteFile)$/, sev: 1, why: 'fil-io (bara intressant i kluster)', tags: ['fs'] },
  { re: /^Reg(SetValue|CreateKey|OpenKey|DeleteKey)[AW]?$/, sev: 3, why: 'skriver i registret (persistence)', tags: ['persist'] },
  { re: /^SHDeleteKey[AW]?$/, sev: 4, why: 'raderar registernyckel', tags: ['persist'] },
  { re: /^WinExec$/, sev: 4, why: 'kör kommando', tags: ['exec'] },
  { re: /^ShellExecute[EW]?[AW]?$/, sev: 3, why: 'startar process', tags: ['exec'] },
  { re: /^CreateProcess[AW]?$/, sev: 2, why: 'startar process', tags: ['exec'] },
  { re: /^Crypt(Encrypt|Decrypt)(File)?[AW]?$/, sev: 3, why: 'kryptering — ransomware använder detta', tags: ['crypt'] },
  { re: /^CryptDeriveKey$/, sev: 3, why: 'nyckelhärledning', tags: ['crypt'] },
  { re: /^BCrypt.*/, sev: 2, why: 'cng-krypto', tags: ['crypt'] },
  { re: /^Process32(First|Next)32(2)?$/, sev: 3, why: 'räknar processer (recon)', tags: ['recon'] },
  { re: /^LogicalProcessorInformation$/, sev: 2, why: 'VM-detection', tags: ['vm'] },
  { re: /^GetSystemFirmwareTable$/, sev: 4, why: 'klassisk VM/sandbox-detection', tags: ['vm'] },
  { re: /^QueryPerformanceCounter$/, sev: 1, why: 'tidsmätning (anti-debug, men också benchmark)', tags: ['anti_dbg'] },
  { re: /^IsDebuggerPresent$/, sev: 5, why: 'anti-debug', tags: ['anti_dbg'] },
  { re: /^CheckRemoteDebuggerPresent$/, sev: 5, why: 'anti-debug', tags: ['anti_dbg'] },
  { re: /^NtQueryInformationProcess$/, sev: 4, why: 'anti-debug via ProcessDebugFlags', tags: ['anti_dbg'] },
  { re: /^OutputDebugStringA?$/, sev: 2, why: 'last error side-channel anti-debug', tags: ['anti_dbg'] },
  { re: /^Sleep$/, sev: 1, why: 'sandbox-fördröjning (vanligt, svagt tecken)', tags: ['anti_dbg'] },
  { re: /^GetTickCount(64)?$/, sev: 1, why: 'sandbox-tidscheck', tags: ['anti_dbg'] },
  { re: /^DeleteFile[AW]?$/, sev: 2, why: 'raderar filer', tags: ['fs'] },
  { re: /^MoveFileWithProgress[AW]?$/, sev: 3, why: 'flyttar/utbyter filer (pending file rename ops)', tags: ['persist'] },
  { re: /^AdjustTokenPrivileges$/, sev: 4, why: 'höjer behörighet', tags: ['priv'] },
  { re: /^OpenProcessToken$/, sev: 3, why: 'åtkomst till process-token', tags: ['priv'] },
  { re: /^LookupPrivilegeValue[AW]?$/, sev: 3, why: 'slår upp privilegium (t.ex. SeDebugPrivilege)', tags: ['priv'] },
  { re: /^LsaOpenPolicy$/, sev: 5, why: 'LSA-policy — credential theft', tags: ['creds'] },
  { re: /^NetUser(Enum|Add|GetInfo)/, sev: 3, why: 'användarrecon / konton', tags: ['recon'] },
  { re: /^WNetAddConnection2[AW]?$/, sev: 3, why: 'monterar nätverksresurs (lateral)', tags: ['lateral'] },
  { re: /^CreateNamedPipe[AW]?$/, sev: 3, why: 'pipe — C2/staging', tags: ['c2'] },
  { re: /^SetThreadContext$/, sev: 4, why: 'skriver över trådkontext (hollowing)', tags: ['inject'] },
  { re: /^ResumeThread$/, sev: 3, why: 'släpper på suspended thread (process injection)', tags: ['inject'] },
  { re: /^CreateToolhelp32Snapshot$/, sev: 3, why: 'process/toolhelp snapshot', tags: ['recon'] },
  { re: /^Vss?.*(Create|Delete)/, sev: 5, why: 'skuggkopior — ransomware-prep', tags: ['ransom'] },
  { re: /^GetVolumeInformation[AW]?$/, sev: 2, why: 'volymsinfo (ransomware mappar)', tags: ['ransom'] },
  { re: /^SetFilePointerEx$/, sev: 1, why: 'filseek', tags: ['fs'] },
  { re: /^FindFirstFile[AW]?$/, sev: 1, why: 'filenumering', tags: ['fs'] },
  { re: /^CreateMutex[AW]?$/, sev: 2, why: 'mutex — ensam instans', tags: ['persist'] },
  { re: /^RegLoadKey[AW]?$/, sev: 4, why: 'laddar registry-hive', tags: ['creds'] },
];

export const PACKER_SECTIONS = [
  { re: /^\.UPX\d?$/i, name: 'UPX' },
  { re: /^UPX[012]$/i, name: 'UPX' },
  { re: /^\.aspack/i, name: 'ASPack' },
  { re: /^\.adata$/i, name: 'ASPack' },
  { re: /^\.petite$/i, name: 'Petite' },
  { re: /^\.themida$/i, name: 'Themida' },
  { re: /^\.vmp[01]$/i, name: 'VMProtect' },
  { re: /^\.nsp[0-9]$/i, name: 'NsPack' },
  { re: /^\.pklstb$/i, name: 'PKLite' },
  { re: /^MEW$/i, name: 'MEW' },
  { re: /^\.enigma[01]$/i, name: 'Enigma' },
  { re: /^\.MPRESS[01]$/i, name: 'MPRESS' },
  { re: /^_arm32$/i, name: 'ARM exe (WoA)' },
];

export const LINKER_STAMPS = [
  { re: /Go build ID|go1\.|runtime\.morestack/, name: 'Golang', sev: 1 },
  { re: /rustc/, name: 'Rust', sev: 1 },
  { re: /PythonRuntime|python3\d\d\.dll|\bPyInstaller\b/, name: 'PyInstaller/Python', sev: 1 },
  { re: /electron\.dll|chrome_100_percent\.pak|\.asar/i, name: 'Electron', sev: 1 },
  { re: /node_modules/, name: 'Node-app (packad)', sev: 1 },
  { re: /AutoIt|_AutoitVersion/i, name: 'AutoIt', sev: 2 },
  { re: /NSIS|Nullsoft/i, name: 'NSIS-installer', sev: 1 },
  { re: /Inno Setup/i, name: 'Inno Setup', sev: 1 },
  { re: /\.(vbs|vbe)|wscript/i, name: 'VB-skript-rester', sev: 2 },
  { re: /AHK|AutoHotkey/i, name: 'AutoHotkey', sev: 2 },
  { re: /powershell|-encodedcommand|frombase64string/i, name: 'PowerShell-buren', sev: 3 },
  { re: /Borland|Embarcadero/i, name: 'Borland/Delphi', sev: 1 },
  { re: /MFC140\.dll|mfc\d{3}\.dll/i, name: 'MFC', sev: 1 },
  { re: /mscorlib\.dll|System\.Private\.CoreLib/i, name: '.NET', sev: 1 },
];

export function scoreApis(imports) {
  const flat = [];
  for (const imp of imports || []) for (const f of imp.functions || []) flat.push({ dll: imp.dll, name: f.name });
  const flagged = [];
  const tags = {};
  for (const call of flat) {
    for (const rule of API_RISK) {
      if (rule.re.test(call.name)) {
        flagged.push({ dll: call.dll, api: call.name, severity: rule.sev, why: rule.why, tags: rule.tags });
        for (const t of rule.tags) tags[t] = (tags[t] || 0) + 1;
        break;
      }
    }
  }
  flagged.sort((a, b) => b.severity - a.severity);
  return { flagged: flagged.slice(0, 80), unique: new Set(flagged.map((f) => f.api)).size, tags };
}

export function detectPackers({ sections = [], overlay = {}, strings = '', importsCount = 0 }) {
  const hits = [];
  const names = sections.map((s) => s.name);
  for (const p of PACKER_SECTIONS) {
    const found = names.find((n) => p.re.test(n));
    if (found) hits.push({ packer: p.name, evidence: `sektion ${found}` });
  }
  const ent = sections.filter((s) => s.rawSize > 512).map((s) => s.entropy || 0);
  const high = ent.length ? ent.reduce((a, b) => a + b, 0) / ent.length : 0;
  const execWrite = sections.filter((s) => s.executable && s.writable).map((s) => s.name);
  if (high > 7.35 && importsCount < 6) hits.push({ packer: 'okänd packare/arkiv', evidence: `hög entropi (${high.toFixed(2)}) + nästan inga imports` });
  if (execWrite.length) hits.push({ packer: 'RWX section', evidence: execWrite.join(', '), severity: 4 });
  if (overlay.size > 4096) hits.push({ packer: 'overlay-data', evidence: `${overlay.size} byte efter sista sektionen (signatur, arkiv eller payload)` });
  for (const l of LINKER_STAMPS) if (l.re.test(strings)) hits.push({ packer: l.name, evidence: 'strängsignatur', severity: l.sev, runtime: true });
  const uniq = new Map();
  for (const h of hits) if (!uniq.has(h.packer)) uniq.set(h.packer, h);
  return [...uniq.values()];
}

/**
 * Riskpoäng 0-100. Bara ett mått på "vad bör en människa eller en modell titta på",
 * inte ett domslut. Rapporteras alltid med sina grunder.
 */
export function risk(report) {
  const reasons = [];
  let score = 0;
  const add = (n, why) => {
    if (n > 0) reasons.push({ points: n, why });
    score += n;
  };
  const apis = report.apis || { flagged: [], tags: {} };
  const maxSev = Math.max(0, ...apis.flagged.map((f) => f.severity));
  if (maxSev >= 5) add(24, `API with high severity (${[...new Set(apis.flagged.filter((f) => f.severity >= 5).map((f) => f.api))].slice(0, 4).join(', ')})`);
  else if (maxSev >= 4) add(14, 'process injection / hijack APIs');
  if (apis.flagged.length >= 12) add(10, `${apis.flagged.length} risky API imports`);
  for (const [tag, n] of Object.entries(apis.tags || {})) {
    if (tag === 'inject' && n) add(12 * Math.min(2, n), 'injection pattern');
    if (tag === 'keylog' && n) add(14, 'keylogging APIs');
    if (tag === 'ransom' && n) add(16, 'shadow-copy deletion (ransomware pattern)');
    if (tag === 'creds' && n) add(12, 'credential access');
    if (tag === 'anti_dbg' && n >= 2) add(8, 'anti-debug/anti-sandbox cluster');
    if (tag === 'downloader' && n) add(10, 'downloads code');
  }
  if (report.packers?.some((p) => p.severity >= 4)) add(10, 'RWX section');
  if (report.packers?.some((p) => !p.runtime)) add(8, 'packer/protector identified');
  if (report.entryPoint && report.entryPoint.inImage === false) add(14, 'entry point outside any section (classic packer sign)');
  if (report.pe?.futureTimestamp) add(6, 'build date in the future (modified header)');
  if (report.pe?.tinyTimestamp) add(4, 'timestamp zeroed — packers do that');
  if (report.security?.signed === false && report.kind === 'pe') add(6, 'unsigned executable');
  if (report.security?.signatureInvalid) add(18, 'bruten/invalid signatur');
  if (report.yara?.some((y) => (y.meta?.severity || '').toLowerCase() === 'high')) add(15, 'YARA hit with high severity');
  if (report.iocs?.urls?.length && /(^|\D)(\d{1,3}\.){3}\d{1,3}/.test(report.iocs.urls.join(' '))) add(8, 'hard-coded IP URL');
  if (report.iocs?.suspicious?.length) add(10, `${report.iocs.suspicious.length} suspected strings`);
  if (report.pe?.tls?.count) add(6, `TLS callbacks (${report.pe.tls.count}) — run BEFORE the entry point`);
  if (report.pe?.overlay?.size > 200000) add(5, `stor overlay (${report.pe.overlay.size} byte)`);
  if ((report.sections || []).some((s) => s.entropy > 7.6 && s.rawSize > 4096)) add(6, 'section with very high entropy');
  if (report.kind === 'dotnet') score = Math.max(0, score - 8);
  return { score: Math.max(0, Math.min(100, Math.round(score))), level: band(score), reasons: reasons.sort((a, b) => b.points - a.points) };
}

function band(s) {
  if (s >= 70) return 'high';
  if (s >= 40) return 'medium';
  if (s >= 18) return 'elevated';
  return 'low';
}
