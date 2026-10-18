'use strict';

// Shared renderer helpers: formatting, toasts, dialogs, menus, theme. Loaded before news.js / app.js.

const api = window.pcbAPI;
const icon = (name, size) => window.PKIcons.icon(name, size);
const $ = id => document.getElementById(id);

const TYPE_LABEL = {
  rss: 'RSS / Atom', podcast: 'Podcast', youtube: 'YouTube', reddit: 'Reddit', newsletter: 'Newsletter',
  blog: 'Blog', webpage: 'Web Page', 'web-capture': 'Browser Capture'
};
const typeTile = type => `<span class="tile t-${type}">${icon(type)}</span>`;

function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Time ──────────────────────────────────────────────────────────────────────
function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  if (!isFinite(diff)) return '';
  if (diff < 45000) return 'just now';
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.round(diff / 86400000)}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dayLabel(date) {
  const d = new Date(date);
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

// ── Toasts ────────────────────────────────────────────────────────────────────
function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(type === 'error' ? 'warning' : 'circleok')}<span>${escapeHTML(message)}</span>`;
  $('toasts').appendChild(el);
  Motion.toast(el, type === 'error' ? 5200 : 3000);
}

// ── Dialogs ───────────────────────────────────────────────────────────────────
function confirmDialog({ title, body, ok = 'OK', danger = false }) {
  return new Promise(resolve => {
    $('confirmTitle').textContent = title;
    $('confirmBody').textContent = body || '';
    const okBtn = $('confirmOk');
    okBtn.textContent = ok;
    okBtn.classList.toggle('btn-danger-fill', danger);
    const scrim = $('confirmScrim');
    const finish = result => {
      scrim.removeEventListener('click', onScrim);
      $('confirmCancel').onclick = okBtn.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      Motion.sheetClose(scrim, scrim.firstElementChild);
      resolve(result);
    };
    const onScrim = e => { if (e.target === scrim) finish(false); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
    scrim.addEventListener('click', onScrim);
    document.addEventListener('keydown', onKey, true);
    $('confirmCancel').onclick = () => finish(false);
    okBtn.onclick = () => finish(true);
    Motion.sheetOpen(scrim, scrim.firstElementChild);
    okBtn.focus();
  });
}

// ── Menus ─────────────────────────────────────────────────────────────────────
let openMenuEl = null;
function closeMenu() {
  if (!openMenuEl) return;
  const el = openMenuEl;
  openMenuEl = null;
  if (window.gsap && Motion.enabled) gsap.to(el, { opacity: 0, scale: 0.96, duration: 0.14, onComplete: () => el.remove() });
  else el.remove();
  document.removeEventListener('pointerdown', onMenuOutside, true);
  document.removeEventListener('keydown', onMenuKey, true);
}
const onMenuOutside = e => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); };
const onMenuKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };

function openMenu(anchor, items, { current, onPick }) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map(i =>
    `<button role="menuitemradio" aria-checked="${i.value === current}" data-value="${i.value}">${escapeHTML(i.label)}<span class="check">${icon('check')}</span></button>`).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.top = `${r.bottom + 6}px`;
  el.style.left = `${Math.max(8, r.right - el.offsetWidth)}px`;
  el.style.transformOrigin = 'top right';
  if (window.gsap && Motion.enabled) gsap.fromTo(el, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.7)' });
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-value]');
    if (b) { closeMenu(); onPick(b.dataset.value); }
  });
  openMenuEl = el;
  document.addEventListener('pointerdown', onMenuOutside, true);
  document.addEventListener('keydown', onMenuKey, true);
  el.querySelector('button').focus();
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const ACCENTS = {
  blue: '#007aff', purple: '#af52de', pink: '#ff2d55', red: '#ff3b30', orange: '#ff9500', green: '#28a745', graphite: '#8e8e93'
};
function applyAppearance(display = {}) {
  const root = document.documentElement;
  root.dataset.theme = display.theme === 'light' ? 'light' : 'dark';
  root.dataset.accent = ACCENTS[display.accentColor] ? display.accentColor : 'blue';
}

// ── Misc ──────────────────────────────────────────────────────────────────────
// Scrollbars appear only while scrolling; a header gets a hairline once its body has scrolled.
(function setupScrolling() {
  let idle;
  const root = document.documentElement;
  window.addEventListener('scroll', e => {
    root.classList.add('scrolling');
    clearTimeout(idle);
    idle = setTimeout(() => root.classList.remove('scrolling'), 800);
    const header = e.target.closest?.('.view, .reader')?.querySelector('.view-header, .reader-head');
    if (header && e.target.scrollTop !== undefined && (e.target.classList.contains('view-body') || e.target.classList.contains('news-scroll'))) {
      header.classList.toggle('scrolled', e.target.scrollTop > 2);
    }
  }, true);
})();

// Broken thumbnails (hotlink protection, 404s) are dropped rather than shown as empty boxes.
function onImageError(container, handler) {
  container.addEventListener('error', e => { if (e.target.tagName === 'IMG') handler(e.target); }, true);
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
