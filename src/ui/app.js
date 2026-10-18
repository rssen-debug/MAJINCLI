/* MAJIN — UI. No framework, no CDN. One document, two scripts. */
const TOKEN = (window.__MAJIN_TOKEN__ || 'demo');
const S = { session: 'desktop', busy: false, st: null, voice: false, cur: null, curBody: '', tools: null, gauge: null, t0: 0 };
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const setStatus = (t) => {
  const n = $('status');
  if (n) n.textContent = t;
};
const toast = (t) => {
  const n = el('div', '', esc(t));
  $('toast').append(n);
  setTimeout(() => n.remove(), 5200);
};

async function api(p, o = {}) {
  const body = o.body && typeof o.body !== 'string' ? JSON.stringify(o.body) : o.body;
  const r = await fetch('/api' + p + (p.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(TOKEN), {
    ...o,
    body,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...(o.headers || {}) },
  });
  const j = await r.json().catch(() => ({ __http: r.status }));
  if (!r.ok) throw new Error(j && j.error ? j.error : 'http ' + r.status);
  return j;
}

/* ------------------------------- markdown-lite --------------------------- */
function md(t) {
  let s = String(t == null ? '' : t);
  const blocks = [];
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push('<pre>' + esc(String(code).replace(/\n$/, '')) + '</pre>');
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });
  s = esc(s);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/gm, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  s = s.replace(/(?:^|\n)(#{1,6})\s*(.+)$/gm, (_m, h, txt) => `\n<span style="color:var(--cy);letter-spacing:.08em">${txt}</span>\n`);
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
  return s;
}

/* ------------------------------- transcript ----------------------------- */
function scroll() {
  const s = $('scroller');
  s.scrollTop = s.scrollHeight;
}
function addMsg(cls, who, text) {
  const m = el('div', 'msg ' + cls);
  m.append(el('div', 'who', who));
  const b = el('div', 'body');
  if (text != null) b.innerHTML = md(text);
  m.append(b);
  $('scroller').append(m);
  scroll();
  return { m, b };
}
const note = (t) => addMsg('sys', 'MAJIN · notis', t);
const err = (t) => addMsg('err', 'MAJIN · error', t);

function ensureAgent() {
  if (S.cur) return S.cur;
  const o = addMsg('majin', 'MAJIN');
  S.cur = { b: o.b, m: o.m, thinking: null };
  S.curBody = '';
  o.b.classList.add('caret');
  return S.cur;
}
function appendDelta(t) {
  const a = ensureAgent();
  S.curBody += t;
  a.b.innerHTML = md(S.curBody);
  a.b.classList.add('caret');
  scroll();
}
function setThinking(t) {
  const a = ensureAgent();
  if (!a.thinking) {
    a.thinking = el('div', 'kv', '');
    a.thinking.style.cssText = 'font-style:italic;opacity:.7;margin-bottom:4px';
    a.m.prepend(a.thinking);
  }
  a.thinking.textContent = '… ' + String(t).slice(-160);
}
function toolRow(name, extra) {
  const a = ensureAgent();
  let row = a.tools;
  if (!row) {
    row = el('div', 'tools');
    a.m.append(row);
    a.tools = row;
  }
  const t = el('span', 'tl run', esc(name) + '<span class="ms">' + (extra || '') + '</span>');
  const trace = el('div', 'trace');
  t.dataset.k = 'k' + Math.random().toString(36).slice(2, 7);
  trace.id = 'tr-' + t.dataset.k;
  t.onclick = () => trace.classList.toggle('open');
  row.append(t);
  a.m.append(trace);
  return { chip: t, trace };
}
function finishTool(chip, trace, ok, text, ms, spilled) {
  chip.classList.remove('run');
  chip.classList.add(ok ? 'good' : 'bad');
  chip.innerHTML = esc(chip.textContent.replace(/\d+(\.\d+)?s$/, '').trim()) + '<span class="ms">' + ms + '</span>';
  if (text) {
    trace.textContent = String(text).slice(0, 6000) + (spilled ? `\n\n… full result: ${spilled}` : '');
  }
}
function moaGauge(ev) {
  const a = ensureAgent();
  if (!a.moa) {
    a.moa = el('div', 'foot');
    a.m.append(a.moa);
  }
  if (ev.type === 'moa:start') a.moa.innerHTML = '<span class="gauge">MOA ' + ev.width + ' references ▸ '.repeat(Math.min(3, ev.width)) + '</span>';
  if (ev.type === 'moa:ref') a.moa.innerHTML += '<span class="kv">· ' + esc(ev.ref) + ' ' + (ev.ok ? (ev.ms || '') + 'ms' : 'error') + '</span>';
  if (ev.type === 'moa:done') {
    const score = Math.round((ev.score || 0) * 100);
    a.moa.innerHTML = `<span class="gauge">MOA ${ev.refs} refs · agreement ${score}%</span><span class="bar"><i style="width:${score}%"></i></span> <span class="kv">aggregator ${(ev.ms || 0)}ms${ev.escalated ? '  · escalated' : ''}</span>`;
  }
  if (ev.type === 'moa:degraded') a.moa.innerHTML = '<span class="kv" style="color:var(--warn)">MOA degraded: ' + esc(ev.reason || '') + '</span>';
  scroll();
}

/* ------------------------------ event pump ------------------------------ */
function onEvent(ev) {
  if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.onEvent(ev); // Live Agent Vision — real events only
  switch (ev.type) {
    case 'marketing_setup':
      // Private, one-time credential question inline in the conversation.
      // NEVER paste Meta tokens into /api/chat or agent history.
      if (window.MAJIN_MARKETING) window.MAJIN_MARKETING.show(ev.request);
      break;
    case 'route':
      $('c-route').innerHTML = 'route <b>' + esc(ev.job) + '</b> → ' + esc((ev.model || '?').split('/').pop()) + (ev.confidence != null && ev.confidence < 0.45 ? ' <span style="color:var(--warn)">?</span>' : '');
      $('c-route').classList.add('live');
      note('job ' + ev.job + ' · ' + (ev.moa && ev.moa.enabled ? 'MOA ' + ev.moa.width + ' → ' + ev.moa.aggregator : 'MOA off') + (ev.tiebreak ? ' · llm tiebreak' : ''));
      break;
    case 'step':
      setStatus('step ' + ev.step + '/' + ev.of + ' · ' + (ev.model || '').split('/').pop() + (ev.escalated ? '  · escalated' : ''));
      break;
    case 'delta':
      appendDelta(ev.text);
      break;
    case 'thinking':
      setThinking(ev.text);
      break;
    case 'tool':
      S.activeTool = toolRow(ev.name);
      break;
    case 'tool_result': {
      const chip = S.activeTool;
      if (chip) finishTool(chip.chip, chip.trace, ev.ok, ev.summary || ev.error, ev.ms ? (ev.ms / 1000).toFixed(1) + 's' : '', ev.spilled);
      else {
        const r = toolRow(ev.tool);
        finishTool(r.chip, r.trace, ev.ok, ev.summary || ev.error, '', ev.spilled);
      }
      S.activeTool = null;
      break;
    }
    case 'escalate':
      note('escalating → ' + ev.to + ' (' + (ev.why || 'errors') + ')');
      break;
    case 'compact':
      note('compacting context (' + ev.tokens + ' tok)');
      break;
    case 'plan':
      renderPlan(ev.plan);
      break;
    case 'config':
      S.st = null;
      note('config: ' + (ev.notes || []).join(' · '));
      refresh();
      break;
    case 'config_error':
      err('config nekad: ' + (ev.errors || []).map((e) => e.path + ': ' + e.msg).join(', '));
      break;
    case 'skill_auto':
      note('new skill saved: ' + ev.name);
      break;
    case 'budget':
      toast('budget: ' + ev.used + ' / ' + ev.cap + ' USD');
      break;
    case 'loop.limit':
      note('step limit ' + ev.steps + ' reached');
      break;
    case 'moa:start':
    case 'moa:ref':
    case 'moa:done':
    case 'moa:degraded':
      moaGauge(ev);
      break;
    case 'usage':
      break;
    case 'answer':
      closeAnswer(ev);
      break;
    case 'error':
      err(ev.message + (ev.hint ? '\n→ ' + ev.hint : ''));
      break;
    default:
      break;
  }
}

function closeAnswer(ev) {
  const a = S.cur;
  if (a) {
    a.b.classList.remove('caret');
    if (a.thinking) a.thinking.remove();
    if (!a.b.innerHTML.trim() && ev.text) a.b.innerHTML = md(ev.text);
    const meta = ev.meta || {};
    const foot = el('div', 'foot');
    const secs = ((Date.now() - S.t0) / 1000).toFixed(1);
    foot.textContent = [meta.job && 'job ' + meta.job, meta.steps && meta.steps + ' steps', meta.tools && meta.tools + ' tools', meta.usage && (meta.usage.input + '→' + meta.usage.output + ' tok'), meta.usage && meta.usage.costUsd ? '$' + meta.usage.costUsd.toFixed(4) : null, secs + 's'].filter(Boolean).join(' · ');
    a.m.append(foot);
    if (S.voice && ev.text) speak(ev.text);
  }
  S.cur = null;
  S.tools = null;
}

/* --------------------------------- send --------------------------------- */
async function send(text) {
  if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.reset(); // a new run gets a fresh canvas

  const input = String(text || '').trim();
  if (!input) return false;
  if (input[0] === '/') {
    const ok = await command(input);
    if (ok) return true;
  }
  /* AUTOPILOT: a task is already running on this chat — this new message is
     an independent task, it gets its own agent, card and stop button and
     must NEVER wait for the first one. The /stop command above still reaches
     the running task. */
  if (S.busy) return parallelTask(input);
  addMsg('user', 'DU', input);
  $('input').value = '';
  autoGrow();
  S.busy = true;
  S.t0 = Date.now();
  $('send').classList.add('busy');
  $('send').textContent = 'STOP';
  setStatus('working…');
  const ac = new AbortController();
  S.abort = ac;
  try {
    const r = await fetch('/api/chat?t=' + encodeURIComponent(TOKEN), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ input, session: S.session }),
      signal: ac.signal,
    });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        let ev;
        try {
          ev = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        if (ev.type === 'done') continue;
        onEvent(ev);
      }
    }
    if (S.cur) closeAnswer({ text: S.curBody, meta: {} });
  } catch (e) {
    if (e.name !== 'AbortError') err('connection lost: ' + e.message);
    else note('cancelled');
  } finally {
    S.busy = false;
    S.abort = null;
    $('send').classList.remove('busy');
    $('send').textContent = 'RUN';
    setStatus('ready');
    refresh(true);
  }
  return true;
}

async function stop() {
  if (!S.busy) return;
  S.abort?.abort();
  try {
    await api('/chat/stop', { method: 'POST', body: { session: S.session } });
  } catch {
    /* */
  }
}

/* --------------------------- parallel autopilot ---------------------------
   One independent message while the main task runs = one more agent. Each
   parallel task owns its card, its SSE stream, its stop button; the classic
   single-task path above is byte-identical. Server side: {autopilot:true}
   names a fresh task (own session/history); the first SSE event is
   event: task with the id we must address for stopping it.
   Status vocabulary = the registry's: working · waiting · done · error ·
   stopped — nothing here is invented client-side. */

const P_STATUS = { working: '🔧 working', waiting: '⏳ waiting', done: '✅ done', error: '❌ error', stopped: '🟥 stopped' };

function parallelTask(input) {
  addMsg('user', 'YOU · PARALLEL', input);
  $('input').value = '';
  autoGrow();
  const card = taskCard({ label: '🧵 launching…', status: 'waiting' });
  const rec = { card, input, id: null, text: '', last: '', painted: 0, finished: false, toolCount: 0, toolMs: 0, abort: new AbortController() };
  telJoin(rec);
  (async () => {
    try {
      const r = await fetch('/api/chat?t=' + encodeURIComponent(TOKEN), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ input, autopilot: true }),
        signal: rec.abort.signal,
      });
      if (!r.ok || !r.body) throw new Error('server ' + r.status);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let name = '';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event: ')) name = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          if (name === 'done') { finishTask(rec, ev); continue; }
          taskEvent(rec, name, ev);
        }
      }
      if (!rec.finished) finishTask(rec, { ok: true });
    } catch (e) {
      if (e.name === 'AbortError' || rec.finished) { /* user stopped it */ }
      else { rec.status = 'error'; paintTaskState(rec, 'error; '+e.message); }
    }
  })();
  return true;
}

function taskCard({ label, status }) {
  const m = el('div', 'msg task');
  const head = el('div', 'task-head');
  const idl = el('span', 'task-id', esc(label));
  const st = el('span', 'task-status st-waiting', esc(P_STATUS[status] || status));
  const stopb = el('button', 'task-stop', '⏹ stop');
  const act = el('div', 'task-act kv', '…');
  const tel = el('div', 'task-tel', '');
  const ans = el('div', 'body task-ans', '');
  head.append(idl, st, stopb);
  m.append(head, act, tel, ans);
  $('scroller').append(m);
  scroll();
  const card = { m, idl, st, stopb, act, tel, ans };
  stopb.onclick = () => stopTask(card.rec);
  return card;
}

function paintTaskState(rec, note) {
  if (!rec.card) return;
  const cls = 'task-status st-' + (rec.status in P_STATUS ? rec.status : 'waiting');
  rec.card.st.className = cls;
  rec.card.st.textContent = P_STATUS[rec.status] || rec.status;
  if (note) rec.card.act.textContent = note;
}

function paintTaskText(rec, force) {
  const now = Date.now();
  if (!force && now - rec.painted < 150) return; // ~6 paints/s, not per token
  rec.painted = now;
  rec.card.ans.innerHTML = md(rec.text);
  scroll();
}

/* ---- real telemetry on the card: elapsed from the card's own clock, tool
   counts/averages from the card's own tool_result events. Nothing is a
   prediction model; a number that cannot be counted is simply not shown. ---- */
const PLIVE = [];
let telTimer = null;

function fmtDur(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60), rest = sec % 60;
  if (m < 60) return m + 'm' + String(rest).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm';
}

function paintTel(rec) {
  if (!rec.card || !rec.card.tel) return;
  const bits = [];
  if (rec.startAt) {
    const end = rec.finished ? (rec.endAt || Date.now()) : Date.now();
    bits.push('⏱ ' + fmtDur(end - rec.startAt));
  }
  if (rec.toolCount) {
    bits.push(rec.toolCount + ' tool' + (rec.toolCount === 1 ? '' : 's'));
    if (rec.toolMs && rec.toolCount >= 2) bits.push('avg ' + fmtDur(rec.toolMs / rec.toolCount) + '/tool');
  }
  rec.card.tel.textContent = bits.join(' · ');
}

function telJoin(rec) { PLIVE.push(rec); if (!telTimer) telTimer = setInterval(telTickAll, 1000); }
function telLeave(rec) {
  const i = PLIVE.indexOf(rec);
  if (i >= 0) PLIVE.splice(i, 1);
  if (!PLIVE.length && telTimer) { clearInterval(telTimer); telTimer = null; }
}
function telTickAll() { for (const rec of PLIVE) paintTel(rec); }

function taskEvent(rec, name, ev) {
  if (name === 'task') {
    rec.id = ev.task;
    rec.session = ev.session;
    rec.startAt = Date.now();
    rec.card.idl.textContent = '🧵 ' + rec.id;
    rec.card.rec = rec;
    rec.status = 'working';
    paintTaskState(rec, 'agent started (own session: ' + rec.session + ')');
    paintTel(rec);
    return;
  }
  switch (ev.type) {
    case 'route':
      rec.status = 'working';
      paintTaskState(rec, 'job ' + (ev.job || '?') + ' · model ' + String(ev.model || '?').split('/').pop());
      break;
    case 'step':
      paintTaskState(rec, 'step ' + ev.step + '/' + ev.of + (rec.last ? ' · ' + rec.last : ''));
      break;
    case 'tool':
    case 'tool_begin':
    case 'tool:start':
      rec.last = 'tool ' + (ev.name || ev.tool || '?');
      paintTaskState(rec, rec.last);
      break;
    case 'tool_result':
      rec.last = (ev.ok ? '✓ ' : '✗ ') + (ev.summary || ev.tool || '');
      rec.toolCount = (rec.toolCount || 0) + 1;
      if (Number.isFinite(ev.ms)) rec.toolMs = (rec.toolMs || 0) + ev.ms;
      paintTaskState(rec, rec.last);
      paintTel(rec);
      break;
    case 'approval':
      rec.status = 'waiting'; paintTaskState(rec, 'waiting for your approval — see the approval card');
      break;
    case 'delta':
      rec.text += ev.text || '';
      paintTaskText(rec);
      break;
    case 'answer':
      if (ev.text) rec.text = ev.text;
      paintTaskText(rec, true);
      break;
    case 'error':
      rec.status = 'error';
      rec.text += '\n\n**' + (ev.message || 'error') + '**' + (ev.hint ? ' — ' + ev.hint : '');
      paintTaskText(rec, true);
      break;
    default:
      break;
  }
}

function finishTask(rec, doneEv) {
  if (rec.finished) return;
  rec.finished = true;
  rec.endAt = Date.now();
  telLeave(rec);
  rec.status = doneEv.ok === false || rec.status === 'error' ? 'error' : 'done';
  paintTaskState(rec, (doneEv.steps ? doneEv.steps + ' steps · ' : '') + (doneEv.usage && doneEv.usage.costUsd ? '$' + doneEv.usage.costUsd.toFixed(4) + ' · ' : '') + 'done');
  paintTel(rec);
  paintTaskText(rec, true);
  rec.card.stopb.disabled = true;
  rec.card.m.classList.add(rec.status === 'done' ? 'task-done' : 'task-bad');
  refresh && refresh(true);
}

async function stopTask(rec) {
  if (!rec || !rec.id) return;
  rec.card.stopb.disabled = true;
  try {
    await api('/chat/stop', { method: 'POST', body: { task: rec.id } });
  } catch { /* keep */ }
  rec.status = 'stopped';
  rec.finished = true;
  rec.endAt = Date.now();
  telLeave(rec);
  paintTel(rec);
  paintTaskState(rec, 'stopped on request');
  rec.card.m.classList.add('task-bad');
  rec.abort.abort();
}

/* ------------------------------- approvals ------------------------------ */
function approvalCard(ev) {
  const box = el('div', 'appr');
  box.append(el('h4', '', '◎ ' + esc(ev.tool) + ' wants to run'));
  box.append(el('div', 'kv', esc(ev.reason || '')));
  if (ev.detail) box.append(el('pre', '', esc(String(ev.detail).slice(0, 600))));
  const row = el('div', 'row');
  const yes = el('button', 'on', 'ALLOW');
  const no = el('button', 'danger', 'DENY');
  yes.onclick = () => respond(ev.id, true, box);
  no.onclick = () => respond(ev.id, false, box);
  row.append(yes, no, el('span', 'kv', 'id ' + ev.id + (ev.session ? ' · ' + ev.session : '')));
  box.append(row);
  $('scroller').append(box);
  scroll();
  toast('approval pending: ' + ev.tool);
  return box;
}
async function respond(id, approved, box) {
  try {
    await api('/approve', { method: 'POST', body: { id, approved } });
    if (box) box.querySelectorAll('button').forEach((b) => {
      b.disabled = true;
    });
    if (box) box.style.borderColor = approved ? 'var(--ok)' : 'var(--bad)';
  } catch (e) {
    toast('could not answer: ' + e.message);
  }
}

/* ------------------------------ global SSE ------------------------------ */
function listen() {
  const es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN));
  S.es = es;
  es.onmessage = () => {};
  const handle = (name) => (msg) => {
    let ev;
    try {
      ev = JSON.parse(msg.data);
      if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.onEvent({ type: name, ...ev });
    } catch {
      return;
    }
    if (name === 'approval:request') {
      approvalCard(ev);
      return;
    }
    if (name === 'approval:resolved') {
      setStatus('approval ' + (ev.approved ? 'granted' : 'denied'));
      return;
    }
    if (name === 'log' || !name) return;
    if (S.busy) return;
    if (name === 'answer') {
      addMsg('majin', 'MAJIN · ' + (ev.source || 'schemalagt'), ev.text);
      return;
    }
    if (name.startsWith('telegram.') || name.startsWith('whatsapp.')) {
      toast(name.replace('.', ' · ') + (ev.error ? ': ' + ev.error : ''));
    }
    if (name === 'schedule.done') toast('schedule: ' + (ev.status || 'ok'));
  };
  ['approval:request', 'approval:resolved', 'answer', 'telegram.up', 'telegram.paired', 'telegram.unpaired', 'whatsapp.qr', 'whatsapp.connected', 'whatsapp.close', 'schedule.done', 'schedule.failed', 'tool.denied', 'majin.ui'].forEach((n) => es.addEventListener(n, handle(n)));
  es.onerror = () => {
    setStatus('reconnecting…');
  };
}

/* --------------------------------- voice -------------------------------- */
let recog = null;
function micToggle() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast('this browser has no speech recognition');
    return;
  }
  if (S.listening) {
    recog?.stop();
    S.listening = false;
    $('mic').classList.remove('on');
    $('mic-state').textContent = '';
    return;
  }
  recog = new SR();
  recog.lang = 'sv-SE';
  recog.continuous = true;
  recog.interimResults = true;
  let base = $('input').value;
  recog.onresult = (e) => {
    let txt = '';
    for (let i = e.resultIndex; i < e.results.length; i += 1) txt += e.results[i][0].transcript;
    $('input').value = (base ? base + ' ' : '') + txt;
    autoGrow();
    if (e.results[e.results.length - 1].isFinal) {
      const wake = (S.st?.config?.ui?.voice?.wakeWord || '').toLowerCase();
      const v = $('input').value.trim();
      if (wake && v.toLowerCase().startsWith(wake)) send(v.slice(wake.length).trim() || v);
    }
  };
  recog.onend = () => {
    if (S.listening) {
      try {
        recog.start();
      } catch {
        S.listening = false;
        $('mic').classList.remove('on');
      }
    }
  };
  recog.onerror = (e) => {
    $('mic-state').textContent = e.error === 'not-allowed' ? 'allow microphone' : '';
    if (e.error === 'not-allowed') S.listening = false;
  };
  recog.start();
  S.listening = true;
  $('mic').classList.add('on');
  $('mic-state').textContent = 'listening';
}
function speak(t) {
  if (!('speechSynthesis' in window)) return;
  const clean = String(t).replace(/```[\s\S]*?```/g, ' [kod] ').replace(/[*_`#]/g, '').slice(0, 900);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = S.st?.config?.ui?.voice?.lang || 'sv-SE';
  u.rate = S.st?.config?.ui?.voice?.rate || 1.05;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ------------------------------- composer ------------------------------- */
function autoGrow() {
  const i = $('input');
  i.style.height = 'auto';
  i.style.height = Math.min(240, i.scrollHeight + 2) + 'px';
}
const CMDS = ['/status', '/tools', '/route', '/moa', '/guard', '/model', '/provider', '/pair', '/schedule', '/memory', '/analyze', '/selftest', '/stop', '/clear', '/session', '/budget', '/help'];
async function command(line) {
  const [cmd, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(' ');
  const c = cmd.toLowerCase();
  if (c === 'help') {
    note('commands: ' + CMDS.join('  '));
    return true;
  }
  if (c === 'stop') {
    await stop();
    return true;
  }
  if (c === 'clear') {
    await api('/session/clear', { method: 'POST', body: { session: S.session } });
    $('scroller').innerHTML = '';
    note('session cleared');
    return true;
  }
  if (c === 'session') {
    if (!arg) return (note('session: ' + S.session), true);
    S.session = arg.replace(/[^\w.:-]/g, '_').slice(0, 40);
    await loadHistory();
    return true;
  }
  if (c === 'status') {
    refresh();
    return true;
  }
  if (c === 'tools') {
    const t = await api('/tools');
    note(Object.entries(t.groups).map(([g, list]) => g + ': ' + list.join(', ')).join('\n'));
    return true;
  }
  if (c === 'selftest') {
    const r = await api('/selftest', { method: 'POST', body: { level: arg.includes('full') ? 'full' : 'quick' } });
    addMsg('sys', 'selftest', r.text || r.error || 'done');
    return true;
  }
  if (c === 'analyze') {
    await analyzePath(arg);
    return true;
  }
  if (c === 'route') {
    const [job, ref] = rest;
    if (!job || !ref) return (note('usage: /route <job> <provider/model>'), true);
    await api('/config', { method: 'PATCH', body: { models: { routes: { [job]: ref } } } });
    refresh();
    return true;
  }
  if (c === 'model') {
    if (!arg) return (note('usage: /model <provider/model>'), true);
    await api('/config', { method: 'PATCH', body: { models: { routes: { chat: arg, tasks: arg, tools: arg, code: arg, re: arg, analysis: arg, final: arg, plan: arg, research: arg, summarize: arg, router: arg, aggregator: arg } } } });
    note('all routes → ' + arg);
    refresh();
    return true;
  }
  if (c === 'moa') {
    const patch = { moa: {} };
    if (/^(on|always)$/.test(arg)) patch.moa.policy = 'always';
    else if (arg === 'hard') patch.moa.policy = 'hard';
    else if (arg === 'off') patch.moa.policy = 'off';
    const w = /(\d)/.exec(arg);
    if (w) patch.moa.width = Math.max(2, Math.min(5, Number(w[1])));
    if (!patch.moa.policy && !patch.moa.width) return (note('/moa on | hard | off [width]'), true);
    await api('/config', { method: 'PATCH', body: patch });
    refresh();
    return true;
  }
  if (c === 'guard') {
    if (!['confirm', 'strict', 'off'].includes(arg)) return (note('/guard confirm | strict | off'), true);
    await api('/config', { method: 'PATCH', body: { guard: { mode: arg } } });
    refresh();
    return true;
  }
  if (c === 'budget') {
    const n = Number(arg.replace(/[^\d.]/g, ''));
    if (!n) return (note('/budget <usd per month>'), true);
    await api('/config', { method: 'PATCH', body: { budget: { monthlyUsd: n, mode: 'limit' } } });
    note('budget ' + n + ' USD/month');
    refresh();
    return true;
  }
  if (c === 'memory') {
    if (/^spara\s+/i.test(arg)) await api('/memory', { method: 'POST', body: { text: arg.replace(/^spara\s+/i, '') } });
    else if (/^(forget|glöm)\s+/i.test(arg)) await api('/memory', { method: 'POST', body: { action: 'forget', query: arg.replace(/^(forget|glöm)\s+/i, '') } });
    else {
      const m = await api('/memory?q=' + encodeURIComponent(arg || ''));
      note((m.facts || []).slice(0, 12).map((f) => '· ' + (f.text || f)).join('\n') || 'memory is empty');
    }
    refresh();
    return true;
  }
  if (c === 'schedule') {
    const m = /^(.+?)\s+[—-]\s+(.+)$/.exec(arg);
    if (!m) return (note('/schedule <when> — <task>   ex: /schedule 07:30 daily — kolla inkorg'), true);
    await api('/schedule', { method: 'POST', body: { when: m[1], task: m[2], deliver: 'telegram' } });
    refresh();
    return true;
  }
  if (c === 'pair') {
    const st = await api('/channels');
    note(arg === 'whatsapp' ? 'WhatsApp: ' + (st.whatsapp.state || '') + (st.whatsapp.qr ? ' — show the QR in the panel' : '') : 'Telegram: pairing code ' + (st.telegram.pairingCode || '?') + ' — send /pair <code> to the bot');
    return true;
  }
  if (c === 'provider') {
    if (!arg) {
      const s = await api('/state?tools=0');
      note(s.providers.map((p) => p.name + ' ' + (p.ready ? '🟢' : '⚪') + ' ' + (p.models || []).join(',')).join('\n'));
      return true;
    }
    return false;
  }
  return false;
}

async function analyzePath(p) {
  if (!p) return note('give me a path: /analyze <file>');
  setStatus('RE analysis…');
  try {
    const r = await api('/re/analyze', { method: 'POST', body: { path: p } });
    const m = addMsg('sys', 'RE · ' + p.split(/[\\/]/).pop());
    m.b.innerHTML = md(String(r.result || '').slice(0, 4000));
    if (r.meta) S.reMeta = r.meta;
    const row = el('div', 'row');
    const ask = el('button', '', '→ MAJIN');
    ask.onclick = () => send('Analyze ' + p + ' more deeply. Say whether it is dangerous, what it does, and what I should check next.');
    row.append(ask);
    m.m.append(row);
    $('re-out').innerHTML = '<b>' + esc(p.split(/[\\/]/).pop()) + '</b> · risk ' + esc(r.meta?.risk ?? '?') + (r.meta?.report ? ` <a href="/api/report?file=${encodeURIComponent(r.meta.report.split(/[\\/]/).pop())}&t=${TOKEN}" style="color:var(--cy)">json</a>` : '');
  } catch (e) {
    err('RE: ' + e.message);
  } finally {
    setStatus('ready');
  }
}

/* --------------------------------- boot --------------------------------- */
async function refresh(quiet) {
  try {
    const st = await api('/state?tools=0');
    S.st = st;
    paintHeader(st);
    if (window.MAJIN_ONBOARD) window.MAJIN_ONBOARD.maybe(S.st); // first-run wizard + model chip
    if (window.paintPanel) window.paintPanel(st);
    paintRail(st);
    if (!quiet) {
      /* tyst */
    }
  } catch (e) {
    if (!quiet) err('state: ' + e.message);
  }
}
async function loadHistory() {
  const h = await api('/history?session=' + encodeURIComponent(S.session) + '&n=40').catch(() => ({ messages: [] }));
  $('scroller').innerHTML = '';
  (h.messages || []).forEach((m) => addMsg(m.role === 'user' ? 'user' : 'majin', m.role === 'user' ? 'DU' : 'MAJIN', m.content));
  if (!(h.messages || []).length) note('new session · ' + S.session);
}

$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send($('input').value);
  }
  if (e.key === 'Escape') stop();
});
$('send').onclick = () => (S.busy ? stop() : send($('input').value));
$('input').addEventListener('input', autoGrow);
$('b-rail').onclick = () => document.body.classList.toggle('rail-off');
$('c-model').onclick = () => window.MAJIN_ONBOARD && window.MAJIN_ONBOARD.togglePicker();
$('b-quit').onclick = async () => {
  if ($('b-quit').dataset.arm !== '1') { $('b-quit').dataset.arm = '1'; $('b-quit').textContent = 'quit?'; setTimeout(() => { $('b-quit').dataset.arm = ''; $('b-quit').textContent = '⏻'; }, 3000); return; }
  $('b-quit').textContent = 'closing…';
  try { await fetch('/api/shutdown?t=' + encodeURIComponent(TOKEN), { method: 'POST' }); } catch { /* it goes away either way */ }
  try { window.close(); } catch { /* browsers may refuse */ }
};
$('b-expert').onclick = () => {
  const simple = document.body.classList.toggle('simple');
  $('b-expert').classList.toggle('on', !simple);
  try { localStorage.setItem('majin.expert', simple ? '0' : '1'); } catch { /* private mode */ }
};
try { if (localStorage.getItem('majin.expert') === '1') { document.body.classList.remove('simple'); $('b-expert').classList.add('on'); } } catch { /* private mode */ }
$('b-panel').onclick = () => {
  document.body.classList.toggle('pan-off');
  $('b-panel').classList.toggle('on');
};
$('b-voice').onclick = () => {
  S.voice = !S.voice;
  $('b-voice').classList.toggle('on', S.voice);
  if (!S.voice) speechSynthesis?.cancel();
};
$('b-test').onclick = async () => {
  setStatus('selftest…');
  try {
    const r = await api('/selftest', { method: 'POST', body: { level: 'full' } });
    addMsg('sys', 'selftest', r.text || 'done');
  } catch (e) {
    err(e.message);
  }
  setStatus('ready');
};
$('mic').onclick = micToggle;
$('b-theme').onclick = () => {
  const light = document.body.classList.toggle('light');
  try { localStorage.setItem('majin.theme', light ? 'light' : 'dark'); } catch { /* private mode */ }
};
try { if (localStorage.getItem('majin.theme') === 'light') document.body.classList.add('light'); } catch { /* ignorera */ }
$('b-mode').onclick = async () => {
  const order = [['assist', 'strict'], ['approval', 'confirm'], ['full auto', 'off']];
  const i = Math.max(0, order.findIndex(([l]) => $('b-mode').textContent.trim() === l));
  const [label, mode] = order[(i + 1) % order.length];
  $('b-mode').textContent = label;
  $('b-mode').title = 'Permission mode: ' + label + ' (guard.mode=' + mode + ')';
  try {
    await api('/config', { method: 'PATCH', body: { guard: { mode } } });
    note('permission mode → ' + label);
  } catch (e) {
    err('could not set mode: ' + e.message);
  }
};
$('b-stop').onclick = () => stop();
$('re-go').onclick = () => analyzePath($('re-path').value.trim());
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  $('drop').classList.add('hot');
});
document.addEventListener('dragleave', () => $('drop').classList.remove('hot'));
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  $('drop').classList.remove('hot');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  await uploadAndAnalyze(f);
});
async function uploadAndAnalyze(f) {
  setStatus('uploading ' + f.name + '…');
  const buf = await f.arrayBuffer();
  const r = await fetch('/api/re/upload?t=' + encodeURIComponent(TOKEN) + '&name=' + encodeURIComponent(f.name), {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/octet-stream' },
    body: buf,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    err('uppladdning: ' + (j.error || r.status));
    setStatus('ready');
    return;
  }
  $('re-path').value = j.path;
  note(`got ${f.name} (${j.size} bytes) · sha256 ${String(j.sha256).slice(0, 16)}…`);
  await analyzePath(j.path);
  setStatus('ready');
}

window.addEventListener('load', async () => {
  listen();
  await refresh();
  await loadHistory();
  if (window.paintPanelExtras) window.paintPanelExtras();
  $('input').focus();
});
window.refresh = refresh; // onboarding + model picker repaint through the same funnel
