import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function col(index) {
  let value = index;
  let name = '';
  while (value > 0) {
    const rest = (value - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name || 'A';
}

function cell(ref, value, style = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function rowXml(index, values, style = 0) {
  return `<row r="${index}">${values.map((value, offset) => cell(`${col(offset + 1)}${index}`, value, style)).join('')}</row>`;
}

function sheetXml(rows, { widths = [], freeze = true, filter = null } = {}) {
  const columns = widths.length
    ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const pane = freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' : '';
  const autoFilter = filter ? `<autoFilter ref="${filter}"/>` : '';
  const maxColumns = Math.max(1, ...rows.map((entry) => (Array.isArray(entry) ? entry.length : (entry.values || []).length)));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${col(maxColumns)}${Math.max(1, rows.length)}"/>${pane}${columns}<sheetData>${rows.map((entry, index) => rowXml(index + 1, entry.values, entry.style || 0)).join('')}</sheetData>${autoFilter}</worksheet>`;
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((total, entry) => total + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

function writeXlsx(file, rows, applications) {
  const summary = [
    ...[
      ['MAJIN V6 — JOB HUNTER REPORT'],
      ['Generated', rows.generatedAt],
      ['Session', rows.sessionId],
      ['Status', rows.status],
      ['Start', rows.startedAt],
      ['Deadline', rows.deadlineAt],
      ['Time remaining', rows.remaining],
      [],
      ['METRIC', 'VALUE'],
      ['Reviewed records', rows.reviewed],
      ['Verified', rows.verified],
      ['New verified', rows.newVerified],
      ['Submitted', rows.submitted],
      ['SENT_UNCONFIRMED', rows.sentUnconfirmed],
      ['PREPARED_NOT_SENT', rows.preparedNotSent],
      ['Blocked', rows.blocked],
      ['Not qualified', rows.notQualified],
      ['New applications', rows.newApplications],
      ['Portal submissions', rows.portalSubmits],
      ['Email submissions', rows.emailSubmits],
      ['Receipts', rows.receipts],
      ['Duplicates avoided', rows.duplicatesAvoided],
      [],
      ['LIMITATIONS'],
      ...rows.limitations.map((item) => [item]),
    ].map((entry, index) => ({
      values: entry,
      style: index === 0 || entry[0] === 'METRIC' ? 1 : 0,
    })),
  ];
  const header = { values: ['Employer', 'Role', 'Location', 'Status', 'V6-state', 'Source', 'Date', 'Evidence', 'Link'], style: 1 };
  const appRows = applications.map((app) => ({
    values: [app.company, app.title, app.city, app.status, app.v6State, app.source, app.date, app.evidence, app.url],
  }));
  const root = 'xl';
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: `${root}/workbook.xml`,
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Applications" sheetId="2" r:id="rId2"/></sheets></workbook>',
    },
    {
      name: `${root}/_rels/workbook.xml.rels`,
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    },
    {
      name: `${root}/styles.xml`,
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B1F33"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    },
    {
      name: `${root}/worksheets/sheet1.xml`,
      data: sheetXml(summary, { widths: [34, 34, 22, 18, 18, 16, 16, 24, 18], freeze: false }),
    },
    {
      name: `${root}/worksheets/sheet2.xml`,
      data: sheetXml([header, ...appRows], { widths: [30, 55, 18, 20, 26, 16, 14, 55, 45], filter: `A1:I${Math.max(1, applications.length + 1)}` }),
    },
  ];
  fs.writeFileSync(file, zip(files));
}

function classify(app) {
  if (app.state === 'CONFIRMED_RECEIVED') return 'VERIFIED';
  if (['SUBMITTED_UNCONFIRMED', 'EMAIL_VERIFICATION_PENDING'].includes(app.state)) return 'SENT_UNCONFIRMED';
  if (app.state === 'FORM_PREPARED') return 'PREPARED_NOT_SENT';
  if (app.state === 'BLOCKED') return 'BLOCKED';
  if (app.state === 'UNCERTAIN') return 'UNCERTAIN';
  if (app.state === 'SKIPPED') return 'NOT_QUALIFIED';
  return app.state || 'UNKNOWN';
}

function evidenceText(app) {
  const relevant = (app.evidence || []).filter((item) => ['gmail-confirmation', 'gmail-verification-request', 'submission-receipt'].includes(item.type));
  const item = relevant.at(-1);
  if (!item) return app.match?.missing?.length ? `Missing: ${app.match.missing.slice(0, 4).join(', ')}` : 'No receipt recorded';
  if (item.type === 'submission-receipt') return `Receipt: ${item.receipt?.kind || 'unknown'} ${item.receipt?.reference || item.receipt?.url || item.receipt?.text || ''}`.trim();
  if (item.type === 'gmail-confirmation') return `Gmail: ${item.messageId || item.reference || 'confirmation'}`;
  return `Gmail: ${item.messageId || 'verification email'}`;
}

export async function writeJobHuntReports({ ctx, session, finalStatus = null, now = Date.now() } = {}) {
  const state = await session.read();
  if (!state) throw Object.assign(new Error('No Job Hunter session exists'), { code: 'JOBHUNT_NOT_FOUND' });
  const jobs = await ctx.jobs.list({ candidateId: state.candidateId, limit: 5000 });
  const queueStats = await ctx.queue.stats();
  const started = new Date(state.startedAt).getTime();
  const generatedAt = new Date(now).toISOString();
  const counts = {
    reviewed: jobs.length,
    verified: 0,
    newVerified: 0,
    submitted: 0,
    sentUnconfirmed: 0,
    preparedNotSent: 0,
    blocked: 0,
    notQualified: 0,
    newApplications: 0,
    portalSubmits: 0,
    emailSubmits: 0,
    receipts: 0,
    duplicatesAvoided: 0,
  };
  const applications = jobs.map((app) => {
    const status = classify(app);
    if (status === 'VERIFIED') counts.verified += 1;
    if (status === 'SENT_UNCONFIRMED') counts.sentUnconfirmed += 1;
    if (status === 'PREPARED_NOT_SENT') counts.preparedNotSent += 1;
    if (status === 'BLOCKED') counts.blocked += 1;
    if (status === 'NOT_QUALIFIED') counts.notQualified += 1;
    if (['VERIFIED', 'SENT_UNCONFIRMED'].includes(status)) counts.submitted += 1;
    if (new Date(app.createdAt).getTime() >= started) counts.newApplications += 1;
    const confirmedAt = (app.history || []).find((item) => item.state === 'CONFIRMED_RECEIVED')?.at;
    if (status === 'VERIFIED' && confirmedAt && new Date(confirmedAt).getTime() >= started) counts.newVerified += 1;
    for (const item of app.evidence || []) {
      if (item.type === 'gmail-confirmation') counts.receipts += 1;
      if (item.type === 'submission-receipt') {
        if (String(item.receipt?.kind || '').toLowerCase().includes('email')) counts.emailSubmits += 1;
        else counts.portalSubmits += 1;
      }
    }
    return {
      company: app.job?.company || '',
      title: app.job?.title || '',
      city: app.job?.city || '',
      status,
      v6State: app.state,
      source: app.job?.site || app.job?.apply?.type || 'unknown',
      date: String(app.updatedAt || app.createdAt || '').slice(0, 10),
      evidence: evidenceText(app),
      url: app.job?.apply?.url || app.job?.url || '',
    };
  });
  try {
    counts.duplicatesAvoided = ctx.log.read({ types: ['task.deduplicated'], limit: 5000 }).length;
  } catch {
    counts.duplicatesAvoided = 0;
  }
  const report = {
    generatedAt,
    sessionId: state.id,
    status: finalStatus || state.status,
    startedAt: state.startedAt,
    deadlineAt: state.deadlineAt,
    remaining: reportRemaining(state, now),
    ...counts,
    applications,
    queue: queueStats,
    limitations: [
      'No application is VERIFIED without an observed receipt.',
      'Portals requiring login, MFA or CAPTCHA remain BLOCKED until resolved.',
      'V6 submits only through a configured adapter with owner approval.',
      'This report describes persisted V6 state; it does not replace the external application ledger.',
      'Job Hunter cannot run while the computer or worker is off. Restart preserves the original deadline.',
    ],
  };
  fs.mkdirSync(ctx.reportsDir, { recursive: true });
  const safeTime = generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const base = path.join(ctx.reportsDir, `jobhunt-${state.id}-${safeTime}`);
  const htmlFile = `${base}.html`;
  const xlsxFile = `${base}.xlsx`;
  fs.writeFileSync(htmlFile, renderHtml(report), 'utf8');
  writeXlsx(xlsxFile, report, applications);
  return { html: htmlFile, xlsx: xlsxFile, report, counts };
}

function reportRemaining(state, now) {
  const remaining = Math.max(0, new Date(state.deadlineAt).getTime() - now);
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, minutes ? `${minutes}m` : null].filter(Boolean).join(' ') || '0m';
}

function renderHtml(report) {
  const statuses = ['VERIFIED', 'SENT_UNCONFIRMED', 'PREPARED_NOT_SENT', 'BLOCKED', 'NOT_QUALIFIED', 'UNCERTAIN'];
  const statusCounts = Object.fromEntries(statuses.map((status) => [status, report.applications.filter((app) => app.status === status).length]));
  const cards = [
    ['Total reviewed', report.reviewed],
    ['Verified', report.verified],
    ['New verified', report.newVerified],
    ['Submitted', report.submitted],
    ['Unconfirmed', report.sentUnconfirmed],
    ['Blocked', report.blocked],
    ['New applications', report.newApplications],
    ['Duplicates avoided', report.duplicatesAvoided],
  ];
  const rows = report.applications.map((app) => `<tr><td>${html(app.company)}</td><td>${html(app.title)}</td><td>${html(app.city)}</td><td><span class="badge ${html(app.status.toLowerCase())}">${html(app.status)}</span></td><td>${html(app.source)}</td><td>${html(app.date)}</td><td>${html(app.evidence)}</td><td>${app.url ? `<a href="${html(app.url)}">Open</a>` : ''}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAJIN V6 Job Hunter</title><style>
:root{--navy:#0b1f33;--teal:#1f7a8c;--green:#2a9d8f;--amber:#e9c46a;--red:#e63946;--gray:#6c757d;--bg:#f4f7f6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#1f2d36;font:14px/1.45 Calibri,Segoe UI,sans-serif}
header{background:var(--navy);color:#fff;padding:28px 22px}header h1{margin:0;font-size:28px}header p{margin:6px 0 0;opacity:.8}
main{max-width:1280px;margin:0 auto;padding:20px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 20px}
.card{background:#fff;border-radius:10px;padding:14px;border-top:4px solid var(--teal)}.card b{display:block;font-size:26px;color:var(--navy)}.card span{font-size:12px;color:#52636b}
.panel{background:#fff;border-radius:10px;padding:16px;margin-bottom:16px;overflow:auto}h2{font-size:18px;margin:0 0 10px}
table{border-collapse:collapse;width:100%;min-width:900px;font-size:12px}th{background:var(--navy);color:#fff;text-align:left;padding:8px}td{border-bottom:1px solid #e3e9e7;padding:8px;vertical-align:top}
.badge{display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700}.verified{background:#d8f3ec;color:#146c60}.sent_unconfirmed{background:#fff0c7;color:#6b5200}.blocked{background:#ffd9dc;color:#8a1c25}.not_qualified{background:#e9ecef;color:#495057}.prepared_not_sent{background:#e2eef8;color:#205375}.uncertain{background:#f1e4ff;color:#5b2d8e}
ul{margin:8px 0 0;padding-left:20px}li{margin:4px 0}.muted{color:#52636b;font-size:12px}a{color:#0563c1}
</style></head><body><header><h1>MAJIN V6 — Job Hunter</h1><p>Session ${html(report.sessionId)} · ${html(report.status)} · generated ${html(report.generatedAt)} · deadline ${html(report.deadlineAt)} · remaining ${html(report.remaining)}</p></header><main>
<div class="cards">${cards.map(([label, value]) => `<div class="card"><b>${value}</b><span>${html(label)}</span></div>`).join('')}</div>
<div class="panel"><h2>Status</h2><table><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${statuses.map((status) => `<tr><td><span class="badge ${status.toLowerCase()}">${status}</span></td><td>${statusCounts[status]}</td></tr>`).join('')}</tbody></table></div>
<div class="panel"><h2>Applications</h2><table><thead><tr><th>Employer</th><th>Role</th><th>Location</th><th>Status</th><th>Source</th><th>Date</th><th>Evidence</th><th>Link</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No records in the V6 store yet.</td></tr>'}</tbody></table></div>
<div class="panel"><h2>Limitations</h2><ul>${report.limitations.map((item) => `<li>${html(item)}</li>`).join('')}</ul><p class="muted">Queue: ${html(JSON.stringify(report.queue?.byState || {}))}</p></div>
</main></body></html>`;
}

export { classify, renderHtml, zip };
