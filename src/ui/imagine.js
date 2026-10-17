/* MAJIN Imagination Engine — slice 1: Live Agent Vision + the Living Core.
 *
 * Rules this file lives by (from the IMAGINATION spec):
 *  - Every row comes from a REAL backend event with a real timestamp.
 *    Nothing here simulates activity; an idle agent shows an idle core.
 *  - Zero extra model calls: this is pure local rendering of the event
 *    stream the app already receives. No fetch, no LLM, no tokens.
 *  - Never inject model output into the DOM as HTML: textContent only.
 *  - It must stay understandable to a non-technical user: icons + plain
 *    labels, details hidden behind a click (native <details>: keyboard
 *    accessible for free).
 */
(function () {
  'use strict';

  const ICONS = [
    [/search|web|crawl|scrape/i, '🔍'],
    [/browser|page|tab|click|navigate/i, '🌐'],
    [/computer|screen|mouse|keyboard|window|desktop/i, '🖥️'],
    [/image|draw|paint|photo|art/i, '🎨'],
    [/file|fs_|read|write|folder/i, '📄'],
    [/shell|terminal|cmd|powershell|exec/i, '💻'],
    [/schedule|cron|remind/i, '🗓️'],
    [/memory|remember|note/i, '🧠'],
    [/telegram|whatsapp|message|send/i, '✉️'],
    [/calc|math/i, '🔢'],
  ];
  const iconFor = (name) => {
    for (const [re, icon] of ICONS) if (re.test(name || '')) return icon;
    return '🔧';
  };

  // core states: idle | thinking | working | waiting | done | error
  let core = 'idle';
  let root = null, orb = null, coreLabel = null, list = null, empty = null;
  let currentToolRow = null;

  const CORE_TEXT = {
    idle: 'ready',
    thinking: 'thinking…',
    working: 'working',
    waiting: 'waiting for you',
    done: 'done ✓',
    error: 'something went wrong',
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text; // textContent — never innerHTML
    return n;
  }

  function mount() {
    root = document.getElementById('imagine');
    if (!root) return; // window misses the mount point: stay inert
    orb = el('div', 'core idle');
    orb.setAttribute('aria-hidden', 'true');
    coreLabel = el('span', 'core-label', '');
    const head = el('div', 'core-row');
    head.append(orb, coreLabel);
    list = el('div', 'steps');
    empty = el('div', 'imagine-empty', 'MAJIN\'s live work appears here — step by step, in real time.');
    root.append(head, empty, list);
    paint();
  }

  function paint() {
    if (!root) return;
    orb.className = 'core ' + core;
    coreLabel.textContent = CORE_TEXT[core] || '';
  }

  function setCore(state) {
    if (core === 'done' && state === 'idle') return; // let "done ✓" breathe until the next run
    core = state;
    paint();
  }

  function stamp() {
    return new Date().toLocaleTimeString('sv-SE', { hour12: false });
  }

  function stepRow(icon, title, sub) {
    const row = el('div', 'step');
    row.append(el('span', 'step-icon', icon));
    const body = el('div', 'step-body');
    body.append(el('div', 'step-title', title));
    if (sub) body.append(el('div', 'step-sub', sub));
    row.append(body, el('span', 'step-time', stamp()));
    return row;
  }

  function show() {
    if (!root) return;
    root.hidden = false;
    if (empty && empty.parentNode) empty.remove();
    empty = null;
  }

  function addStep(row) {
    if (!root) return;
    show();
    list.append(row);
    row.scrollIntoView({ block: 'nearest' });
  }

  function detailEl(obj) {
    const d = el('details', 'step-detail');
    d.append(el('summary', '', 'details'));
    const pre = el('pre');
    pre.textContent = JSON.stringify(obj, null, 2); // safe: textContent
    d.append(pre);
    return d;
  }

  /* Feed one real run event. Called from app.js's onEvent — the single
   * funnel the SSE stream already passes through. */
  function onEvent(ev) {
    if (!root || !ev || !ev.type) return;
    switch (ev.type) {
      case 'route':
        addStep(stepRow('🧭', 'routing chose: ' + (ev.job || 'chat'), (ev.model || '').split('/').pop()));
        setCore('thinking');
        break;
      case 'step':
        setCore('thinking');
        break;
      case 'tool': {
        setCore('working');
        const row = stepRow(iconFor(ev.name), ev.name || 'tool', 'running…');
        row.classList.add('running');
        addStep(row);
        currentToolRow = row;
        break;
      }
      case 'tool_result': {
        const row = currentToolRow;
        if (row) {
          row.classList.remove('running');
          row.classList.add(ev.ok ? 'ok' : 'fail');
          const sub = row.querySelector('.step-sub');
          if (sub) sub.textContent = ev.ok ? (ev.summary || 'done') : 'error: ' + (ev.error || 'unknown');
          row.append(detailEl({ tool: ev.tool, ok: ev.ok, summary: ev.summary, error: ev.error, meta: ev.meta }));
        }
        currentToolRow = null;
        setCore('thinking');
        break;
      }
      case 'escalate':
        addStep(stepRow('⬆️', 'escalating to ' + (ev.to || 'a stronger model'), ev.why || ''));
        break;
      case 'compact':
        addStep(stepRow('🗜️', 'compacting memory', (ev.tokens || 0) + ' token'));
        break;
      case 'approval:request':
        setCore('waiting');
        addStep(stepRow('⏳', 'waiting for your approval', ev.tool || ''));
        break;
      case 'approval:resolved':
        setCore('working');
        break;
      case 'tool.denied':
        addStep(stepRow('🚫', 'tool denied by you', ev.tool || ''));
        setCore('thinking');
        break;
      case 'usage': {
        const u = ev.tokensIn + ev.tokensOut;
        addStep(stepRow('📊', 'steg ' + (ev.step || '?'), u + ' token' + (ev.costUsd ? ' · $' + ev.costUsd.toFixed(4) : '')));
        break;
      }
      case 'answer': {
        const meta = ev.meta || {};
        const bits = [
          meta.steps && meta.steps + ' steps',
          meta.usage && (meta.usage.input + meta.usage.output) + ' token',
          meta.usage && meta.usage.costUsd ? '$' + meta.usage.costUsd.toFixed(4) : null,
        ].filter(Boolean);
        addStep(stepRow('✅', 'done', bits.join(' · ')));
        setCore('done');
        break;
      }
      case 'schedule.done':
        addStep(stepRow('🗓️', 'scheduled job finished', ev.name || ''));
        break;
      case 'schedule.failed':
        addStep(stepRow('⚠️', 'scheduled job failed', ev.name || ''));
        setCore('error');
        break;
      case 'error':
        addStep(stepRow('⚠️', 'error', String(ev.message || ev.text || 'unknown error')));
        setCore('error');
        break;
      default:
        break; // unknown events are ignored rather than faked
    }
  }

  /* A fresh run starts a fresh canvas: an old task must never paint over it. */
  function reset() {
    if (!root) return;
    list.textContent = '';
    currentToolRow = null;
    core = 'idle';
    root.hidden = true;
    if (!empty) {
      empty = el('div', 'imagine-empty', 'MAJIN\'s live work appears here — step by step, in real time.');
      root.insertBefore(empty, list);
    }
    paint();
  }

  window.MAJIN_IMAGINE = { onEvent, reset, get state() { return core; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
