import { computeDotMatrixState, createDotMatrixCanvas, TOTAL_SKILL_DOTS } from './dot-matrix.js';
import { t5 } from './strings.js';

export function bootV5App(doc = globalThis.document, fetchImpl = globalThis.fetch) {
  if (!doc) return null;

  const canvas = doc.getElementById('dot-matrix-canvas');
  const dotStrip = doc.getElementById('dot-segments');
  const xpTicker = doc.getElementById('xp-ticker');
  const skillNumericStatus = doc.getElementById('skill-numeric-status');
  const liveStatusRow = doc.getElementById('live-status-row');
  const liveStatusText = doc.getElementById('live-status-text');
  const logoTrigger = doc.getElementById('majin-logo-trigger');
  const skillTreeToggle = doc.getElementById('skill-tree-toggle');
  const skillTreeDrawer = doc.getElementById('skill-tree-drawer');
  const skillTreeClose = doc.getElementById('skill-tree-close');
  const skillTreeList = doc.getElementById('skill-tree-list');
  const selectedSkillDetail = doc.getElementById('selected-skill-detail');
  const drawerBackdrop = doc.getElementById('drawer-backdrop');

  const providerPill = doc.getElementById('provider-pill');
  const providerDrawer = doc.getElementById('provider-drawer');
  const providerClose = doc.getElementById('provider-close');
  const providerSelect = doc.getElementById('provider-select');
  const providerKeyInput = doc.getElementById('provider-key-input');
  const modelIdInput = doc.getElementById('model-id-input');
  const providerSaveBtn = doc.getElementById('provider-save-btn');
  const providerModelLabel = doc.getElementById('provider-model-label');
  const providerVerifiedDot = doc.getElementById('provider-verified-dot');
  const providerConnStatus = doc.getElementById('provider-conn-status');

  const wishForm = doc.getElementById('wish-form');
  const wishInput = doc.getElementById('wish-input');
  const sendBtn = doc.getElementById('send-btn');
  const stopBtn = doc.getElementById('stop-btn');
  const attachBtn = doc.getElementById('attach-btn');
  const fileInput = doc.getElementById('file-input');
  const attachmentsPreview = doc.getElementById('attachments-preview');
  const micBtn = doc.getElementById('mic-btn');
  const conversation = doc.getElementById('conversation');

  const reducedMotion = Boolean(
    globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const dotCanvas = createDotMatrixCanvas(canvas, { reducedMotion });

  let skills = [];
  let selectedSkillId = null;
  let pendingFiles = [];
  let micListening = false;

  function renderDotStrip(matrixState) {
    if (!dotStrip) return;
    dotStrip.innerHTML = '';
    dotStrip.setAttribute('aria-valuenow', String(matrixState.level));
    for (const d of matrixState.dots) {
      const cell = doc.createElement('span');
      cell.className = 'v5-dot-cell';
      cell.dataset.index = String(d.index);
      cell.dataset.filled = d.filled ? 'true' : 'false';
      if (matrixState.cohesiveMastery99 && d.filled) {
        cell.dataset.mastered = 'true';
      }
      if (matrixState.isStale && d.filled) {
        cell.dataset.stale = 'true';
      }
      dotStrip.appendChild(cell);
    }
  }

  function applySkillMatrixState(spec) {
    const state = dotCanvas.update(spec);
    if (xpTicker) xpTicker.textContent = state.tickerText;
    if (skillNumericStatus) {
      skillNumericStatus.textContent = `${state.numericLabel} · ${state.statusTextLabel} · ${t5('aggregateLabel')}`;
    }
    renderDotStrip(state);
    return state;
  }

  function setActivityStatus(activityState, statusText, { verifiedLearning = false } = {}) {
    doc.body.dataset.activity = activityState;
    doc.body.dataset.learning = verifiedLearning ? 'verified' : 'none';
    if (liveStatusRow) {
      liveStatusRow.dataset.state = verifiedLearning ? 'verified' : activityState;
    }
    if (liveStatusText && statusText) {
      liveStatusText.textContent = statusText;
    }
    const current = dotCanvas.getState();
    dotCanvas.update({
      skillId: current.skillId,
      displayName: current.displayName,
      level: current.level,
      xp: current.xp,
      lastXpGain: verifiedLearning ? current.lastXpGain : 0,
      freshness: current.isStale ? 'STALE' : 'FRESH',
      maturityStatus: current.maturityStatus,
      activity: activityState,
    });
  }

  function openSkillTree() {
    if (!skillTreeDrawer) return;
    skillTreeDrawer.hidden = false;
    if (drawerBackdrop) drawerBackdrop.hidden = false;
    logoTrigger?.setAttribute('aria-expanded', 'true');
    skillTreeToggle?.setAttribute('aria-expanded', 'true');
    renderSkillTreeList();
  }

  function closeSkillTree() {
    if (!skillTreeDrawer) return;
    skillTreeDrawer.hidden = true;
    if (providerDrawer?.hidden !== false && drawerBackdrop) {
      drawerBackdrop.hidden = true;
    }
    logoTrigger?.setAttribute('aria-expanded', 'false');
    skillTreeToggle?.setAttribute('aria-expanded', 'false');
  }

  function toggleSkillTree() {
    if (skillTreeDrawer?.hidden) openSkillTree();
    else closeSkillTree();
  }

  function renderSkillTreeList() {
    if (!skillTreeList) return;
    skillTreeList.innerHTML = '';
    for (const sk of skills) {
      const li = doc.createElement('li');
      li.className = 'v5-skill-item';
      li.setAttribute('role', 'option');
      const isSelected = sk.canonical_id === selectedSkillId;
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      li.dataset.skillId = sk.canonical_id;

      const left = doc.createElement('div');
      const title = doc.createElement('strong');
      title.textContent = sk.display_name;
      const sub = doc.createElement('div');
      sub.className = 'v5-skill-meta';
      sub.textContent = `${sk.taxonomy_kind} · ${sk.domain} · ${sk.maturity_status}`;
      left.appendChild(title);
      left.appendChild(sub);

      const right = doc.createElement('span');
      right.className = 'v5-xp-ticker';
      right.textContent = `${sk.level}/${TOTAL_SKILL_DOTS} · ${sk.xp} XP`;

      li.appendChild(left);
      li.appendChild(right);
      li.addEventListener('click', () => {
        selectedSkillId = sk.canonical_id;
        applySkillMatrixState({
          skillId: sk.canonical_id,
          displayName: sk.display_name,
          level: sk.level,
          xp: sk.xp,
          lastXpGain: sk.last_xp_gain || 0,
          freshness: sk.freshness || 'FRESH',
          maturityStatus: sk.maturity_status || 'UNTRAINED',
          activity: doc.body.dataset.activity || 'idle',
        });
        if (selectedSkillDetail) {
          selectedSkillDetail.textContent = `${sk.display_name} (${sk.canonical_id}) — ${sk.level}/99 · ${sk.xp} XP · ${sk.maturity_status}`;
        }
        renderSkillTreeList();
      });
      skillTreeList.appendChild(li);
    }
  }

  function appendMessage(role, text, badgeText = '') {
    if (!conversation) return;
    // Sanitize: never dump raw JSON blobs or stacktraces into the default view
    const safeText = String(text || '').replace(/^\s*\{[\s\S]*\}\s*$/m, '').trim() || String(text || '');
    const card = doc.createElement('article');
    card.className = `v5-msg ${role === 'user' ? 'v5-msg-user' : 'v5-msg-agent'}`;
    if (badgeText) {
      const badge = doc.createElement('span');
      badge.className = 'v5-msg-badge';
      badge.textContent = badgeText;
      card.appendChild(badge);
    }
    const p = doc.createElement('p');
    p.textContent = safeText;
    card.appendChild(p);
    conversation.appendChild(card);
  }

  // Wire UI events
  logoTrigger?.addEventListener('click', toggleSkillTree);
  skillTreeToggle?.addEventListener('click', toggleSkillTree);
  skillTreeClose?.addEventListener('click', closeSkillTree);

  providerPill?.addEventListener('click', () => {
    if (!providerDrawer) return;
    providerDrawer.hidden = !providerDrawer.hidden;
    if (drawerBackdrop) drawerBackdrop.hidden = providerDrawer.hidden;
    providerPill.setAttribute('aria-expanded', providerDrawer.hidden ? 'false' : 'true');
  });
  providerClose?.addEventListener('click', () => {
    if (!providerDrawer) return;
    providerDrawer.hidden = true;
    if (skillTreeDrawer?.hidden !== false && drawerBackdrop) drawerBackdrop.hidden = true;
    providerPill?.setAttribute('aria-expanded', 'false');
  });

  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSkillTree();
      if (providerDrawer) providerDrawer.hidden = true;
      if (drawerBackdrop) drawerBackdrop.hidden = true;
    }
  });

  wishInput?.addEventListener('input', () => {
    const hasContent = Boolean(wishInput.value.trim()) || pendingFiles.length > 0;
    if (sendBtn) sendBtn.disabled = !hasContent;
  });

  attachBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    for (const f of files) pendingFiles.push(f);
    if (attachmentsPreview) {
      attachmentsPreview.hidden = pendingFiles.length === 0;
      attachmentsPreview.innerHTML = '';
      for (const f of pendingFiles) {
        const chip = doc.createElement('span');
        chip.className = 'v5-attachment-chip';
        chip.textContent = f.name;
        attachmentsPreview.appendChild(chip);
      }
    }
    if (sendBtn) sendBtn.disabled = !(wishInput?.value.trim() || pendingFiles.length > 0);
  });

  // Opt-in only microphone button
  micBtn?.addEventListener('click', async () => {
    micListening = !micListening;
    micBtn.dataset.micState = micListening ? 'listening' : 'idle';
    micBtn.setAttribute('aria-pressed', micListening ? 'true' : 'false');
    micBtn.setAttribute('aria-label', micListening ? t5('micListeningLabel') : t5('micIdleLabel'));
    if (typeof fetchImpl === 'function') {
      try {
        await fetchImpl('/api/v5/voice/activate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userInitiated: micListening }),
        });
      } catch { /* ignore offline */ }
    }
  });

  providerSaveBtn?.addEventListener('click', async () => {
    const providerId = providerSelect?.value || 'opencode-go';
    const apiKey = providerKeyInput?.value || '';
    const modelId = modelIdInput?.value.trim() || 'glm-5.3-flash';
    if (typeof fetchImpl === 'function') {
      try {
        const res = await fetchImpl('/api/v5/provider', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerId, apiKey, modelId }),
        });
        const data = await res.json();
        if (providerModelLabel) providerModelLabel.textContent = `${providerId} · ${modelId}`;
        if (providerVerifiedDot) {
          providerVerifiedDot.dataset.verified = data.connectionVerified ? 'true' : 'false';
        }
        if (providerConnStatus) {
          providerConnStatus.textContent = data.connectionVerified
            ? t5('providerVerified')
            : t5('providerSavedNotVerified');
        }
      } catch { /* ignore */ }
    }
    if (providerDrawer) providerDrawer.hidden = true;
    if (drawerBackdrop) drawerBackdrop.hidden = true;
  });

  wishForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const goalText = wishInput?.value.trim() || '';
    if (!goalText && pendingFiles.length === 0) return;

    appendMessage('user', goalText || pendingFiles.map((f) => f.name).join(', '));
    if (wishInput) wishInput.value = '';
    if (sendBtn) sendBtn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;

    setActivityStatus('working', t5('statusReadingCv'), { verifiedLearning: false });

    if (typeof fetchImpl === 'function') {
      try {
        const res = await fetchImpl('/api/v5/goal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ goalText }),
        });
        const data = await res.json();
        const xpGain = data?.xp_award?.totalXpAwarded || 0;
        const pSkill = data?.xp_award?.primarySkill;
        if (pSkill) {
          applySkillMatrixState({
            skillId: pSkill.canonical_id,
            displayName: pSkill.display_name || 'Skill',
            level: pSkill.level,
            xp: pSkill.xp,
            lastXpGain: xpGain,
            freshness: pSkill.freshness || 'FRESH',
            maturityStatus: pSkill.maturity_status || 'VERIFIED',
            activity: 'idle',
          });
        }
        setActivityStatus(
          'idle',
          data?.status === 'COMPLETED' ? t5('statusCompleted') : t5('statusPartial'),
          { verifiedLearning: xpGain > 0 },
        );
        appendMessage(
          'agent',
          data?.summaryText || t5('statusCompleted'),
          xpGain > 0 ? `+${xpGain} XP (${pSkill?.level || 1}/99)` : data?.status,
        );
      } catch {
        setActivityStatus('idle', t5('statusFailed'), { verifiedLearning: false });
      }
    }
    pendingFiles = [];
    if (attachmentsPreview) attachmentsPreview.hidden = true;
    if (stopBtn) stopBtn.hidden = true;
  });

  stopBtn?.addEventListener('click', async () => {
    setActivityStatus('idle', t5('statusCancelled'), { verifiedLearning: false });
    if (stopBtn) stopBtn.hidden = true;
    if (typeof fetchImpl === 'function') {
      try {
        await fetchImpl('/api/v5/goal/cancel', { method: 'POST' });
      } catch { /* ignore */ }
    }
  });

  // Initial state render
  applySkillMatrixState({
    skillId: 'career.form-fill',
    displayName: 'Formulär', // input vocabulary, never rendered
    level: 18,
    xp: 3660,
    lastXpGain: 24,
    freshness: 'FRESH',
    maturityStatus: 'VERIFIED',
    activity: 'idle',
  });

  async function refreshState() {
    if (typeof fetchImpl !== 'function') return;
    try {
      const res = await fetchImpl('/api/v5/state');
      if (!res.ok) return;
      const state = await res.json();
      skills = Array.isArray(state.skills) ? state.skills : [];
      if (state.provider?.activeModelId && providerModelLabel) {
        providerModelLabel.textContent = `${state.provider.activeProvider} · ${state.provider.activeModelId}`;
      }
      if (providerVerifiedDot) {
        const activeProv = state.provider?.providers?.[state.provider?.activeProvider];
        providerVerifiedDot.dataset.verified = activeProv?.connectionVerified ? 'true' : 'false';
      }
    } catch { /* ignore */ }
  }

  refreshState();

  return {
    applySkillMatrixState,
    setActivityStatus,
    openSkillTree,
    closeSkillTree,
    getDotState: () => dotCanvas.getState(),
    setSkills(list) {
      skills = list;
      renderSkillTreeList();
    },
  };
}

if (typeof window !== 'undefined' && window.document) {
  bootV5App(window.document, window.fetch?.bind(window));
}
