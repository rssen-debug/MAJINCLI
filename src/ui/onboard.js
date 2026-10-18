/* MAJIN — one-chat onboarding: detect what works, ask only for what is missing.
 * The existing /api/state, /api/provider and /api/config remain the source of truth.
 * Never expose or echo keys. Providers beyond the first are an advanced choice.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ROUTE_JOBS = ['chat', 'tasks', 'tools', 'code', 're', 'analysis', 'plan', 'research', 'summarize', 'router', 'final', 'aggregator', 'vision'];
  const OB = { st: null, provider: null, shown: false, working: false, forceEdit: false };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function apiLocal(p, o) {
    const token = window.__MAJIN_TOKEN__ || 'demo';
    const opt = { ...(o || {}) };
    opt.headers = { 'content-type': 'application/json', ...(opt.headers || {}) };
    if (opt.body && typeof opt.body !== 'string') opt.body = JSON.stringify(opt.body);
    return fetch('/api' + p + (p.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(token), opt).then((r) => r.json());
  }
  function tellErr(resp, fallback) {
    if (!resp) return 'MAJIN did not respond. Is it still running?';
    if (resp.ok) return null;
    const bits = [];
    if (resp.error) bits.push(typeof resp.error === 'string' ? resp.error : (resp.error.message || 'Connection failed'));
    if (resp.hint) bits.push(resp.hint);
    if (Array.isArray(resp.errors)) bits.push(resp.errors.map((e) => (e.path ? e.path + ': ' : '') + e.msg).join('; '));
    return bits.join(' — ') || fallback || 'Something went wrong. Try again.';
  }
  function status(name) {
    return (OB.st && OB.st.providers || []).find((p) => p.name === name);
  }
  function connected() {
    const all = (OB.st && OB.st.providers || []).filter((p) => p.ready && p.kind !== 'mock');
    const active = (OB.st && OB.st.routes || []).find((r) => r.job === 'chat');
    return all.find((p) => p.name === active?.provider) || all[0] || null;
  }
  function open(st) {
    OB.st = st;
    OB.provider = null;
    OB.forceEdit = false;
    OB.shown = true;
    $('onboard').hidden = false;
    render();
  }
  function close() {
    $('onboard').hidden = true;
    OB.shown = false;
    OB.working = false;
    if (typeof window.refresh === 'function') window.refresh(true);
  }
  function skipForNow() {
    try { sessionStorage.setItem('majin.onboard.skip', '1'); } catch { /* private browsing */ }
    close();
  }
  function render() {
    const box = $('ob-body');
    box.textContent = '';
    if (OB.provider) renderConnect(box);
    else renderWelcome(box);
  }
  function renderWelcome(box) {
    box.append(el('div', 'ob-mark', '✦'));
    box.append(el('h2', 'ob-title', 'Meet MAJIN'));
    box.append(el('p', 'ob-sub', 'Your AI, ready to help. Just connect one model to get started.'));

    const existing = connected();
    if (existing) {
      const ready = el('div', 'ob-ready');
      ready.append(el('span', 'ob-ready-dot', '●'));
      ready.append(el('span', '', existing.label + ' is already connected'));
      box.append(ready);
      const go = el('button', 'ob-go', 'Start chatting →');
      go.type = 'button';
      go.onclick = () => {
        // Respect existing model routes and credentials. No paid probe on startup.
        close();
        const input = $('input');
        if (input) input.focus();
      };
      box.append(go);
    }

    const label = el('label', 'ob-label', existing ? 'Want to use a different AI?' : 'Choose your AI');
    label.htmlFor = 'ob-choice';
    const select = el('select', 'ob-input');
    select.id = 'ob-choice';
    const presets = (OB.st && OB.st.presets || []).filter((p) => p.name !== 'mock');
    const order = ['deepseek', 'openrouter', 'openai', 'gemini', 'anthropic', 'groq', 'kilocode', 'nous', 'ollama', 'lmstudio'];
    const sorted = [...presets].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    for (const p of sorted) {
      const option = el('option', '', p.label + (status(p.name)?.ready ? ' · connected' : ''));
      option.value = p.name;
      select.append(option);
    }
    select.value = existing ? existing.name : 'deepseek';
    if (!select.value && sorted.length) select.value = sorted[0].name;
    label.append(select);
    box.append(label);

    const next = el('button', 'ob-go ob-choose', existing ? 'Change AI →' : 'Continue →');
    next.type = 'button';
    next.onclick = () => {
      OB.provider = presets.find((p) => p.name === select.value) || null;
      render();
    };
    box.append(next);

    const details = el('details', 'ob-details');
    const summary = el('summary', '', 'More options');
    details.append(summary);
    const others = el('div', 'ob-options');
    const custom = el('button', 'ob-link', 'Use a custom API endpoint');
    custom.type = 'button';
    custom.onclick = () => { OB.provider = { name: 'custom', label: 'Custom endpoint', custom: true, needsKey: false }; render(); };
    const demo = el('button', 'ob-link', 'Try demo mode (no real AI)');
    demo.type = 'button';
    demo.onclick = skipForNow;
    others.append(custom, demo);
    if (existing) {
      const p = existing;
      const changeKey = el('button', 'ob-link', 'Replace the saved key for ' + p.label);
      changeKey.type = 'button';
      changeKey.onclick = () => {
        OB.forceEdit = true;
        OB.provider = (OB.st.presets || []).find((choice) => choice.name === p.name) || null;
        render();
      };
      const forget = el('button', 'ob-link', 'Forget ' + p.label + ' connection');
      forget.type = 'button';
      forget.onclick = async () => {
        if (!confirm('Remove this AI connection from MAJIN?')) return;
        forget.disabled = true;
        const result = await apiLocal('/provider', { method: 'POST', body: { action: 'remove', name: p.name } }).catch(() => null);
        if (!result || !result.ok) {
          forget.textContent = tellErr(result, 'Could not remove this connection.');
          forget.disabled = false;
          return;
        }
        const fresh = await apiLocal('/state?tools=0').catch(() => null);
        if (fresh) OB.st = fresh;
        OB.forceEdit = false;
        OB.provider = null;
        render();
      };
      others.append(changeKey, forget);
    }
    details.append(others);
    box.append(details);
    const skip = el('button', 'ob-link ob-skip', 'Skip for now');
    skip.id = 'ob-skip';
    skip.type = 'button';
    skip.onclick = skipForNow;
    box.append(skip);
  }

  function renderConnect(box) {
    const p = OB.provider;
    const back = el('button', 'ob-link', '← Back');
    back.type = 'button';
    back.onclick = () => { OB.provider = null; render(); };
    box.append(back, el('div', 'ob-mark', '✦'), el('h2', 'ob-title', 'Connect ' + p.label));
    const existing = OB.forceEdit ? null : status(p.name);
    box.append(el('p', 'ob-sub', existing && existing.ready
      ? 'Your AI is already connected. No need to enter your key again.'
      : (p.needsKey ? 'Paste your key once. MAJIN keeps it on this computer.' : 'No API key needed. Make sure the local AI server is running.')));

    const urlIn = p.custom ? el('input', 'ob-input') : null;
    if (urlIn) {
      const label = el('label', 'ob-label', 'Endpoint URL');
      urlIn.placeholder = 'http://127.0.0.1:1234/v1';
      urlIn.autocomplete = 'off';
      label.append(urlIn);
      box.append(label);
    }
    const keyIn = (p.needsKey && !existing?.ready) || p.custom ? el('input', 'ob-input') : null;
    if (keyIn) {
      const label = el('label', 'ob-label', 'API key' + (p.custom ? ' (optional for local models)' : ''));
      keyIn.type = 'password';
      keyIn.autocomplete = 'off';
      keyIn.placeholder = 'Paste your API key';
      label.append(keyIn);
      box.append(label);
    }
    if (p.keyUrl && !existing?.ready) {
      const link = el('a', 'ob-link', 'Where do I get a key? ↗');
      link.href = p.keyUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      box.append(link);
    }

    const msg = el('p', 'ob-msg');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    const go = el('button', 'ob-go', existing?.ready ? 'Start chatting →' : 'Connect and start →');
    go.type = 'button';
    go.onclick = async () => {
      if (OB.working) return;
      OB.working = true;
      go.disabled = true;
      try {
        if (existing?.ready && !p.custom) {
          // Changing provider is explicit, and needs no additional model tokens.
          await finishSetup(p.name, msg);
        } else {
          if (p.custom && !urlIn.value.trim()) {
            msg.textContent = 'Enter the URL of your AI server.';
            return;
          }
          if (p.needsKey && !p.custom && !keyIn?.value.trim()) {
            msg.textContent = 'Paste your API key to connect.';
            return;
          }
          msg.textContent = 'Connecting…';
          const body = p.custom
            ? { action: 'add', name: 'custom', kind: 'openai', baseUrl: urlIn.value.trim(), apiKey: keyIn?.value.trim() || '' }
            : { action: 'add', preset: p.name, name: p.name, ...(keyIn ? { apiKey: keyIn.value.trim() } : {}) };
          const added = await apiLocal('/provider', { method: 'POST', body }).catch(() => null);
          const error = tellErr(added, 'Could not connect.');
          if (error) { msg.textContent = error; return; }
          msg.textContent = 'Checking connection…';
          const test = await apiLocal('/provider', { method: 'POST', body: { action: 'test', name: p.name } }).catch(() => null);
          const testError = tellErr(test, 'Could not reach the provider.');
          if (testError) { msg.textContent = testError; return; }
          await finishSetup(p.name, msg);
        }
      } finally {
        OB.working = false;
        go.disabled = false;
      }
    };
    box.append(go, msg);
  }

  async function finishSetup(name, msg) {
    msg.textContent = 'Finding a model…';
    const p = OB.provider;
    // A missing model catalogue is not fatal; validated preset models still work.
    await apiLocal('/provider', { method: 'POST', body: { action: 'models', name } }).catch(() => null);
    const info = await apiLocal('/config').catch(() => null);
    const cfg = info?.config || {};
    const ids = cfg.providers?.[name]?.models || p?.models || [];
    const current = cfg.models?.routes?.chat || '';
    const previous = current.startsWith(name + '/') ? current.slice(name.length + 1) : '';
    const model = previous || ids[0];
    if (!model) { msg.textContent = 'No model found. Open the model picker after connecting a model to your provider.'; return; }
    const routes = Object.fromEntries(ROUTE_JOBS.map((j) => [j, name + '/' + model]));
    const saved = await apiLocal('/config', { method: 'PATCH', body: { models: { provider: name, routes }, moa: { policy: 'off' } } }).catch(() => null);
    const error = tellErr(saved, 'Could not select the model.');
    if (error) { msg.textContent = error; return; }
    if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.reset();
    close();
    const input = $('input');
    if (input) input.focus();
  }

  /* ------------------------- model picker chip ------------------------- */

  const PICKER = { openFlag: false, cache: {}, current: '' };

  function shortModel(ref) {
    return String(ref || '').split('/').pop() || '—';
  }

  async function paintChip() {
    const chip = $('c-model');
    if (!chip) return;
    const st = OB.st || (window.S && window.S.st);
    if (!st || !st.routes) return;
    const chat = (st.routes || []).find((r) => r.job === 'chat');
    PICKER.current = chat ? chat.ref : '';
    chip.textContent = 'model ' + shortModel(PICKER.current) + ' ▾';
    chip.title = PICKER.current || 'no model set';
    chip.hidden = !PICKER.current;
  }

  async function togglePicker() {
    const pane = $('modeldrop');
    if (!pane) return;
    PICKER.openFlag = !PICKER.openFlag;
    pane.hidden = !PICKER.openFlag;
    if (!PICKER.openFlag) return;
    fillPicker(pane);
  }

  async function fillPicker(pane) {
    pane.textContent = '';
    const manage = el('button', 'ob-link', '⚙ providers: add, change key or remove →');
    manage.type = 'button';
    manage.onclick = () => { pane.hidden = true; PICKER.openFlag = false; window.MAJIN_ONBOARD.reopen(); };
    const st = OB.st || (window.S && window.S.st);
    const provName = (st && st.routes && st.routes.find((r) => r.job === 'chat') || {}).provider || (st && st.config && st.config.models && st.config.models.provider) || '';
    const search = el('input', 'ob-input');
    search.placeholder = 'filter models…';
    const list = el('div', 'ob-models md-list');
    pane.append(manage, search, el('div', 'ob-msg', provName ? 'loading ' + provName + ' models…' : 'no provider set'), list);
    search.focus();

    let ids = PICKER.cache[provName];
    if (!ids && provName) {
      await apiLocal('/provider', { method: 'POST', body: { action: 'models', name: provName } }).catch(() => null);
      const cfg = await apiLocal('/config').catch(() => null);
      ids = (cfg && cfg.config && cfg.config.providers && cfg.config.providers[provName] && cfg.config.providers[provName].models) || [];
      PICKER.cache[provName] = ids;
    }
    const msg = pane.querySelector('.ob-msg');
    if (msg) msg.textContent = ids && ids.length ? ids.length + ' models' : 'no catalogue — type the id and press Enter';

    const accept = async (id) => {
      if (!id) return;
      const routes = Object.fromEntries(ROUTE_JOBS.map((j) => [j, provName + '/' + id]));
      const r = await apiLocal('/config', { method: 'PATCH', body: { models: { provider: provName, routes } } }).catch(() => null);
      if (r && r.ok) {
        PICKER.openFlag = false;
        pane.hidden = true;
        if (typeof window.refresh === 'function') window.refresh();
      }
    };
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') accept(search.value.trim()); });
    search.oninput = () => paintSearch();
    const paintSearch = () => {
      list.textContent = '';
      const q = search.value.trim().toLowerCase();
      const pricing = (window.S && window.S.st && window.S.st.config && window.S.st.config.pricing) || {};
      (ids || []).filter((id) => !q || id.toLowerCase().includes(q)).slice(0, 40).forEach((id) => {
        const row = el('button', 'ob-model' + (provName + '/' + id === PICKER.current ? ' on' : ''), id);
        row.type = 'button';
        const pr = pricing[provName + '/' + id];
        if (pr && (pr.input || pr.output)) {
          const tag = el('span', 'ob-price', ` $${pr.input || '?'}/$${pr.output || '?'} per Mtok`);
          row.append(tag);
        }
        row.onclick = () => accept(id);
        list.append(row);
      });
    };
    paintSearch();
  }

  window.MAJIN_ONBOARD = {
    reopen() {
      const st = (window.S && window.S.st) || OB.st;
      if (st) open(st);
    },
    maybe(st) {
      OB.st = st;
      if (OB.shown) return;
      /* a dismissed wizard must not trap the user: Skip for now suppresses
         the auto-open for THIS session only — it always comes back on a
         fresh start (or via the providers link) */
      if (st && st.needsSetup && !sessionStorage.getItem('majin.onboard.skip')) open(st);
      else paintChip();
    },
    togglePicker,
    paintChip,
    api: apiLocal,
  };
})();
