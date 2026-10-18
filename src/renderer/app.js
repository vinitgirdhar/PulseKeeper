'use strict';

// Main window controller: navigation, sources, health, AI, settings, export.
// (Shared helpers live in ui.js; the news aggregator lives in news.js.)

let sourceTypes = [];
let sources = [];
let sourceHealth = {};
let editingSourceId = null;
let settings = {};
let view = 'news';
let collecting = false;
const refreshing = new Set();

const VIEW_ALIAS = { feed: 'news', llm: 'ai' }; // names used by older callers of ui:openSettings

// ═════ Navigation ═════════════════════════════════════════════════════════════
const App = {
  /** Highlight the sidebar row for the current view/channel and slide the selection pill to it. */
  updateNav(instant = false) {
    const rows = document.querySelectorAll('#navScroll .side-item');
    const target = view === 'news'
      ? News.currentRow()
      : document.querySelector(`#navScroll .side-item[data-view="${view}"]:not([data-channel])`);
    rows.forEach(r => r.setAttribute('aria-current', String(r === target)));
    Motion.movePill($('navPill'), target, $('navScroll'), instant);
  },

  navigate(name, channel) {
    name = VIEW_ALIAS[name] || name;
    if (name === 'news' && channel) News.select(channel.kind, channel.id);
    if (name !== view) {
      $(`view-${view}`).hidden = true;
      view = name;
      $(`view-${name}`).hidden = false;
      News.setActive(name === 'news');
      Motion.viewIn($(`view-${name}`));
      ({ sources: () => renderSources(true), health: loadHealth, ai: refreshDigestStatus, export: loadExport, extension: checkServerStatus, about: renderAbout })[name]?.();
    }
    App.updateNav();
  },

  async refreshAll() {
    if (collecting) return;
    try {
      const r = await api.sources.collectAll();
      toast(`${r.succeeded} ${r.succeeded === 1 ? 'source' : 'sources'} refreshed${r.failed ? ` · ${r.failed} failed` : ''}`, r.failed ? 'error' : 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
};

function setCollecting(on, text) {
  collecting = on;
  document.querySelectorAll('#btnRefresh, #btnRefreshAll').forEach(b => b.classList.toggle('spinning', on));
  $('progress').classList.toggle('on', on);
  $('statusDot').className = `dot ${on ? 'busy' : 'ok'}`;
  $('statusText').textContent = on ? (text || 'Refreshing…') : 'Ready';
  const bar = $('progress');
  if (!on) { bar.style.setProperty('--p', '1'); return; }
  // Restart from the left without animating backwards.
  const fill = bar.firstElementChild;
  fill.style.transition = 'none';
  bar.style.setProperty('--p', '0.04');
  fill.offsetWidth; // flush
  fill.style.transition = '';
}

// ═════ Sources ════════════════════════════════════════════════════════════════
async function loadSources() {
  [sources, sourceHealth] = await Promise.all([api.sources.list(), api.sources.getHealth()]);
  $('badgeSources').textContent = sources.filter(s => s.enabled).length;
  $('categoryList').innerHTML = [...new Set(sources.map(s => s.category).filter(Boolean))].map(c => `<option value="${escapeHTML(c)}">`).join('');
  updateHealthBadge();
  if (view === 'sources') renderSources(false);
}

function describeSource(s) {
  const c = s.config || {};
  if (s.type === 'reddit') return `r/${String(c.subreddit || '').replace(/^\/?r\//, '')} · ${c.sort || 'hot'}`;
  if (s.type === 'web-capture') return 'Sent from the browser extension';
  try { const u = new URL(c.url); return u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname); } catch { return c.url || ''; }
}

function sourceChip(s) {
  const h = sourceHealth[s.id] || {};
  if (refreshing.has(s.id)) return `<span class="chip run"><span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>Updating</span>`;
  if (h.lastError) return `<span class="chip err" title="${escapeHTML(h.lastError)}">${icon('warning', 12)}Error</span>`;
  if (!h.lastFetchedAt) return '';
  return `<span class="chip ok" title="Last checked ${escapeHTML(new Date(h.lastFetchedAt).toLocaleString())}">${icon('check', 12)}${timeAgo(h.lastFetchedAt)}${h.lastNewCount ? ` · +${h.lastNewCount}` : ''}</span>`;
}

function sourceRowHTML(s) {
  return `<div class="row src-row ${s.enabled ? '' : 'off'}" data-id="${s.id}">
    <span class="tile tile-lg t-${s.type}">${icon(s.type)}</span>
    <div class="row-main">
      <div class="src-name"><span class="row-title">${escapeHTML(s.name)}</span>${s.ignoreMute ? `<span class="chip" title="Ignores muted words">Unmuted</span>` : ''}${s.refreshInterval ? `<span class="chip">${icon('clock', 11)}${s.refreshInterval}m</span>` : ''}</div>
      <div class="row-sub src-sub">${escapeHTML(TYPE_LABEL[s.type] || s.type)} · ${escapeHTML(describeSource(s))}</div>
    </div>
    ${sourceChip(s)}
    <div class="hover-actions">
      <button class="btn btn-icon btn-ghost btn-sm" data-act="refresh" title="Refresh now" aria-label="Refresh ${escapeHTML(s.name)}">${icon('refresh')}</button>
      ${s.type !== 'web-capture' ? `<button class="btn btn-icon btn-ghost btn-sm" data-act="edit" title="Edit" aria-label="Edit ${escapeHTML(s.name)}">${icon('edit')}</button>` : ''}
      <button class="btn btn-icon btn-ghost btn-sm" data-act="delete" title="Delete" aria-label="Delete ${escapeHTML(s.name)}">${icon('trash')}</button>
    </div>
    <label class="switch" title="${s.enabled ? 'Disable' : 'Enable'}"><input type="checkbox" data-act="toggle" ${s.enabled ? 'checked' : ''} aria-label="Enable ${escapeHTML(s.name)}"><i></i></label>
  </div>`;
}

function renderSources(animate) {
  const q = $('sourceSearch').value.trim().toLowerCase();
  const shown = sources.filter(s => !q || `${s.name} ${s.category} ${describeSource(s)} ${s.type}`.toLowerCase().includes(q));
  const el = $('sourceList');
  if (!sources.length) {
    el.innerHTML = `<div class="empty">${icon('sources')}<h3>No sources yet</h3><p>Add a feed, channel, subreddit or web page to start building your news.</p><button class="btn btn-primary" data-act="add">${icon('plus')}Add Source</button></div>`;
    return;
  }
  if (!shown.length) { el.innerHTML = `<div class="empty">${icon('search')}<h3>No matches</h3><p>No source matches “${escapeHTML(q)}”.</p></div>`; return; }

  const groups = new Map();
  for (const s of shown) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category).push(s);
  }
  el.innerHTML = [...groups].map(([cat, list]) =>
    `<h2 class="group-title">${escapeHTML(cat)}<span class="badge">${list.length}</span></h2><div class="group">${list.map(sourceRowHTML).join('')}</div>`).join('');
  if (animate) Motion.enter(el.querySelectorAll('.group'), { y: 14, each: 0.06 });
}

async function refreshSource(id) {
  refreshing.add(id);
  renderSources(false);
  try {
    const n = await api.sources.collectOne(id);
    toast(n ? `${n} new ${n === 1 ? 'story' : 'stories'}` : 'Already up to date');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    refreshing.delete(id);
    await loadSources();
    News.onCollected();
  }
}

async function deleteSource(id) {
  const s = sources.find(x => x.id === id);
  if (!s) return;
  const ok = await confirmDialog({ title: `Delete “${s.name}”?`, body: 'Its collected stories will be removed too.', ok: 'Delete', danger: true });
  if (!ok) return;
  await api.sources.delete(id);
  await loadSources();
  News.reloadAll();
  toast(`“${s.name}” deleted`);
}

async function toggleSource(id, enabled) {
  await api.sources.toggle(id, enabled);
  await loadSources();
  News.reloadAll();
}

// ── Add / edit sheet ──────────────────────────────────────────────────────────
function openSourceSheet(source) {
  editingSourceId = source?.id || null;
  $('modalTitle').textContent = source ? 'Edit Source' : 'Add Source';
  $('btnSaveSource').textContent = source ? 'Save Changes' : 'Add Source';
  $('sourceType').value = source?.type || '';
  $('sourceName').value = source?.name || '';
  $('sourceCategory').value = source?.category && source.category !== 'General' ? source.category : (source ? 'General' : '');
  $('sourceMaxItems').value = source?.maxItems || settings.maxItemsPerSource || 20;
  $('sourceRefreshInterval').value = source?.refreshInterval || 0;
  $('sourceIgnoreMute').checked = !!source?.ignoreMute;
  renderSourceFields(source?.type, source?.config || {});
  Motion.sheetOpen($('sourceScrim'), $('sourceScrim').firstElementChild);
  (source ? $('sourceName') : $('sourceType')).focus();
}

function closeSourceSheet() {
  if ($('sourceScrim').hidden) return;
  Motion.sheetClose($('sourceScrim'), $('sourceScrim').firstElementChild);
}

function renderSourceFields(type, existing) {
  const info = sourceTypes.find(t => t.id === type);
  $('sourceTypeHint').textContent = info?.description || '';
  $('sourceFields').innerHTML = (info?.fields || []).map(f => {
    const val = existing[f.key] !== undefined ? existing[f.key] : (f.default || '');
    const label = `<label>${escapeHTML(f.label)}${f.required ? '' : ' <span class="hint">(optional)</span>'}</label>`;
    const hint = f.hint ? `<div class="hint">${escapeHTML(f.hint)}</div>` : '';
    if (f.type === 'select') {
      return `<div class="field">${label}<select class="select" data-field="${f.key}">${f.options.map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    }
    if (f.type === 'checkbox') {
      return `<div class="row inline"><div class="row-main"><div class="row-title">${escapeHTML(f.label)}</div></div><label class="switch"><input type="checkbox" data-field="${f.key}" ${val ? 'checked' : ''}><i></i></label></div>`;
    }
    const input = `<input class="input" type="${f.type === 'url' ? 'url' : 'text'}" data-field="${f.key}" value="${escapeHTML(String(val))}" placeholder="${escapeHTML(f.placeholder || '')}" spellcheck="false">`;
    const discoverable = f.key === 'url' && ['rss', 'podcast', 'newsletter', 'blog'].includes(type);
    return `<div class="field">${label}${discoverable
      ? `<div class="input-with-action">${input}<button class="btn" data-discover="${f.key}" title="Find the RSS feed behind any website address">${icon('search')}Find Feed</button></div>`
      : input}${hint}</div>`;
  }).join('');
}

// A readable default when the name field is left empty.
function autoName(type, config) {
  if (type === 'reddit') return `r/${String(config.subreddit || '').replace(/^\/?r\//, '')}`;
  try { return new URL(config.url).hostname.replace(/^www\./, ''); } catch { return TYPE_LABEL[type] || 'Source'; }
}

async function saveSource() {
  const type = $('sourceType').value;
  if (!type) { toast('Choose a source type first', 'error'); $('sourceType').focus(); return; }

  const info = sourceTypes.find(t => t.id === type);
  for (const f of info?.fields || []) {
    const el = document.querySelector(`#sourceFields [data-field="${f.key}"]`);
    if (f.required && el && !el.value.trim()) { toast(`${f.label} is required`, 'error'); el.focus(); return; }
  }
  const config = {};
  document.querySelectorAll('#sourceFields [data-field]').forEach(el => { config[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value.trim(); });

  const data = {
    type, config,
    name: $('sourceName').value.trim() || autoName(type, config),
    category: $('sourceCategory').value.trim() || 'General',
    maxItems: parseInt($('sourceMaxItems').value, 10) || 20,
    refreshInterval: parseInt($('sourceRefreshInterval').value, 10) || 0,
    ignoreMute: $('sourceIgnoreMute').checked
  };

  $('btnSaveSource').disabled = true;
  try {
    let saved;
    if (editingSourceId) { saved = await api.sources.update(editingSourceId, data); toast('Source updated'); }
    else { saved = await api.sources.add(data); toast(`“${data.name}” added`); }
    closeSourceSheet();
    await loadSources();
    await News.loadChannels();
    refreshSource(saved.id); // fetch right away so its stories show up without a manual refresh
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    $('btnSaveSource').disabled = false;
  }
}

async function discoverFeed(fieldKey) {
  const input = document.querySelector(`#sourceFields [data-field="${fieldKey}"]`);
  if (!input?.value.trim()) { toast('Enter a website address first', 'error'); return; }
  const btn = document.querySelector(`[data-discover="${fieldKey}"]`);
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Looking…';
  try {
    const url = await api.sources.discoverFeed(input.value.trim());
    if (url) { input.value = url; toast('Feed found'); } else toast('No feed found at that address', 'error');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = html; }
}

// ═════ Health ═════════════════════════════════════════════════════════════════
function failingSources() { return sources.filter(s => s.enabled && sourceHealth[s.id]?.lastError); }

function updateHealthBadge() {
  const n = failingSources().length;
  const b = $('badgeHealth');
  b.hidden = !n;
  b.textContent = n;
}

async function loadHealth() {
  await loadSources();
  const enabled = sources.filter(s => s.enabled);
  const failing = failingSources().length;
  const stats = [
    { label: 'Active sources', n: enabled.length },
    { label: 'Healthy', n: enabled.filter(s => sourceHealth[s.id]?.lastFetchedAt && !sourceHealth[s.id]?.lastError).length, cls: 'good' },
    { label: 'Failing', n: failing, cls: failing ? 'bad' : '' },
    { label: 'Stories cached', n: sources.reduce((t, s) => t + (sourceHealth[s.id]?.totalCached || 0), 0) }
  ];
  $('healthStats').innerHTML = stats.map(s => `<div class="stat ${s.cls || ''}"><b>0</b><span>${s.label}</span></div>`).join('');
  $('healthStats').querySelectorAll('b').forEach((b, i) => Motion.count(b, stats[i].n));

  const rank = s => (sourceHealth[s.id]?.lastError ? 0 : 1);
  const rows = [...sources].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map(s => {
    const h = sourceHealth[s.id] || {};
    const state = !h.lastFetchedAt ? ['', 'Not fetched yet'] : h.lastError ? ['err', 'Failing'] : ['ok', 'Healthy'];
    const metrics = [
      h.lastFetchedAt ? `Checked ${timeAgo(h.lastFetchedAt)}` : null,
      h.lastDurationMs != null ? `${h.lastDurationMs} ms` : null,
      h.lastNewCount != null ? `+${h.lastNewCount} new` : null,
      h.totalCached != null ? `${h.totalCached} cached` : null,
      h.consecutiveFailures >= 3 ? `retrying less often (${h.consecutiveFailures} failures)` : null
    ].filter(Boolean);
    return `<div class="row src-row ${s.enabled ? '' : 'off'}" data-id="${s.id}" style="align-items:flex-start">
      <span class="tile tile-lg t-${s.type}">${icon(s.type)}</span>
      <div class="row-main">
        <div class="src-name"><span class="row-title">${escapeHTML(s.name)}</span><span class="dot ${state[0]}" title="${state[1]}"></span>${s.enabled ? '' : '<span class="chip">Disabled</span>'}</div>
        <div class="metrics">${metrics.map(m => `<span>${escapeHTML(m)}</span>`).join('') || '<span>—</span>'}</div>
        ${h.lastError ? `<div class="err-text">${escapeHTML(h.lastError)}</div>` : ''}
      </div>
      ${h.lastError ? `<button class="btn btn-sm" data-act="retry">${icon('refresh')}Retry</button>` : ''}
    </div>`;
  });
  $('healthList').innerHTML = rows.length ? `<h2 class="group-title">Sources</h2><div class="group">${rows.join('')}</div>` : '';
  Motion.enter($('healthList').querySelectorAll('.row'), { y: 8, each: 0.02, max: 20 });
}

// ═════ Settings ═══════════════════════════════════════════════════════════════
// A <select> that can show a saved value the fixed option list doesn't include.
function setSelect(el, value) {
  value = String(value);
  if (![...el.options].some(o => o.value === value)) el.add(new Option(`${value}`, value));
  el.value = value;
}

function fillSettings(s) {
  settings = s;
  setSelect($('settingInterval'), s.refreshInterval || 30);
  setSelect($('settingRetentionDays'), s.retentionDays || 3);
  $('settingMaxItems').value = s.maxItemsPerSource || 20;
  $('settingCollectOnStartup').checked = s.collectOnStartup !== false;
  $('settingRunAtStartup').checked = s.runAtStartup === true;
  $('settingOutputFormat').value = s.outputFormat || 'html';
  $('settingDigestBrowser').value = s.digestBrowser || 'internal';
  $('settingDigestFontSize').value = s.display?.digestFontSize || 'medium';
  $('settingAutoDigestEnabled').checked = !!s.autoDigest?.enabled;
  $('settingAutoDigestMode').value = s.autoDigest?.mode || 'interval';
  $('settingAutoDigestHours').value = s.autoDigest?.everyHours || 8;
  $('settingAutoDigestTime').value = s.autoDigest?.time || '08:00';
  setSelect($('settingHistoryMaxCount'), s.historyMaxCount || 10);
  $('settingNotifyEnabled').checked = s.notifications?.enabled !== false;
  $('settingNotifyOnRefresh').checked = !!s.notifications?.onRefresh;
  $('settingMuteWords').value = (s.muteWords || []).join(', ');
  updateAutoDigestRows();
  themeSeg.set(s.display?.themePinned ? s.display.theme : 'auto', { silent: true, instant: true });
  renderSwatches();
}

function updateAutoDigestRows() {
  const on = $('settingAutoDigestEnabled').checked;
  const daily = $('settingAutoDigestMode').value === 'daily';
  $('rowAutoMode').hidden = !on;
  $('rowAutoHours').hidden = !on || daily;
  $('rowAutoTime').hidden = !on || !daily;
}

const num = (id, fallback) => parseInt($(id).value, 10) || fallback;

async function saveSettings() {
  const cur = await api.settings.get();
  const next = {
    ...cur,
    refreshInterval: num('settingInterval', 30),
    retentionDays: num('settingRetentionDays', 3),
    maxItemsPerSource: Math.min(200, Math.max(5, num('settingMaxItems', 20))),
    collectOnStartup: $('settingCollectOnStartup').checked,
    runAtStartup: $('settingRunAtStartup').checked,
    outputFormat: $('settingOutputFormat').value,
    digestBrowser: $('settingDigestBrowser').value,
    historyMaxCount: num('settingHistoryMaxCount', 10),
    display: { ...cur.display, digestFontSize: $('settingDigestFontSize').value },
    muteWords: $('settingMuteWords').value.split(',').map(w => w.trim()).filter(Boolean),
    autoDigest: {
      enabled: $('settingAutoDigestEnabled').checked,
      mode: $('settingAutoDigestMode').value,
      everyHours: Math.min(24, Math.max(1, num('settingAutoDigestHours', 8))),
      time: $('settingAutoDigestTime').value || '08:00'
    },
    notifications: { ...cur.notifications, enabled: $('settingNotifyEnabled').checked, onRefresh: $('settingNotifyOnRefresh').checked }
  };
  await api.settings.save(next);
  const muteChanged = (cur.muteWords || []).join() !== next.muteWords.join();
  settings = next;
  flashSaved();
  if (muteChanged) News.reloadAll(); // muted words also hide stories already collected
}
const saveSettingsSoon = debounce(() => saveSettings().catch(e => toast(e.message, 'error')), 500);

function flashSaved() {
  const pill = $('savedPill');
  pill.classList.add('show');
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => pill.classList.remove('show'), 1600);
}

// ── Appearance ────────────────────────────────────────────────────────────────
let themeSeg;

async function saveDisplay(patch) {
  const cur = await api.settings.get();
  const display = { ...cur.display, ...patch };
  await api.settings.save({ ...cur, display });
  settings = { ...cur, display };
  applyAppearance(display);
  updateThemeButton();
  flashSaved();
}

function osTheme() { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }

function setThemePref(pref) {
  return saveDisplay({ theme: pref === 'auto' ? osTheme() : pref, themePinned: pref !== 'auto' });
}

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('btnThemeToggle').innerHTML = icon(dark ? 'sun' : 'moon', 17);
}

function renderSwatches() {
  const current = ACCENTS[settings.display?.accentColor] ? settings.display.accentColor : 'blue';
  $('accentSwatches').innerHTML = Object.entries(ACCENTS).map(([name, hex]) =>
    `<button class="swatch" role="radio" aria-checked="${name === current}" aria-label="${name}" title="${name[0].toUpperCase() + name.slice(1)}" data-accent="${name}" style="--c:${hex}"></button>`).join('');
}

// ═════ AI & Models ════════════════════════════════════════════════════════════
const LOCAL = new Set(['ollama', 'custom']);
const PROVIDER_META = {
  anthropic: { color: '#d97757', kind: 'Cloud' }, openai: { color: '#10a37f', kind: 'Cloud' }, gemini: { color: '#4285f4', kind: 'Cloud' },
  xai: { color: '#3a3a3c', kind: 'Cloud' }, groq: { color: '#f55036', kind: 'Cloud' },
  ollama: { color: '#34c759', kind: 'Runs on your computer' }, custom: { color: '#8e8e93', kind: 'Any OpenAI-compatible server' }
};
let providers = [];
let llm = {};            // working copy of settings.llm
const modelLists = {};   // provider -> model ids offered by the provider (or the static fallback)

function providerLabel(id) { return providers.find(p => p.id === id)?.label || id; }

const PROVIDER_ORDER = ['anthropic', 'openai', 'gemini', 'xai', 'groq', 'ollama', 'custom'];

function renderProviders() {
  providers.sort((a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id));
  $('providerGrid').innerHTML = providers.map(p => `
    <button class="provider" role="radio" aria-checked="${p.id === llm.provider}" data-provider="${p.id}" style="--tile:${PROVIDER_META[p.id].color}">
      <span class="tile">${icon(LOCAL.has(p.id) ? 'cpu' : 'cloud')}</span>
      <span><b>${escapeHTML(p.label)}</b><small>${PROVIDER_META[p.id].kind}</small></span>
    </button>`).join('');
}

function fillModelList(provider, ids) {
  modelLists[provider] = ids;
  $('llmModelList').innerHTML = ids.map(m => `<option value="${escapeHTML(m)}">`).join('');
}

function llmProfile() { return (llm.profiles ||= {}); }

function fillLLMForm() {
  const p = llm.provider;
  const local = LOCAL.has(p);
  $('llmEnabled').checked = !!llm.enabled;
  $('llmModel').value = llm.model || '';
  $('llmApiKey').value = (llm.apiKeys || {})[p] || '';
  $('llmBaseURL').value = llm.baseURL || '';
  $('llmBaseURL').placeholder = p === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1';
  $('llmBaseURLHint').textContent = p === 'ollama' ? 'Leave empty for this computer, or use another machine on your network' : 'Any OpenAI-compatible endpoint (LM Studio, vLLM, LiteLLM…)';
  $('llmNumCtx').value = llm.numCtx || 8192;
  $('llmTimeout').value = llm.timeoutMs ? Math.round(llm.timeoutMs / 1000) : 900;
  $('llmMaxItems').value = llm.maxItems || 50;
  $('llmDigestPrompt').value = llm.digestPrompt || '';
  $('rowApiKey').hidden = p === 'ollama';
  $('rowBaseURL').hidden = !local;
  $('rowNumCtx').hidden = !local;
  $('llmModelHint').textContent = local ? 'Press refresh to list the models installed on the server' : 'Press refresh to list the models your account can use';
  fillModelList(p, modelLists[p] || providers.find(x => x.id === p)?.models || []);
  document.querySelectorAll('.provider').forEach(b => b.setAttribute('aria-checked', String(b.dataset.provider === p)));
  updateLLMIndicator();
}

function updateLLMIndicator() {
  const el = $('llmActiveIndicator');
  const cfg = readLLMForm();
  const needsKey = !LOCAL.has(cfg.provider) && !cfg.apiKey;
  el.textContent = !cfg.enabled ? 'AI is turned off'
    : needsKey ? `${providerLabel(cfg.provider)} · add an API key to finish setup`
    : `${providerLabel(cfg.provider)} · ${cfg.model || 'choose a model'}`;
  el.style.color = cfg.enabled && needsKey ? 'var(--orange)' : '';
}

// The form -> the config object that is saved, tested and used for digests.
function readLLMForm() {
  const provider = llm.provider;
  const key = $('llmApiKey').value.trim();
  const apiKeys = { ...(llm.apiKeys || {}) };
  if (key) apiKeys[provider] = key; else delete apiKeys[provider];
  const profiles = { ...llmProfile(), [provider]: { model: $('llmModel').value.trim(), baseURL: $('llmBaseURL').value.trim() } };
  const timeout = parseInt($('llmTimeout').value, 10);
  return {
    ...llm,
    enabled: $('llmEnabled').checked,
    provider,
    model: $('llmModel').value.trim(),
    apiKey: key,
    apiKeys,
    profiles,
    baseURL: $('llmBaseURL').value.trim(),
    numCtx: parseInt($('llmNumCtx').value, 10) || 8192,
    timeoutMs: timeout > 0 ? timeout * 1000 : 900000,
    maxItems: parseInt($('llmMaxItems').value, 10) || 50,
    digestPrompt: $('llmDigestPrompt').value.trim()
  };
}

async function saveLLMNow() {
  llm = readLLMForm();
  const cur = await api.settings.get();
  await api.settings.save({ ...cur, llm });
  settings = { ...cur, llm };
  updateLLMIndicator();
}
const saveLLMSoon = debounce(() => saveLLMNow().then(() => toast('AI settings saved')).catch(e => toast(e.message, 'error')), 700);

function selectProvider(id) {
  if (id === llm.provider) return;
  llm = readLLMForm();                       // remember what was typed for the provider we're leaving
  const profile = llmProfile()[id] || {};
  llm.provider = id;
  llm.model = profile.model || providers.find(p => p.id === id)?.models?.[0] || '';
  llm.baseURL = profile.baseURL || '';
  fillLLMForm();
  saveLLMSoon();
}

async function loadModels({ quiet = false } = {}) {
  const btn = $('btnLoadModels');
  btn.classList.add('spinning');
  try {
    const ids = await api.llm.listModels(readLLMForm());
    if (!ids.length) throw new Error('The server returned no models.');
    fillModelList(llm.provider, ids);
    if (!quiet) toast(`${ids.length} models available`);
  } catch (e) {
    if (!quiet) toast(e.message, 'error');
  } finally { btn.classList.remove('spinning'); }
}

async function testLLM() {
  const btn = $('btnTestLLM');
  btn.disabled = true;
  const panel = $('llmTestResult');
  panel.hidden = false;
  panel.className = 'llm-panel';
  panel.innerHTML = '<span class="spinner"></span><span>Contacting the model…</span>';
  try {
    await saveLLMNow();
    const r = await api.llm.test(llm);
    panel.className = 'llm-panel ok';
    panel.innerHTML = `${icon('circleok')}<div><b>Connected</b><span class="meta">${escapeHTML(providerLabel(r.provider))} · ${escapeHTML(r.model)} · ${r.latencyMs} ms</span><span class="meta">“${escapeHTML(r.reply)}”</span></div>`;
  } catch (e) {
    panel.className = 'llm-panel err';
    panel.innerHTML = `${icon('warning')}<div><b>Couldn’t connect</b><span class="meta">${escapeHTML(e.message)}</span></div>`;
  } finally { btn.disabled = false; }
}

// ── AI digest status ─────────────────────────────────────────────────────────
let digestTimer = null;

function stopDigestTimer() {
  clearInterval(digestTimer);
  digestTimer = null;
  $('btnGenerateDigestNow').disabled = false;
}

function setGenerating(model, startedAt, tokens) {
  const el = $('llmDigestStatus');
  const start = startedAt || Date.now();
  const render = () => {
    const s = Math.floor((Date.now() - start) / 1000);
    el.className = 'llm-panel';
    el.innerHTML = `<span class="spinner"></span><div><b>Writing your digest</b><span class="meta">${escapeHTML(model || 'the model')} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${setGenerating.tokens ? ` · ~${setGenerating.tokens} tokens` : ''}</span></div>`;
  };
  setGenerating.tokens = tokens || 0;
  render();
  clearInterval(digestTimer);
  digestTimer = setInterval(render, 1000);
  $('btnGenerateDigestNow').disabled = true;
}

function setDigestIdle(cache) {
  stopDigestTimer();
  const el = $('llmDigestStatus');
  if (!cache || (!cache.generatedAt && !cache.error)) { el.className = 'llm-panel'; el.innerHTML = `${icon('info')}<span>No AI digest yet. Generate one, or let the schedule do it.</span>`; return; }
  if (cache.error && !cache.hasSummary) {
    el.className = 'llm-panel err';
    el.innerHTML = `${icon('warning')}<div><b>Last attempt failed</b><span class="meta">${escapeHTML(cache.error)}</span></div>`;
    return;
  }
  const of = cache.totalItems && cache.itemCount < cache.totalItems ? ` (${cache.itemCount} of ${cache.totalItems} stories fit the model)` : '';
  el.className = 'llm-panel ok';
  el.innerHTML = `${icon('circleok')}<div><b>Digest ready</b><span class="meta">${escapeHTML(timeAgo(cache.generatedAt))}${cache.model ? ` · ${escapeHTML(cache.model)}` : ''}${of}</span>${cache.error ? `<span class="meta" style="color:var(--red)">Latest refresh failed: ${escapeHTML(cache.error)}</span>` : ''}</div>`;
}

async function refreshDigestStatus() {
  try {
    const st = await api.llm.getDigestStatus();
    if (st.inProgress) setGenerating(st.model, st.startedAt);
    else setDigestIdle(st.cache);
  } catch { /* status is cosmetic */ }
}

async function generateDigestNow() {
  if (!$('llmEnabled').checked) { toast('Turn on “Use AI for digests” first', 'error'); return; }
  await saveLLMNow();
  setGenerating(llm.model, Date.now());
  try {
    const res = await api.llm.generateDigestNow();
    if (res && res.ok === false && res.error) toast(res.error, 'error');
  } catch (e) { toast(e.message, 'error'); }
  finally { refreshDigestStatus(); }
}

// ═════ Export / extension / about ═════════════════════════════════════════════
async function loadExport() {
  const history = await api.digest.getHistory();
  $('historyList').innerHTML = history.length
    ? history.map(h => `<div class="row history-item"><span class="side-icon" data-icon="clock"></span><div class="row-main"><div class="row-title">${escapeHTML(h.label)}</div></div><span class="chip">${escapeHTML(h.ext)}</span><button class="btn btn-sm" data-history="${escapeHTML(h.path)}">Open</button></div>`).join('')
    : `<div class="row"><div class="row-main"><div class="row-sub">No digests yet — open one to start the archive.</div></div></div>`;
  PKIcons.hydrate($('historyList'));
}

async function checkServerStatus() {
  const el = $('serverStatus');
  try {
    const data = await (await fetch('http://localhost:7828/status')).json();
    el.innerHTML = data.ok ? '<span class="dot ok"></span>Running' : '<span class="dot err"></span>Not responding';
  } catch { el.innerHTML = '<span class="dot err"></span>Not reachable'; }
}

function renderAbout() {
  $('aboutTypes').innerHTML = sourceTypes.map(t => `<span class="chip t-${t.id}"><span class="tile">${icon(t.id)}</span>${escapeHTML(t.label)}</span>`).join('');
}

// ═════ Boot ═══════════════════════════════════════════════════════════════════
function wire() {
  // Sidebar
  $('navScroll').addEventListener('click', e => {
    const tw = e.target.closest('[data-twisty]');
    if (tw) { e.stopPropagation(); News.toggleCategory(tw.closest('.cat-group').dataset.cat); return; }
    const b = e.target.closest('.side-item');
    if (!b) return;
    if (b.dataset.channel) App.navigate('news', { kind: b.dataset.channel, id: b.dataset.id || null });
    else App.navigate(b.dataset.view);
  });
  new ResizeObserver(() => App.updateNav(true)).observe($('navScroll'));
  $('btnThemeToggle').addEventListener('click', () => setThemePref(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  document.addEventListener('click', e => {
    const ext = e.target.closest('[data-external]');
    if (ext) { e.preventDefault(); api.ui.openExternal(ext.dataset.external); }
  });

  // Refresh
  $('btnRefresh').addEventListener('click', App.refreshAll);
  $('btnRefreshAll').addEventListener('click', App.refreshAll);

  // Sources
  $('btnAddSource').addEventListener('click', () => openSourceSheet());
  $('btnImportOPML').addEventListener('click', async () => {
    try {
      const r = await api.sources.importOPML();
      if (r?.imported) { toast(`${r.imported} ${r.imported === 1 ? 'feed' : 'feeds'} imported${r.skipped ? ` · ${r.skipped} skipped` : ''}`); await loadSources(); News.reloadAll(); App.refreshAll(); }
      else if (r?.skipped) toast('Those feeds are already in your sources');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('sourceSearch').addEventListener('input', debounce(() => renderSources(false), 120));
  $('sourceList').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]')?.dataset.id;
    if (b.dataset.act === 'add') openSourceSheet();
    else if (b.dataset.act === 'refresh') refreshSource(id);
    else if (b.dataset.act === 'edit') openSourceSheet(sources.find(s => s.id === id));
    else if (b.dataset.act === 'delete') deleteSource(id);
  });
  $('sourceList').addEventListener('change', e => {
    if (e.target.dataset.act === 'toggle') toggleSource(e.target.closest('[data-id]').dataset.id, e.target.checked);
  });
  $('sourceType').addEventListener('change', e => renderSourceFields(e.target.value, {}));
  $('sourceFields').addEventListener('click', e => { const b = e.target.closest('[data-discover]'); if (b) discoverFeed(b.dataset.discover); });
  $('btnSaveSource').addEventListener('click', saveSource);
  $('btnCancelSource').addEventListener('click', closeSourceSheet);
  $('sourceScrim').addEventListener('click', e => { if (e.target === e.currentTarget) closeSourceSheet(); });
  $('sourceScrim').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') saveSource(); });

  // Health
  $('btnRefreshHealth').addEventListener('click', loadHealth);
  $('healthList').addEventListener('click', e => { if (e.target.closest('[data-act="retry"]')) refreshSource(e.target.closest('[data-id]').dataset.id).then(loadHealth); });

  // Settings (auto-saved)
  themeSeg = Motion.segmented($('themeSeg'), 'auto', setThemePref);
  $('view-settings').addEventListener('input', saveSettingsSoon);
  $('view-settings').addEventListener('change', () => { updateAutoDigestRows(); saveSettingsSoon(); });
  $('accentSwatches').addEventListener('click', e => { const b = e.target.closest('[data-accent]'); if (b) { saveDisplay({ accentColor: b.dataset.accent }).then(renderSwatches); } });
  $('btnExportBackup').addEventListener('click', () => api.settings.exportBackup().catch(e => toast(e.message, 'error')));
  $('btnImportBackup').addEventListener('click', () => api.settings.importBackup().catch(e => toast(e.message, 'error')));

  // AI
  $('providerGrid').addEventListener('click', e => { const b = e.target.closest('[data-provider]'); if (b) selectProvider(b.dataset.provider); });
  $('view-ai').addEventListener('input', () => { updateLLMIndicator(); saveLLMSoon(); });
  $('view-ai').addEventListener('change', () => { updateLLMIndicator(); saveLLMSoon(); });
  $('btnLoadModels').addEventListener('click', () => loadModels());
  $('btnRevealKey').addEventListener('click', () => {
    const k = $('llmApiKey');
    k.type = k.type === 'password' ? 'text' : 'password';
    $('btnRevealKey').innerHTML = icon(k.type === 'password' ? 'eye' : 'eyeoff');
  });
  $('btnTestLLM').addEventListener('click', testLLM);
  $('btnGenerateDigestNow').addEventListener('click', generateDigestNow);

  // Export / extension
  $('btnOpenDigest').addEventListener('click', () => api.output.openDigest());
  $('btnExportMd').addEventListener('click', () => api.output.exportMarkdown().catch(e => toast(e.message, 'error')));
  $('btnExportPdf').addEventListener('click', () => api.output.exportPDF().catch(e => toast(e.message, 'error')));
  $('btnExportPack').addEventListener('click', () => api.ui.exportAgentPlatform().catch(e => toast(e.message, 'error')));
  $('btnOpenData').addEventListener('click', () => api.ui.openDataDir());
  $('btnOpenOutput').addEventListener('click', () => api.ui.openOutputDir());
  $('btnOpenExtension').addEventListener('click', () => api.ui.openExtensionDir());
  $('historyList').addEventListener('click', e => { const b = e.target.closest('[data-history]'); if (b) api.digest.openHistory(b.dataset.history); });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSourceSheet(); return; }
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'r') { e.preventDefault(); App.refreshAll(); }
    else if (k === 'n') { e.preventDefault(); openSourceSheet(); }
    else if (k === 'e') { e.preventDefault(); api.output.openDigest(); }
    else if (k === ',') { e.preventDefault(); App.navigate('settings'); }
  });

  // Main-process events
  api.on.collectStart(() => setCollecting(true));
  api.on.collectProgress(({ done, total, name }) => {
    if (!collecting) setCollecting(true); // the sweep began before this window opened
    $('progress').style.setProperty('--p', String(Math.max(0.04, done / total)));
    $('statusText').textContent = `Refreshing ${done}/${total}`;
    $('statusText').title = name || '';
  });
  api.on.collectComplete(() => {
    setCollecting(false);
    setTimeout(() => { if (!collecting) $('progress').classList.remove('on'); }, 450);
    loadSources();
    News.onCollected();
    if (view === 'health') loadHealth();
  });
  api.on.sourcesUpdated(() => loadSources().then(() => News.reloadAll()));
  api.on.backupImported(async () => { fillSettings(await api.settings.get()); await loadSources(); News.reloadAll(); toast('Backup restored'); });
  api.on.navigate(tab => App.navigate(tab));
  api.on.themeOsSync(({ theme }) => { settings.display = { ...settings.display, theme }; applyAppearance(settings.display); updateThemeButton(); });
  api.on.digestGenerating(d => setGenerating(d.model, d.startedAt));
  api.on.digestProgress(d => { setGenerating.tokens = d.tokens; });
  api.on.digestGenerated(d => { refreshDigestStatus(); toast(`AI digest ready${d.totalItems > d.itemCount ? ` — ${d.itemCount} of ${d.totalItems} stories fit the model` : ''}`); });
  api.on.digestError(d => { refreshDigestStatus(); toast(`AI digest failed: ${d.message}`, 'error'); });
  setInterval(() => { if (!digestTimer && view === 'ai') refreshDigestStatus(); }, 60000);
}

async function init() {
  PKIcons.hydrate();
  [settings, sourceTypes, providers] = await Promise.all([api.settings.get(), api.sources.types(), api.settings.getProviders()]);
  providers = [...providers, { id: 'custom', label: 'Custom endpoint', models: [] }];
  applyAppearance(settings.display);
  updateThemeButton();

  wire();
  News.init();
  fillSettings(settings);

  $('sourceType').innerHTML = '<option value="">Select a type…</option>' +
    sourceTypes.filter(t => t.id !== 'web-capture').map(t => `<option value="${t.id}">${escapeHTML(t.label)}</option>`).join('');

  llm = { ...(settings.llm || {}) };
  llm.apiKeys = { ...(llm.apiKeys || {}) };
  if (llm.apiKey && !llm.apiKeys[llm.provider]) llm.apiKeys[llm.provider] = llm.apiKey; // keys saved by older versions
  llm.provider = PROVIDER_META[llm.provider] ? llm.provider : 'anthropic';
  renderProviders();
  fillLLMForm();
  refreshDigestStatus();

  await loadSources();
  await Promise.all([News.loadChannels(), News.load()]);
  Motion.enter(document.querySelectorAll('.sidebar-scroll .side-item'), { y: 6, each: 0.012, max: 40, duration: 0.5 });
  App.updateNav(true);
}

init().catch(e => { console.error(e); toast(`PulseKeeper failed to start: ${e.message}`, 'error'); });
