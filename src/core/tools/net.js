/**
 * LENT — nät- och skärmmaterial.
 * Forensics-snabbt: vad lyssnar, vad körs, vad startar, vad ser användaren.
 */
import os from 'node:os';
import path from 'node:path';
import { def } from './registry.js';
import { runShell, IS_WIN } from './shell.js';
import { resolveIn } from './files.js';

const CSV = 'ConvertTo-Csv -NoTypeInformation';
const clean = (s) => String(s || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);

function csvRow(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else q = !q;
      continue;
    }
    if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else if (ch !== '"' || !q) cur += ch;
  }
  out.push(cur);
  return out;
}

export const netTools = [
  def({
    name: 'net.dns',
    group: 'nät',
    risk: 'read',
    desc: 'Slå upp domän (A/AAAA/TXT/CNAME/NS/MX). Används för att följa IOCs från en binär.',
    params: { host: 'string: domän eller IP', type: 'string: A | AAAA | TXT | CNAME | NS | MX | ANY [A|AAAA|TXT|CNAME|NS|MX|ANY]' },
    async run({ host, type = 'A' }) {
      const dns = await import('node:dns').then((m) => m.default);
      const fn = { A: 'resolve4', AAAA: 'resolve6', TXT: 'resolveTxt', CNAME: 'resolveCname', NS: 'resolveNs', MX: 'resolveMx', ANY: 'resolveAny' }[type] || 'resolve4';
      try {
        const res = await dns[fn](String(host).replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
        const rows = (Array.isArray(res) ? res : [res]).map((x) => (typeof x === 'object' ? Object.entries(x).map(([k, v]) => `${k}=${v}`).join(' ') : String(x)));
        return { result: `${host} ${type}\n${rows.join('\n')}`, meta: { rows: rows.length }, summary: `${host}: ${rows.length} ${type}-poster` };
      } catch (err) {
        return { ok: false, error: { code: 'dns_failed', message: `${type} ${host}: ${err.code || err.message}`, hint: err.code === 'ENOTFOUND' ? 'domänen finns inte — kan vara en död C2 eller en fejkad IOC-sträng' : null } };
      }
    },
  }),

  def({
    name: 'net.tcp',
    group: 'nät',
    risk: 'read',
    desc: 'Testa en TCP-port (öppen/stängd) med timeout. Använd bara mot saker du äger.',
    params: { host: 'string: värd', port: 'n: number: port', timeoutMs: 'number: millisekund (default 1500)' },
    async run({ host, port, timeoutMs = 1500 }) {
      const net = await import('node:net').then((m) => m.default);
      return new Promise((resolve) => {
        const sock = new net.Socket();
        let done = false;
        const finish = (r) => {
          if (done) return;
          done = true;
          sock.destroy();
          resolve(r);
        };
        sock.setTimeout(Number(timeoutMs) || 1500);
        sock.once('connect', () => finish({ result: `${host}:${port} öppen`, summary: `${port} öppen` }));
        sock.once('timeout', () => finish({ ok: false, error: { code: 'timeout', message: `${host}:${port} svarade inte inom ${timeoutMs}ms` } }));
        sock.once('error', (e) => finish({ ok: false, error: { code: 'tcp_error', message: `${host}:${port}: ${e.code || e.message}` } }));
        sock.connect(Number(port), String(host));
      });
    },
  }),

  def({
    name: 'net.http',
    group: 'nät',
    risk: 'read',
    desc: 'Rå HTTP-request (metod, headers, body). Används för egna API:er och för att testa en lokal webservice.',
    params: { url: 'string: adress', method: 'string: GET | POST | PUT | DELETE | HEAD | OPTIONS [GET|POST|PUT|DELETE|HEAD|OPTIONS]', headers: 'object: extra headers', body: 'string: body', maxChars: 'number: svarskap (default 8000)' },
        required: ['url'],
async run({ url, method = 'GET', headers = {}, body, maxChars = 8000 }) {
      const t0 = Date.now();
      const res = await fetch(url, { method: String(method).toUpperCase(), headers, body: body || undefined, redirect: 'follow' });
      const text = await res.text();
      return {
        result: `${res.status} ${res.statusText} · ${Date.now() - t0}ms\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${text.slice(0, maxChars)}${text.length > maxChars ? `\n…[${text.length - maxChars} tecken klippt]` : ''}`,
        meta: { status: res.status, bytes: text.length },
        summary: `HTTP ${res.status} ${new URL(url).host}`,
      };
    },
  }),

  def({
    name: 'net.serve',
    group: 'nät',
    risk: 'exec',
    desc: 'Starta en tillfällig HTTP-server som delar en mapp (för att hämta prover till sandlådan). Returnerar URL + jobb-id.',
    params: { dir: 'string: mapp att dela', port: 'number: port (default 0 = fri)' },
    async run({ dir = '.', port = 0 }, ctx) {
      const http = await import('node:http');
      const fsp = await import('node:fs/promises');
      const { abs } = resolveIn(ctx, dir);
      const server = http.createServer(async (req, res) => {
        try {
          const rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '') || '.';
          const full = path.resolve(abs, rel);
          if (!full.startsWith(abs)) {
            res.writeHead(403).end('forbjuden');
            return;
          }
          const st = await fsp.stat(full);
          if (st.isDirectory()) {
            const items = await fsp.readdir(full);
            const listed = [];
            for (const i of items) {
              const isDir = (await fsp.stat(path.join(full, i)).catch(() => ({ isDirectory: () => false }))).isDirectory();
              listed.push(`${i}${isDir ? '/' : ''}`);
            }
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(listed.join('\n'));
            return;
          }
          res.writeHead(200, { 'content-length': st.size, 'content-type': 'application/octet-stream' });
          (await import('node:fs')).createReadStream(full).pipe(res);
        } catch (err) {
          res.writeHead(404).end(String(err.message));
        }
      });
      await new Promise((r) => server.listen(Number(port) || 0, '0.0.0.0', r));
      const real = server.address().port;
      ctx.servers ||= new Map();
      ctx.servers.set(real, server);
      const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
      return { result: `delar ${abs}\n  http://127.0.0.1:${real}/\n${ips.map((i) => `  http://${i}:${real}/`).join('\n')}\nStoppa med net.serve_stop(${real})`, meta: { port: real }, summary: `server på :${real}` };
    },
  }),

  def({
    name: 'net.serve_stop',
    group: 'nät',
    risk: 'exec',
    desc: 'Stäng en tillfällig delnings-server.',
    params: { port: 'number: porten från net.serve' },
    async run({ port = 0 }, ctx) {
      const s = ctx.servers?.get(Number(port));
      if (!s) return { ok: false, error: { code: 'no_server', message: `ingen server på ${port}` } };
      s.close();
      ctx.servers.delete(Number(port));
      return { result: `stängde :${port}`, summary: `server :${port} stoppad` };
    },
  }),

  def({
    name: 'screen.capture',
    group: 'skärm',
    risk: 'read',
    desc: 'Ta skärmbild (PNG). På Windows via .NET; kräver ingen extra mjukvara.',
    params: { path: 'string: målfil (default skärmbild-<tid>.png)', region: 'string: x,y,bredd,höjd', then: 'string: describe | save [describe|save]' },
    async run({ path: p, region, then = 'save' }, ctx) {
      const out = resolveIn(ctx, p || `skarmbild-${Date.now()}.png`);
      if (IS_WIN) {
        const bounds = region ? region.split(',').map((n) => Number(n.trim())) : null;
        const size = bounds ? `[Drawing.Rectangle]::FromLTRB(${bounds.join(',')})` : '[System.Windows.Forms.SystemInformation]::VirtualScreen';
        const cmd = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=${size}; $bmp=New-Object Drawing.Bitmap($b.Width,$b.Height); $g=[Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); $bmp.Save('${out.abs}'); 'saved'`;
        const r = await runShell(cmd, { timeoutSec: 30 });
        if (!/saved/.test(r.stdout || '')) return { ok: false, error: { code: 'screenshot_failed', message: (r.stderr || 'okänt fel').slice(0, 300), hint: 'fungerar bara i en interaktiv session' } };
      } else if (process.platform === 'darwin') {
        await runShell(`screencapture ${region ? `-R${region}` : ''} "${out.abs}"`, { timeoutSec: 30 });
      } else {
        const r = await runShell(`(grim -o "${out.abs}" 2>/dev/null) || (import -window root "${out.abs}" 2>/dev/null) || (spectacle -bn -o "${out.abs}" 2>/dev/null)`, { timeoutSec: 30 });
        void r;
      }
      const fsSync = await import('node:fs');
      if (!fsSync.existsSync(out.abs)) return { ok: false, error: { code: 'no_file', message: 'skärmbilden skapades inte', hint: 'installera grim (wayland) eller imagemagick (x11)' } };
      const size = fsSync.statSync(out.abs).size;
      if (then === 'describe') {
        const { analyzeImage } = await import('../vision.js');
        const d = await analyzeImage({ cfg: ctx.cfg, imagePath: out.abs, question: 'Vad syns på skärmen? Beskriv fönster, text, felmeddelanden och vad som kan behöva åtgärdas.' });
        return { result: `${out.abs} (${size} byte)\n\n${d}`, summary: 'skärmbild + beskrivning' };
      }
      return { result: `${out.abs} (${size} byte)`, meta: { path: out.abs }, summary: `skärmbild ${(size / 1024) | 0} kB` };
    },
  }),

  def({
    name: 'screen.claim',
    group: 'skärm',
    risk: 'read',
    desc: 'Läs vad som finns i urklipp (text/fil). Bra efter att användaren markerat något i en binär.',
    params: {},
    async run() {
      const cmd = IS_WIN ? '(Get-Clipboard -Raw) 2>$null; "---"; (Get-Clipboard -Format FileDropList).Path 2>$null' : 'xclip -selection clipboard -o 2>/dev/null || pbpaste 2>/dev/null';
      const r = await runShell(cmd, { timeoutSec: 15, maxChars: 20000 });
      const text = clean(r.stdout).join('\n');
      return { result: text || '(urklippet är tomt)', summary: text ? `urklipp ${text.length} tecken` : 'tomt urklipp' };
    },
  }),

  def({
    name: 'sys.notify',
    group: 'system',
    risk: 'read',
    desc: 'Pusha en Windows-notis (toast) eller låt LENT prata högt. Används när ett långt jobb blir klart.',
    params: { title: 'string: rubrik', body: 'string: brödtext', speak: 'boolean: läs upp också' },
    async run({ title = 'LENT', body, speak = false }) {
      const t = String(title).replace(/'/g, "''").slice(0, 80);
      const b = String(body ?? '').replace(/'/g, "''").slice(0, 300);
      if (IS_WIN) {
        const cmd = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null; $t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(2); $x=$t.GetElementsByTagName('text'); $x[0].AppendChild($t.CreateTextNode('${t}'))|Out-Null; if ($x.Count -gt 1) { $x[1].AppendChild($t.CreateTextNode('${b}'))|Out-Null }; $n=[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('LENT'); $n.Show([Windows.UI.Notifications.ToastNotification]::new($t)); 'ok'`;
        const r = await runShell(cmd, { timeoutSec: 20 });
        if (!/ok/.test(r.stdout || '')) return { result: `notis kunde inte visas (${(r.stderr || '').slice(0, 120)})`, summary: 'notis misslyckades' };
      }
      if (speak) {
        await runShell(`Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=1; $s.Speak('${b.replace(/'/g, "''") || t}')`, { timeoutSec: 60 });
      }
      return { result: `notis: ${t} — ${b}`, summary: 'notis skickad' };
    },
  }),
];

function match(pattern) {
  let re = null;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    re = null;
  }
  return (line) => (re ? re.test(line) : line.toLowerCase().includes(String(pattern).toLowerCase()));
}

void csvRow;
void path;
