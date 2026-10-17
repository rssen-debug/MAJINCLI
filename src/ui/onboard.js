/* MAJIN Phase B client: first-run onboarding + the universal model picker.
 *
 * Reuse, never rebuild (VNEXT §6):
 *  - onboarding state comes from /api/state (needsSetup, presets, providers)
 *  - key saving + live model catalog + connectivity test come from the
 *    existing provider tool via POST /api/provider (add / models / test)
 *  - model choice is written with PATCH /api/config — the same path the
 *    /model command already uses. One system, one config, one truth.
 * Text is English (i18n gate). Model/provider strings are textContent only.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ROUTE_JOBS = ['chat', 'tasks', 'tools', 'code', 're', 'analysis', 'plan', 'research', 'summarize', 'router', 'final', 'aggregator', 'vision'];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function apiLocal(p, o) {
    // same convention as app.js api(): token in query, JSON everywhere
    const T = window.__MAJIN_TOKEN__ || 'demo';
    const url = '/api' + p + (p.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(T);
    const opt = o || {};
    opt.headers = { 'content-type': 'application/json', ...(opt.headers || {}) };
    if (opt.body && typeof opt.body !== 'string') opt.body = JSON.stringify(opt.body);
    return fetch(url, opt).then((r) => r.json());
  }

  const OB = { st: null, provider: null, model: null, shown: false };

  /* ---------------------------- onboarding ---------------------------- */

  function open(st) {
    OB.st = st;
    OB.shown = true;
    render();
    $('onboard').hidden = false;
  }
  function close() {
    $('onboard').hidden = true;
    OB.shown = false;
    if (typeof window.refresh === 'function') window.refresh();
  }

  function render() {
    const box = $('ob-body');
    box.textContent = '';
    if (!OB.provider) return renderProviders(box);
    if (!OB.model) return renderKeyOrModel(box);
  }

  function renderProviders(box) {
    box.append(el('h2', 'ob-title', 'Welcome to MAJIN'));
    box.append(el('p', 'ob-sub', 'Three steps and you are running: pick a provider, paste its key, choose a model.'));
    const grid = el('div', 'ob-grid');
    (OB.st.presets || []).forEach((p) => {
      const card = el('button', 'ob-card');
      card.type = 'button';
      card.append(el('b', '', p.label));
      card.append(el('span', 'ob-card-desc', p.needsKey ? 'needs an API key' : 'no key needed'));
      card.onclick = () => { OB.provider = p; render(); };
      grid.append(card);
    });
    box.append(grid);
  }

  function renderKeyOrModel(box) {
    const p = OB.provider;
    box.append(el('h2', 'ob-title', p.label));
    const back = el('button', 'ob-link', '← other provider');
    back.type = 'button';
    back.onclick = () => { OB.provider = null; render(); };
    box.append(back);

    if (p.needsKey) {
      const label = el('label', 'ob-label', 'Paste your API key');
      const input = el('input', 'ob-input');
      input.type = 'password';
      input.placeholder = 'sk-…';
      input.autocomplete = 'off';
      label.append(input);
      box.append(label);
      if (p.keyUrl) {
        const a = el('a', 'ob-link', 'Get a key →');
        a.href = p.keyUrl;
        a.target = '_blank';
        a.rel = 'noreferrer';
        box.append(a);
      }
      const msg = el('div', 'ob-msg');
      const btn = el('button', 'ob-go', 'Save key & test connection');
      btn.type = 'button';
      btn.onclick = async () => {
        btn.disabled = true;
        msg.textContent = 'saving…';
        const add = await apiLocal('/provider', { method: 'POST', body: { action: 'add', name: p.name, apiKey: input.value.trim() } }).catch(() => null);
        const err = add && add.output && add.output.error ? add.output.error : (add && add.error) || (!add || !add.ok ? { message: 'save failed' } : null);
        if (err) {
          msg.textContent = (err.message || 'could not save') + (err.hint ? ' — ' + err.hint : '');
          btn.disabled = false;
          return;
        }
        msg.textContent = 'testing the connection…';
        const test = await apiLocal('/provider', { method: 'POST', body: { action: 'test', name: p.name } }).catch(() => null);
        if (test && test.output && test.output.ok === false) {
          msg.textContent = (test.output.error && test.output.error.message) || 'the provider did not answer — check the key';
          btn.disabled = false;
          return;
        }
        OB.keyOk = true;
        renderModels(box);
      };
      box.append(btn, msg);
    } else {
      const note = el('div', 'ob-msg', 'No key needed for this one — saving it and loading models…');
      box.append(note);
      apiLocal('/provider', { method: 'POST', body: { action: 'add', name: p.name } }).then(() => renderModels(box)).catch(() => { note.textContent = 'could not save — try again'; });
    }
  }

  async function renderModels(box) {
    box.textContent = '';
    box.append(el('h2', 'ob-title', 'Choose a model'));
    const msg = el('div', 'ob-msg', 'loading the live list…');
    const search = el('input', 'ob-input');
    search.placeholder = 'type to filter…';
    const list = el('div', 'ob-models');
    box.append(search, msg, list);

    await apiLocal('/provider', { method: 'POST', body: { action: 'models', name: OB.provider.name } }).catch(() => null);
    const cfg = await apiLocal('/config').catch(() => null);
    const ids = (cfg && cfg.config && cfg.config.providers && cfg.config.providers[OB.provider.name] && cfg.config.providers[OB.provider.name].models) || OB.provider.models || [];
    msg.textContent = ids.length ? ids.length + ' models available — click one to choose' : 'no catalogue available — type the model id above and press Start';

    const paint = () => {
      list.textContent = '';
      const q = search.value.trim().toLowerCase();
      ids.filter((id) => !q || id.toLowerCase().includes(q)).slice(0, 60).forEach((id) => {
        const row = el('button', 'ob-model', id);
        row.type = 'button';
        row.onclick = () => {
          list.querySelectorAll('.ob-model').forEach((n) => n.classList.remove('on'));
          row.classList.add('on');
          OB.model = id;
          go.disabled = false;
        };
        list.append(row);
      });
    };
    search.oninput = paint;
    paint();

    const typed = () => search.value.trim();
    const go = el('button', 'ob-go', 'Start MAJIN');
    go.type = 'button';
    go.disabled = true;
    search.addEventListener('input', () => { go.disabled = !(OB.model || typed()); });
    go.onclick = async () => {
      const model = OB.model || typed();
      if (!model) return;
      go.disabled = true;
      msg.textContent = 'setting everything up…';
      const routes = Object.fromEntries(ROUTE_JOBS.map((j) => [j, OB.provider.name + '/' + model]));
      /* single model for EVERY job + MOA off: no hidden second model, ever */
      const r = await apiLocal('/config', { method: 'PATCH', body: { models: { provider: OB.provider.name, routes }, moa: { policy: 'off' } } }).catch(() => null);
      if (!r || !r.ok) {
        msg.textContent = 'could not apply the setup — ' + JSON.stringify((r && r.errors) || 'unknown');
        go.disabled = false;
        return;
      }
      if (window.MAJIN_IMAGINE) window.MAJIN_IMAGINE.reset();
      close();
    };
    box.append(go);
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
    const st = OB.st || (window.S && window.S.st);
    const provName = (st && st.routes && st.routes.find((r) => r.job === 'chat') || {}).provider || (st && st.config && st.config.models && st.config.models.provider) || '';
    const search = el('input', 'ob-input');
    search.placeholder = 'filter models…';
    const list = el('div', 'ob-models md-list');
    pane.append(search, el('div', 'ob-msg', provName ? 'loading ' + provName + ' models…' : 'no provider set'), list);
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
      (ids || []).filter((id) => !q || id.toLowerCase().includes(q)).slice(0, 40).forEach((id) => {
        const row = el('button', 'ob-model' + (provName + '/' + id === PICKER.current ? ' on' : ''), id);
        row.type = 'button';
        row.onclick = () => accept(id);
        list.append(row);
      });
    };
    paintSearch();
  }

  window.MAJIN_ONBOARD = {
    maybe(st) {
      if (OB.shown) return;
      if (st && st.needsSetup) open(st);
      else paintChip();
    },
    togglePicker,
    paintChip,
    api: apiLocal,
  };
})();
