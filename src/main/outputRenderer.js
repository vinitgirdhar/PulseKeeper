'use strict';

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// SF-Symbols-style inline-SVG icons for the generated digest page.
// (Mirrors src/renderer/icons.js — kept standalone because the digest HTML is a
//  self-contained file:// document that can't load the renderer's icon script.)
const ICON_PATHS = {
  rss:       '<circle cx="6.5" cy="17.5" r="1.7" fill="currentColor" stroke="none"/><path d="M5 11.5a7.5 7.5 0 0 1 7.5 7.5M5 6a13 13 0 0 1 13 13"/>',
  podcast:   '<rect x="9" y="3.5" width="6" height="10" rx="3"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M9.5 20h5"/>',
  youtube:   '<rect x="3.5" y="6" width="17" height="12" rx="3.5"/><path d="M10.5 9.5l4.5 2.5-4.5 2.5z" fill="currentColor" stroke="none"/>',
  reddit:    '<circle cx="12" cy="13" r="7"/><circle cx="9" cy="12.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none"/><path d="M9.2 15.5a4 4 0 0 0 5.6 0M16.5 8.5l-1-3.5-3.2.8"/><circle cx="18.5" cy="9" r="1.3"/>',
  mail:      '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  blog:      '<path d="M16.5 4.5l3 3L9 18l-4 1 1-4z"/><path d="M13.5 7.5l3 3"/>',
  globe:     '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.3 3.8 8.5S14.5 18.2 12 20.5C9.5 18.2 8.2 15.2 8.2 12S9.5 5.8 12 3.5z"/>',
  capture:   '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9.5h16M8 4v5.5"/>',
  doc:       '<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M14 3.5V8h4"/>',
  newspaper: '<path d="M4 6h12.5a1 1 0 0 1 1 1v10.5A1.5 1.5 0 0 1 16 19H6a2 2 0 0 1-2-2z"/><path d="M17.5 9H19a1 1 0 0 1 1 1v7a1.5 1.5 0 0 1-1.5 1.5M7 9.5h6.5M7 12.5h6.5M7 15.5h4"/>',
  ai:        '<path d="M12 3.5l1.6 4.2 4.2 1.6-4.2 1.6L12 15.1l-1.6-4.2L6.2 9.3l4.2-1.6z"/><path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  search:    '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  refresh:   '<path d="M19 9a7 7 0 1 0 .8 5"/><path d="M19.5 4.5V9H15"/>',
  close:     '<path d="M6 6l12 12M18 6 6 18"/>',
  back:      '<path d="M15 5l-7 7 7 7"/>',
  forward:   '<path d="M9 5l7 7-7 7"/>',
  home:      '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
  external:  '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 13v5.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H11"/>',
};

const TYPE_ICON = {
  rss: 'rss', podcast: 'podcast', youtube: 'youtube', reddit: 'reddit',
  newsletter: 'mail', blog: 'blog', webpage: 'globe', 'web-capture': 'capture'
};

function icon(name, size) {
  const inner = ICON_PATHS[name] || ICON_PATHS.doc;
  const dim = size ? `width="${size}" height="${size}"` : 'width="1em" height="1em"';
  return `<svg class="pk-i" ${dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
         `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function typeIcon(type, size) {
  return icon(TYPE_ICON[type] || 'doc', size);
}

// Same palette as the app's source-type tiles (src/renderer/theme.css).
const SOURCE_COLORS = {
  rss: '#ff9500',
  podcast: '#af52de',
  youtube: '#ff3b30',
  reddit: '#ff6a00',
  newsletter: '#0a84ff',
  blog: '#30b350',
  webpage: '#2eb5c9',
  'web-capture': '#5e5ce6'
};

// Inter, when the app's copy is reachable (in-app viewer); otherwise the system stack takes over.
function interFontFace() {
  try {
    const file = require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
    return `@font-face { font-family: 'Inter Variable'; font-weight: 100 900; font-display: swap; src: url('${require('url').pathToFileURL(file).href}') format('woff2-variations'); }`;
  } catch { return ''; }
}

/**
 * Generate a full HTML digest page
 */
function renderHTML(items, options = {}) {
  const {
    title = 'Personal Content Digest',
    aiDigest = null,
    aiError = null,
    aiPending = false,
    aiPendingModel = null,
    aiGeneratedAt = null,
    theme = 'dark',
    generatedAt = new Date(),
    readIds = new Set(),
    digestBrowser = 'internal',
    previousItemIds = new Set(),
    digestFontSize = 'medium',
    sourceErrors = []
  } = options;

  const fontSizeMap = { small: '12px', medium: '14px', large: '17px' };
  const baseFontSize = fontSizeMap[digestFontSize] || '14px';

  const readIdsSet = readIds instanceof Set ? readIds : new Set(readIds || []);

  const dateStr = generatedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = generatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Group by category (Cybersecurity, AI, …) — far more useful in a digest than by feed type.
  const byType = {};
  for (const item of items) {
    const t = item.category || item.sourceType || 'General';
    if (!byType[t]) byType[t] = [];
    byType[t].push(item);
  }

  const totalUnread = items.filter(i => !readIdsSet.has(i.id)).length;

  const sidebarHTML = Object.entries(byType).map(([type, typeItems]) => {
    const unread = typeItems.filter(i => !readIdsSet.has(i.id)).length;
    const badgeClass = unread > 0 ? 'badge badge-unread' : 'badge badge-read';
    const badgeLabel = unread > 0 ? `${unread} unread` : `${typeItems.length}`;
    return `
    <button class="sidebar-group" data-filter="${escapeHTML(type)}">
      <span class="sidebar-label">${escapeHTML(type)}</span> <span class="${badgeClass}">${badgeLabel}</span>
    </button>`;
  }).join('');

  const prevIds = previousItemIds instanceof Set ? previousItemIds : new Set(previousItemIds || []);
  const newSinceCount = prevIds.size > 0 ? items.filter(i => !prevIds.has(i.id)).length : 0;
  const itemsHTML = items.map((item, i) => renderItemHTML(item, readIdsSet, prevIds, i)).join('\n');

  const aiAgo = aiGeneratedAt ? timeAgo(aiGeneratedAt) : null;
  const aiSection = aiDigest ? `
    <section class="ai-digest">
      <h2>${icon('ai')} AI Digest${aiAgo ? `<span class="ai-ago">updated ${escapeHTML(aiAgo)}</span>` : ''}</h2>
      <div class="ai-content">${marked.parse(aiDigest)}</div>
    </section>` : (aiPending ? `
    <section class="ai-digest">
      <h2>${icon('ai')} AI Digest</h2>
      <div class="ai-content" style="display:flex;align-items:center;gap:10px">
        <span class="ai-spinner"></span>
        <span>Generating with <strong>${escapeHTML(aiPendingModel || 'the model')}</strong>… this runs in the background. Reopen the digest in a moment.</span>
      </div>
    </section>` : (aiError ? `
    <section class="ai-digest" style="background:rgba(209,52,56,0.1);border:1px solid rgba(209,52,56,0.4)">
      <h2 style="color:#ff8a8a">${icon('ai')} AI Digest Generation Failed</h2>
      <div class="ai-content" style="color:#ff8a8a">${escapeHTML(aiError)}</div>
    </section>` : ''));

  const errorBanner = (sourceErrors && sourceErrors.length) ? `
    <section class="error-banner">
      <div class="error-banner-head">⚠️ ${sourceErrors.length} source${sourceErrors.length !== 1 ? 's' : ''} could not be fetched</div>
      <ul class="error-banner-list">
        ${sourceErrors.map(e => `<li><strong>${escapeHTML(e.name || 'Unknown source')}</strong> — ${escapeHTML(e.error || 'Unknown error')}</li>`).join('')}
      </ul>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  <style>
    ${interFontFace()}
    :root {
      --bg: #1c1c1e; --surface: #252527; --card: #2c2c2e; --card-hover: #333336;
      --accent: #0a84ff; --accent-soft: rgba(10,132,255,0.14);
      --text: #f5f5f7; --text2: #a1a1a6; --text3: #6e6e73;
      --sep: rgba(255,255,255,0.09); --fill: rgba(120,120,128,0.24);
      --glass: rgba(28,28,30,0.78);
      --shadow: 0 8px 26px rgba(0,0,0,0.45);
      --nav-h: 0px; --head-h: 72px;
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
      color-scheme: dark;
    }
    body.theme-light {
      --bg: #ffffff; --surface: #f5f5f7; --card: #f5f5f7; --card-hover: #ececf0;
      --accent: #007aff; --accent-soft: rgba(0,122,255,0.1);
      --text: #1d1d1f; --text2: #6e6e73; --text3: #a1a1a6;
      --sep: rgba(60,60,67,0.13); --fill: rgba(120,120,128,0.12);
      --glass: rgba(255,255,255,0.8);
      --shadow: 0 8px 26px rgba(0,0,0,0.12);
      color-scheme: light;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: transparent; border: 3px solid transparent; border-radius: 10px; background-clip: padding-box; transition: background 0.3s; }
    ::-webkit-scrollbar-thumb:hover { background: var(--fill); background-clip: padding-box; }
    html.scrolling ::-webkit-scrollbar-thumb { background: var(--fill); background-clip: padding-box; }
    body {
      font-family: 'Inter Variable', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
      font-size: ${baseFontSize};
      background: var(--bg);
      color: var(--text);
      line-height: 1.55;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
    .pk-i { vertical-align: -0.14em; flex-shrink: 0; }

    /* ── Navigation toolbar (shown via JS inside the in-app viewer) ── */
    .nav-toolbar {
      display: none; align-items: center; gap: 6px; position: sticky; top: 0; z-index: 200; height: 40px; padding: 5px 12px;
      background: var(--glass); backdrop-filter: blur(24px) saturate(180%); border-bottom: 1px solid var(--sep);
    }
    .nav-btn { display: inline-flex; align-items: center; justify-content: center; padding: 5px 9px; border-radius: 8px; color: var(--text2); flex-shrink: 0; transition: background 0.15s, color 0.15s; }
    .nav-btn:disabled { opacity: 0.3; cursor: default; }
    .nav-btn:not(:disabled):hover { background: var(--fill); color: var(--text); }
    .nav-url { flex: 1; min-width: 0; font-size: 12px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--fill); border-radius: 8px; padding: 4px 12px; }
    .nav-sep { width: 1px; height: 18px; background: var(--sep); flex-shrink: 0; }
    .nav-btn-close { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--accent); background: var(--accent-soft); white-space: nowrap; }
    .nav-btn-close:hover { filter: brightness(1.15); }

    /* ── Header ── */
    .header {
      position: sticky; top: var(--nav-h); z-index: 100; min-height: var(--head-h); padding: 14px 32px;
      display: flex; align-items: center; justify-content: space-between; gap: 20px;
      background: var(--glass); backdrop-filter: blur(24px) saturate(180%); border-bottom: 1px solid var(--sep);
    }
    .header-title { font-size: 20px; font-weight: 700; letter-spacing: -0.025em; }
    .header-title .pk-i { color: var(--accent); }
    .header-meta { color: var(--text2); font-size: 0.86em; margin-top: 1px; }
    .header-meta strong { color: var(--accent); font-weight: 600; }
    .header-stats { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .stat { padding: 3px 11px; border-radius: 999px; font-size: 0.8em; font-weight: 550; color: var(--text2); background: var(--fill); }

    /* ── Layout ── */
    .layout { display: grid; grid-template-columns: 224px 1fr; min-height: calc(100vh - var(--head-h) - var(--nav-h)); }
    .sidebar {
      position: sticky; top: calc(var(--head-h) + var(--nav-h)); height: calc(100vh - var(--head-h) - var(--nav-h)); overflow-y: auto;
      padding: 18px 10px; background: var(--surface); border-right: 1px solid var(--sep);
    }
    .sidebar-title { padding: 0 10px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text3); }
    .sidebar-group { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 7px 10px; margin-bottom: 1px; border-radius: 8px; text-align: left; transition: background 0.15s; }
    .sidebar-group:hover { background: var(--fill); }
    .sidebar-group.active { background: var(--accent-soft); color: var(--accent); }
    .sidebar-label { font-size: 0.93em; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { border-radius: 9px; padding: 0 7px; font-size: 11px; font-weight: 600; line-height: 18px; flex-shrink: 0; }
    .badge-unread { background: var(--accent); color: #fff; }
    .badge-read { background: var(--fill); color: var(--text2); }
    .main { padding: 24px 32px 40px; max-width: 1000px; margin: 0 auto; width: 100%; min-width: 0; }

    /* ── AI digest + notices ── */
    .ai-digest { padding: 24px 28px; margin-bottom: 28px; border-radius: 20px; background: var(--accent-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent); animation: rise 0.6s var(--ease) both; }
    .ai-digest h2 { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; font-size: 1.1em; font-weight: 650; letter-spacing: -0.015em; color: var(--accent); }
    .ai-ago { font-size: 0.8em; font-weight: 450; color: var(--text2); }
    .ai-content { line-height: 1.7; }
    .ai-content h1, .ai-content h2, .ai-content h3 { margin: 18px 0 8px; font-size: 1.05em; letter-spacing: -0.015em; color: var(--text); }
    .ai-content p { margin: 8px 0; }
    .ai-content ul, .ai-content ol { padding-left: 22px; }
    .ai-content li { margin: 4px 0; }
    .ai-content a { color: var(--accent); text-decoration: none; }
    .ai-content a:hover { text-decoration: underline; }
    .ai-content code { padding: 1px 6px; border-radius: 5px; background: var(--fill); font-size: 0.9em; }
    .ai-spinner { width: 16px; height: 16px; flex: 0 0 auto; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; animation: ai-spin 0.7s linear infinite; }
    @keyframes ai-spin { to { transform: rotate(360deg); } }
    .error-banner { padding: 16px 20px; margin-bottom: 24px; border-radius: 16px; background: rgba(255,69,58,0.1); box-shadow: inset 0 0 0 1px rgba(255,69,58,0.3); }
    .error-banner-head { font-weight: 650; color: #ff453a; margin-bottom: 8px; }
    .error-banner-list { padding-left: 20px; font-size: 0.93em; color: var(--text2); line-height: 1.7; }
    .error-banner-list strong { color: var(--text); }

    /* ── Search / filters ── */
    .search-bar { margin-bottom: 12px; }
    .search-wrap { position: relative; }
    .search-icon { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); display: flex; color: var(--text3); pointer-events: none; }
    .search-input { width: 100%; padding: 9px 14px 9px 38px; font: inherit; font-size: 0.93em; color: var(--text); background: var(--fill); border: 1px solid transparent; border-radius: 10px; outline: none; transition: border-color 0.2s, box-shadow 0.2s, background 0.2s; }
    .search-input:focus { background: var(--bg); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
    .search-input::placeholder { color: var(--text3); }
    .filter-bar { display: flex; gap: 6px; margin-bottom: 20px; flex-wrap: wrap; }
    .filter-btn { padding: 5px 14px; border-radius: 999px; font-size: 0.86em; font-weight: 550; color: var(--text2); background: var(--fill); transition: background 0.2s, color 0.2s, transform 0.2s var(--ease); }
    .filter-btn:hover { background: color-mix(in srgb, var(--fill) 70%, var(--text2) 30%); }
    .filter-btn:active { transform: scale(0.96); }
    .filter-btn.active { background: var(--accent); color: #fff; }
    .no-results { text-align: center; color: var(--text2); padding: 48px 0; }

    /* ── Stories ── */
    .items-grid { display: flex; flex-direction: column; gap: 10px; }
    .item-card {
      display: flex; gap: 16px; padding: 14px 16px; border-radius: 16px; text-decoration: none; color: inherit;
      background: var(--card); transition: background 0.2s, transform 0.35s var(--ease), box-shadow 0.35s var(--ease);
      animation: rise 0.55s var(--ease) both; animation-delay: calc(var(--i, 0) * 28ms);
    }
    .item-card:hover { background: var(--card-hover); transform: translateY(-2px); box-shadow: var(--shadow); }
    .item-card:active { transform: scale(0.995); }
    .item-thumb, .item-thumb-placeholder { width: 96px; height: 66px; border-radius: 10px; flex-shrink: 0; object-fit: cover; background: var(--fill); }
    .item-thumb-placeholder { display: flex; align-items: center; justify-content: center; font-size: 22px; color: var(--text3); }
    .item-body { flex: 1; min-width: 0; }
    .item-title { font-size: 1.05em; font-weight: 650; letter-spacing: -0.012em; line-height: 1.32; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .item-desc { font-size: 0.9em; color: var(--text2); margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .item-meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .source-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; color: #fff; }
    .item-date, .item-author { font-size: 0.8em; color: var(--text3); }
    .item-card.is-read { opacity: 0.55; }
    .item-card.is-read .item-title { font-weight: 500; }
    .new-badge { margin-left: 6px; padding: 1px 6px; border-radius: 5px; font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; vertical-align: middle; color: #fff; background: #30d158; }
    .footer { padding: 18px 32px; font-size: 12px; color: var(--text3); text-align: center; border-top: 1px solid var(--sep); }
    @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    @media (max-width: 768px) { .layout { grid-template-columns: 1fr; } .sidebar { display: none; } .main { padding: 16px; } .header { padding: 12px 16px; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition-duration: 0.001ms !important; } }
  </style>
</head>
<body class="theme-${theme}">
  <!-- Navigation toolbar — shown via JS when running inside the in-app viewer -->
  <div class="nav-toolbar" id="navToolbar">
    <button class="nav-btn" id="navBtnBack"    title="Back"    aria-label="Back"    disabled>${icon('back', 15)}</button>
    <button class="nav-btn" id="navBtnForward" title="Forward" aria-label="Forward" disabled>${icon('forward', 15)}</button>
    <button class="nav-btn" id="navBtnReload"  title="Reload"  aria-label="Reload">${icon('refresh', 15)}</button>
    <button class="nav-btn" id="navBtnHome"    title="Return to digest" aria-label="Home">${icon('home', 15)}</button>
    <div class="nav-sep"></div>
    <div class="nav-url" id="navUrlBar">PulseKeeper Digest</div>
    <div class="nav-sep"></div>
    <button class="nav-btn" id="navBtnExternal" title="Open current page in system browser" aria-label="Open in browser">${icon('external', 15)}</button>
    <div class="nav-sep"></div>
    <button class="nav-btn-close" id="navBtnClose" title="Return to digest">${icon('close', 14)} Digest</button>
  </div>
  <header class="header">
    <div>
      <div class="header-title" style="display:flex;align-items:center;gap:10px">${icon('newspaper')} ${escapeHTML(title)}</div>
      <div class="header-meta">${dateStr} at ${timeStr}${totalUnread > 0 ? ` · <strong style="color:var(--accent2)">${totalUnread} unread</strong>` : ''}${newSinceCount > 0 ? ` · <strong style="color:#6ccb5f">${newSinceCount} new since last digest</strong>` : ''}</div>
    </div>
    <div class="header-stats">
      ${Object.entries(byType).map(([type, typeItems]) =>
        `<div class="stat">${escapeHTML(type)} · ${typeItems.length}</div>`
      ).join('')}
    </div>
  </header>
  <div class="layout">
    <nav class="sidebar">
      <div class="sidebar-title">Categories</div>
      <button class="sidebar-group active" data-filter="all"><span class="sidebar-label">All stories</span> <span class="badge badge-read">${items.length}</span></button>
      ${sidebarHTML}
    </nav>
    <main class="main">
      ${errorBanner}
      ${aiSection}
      <div class="search-bar">
        <div class="search-wrap">
          <span class="search-icon">${icon('search', 15)}</span>
          <input class="search-input" id="searchInput" type="search" placeholder="Search titles and descriptions…" autocomplete="off">
        </div>
      </div>
      <div class="filter-bar" id="filterBar">
        <button class="filter-btn active" data-filter="all">All (${items.length})</button>
        ${Object.entries(byType).map(([type, typeItems]) =>
          `<button class="filter-btn" data-filter="${escapeHTML(type)}">${escapeHTML(type)} (${typeItems.length})</button>`
        ).join('')}
      </div>
      <div class="items-grid" id="itemsGrid">
        ${itemsHTML}
      </div>
    </main>
  </div>
  <footer class="footer">
    Generated by PulseKeeper · ${items.length} stories in ${Object.keys(byType).length} ${Object.keys(byType).length === 1 ? 'category' : 'categories'}
  </footer>
  <script>
    const DIGEST_BROWSER = '${digestBrowser}';

    // Auto-hide scrollbars: reveal while scrolling, hide ~0.8s after idle.
    (function () {
      let idle;
      const root = document.documentElement;
      window.addEventListener('scroll', function () {
        root.classList.add('scrolling');
        clearTimeout(idle);
        idle = setTimeout(function () { root.classList.remove('scrolling'); }, 800);
      }, true);
    })();

    // ── Search + filter state ─────────────────────────────────────────────────
    let activeFilterType = 'all';
    let searchQuery = '';

    function applySearchFilter() {
      const q = searchQuery.toLowerCase();
      let visible = 0;
      document.querySelectorAll('.item-card').forEach(card => {
        const typeMatch = activeFilterType === 'all' || card.dataset.type === activeFilterType;
        const textMatch = !q || card.dataset.title.includes(q) || card.dataset.desc.includes(q);
        const show = typeMatch && textMatch;
        card.style.display = show ? 'flex' : 'none';
        if (show) visible++;
      });
      let noRes = document.getElementById('noResults');
      if (!visible) {
        if (!noRes) {
          noRes = document.createElement('div');
          noRes.id = 'noResults';
          noRes.className = 'no-results';
          noRes.textContent = 'No items match your search.';
          document.getElementById('itemsGrid').after(noRes);
        }
      } else if (noRes) {
        noRes.remove();
      }
    }

    // ── Filter bar ────────────────────────────────────────────────────────────
    document.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      activeFilterType = btn.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === activeFilterType));
      applySearchFilter();
    });

    // ── Search input ──────────────────────────────────────────────────────────
    document.getElementById('searchInput').addEventListener('input', function() {
      searchQuery = this.value.trim();
      applySearchFilter();
    });

    // ── Link handling ─────────────────────────────────────────────────────────
    document.querySelectorAll('a.item-card').forEach(a => {
      if (DIGEST_BROWSER === 'external') {
        a.addEventListener('click', e => {
          e.preventDefault();
          if (window.digestNav) window.digestNav.openExternal(a.href);
        });
      } else {
        // Internal: navigate within the viewer window
        a.target = '_self';
      }
    });

    // ── Navigation toolbar ────────────────────────────────────────────────────
    if (window.digestNav) {
      // Show toolbar and activate --nav-h offset
      const toolbar = document.getElementById('navToolbar');
      toolbar.style.display = 'flex';
      document.documentElement.style.setProperty('--nav-h', '40px');

      const btnBack     = document.getElementById('navBtnBack');
      const btnForward  = document.getElementById('navBtnForward');
      const btnReload   = document.getElementById('navBtnReload');
      const btnHome     = document.getElementById('navBtnHome');
      const btnExternal = document.getElementById('navBtnExternal');
      const btnClose    = document.getElementById('navBtnClose');
      const urlBar      = document.getElementById('navUrlBar');

      btnBack.addEventListener('click',     () => window.digestNav.back());
      btnForward.addEventListener('click',  () => window.digestNav.forward());
      btnReload.addEventListener('click',   () => window.digestNav.reload());
      btnHome.addEventListener('click',     () => window.digestNav.home());
      btnExternal.addEventListener('click', () => window.digestNav.openExternal(location.href));
      btnClose.addEventListener('click',    () => window.digestNav.home());

      window.digestNav.onNavState(state => {
        btnBack.disabled    = !state.canGoBack;
        btnForward.disabled = !state.canGoForward;
        urlBar.textContent  = state.title || state.url || 'PulseKeeper Digest';
        // Show the close/back-to-digest button only when browsing an external page
        const onDigest = state.url && state.url.startsWith('file://');
        btnClose.style.display = onDigest ? 'none' : 'block';
      });
    }
  </script>
</body>
</html>`;
}

function renderItemHTML(item, readIdsSet = new Set(), prevIds = new Set(), index = 0) {
  const color = SOURCE_COLORS[item.sourceType] || '#666';
  const tIcon = typeIcon(item.sourceType);
  const dateStr = formatDate(item.publishedAt);
  const isRead = readIdsSet.has(item.id);
  const isNew = prevIds.size > 0 && !prevIds.has(item.id);
  const thumb = item.thumbnail
    ? `<img class="item-thumb" src="${escapeHTML(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="item-thumb-placeholder">${tIcon}</div>`;

  return `<a class="item-card${isRead ? ' is-read' : ''}" style="--i:${Math.min(index, 14)}" href="${escapeHTML(item.url)}" target="_blank" rel="noopener" data-type="${escapeHTML(item.category || item.sourceType || 'General')}" data-id="${escapeHTML(item.id || '')}" data-title="${escapeHTML((item.title || '').toLowerCase())}" data-desc="${escapeHTML((item.description || '').toLowerCase())}">
    ${thumb}
    <div class="item-body">
      <div class="item-title">${escapeHTML(item.title)}${isNew ? '<span class="new-badge">New</span>' : ''}</div>
      <div class="item-desc">${escapeHTML(item.description || '')}</div>
      <div class="item-meta">
        <span class="source-badge" style="background:${color}">${tIcon} ${escapeHTML(item.sourceName)}</span>
        ${item.author ? `<span class="item-author">${escapeHTML(item.author)}</span>` : ''}
        <span class="item-date">${dateStr}</span>
      </div>
    </div>
  </a>`;
}

/**
 * Generate Markdown digest
 */
function renderMarkdown(items, options = {}) {
  const { title = 'Personal Content Digest', aiDigest = null, generatedAt = new Date() } = options;
  const dateStr = generatedAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const byType = {};
  for (const item of items) {
    const t = item.sourceType || 'rss';
    if (!byType[t]) byType[t] = [];
    byType[t].push(item);
  }

  let md = `# ${title}\n\n`;
  md += `_Generated: ${dateStr} · ${items.length} items_\n\n`;
  md += `---\n\n`;

  if (aiDigest) {
    md += `## AI Digest\n\n${aiDigest}\n\n---\n\n`;
  }

  for (const [type, typeItems] of Object.entries(byType)) {
    md += `## ${type.charAt(0).toUpperCase() + type.slice(1)}\n\n`;
    for (const item of typeItems) {
      md += `### [${item.title}](${item.url})\n`;
      md += `**Source:** ${item.sourceName}`;
      if (item.author) md += ` · **By:** ${item.author}`;
      md += ` · **Date:** ${formatDate(item.publishedAt)}\n\n`;
      if (item.description) md += `${item.description}\n\n`;
      md += `---\n\n`;
    }
  }

  return md;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Human-friendly relative time, e.g. "just now", "10 min ago", "1 hour ago".
function timeAgo(date) {
  const d = date instanceof Date ? date : new Date(date);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (!isFinite(sec)) return '';
  if (sec < 45) return 'just now';
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

module.exports = { renderHTML, renderMarkdown, SOURCE_COLORS };
