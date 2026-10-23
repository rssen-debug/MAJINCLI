/**
 * MAJIN V4 — client.
 *
 * The browser is a thin, honest client: it renders what the server proves and
 * never claims a task succeeded on its own. Voice uses the browser engines
 * (SpeechRecognition + SpeechSynthesis) so it works without extra services,
 * and every unsupported capability is reported instead of faked.
 */
import { createSpirit } from '/spirit.js';
import { detectVoiceSupport, recognitionLang, shouldAutoSend, speechText, voiceErrorMessage } from '/voice.js';
import { t } from '/strings.js';
import { INITIAL, applyEvent, createSseParser } from '/session.js';

const $ = (sel) => document.querySelector(sel);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowPower = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 4) <= 2;

const els = {
  stage: $('#stage'),
  hero: $('#hero'),
  thread: $('#thread'),
  input: $('#input'),
  composer: $('#composer'),
  send: $('#send-btn'),
  stop: $('#stop-btn'),
  mic: $('#mic-btn'),
  attach: $('#attach-btn'),
  fileInput: $('#file-input'),
  lightbox: $('#lightbox'),
  lightboxImg: $('#lightbox-img'),
  lightboxX: $('#lightbox-x'),
  hint: $('#composer-hint'),
  gate: $('#gate'),
  gateForm: $('#gate-form'),
  gateCode: $('#gate-code'),
  gateError: $('#gate-error'),
  gateSubmit: $('#gate-submit'),
  modelPill: $('#model-pill'),
  modelLabel: $('#model-label'),
  connDot: $('#conn-dot'),
  menu: $('#menu-btn'),
  sheet: $('#sheet'),
  sheetBackdrop: $('#sheet-backdrop'),
  sheetModel: $('#sheet-model'),
  sheetModelNote: $('#sheet-model-note'),
  modelList: $('#model-list'),
  modelSource: $('#model-source'),
  refreshModels: $('#refresh-models'),
  sheetFiles: $('#file-list'),
  sheetConvs: $('#conv-list'),
  sheetGoals: $('#goal-list'),
  ownerState: $('#owner-state'),
  ownerNote: $('#owner-note'),
  laneList: $('#lane-list'),
  folderInput: $('#folder-input'),
  folderAdd: $('#folder-add'),
  folderList: $('#folder-list'),
  ownerRevoke: $('#owner-revoke'),
  skillList: $('#skill-list'),
  ttsToggle: $('#tts-toggle'),
  autosendToggle: $('#autosend-toggle'),
  voiceNote: $('#voice-note'),
  versionNote: $('#version-note'),
  offline: $('#offline-bar'),
  toast: $('#toast'),
  approval: $('#approval'),
  approvalText: $('#approval-text'),
  approvalAllow: $('#approval-allow'),
  approvalDeny: $('#approval-deny'),
  approvalDismiss: $('#approval-dismiss'),
  heroTitle: $('#hero-title'),
  heroSub: $('#hero-sub'),
  suggestions: $('#suggestions'),
  newChat: $('#new-chat'),
  logout: $('#logout'),
};

const state = {
  conversationId: null,
  modelId: null,
  streaming: false,
  controller: null,
  model: null,
  tts: false,
  autosend: true,
  listening: false,
  recognition: null,
  pendingApproval: null,
  started: false,
  bubble: null,
  bubbleText: '',
  version: null,
  capabilities: null,
  requestSeq: 0,
  previewOn: true,
  session: { ...INITIAL },
};

const spirit = createSpirit($('#spirit'), { reducedMotion, lowPower });
spirit.set('idle');

/* --------------------------------------------------------------- helpers -- */

function toast(message, ms = 2600) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, ms);
}

function setDot(mode) {
  els.connDot.dataset.state = mode;
}

function api(path, { method = 'GET', body = null, signal = null } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== null) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-majin-csrf'] = '1';
  return fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === null ? undefined : JSON.stringify(body),
    signal,
  });
}

/** Minimal, safe markdown: **bold**, `code`, paragraphs. No HTML injection. */
function renderRich(container, text) {
  container.textContent = '';
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const b = document.createElement('strong');
      b.textContent = part.slice(2, -2);
      container.append(b);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const c = document.createElement('code');
      c.textContent = part.slice(1, -1);
      container.append(c);
    } else {
      container.append(document.createTextNode(part));
    }
  }
}

function timeLabel() {
  return new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function scrollDown(force = false) {
  const nearBottom = els.stage.scrollHeight - els.stage.scrollTop - els.stage.clientHeight < 160;
  if (force || nearBottom) els.stage.scrollTop = els.stage.scrollHeight;
}

function setHero(visible) {
  els.hero.hidden = !visible;
  if (!visible) els.hero.classList.add('is-compact');
}

function resizeInput() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 132)}px`;
  els.send.disabled = !els.input.value.trim() || state.streaming;
}

/* -------------------------------------------------------- owner mode -- */

const laneLabel = (lane) => t(`owner.lane.${lane}`);

/** Load and render what the owner has currently granted. */
async function loadOwnerMode() {
  try {
    const res = await api('/api/owner-mode');
    if (!res.ok) return;
    const data = await res.json();
    renderOwnerMode(data.ownerMode);
  } catch { /* the sheet is not critical path */ }
}

function renderOwnerMode(view) {
  if (!view) return;
  const active = new Set(view.lanes || []);
  els.ownerState.textContent = active.size ? t('owner.on', { n: active.size }) : t('owner.off');
  els.ownerNote.textContent = view.note || t('owner.note');

  els.laneList.textContent = '';
  for (const lane of view.grantable || []) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lane-item';
    btn.dataset.on = active.has(lane) ? 'true' : 'false';
    const name = document.createElement('span');
    name.textContent = laneLabel(lane);
    const state = document.createElement('span');
    state.className = 'lane-state';
    state.textContent = active.has(lane) ? t('owner.granted') : t('owner.grant');
    btn.append(name, state);
    btn.addEventListener('click', () => toggleLane(lane, !active.has(lane)));
    li.append(btn);
    els.laneList.append(li);
  }

  els.folderList.textContent = '';
  const folders = view.folders || [];
  if (!folders.length) {
    const li = document.createElement('li');
    li.className = 'folder-empty';
    li.textContent = t('owner.noFolders');
    els.folderList.append(li);
  }
  for (const folder of folders) {
    const li = document.createElement('li');
    li.className = 'folder-item';
    const label = document.createElement('span');
    label.textContent = folder;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'folder-x';
    remove.textContent = '×';
    remove.setAttribute('aria-label', t('owner.removeFolder', { folder }));
    remove.addEventListener('click', () => postOwner({ action: 'revoke', folders: [folder] }));
    li.append(label, remove);
    els.folderList.append(li);
  }

  els.ownerRevoke.hidden = active.size === 0;
}

async function postOwner(body) {
  try {
    const res = await api('/api/owner-mode', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    renderOwnerMode(data.ownerMode);
    await loadSkills();
    await loadCapabilities();
    return data;
  } catch (err) {
    toast(err.message || t('msg.genericError'));
    return null;
  }
}

async function toggleLane(lane, on) {
  if (on) {
    const data = await postOwner({ action: 'grant', lanes: [lane] });
    if (data) toast(`${laneLabel(lane)}: ${t('owner.granted')}`);
  } else {
    await postOwner({ action: 'revoke', lanes: [lane] });
  }
}

async function addFolder() {
  const raw = els.folderInput.value.trim();
  if (!raw) return;
  const data = await postOwner({ action: 'grant', folders: [raw] });
  if (data) {
    els.folderInput.value = '';
    toast(t('owner.folderAdded'));
  }
}

/** What MAJIN can do right now, per lane. Shown so a missing tool is visible. */
async function loadCapabilities() {
  try {
    const res = await api('/api/capabilities');
    if (!res.ok) return;
    const data = await res.json();
    state.capabilities = data;
  } catch { /* informative only */ }
}

async function loadSkills() {
  try {
    const res = await api('/api/skills');
    if (!res.ok) return;
    const data = await res.json();
    els.skillList.textContent = '';
    const list = data.installed || [];
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'skill-empty';
      li.textContent = t('skill.none');
      els.skillList.append(li);
      return;
    }
    for (const skill of list) {
      const li = document.createElement('li');
      li.className = 'skill-item';
      li.dataset.ready = skill.ready ? 'true' : 'false';
      const title = document.createElement('span');
      title.className = 'skill-title';
      title.textContent = skill.title;
      const meta = document.createElement('span');
      meta.className = 'skill-meta';
      if (skill.ready) meta.textContent = skill.degraded?.length ? t('skill.degraded', { what: skill.degraded.join(', ') }) : t('skill.ready');
      else meta.textContent = t('skill.blocked', { what: skill.blockedBy || (skill.requires || []).join(', ') });
      li.append(title, meta);
      if (skill.summary) {
        const p = document.createElement('p');
        p.className = 'skill-summary';
        p.textContent = skill.summary;
        li.append(p);
      }
      els.skillList.append(li);
    }
  } catch { /* informative only */ }
}

/* --------------------------------------------------------- attachments -- */

const ATTACH_TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv',
  'application/json': 'json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function openLightbox(src) {
  els.lightboxImg.src = src;
  els.lightbox.hidden = false;
}

/**
 * Upload one file and show it in the thread as a real card.
 *
 * The bytes land in the workspace, which is the same directory the agent's own
 * tools read — so what the phone shows and what the model can use are the same
 * file, not two copies.
 */
async function uploadFile(file) {
  const type = file.type || 'application/octet-stream';
  if (!ATTACH_TYPES[type]) {
    toast(t('attach.unsupported'));
    return null;
  }
  const limits = await api('/api/uploads').then((r) => r.json()).catch(() => ({}));
  const maxBytes = limits?.maxBytes || 6 * 1024 * 1024;
  if (file.size > maxBytes) {
    toast(t('attach.tooBig', { mb: Math.round(maxBytes / (1024 * 1024)) }));
    return null;
  }

  els.attach.disabled = true;
  els.hint.textContent = t('attach.uploading');
  try {
    const data = await readAsBase64(file);
    const res = await api('/api/upload', { method: 'POST', body: { name: file.name, type, data } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    renderAttachment(body.upload);
    els.hint.textContent = t('attach.ready', { name: body.upload.name });
    return body.upload;
  } catch (err) {
    els.hint.textContent = '';
    toast(t('attach.failed', { error: err.message }));
    return null;
  } finally {
    els.attach.disabled = false;
  }
}

/** A card in the thread: an image, or a chip with the file's name and size. */
function renderAttachment(upload) {
  const node = document.createElement('figure');
  node.className = 'attach-card';
  const body = document.createElement('div');
  body.className = 'attach-body';
  const url = `/api/uploads/${encodeURIComponent(upload.name)}`;

  if (String(upload.type).startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = upload.name;
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(url));
    body.append(img);
  } else {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = (upload.name.split('.').pop() || 'bin').slice(0, 4);
    const label = document.createElement('span');
    label.textContent = upload.name;
    chip.append(icon, label);
    body.append(chip);
  }

  const meta = document.createElement('figcaption');
  meta.className = 'attach-meta';
  const left = document.createElement('span');
  left.textContent = humanBytes(upload.bytes || 0);
  const right = document.createElement('a');
  right.href = url;
  right.target = '_blank';
  right.rel = 'noopener noreferrer';
  right.textContent = t('preview.open');
  meta.append(left, right);

  node.append(body, meta);
  els.thread.append(node);
  setHero(false);
  scrollDown(true);
}

/**
 * Render an HTML file MAJIN created inside the conversation.
 *
 * The iframe carries `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, so
 * the page runs in an opaque origin and cannot reach this app's DOM, storage or
 * session cookie. The server adds a matching `CSP: sandbox` header, so even a
 * client that forgot the attribute is contained.
 */
function renderPreview(name) {
  const url = `/api/uploads/${encodeURIComponent(name)}`;
  const node = document.createElement('div');
  node.className = 'preview';
  const head = document.createElement('div');
  head.className = 'preview-head';
  const label = document.createElement('span');
  label.className = 'preview-name';
  label.textContent = name;
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'preview-open';
  open.textContent = t('preview.open');
  open.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
  head.append(label, open);

  const frame = document.createElement('iframe');
  frame.className = 'preview-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('loading', 'lazy');
  frame.title = t('preview.label', { name });
  frame.src = url;

  node.append(head, frame);
  els.thread.append(node);
  setHero(false);
  scrollDown(true);
}

/** A file the agent just wrote, offered as a preview if the interface can show it. */
function offerPreview(name) {
  if (!state.previewOn) return;
  if (!/\.(html?|htm)$/i.test(name)) return;
  renderPreview(name);
}

/* ------------------------------------------------------------- rendering -- */

function addMessage(role, text, { error = false, meta = '' } = {}) {
  const article = document.createElement('article');
  article.className = 'msg';
  article.dataset.role = role;
  if (error) article.dataset.error = 'true';
  const body = document.createElement('div');
  body.className = 'msg-body';
  if (role === 'assistant') renderRich(body, text);
  else body.textContent = text;
  const metaEl = document.createElement('div');
  metaEl.className = 'msg-meta';
  metaEl.textContent = meta;
  article.append(body, metaEl);
  els.thread.append(article);
  setHero(false);
  scrollDown(true);
  return { article, body, metaEl };
}

function beginAssistantBubble() {
  if (state.bubble) return state.bubble;
  const { article, body } = addMessage('assistant', '', { meta: '' });
  body.classList.add('cursor');
  state.bubble = { article, body };
  state.bubbleText = '';
  return state.bubble;
}

function streamDelta(text) {
  const bubble = beginAssistantBubble();
  state.bubbleText += text;
  renderRich(bubble.body, state.bubbleText);
  scrollDown();
}

function endAssistantBubble(meta = '') {
  if (!state.bubble) return state.bubbleText;
  state.bubble.body.classList.remove('cursor');
  const metaEl = state.bubble.article.querySelector('.msg-meta');
  if (metaEl) metaEl.textContent = meta || timeLabel();
  const text = state.bubbleText;
  state.bubble = null;
  state.bubbleText = '';
  return text;
}

function toolLabel(name) {
  return {
    workspace_write: t('tool.workspace_write'),
    workspace_read: t('tool.workspace_read'),
    workspace_list: t('tool.workspace_list'),
    memory_save: t('tool.memory_save'),
    memory_search: t('tool.memory_search'),
  }[name] || name;
}

function addToolCard(name, input) {
  const node = document.createElement('details');
  node.className = 'tool';
  node.dataset.state = 'running';
  node.dataset.tool = name;

  const summary = document.createElement('summary');
  const dot = document.createElement('span');
  dot.className = 'tool-state';
  const label = document.createElement('span');
  label.className = 'tool-name';
  label.textContent = toolLabel(name);
  const sum = document.createElement('span');
  sum.className = 'tool-summary';
  sum.textContent = input?.fileName || '';
  summary.append(dot, label, sum);

  const detail = document.createElement('div');
  detail.className = 'tool-detail';
  detail.textContent = t('state.running');

  node.append(summary, detail);
  els.thread.append(node);
  setHero(false);
  scrollDown(true);
  return { node, sum, detail };
}

const activeTools = new Map();

/* ------------------------------------------------------------------ auth -- */

function showGate(message = '') {
  els.gate.hidden = false;
  els.gateError.hidden = !message;
  els.gateError.textContent = message;
  setTimeout(() => els.gateCode.focus(), 80);
}

function hideGate() {
  els.gate.hidden = true;
}

async function pair(code) {
  els.gateSubmit.disabled = true;
  try {
    const res = await api('/api/auth/pair', { method: 'POST', body: { code } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showGate(data?.error?.message === 'That pairing code is not valid.' ? t('gate.badCode') : t('gate.failed'));
      return;
    }
    hideGate();
    await loadState();
    toast(t('conn.back'));
  } catch {
    showGate(t('gate.offline'));
  } finally {
    els.gateSubmit.disabled = false;
  }
}

/* ------------------------------------------------------------------ boot -- */

async function boot() {
  try {
    const health = await api('/api/health');
    const h = await health.json().catch(() => ({}));
    state.version = h.version || null;
    if (els.versionNote) els.versionNote.textContent = `MAJIN ${h.version || ''} · Node ${h.node || ''}`.trim();
  } catch {
    setDot('offline');
    els.modelLabel.textContent = 'offline';
  }

  const me = await api('/api/me').then((r) => r.json()).catch(() => ({ authenticated: false }));
  if (!me.authenticated) {
    showGate();
    return;
  }
  hideGate();
  await loadState();
}

async function loadState() {
  const res = await api('/api/state');
  if (res.status === 401) {
    showGate();
    return;
  }
  const data = await res.json();
  if (!data.ok) return;
  state.model = data.model;
  state.version = data.version || state.version;
  const demo = data.model.demo;
  els.modelLabel.textContent = demo ? 'demo' : data.model.model;
  setDot(demo ? 'demo' : 'ok');
  els.sheetModel.textContent = data.model.label;
  els.sheetModelNote.textContent = demo
    ? t('model.demoNote')
    : t('model.providerNote', { provider: data.model.provider });
  els.versionNote.textContent = `MAJIN ${data.version} · policy: ${data.policy}`;
  renderFiles(data.workspace?.files || []);
  loadOwnerMode();
  loadSkills();
  renderGoals(data.goals || []);
  renderConversations(data.conversations || []);
  loadModels();
  if (demo) els.hint.textContent = t('hero.demoHint');
  state.started = true;
}

function renderFiles(files) {
  els.sheetFiles.textContent = '';
  if (!files.length) {
    const li = document.createElement('li');
    li.textContent = 'Tom arbetsyta';
    els.sheetFiles.append(li);
    return;
  }
  for (const f of files) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = f;
    li.append(name);
    els.sheetFiles.append(li);
  }
}

/**
 * Goals the host has on disk. A BLOCKED goal gets an explicit resume control:
 * resuming re-verifies against recorded hashes on the server and can still come
 * back BLOCKED, so the button never promises success.
 */
function renderGoals(list) {
  els.sheetGoals.textContent = '';
  const open = list.filter((g) => ['BLOCKED', 'FAILED', 'RUNNING', 'VERIFYING', 'WAITING_FOR_APPROVAL'].includes(g.state));
  if (!open.length) {
    const li = document.createElement('li');
    li.className = 'goal-empty';
    li.textContent = t('sheet.noGoals');
    els.sheetGoals.append(li);
    return;
  }
  for (const goal of open.slice(0, 10)) {
    const li = document.createElement('li');
    li.className = 'goal-item';
    const title = document.createElement('span');
    title.className = 'goal-title';
    title.textContent = goal.objective || goal.id;
    const state = document.createElement('span');
    state.className = 'goal-state';
    state.dataset.state = goal.state;
    state.textContent = t(`goal.state.${goal.state}`);
    li.append(title, state);
    if (goal.state === 'BLOCKED') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ghost small';
      btn.textContent = t('goal.resume');
      btn.addEventListener('click', () => resumeGoal(goal.id, btn));
      li.append(btn);
    }
    els.sheetGoals.append(li);
  }
}

async function resumeGoal(goalId, button) {
  button.disabled = true;
  button.textContent = t('goal.resuming');
  try {
    const res = await api('/api/goal/resume', { method: 'POST', body: { goalId } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await readStream(res.body, new AbortController().signal);
    await refreshSidebar();
  } catch (err) {
    toast(err.message || t('msg.genericError'));
  } finally {
    button.disabled = false;
    button.textContent = t('goal.resume');
  }
}

function renderConversations(list) {
  els.sheetConvs.textContent = '';
  for (const conv of list.slice(0, 12)) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const title = document.createElement('span');
    title.textContent = conv.title;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${conv.messages} medd.`;
    btn.append(title, meta);
    btn.addEventListener('click', () => openConversation(conv.id));
    li.append(btn);
    els.sheetConvs.append(li);
  }
}

async function openConversation(id) {
  closeSheet();
  const res = await api(`/api/conversation?id=${encodeURIComponent(id)}`);
  if (!res.ok) return;
  const data = await res.json();
  state.conversationId = data.conversation.id;
  els.thread.textContent = '';
  state.bubble = null;
  state.bubbleText = '';
  for (const m of data.conversation.messages) {
    if (m.role === 'user') addMessage('user', m.content, { meta: timeLabel() });
    else addMessage('assistant', m.content, { error: m.meta?.error === true, meta: timeLabel() });
  }
  if (data.conversation.pendingApproval) {
    showApproval({ tool: data.conversation.pendingApproval.tool, reason: '' });
  } else {
    hideApproval();
  }
  setHero(!data.conversation.messages.length);
  scrollDown(true);
}

/* ------------------------------------------------------------------ chat -- */

function newRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  state.requestSeq += 1;
  return `req_${Date.now()}_${state.requestSeq}`;
}

async function send(text) {
  const message = String(text || '').trim();
  if (!message || state.streaming) return;

  cancelSpeech();
  els.input.value = '';
  resizeInput();
  addMessage('user', message, { meta: timeLabel() });
  hideApproval();

  state.streaming = true;
  els.send.hidden = true;
  els.stop.hidden = false;
  els.send.disabled = true;
  els.composer.dataset.streaming = 'true';
  spirit.set('thinking');
  els.hint.textContent = '';

  const controller = new AbortController();
  state.controller = controller;

  const body = { text: message, requestId: newRequestId() };
  if (state.conversationId) body.conversationId = state.conversationId;

  try {
    const res = await api('/api/chat', { method: 'POST', body, signal: controller.signal });
    if (res.status === 401) {
      finishStream();
      showGate(t('gate.expired'));
      return;
    }
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    await readStream(res.body, controller.signal);
  } catch (err) {
    if (err.name === 'AbortError') {
      endAssistantBubble();
      addMessage('assistant', t('msg.cancelled'), { error: true, meta: timeLabel() });
    } else if (await tryReattach()) {
      // The connection dropped but the host kept working: pick the turn back up
      // instead of telling the user it failed.
      return;
    } else {
      endAssistantBubble();
      addMessage('assistant', t('msg.hostUnreachable', { error: err.message }), { error: true, meta: timeLabel() });
      setDot('offline');
    }
    spirit.set('error');
  } finally {
    finishStream();
  }
}

/**
 * Reattach to a turn the host is still running (or finished while we were
 * away). Returns true when the turn was picked back up. Bounded retries with
 * backoff, because a phone changing network often needs a second or two.
 */
async function tryReattach({ attempts = 3 } = {}) {
  const { turnId, lastSeq } = state.session;
  if (!turnId) return false;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** (i - 1)));
    try {
      const res = await api(`/api/chat/stream?turnId=${encodeURIComponent(turnId)}&from=${lastSeq}`);
      if (res.status === 404) return false; // buffer expired: nothing to resume
      if (!res.ok || !res.body) continue;
      state.session.reconnects += 1;
      els.hint.textContent = t('conn.resumed');
      await readStream(res.body, new AbortController().signal);
      return true;
    } catch {
      /* try again */
    }
  }
  return false;
}

function finishStream() {
  state.streaming = false;
  state.controller = null;
  els.stop.hidden = true;
  els.send.hidden = false;
  els.composer.dataset.streaming = 'false';
  resizeInput();
  if (spirit.state !== 'error') setTimeout(() => spirit.set('idle'), 900);
}

async function readStream(stream, signal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let finalText = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
      if (Number.isFinite(ev.seq) && ev.seq > 0) state.session.lastSeq = ev.seq;
      const handled = dispatch(ev.event, ev.data);
      if (handled?.final) finalText = handled.final;
    }
    if (signal.aborted) {
      try {
        await reader.cancel();
      } catch { /* already closed */ }
      break;
    }
  }
  const tail = parser.pending;
  if (tail.trim()) {
    const last = handleEventText(tail);
    if (last) dispatch(last.event, last.data);
  }
  return finalText;
}

function handleEventText(chunk) {
  const lines = chunk.split('\n').filter(Boolean);
  let event = 'message';
  const data = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

/** Fold the event into client state, then let the view react. */
function dispatch(event, data) {
  const before = state.session;
  const { state: next, intents } = applyEvent(before, event, data);
  state.session = next;
  if (next.conversationId) state.conversationId = next.conversationId;
  return viewIntents(event, data, intents);
}

function viewIntents(event, data, intents) {
  switch (event) {
    case 'open':
      if (data.model) {
        els.modelLabel.textContent = data.model.demo ? 'demo' : data.model.model;
        setDot(data.model.demo ? 'demo' : 'ok');
      }
      break;

    case 'user':
      break;

    case 'state':
      if (data.state === 'thinking') spirit.set('thinking');
      else if (data.state === 'working') spirit.set('working');
      else if (data.state === 'verifying') spirit.set('working');
      break;

    case 'delta':
      spirit.set('speaking');
      streamDelta(data.text);
      break;

    case 'tool_start': {
      const card = addToolCard(data.name, data.input);
      activeTools.set(data.id || data.name, card);
      spirit.set('working');
      break;
    }

    case 'tool_result': {
      if (data.ok && data.verified && data.name === 'workspace_write' && data.summary) {
        // "name · 1234 byte" -> name
        const fileName = String(data.summary).split(' · ')[0].trim();
        if (fileName) offerPreview(fileName);
      }
      const card = activeTools.get(data.id || data.name) || [...activeTools.values()].pop();
      if (card) {
        card.node.dataset.state = data.ok ? (data.verified ? 'verified' : 'ok') : 'failed';
        card.sum.textContent = data.summary || '';
        card.detail.textContent = data.ok
          ? `${data.verified ? t('state.verified') : t('state.done')}${data.receiptId ? ` · ${t('state.receipt')} ${data.receiptId}` : ''}`
          : t('state.failed');
      }
      spirit.set('working');
      break;
    }

    case 'context':
      // Quiet, factual: the turn still runs, just with a shorter history.
      els.hint.textContent = t('state.contextTrimmed');
      break;

    case 'recovery': {
      // The host is retrying on its own; say so instead of looking frozen.
      spirit.set('working');
      const reason = data.failureClass || t('common.unknownError');
      if (data.action && data.action !== 'none') {
        els.hint.textContent = t('state.recovering', { attempt: data.attempt || 1, reason });
      } else if (Array.isArray(data.advice) && data.advice.length) {
        els.hint.textContent = t('state.recoveryAdvice', { advice: data.advice.join(', ') });
      }
      break;
    }

    case 'approval_required':
      state.pendingApproval = data;
      showApproval(data);
      spirit.set('thinking');
      break;

    case 'error':
      addMessage('assistant', data.message || t('msg.genericError'), { error: true, meta: timeLabel() });
      spirit.set('error');
      break;

    case 'cancelled':
      addMessage('assistant', t('msg.cancelledShort'), { error: true, meta: timeLabel() });
      break;

    case 'resume_result': {
      if (data.status === 'completed') {
        addMessage('assistant', t('goal.resumed'), { meta: timeLabel() });
        spirit.set('done');
      } else {
        addMessage('assistant', t('goal.stillBlocked', { items: (data.missing || []).join(', ') || '?' }), {
          error: true,
          meta: timeLabel(),
        });
        spirit.set('error');
      }
      break;
    }

    case 'replay':
      if (data.content) addMessage('assistant', data.content, { meta: t('state.replayed') });
      else if (data.truncated) addMessage('assistant', t('state.truncated'), { meta: t('state.replayed') });
      break;

    case 'done': {
      const text = endAssistantBubble(timeLabel());
      const finalText = text || '';
      if (data.status === 'already_handled' && !finalText) {
        // Nothing was re-rendered above: say it once, plainly.
        addMessage('assistant', t('state.truncated'), { meta: timeLabel() });
      }
      if (data.status === 'completed') {
        spirit.set('done');
        if (state.tts && finalText) speak(finalText);
        refreshSidebar();
      } else if (data.status === 'awaiting_approval') {
        spirit.set('thinking');
      } else if (data.status === 'cancelled' || data.status === 'denied') {
        spirit.set('idle');
      } else if (data.status === 'failed') {
        spirit.set('error');
      }
      return { final: finalText };
    }

    default:
      break;
  }
  return null;
}

/* -------------------------------------------------------------- approval -- */

function showApproval({ tool, reason }) {
  els.approval.hidden = false;
  els.approvalText.textContent = `${t('approval.text', { tool: toolLabel(tool) })}${reason ? ` ${reason}` : ''}`;
}

function hideApproval() {
  els.approval.hidden = true;
  state.pendingApproval = null;
}

async function resolveApproval(approve) {
  if (!state.conversationId) {
    hideApproval();
    return;
  }
  hideApproval();
  spirit.set(approve ? 'working' : 'idle');
  try {
    const res = await api('/api/approve', { method: 'POST', body: { conversationId: state.conversationId, approve } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await readStream(res.body, new AbortController().signal);
  } catch (err) {
    addMessage('assistant', t('msg.approvalFailed', { error: err.message }), { error: true, meta: timeLabel() });
    spirit.set('error');
  } finally {
    refreshSidebar();
  }
}

/* ----------------------------------------------------------------- voice -- */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceSupport = detectVoiceSupport(window);

function setupVoice() {
  if (!voiceSupport.recognition) {
    els.mic.disabled = true;
    els.mic.setAttribute('aria-disabled', 'true');
    els.voiceNote.textContent = t('voice.unsupported');
    return;
  }
  const rec = new SpeechRecognition();
  rec.lang = recognitionLang(navigator.language);
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    state.listening = true;
    els.mic.setAttribute('aria-pressed', 'true');
    spirit.set('listening');
    els.hint.textContent = 'Lyssnar…';
  };
  rec.onresult = (ev) => {
    let interim = '';
    let final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const r = ev.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    const text = final || interim;
    if (text) {
      els.input.value = text.trim();
      resizeInput();
    }
    spirit.level(Math.min(1, (ev.results[ev.results.length - 1]?.[0]?.confidence || 0.6)));
    if (final) {
      state.lastVoiceFinal = final.trim();
    }
  };
  rec.onerror = (ev) => {
    const msg = voiceErrorMessage(ev.error);
    if (msg) els.hint.textContent = msg;
  };
  rec.onend = () => {
    state.listening = false;
    els.mic.setAttribute('aria-pressed', 'false');
    spirit.level(0);
    spirit.set('idle');
    els.hint.textContent = '';
    const spoken = state.lastVoiceFinal;
    state.lastVoiceFinal = null;
    if (shouldAutoSend({ finalTranscript: spoken, autosend: state.autosend, streaming: state.streaming })) {
      els.input.value = '';
      resizeInput();
      send(spoken);
    }
  };
  state.recognition = rec;
  els.voiceNote.textContent = voiceSupport.synthesis
    ? t('voice.readyTts')
    : t('voice.readyNoTts');
}

function toggleListening() {
  const rec = state.recognition;
  if (!rec) return;
  if (state.listening) {
    rec.stop();
    return;
  }
  cancelSpeech();
  try {
    rec.start();
  } catch {
    /* start() throws if already started; ignore */
  }
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const lang = document.documentElement.lang || 'sv-SE';
  return voices.find((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2))) || voices[0] || null;
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    els.hint.textContent = t('voice.noTts');
    return;
  }
  const clean = speechText(text);
  if (!clean) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = recognitionLang(navigator.language);
  utter.rate = 1.02;
  utter.pitch = 1.0;
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.onstart = () => spirit.set('speaking');
  utter.onboundary = () => spirit.level(0.45 + Math.random() * 0.3);
  utter.onend = () => {
    spirit.level(0);
    spirit.set('idle');
  };
  window.speechSynthesis.speak(utter);
}

function cancelSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/* ------------------------------------------------------------------ ui -- */

function openSheet() {
  els.sheet.hidden = false;
  els.sheetBackdrop.hidden = false;
  els.menu.setAttribute('aria-expanded', 'true');
  els.sheet.querySelector('button, input')?.focus();
  refreshSidebar();
}

function closeSheet() {
  els.sheet.hidden = true;
  els.sheetBackdrop.hidden = true;
  els.menu.setAttribute('aria-expanded', 'false');
}

async function loadModels({ refresh = false } = {}) {
  try {
    const res = await api(`/api/models${refresh ? '?refresh=1' : ''}`);
    if (!res.ok) return;
    const data = await res.json();
    renderModels(data);
  } catch { /* model list is informational; chat still works */ }
}

const refreshModelsBtn = els.refreshModels;

function renderModels(data) {
  els.modelList.textContent = '';
  const models = (data.models || []).filter((m) => m.configured);
  if (!models.length) {
    const li = document.createElement('li');
    li.className = 'model-empty';
    li.textContent = t('model.none');
    els.modelList.append(li);
    els.modelSource.textContent = data.configReadable
      ? t('model.readConfig', { path: data.configPath })
      : t('model.noConfig');
    return;
  }
  const active = state.modelId || data.current;
  for (const m of models) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'model-item';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(m.id === active));
    btn.dataset.modelId = m.id;
    if (m.id === active) btn.dataset.active = 'true';
    const name = document.createElement('span');
    name.textContent = m.label;
    const status = document.createElement('span');
    status.className = 'model-status';
    status.dataset.status = m.status;
    status.textContent = m.liveVerified
      ? t('model.live')
      : m.status === 'missing-key'
        ? t('model.missingKey')
        : m.status === 'discovered'
          ? t('model.discovered')
          : t('model.unverified');
    btn.append(name, status);
    btn.addEventListener('click', () => selectModel(m.id));
    li.append(btn);
    els.modelList.append(li);
  }
  const catalogAt = data.catalog?.at ? new Date(data.catalog.at).toLocaleString('sv-SE') : null;
  els.modelSource.textContent = catalogAt
    ? `${t('model.summary', { count: models.length })} ${t('model.catalogAt', { at: catalogAt })}`
    : t('model.summary', { count: models.length });
  refreshModelsBtn.hidden = !(data.models || []).some((m) => m.configured);
}

async function selectModel(modelId) {
  if (state.streaming) {
    toast(t('model.waitForTurn'));
    return;
  }
  try {
    if (!state.conversationId) {
      const created = await api('/api/conversations', { method: 'POST' });
      const data = await created.json();
      if (!data.ok) throw new Error(data?.error?.message || t('msg.genericError'));
      state.conversationId = data.conversation.id;
    }
    const res = await api('/api/model', { method: 'POST', body: { conversationId: state.conversationId, modelId } });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || t('model.selectFailed'));
    state.modelId = modelId;
    els.sheetModel.textContent = data.info.label;
    els.modelLabel.textContent = data.info.demo ? 'demo' : data.info.model;
    setDot(data.info.demo ? 'demo' : 'ok');
    await loadModels();
    toast(t('model.selected'));
  } catch (err) {
    toast(err.message || t('model.selectFailed'));
  }
}

async function refreshSidebar() {
  try {
    const res = await api('/api/state');
    if (!res.ok) return;
    const data = await res.json();
    renderFiles(data.workspace?.files || []);
    renderGoals(data.goals || []);
    renderConversations(data.conversations || []);
  } catch { /* sidebar is non-critical */ }
}

function bindEvents() {
  els.composer.addEventListener('submit', (ev) => {
    ev.preventDefault();
    send(els.input.value);
  });
  els.input.addEventListener('input', resizeInput);
  els.input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      send(els.input.value);
    }
  });
  els.stop.addEventListener('click', async () => {
    cancelSpeech();
    // The turn now outlives the socket on purpose, so stopping it is a request
    // to the host — aborting the fetch alone would just detach and let it run.
    // The turn id is the only handle a client has before it learns the
    // conversation id, which is exactly the case during a first message.
    const body = {};
    if (state.session.turnId) body.turnId = state.session.turnId;
    else if (state.conversationId) body.conversationId = state.conversationId;
    if (Object.keys(body).length) {
      try {
        await api('/api/cancel', { method: 'POST', body });
      } catch { /* the local abort below still releases the UI */ }
    }
    state.controller?.abort();
    spirit.set('idle');
  });
  els.mic.addEventListener('click', toggleListening);

  // Attach: one tap on a phone, drag-and-drop on a desktop.
  els.attach.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', async () => {
    const files = [...(els.fileInput.files || [])];
    els.fileInput.value = '';
    for (const f of files) await uploadFile(f); // sequential: the phone may be on 5G
  });
  const dropZone = els.stage;
  for (const type of ['dragenter', 'dragover']) {
    dropZone.addEventListener(type, (ev) => {
      if (!ev.dataTransfer?.types?.includes('Files')) return;
      ev.preventDefault();
      dropZone.dataset.dropping = 'true';
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropZone.addEventListener(type, () => { delete dropZone.dataset.dropping; });
  }
  dropZone.addEventListener('drop', async (ev) => {
    if (!ev.dataTransfer?.files?.length) return;
    ev.preventDefault();
    for (const f of [...ev.dataTransfer.files]) await uploadFile(f);
  });

  els.lightbox.addEventListener('click', () => { els.lightbox.hidden = true; els.lightboxImg.src = ''; });
  els.lightboxX.addEventListener('click', (ev) => {
    ev.stopPropagation();
    els.lightbox.hidden = true;
    els.lightboxImg.src = '';
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !els.lightbox.hidden) {
      els.lightbox.hidden = true;
      els.lightboxImg.src = '';
    }
  });
  els.menu.addEventListener('click', openSheet);
  els.sheetBackdrop.addEventListener('click', closeSheet);
  els.newChat.addEventListener('click', () => {
    state.conversationId = null;
    els.thread.textContent = '';
    state.bubble = null;
    setHero(true);
    hideApproval();
    closeSheet();
  });
  els.folderAdd.addEventListener('click', addFolder);
  els.folderInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      addFolder();
    }
  });
  els.ownerRevoke.addEventListener('click', async () => {
    const data = await postOwner({ action: 'revoke' });
    if (data) toast(t('owner.revoked'));
  });
  els.logout.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    closeSheet();
    showGate(t('gate.loggedOut'));
  });
  els.ttsToggle.checked = state.tts;
  els.ttsToggle.addEventListener('change', () => {
    state.tts = els.ttsToggle.checked;
    if (!state.tts) cancelSpeech();
    localStorage.setItem('majin.tts', state.tts ? '1' : '0');
  });
  els.autosendToggle.checked = state.autosend;
  els.autosendToggle.addEventListener('change', () => {
    state.autosend = els.autosendToggle.checked;
    localStorage.setItem('majin.autosend', state.autosend ? '1' : '0');
  });
  els.gateForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const code = els.gateCode.value.trim();
    if (code.length >= 8) pair(code);
  });
  els.approvalAllow.addEventListener('click', () => resolveApproval(true));
  els.approvalDeny.addEventListener('click', () => resolveApproval(false));
  els.approvalDismiss.addEventListener('click', hideApproval);
  els.modelPill.addEventListener('click', openSheet);
  els.refreshModels.addEventListener('click', async () => {
    els.refreshModels.disabled = true;
    toast(t('model.refreshing'), 8000);
    await loadModels({ refresh: true });
    els.refreshModels.disabled = false;
  });
  els.suggestions.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-fill]');
    if (!btn) return;
    els.input.value = btn.dataset.fill;
    resizeInput();
    els.input.focus();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !els.sheet.hidden) closeSheet();
  });
  window.addEventListener('online', () => {
    els.offline.hidden = true;
    setDot(state.model?.demo ? 'demo' : 'ok');
    toast(t('conn.back'));
  });
  window.addEventListener('offline', () => {
    els.offline.hidden = false;
    setDot('offline');
  });
  if (!navigator.onLine) els.offline.hidden = false;
  // Keep the composer visible when the mobile keyboard opens.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (document.activeElement === els.input) setTimeout(() => scrollDown(true), 50);
    });
  }
}

function restorePrefs() {
  try {
    if (localStorage.getItem('majin.tts') === '1') state.tts = true;
    if (localStorage.getItem('majin.autosend') === '0') state.autosend = false;
  } catch { /* storage may be blocked; defaults stand */ }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is optional; the app works without it */
    });
  });
}

async function main() {
  restorePrefs();
  setupVoice();
  bindEvents();
  registerServiceWorker();
  resizeInput();
  if (reducedMotion) spirit.set('idle');
  await boot();
}

main();
