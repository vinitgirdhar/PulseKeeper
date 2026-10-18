'use strict';

// Tray quick-view: latest stories, filtered by category, one click to open.

const api = window.pcbAPI;
const $ = id => document.getElementById(id);
const icon = (name, size) => window.PKIcons.icon(name, size);

let items = [];
let category = 'all';
let search = '';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  if (!isFinite(diff)) return '';
  if (diff < 45000) return 'now';
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  if (diff < 7 * 86400000) return `${Math.round(diff / 86400000)}d`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Scrollbars only while scrolling
(function () {
  let idle;
  window.addEventListener('scroll', () => {
    document.documentElement.classList.add('scrolling');
    clearTimeout(idle);
    idle = setTimeout(() => document.documentElement.classList.remove('scrolling'), 800);
  }, true);
})();

function applyAppearance(display = {}) {
  document.documentElement.dataset.theme = display.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.accent = display.accentColor || 'blue';
}

const visible = () => items.filter(i =>
  (category === 'all' || i.category === category) &&
  (!search || `${i.title} ${i.description} ${i.sourceName}`.toLowerCase().includes(search)));

async function refresh({ animate = true } = {}) {
  try {
    const [latest, settings] = await Promise.all([api.popup.getLatest(), api.settings.get()]);
    items = latest;
    applyAppearance(settings.display);
    if (category !== 'all' && !items.some(i => i.category === category)) category = 'all';
    renderChips();
    render(animate);
  } catch (e) {
    $('itemsList').innerHTML = `<div class="empty">${icon('warning')}<h3>Couldn’t load stories</h3><p>${esc(e.message)}</p></div>`;
  }
}

function renderChips() {
  const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
  const unread = list => list.filter(i => !i.read).length;
  const chip = (value, label, n) => `<button class="chip-btn" role="tab" aria-selected="${value === category}" data-cat="${esc(value)}">${esc(label)}${n ? ` <b>${n}</b>` : ''}</button>`;
  $('chips').innerHTML = chip('all', 'All', unread(items)) + cats.map(c => chip(c, c, unread(items.filter(i => i.category === c)))).join('');
  updateFade();
}

function updateFade() {
  const row = $('chips');
  $('chipsWrap').classList.toggle('scroll-start', row.scrollLeft > 4);
  $('chipsWrap').classList.toggle('scroll-end', row.scrollLeft + row.clientWidth >= row.scrollWidth - 4);
}

function itemHTML(it, i) {
  return `<div class="item ${it.read ? 'read' : 'unread'}" data-i="${i}" role="button" tabindex="0">
    <div class="item-body">
      <div class="item-meta"><span class="tile t-${it.sourceType}">${icon(it.sourceType)}</span><span class="item-source">${esc(it.sourceName)}</span><span>·</span><span>${timeAgo(it.publishedAt)}</span></div>
      <div class="item-title">${esc(it.title)}</div>
    </div>
    ${it.thumbnail ? `<img class="item-thumb" src="${esc(it.thumbnail)}" alt="" loading="lazy">` : ''}
  </div>`;
}

let shown = [];
function render(animate) {
  shown = visible();
  $('itemCount').textContent = `${shown.length} ${shown.length === 1 ? 'story' : 'stories'}`;
  const list = $('itemsList');
  if (!shown.length) {
    list.innerHTML = items.length
      ? `<div class="empty">${icon('search')}<h3>Nothing here</h3><p>No stories match.</p></div>`
      : `<div class="empty">${icon('news')}<h3>No stories yet</h3><p>Press refresh to fetch your sources.</p></div>`;
    return;
  }
  list.innerHTML = shown.map(itemHTML).join('');
  if (animate) Motion.enter(list.querySelectorAll('.item'), { y: 8, each: 0.025, max: 12, duration: 0.4 });
}

function open(i) {
  const it = shown[i];
  if (!it) return;
  if (it.url) api.ui.openExternal(it.url);
  if (!it.read) {
    it.read = true;
    api.content.markRead([it.id]);
    const el = $('itemsList').querySelector(`[data-i="${i}"]`);
    el?.classList.replace('unread', 'read');
    renderChips();
  }
}

let hudTimer;
function hud(text, undo) {
  const el = $('hud');
  clearTimeout(hudTimer);
  el.hidden = false;
  el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button>Undo</button>' : ''}`;
  if (window.gsap && Motion.enabled) gsap.fromTo(el, { y: 14, opacity: 0, scale: 0.92 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.6)' });
  el.querySelector('button')?.addEventListener('click', () => { clearTimeout(hudTimer); el.hidden = true; undo(); });
  hudTimer = setTimeout(() => { el.hidden = true; }, undo ? 4000 : 1800);
}

function markAllRead() {
  const list = visible().filter(i => !i.read);
  if (!list.length) { hud('Everything is already read'); return; }
  // Commit after a few seconds so the HUD can offer Undo.
  let cancelled = false;
  hud(`Marking ${list.length} as read…`, () => { cancelled = true; });
  setTimeout(async () => {
    if (cancelled) return;
    await api.content.markAllRead(category === 'all' ? {} : { category });
    refresh({ animate: false });
  }, 4000);
}

async function copyMarkdown() {
  const list = visible();
  if (!list.length) return;
  const md = `# PulseKeeper — ${new Date().toLocaleDateString()}\n\n` +
    list.map(i => `## [${i.title}](${i.url})\n_${i.sourceName} · ${timeAgo(i.publishedAt)}_\n\n${i.description || ''}`).join('\n\n---\n\n');
  try { await navigator.clipboard.writeText(md); hud('Copied as Markdown'); } catch { hud('Couldn’t copy'); }
}

function setCollecting(on) {
  $('statusDot').className = `dot ${on ? 'busy' : 'ok'}`;
  $('statusText').textContent = on ? 'Refreshing…' : 'Updated';
  $('btnRefreshPopup').classList.toggle('spinning', on);
}

function init() {
  window.PKIcons.hydrate();
  $('chips').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    category = b.dataset.cat;
    renderChips();
    render(true);
  });
  $('chips').addEventListener('wheel', e => { if (e.deltaY) { e.preventDefault(); $('chips').scrollBy({ left: e.deltaY * 1.5, behavior: 'smooth' }); } }, { passive: false });
  $('chips').addEventListener('scroll', updateFade, { passive: true });
  $('popupSearch').addEventListener('input', e => { search = e.target.value.trim().toLowerCase(); render(false); });
  $('itemsList').addEventListener('click', e => { const el = e.target.closest('.item'); if (el) open(+el.dataset.i); });
  $('itemsList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.item')) open(+e.target.dataset.i); });
  $('itemsList').addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);

  $('btnRefreshPopup').addEventListener('click', () => api.sources.collectAll().then(() => refresh()));
  $('btnViewAll').addEventListener('click', () => { api.output.openDigest(); api.popup.close(); });
  $('btnSettings').addEventListener('click', () => { api.ui.openSettings(); api.popup.close(); });
  $('btnMarkAllRead').addEventListener('click', markAllRead);
  $('btnCopy').addEventListener('click', copyMarkdown);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') api.popup.close(); });

  api.on.collectStart(() => setCollecting(true));
  api.on.collectComplete(() => { setCollecting(false); refresh({ animate: false }); });
  api.on.themeOsSync(({ theme }) => applyAppearance({ ...{ theme }, accentColor: document.documentElement.dataset.accent }));

  // The window is reused (hidden/shown), so reload whenever it regains focus.
  window.addEventListener('focus', () => refresh({ animate: false }));
  refresh();
}

init();
