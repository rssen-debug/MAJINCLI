/* LENT — panel + sidorader. Anropas av app.js (delad global skriptmiljö). */
async function paintHeader(st) {
  const ui = st.config.ui || {};
  document.title = (ui.title || st.name || 'LENT') + ' · agent';
  $('brand').textContent = (ui.title || st.name || 'LENT').toUpperCase();
  $('tagline').textContent = ui.tagline || '';
  $('c-tools').innerHTML = 'tools <b>' + (st.tools.count || (st.tools || []).length) + '</b>';
  $('c-moa').innerHTML = 'MOA <b>' + (st.moa.policy === 'off' ? 'av' : st.moa.width + '→' + String(st.moa.aggregator || '').split('/').pop()) + '</b>';
  $('c-moa').classList.toggle('live', st.moa.policy !== 'off');
  const u = st.usage || {};
  $('c-cost').innerHTML = '$<b>' + (u.costUsd != null ? Number(u.costUsd).toFixed(2) : '0') + '</b>' + (u.budgetUsd ? '/' + u.budgetUsd : '') + '<span class="kv"> · ' + (u.requests || 0) + ' anrop</span>';
  const tg = st.channels.telegram || {};
  const wa = st.channels.whatsapp || {};
  led('led-tg', tg.online ? 'g' : tg.state === 'pairing' || tg.state === 'no-token' ? 'y' : tg.state === 'error' ? 'r' : '');
  led('led-wa', wa.online ? 'g' : wa.state === 'pairing' ? 'y' : wa.state === 'missing-dep' || wa.state === 'error' ? 'r' : '');
  $('c-tg').title = 'telegram: ' + (tg.state || '?') + (tg.lastError ? ' · ' + tg.lastError : '') + (tg.pairingCode ? ' · kod ' + tg.pairingCode : '');
  $('c-wa').title = 'whatsapp: ' + (wa.state || '?') + (wa.transport ? ' · ' + wa.transport : '') + (wa.lastError ? ' · ' + wa.lastError : '');
  if (st.needsSetup) note('Ingen API-nyckel ännu — demo-läget svarar med mock. Skriv nyckeln i paneln Providers, eller be mig: "använd nyckeln sk-… för deepseek".');
}

function led(id, cls) {
  const n = $(id);
  if (!n) return;
  n.className = 'led' + (cls ? ' ' + cls : '');
}

async function paintRail(st) {
  const s = await api('/sessions').catch(() => ({ sessions: [] }));
  const box = $('sessions');
  box.innerHTML = '';
  const list = [{ id: 'desktop', messages: 0, lastText: 'den här enheten' }, ...(s.sessions || [])];
  const seen = new Set();
  for (const it of list) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const n = el('div', 'sess' + (it.id === S.session ? ' act' : ''), esc(it.id.length > 22 ? it.id.slice(0, 21) + '…' : it.id) + ' <span class="kv">' + (it.messages || 0) + '</span>');
    n.title = (it.lastText || '') + '\n' + (it.mtime || '');
    n.onclick = () => {
      S.session = it.id;
      box.querySelectorAll('.sess').forEach((x) => x.classList.remove('act'));
      n.classList.add('act');
      loadHistory();
    };
    box.append(n);
  }
  if (st.schedule && st.schedule.length) {
    $('sched').innerHTML = st.schedule
      .map((j) => `<div><b>${esc(j.name || j.id)}</b> · ${esc(j.when || '')}<br><span class="kv">nästa ${esc(j.nextRunHuman || '')}${j.paused ? ' · pausad' : ''}${j.lastStatus ? ' · ' + esc(j.lastStatus) : ''}</span></div>`)
      .join('');
  } else $('sched').textContent = 'inga jobb';
  const mem = st.memory || {};
  $('mem').innerHTML = `<b>${mem.facts ?? mem.count ?? 0}</b> fakta · <b>${mem.events ?? mem.eventCount ?? 0}</b> händelser${mem.file ? '<br><span class="kv">' + esc(String(mem.file).split(/[\\/]/).pop()) + '</span>' : ''}<br><span class="kv">${(st.skills || []).length} färdigheter${(st.skills || []).length ? ': ' + esc((st.skills || []).slice(0, 3).map((k) => k.name).join(', ')) : ''}</span>`;
}

function renderPlan(plan) {
  const box = $('plan');
  if (!box) return;
  if (!plan) {
    box.innerHTML = '<div>–</div>';
    return;
  }
  box.innerHTML = plan
    .map((p) => `<div class="${esc(p.status || '')}">${p.status === 'done' ? '✔' : p.status === 'doing' ? '▸' : p.status === 'blocked' ? '✕' : '○'} ${esc(p.text)}</div>`)
    .join('');
}

async function paintPanel(st) {
  /* ---- routing ---- */
  const options = (st.providers || []).flatMap((p) => (p.models || []).map((m) => `${p.name}/${m}`));
  const r = $('routes');
  r.innerHTML = '';
  for (const row of st.routes || []) {
    const div = el('div', 'row');
    div.append(el('span', '', row.job));
    const sel = el('select');
    sel.innerHTML = ['<option value="">—</option>']
      .concat(options.map((o) => `<option ${o === row.ref ? 'selected' : ''}>${esc(o)}</option>`))
      .join('');
    if (!options.includes(row.ref) && row.ref) sel.innerHTML += `<option selected>${esc(row.ref)}</option>`;
    sel.onchange = () => setConfig({ models: { routes: { [row.job]: sel.value } } }, row.job + ' → ' + sel.value);
    div.append(sel);
    if (!row.ready) div.append(el('span', 'kv', '⚠ ingen nyckel'));
    r.append(div);
  }

  /* ---- MOA ---- */
  const m = $('moactl');
  m.innerHTML = '';
  const pol = el('div', 'row');
  pol.append(el('span', '', 'policy'));
  ['always', 'hard', 'off'].forEach((p) => {
    const b = el('button', st.moa.policy === p ? 'on' : '', p);
    b.onclick = () => setConfig({ moa: { policy: p, enabled: p !== 'off' } }, 'MOA ' + p);
    pol.append(b);
  });
  m.append(pol);
  const w = el('div', 'row');
  w.append(el('span', '', 'bredd'));
  for (let i = 2; i <= 5; i += 1) {
    const b = el('button', st.moa.width === i ? 'on' : '', String(i));
    b.onclick = () => setConfig({ moa: { width: i } }, 'MOA bredd ' + i);
    w.append(b);
  }
  m.append(w);
  m.append(el('div', 'kv', 'referenser: ' + (st.moa.refs || []).map((x) => String(x).split('/').pop()).join(', ') + '<br>aggregator: <b>' + esc(String(st.moa.aggregator || '').split('/').pop()) + '</b>'));

  /* ---- guard ---- */
  const g = $('guardctl');
  g.innerHTML = '';
  const gr = el('div', 'row');
  gr.append(el('span', '', 'läge'));
  ['confirm', 'strict', 'off'].forEach((mode) => {
    const b = el('button', st.guard.mode === mode ? 'on' : '', mode);
    b.onclick = () => setConfig({ guard: { mode } }, 'guard ' + mode);
    gr.append(b);
  });
  g.append(gr);
  if (st.guard.pending) {
    const p = el('div', 'row');
    p.append(el('span', 'kv', st.guard.pending + ' väntar'));
    g.append(p);
  }
  g.append(el('div', 'kv', (st.guard.recent || []).slice(-3).map((a) => `${a.tool} ${a.approved ? '✔' : '✕'}`).join(' · ') || 'inga beslut ännu'));

  /* ---- providers ---- */
  const pr = $('providers');
  pr.innerHTML = '';
  for (const p of st.providers || []) {
    const row = el('div', 'row');
    row.append(el('span', '', (p.ready ? '🟢 ' : '⚪ ') + p.name));
    const test = el('button', '', 'testa');
    test.onclick = async () => {
      setStatus('testar ' + p.name + '…');
      const res = await api('/provider/test', { method: 'POST', body: { provider: p.name, ref: `${p.name}/${(p.models || [''])[0]}` } }).catch((e) => ({ ok: false, error: e.message }));
      toast(`${p.name}: ${res.ok ? 'ok ' + res.ms + 'ms' : 'fel — ' + (res.error || '') + (res.hint ? ' · ' + res.hint : '')}`);
      setStatus('redo');
    };
    const use = el('button', '', 'använd');
    use.onclick = () => {
      const routes = {};
      for (const row2 of st.routes || []) routes[row2.job] = `${p.name}/${(p.models || [''])[0]}`;
      setConfig({ models: { provider: p.name, routes } }, 'allt → ' + p.name);
    };
    row.append(test, use);
    if ((p.models || []).length) row.append(el('span', 'kv', p.models.slice(0, 3).join(',')));
    pr.append(row);
  }
  const add = el('div', 'row');
  const preset = el('select');
  preset.innerHTML = ['deepseek', 'openrouter', 'groq', 'openai', 'anthropic', 'gemini', 'ollama', 'lmstudio', 'mock']
    .map((x) => `<option>${x}</option>`)
    .join('');
  const key = el('input');
  key.placeholder = 'sk-…';
  key.style.flex = '1';
  const go = el('button', '', 'spara');
  go.onclick = async () => {
    setStatus('sparar provider…');
    try {
      const r2 = await api('/provider', { method: 'POST', body: { preset: preset.value, apiKey: key.value.trim() || undefined } });
      const routes = {};
      const st2 = await api('/state&tools=0');
      for (const row2 of st2.routes || []) routes[row2.job] = `${r2.provider}/${(r2.status?.models || [''])[0]}`;
      await api('/config', { method: 'PATCH', body: { models: { provider: r2.provider, routes } } });
      toast('provider ' + r2.provider + ' sparad, alla rutter pekar dit');
      refresh();
    } catch (e) {
      err(e.message);
    }
    setStatus('redo');
  };
  add.append(preset, key, go);
  pr.append(add);
  pr.append(el('div', 'kv', 'Egen base-URL: skriv i config eller be LENT: <i>"lägg till provider min med baseUrl http://192.168.0.9:8000/v1 och nyckeln abc"</i>'));

  /* ---- kanaler ---- */
  const c = $('chan');
  c.innerHTML = '';
  const tg = st.channels.telegram || {};
  const trow = el('div', 'row');
  trow.append(el('span', '', 'telegram'));
  const tkey = el('input');
  tkey.placeholder = '123456:ABC-DEF…';
  tkey.style.flex = '1';
  tkey.value = '';
  const tsave = el('button', '', 'spara+start');
  tsave.onclick = async () => {
    const r2 = await api('/channels/telegram', { method: 'POST', body: { botToken: tkey.value.trim(), action: 'start' } }).catch((e) => ({ ok: false, error: e.message }));
    toast(r2.ok ? 'telegram igång · kod ' + (r2.pairingCode || '-') : 'telegram: ' + (r2.error || r2.status?.lastError || 'fel'));
    refresh();
  };
  const tstop = el('button', 'danger', 'stopp');
  tstop.onclick = async () => {
    await api('/channels/telegram', { method: 'POST', body: { action: 'stop' } }).catch(() => {});
    refresh();
  };
  trow.append(tkey, tsave, tstop);
  c.append(trow);
  c.append(el('div', 'kv', tg.state === 'polling' ? `pollar som <b>${esc(tg.bot || '')}</b> · ${tg.chats || 0} chattar · ta emot ${tg.received || 0}/skicka ${tg.sent || 0}<br>parningskod <b>${esc(tg.pairingCode || '-')}</b> — användaren skickar <i>/pair kod</i> till botten` : 'status: ' + (tg.state || 'av') + (tg.lastError ? ' · ' + esc(tg.lastError) : '')));
  if (st.channels.whatsapp) {
    const wa = st.channels.whatsapp || {};
    const wrow = el('div', 'row');
    wrow.append(el('span', '', 'whatsapp'));
    const tr = el('select');
    tr.innerHTML = ['baileys', 'cloud'].map((x) => `<option ${wa.transport === x ? 'selected' : ''}>${x}</option>`).join('');
    const start = el('button', '', wa.online ? 'start om' : 'starta');
    start.onclick = async () => {
      const r2 = await api('/channels/whatsapp', { method: 'POST', body: { transport: tr.value, action: 'start' } }).catch((e) => ({ ok: false, error: e.message }));
      toast(r2.ok ? 'whatsapp: ' + (r2.status?.state || 'igång') : 'whatsapp: ' + (r2.error || 'fel') + (r2.status?.hint ? ' · ' + r2.status.hint : ''));
      refresh();
    };
    const stop = el('button', 'danger', 'stopp');
    stop.onclick = async () => {
      await api('/channels/whatsapp', { method: 'POST', body: { action: 'stop' } }).catch(() => {});
      refresh();
    };
    wrow.append(tr, start, stop);
    c.append(wrow);
    c.append(el('div', 'kv', 'transport <b>' + esc(wa.transport || '?') + '</b> · ' + esc(wa.state || 'av') + (wa.linked ? ' · ' + esc(wa.linked) : '') + (wa.lastError ? '<br>' + esc(wa.lastError) : '')));
    if (wa.qr) {
      const img = el('img');
      img.src = wa.qr;
      img.style.cssText = 'width:168px;height:168px;background:#fff;padding:6px;border-radius:8px;margin-top:6px';
      c.append(img);
      c.append(el('div', 'kv', 'WhatsApp → Inställningar → Kopplar en enhet'));
    }
  }

  /* ---- kostnad ---- */
  const u = st.usage || {};
  const days = u.days || {};
  const keys = Object.keys(days).sort();
  const max = Math.max(0.0001, ...keys.map((k) => days[k]));
  const spark = el('div', 'spark');
  for (let d = 1; d <= 28; d += 1) {
    const k = String(d).padStart(2, '0');
    const i = el('i');
    i.style.height = days[k] ? Math.max(3, (days[k] / max) * 26) + 'px' : '2px';
    i.title = k + ': ' + (days[k] || 0) + ' USD';
    spark.append(i);
  }
  $('usage').innerHTML = '';
  $('usage').append(el('div', '', '<b>' + (u.costUsd || 0).toFixed(4) + '</b> USD · ' + (u.tokens || 0) + ' tok · ' + (u.requests || 0) + ' anrop' + (u.budgetUsed != null ? ' · budget ' + Math.round(u.budgetUsed * 100) + '%' : '')), spark);
  const by = Object.entries(u.byModel || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (by.length) $('usage').append(el('div', 'kv', by.map(([k, v]) => `${esc(k.split('/').pop())} $${Number(v).toFixed(3)}`).join(' · ')));
  const bj = Object.entries(u.byJob || {}).filter(([, v]) => v > 0);
  if (bj.length) $('usage').append(el('div', 'kv', bj.map(([k, v]) => `${esc(k)} $${Number(v).toFixed(3)}`).join(' · ')));
}

async function setConfig(patch, msg) {
  setStatus('sparar…');
  try {
    const r = await api('/config', { method: 'PATCH', body: patch });
    if (!r.ok) err('config: ' + (r.errors || []).map((e) => e.path + ': ' + e.msg).join(', '));
    else if (msg) note(msg);
    refresh();
  } catch (e) {
    err(e.message);
  }
  setStatus('redo');
}

window.paintPanel = paintPanel;
window.paintHeader = paintHeader;
window.paintRail = paintRail;
window.renderPlan = renderPlan;
window.setConfig = setConfig;
