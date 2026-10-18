'use strict';

// News view: the channel tree in the sidebar (categories → sources), the story
// list, and the reader pane. All filtering/search/sorting/paging happens in the
// main process (content:query); this file only renders and animates.

const News = (() => {
  const PAGE = 60;
  const READER_W = 460;
  const SORTS = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'source', label: 'By source' }
  ];

  const state = {
    sel: { kind: 'all', id: null },   // kind: all | category | source
    filter: 'all',                    // all | unread
    search: '',
    sort: 'newest',
    channels: null,
    items: [], total: 0, done: true, loading: false,
    selectedId: null, readerOpen: false,
    lastGroup: null, structure: '', token: 0,
    active: true
  };

  let collapsed = new Set();
  try { collapsed = new Set(JSON.parse(localStorage.getItem('pk.collapsed') || '[]')); } catch { /* storage unavailable */ }
  const saveCollapsed = () => { try { localStorage.setItem('pk.collapsed', JSON.stringify([...collapsed])); } catch { /* ignore */ } };

  const list = () => $('feedList');
  const byId = id => state.items.find(i => i.id === id);

  // ── Channel tree ───────────────────────────────────────────────────────────
  function channelsHTML(tree) {
    return tree.categories.map(c => {
      const isCollapsed = collapsed.has(c.name);
      return `<div class="cat-group" data-cat="${escapeHTML(c.name)}">
        <button class="side-item cat ${isCollapsed ? 'collapsed' : ''}" data-view="news" data-channel="category" data-id="${escapeHTML(c.name)}">
          <span class="twisty" data-twisty aria-label="Expand or collapse">${icon('chevrondown')}</span>
          <span class="side-label-text">${escapeHTML(c.name)}</span>
          <span class="badge" data-badge="c:${escapeHTML(c.name)}"></span>
        </button>
        <div class="cat-children" ${isCollapsed ? 'hidden' : ''}>
          ${c.sources.map(s => `<button class="side-item chan" data-view="news" data-channel="source" data-id="${s.id}">
            ${typeTile(s.type)}
            <span class="side-label-text">${escapeHTML(s.name)}</span>
            ${s.error ? `<span class="warn side-icon" title="${escapeHTML(s.error)}">${icon('warning')}</span>` : ''}
            <span class="badge" data-badge="s:${s.id}"></span>
          </button>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  function setBadge(el, n) {
    const had = el.textContent;
    el.textContent = n ? String(n) : '';
    el.classList.toggle('hot', n > 0);
    if (n && had && had !== String(n)) Motion.pulse(el);
  }

  function applyChannels() {
    const tree = state.channels;
    const structure = JSON.stringify(tree.categories.map(c => [c.name, c.sources.map(s => [s.id, s.name, s.type, !!s.error])]));
    if (structure !== state.structure) {
      state.structure = structure;
      $('channels').innerHTML = channelsHTML(tree);
    }
    const unreadAll = $('badgeAll');
    if (parseInt(unreadAll.textContent, 10) !== tree.unread) { Motion.count(unreadAll, tree.unread); unreadAll.classList.toggle('hot', tree.unread > 0); }
    for (const c of tree.categories) {
      setBadge($('channels').querySelector(`[data-badge="c:${CSS.escape(c.name)}"]`), c.unread);
      for (const s of c.sources) setBadge($('channels').querySelector(`[data-badge="s:${s.id}"]`), s.unread);
    }
    // The selected channel vanished (source deleted / renamed category): fall back to everything.
    if (!findSelection()) { state.sel = { kind: 'all', id: null }; load(); }
    updateHeader();
    App.updateNav(true);
  }

  async function loadChannels() {
    state.channels = await api.content.channels();
    applyChannels();
  }
  const refreshChannelsSoon = debounce(() => loadChannels().catch(() => {}), 250);

  function findSelection() {
    const { kind, id } = state.sel;
    if (kind === 'all') return { name: 'All Stories', total: state.channels.total, unread: state.channels.unread };
    for (const c of state.channels.categories) {
      if (kind === 'category' && c.name === id) return { name: c.name, total: c.total, unread: c.unread };
      for (const s of c.sources) if (kind === 'source' && s.id === id) return { name: s.name, total: s.total, unread: s.unread, category: c.name };
    }
    return null;
  }

  /** The sidebar row that represents the current selection (falls back to its category when collapsed). */
  function currentRow() {
    const { kind, id } = state.sel;
    if (kind === 'all') return $('navAll');
    const row = [...$('channels').querySelectorAll('[data-channel]')].find(b => b.dataset.channel === kind && b.dataset.id === id);
    if (row && row.offsetHeight) return row;
    const cat = findSelection()?.category;
    return cat ? [...$('channels').querySelectorAll('[data-channel="category"]')].find(b => b.dataset.id === cat) : $('navAll');
  }

  function toggleCategory(name) {
    const open = collapsed.has(name);
    open ? collapsed.delete(name) : collapsed.add(name);
    saveCollapsed();
    const group = [...$('channels').children].find(g => g.dataset.cat === name);
    group.querySelector('.cat').classList.toggle('collapsed', !open);
    Motion.toggleOpen(group.querySelector('.cat-children'), open, () => App.updateNav(true));
  }

  // ── Selection / query ──────────────────────────────────────────────────────
  function select(kind, id = null) {
    state.sel = { kind, id };
    state.search = '';
    $('newsSearch').value = '';
    closeReader();
    $('newsScroll').scrollTop = 0;
    updateHeader();
    return load();
  }

  const query = () => ({
    sourceId: state.sel.kind === 'source' ? state.sel.id : undefined,
    category: state.sel.kind === 'category' ? state.sel.id : undefined,
    unreadOnly: state.filter === 'unread',
    search: state.search,
    sort: state.sort
  });

  function updateHeader() {
    const sel = state.channels && findSelection();
    $('newsTitle').textContent = sel?.name || 'All Stories';
    const n = state.total;
    const noun = n === 1 ? 'story' : 'stories';
    $('newsSubtitle').textContent = state.loading && !state.items.length ? ' '
      : state.search ? `${n} ${noun} matching “${state.search}”`
      : state.filter === 'unread' ? `${n} unread ${noun}`
      : `${n} ${noun}${sel?.unread ? ` · ${sel.unread} unread` : ''}`;
  }

  // ── List ───────────────────────────────────────────────────────────────────
  const groupOf = it => (state.sort === 'source' ? it.sourceName : dayLabel(it.publishedAt));

  function storyHTML(it) {
    return `<div class="story ${it.read ? 'read' : 'unread'} ${it.id === state.selectedId ? 'selected' : ''}" data-id="${escapeHTML(it.id)}" role="button" tabindex="0">
      <div class="story-body">
        <div class="story-meta">
          <span class="story-source">${typeTile(it.sourceType)}<span>${escapeHTML(it.sourceName)}</span></span>
          <span>·</span><time>${timeAgo(it.publishedAt)}</time>
        </div>
        <div class="story-title">${escapeHTML(it.title)}</div>
        ${it.description ? `<div class="story-desc">${escapeHTML(it.description)}</div>` : ''}
      </div>
      ${it.thumbnail ? `<img class="story-thumb" src="${escapeHTML(it.thumbnail)}" alt="" loading="lazy" decoding="async">` : ''}
    </div>`;
  }

  function heroHTML(it) {
    return `<div class="hero ${it.read ? 'read' : ''}" data-id="${escapeHTML(it.id)}" role="button" tabindex="0">
      <img src="${escapeHTML(it.thumbnail)}" alt="" decoding="async">
      <div class="hero-text">
        <div class="hero-kicker">${escapeHTML(it.sourceName)} · ${timeAgo(it.publishedAt)}</div>
        <div class="hero-title">${escapeHTML(it.title)}</div>
      </div>
    </div>`;
  }

  function rowsHTML(items, { hero }) {
    let html = '';
    items.forEach((it, i) => {
      const g = groupOf(it);
      if (g !== state.lastGroup) { html += `<div class="day">${escapeHTML(g)}</div>`; state.lastGroup = g; }
      html += hero && i === 0 ? heroHTML(it) : storyHTML(it);
    });
    return html;
  }

  function emptyHTML() {
    if (state.search) return `<div class="empty">${icon('search')}<h3>No results</h3><p>Nothing matches “${escapeHTML(state.search)}”.</p></div>`;
    if (state.filter === 'unread') return `<div class="empty">${icon('circleok')}<h3>You’re all caught up</h3><p>No unread stories here.</p></div>`;
    return `<div class="empty">${icon('news')}<h3>No stories yet</h3><p>Refresh to fetch your sources, or add one under Sources.</p><button class="btn btn-primary" data-act="refresh">${icon('refresh')}Refresh Now</button></div>`;
  }

  function skeleton() {
    list().innerHTML = Array.from({ length: 7 }, () => '<div class="story-skel"><div class="skeleton"></div><div class="skeleton"></div></div>').join('');
  }

  /**
   * (Re)load the list. `silent` keeps the current rows until the new ones arrive
   * and skips the entrance animation (background refreshes).
   */
  async function load({ silent = false } = {}) {
    const token = ++state.token;
    state.items = []; state.done = false; state.lastGroup = null; state.loading = true;
    if (!silent) skeleton();
    let res;
    try { res = await api.content.query({ ...query(), limit: PAGE, offset: 0 }); }
    catch (e) { if (token === state.token) list().innerHTML = `<div class="empty">${icon('warning')}<h3>Couldn’t load stories</h3><p>${escapeHTML(e.message)}</p></div>`; return; }
    if (token !== state.token) return;

    state.loading = false;
    state.items = res.items; state.total = res.total; state.done = res.items.length >= res.total;
    $('newPill').hidden = true;
    updateHeader();
    if (!res.items.length) { list().innerHTML = emptyHTML(); return; }

    const hero = state.sort === 'newest' && !state.search && !!res.items[0].thumbnail;
    list().innerHTML = rowsHTML(res.items, { hero });
    if (!silent) Motion.enter(list().querySelectorAll('.hero, .story'), { y: 12, each: 0.03 });
    $('feedMore').hidden = state.done;
  }

  async function loadMore() {
    if (state.loading || state.done) return;
    state.loading = true;
    const token = state.token;
    try {
      const res = await api.content.query({ ...query(), limit: PAGE, offset: state.items.length });
      if (token !== state.token) return;
      state.items.push(...res.items);
      state.total = res.total;
      state.done = state.items.length >= res.total || !res.items.length;
      list().insertAdjacentHTML('beforeend', rowsHTML(res.items, { hero: false }));
    } finally {
      state.loading = false;
      $('feedMore').hidden = state.done;
    }
  }

  // ── Read state ─────────────────────────────────────────────────────────────
  function setRead(item, read) {
    if (item.read === read) return;
    item.read = read;
    list().querySelectorAll(`[data-id="${CSS.escape(item.id)}"]`).forEach(el => {
      el.classList.toggle('read', read);
      el.classList.toggle('unread', !read);
    });
    (read ? api.content.markRead : api.content.markUnread)([item.id]).then(refreshChannelsSoon);
    if (state.readerOpen && state.selectedId === item.id) renderReaderHead(item);
  }

  async function markAll() {
    const sel = findSelection();
    if (!sel?.unread) { toast('Everything here is already read'); return; }
    const n = await api.content.markAllRead({ sourceId: query().sourceId, category: query().category });
    state.items.forEach(i => { i.read = true; });
    list().querySelectorAll('.story, .hero').forEach(el => { el.classList.add('read'); el.classList.remove('unread'); });
    toast(`${n} ${n === 1 ? 'story' : 'stories'} marked as read`);
    if (state.filter === 'unread') load();
    loadChannels();
  }

  // ── Reader ─────────────────────────────────────────────────────────────────
  function renderReaderHead(it) {
    const idx = state.items.indexOf(it);
    $('readerInner').querySelector('.reader-head').innerHTML = `
      <button class="btn btn-icon btn-ghost" data-act="close" title="Close (Esc)" aria-label="Close reader">${icon('close')}</button>
      <span class="spacer"></span>
      <button class="btn btn-icon btn-ghost" data-act="prev" title="Previous (K)" aria-label="Previous story" ${idx <= 0 ? 'disabled' : ''}>${icon('up')}</button>
      <button class="btn btn-icon btn-ghost" data-act="next" title="Next (J)" aria-label="Next story" ${idx >= state.items.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
      <button class="btn btn-icon btn-ghost" data-act="toggleRead" title="${it.read ? 'Mark as unread' : 'Mark as read'} (M)" aria-label="${it.read ? 'Mark as unread' : 'Mark as read'}">${icon(it.read ? 'circleok' : 'circle')}</button>
      <button class="btn btn-icon btn-ghost" data-act="copy" title="Copy link" aria-label="Copy link">${icon('link')}</button>`;
  }

  function renderReader(it) {
    const meta = [
      `<span>${icon('clock')}${escapeHTML(new Date(it.publishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</span>`,
      it.author ? `<span>${icon('edit')}${escapeHTML(it.author)}</span>` : '',
      it.duration ? `<span>${icon('podcast')}${escapeHTML(it.duration)}</span>` : ''
    ].join('');
    $('readerInner').innerHTML = `
      <div class="reader-head"></div>
      <div class="reader-scroll">
        ${it.thumbnail ? `<img class="reader-hero" src="${escapeHTML(it.thumbnail)}" alt="">` : ''}
        <div class="reader-kicker">${typeTile(it.sourceType)}<span>${escapeHTML(it.sourceName)}</span><span class="chip">${escapeHTML(it.category || TYPE_LABEL[it.sourceType] || '')}</span></div>
        <h2 class="reader-title">${escapeHTML(it.title)}</h2>
        <div class="reader-meta">${meta}</div>
        <div class="reader-text">${it.description ? escapeHTML(it.description) : '<span class="hint">No preview available for this story.</span>'}</div>
        <div class="reader-cta"><button class="btn btn-primary" data-act="open">${icon('external')}Read Full Story</button></div>
      </div>`;
    renderReaderHead(it);
    Motion.enter($('readerInner').querySelectorAll('.reader-scroll > *'), { y: 8, each: 0.04, duration: 0.45 });
  }

  function openStory(id) {
    const it = byId(id);
    if (!it) return;
    list().querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    list().querySelector(`.story[data-id="${CSS.escape(id)}"]`)?.classList.add('selected');
    state.selectedId = id;
    renderReader(it);
    if (!state.readerOpen) { state.readerOpen = true; Motion.slideWidth($('reader'), READER_W); }
    setRead(it, true);
  }

  function closeReader() {
    if (!state.readerOpen) return;
    state.readerOpen = false;
    state.selectedId = null;
    list().querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    Motion.slideWidth($('reader'), 0, { onComplete: () => { if (!state.readerOpen) $('readerInner').innerHTML = ''; } });
  }

  function step(delta) {
    const i = state.items.findIndex(x => x.id === state.selectedId);
    const next = state.items[i < 0 ? 0 : i + delta];
    if (!next) return;
    openStory(next.id);
    list().querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (state.items.indexOf(next) > state.items.length - 8) loadMore();
  }

  function readerAction(act) {
    const it = byId(state.selectedId);
    if (act === 'close') return closeReader();
    if (!it) return;
    if (act === 'prev') step(-1);
    else if (act === 'next') step(1);
    else if (act === 'toggleRead') setRead(it, !it.read);
    else if (act === 'open') it.url && api.ui.openExternal(it.url);
    else if (act === 'copy') navigator.clipboard.writeText(it.url || '').then(() => toast('Link copied'), () => toast('Couldn’t copy the link', 'error'));
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  function init() {
    Motion.segmented($('newsFilter'), state.filter, v => { state.filter = v; $('newsScroll').scrollTop = 0; load(); });
    $('newsSearch').addEventListener('input', debounce(e => { state.search = e.target.value.trim(); load(); }, 220));
    $('btnMarkAll').addEventListener('click', markAll);
    $('btnSort').addEventListener('click', e => openMenu(e.currentTarget, SORTS, {
      current: state.sort,
      onPick: v => { state.sort = v; load(); }
    }));
    $('newPill').addEventListener('click', () => { $('newsScroll').scrollTo({ top: 0, behavior: 'smooth' }); load(); });

    const click = e => {
      const row = e.target.closest('.story, .hero');
      if (row) return openStory(row.dataset.id);
      if (e.target.closest('[data-act="refresh"]')) App.refreshAll();
    };
    list().addEventListener('click', click);
    list().addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.story, .hero')) { e.preventDefault(); openStory(e.target.dataset.id); }
    });
    $('readerInner').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b) readerAction(b.dataset.act);
    });

    onImageError(list(), img => {
      const hero = img.closest('.hero');
      if (hero) { const it = byId(hero.dataset.id); if (it) hero.outerHTML = storyHTML(it); else hero.remove(); }
      else img.remove();
    });
    onImageError($('readerInner'), img => img.remove());

    // Infinite scroll: fetch the next page shortly before the end.
    new IntersectionObserver(es => { if (es[0].isIntersecting) loadMore(); }, { root: $('newsScroll'), rootMargin: '600px' }).observe($('feedMore'));

    document.addEventListener('keydown', e => {
      if (!state.active || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && state.readerOpen) { closeReader(); return; }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      if (e.key === '/') { e.preventDefault(); $('newsSearch').focus(); }
      else if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'm' && state.selectedId) readerAction('toggleRead');
      else if ((e.key === 'o' || e.key === 'Enter') && state.selectedId) readerAction('open');
    });
  }

  return {
    init, select, load, loadChannels, closeReader, currentRow, toggleCategory,
    setActive: v => { state.active = v; },
    /** Called when a refresh finished: update counts, and the list unless the user is mid-scroll. */
    onCollected() {
      loadChannels().catch(() => {});
      if (state.search) return;
      if ($('newsScroll').scrollTop < 40) load({ silent: true });
      else $('newPill').hidden = false;
    },
    reloadAll() { return Promise.all([loadChannels(), load()]); },
    get selection() { return state.sel; }
  };
})();
