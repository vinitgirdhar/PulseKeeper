'use strict';

const api = window.pcbAPI;
const icon = (name, size) => window.PKIcons.icon(name, size);

// Auto-hide scrollbars: reveal thumbs while scrolling, hide ~0.8s after idle.
// Capture phase catches scroll on any nested scroller (scroll doesn't bubble).
(function setupAutoHideScrollbars() {
  let idle;
  const root = document.documentElement;
  window.addEventListener('scroll', () => {
    root.classList.add('scrolling');
    clearTimeout(idle);
    idle = setTimeout(() => root.classList.remove('scrolling'), 800);
  }, true);
})();

// ─── State ────────────────────────────────────────────────────────────────────
let sourceTypes = [];
let sources = [];
let editingSourceId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  sourceTypes = await api.sources.types();
  await loadSources();
  await loadSettings();
  await loadLLMSettings();
  setupNavigation();
  setupEventListeners();
  populateSourceTypeDropdown();
  checkServerStatus();
  applyTheme();

  api.on.collectStart(() => setStatus('Collecting…'));
  api.on.collectComplete(({ succeeded, failed }) => {
    setStatus(`Updated — ${succeeded} source${succeeded !== 1 ? 's' : ''} refreshed`);
    loadSources();
  });
  api.on.collectError(({ name, error }) => showToast(`Error in ${name}: ${error}`, 'error'));
  api.on.navigate(tab => switchTab(tab));
  api.on.backupImported(() => { loadSources(); loadSettings(); showToast('Backup restored — reloading…'); });
  api.on.sourcesUpdated(() => loadSources());
  api.on.themeOsSync(({ theme }) => {
    document.body.classList.toggle('theme-light', theme === 'light');
    updateThemeButton(theme);
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const tab = document.getElementById(`tab-${tabId}`);
  if (tab) { tab.style.display = 'flex'; tab.style.flexDirection = 'column'; }
  const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  if (navItem) navItem.classList.add('active');
  if (tabId === 'extension') checkServerStatus();
  if (tabId === 'export') loadExportTab();
  if (tabId === 'health') loadHealthDashboard();
}

// ─── Sources ──────────────────────────────────────────────────────────────────
let sourceHealth = {};

async function loadSources() {
  [sources, sourceHealth] = await Promise.all([api.sources.list(), api.sources.getHealth()]);
  renderSourceList();
  document.getElementById('sourceBadge').textContent = sources.filter(s => s.enabled).length;
}

function renderSourceList() {
  const container = document.getElementById('sourceList');
  const visible = sources.filter(s => s.type !== 'web-capture');
  if (!visible.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">${icon('sources', 44)}</div>
      <h3>No sources yet</h3>
      <p>Add your first content source to get started</p>
      <button class="btn btn-primary" data-action="add-source">${icon('plus')} Add Source</button>
    </div>`;
    return;
  }
  container.innerHTML = sources.map(s => renderSourceCard(s)).join('');
}

function renderSourceCard(source) {
  const typeInfo = sourceTypes.find(t => t.id === source.type) || {};
  const typeIcon = getSourceIcon(source.type);
  const typeClass = `type-${source.type}`;
  const h = sourceHealth[source.id] || {};
  const healthHTML = renderHealthBadge(h, source);

  const ytUrl = source.config?.url || source.config?.channelUrl || '';
  const isPlaylist = source.type === 'youtube' && (ytUrl.includes('/playlist') || ytUrl.includes('list='));
  const playlistBadge = isPlaylist ? ' <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff6b6b;border:1px solid rgba(255,0,0,0.3);border-radius:4px;padding:1px 5px">Playlist</span>' : '';
  const muteBadge = source.ignoreMute ? ' <span style="font-size:10px;background:rgba(255,193,7,0.15);color:#ffc107;border:1px solid rgba(255,193,7,0.3);border-radius:4px;padding:1px 5px" title="Bypasses global mute words">Unmuted</span>' : '';

  return `<div class="source-card ${source.enabled ? '' : 'disabled'}" id="source-${source.id}">
    <div class="source-icon ${typeClass}">${typeIcon}</div>
    <div class="source-info">
      <div class="source-name">${escapeHTML(source.name)}${playlistBadge}${muteBadge}</div>
      <div class="source-meta">${typeInfo.label || source.type} · Max ${source.maxItems || 20} items${source.refreshInterval ? ` · ${icon('clock')} ${source.refreshInterval}m` : ''}</div>
      ${healthHTML}
    </div>
    <div class="source-actions">
      <span class="source-status pending" id="status-${source.id}">—</span>
      <button class="btn btn-ghost btn-sm btn-icon" title="Refresh now" aria-label="Refresh now" data-action="refresh" data-id="${source.id}">${icon('refresh')}</button>
      ${source.type !== 'web-capture' ? `<button class="btn btn-ghost btn-sm btn-icon" title="Edit" aria-label="Edit" data-action="edit" data-id="${source.id}">${icon('edit')}</button>` : ''}
      <label class="toggle" title="${source.enabled ? 'Disable' : 'Enable'}">
        <input type="checkbox" ${source.enabled ? 'checked' : ''} data-action="toggle" data-id="${source.id}">
        <span class="toggle-slider"></span>
      </label>
      <button class="btn btn-ghost btn-sm btn-icon" title="Delete" aria-label="Delete" data-action="delete" data-id="${source.id}">${icon('trash')}</button>
    </div>
  </div>`;
}

function renderHealthBadge(h, source) {
  if (!h.lastFetchedAt) return '';
  const ago = relativeTimeShort(h.lastFetchedAt);
  if (h.lastError) {
    return `<div class="source-health"><span class="health-err" title="${escapeHTML(h.lastError)}">${icon('warning')} Error · ${ago}</span></div>`;
  }
  const newTxt = h.lastNewCount != null ? ` · +${h.lastNewCount} new` : '';
  return `<div class="source-health"><span class="health-ok">${icon('check')} ${ago}${newTxt}</span></div>`;
}

function relativeTimeShort(dateStr) {
  if (!dateStr) return '';
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch { return ''; }
}

async function toggleSource(id, enabled) {
  await api.sources.toggle(id, enabled);
  await loadSources();
}

async function deleteSource(id) {
  const source = sources.find(s => s.id === id);
  if (!source || !confirm(`Delete "${source.name}"? Cached content will also be removed.`)) return;
  await api.sources.delete(id);
  await loadSources();
}

async function refreshSource(id) {
  const el = document.getElementById(`status-${id}`);
  if (el) { el.className = 'source-status running'; el.textContent = 'Running…'; }
  try {
    const count = await api.sources.collectOne(id);
    if (el) { el.className = 'source-status ok'; el.textContent = `+${count} new`; }
    setTimeout(() => { if (el) { el.className = 'source-status pending'; el.textContent = '—'; } }, 4000);
  } catch (e) {
    if (el) { el.className = 'source-status error'; el.textContent = 'Error'; }
    showToast(e.message, 'error');
  }
}

// ─── Add / Edit Source Modal ───────────────────────────────────────────────────
function openAddSource() {
  editingSourceId = null;
  document.getElementById('modalTitle').textContent = 'Add Source';
  document.getElementById('sourceName').value = '';
  document.getElementById('sourceType').value = '';
  document.getElementById('sourceMaxItems').value = '20';
  document.getElementById('sourceRefreshInterval').value = '0';
  document.getElementById('sourceIgnoreMute').checked = false;
  document.getElementById('sourceFields').innerHTML = '';
  document.getElementById('sourceTypeHint').textContent = '';
  document.getElementById('btnSaveSource').textContent = 'Add Source';
  showModal();
}

function openEditSource(id) {
  const source = sources.find(s => s.id === id);
  if (!source) return;
  editingSourceId = id;
  document.getElementById('modalTitle').textContent = 'Edit Source';
  document.getElementById('sourceName').value = source.name;
  document.getElementById('sourceType').value = source.type;
  document.getElementById('sourceMaxItems').value = source.maxItems || 20;
  document.getElementById('sourceRefreshInterval').value = source.refreshInterval || 0;
  document.getElementById('sourceIgnoreMute').checked = !!source.ignoreMute;
  document.getElementById('btnSaveSource').textContent = 'Save Changes';
  renderSourceFields(source.type, source.config || {});
  updateTypeHint(source.type);
  showModal();
}

function onSourceTypeChange() {
  const type = document.getElementById('sourceType').value;
  renderSourceFields(type, {});
  updateTypeHint(type);
}

function updateTypeHint(type) {
  const typeInfo = sourceTypes.find(t => t.id === type);
  document.getElementById('sourceTypeHint').textContent = typeInfo?.description || '';
}

function renderSourceFields(type, existing) {
  const typeInfo = sourceTypes.find(t => t.id === type);
  const container = document.getElementById('sourceFields');
  if (!typeInfo?.fields?.length) { container.innerHTML = ''; return; }

  container.innerHTML = typeInfo.fields.map(field => {
    const val = existing[field.key] !== undefined ? existing[field.key] : (field.default || '');
    if (field.type === 'select') {
      const opts = field.options.map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');
      return `<div class="form-group">
        <label class="form-label">${field.label}${field.required ? ' *' : ''}</label>
        <select class="select" data-field="${field.key}">${opts}</select>
      </div>`;
    }
    if (field.type === 'checkbox') {
      return `<div class="form-group" style="display:flex;align-items:center;justify-content:space-between">
        <label class="form-label" style="margin:0">${field.label}</label>
        <label class="toggle"><input type="checkbox" data-field="${field.key}" ${val ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>`;
    }
    // RSS/feed URL fields get a "Discover" button
    const isDiscoverableURL = field.key === 'url' && field.type === 'url' &&
      ['rss', 'podcast', 'newsletter', 'blog'].includes(type);

    if (isDiscoverableURL) {
      return `<div class="form-group">
        <label class="form-label">${field.label}${field.required ? ' *' : ''}</label>
        <div class="input-with-action">
          <input type="url" class="input" data-field="${field.key}" value="${escapeHTML(String(val))}" placeholder="${escapeHTML(field.placeholder || '')}">
          <button class="btn btn-secondary btn-sm btn-discover" data-discover-field="${field.key}" title="Auto-discover RSS feed from any webpage URL">${icon('search')} Discover</button>
        </div>
        ${field.hint ? `<div class="form-hint">${escapeHTML(field.hint)}</div>` : ''}
      </div>`;
    }

    return `<div class="form-group">
      <label class="form-label">${field.label}${field.required ? ' *' : ''}</label>
      <input type="${field.type}" class="input" data-field="${field.key}" value="${escapeHTML(String(val))}" placeholder="${escapeHTML(field.placeholder || '')}">
      ${field.hint ? `<div class="form-hint">${escapeHTML(field.hint)}</div>` : ''}
      ${field.type === 'password' ? '<div class="form-hint">Stored locally on this machine only</div>' : ''}
    </div>`;
  }).join('');
}

async function saveSource() {
  const type = document.getElementById('sourceType').value;
  const name = document.getElementById('sourceName').value.trim();
  const maxItems = parseInt(document.getElementById('sourceMaxItems').value) || 20;
  const refreshInterval = parseInt(document.getElementById('sourceRefreshInterval').value) || 0;
  const ignoreMute = document.getElementById('sourceIgnoreMute').checked;

  if (!type) { showToast('Please select a source type', 'error'); return; }
  if (!name) { showToast('Please enter a display name', 'error'); return; }

  // Validate required fields
  const typeInfo = sourceTypes.find(t => t.id === type);
  for (const field of (typeInfo?.fields || [])) {
    if (field.required) {
      const el = document.querySelector(`#sourceFields [data-field="${field.key}"]`);
      if (el && !el.value.trim()) {
        showToast(`${field.label} is required`, 'error');
        el.focus();
        return;
      }
    }
  }

  const config = {};
  document.querySelectorAll('#sourceFields [data-field]').forEach(el => {
    config[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });

  try {
    if (editingSourceId) {
      await api.sources.update(editingSourceId, { name, type, config, maxItems, refreshInterval, ignoreMute });
      showToast('Source updated');
    } else {
      await api.sources.add({ name, type, config, maxItems, refreshInterval, ignoreMute });
      showToast(`"${name}" added`);
    }
    closeModal();
    await loadSources();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function populateSourceTypeDropdown() {
  const sel = document.getElementById('sourceType');
  // Exclude web-capture (managed automatically by extension)
  const types = sourceTypes.filter(t => t.id !== 'web-capture');
  sel.innerHTML = '<option value="">Select a type…</option>' +
    types.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await api.settings.get();
  document.getElementById('settingInterval').value = s.refreshInterval || 30;
  document.getElementById('settingRunAtStartup').checked = s.runAtStartup === true;
  document.getElementById('settingCollectOnStartup').checked = s.collectOnStartup !== false;
  document.getElementById('settingMaxItems').value = s.maxItemsPerSource || 20;
  document.getElementById('settingRetentionDays').value = s.retentionDays || 3;
  document.getElementById('settingOutputFormat').value = s.outputFormat || 'html';
  document.getElementById('settingDigestBrowser').value = s.digestBrowser || 'internal';
  document.getElementById('settingDigestFontSize').value = s.display?.digestFontSize || 'medium';
  document.getElementById('settingAutoDigestEnabled').checked = !!s.autoDigest?.enabled;
  document.getElementById('settingAutoDigestTime').value = s.autoDigest?.time || '08:00';
  document.getElementById('settingNotifyEnabled').checked = s.notifications?.enabled !== false;
  document.getElementById('settingNotifyOnRefresh').checked = !!s.notifications?.onRefresh;
  document.getElementById('settingMuteWords').value = (s.muteWords || []).join(', ');
}

async function saveSettings() {
  const current = await api.settings.get();
  const muteRaw = document.getElementById('settingMuteWords').value;
  const muteWords = muteRaw.split(',').map(w => w.trim()).filter(Boolean);
  await api.settings.save({
    ...current,
    refreshInterval: parseInt(document.getElementById('settingInterval').value),
    runAtStartup: document.getElementById('settingRunAtStartup').checked,
    collectOnStartup: document.getElementById('settingCollectOnStartup').checked,
    maxItemsPerSource: parseInt(document.getElementById('settingMaxItems').value),
    retentionDays: parseInt(document.getElementById('settingRetentionDays').value) || 3,
    outputFormat: document.getElementById('settingOutputFormat').value,
    digestBrowser: document.getElementById('settingDigestBrowser').value,
    display: {
      ...(current.display || {}),
      digestFontSize: document.getElementById('settingDigestFontSize').value
    },
    muteWords,
    autoDigest: {
      enabled: document.getElementById('settingAutoDigestEnabled').checked,
      time: document.getElementById('settingAutoDigestTime').value || '08:00'
    },
    notifications: {
      enabled: document.getElementById('settingNotifyEnabled').checked,
      onRefresh: document.getElementById('settingNotifyOnRefresh').checked
    }
  });
  showToast('Settings saved');
}

// ─── LLM ──────────────────────────────────────────────────────────────────────
const MODEL_MAP = {
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  xai: ['grok-3', 'grok-3-fast', 'grok-3-mini'],
  ollama: ['llama3.2', 'llama3.1', 'mistral', 'phi3', 'gemma2'],
  custom: []
};

async function loadLLMSettings() {
  const s = await api.settings.get();
  const llm = s.llm || {};
  document.getElementById('llmEnabled').checked = !!llm.enabled;
  document.getElementById('llmProvider').value = llm.provider || 'anthropic';
  document.getElementById('llmApiKey').value = llm.apiKey || '';
  document.getElementById('llmBaseURL').value = llm.baseURL || '';
  document.getElementById('llmDigestPrompt').value = llm.digestPrompt || 'Summarize the following content items into a concise daily digest:';
  updateModelDropdown(llm.provider || 'anthropic', llm.model);
  updateCustomURLVisibility(llm.provider);
}

function updateModelDropdown(provider, selected) {
  const models = MODEL_MAP[provider] || [];
  const sel = document.getElementById('llmModel');
  sel.innerHTML = models.map(m => `<option value="${m}" ${m === selected ? 'selected' : ''}>${m}</option>`).join('');
}

function updateCustomURLVisibility(provider) {
  document.getElementById('customBaseURLGroup').style.display = provider === 'custom' ? 'block' : 'none';
}

// Read the current LLM form values into a config object.
function readLLMForm() {
  return {
    enabled:      document.getElementById('llmEnabled').checked,
    provider:     document.getElementById('llmProvider').value,
    model:        document.getElementById('llmModel').value,
    apiKey:       document.getElementById('llmApiKey').value.trim(),
    baseURL:      document.getElementById('llmBaseURL').value.trim(),
    digestPrompt: document.getElementById('llmDigestPrompt').value.trim()
  };
}

async function saveLLMSettings() {
  const current = await api.settings.get();
  await api.settings.save({ ...current, llm: readLLMForm() });
  showToast('LLM settings saved');
}

async function testLLM() {
  const btn = document.getElementById('btnTestLLM');
  const cfg = readLLMForm();
  btn.disabled = true; btn.textContent = 'Testing…';
  renderLLMTestResult({ state: 'loading' });
  try {
    // Persist exactly what we're testing so the key/model isn't lost.
    const current = await api.settings.get();
    await api.settings.save({ ...current, llm: cfg });
    const result = await api.llm.test(cfg);
    renderLLMTestResult({ state: 'success', result });
  } catch (e) {
    renderLLMTestResult({ state: 'error', message: e.message });
  } finally {
    btn.disabled = false; btn.textContent = 'Test Connection';
  }
}

// Render the persistent result panel below the LLM form.
function renderLLMTestResult({ state, result, message }) {
  const panel = document.getElementById('llmTestResult');
  if (!panel) return;
  panel.style.display = 'block';

  if (state === 'loading') {
    panel.className = 'llm-test-result loading';
    panel.innerHTML = '<span class="spinner"></span><span>Contacting the model…</span>';
    return;
  }
  if (state === 'success') {
    panel.className = 'llm-test-result success';
    panel.innerHTML =
      `<div class="ltr-head">${icon('check')} Connection successful</div>` +
      `<div class="ltr-meta">${escapeHTML(result.provider)} · ${escapeHTML(result.model)} · ${result.latencyMs} ms</div>` +
      `<div class="ltr-reply"><span class="ltr-label">Model replied:</span> ${escapeHTML(result.reply)}</div>`;
    return;
  }
  panel.className = 'llm-test-result error';
  panel.innerHTML =
    `<div class="ltr-head">${icon('warning')} Connection failed</div>` +
    `<div class="ltr-reply">${escapeHTML(message)}</div>`;
}

// ─── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme() {
  api.settings.get().then(s => {
    const theme = s.display?.theme || 'dark';
    document.body.classList.toggle('theme-light', theme === 'light');
    updateThemeButton(theme);
  });
}

function updateThemeButton(theme) {
  const btn = document.getElementById('btnThemeToggle');
  if (btn) btn.innerHTML = theme === 'light'
    ? `${icon('moon')} <span class="theme-label">Dark Mode</span>`
    : `${icon('sun')} <span class="theme-label">Light Mode</span>`;
}

async function toggleTheme() {
  const s = await api.settings.get();
  const newTheme = (s.display?.theme || 'dark') === 'dark' ? 'light' : 'dark';
  // Mark as pinned so OS sync won't override the user's explicit choice
  await api.settings.save({ ...s, display: { ...(s.display || {}), theme: newTheme, themePinned: true } });
  document.body.classList.toggle('theme-light', newTheme === 'light');
  updateThemeButton(newTheme);
}

// ─── Digest History ────────────────────────────────────────────────────────────
async function loadExportTab() {
  const s = await api.settings.get();
  const sel = document.getElementById('settingHistoryMaxCount');
  if (sel) sel.value = String(s.historyMaxCount || 10);
  await loadHistory();
}

async function saveHistorySettings() {
  const current = await api.settings.get();
  await api.settings.save({
    ...current,
    historyMaxCount: parseInt(document.getElementById('settingHistoryMaxCount').value) || 10
  });
  showToast('History settings saved');
}

async function loadHistory() {
  const el = document.getElementById('historyList');
  if (!el) return;
  const history = await api.digest.getHistory();
  if (!history.length) {
    el.innerHTML = '<div style="color:var(--text-disabled);font-size:12px">No digest history yet — generate a digest to start the archive.</div>';
    return;
  }
  el.innerHTML = history.map(h => `
    <div class="history-item">
      <span class="history-label">${escapeHTML(h.label)}</span>
      <span class="history-ext">${escapeHTML(h.ext)}</span>
      <button class="btn btn-secondary btn-sm" data-open-history="${escapeHTML(h.path)}">Open</button>
    </div>`).join('');
  el.querySelectorAll('[data-open-history]').forEach(btn => {
    btn.addEventListener('click', () => api.digest.openHistory(btn.dataset.openHistory));
  });
}

// ─── Health Dashboard ─────────────────────────────────────────────────────────
async function loadHealthDashboard() {
  const container = document.getElementById('healthList');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><span class="spinner"></span><p>Loading…</p></div>';

  const [allSources, health] = await Promise.all([api.sources.list(), api.sources.getHealth()]);

  if (!allSources.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('health', 44)}</div><h3>No sources</h3><p>Add sources to see health metrics</p></div>`;
    return;
  }

  container.innerHTML = allSources.map(source => {
    const h = health[source.id] || {};
    const typeIcon = getSourceIcon(source.type);
    const ago = h.lastFetchedAt ? relativeTimeShort(h.lastFetchedAt) : 'Never';
    const hasError = !!h.lastError;
    const statusColor = !h.lastFetchedAt ? 'var(--text-disabled)' : hasError ? 'var(--red)' : '#6ccb5f';
    const statusIcon = !h.lastFetchedAt ? icon('circle') : hasError ? icon('close') : icon('check');

    const metrics = [
      { label: 'Last Fetch',  value: ago },
      { label: 'New Items',   value: h.lastNewCount != null ? `+${h.lastNewCount}` : '—' },
      { label: 'Cached',      value: h.totalCached != null ? h.totalCached : '—' },
      { label: 'Status',      value: hasError ? 'Error' : (h.lastFetchedAt ? 'OK' : 'Pending') }
    ];

    return `<div class="source-card" style="flex-direction:column;gap:10px;align-items:stretch">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="source-icon type-${source.type}">${typeIcon}</div>
        <div class="source-info" style="flex:1;min-width:0">
          <div class="source-name">${escapeHTML(source.name)}</div>
          <div class="source-meta">${source.type}${source.enabled ? '' : ' · <span style="color:var(--text-disabled)">disabled</span>'}</div>
        </div>
        <span style="font-size:16px;color:${statusColor}" title="${hasError ? escapeHTML(h.lastError) : 'OK'}">${statusIcon}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${metrics.map(m => `<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:10px;color:var(--text-disabled);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${m.label}</div>
          <div style="font-size:13px;font-weight:500;color:${m.label==='Status'&&hasError?'var(--red)':m.label==='Status'&&h.lastFetchedAt?'#6ccb5f':'var(--text)'}">${m.value}</div>
        </div>`).join('')}
      </div>
      ${hasError ? `<div style="background:rgba(209,52,56,0.1);border:1px solid rgba(209,52,56,0.3);border-radius:6px;padding:8px;font-size:11px;color:#fc8c8c">${icon('warning')} ${escapeHTML(h.lastError)}</div>` : ''}
    </div>`;
  }).join('');
}

// ─── RSS Discover ──────────────────────────────────────────────────────────────
async function handleDiscoverFeed(fieldKey) {
  const input = document.querySelector(`#sourceFields [data-field="${fieldKey}"]`);
  if (!input || !input.value.trim()) { showToast('Enter a URL first', 'error'); return; }
  const btn = document.querySelector(`[data-discover-field="${fieldKey}"]`);
  const origHTML = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const feedUrl = await api.sources.discoverFeed(input.value.trim());
    if (feedUrl) {
      input.value = feedUrl;
      showToast('Feed discovered!');
    } else {
      showToast('No RSS feed found at that URL', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = origHTML;
  }
}

// ─── Export ────────────────────────────────────────────────────────────────────
async function exportAgentPack(scriptOnly) {
  try {
    await api.ui.exportAgentPlatform();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Extension / Server status ────────────────────────────────────────────────
function statusDot(color) {
  return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>`;
}

async function checkServerStatus() {
  const el = document.getElementById('serverStatus');
  if (!el) return;
  try {
    const res = await fetch('http://localhost:7828/status');
    const data = await res.json();
    if (data.ok) {
      el.innerHTML = `${statusDot('#6ccb5f')}<span style="color:#6ccb5f">Running on port 7828</span>`;
    } else {
      el.innerHTML = `${statusDot('#fc5353')}<span style="color:#fc5353">Not responding</span>`;
    }
  } catch {
    el.innerHTML = `${statusDot('#fc5353')}<span style="color:#fc5353">Not reachable — is PulseKeeper running?</span>`;
  }
}

// ─── Modal ─────────────────────────────────────────────────────────────────────
function showModal() {
  const overlay = document.getElementById('addSourceModal');
  overlay.style.display = 'flex';
  // Force reflow so the CSS transition fires correctly
  overlay.offsetHeight; // eslint-disable-line no-unused-expressions
  overlay.classList.add('visible');
}

function closeModal() {
  const overlay = document.getElementById('addSourceModal');
  overlay.classList.remove('visible');
  setTimeout(() => { overlay.style.display = 'none'; }, 280);
}

// ─── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('btnAddSource').addEventListener('click', openAddSource);
  document.getElementById('btnImportOPML').addEventListener('click', async () => {
    try {
      const result = await api.sources.importOPML();
      if (result?.imported > 0) {
        showToast(`${result.imported} feed${result.imported !== 1 ? 's' : ''} imported from OPML`);
        await loadSources();
      } else {
        showToast('No feeds found in that OPML file', 'error');
      }
    } catch (e) { showToast(e.message, 'error'); }
  });
  document.getElementById('btnRefreshAll').addEventListener('click', async () => {
    setStatus('Collecting all sources…', true);
    try {
      const r = await api.sources.collectAll();
      showToast(`${r.succeeded} source${r.succeeded !== 1 ? 's' : ''} refreshed${r.failed ? `, ${r.failed} failed` : ''}`);
    } catch (e) {
      showToast(e.message, 'error');
    } finally { setStatus('Ready', false); }
  });
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnRefreshHealth').addEventListener('click', loadHealthDashboard);
  document.getElementById('btnSaveHistorySettings').addEventListener('click', saveHistorySettings);
  document.getElementById('btnSaveSource').addEventListener('click', saveSource);
  document.getElementById('btnSaveLLM').addEventListener('click', saveLLMSettings);
  document.getElementById('btnTestLLM').addEventListener('click', testLLM);

  document.getElementById('llmProvider').addEventListener('change', e => {
    updateModelDropdown(e.target.value, null);
    updateCustomURLVisibility(e.target.value);
  });

  // Source list — delegated click and change handlers
  const sourceList = document.getElementById('sourceList');
  sourceList.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'refresh') refreshSource(id);
    else if (action === 'edit') openEditSource(id);
    else if (action === 'delete') deleteSource(id);
    else if (action === 'add-source') openAddSource();
  });
  sourceList.addEventListener('change', e => {
    const inp = e.target.closest('[data-action="toggle"]');
    if (inp) toggleSource(inp.dataset.id, inp.checked);
  });

  // Discover feed button (delegated — modal rebuilds dynamically)
  document.getElementById('sourceFields').addEventListener('click', e => {
    const btn = e.target.closest('[data-discover-field]');
    if (btn) handleDiscoverFeed(btn.dataset.discoverField);
  });

  // Theme toggle
  document.getElementById('btnThemeToggle').addEventListener('click', toggleTheme);

  // Backup buttons
  document.getElementById('btnExportBackup').addEventListener('click', async () => {
    try { await api.settings.exportBackup(); }
    catch (e) { showToast(e.message, 'error'); }
  });
  document.getElementById('btnImportBackup').addEventListener('click', async () => {
    try { await api.settings.importBackup(); }
    catch (e) { showToast(e.message, 'error'); }
  });

  // Close modal on overlay click or Escape
  document.getElementById('addSourceModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); return; }
    // Don't fire shortcuts when typing in an input/textarea
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey && e.key === 'r') { e.preventDefault(); document.getElementById('btnRefreshAll').click(); }
    if (e.ctrlKey && e.key === 'e') { e.preventDefault(); api.output.openDigest(); }
    if (e.ctrlKey && e.key === ',') { e.preventDefault(); switchTab('settings'); }
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openAddSource(); }
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(text) {
  document.getElementById('statusBar').textContent = text;
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getSourceIcon(type) {
  return icon(type);
}

// ─── Boot ──────────────────────────────────────────────────────────────────────
init();
