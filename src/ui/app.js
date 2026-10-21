/* MAJIN — UI. No framework, no CDN. One document, two scripts. */
const TOKEN = (window.__MAJIN_TOKEN__ || 'demo');
const S = { session: 'desktop', busy: false, st: null, voice: false, cur: null, curBody: '', tools: null, gauge: null, t0: 0 };
/* labels "const" in classic scripts do NOT get sticky on window — the chat
   list module (chats.js) reads window.S, so expose the ONE source-of-truth
   state explicitly. Without this, clicks update a ghost object while the
   real session never moves (caught by gate P0.6b). */
window.S = S;
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
  // Workspace files mentioned in a completed answer should be OPENABLE, not
  // dead inline code. The local /api/file endpoint enforces workspace bounds;
  // only a tightly restricted relative file path gets an action.
  s = s.replace(/<code>(workspace[\\/][\w .\\/\-]+\.(?:html?|md|txt|json|css|js|ts|jsx|tsx|py|csv|svg))<\/code>/gi,
    (_m, file) => '<code>' + file + '</code> <button type="button" class="chat-open-file" data-majin-file="' +
      encodeURIComponent(file) + '" aria-label="Preview ' + file.split(/[\\/]/).pop() + '">Open preview</button>');

  return s;
}

/* ------------------------------- transcript ----------------------------- */
function scroll(force = false) {
  const s = $('scroller');
  if (force || !S.readingHistory) s.scrollTop = s.scrollHeight;
}
$('scroller').addEventListener('scroll', () => {
  const n = $('scroller'); S.readingHistory = n.scrollHeight - n.clientHeight - n.scrollTop > 100;
});

/* File previews are delegated because streamed answers continuously replace
   their markup. No untrusted paths are executed as commands. */
document.getElementById('scroller')?.addEventListener('click', (event) => {
  const button = event.target.closest?.('button.chat-open-file');
  if (!button) return;
  const encoded = button.getAttribute('data-majin-file') || '';
  let file = '';
  try { file = decodeURIComponent(encoded); } catch { return; }
  if (!/^workspace[\\/][A-Za-z0-9_ .\\/\-]+\.(?:html?|md|txt|json|css|js|ts|jsx|tsx|py|csv|svg)$/i.test(file)) return;
  window.MAJIN_STUDIO?.previewFile(file.replace(/^workspace[\\/]/i, ''));
});

function addMsg(cls, who, text) {
  const welcome = $('home');
  if (welcome) welcome.remove();
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
function err(t) {
  if (!S.busy) return addMsg('err', 'MAJIN', t);
  if (S.failed) return;
  S.failed = true;
  if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.onEvent({ type: 'error', message: t });
  const a = ensureAgent();
  a.b.classList.remove('caret');
  if (a.thinking) a.thinking.remove();
  a.m.classList.add('err');
  const title = /\b(401|403)\b|unauthorized|authentication/i.test(t) ? 'Check your provider connection'
    : /\b402\b|credits|balance/i.test(t) ? 'Provider credits are needed'
    : /\b429\b|rate.limit/i.test(t) ? 'This provider is busy'
    : /not a valid model|model.*(not found|not available)|invalid.*model/i.test(t) ? "This model isn't available"
    : /\b5\d\d\b/.test(t) ? 'The provider is temporarily unavailable' : 'The request could not finish';
  a.b.textContent = '';
  a.b.append(el('strong', '', esc(title)), el('p', '', 'Your message is saved. Choose another model or retry when the connection is ready.'));
  const actions = el('div', 'error-actions');
  const choose = el('button', '', 'Choose a model');
  choose.onclick = () => window.MAJIN_ONBOARD.togglePicker();
  const failedInput = S.lastInput;
  const retry = el('button', '', 'Retry message');
  retry.onclick = () => { if (!S.busy) send(failedInput); };
  const details = el('details', 'error-details');
  details.append(el('summary', '', 'Technical details'), el('pre', '', esc(t)));
  actions.append(choose, retry); a.b.append(actions, details);
  setStatus('Request failed');
  scroll();
}

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
  if (ev.type === 'task') S.taskId = ev.task;
  if (S.stopRequested && ['error', 'answer'].includes(ev.type)) {
    if (!S.deferredStopEvent || (ev.type === 'error' && S.deferredStopEvent.type !== 'error')) S.deferredStopEvent = ev;
    return;
  }
  if (window.MAJIN_STUDIO) window.MAJIN_STUDIO.onEvent(ev);
  if (ev.type === 'error') { err(ev.message + (ev.hint ? '\n→ ' + ev.hint : '')); return; }
  if (S.failed && ['delta', 'thinking', 'answer'].includes(ev.type)) return;
  if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.onEvent(ev); // Live Agent Vision — real events only
  switch (ev.type) {
    case 'marketing_channel_setup':
      // Platform-specific credentials stay in secure inline form, never the model.
      if (window.MAJIN_MARKETING) window.MAJIN_MARKETING.showChannel(ev.platform,ev.request);
      break;
    case 'marketing_setup':
      // Private, one-time credential question inline in the conversation.
      // NEVER paste Meta tokens into /api/chat or agent history.
      if (window.MAJIN_MARKETING) window.MAJIN_MARKETING.show(ev.request);
      break;
    case 'route':
      $('c-route').innerHTML = 'route <b>' + esc(ev.job) + '</b> → ' + esc((ev.model || '?').split('/').pop()) + (ev.confidence != null && ev.confidence < 0.45 ? ' <span style="color:var(--warn)">?</span>' : '');
      $('c-route').classList.add('live');
      setStatus('Thinking…');
      break;
    case 'step':
      setStatus('step ' + ev.step + '/' + ev.of + ' · ' + (ev.model || '').split('/').pop() + (ev.escalated ? '  · escalated' : ''));
      break;
    case 'delta':
      appendDelta(ev.text);
      break;
    case 'thinking':
      if (!window.MAJIN_STUDIO) setThinking(ev.text);
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
      if (window.MAJIN_STUDIO) setStatus('Switching model');
      else note('escalating → ' + ev.to + ' (' + (ev.why || 'errors') + ')');
      break;
    case 'compact':
      if (window.MAJIN_STUDIO) setStatus('Updating context');
      else note('compacting context (' + ev.tokens + ' tok)');
      break;
    case 'plan':
      renderPlan(ev.plan);
      break;
    case 'config':
      S.st = null;
      if (window.MAJIN_STUDIO) toast('Settings updated');
      else note('config: ' + (ev.notes || []).join(' · '));
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
      if (!S.failed) closeAnswer(ev);
      break;
    case 'error':
      err(ev.message + (ev.hint ? '\n→ ' + ev.hint : ''));
      break;
    default:
      break;
  }
}

function closeAnswer(ev) {
  const a = S.cur || (ev.text ? ensureAgent() : null);
  if (a) {
    a.b.classList.remove('caret');
    if (a.thinking) a.thinking.remove();
    if (!a.b.innerHTML.trim() && ev.text) a.b.innerHTML = md(ev.text);
    const meta = ev.meta || {};
    const foot = el('div', 'foot');
    const secs = ((Date.now() - S.t0) / 1000).toFixed(1);
    foot.textContent = [meta.job && 'job ' + meta.job, meta.steps && meta.steps + ' steps', meta.tools && meta.tools + ' tools', meta.usage && (meta.usage.input + '→' + meta.usage.output + ' tok'), meta.usage && meta.usage.costUsd ? '$' + meta.usage.costUsd.toFixed(4) : null, secs + 's'].filter(Boolean).join(' · ');
    a.m.append(foot);
    const audibleReply = String(ev.text || S.curBody || '').trim();
    if (S.voice && S.voiceTurn && !S.cancelled && audibleReply) void speak(audibleReply);
  }
  S.cur = null;
  S.tools = null;
}

/* --------------------------------- send --------------------------------- */
async function send(text, options = {}) {

  const input = String(text || '').trim();
  if (!input) return false;
  if (S.stopRequested) { toast('Waiting for stop confirmation.'); return false; }
  if (input[0] === '/') {
    const ok = await command(input);
    if (ok) return true;
  }
  /* AUTOPILOT: a task is already running on this chat — this new message is
     an independent task, it gets its own agent, card and stop button and
     must NEVER wait for the first one. The /stop command above still reaches
     the running task. */
  if (S.busy) return parallelTask(input);
  // Typing is not a voice command. Stop hands-free listening before sending,
  // otherwise microphone, keyboard and synthesized audio race each other.
  if (!options.voiceTurn && S.handsFree) {
    S.handsFree = false;
    stopMic();
    window.speechSynthesis?.cancel();
  }
  S.voiceTurn = Boolean(options.voiceTurn);
  if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.reset(); // a new run gets a fresh canvas
  if (window.MAJIN_STUDIO) window.MAJIN_STUDIO.setState('connecting');
  S.taskId = null; S.deferredStopEvent = null;
  S.failed = false; S.lastInput = input; S.completed = false; S.readingHistory = false;
  addMsg('user', 'You', input);
  /* P0 repair: this chat moves to the top IMMEDIATELY (optimistic), reconciles
     with the server's durable index at completion/error without flicker. */
  if (window.MAJIN_CHATS) window.MAJIN_CHATS.bumpActive(S.session, input);
  $('input').value = '';
  autoGrow();
  S.busy = true;
  S.t0 = Date.now();
  syncSendButton();
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
    if (!r.ok || !r.body) throw new Error('Request failed (HTTP ' + r.status + ')');
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
        ev.type ||= raw.split('\n').find((l) => l.startsWith('event: '))?.slice(7).trim();
        if (ev.type === 'done') {
          S.completed = true;
          if (ev.ok === false && !S.failed) onEvent({ type: 'error', message: 'The provider could not complete this request.' });
          if (window.MAJIN_CHATS) window.MAJIN_CHATS.refresh(); /* server truth: durable index updated by the accepted send */
          continue;
        }
        onEvent(ev);
      }
    }
    if (!S.completed && !S.failed && !S.stopRequested) err('The response stream ended before completion.');
    /* u03 (real-world audit 2026-10-20): a completed stream with an EMPTY body
       must never silently remove the spinner — say the truth instead. */
    if (S.cur && !S.failed && !S.stopRequested) {
      if (!String(S.curBody || '').trim()) {
        err('The model finished without saying anything (empty reply). Test the provider in the Providers card, then try again.');
      } else closeAnswer({ text: S.curBody, meta: {} });
    }
  } catch (e) {
    if (e.name !== 'AbortError') err('connection lost: ' + e.message);
    else {
      S.cancelled = true;
      if (S.cur) closeAnswer({ text: S.curBody, meta: {} });
      if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.onEvent({ type: 'cancelled' });
    }
  } finally {
    S.busy = false;
    S.abort = null;
    syncSendButton();
    if (S.failed && !$('input').value) { $('input').value = input; autoGrow(); }
    setStatus(S.stopRequested ? 'Stopping task…' : S.failed ? 'Request failed · message preserved' : S.cancelled ? 'Stopped' : 'Ready');
    if (S.stopRequested && S.cur) { S.cur.b.classList.remove('caret'); if (S.cur.thinking) S.cur.thinking.remove(); }
    if (!S.stopRequested) S.cur = null;
    S.cancelled = false;
    refresh(true);
  }
  return true;
}

async function stop() {
  if (!S.busy || S.stopRequested) return;
  try { await stopObservedTask(S.taskId, S.session); }
  catch (e) { toast('Could not stop: ' + e.message); }
}

// One acknowledged backend action keeps Workspace and chat cancellation in sync.
async function stopObservedTask(id, session) {
  const main = S.busy && (id ? S.taskId === id : session === S.session);
  const rec = id ? PLIVE.find(t => t.id === id && !t.finished) : null;
  if (main) { S.stopRequested = true; S.deferredStopEvent = null; setStatus('Stopping task…'); }
  if (rec) { rec.stopRequested = true; rec.card.stopb.disabled = true; }
  try {
    const result = await api('/chat/stop', { method: 'POST', body: id ? { task: id } : { session } });
    if (result.ok !== true) throw new Error(result.error || 'Stop was not confirmed by the server');
  } catch (e) {
    if (main) {
      S.stopRequested = false;
      if (S.deferredStopEvent) {
        const busy = S.busy; S.busy = true; onEvent(S.deferredStopEvent); S.busy = busy;
        if (!busy) { setStatus(S.failed ? 'Request failed · message preserved' : 'Ready'); S.cur = null; }
      }
      else setStatus('Stop failed · task may still be running');
      S.deferredStopEvent = null;
    }
    if (rec) {
      rec.stopRequested = false; rec.card.stopb.disabled = false;
      if (rec.deferredStopError) taskEvent(rec, 'error', rec.deferredStopError);
      if (rec.deferredStopDone) finishTask(rec, rec.deferredStopDone);
    }
    throw e;
  }
  if (main) {
    S.stopRequested = false; S.failed = false; S.cancelled = true; S.deferredStopEvent = null;
    S.abort?.abort();
    if (!S.busy) {
      if (S.cur) closeAnswer({ text: S.curBody, meta: {} });
      S.cancelled = false; setStatus('Stopped');
      if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.onEvent({ type: 'cancelled' });
    }
  }
  if (rec) {
    rec.stopRequested = false; rec.status = 'stopped'; rec.finished = true; rec.endAt = Date.now();
    telLeave(rec); paintTel(rec); paintTaskState(rec, 'stopped on request');
    rec.card.m.classList.add('task-bad'); rec.abort.abort();
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

const P_STATUS = { working: '🔧 working', waiting: '⏳ waiting', paused: '⏸ paused', done: '✅ done', error: '❌ error', stopped: '🟥 stopped' };

/* one SSE stream drives one card: first message creates the task, follow-ups
   rejoin it (payload.task), resume IS a follow-up with a continue-brief. */
async function driveCard(rec, payload) {
  rec.abort = new AbortController();
  try {
    const r = await fetch('/api/chat?t=' + encodeURIComponent(TOKEN), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
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
    if (!rec.finished && !rec.paused) finishTask(rec, { ok: true });
  } catch (e) {
    if (e.name === 'AbortError' || rec.finished || rec.paused) { /* stopped/paused on purpose */ }
    else { rec.status = 'error'; paintTaskState(rec, 'error; '+e.message); }
  }
}

function parallelTask(input) {
  addMsg('user', 'YOU · PARALLEL', input);
  $('input').value = '';
  autoGrow();
  const card = taskCard({ label: '🧵 launching…', status: 'waiting' });
  const rec = { card, input, id: null, text: '', last: '', painted: 0, finished: false, paused: false, toolCount: 0, toolMs: 0, abort: new AbortController() };
  card.rec = rec;
  telJoin(rec);
  driveCard(rec, { input, autopilot: true });
  return true;
}

/* follow-up into the SAME task session (the card's history, not a new task) */
function replyToTask(rec, text, { quiet = false } = {}) {
  if (!rec || !rec.id || !String(text || '').trim()) return;
  rec.paused = false;
  if (rec.finished) {
    rec.finished = false;
    rec.endAt = null;
    rec.card.stopb.disabled = false;
    rec.card.m.classList.remove('task-done', 'task-bad');
    telJoin(rec);
  }
  rec.status = 'working';
  paintTaskState(rec, quiet ? 'continuing from where it paused…' : 'reading your reply…');
  if (!quiet) {
    rec.text += '\n\n**you:** ' + text + '\n\n';
    paintTaskText(rec, true);
  }
  driveCard(rec, { input: String(text), task: rec.id });
}

async function pauseTask(rec) {
  if (!rec || !rec.id) return;
  rec.card.pauseb.disabled = true;
  try {
    const r = await api('/tasks/action', { method: 'POST', body: { task: rec.id, action: 'pause' } });
    if (r && r.ok) {
      rec.paused = true;
      rec.status = 'paused';
      paintTaskState(rec, 'paused — the whole context is kept');
      telLeave(rec);
      paintTel(rec);
      paintPauseBtn(rec);
    } else {
      paintTaskState(rec, 'could not pause: ' + ((r && r.error) || 'server said no'));
    }
  } catch (e) {
    paintTaskState(rec, 'could not pause: ' + e.message);
  }
  rec.card.pauseb.disabled = false;
}

function resumeTask(rec) {
  paintPauseBtn(rec);
  /* resume = the continue follow-up: it streams onto this very card */
  replyToTask(rec, 'Continue from the step you were on when you paused. Do not restart from zero — the earlier context in this session is the shared state of work.', { quiet: true });
}

function paintPauseBtn(rec) {
  rec.card.pauseb.textContent = rec.status === 'paused' ? '▶ resume' : '⏸ pause';
  rec.card.pauseb.onclick = () => (rec.status === 'paused' ? resumeTask(rec) : pauseTask(rec));
  rec.card.pauseb.style.display = rec.finished ? 'none' : '';
}

function taskCard({ label, status }) {
  const m = el('div', 'msg task');
  const head = el('div', 'task-head');
  const idl = el('span', 'task-id', esc(label));
  const st = el('span', 'task-status st-waiting', esc(P_STATUS[status] || status));
  const pauseb = el('button', 'task-pause', '⏸ pause');
  const stopb = el('button', 'task-stop', '⏹ stop');
  const act = el('div', 'task-act kv', '…');
  const tel = el('div', 'task-tel', '');
  const ans = el('div', 'body task-ans', '');
  const foot = el('div', 'task-foot');
  const rinput = el('input', 'task-reply');
  rinput.placeholder = 'reply to this agent…';
  const rbtn = el('button', 'task-send', '↩ send');
  foot.append(rinput, rbtn);
  head.append(idl, st, pauseb, stopb);
  m.append(head, act, tel, ans, foot);
  $('scroller').append(m);
  scroll();
  const card = { m, idl, st, pauseb, stopb, act, tel, ans, foot, rinput, rbtn };
  stopb.onclick = () => stopTask(card.rec);
  const sendReply = () => {
    const text = rinput.value.trim();
    if (!text || !card.rec) return;
    rinput.value = '';
    replyToTask(card.rec, text);
  };
  rbtn.onclick = sendReply;
  rinput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } };
  pauseb.onclick = () => pauseTask(card.rec);
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
  if (rec.stopRequested && name === 'error') { rec.deferredStopError = ev; return; }
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
  if (rec.stopRequested) { rec.deferredStopDone = doneEv; return; }
  if (rec.finished) return;
  rec.finished = true;
  rec.endAt = Date.now();
  telLeave(rec);
  rec.status = doneEv.ok === false || rec.status === 'error' ? 'error' : 'done';
  paintTaskState(rec, (doneEv.steps ? doneEv.steps + ' steps · ' : '') + (doneEv.usage && doneEv.usage.costUsd ? '$' + doneEv.usage.costUsd.toFixed(4) + ' · ' : '') + (rec.status === 'error' ? 'failed' : 'done'));
  paintTel(rec);
  paintTaskText(rec, true);
  rec.card.stopb.disabled = true;
  paintPauseBtn(rec);
  rec.card.m.classList.add(rec.status === 'done' ? 'task-done' : 'task-bad');
  refresh && refresh(true);
}

async function stopTask(rec) {
  if (!rec || !rec.id || rec.stopRequested) return;
  try { await stopObservedTask(rec.id); }
  catch (e) { toast('Could not stop: ' + e.message); }
}

/* ------------------------------ live deck --------------------------------
   A slim strip over the chat: every RUNNING/WAITING/Paused task from the
   backend registry — including ones started from channels where no card
   exists. Real data only; it hides when the machine is quiet. */
const deck = { el: null, timer: null };

function deckEnsure() {
  if (deck.el) return deck.el;
  deck.el = el('section', 'deck', '');
  deck.el.hidden = true;
  const main = $('main');
  if (main) main.insertBefore(deck.el, main.firstChild);
  return deck.el;
}

function deckRow(t) {
  const dot = t.status === 'running' ? '🟢' : t.status === 'paused' ? '⏸' : '🟡';
  const age = fmtDur((t.status === 'running' || t.status === 'waiting' ? Date.now() : t.updated) - t.created);
  const tools = t.toolsRun ? ' · ' + t.toolsRun + ' tools' : '';
  return '<div class="deck-row"><span class="deck-dot">' + dot + '</span> <b>' + esc(t.id) + '</b> ' + esc((t.input || '').slice(0, 70)) +
    ' <span class="kv">' + esc(t.status) + ' · ⏱ ' + age + tools + '</span></div>';
}

async function deckTick() {
  const elx = deckEnsure();
  let d = null;
  try {
    d = await (await fetch('/api/tasks?t=' + encodeURIComponent(TOKEN), { headers: { authorization: 'Bearer ' + TOKEN } })).json();
  } catch { d = null; }
  if (window.MAJIN_STUDIO) {
    if (d && Array.isArray(d.tasks)) window.MAJIN_STUDIO.updateTasks(d.tasks);
    else window.MAJIN_STUDIO.tasksUnavailable();
  }
  const active = d && Array.isArray(d.tasks) ? d.tasks.filter((t) => ['running', 'waiting', 'paused'].includes(t.status)) : [];
  if (!active.length) { elx.hidden = true; return; }
  elx.hidden = false;
  elx.innerHTML = '<div class="deck-title">agents at work: ' + active.length + '</div>' + active.map(deckRow).join('');
  scroll();
}

function deckStart() {
  deckEnsure();
  deckTick();
  if (!deck.timer) deck.timer = setInterval(deckTick, 5000);
}
document.addEventListener('DOMContentLoaded', deckStart);

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
    const result = await api('/approve', { method: 'POST', body: { id, approved } });
    if (result.ok !== true) throw new Error('This approval is no longer pending.');
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
  es.onopen = () => { if (!S.busy) setStatus('Connected'); refresh(true); };
  es.onerror = () => {
    setStatus('reconnecting…');
  };
}

/* ------------------------- hands-free voice -------------------------- */
let recog=null, speechActive=false, voiceArmed=false;
function voiceState(mode,label) {
  document.body.dataset.voiceMode=mode;
  if ($('mic-state')) $('mic-state').textContent=label;
  $('mic')?.setAttribute('aria-pressed',String(mode==='listening'));
}
function stopMic() {
  voiceArmed=false; S.listening=false;
  const r=recog;recog=null;
  try {r?.abort();} catch{}
  $('mic')?.classList.remove('on');
  voiceState('idle','Voice ready');
}
function startMic() {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if (!SR) {voiceState('error','Speech recognition unavailable');return;}
  if (speechActive||S.busy) return;
  const r=new SR();recog=r;voiceArmed=true;S.listening=true;
  r.lang=S.st?.config?.ui?.voice?.lang||'sv-SE';
  r.continuous=false;r.interimResults=true;
  r.onstart=()=>voiceState('listening','Listening…');
  r.onresult=e=>{
    let words='',complete='';
    for(let i=0;i<e.results.length;i++){
      const chunk=e.results[i][0]?.transcript||'';
      words+=chunk;
      if(e.results[i].isFinal)complete+=chunk;
    }
    voiceState('listening',words.trim()||'Listening…');
    if(!complete.trim()) return;
    const wake=String(S.st?.config?.ui?.voice?.wakeWord||'').trim();
    let command=complete.trim();
    if(wake){
      if(!command.toLowerCase().startsWith(wake.toLowerCase()))return;
      command=command.slice(wake.length).trim();
    }
    if(!command)return;
    voiceArmed=false;S.listening=false;recog=null;
    try{r.stop();}catch{}
    $('input').value=command;autoGrow();
    voiceState('thinking','Working…');
    send(command, { voiceTurn: true });
  };
  r.onerror=e=>{
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      stopMic();voiceState('error','Allow microphone access');
    }else if(e.error!=='no-speech'&&e.error!=='aborted'){
      stopMic();voiceState('error','Voice: '+e.error);
    }
  };
  r.onend=()=>{
    if(recog!==r)return;
    S.listening=false;
    if(voiceArmed&&!S.busy&&!speechActive){recog=null;startMic();}
  };
  try{r.start();$('mic').classList.add('on');}
  catch(e){stopMic();voiceState('error',e.message);}
}
function micToggle(){
  if(S.handsFree){S.handsFree=false;S.voiceTurn=false;stopMic();window.speechSynthesis?.cancel();}
  else {S.handsFree=true;S.voice=true;S.voiceTurn=false;$('b-voice')?.classList.add('on');startMic();}
}
let currentVoiceAudio=null, voiceRequest=null;
async function neuralNarrator(text){
  const controller=new AbortController();
  voiceRequest=controller;
  const timeout=setTimeout(()=>controller.abort(),25000);
  try {
    const res=await fetch('http://127.0.0.1:18765/speak',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({text}),signal:controller.signal
    });
    if(!res.ok)throw new Error('Local Kokoro voice unavailable');
    const wav=await res.blob();
    if(wav.type && !wav.type.includes('wav'))throw new Error('Local narrator did not return WAV');
    const url=URL.createObjectURL(wav);
    const audio=new Audio(url);currentVoiceAudio=audio;
    try {
      await new Promise((resolve,reject)=>{
        audio.onended=resolve;audio.onerror=()=>reject(new Error('WAV playback failed'));
        audio.play().catch(reject);
      });
      return true;
    } finally {URL.revokeObjectURL(url);}
  } finally {
    clearTimeout(timeout);voiceRequest=null;
    if(currentVoiceAudio){currentVoiceAudio.pause();currentVoiceAudio=null;}
  }
}
function browserNarrator(clean){
  return new Promise((resolve,reject)=>{
    if(!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)){
      reject(new Error('No text-to-speech engine is available in this browser'));return;
    }
    const engine=window.speechSynthesis;
    let finished=false;
    // Some Chromium/Windows installations never fire onend when output is
    // unavailable. Bound the turn so the microphone can resume.
    const timeout=setTimeout(()=>finish(new Error('Speech playback timed out; check Windows audio output')),Math.min(60000,8000+clean.length*110));
    function finish(error){
      if(finished)return;
      finished=true;clearTimeout(timeout);
      if(error){try{engine.cancel();}catch{}reject(error);}
      else resolve(true);
    }
    const u=new SpeechSynthesisUtterance(clean);
    const lang=S.st?.config?.ui?.voice?.lang||'sv-SE';
    u.lang=lang;u.rate=S.st?.config?.ui?.voice?.rate||1.04;
    const voices=engine.getVoices().filter(x=>x.lang?.slice(0,2).toLowerCase()===lang.slice(0,2).toLowerCase());
    u.voice=voices.find(x=>/natural|neural/i.test(x.name))||voices[0]||null;
    u.onend=()=>finish();
    u.onerror=e=>finish(new Error('Speech playback failed: '+(e.error||'unknown')));
    try{engine.cancel();engine.resume();engine.speak(u);}
    catch(e){finish(e);}
  });
}
async function speak(t){
  if(!S.voice)return;
  const clean=String(t).replace(/\`[^\`]+\`/g,' ').replace(/https?:\/\/\S+/g,' link ').replace(/[*_#]/g,'').slice(0,1200).trim();
  if(!clean)return;
  stopMic();
  speechActive=true;voiceState('speaking','MAJIN speaking…');
  try {
    // A locally configured Kokoro narrator is optional; never silently
    // claim audible playback if both Kokoro and browser TTS fail.
    if(S.narratorEnglish === true){
      try{await neuralNarrator(clean);return;}
      catch(e){voiceState('speaking','Local narrator unavailable; trying system voice');}
    }
    await browserNarrator(clean);
  } catch(e) {
    voiceState('error','Could not play speech: '+e.message);
    toast('Voice output failed: '+e.message+'. Check volume and selected Windows audio device.');
  } finally {
    speechActive=false;
    if(S.handsFree&&!S.busy)startMic();
    else if(document.body.dataset.voiceMode==='speaking')voiceState('idle','Voice ready');
  }
}

/* ------------------------------- composer ------------------------------- */
function syncSendButton() {
  const button = $('send');
  button.classList.toggle('busy', S.busy);
  button.disabled = !S.busy && !$('input').value.trim();
  button.setAttribute('aria-label', S.busy ? 'Stop response' : 'Send message');
  button.title = S.busy ? 'Stop response' : 'Send message';
}
function autoGrow() {
  const i = $('input');
  i.style.height = 'auto';
  i.style.height = Math.min(240, i.scrollHeight + 2) + 'px';
  syncSendButton();
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
    await api('/config', { method: 'PATCH', body: { budget: { monthlyUsd: n, mode: 'cap' } } });
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
    if (S.st?.version && st.version && S.st.version !== st.version && !S.busy) {
      try { sessionStorage.setItem('majin.update.resume', JSON.stringify({ session: S.session, draft: $('input').value })); } catch { /* storage unavailable */ }
      location.reload();
      return;
    }
    S.st = st;
    paintHeader(st);
    if (window.MAJIN_ONBOARD) window.MAJIN_ONBOARD.maybe(S.st); // first-run wizard + model chip
    if (window.paintPanel) window.paintPanel(st);
    paintRail(st);
    if (window.MAJIN_STUDIO) window.MAJIN_STUDIO.setUsage(st.usage || {});
    if (!quiet) {
      /* tyst */
    }
  } catch (e) {
    if (!quiet) err('state: ' + e.message);
  }
}
async function loadHistory() {
  S.readingHistory = false; S.failed = false; S.cur = null; S.curBody = '';
  setStatus('Ready');
  if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.reset();
  const h = await api('/history?session=' + encodeURIComponent(S.session) + '&n=40').catch(() => ({ messages: [] }));
  $('scroller').innerHTML = '';
  (h.messages || []).forEach((m) => addMsg(m.role === 'user' ? 'user' : 'majin', m.role === 'user' ? 'DU' : 'MAJIN', m.content));
  if (!(h.messages || []).length) showWelcome();
}
function showWelcome() {
  const panel = $('scroller');
  const welcome = document.createElement('section');
  welcome.id = 'home';
  welcome.className = 'home';
  const emblem = el('div', 'home-emblem', '<span class="living-orb" aria-hidden="true"><i></i><i></i><i></i></span>');
  const title = document.createElement('h2');
  title.textContent = 'What’s next?';
  welcome.append(emblem, title);
  panel.append(welcome);
}

function closeMobileRail() {
  if (matchMedia('(max-width:1000px)').matches) {
    document.body.classList.remove('mobile-rail');
    document.body.classList.add('rail-off');
    $('b-rail').setAttribute('aria-expanded', 'false');
  }
}
async function newChat() {
  if (S.busy || S.stopRequested) { toast('Stop the current task before starting a new chat.'); return; }
  closeMobileRail();
  S.session = 'chat-' + Date.now().toString(36);
  $('input').value = ''; autoGrow();
  if (window.MAJIN_CHATS) window.MAJIN_CHATS.bumpActive(S.session, null); /* pending empty chat visible while active, durable only once materialized by a real send */
  await loadHistory(); $('input').focus();
}
$('new-chat').onclick = newChat;
/* Ctrl+N lives in studio.js (bubbles through to this handler). */
$('browse-models').onclick = () => { closeMobileRail(); window.MAJIN_ONBOARD.togglePicker(); };
$('manage-providers').onclick = () => { closeMobileRail(); window.MAJIN_ONBOARD.reopen(); };
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send($('input').value);
  }
  if (e.key === 'Escape') stop();
});
$('send').onclick = () => (S.busy ? stop() : send($('input').value));
$('input').addEventListener('input', autoGrow);
$('b-rail').onclick = () => {
  if (matchMedia('(max-width:1000px)').matches) {
    const open = document.body.classList.toggle('mobile-rail');
    document.body.classList.toggle('rail-off', !open);
    $('b-rail').setAttribute('aria-expanded', String(open));
  } else { const off = document.body.classList.toggle('rail-off'); $('b-rail').setAttribute('aria-expanded', String(!off)); }
};
$('c-model').onclick = () => window.MAJIN_ONBOARD && window.MAJIN_ONBOARD.togglePicker();
$('b-quit').onclick = async () => {
  if ($('b-quit').dataset.arm !== '1') { $('b-quit').dataset.arm = '1'; $('b-quit').textContent = 'quit?'; setTimeout(() => { $('b-quit').dataset.arm = ''; $('b-quit').textContent = window.MAJIN_STUDIO ? 'Quit MAJIN' : '⏻'; }, 3000); return; }
  $('b-quit').textContent = 'closing…';
  try { await fetch('/api/shutdown?t=' + encodeURIComponent(TOKEN), { method: 'POST' }); } catch { /* it goes away either way */ }
  try { window.close(); } catch { /* browsers may refuse */ }
};
$('b-expert').onclick = () => {
  if (window.MAJIN_STUDIO) { window.MAJIN_STUDIO.open('settings'); return; }
  const simple = document.body.classList.toggle('simple');
  $('b-expert').classList.toggle('on', !simple);
  try { localStorage.setItem('majin.expert', simple ? '0' : '1'); } catch { /* private mode */ }
};
try { if (!window.MAJIN_STUDIO && localStorage.getItem('majin.expert') === '1') { document.body.classList.remove('simple'); $('b-expert').classList.add('on'); } } catch { /* private mode */ }
$('b-panel').onclick = () => {
  document.body.classList.toggle('pan-off');
  $('b-panel').classList.toggle('on');
};
S.narratorEnglish = false;
try { S.narratorEnglish = localStorage.getItem('majin.voice.narratorEN') === 'true'; } catch {}
$('b-narrator')?.classList.toggle('on', S.narratorEnglish);
$('b-narrator')?.setAttribute('aria-pressed', String(S.narratorEnglish));
$('b-narrator').onclick = () => {
  S.narratorEnglish = !S.narratorEnglish;
  $('b-narrator').classList.toggle('on', S.narratorEnglish);
  $('b-narrator').setAttribute('aria-pressed', String(S.narratorEnglish));
  try {localStorage.setItem('majin.voice.narratorEN', String(S.narratorEnglish));}catch{}
  toast(S.narratorEnglish ? 'English Kokoro narrator enabled. Speak English for best quality.' : 'System voice enabled.');
};
$('b-voice').onclick = () => {
  S.voice = !S.voice;
  $('b-voice').classList.toggle('on', S.voice);
  if (!S.voice) {S.handsFree=false;stopMic();window.speechSynthesis?.cancel();}
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
  document.body.classList.add('theme-changing');
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('theme-changing')));
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
  try {
    const resume = JSON.parse(sessionStorage.getItem('majin.update.resume') || 'null');
    sessionStorage.removeItem('majin.update.resume');
    if (resume && typeof resume.session === 'string' && typeof resume.draft === 'string') {
      S.session = resume.session; $('input').value = resume.draft; autoGrow();
    }
  } catch { /* storage unavailable */ }
  listen();
  await refresh();
  await loadHistory();
  // Check on every app launch and repaint as soon as the request finishes.
  // A fixed 6.5-second refresh missed slow GitHub responses until the next
  // hourly check, leaving the update chip invisible even after CLI detected it.
  // Do not block chat or app startup on GitHub's network latency.
  if (S.st?.config?.updates?.check !== false) {
    void (async () => {
      try {
        await api('/update', { method: 'POST', body: { action: 'check', force: true } });
      } catch { /* Offline GitHub must not interrupt MAJIN; Check updates remains visible. */ }
      await refresh(true);
    })();
  }
  // Keep a running window informed of later releases, even if never reopened.
  setInterval(async () => {
    try {
      const st = await api('/state?tools=0');
      if (st?.config?.updates?.check === false) return;
      await api('/update', { method: 'POST', body: { action: 'check', force: true } });
      await refresh(true);
    } catch { /* an offline GitHub cannot interrupt MAJIN */ }
  }, 60 * 60 * 1000);
  if (window.paintPanelExtras) window.paintPanelExtras();
  $('input').focus();
});
window.MAJIN_CHAT = { stopTask: stopObservedTask };
window.refresh = refresh; // onboarding + model picker repaint through the same funnel
