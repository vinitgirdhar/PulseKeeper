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
let llmKeys = {};
// Per-provider memory so switching providers never wipes another provider's
// endpoint or model. Mirrors llmKeys. Persisted as llm.baseURLs / llm.models.
let llmBaseURLs = {};
let llmModels = {};
let llmKnowledgeMaxWords = 600;  // carried through readLLMForm (no dedicated UI field)

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  sourceTypes = await api.sources.types();
  await loadSources();
  await loadFeed();
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
    loadFeed();
  });
  api.on.collectError(({ name, error }) => showToast(`Error in ${name}: ${error}`, 'error'));
  api.on.navigate(tab => switchTab(tab));
  api.on.backupImported(() => { loadSources(); loadSettings(); showToast('Backup restored — reloading…'); });
  api.on.sourcesUpdated(() => loadSources());
  api.on.themeOsSync(({ theme }) => {
    document.body.classList.toggle('theme-light', theme === 'light');
    updateThemeButton(theme);
  });
  // AI digest generation progress (scheduled, on-open, or manual).
  api.on.digestGenerating(d => setDigestGenerating(d.model, d.startedAt));
  api.on.digestProgress(d => setDigestProgress(d));
  api.on.digestGenerated(() => { hideDigestProgress(); refreshDigestStatus(); refreshKnowledgeMeta(); showToast('AI digest ready'); });
  api.on.digestError(d => { hideDigestProgress(); refreshDigestStatus(); showToast(`AI digest failed: ${d.message}`, 'error'); });
  // Keep the "updated X ago" label fresh, but never while a generation spinner is running.
  setInterval(() => { if (!digestElapsedTimer) refreshDigestStatus(); }, 60000);
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
  if (tabId === 'feed') loadFeed();
  if (tabId === 'threats') loadThreats();
}

// ─── Sources ──────────────────────────────────────────────────────────────────
let sourceHealth = {};
let sourceFilter = 'all';
let sourceSearch = '';

async function loadSources() {
  [sources, sourceHealth] = await Promise.all([api.sources.list(), api.sources.getHealth()]);
  renderSourceList();
  document.getElementById('sourceBadge').textContent = sources.filter(s => s.enabled).length;
}

function renderSourceFilters() {
  const row = document.getElementById('sourceFilters');
  if (!row) return;
  const types = [...new Set(sources.map(s => s.type))];
  // Reset if the active filter's last source was deleted
  if (sourceFilter !== 'all' && !types.includes(sourceFilter)) sourceFilter = 'all';
  const chips = [`<button class="feed-chip ${sourceFilter === 'all' ? 'active' : ''}" data-filter="all">All <span class="chip-count">${sources.length}</span></button>`];
  for (const t of types) {
    const n = sources.filter(s => s.type === t).length;
    chips.push(`<button class="feed-chip ${sourceFilter === t ? 'active' : ''}" data-filter="${t}">${getSourceIcon(t)} ${escapeHTML(t)} <span class="chip-count">${n}</span></button>`);
  }
  row.innerHTML = chips.join('');
}

function getFilteredSources() {
  let f = sourceFilter === 'all' ? sources : sources.filter(s => s.type === sourceFilter);
  if (sourceSearch) {
    f = f.filter(s => {
      const url = s.config?.url || s.config?.repoUrl || s.config?.subreddit || s.config?.channelName || '';
      return (s.name || '').toLowerCase().includes(sourceSearch) || url.toLowerCase().includes(sourceSearch);
    });
  }
  return f;
}

function renderSourceList() {
  renderSourceFilters();
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
  const filtered = getFilteredSources();
  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">${icon('search', 44)}</div>
      <h3>No matches</h3>
      <p>No sources match the current filter${sourceSearch ? ' and search' : ''}</p>
    </div>`;
    return;
  }
  container.innerHTML = filtered.map(s => renderSourceCard(s)).join('');
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
  document.getElementById('sourceCategory').value = '';
  populateCategoryDatalist();
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
  document.getElementById('sourceCategory').value = source.category || '';
  populateCategoryDatalist();
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
  const category = document.getElementById('sourceCategory').value.trim();
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
      await api.sources.update(editingSourceId, { name, type, category, config, maxItems, refreshInterval, ignoreMute });
      showToast('Source updated');
    } else {
      await api.sources.add({ name, type, category, config, maxItems, refreshInterval, ignoreMute });
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

// Fill the source-modal category <datalist> with names already in use on
// sources plus any categories defined for per-category digests, so the user can
// pick a consistent name instead of retyping it.
async function populateCategoryDatalist() {
  const dl = document.getElementById('categoryOptions');
  if (!dl) return;
  const names = new Set();
  for (const s of (sources || [])) {
    if (s.category && s.category.trim()) names.add(s.category.trim());
  }
  try {
    const settings = await api.settings.get();
    for (const c of (settings.llm?.categories || [])) {
      if (c && c.name && c.name.trim()) names.add(c.name.trim());
    }
  } catch {}
  dl.innerHTML = [...names].sort().map(n => `<option value="${escapeHTML(n)}"></option>`).join('');
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
  document.getElementById('settingAutoDigestMode').value = s.autoDigest?.mode || 'interval';
  document.getElementById('settingAutoDigestHours').value = s.autoDigest?.everyHours || 8;
  document.getElementById('settingAutoDigestTime').value = s.autoDigest?.time || '08:00';
  updateAutoDigestModeVisibility();
  document.getElementById('settingNotifyEnabled').checked = s.notifications?.enabled !== false;
  document.getElementById('settingNotifyOnRefresh').checked = !!s.notifications?.onRefresh;
  document.getElementById('settingMuteWords').value = (s.muteWords || []).join(', ');
  const iocEl = document.getElementById('settingIocExtraction');
  if (iocEl) iocEl.checked = s.security?.iocExtraction !== false;
}

// Show the hours field for interval mode, the time field for daily mode.
function updateAutoDigestModeVisibility() {
  const mode = document.getElementById('settingAutoDigestMode').value;
  document.getElementById('autoDigestIntervalGroup').style.display = mode === 'interval' ? 'block' : 'none';
  document.getElementById('autoDigestTimeGroup').style.display = mode === 'daily' ? 'block' : 'none';
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
      mode: document.getElementById('settingAutoDigestMode').value || 'interval',
      everyHours: Math.min(24, Math.max(1, parseInt(document.getElementById('settingAutoDigestHours').value, 10) || 8)),
      time: document.getElementById('settingAutoDigestTime').value || '08:00'
    },
    notifications: {
      enabled: document.getElementById('settingNotifyEnabled').checked,
      onRefresh: document.getElementById('settingNotifyOnRefresh').checked
    },
    security: {
      ...(current.security || {}),
      iocExtraction: document.getElementById('settingIocExtraction')?.checked !== false
    }
  });
  showToast('Settings saved');
}

// ─── LLM ──────────────────────────────────────────────────────────────────────
const MODEL_MAP = {
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  xai: ['grok-3', 'grok-3-fast', 'grok-3-mini'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'gemma2-9b-it', 'deepseek-r1-distill-llama-70b'],
  ollama: ['llama3.2', 'llama3.1', 'mistral', 'phi3', 'gemma2'],
  custom: []
};

// Providers that take a free-text model name + an editable host/base URL
// (local-ish endpoints whose model list we can't know ahead of time).
function llmUsesModelInput(provider) { return provider === 'custom' || provider === 'ollama'; }
function llmUsesBaseURL(provider)    { return provider === 'custom' || provider === 'ollama'; }

async function loadLLMSettings() {
  const s = await api.settings.get();
  const llm = s.llm || {};

  // Set up per-provider maps
  llmKeys = llm.apiKeys || {};
  llmBaseURLs = llm.baseURLs || {};
  llmModels = llm.models || {};

  const currentProvider = llm.provider || 'anthropic';

  // Backward compatibility: seed the active provider's slots from the legacy
  // single fields so older settings.json files don't lose their config.
  if (llm.apiKey && !llmKeys[currentProvider]) llmKeys[currentProvider] = llm.apiKey;
  if (llm.baseURL && !llmBaseURLs[currentProvider]) llmBaseURLs[currentProvider] = llm.baseURL;
  if (llm.model && !llmModels[currentProvider]) llmModels[currentProvider] = llm.model;

  document.getElementById('llmEnabled').checked = !!llm.enabled;
  document.getElementById('llmProvider').value = currentProvider;
  document.getElementById('llmApiKey').value = llmKeys[currentProvider] || '';
  document.getElementById('llmBaseURL').value = llm.baseURL || '';
  document.getElementById('llmTimeout').value = llm.timeoutMs ? Math.round(llm.timeoutMs / 1000) : 900;
  document.getElementById('llmMaxItems').value = llm.maxItems || 50;
  document.getElementById('llmDigestPrompt').value = llm.digestPrompt || 'Summarize the following content items into a concise daily digest:';
  document.getElementById('llmSeverityScoring').checked = !!llm.severityScoring;
  document.getElementById('llmCategoryDigests').checked = !!llm.categoryDigests;
  renderCategoryRows(llm.categories || []);
  updateCategoriesVisibility();

  document.getElementById('llmKnowledgeEnabled').checked = !!llm.knowledgeEnabled;
  llmKnowledgeMaxWords = Number(llm.knowledgeMaxWords) > 0 ? Number(llm.knowledgeMaxWords) : 600;
  updateKnowledgeVisibility();
  refreshKnowledgeMeta();

  const freeText = llmUsesModelInput(currentProvider);
  document.getElementById('llmModelSelectGroup').style.display = freeText ? 'none' : 'block';
  document.getElementById('llmModelInputGroup').style.display = freeText ? 'block' : 'none';
  if (freeText) {
    document.getElementById('llmModelInput').value = llm.model || '';
  } else {
    updateModelDropdown(currentProvider, llm.model);
  }

  updateCustomURLVisibility(currentProvider);
  updateActiveProviderIndicator(s);
  refreshDigestStatus();
}

function updateActiveProviderIndicator(settings) {
  const indicator = document.getElementById('llmActiveIndicator');
  if (!indicator) return;

  const llm = settings?.llm || {};
  if (!llm.enabled) {
    indicator.className = 'llm-active-banner disabled';
    indicator.innerHTML = `${icon('info')} Active Config: None (AI / LLM is disabled)`;
    indicator.style.display = 'flex';
    return;
  }

  indicator.className = 'llm-active-banner';
  const provider = llm.provider || 'anthropic';
  
  const providerNames = {
    anthropic: 'Anthropic (Claude)',
    openai: 'OpenAI',
    gemini: 'Google (Gemini)',
    xai: 'xAI (Grok)',
    groq: 'Groq',
    ollama: 'Ollama (Local)',
    custom: 'Custom endpoint'
  };
  const providerLabel = providerNames[provider] || provider;

  if (provider === 'ollama') {
    const url = llm.baseURL || 'http://localhost:11434/v1';
    indicator.innerHTML = `${icon('check')} Active Config: ${providerLabel} (${url})`;
  } else if (provider === 'custom') {
    const url = llm.baseURL || 'no URL configured';
    indicator.innerHTML = `${icon('check')} Active Config: ${providerLabel} (${url})`;
  } else {
    const rawKey = llm.apiKey || '';
    let maskedKey = 'No key configured';
    if (rawKey) {
      if (rawKey.length <= 8) {
        maskedKey = '••••••••';
      } else {
        maskedKey = rawKey.slice(0, 5) + '…' + rawKey.slice(-4);
      }
    }
    indicator.innerHTML = `${icon('check')} Active Config: ${providerLabel} (Key: ${maskedKey})`;
  }
  indicator.style.display = 'flex';
}

function updateModelDropdown(provider, selected) {
  const models = MODEL_MAP[provider] || [];
  const sel = document.getElementById('llmModel');
  sel.innerHTML = models.map(m => `<option value="${m}" ${m === selected ? 'selected' : ''}>${m}</option>`).join('');
}

function updateCustomURLVisibility(provider) {
  document.getElementById('customBaseURLGroup').style.display = llmUsesBaseURL(provider) ? 'block' : 'none';
  const hint = document.getElementById('llmBaseURLHint');
  if (hint) hint.style.display = provider === 'ollama' ? 'block' : 'none';
}

// Read the current LLM form values into a config object.
function readLLMForm() {
  const provider = document.getElementById('llmProvider').value;
  const key = document.getElementById('llmApiKey').value.trim();
  const baseURL = document.getElementById('llmBaseURL').value.trim();
  const model = llmUsesModelInput(provider)
    ? document.getElementById('llmModelInput').value.trim()
    : document.getElementById('llmModel').value;
  // Remember this provider's values so a later switch-and-return restores them.
  if (provider) {
    llmKeys[provider] = key;
    llmBaseURLs[provider] = baseURL;
    llmModels[provider] = model;
  }
  const timeoutSec = parseInt(document.getElementById('llmTimeout').value, 10);
  const maxItems = parseInt(document.getElementById('llmMaxItems').value, 10);
  return {
    enabled:      document.getElementById('llmEnabled').checked,
    provider:     provider,
    model:        model,
    apiKey:       key,
    apiKeys:      llmKeys,
    baseURL:      baseURL,
    baseURLs:     llmBaseURLs,
    models:       llmModels,
    timeoutMs:    Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 900000,
    maxItems:     Number.isFinite(maxItems) && maxItems > 0 ? maxItems : 50,
    digestPrompt: document.getElementById('llmDigestPrompt').value.trim(),
    severityScoring: document.getElementById('llmSeverityScoring').checked,
    categoryDigests: document.getElementById('llmCategoryDigests').checked,
    categories:   readCategoryRows(),
    knowledgeEnabled: document.getElementById('llmKnowledgeEnabled').checked,
    knowledgeMaxWords: llmKnowledgeMaxWords
  };
}

// ─── Model memory (knowledge base) ────────────────────────────────────────────
function updateKnowledgeVisibility() {
  const on = document.getElementById('llmKnowledgeEnabled').checked;
  document.getElementById('llmKnowledgePanel').style.display = on ? 'block' : 'none';
}

async function refreshKnowledgeMeta() {
  const meta = document.getElementById('llmKnowledgeMeta');
  if (!meta) return;
  try {
    const k = await api.llm.getKnowledge();
    const words = k.text ? k.text.trim().split(/\s+/).filter(Boolean).length : 0;
    if (!words) {
      meta.innerHTML = `${icon('ai')} Model memory: <strong>empty</strong> — grows after the first digest`;
    } else {
      const rel = k.updatedAt ? timeAgo(k.updatedAt) : 'recently';
      meta.innerHTML = `${icon('ai')} Model memory: <strong>${k.digestCount || 0}</strong> digest${(k.digestCount === 1 ? '' : 's')} · <strong>~${words}</strong> words · updated ${escapeHTML(rel)}`;
    }
    // Keep an open viewer in sync
    const ta = document.getElementById('llmKnowledgeText');
    if (ta && ta.style.display !== 'none') ta.value = k.text || '';
  } catch {}
}

async function toggleKnowledgeView() {
  const ta = document.getElementById('llmKnowledgeText');
  if (!ta) return;
  if (ta.style.display === 'none') {
    try { ta.value = (await api.llm.getKnowledge()).text || '(empty)'; } catch { ta.value = '(unavailable)'; }
    ta.style.display = 'block';
  } else {
    ta.style.display = 'none';
  }
}

async function clearKnowledge() {
  if (!confirm('Clear the model memory? The model will start learning again from the next digest.')) return;
  try {
    await api.llm.clearKnowledge();
    const ta = document.getElementById('llmKnowledgeText');
    if (ta) { ta.value = ''; ta.style.display = 'none'; }
    refreshKnowledgeMeta();
    showToast('Model memory cleared');
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── Per-category digest editor ───────────────────────────────────────────────
function updateCategoriesVisibility() {
  const on = document.getElementById('llmCategoryDigests').checked;
  document.getElementById('llmCategoriesGroup').style.display = on ? 'block' : 'none';
}

function renderCategoryRows(categories) {
  const list = document.getElementById('llmCategoriesList');
  list.innerHTML = '';
  if (categories && categories.length) {
    categories.forEach(c => addCategoryRow(c.name, c.prompt));
  }
}

// Append one editable {name, prompt} row to the category editor.
function addCategoryRow(name = '', prompt = '') {
  const list = document.getElementById('llmCategoriesList');
  const row = document.createElement('div');
  row.className = 'category-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:8px';
  row.innerHTML = `
    <input type="text" class="input category-name" placeholder="Category name (e.g. Threat Intel)"
      value="${escapeHTML(name)}" style="flex:0 0 200px">
    <textarea class="textarea category-prompt" rows="2" placeholder="Prompt for this category…"
      style="flex:1">${escapeHTML(prompt)}</textarea>
    <button class="btn btn-secondary btn-sm category-remove" type="button" title="Remove category">${icon('trash')}</button>`;
  row.querySelector('.category-remove').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

// Read the category editor back into [{ name, prompt }], dropping unnamed rows.
function readCategoryRows() {
  return [...document.querySelectorAll('#llmCategoriesList .category-row')]
    .map(row => ({
      name: row.querySelector('.category-name').value.trim(),
      prompt: row.querySelector('.category-prompt').value.trim()
    }))
    .filter(c => c.name);
}

async function saveLLMSettings() {
  const current = await api.settings.get();
  const newLLM = readLLMForm();
  const updatedSettings = { ...current, llm: newLLM };
  await api.settings.save(updatedSettings);
  updateActiveProviderIndicator(updatedSettings);
  refreshDigestStatus();
  showToast('LLM settings saved');
}

// ─── AI Digest status / generation spinner ────────────────────────────────────
let digestElapsedTimer = null;

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Human-friendly relative time, e.g. "just now", "10 min ago", "1 hour ago".
function timeAgo(date) {
  const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (!isFinite(sec)) return '';
  if (sec < 45) return 'just now';
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function setDigestGenerating(model, startedAt) {
  const el = document.getElementById('llmDigestStatus');
  if (!el) return;
  const start = startedAt || Date.now();
  const tick = () => {
    el.className = 'llm-digest-status generating';
    el.innerHTML = `<span class="spinner"></span><span>Generating with <strong>${escapeHTML(model || 'the model')}</strong>… ${fmtElapsed(Date.now() - start)}</span>`;
  };
  tick();
  if (digestElapsedTimer) clearInterval(digestElapsedTimer);
  digestElapsedTimer = setInterval(tick, 1000);
  const btn = document.getElementById('btnGenerateDigestNow');
  if (btn) btn.disabled = true;
  // Show an indeterminate bar immediately; step events make it determinate.
  showDigestProgress();
}

// ─── AI digest progress bar ───────────────────────────────────────────────────
function showDigestProgress() {
  const wrap = document.getElementById('llmDigestProgress');
  if (!wrap) return;
  wrap.style.display = 'block';
  wrap.classList.add('indeterminate');
  document.getElementById('llmDigestProgressFill').style.width = '';
  document.getElementById('llmDigestProgressLabel').textContent = 'Starting…';
}

function setDigestProgress({ current, total, label }) {
  const wrap = document.getElementById('llmDigestProgress');
  if (!wrap) return;
  wrap.style.display = 'block';
  if (total > 0) {
    wrap.classList.remove('indeterminate');
    const pct = Math.round((current / total) * 100);
    document.getElementById('llmDigestProgressFill').style.width = pct + '%';
    document.getElementById('llmDigestProgressLabel').textContent =
      `${label || 'Working…'} (step ${current} of ${total})`;
  } else {
    wrap.classList.add('indeterminate');
    document.getElementById('llmDigestProgressLabel').textContent = label || 'Working…';
  }
}

function hideDigestProgress() {
  const wrap = document.getElementById('llmDigestProgress');
  if (!wrap) return;
  wrap.style.display = 'none';
  wrap.classList.remove('indeterminate');
}

function stopDigestTimer() {
  if (digestElapsedTimer) { clearInterval(digestElapsedTimer); digestElapsedTimer = null; }
  const btn = document.getElementById('btnGenerateDigestNow');
  if (btn) btn.disabled = false;
}

function setDigestIdle(cache) {
  const el = document.getElementById('llmDigestStatus');
  if (!el) return;
  stopDigestTimer();
  hideDigestProgress();
  if (!cache || (!cache.generatedAt && !cache.error)) {
    el.className = 'llm-digest-status';
    el.innerHTML = `${icon('info')} No AI digest generated yet.`;
    return;
  }
  if (cache.error && !cache.hasSummary) {
    el.className = 'llm-digest-status error';
    el.innerHTML = `${icon('warning')} Last attempt failed: ${escapeHTML(cache.error)}`;
    return;
  }
  const abs = cache.generatedAt ? new Date(cache.generatedAt).toLocaleString() : '';
  const rel = cache.generatedAt ? timeAgo(cache.generatedAt) : 'unknown time';
  let html = `${icon('check')} Updated <span title="${escapeHTML(abs)}">${escapeHTML(rel)}</span>` + (cache.model ? ` with <strong>${escapeHTML(cache.model)}</strong>` : '');
  if (cache.error) html += `<br><span class="form-hint">Latest refresh failed: ${escapeHTML(cache.error)}</span>`;
  el.className = 'llm-digest-status ok';
  el.innerHTML = html;
}

async function refreshDigestStatus() {
  try {
    const st = await api.llm.getDigestStatus();
    if (st.inProgress) setDigestGenerating(st.model, st.startedAt);
    else setDigestIdle(st.cache);
  } catch {}
}

async function generateDigestNow() {
  // Persist the current form first so generation uses the latest host/model/timeout.
  try {
    const current = await api.settings.get();
    await api.settings.save({ ...current, llm: readLLMForm() });
  } catch {}
  setDigestGenerating(readLLMForm().model, Date.now());
  try {
    const res = await api.llm.generateDigestNow();
    if (res && res.ok === false && res.error) {
      stopDigestTimer();
      const el = document.getElementById('llmDigestStatus');
      if (el) { el.className = 'llm-digest-status error'; el.innerHTML = `${icon('warning')} ${escapeHTML(res.error)}`; }
      showToast(res.error, 'error');
    }
  } catch (e) {
    stopDigestTimer();
    showToast(e.message, 'error');
  } finally {
    refreshDigestStatus();
  }
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
      <div data-health-toggle="${source.id}" title="Click to view the items fetched from this source" style="display:flex;align-items:center;gap:10px;cursor:pointer">
        <div class="source-icon type-${source.type}">${typeIcon}</div>
        <div class="source-info" style="flex:1;min-width:0">
          <div class="source-name">${escapeHTML(source.name)}</div>
          <div class="source-meta">${source.type}${source.enabled ? '' : ' · <span style="color:var(--text-disabled)">disabled</span>'}</div>
        </div>
        <span style="font-size:16px;color:${statusColor}" title="${hasError ? escapeHTML(h.lastError) : 'OK'}">${statusIcon}</span>
        <span data-health-caret="${source.id}" style="color:var(--text-disabled);transition:transform .15s">${icon('chevron', 14)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${metrics.map(m => `<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:10px;color:var(--text-disabled);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${m.label}</div>
          <div style="font-size:13px;font-weight:500;color:${m.label==='Status'&&hasError?'var(--red)':m.label==='Status'&&h.lastFetchedAt?'#6ccb5f':'var(--text)'}">${m.value}</div>
        </div>`).join('')}
      </div>
      ${hasError ? `<div style="background:rgba(209,52,56,0.1);border:1px solid rgba(209,52,56,0.3);border-radius:6px;padding:8px;font-size:11px;color:#fc8c8c">${icon('warning')} ${escapeHTML(h.lastError)}</div>` : ''}
      <div data-health-items="${source.id}" style="display:none"></div>
    </div>`;
  }).join('');

  // Delegated (assignment, not addEventListener — re-renders must not stack handlers)
  container.onclick = (e) => {
    const row = e.target.closest('[data-health-url]');
    if (row) { if (row.dataset.healthUrl) api.ui.openExternal(row.dataset.healthUrl); return; }
    const head = e.target.closest('[data-health-toggle]');
    if (head) toggleHealthItems(head.dataset.healthToggle);
  };
}

// Expand a health card to show exactly what items were fetched from that source
async function toggleHealthItems(sourceId) {
  const panel = document.querySelector(`[data-health-items="${CSS.escape(sourceId)}"]`);
  const caret = document.querySelector(`[data-health-caret="${CSS.escape(sourceId)}"]`);
  if (!panel) return;

  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (caret) caret.style.transform = isOpen ? '' : 'rotate(90deg)';
  if (isOpen || panel.dataset.loaded) return;

  panel.innerHTML = '<div style="padding:10px;text-align:center"><span class="spinner"></span></div>';
  let items = [];
  try { items = await api.content.getBySource(sourceId); }
  catch (e) { panel.innerHTML = `<div style="padding:8px;font-size:11px;color:var(--red)">${escapeHTML(e.message)}</div>`; return; }

  if (!items.length) {
    panel.innerHTML = '<div style="padding:8px;font-size:11px;color:var(--text-disabled)">No cached items yet — hit Refresh to fetch this source.</div>';
    panel.dataset.loaded = '1';
    return;
  }

  items.sort((a, b) => new Date(b.fetchedAt || 0) - new Date(a.fetchedAt || 0));
  const shown = items.slice(0, 100);
  panel.innerHTML = `
    <div style="font-size:10px;color:var(--text-disabled);text-transform:uppercase;letter-spacing:.5px;padding:2px 8px 6px">
      ${shown.length < items.length ? `Latest ${shown.length} of ${items.length}` : `${items.length} item${items.length !== 1 ? 's' : ''}`} — newest fetch first
    </div>
    ${shown.map(it => `<div data-health-url="${escapeHTML(it.url || '')}" title="${escapeHTML(it.url || '')}"
        style="display:flex;align-items:baseline;gap:10px;padding:5px 8px;border-top:1px solid var(--border);cursor:pointer">
      <div style="flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(it.title || '(no title)')}</div>
      <div style="font-size:10px;color:var(--text-disabled);white-space:nowrap" title="Fetched: ${it.fetchedAt ? new Date(it.fetchedAt).toLocaleString() : '?'}&#10;Published: ${it.publishedAt ? new Date(it.publishedAt).toLocaleString() : '?'}">
        fetched ${it.fetchedAt ? relativeTimeShort(it.fetchedAt) : '—'} · pub ${it.publishedAt ? relativeTimeShort(it.publishedAt) : '—'}
      </div>
    </div>`).join('')}`;
  panel.dataset.loaded = '1';
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

// ─── Content / Feed ────────────────────────────────────────────────────────────
const FEED_COLORS = {
  rss:'#f26522', podcast:'#9b59b6', youtube:'#ff0000', reddit:'#ff4500',
  newsletter:'#0078d4', blog:'#2ecc71', webpage:'#16a085', 'web-capture':'#8e44ad',
  github:'#a371f7', telegram:'#2aabee'
};
let feedItems = [];
let feedReadIds = new Set();
let feedFilter = 'all';
let feedSearch = '';

async function loadFeed() {
  const list = document.getElementById('feedList');
  if (list && !feedItems.length) list.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const [items, readArr] = await Promise.all([api.content.getAll(), api.content.getReadIds()]);
    feedItems = items;
    feedReadIds = new Set(readArr);
    renderFeedFilters();
    renderFeedItems();
    updateFeedBadge();
  } catch (e) {
    if (list) list.innerHTML = `<div class="empty-state"><h3>Failed to load</h3><p>${escapeHTML(e.message)}</p></div>`;
  }
}

function updateFeedBadge() {
  const badge = document.getElementById('feedBadge');
  if (badge) badge.textContent = feedItems.filter(i => !feedReadIds.has(i.id)).length;
}

function renderFeedFilters() {
  const row = document.getElementById('feedFilters');
  if (!row) return;
  const types = [...new Set(feedItems.map(i => i.sourceType).filter(Boolean))];
  const chips = [`<button class="feed-chip ${feedFilter === 'all' ? 'active' : ''}" data-filter="all">All <span class="chip-count">${feedItems.length}</span></button>`];
  for (const t of types) {
    const n = feedItems.filter(i => i.sourceType === t).length;
    chips.push(`<button class="feed-chip ${feedFilter === t ? 'active' : ''}" data-filter="${t}">${getSourceIcon(t)} ${escapeHTML(t)} <span class="chip-count">${n}</span></button>`);
  }
  row.innerHTML = chips.join('');
}

function getFilteredFeed() {
  let f = feedFilter === 'all' ? feedItems : feedItems.filter(i => i.sourceType === feedFilter);
  if (feedSearch) {
    f = f.filter(i =>
      (i.title || '').toLowerCase().includes(feedSearch) ||
      (i.description || '').toLowerCase().includes(feedSearch));
  }
  return f;
}

function renderFeedItems() {
  const list = document.getElementById('feedList');
  if (!list) return;
  const items = getFilteredFeed();
  if (!items.length) {
    const msg = feedItems.length ? 'Nothing matches your filter or search.' : 'Refresh your sources to collect content.';
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><h3>No items</h3><p>${msg}</p></div>`;
    return;
  }
  list.innerHTML = items.map(renderFeedItem).join('');
}

function renderFeedItem(item) {
  const color = FEED_COLORS[item.sourceType] || '#666';
  const isRead = feedReadIds.has(item.id);
  const thumb = item.thumbnail
    ? `<img class="feed-thumb" src="${escapeHTML(item.thumbnail)}" alt="" onerror="this.style.display='none'">`
    : `<div class="feed-icon">${getSourceIcon(item.sourceType)}</div>`;
  return `<div class="feed-item ${isRead ? 'read' : ''}" data-id="${escapeHTML(item.id)}" data-url="${escapeHTML(item.url || '')}">
    ${thumb}
    <div class="feed-body">
      <div class="feed-title">${escapeHTML(item.title || '(no title)')}</div>
      ${item.description ? `<div class="feed-desc">${escapeHTML(item.description)}</div>` : ''}
      <div class="feed-meta">
        <span class="feed-source" style="background:${color}">${escapeHTML(item.sourceName || item.sourceType || '')}</span>
        <span class="feed-date">${relativeTimeShort(item.publishedAt)}</span>
        ${isRead ? '' : '<span class="feed-unread-dot" title="Unread"></span>'}
      </div>
    </div>
  </div>`;
}

function openFeedItem(id, url) {
  if (url) api.ui.openExternal(url);
  if (!feedReadIds.has(id)) {
    feedReadIds.add(id);
    api.content.markRead([id]);
    const el = document.querySelector(`.feed-item[data-id="${CSS.escape(id)}"]`);
    if (el) { el.classList.add('read'); const dot = el.querySelector('.feed-unread-dot'); if (dot) dot.remove(); }
    updateFeedBadge();
    renderFeedFilters();
  }
}

async function feedMarkAllRead() {
  if (!feedItems.length) return;
  await api.content.markAllRead();
  feedItems.forEach(i => feedReadIds.add(i.id));
  renderFeedItems();
  renderFeedFilters();
  updateFeedBadge();
  showToast('All items marked as read');
}

// ─── Threats / IoCs ──────────────────────────────────────────────────────────
// Flattens persisted item.iocs across all content into a deduped indicator table.
let threatRows = [];           // [{ value, type, severity, source, firstSeen, count }]
let threatTypeFilter = 'all';
let threatSevFilter = 'all';
let threatSearch = '';

const IOC_TYPE_LABELS = { ip: 'IP', domain: 'Domain', url: 'URL', md5: 'MD5', sha1: 'SHA1', sha256: 'SHA256', cve: 'CVE', email: 'Email' };
const SEV_RANK = { critical: 3, high: 2, medium: 1, info: 0, '': -1 };

async function loadThreats() {
  const list = document.getElementById('threatList');
  if (list) list.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const items = await api.content.getAll();
    threatRows = aggregateIoCs(items);
    renderThreatFilters();
    renderThreats();
    const badge = document.getElementById('threatsBadge');
    if (badge) badge.textContent = threatRows.length;
  } catch (e) {
    if (list) list.innerHTML = `<div class="empty-state"><h3>Failed to load</h3><p>${escapeHTML(e.message)}</p></div>`;
  }
}

// Collapse every item's .iocs into one row per unique (value,type), tracking the
// highest severity seen, the source, the earliest sighting, and a hit count.
function aggregateIoCs(items) {
  const map = new Map();
  for (const item of items) {
    const iocs = item.iocs;
    if (!iocs) continue;
    const sev = item.severity || '';
    const when = item.publishedAt || item.fetchedAt || '';
    const src = item.sourceName || item.sourceType || '';
    const addAll = (type, arr) => {
      for (const value of (arr || [])) {
        const key = `${type}:${value}`;
        const existing = map.get(key);
        if (existing) {
          existing.count++;
          if ((SEV_RANK[sev] ?? -1) > (SEV_RANK[existing.severity] ?? -1)) existing.severity = sev;
          if (when && (!existing.firstSeen || when < existing.firstSeen)) existing.firstSeen = when;
        } else {
          map.set(key, { value, type, severity: sev, source: src, firstSeen: when, count: 1 });
        }
      }
    };
    addAll('ip', iocs.ips);
    addAll('domain', iocs.domains);
    addAll('url', iocs.urls);
    addAll('md5', iocs.md5);
    addAll('sha1', iocs.sha1);
    addAll('sha256', iocs.sha256);
    addAll('cve', iocs.cves);
    addAll('email', iocs.emails);
  }
  // Sort by severity desc, then most-seen.
  return [...map.values()].sort((a, b) =>
    (SEV_RANK[b.severity] ?? -1) - (SEV_RANK[a.severity] ?? -1) || b.count - a.count);
}

function renderThreatFilters() {
  const typeRow = document.getElementById('threatTypeFilters');
  const sevRow = document.getElementById('threatSevFilters');
  if (typeRow) {
    const types = [...new Set(threatRows.map(r => r.type))];
    const chips = [`<button class="feed-chip ${threatTypeFilter === 'all' ? 'active' : ''}" data-tfilter="all">All <span class="chip-count">${threatRows.length}</span></button>`];
    for (const t of types) {
      const n = threatRows.filter(r => r.type === t).length;
      chips.push(`<button class="feed-chip ${threatTypeFilter === t ? 'active' : ''}" data-tfilter="${t}">${IOC_TYPE_LABELS[t] || t} <span class="chip-count">${n}</span></button>`);
    }
    typeRow.innerHTML = chips.join('');
  }
  if (sevRow) {
    const sevs = ['all', 'critical', 'high', 'medium', 'info'];
    sevRow.innerHTML = sevs.map(s =>
      `<button class="feed-chip sev-chip-${s} ${threatSevFilter === s ? 'active' : ''}" data-sfilter="${s}">${s === 'all' ? 'Any severity' : s.charAt(0).toUpperCase() + s.slice(1)}</button>`
    ).join('');
  }
}

function getFilteredThreats() {
  let f = threatRows;
  if (threatTypeFilter !== 'all') f = f.filter(r => r.type === threatTypeFilter);
  if (threatSevFilter !== 'all') f = f.filter(r => (r.severity || 'info') === threatSevFilter);
  if (threatSearch) {
    const q = threatSearch.toLowerCase();
    f = f.filter(r => r.value.toLowerCase().includes(q) || (r.source || '').toLowerCase().includes(q));
  }
  return f;
}

function renderThreats() {
  const list = document.getElementById('threatList');
  if (!list) return;
  const rows = getFilteredThreats();
  if (!rows.length) {
    const msg = threatRows.length ? 'Nothing matches your filter or search.' : 'Add a threat-intel source (CISA KEV, Abuse.ch, CVE) and refresh to populate.';
    list.innerHTML = `<div class="empty-state"><div class="empty-icon" data-icon="threats" data-size="44"></div><h3>No indicators</h3><p>${msg}</p></div>`;
    if (window.PKIcons) window.PKIcons.hydrate(list);
    return;
  }
  const body = rows.map(r => {
    const sev = r.severity || 'info';
    return `<tr>
      <td class="ioc-val" title="${escapeHTML(r.value)}">${escapeHTML(r.value)}</td>
      <td><span class="ioc-type-tag">${IOC_TYPE_LABELS[r.type] || r.type}</span></td>
      <td><span class="sev-tag sev-${sev}">${sev.toUpperCase()}</span></td>
      <td class="ioc-src">${escapeHTML(r.source || '')}</td>
      <td class="ioc-date">${r.firstSeen ? relativeTimeShort(r.firstSeen) : ''}</td>
      <td class="ioc-count">${r.count}</td>
      <td><button class="btn-copy-ioc" data-copy="${escapeHTML(r.value)}" title="Copy">⧉</button></td>
    </tr>`;
  }).join('');
  list.innerHTML = `<table class="ioc-table">
    <thead><tr><th>Indicator</th><th>Type</th><th>Severity</th><th>Source</th><th>First seen</th><th>Hits</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

async function exportThreats(format) {
  const rows = getFilteredThreats();
  if (!rows.length) { showToast('No indicators to export', 'error'); return; }
  try {
    const res = await api.threats.export(format, rows);
    if (res && !res.canceled) showToast(`Exported ${res.count} indicators`);
  } catch (e) {
    showToast(`Export failed: ${e.message}`, 'error');
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
  document.getElementById('btnGenerateDigestNow').addEventListener('click', generateDigestNow);
  document.getElementById('btnAddCategory').addEventListener('click', () => addCategoryRow());
  document.getElementById('llmCategoryDigests').addEventListener('change', updateCategoriesVisibility);
  document.getElementById('llmKnowledgeEnabled').addEventListener('change', updateKnowledgeVisibility);
  document.getElementById('btnViewKnowledge').addEventListener('click', toggleKnowledgeView);
  document.getElementById('btnClearKnowledge').addEventListener('click', clearKnowledge);
  document.getElementById('settingAutoDigestMode').addEventListener('change', updateAutoDigestModeVisibility);

  document.getElementById('llmProvider').addEventListener('change', e => {
    const newProvider = e.target.value;
    // Restore this provider's remembered values — never blank them.
    document.getElementById('llmApiKey').value = llmKeys[newProvider] || '';
    document.getElementById('llmBaseURL').value = llmBaseURLs[newProvider] || '';
    const freeText = llmUsesModelInput(newProvider);
    document.getElementById('llmModelSelectGroup').style.display = freeText ? 'none' : 'block';
    document.getElementById('llmModelInputGroup').style.display = freeText ? 'block' : 'none';
    if (freeText) {
      document.getElementById('llmModelInput').value = llmModels[newProvider] || '';
    } else {
      updateModelDropdown(newProvider, llmModels[newProvider] || null);
    }
    updateCustomURLVisibility(newProvider);
  });

  document.getElementById('llmApiKey').addEventListener('input', e => {
    const p = document.getElementById('llmProvider').value;
    if (p) llmKeys[p] = e.target.value.trim();
  });
  document.getElementById('llmBaseURL').addEventListener('input', e => {
    const p = document.getElementById('llmProvider').value;
    if (p) llmBaseURLs[p] = e.target.value.trim();
  });
  document.getElementById('llmModelInput').addEventListener('input', e => {
    const p = document.getElementById('llmProvider').value;
    if (p) llmModels[p] = e.target.value.trim();
  });
  document.getElementById('llmModel').addEventListener('change', e => {
    const p = document.getElementById('llmProvider').value;
    if (p) llmModels[p] = e.target.value;
  });

  // Content / Feed tab
  document.getElementById('btnFeedRefresh').addEventListener('click', async () => {
    setStatus('Collecting all sources…', true);
    try { await api.sources.collectAll(); await loadFeed(); }
    catch (e) { showToast(e.message, 'error'); }
    finally { setStatus('Ready', false); }
  });
  document.getElementById('btnFeedMarkAllRead').addEventListener('click', feedMarkAllRead);
  document.getElementById('feedSearch').addEventListener('input', e => {
    feedSearch = e.target.value.trim().toLowerCase();
    renderFeedItems();
  });
  document.getElementById('feedFilters').addEventListener('click', e => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    feedFilter = chip.dataset.filter;
    renderFeedFilters();
    renderFeedItems();
  });
  document.getElementById('sourceSearch').addEventListener('input', e => {
    sourceSearch = e.target.value.trim().toLowerCase();
    renderSourceList();
  });
  document.getElementById('sourceFilters').addEventListener('click', e => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    sourceFilter = chip.dataset.filter;
    renderSourceList();
  });
  document.getElementById('feedList').addEventListener('click', e => {
    const card = e.target.closest('.feed-item');
    if (card) openFeedItem(card.dataset.id, card.dataset.url);
  });

  // Threats / IoCs tab
  document.getElementById('btnThreatsRefresh').addEventListener('click', async () => {
    setStatus('Collecting all sources…', true);
    try { await api.sources.collectAll(); await loadThreats(); }
    catch (e) { showToast(e.message, 'error'); }
    finally { setStatus('Ready', false); }
  });
  document.getElementById('btnThreatsExportCsv').addEventListener('click', () => exportThreats('csv'));
  document.getElementById('btnThreatsExportJson').addEventListener('click', () => exportThreats('json'));
  document.getElementById('btnThreatsExportStix').addEventListener('click', () => exportThreats('stix'));
  document.getElementById('threatSearch').addEventListener('input', e => {
    threatSearch = e.target.value.trim().toLowerCase();
    renderThreats();
  });
  document.getElementById('threatTypeFilters').addEventListener('click', e => {
    const chip = e.target.closest('[data-tfilter]');
    if (!chip) return;
    threatTypeFilter = chip.dataset.tfilter;
    renderThreatFilters();
    renderThreats();
  });
  document.getElementById('threatSevFilters').addEventListener('click', e => {
    const chip = e.target.closest('[data-sfilter]');
    if (!chip) return;
    threatSevFilter = chip.dataset.sfilter;
    renderThreatFilters();
    renderThreats();
  });
  document.getElementById('threatList').addEventListener('click', async e => {
    const btn = e.target.closest('.btn-copy-ioc');
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.copy); showToast('Copied to clipboard'); }
    catch { showToast('Copy failed', 'error'); }
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
