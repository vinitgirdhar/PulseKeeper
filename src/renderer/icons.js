'use strict';

/*
 * PulseKeeper icon set — Apple / SF-Symbols-style line icons.
 *
 * Hand-drawn 24×24 line glyphs (no emoji, no external font). Icons inherit the
 * current text color via `stroke="currentColor"`, so they pick up theme colors
 * and the per-type `.type-*` colors automatically.
 *
 * Usage:
 *   - In markup:   <span data-icon="settings"></span>        → hydrated on load
 *                  <span data-icon="trash" data-size="14"></span>
 *   - In JS:       el.innerHTML = PKIcons.icon('refresh');   → returns an <svg> string
 *
 * Sizing: icons default to 1em (they scale with the surrounding font-size).
 * Pass a number to icon(name, 18) or set data-size="18" to pin a pixel size.
 */
(function () {
  // Each entry is the inner SVG markup for a 0 0 24 24 viewBox.
  const PATHS = {
    // ── Navigation ──
    sources:   '<path d="M4.5 12a7.5 7.5 0 0 1 7.5-7.5M7 12a5 5 0 0 1 5-5M19.5 12A7.5 7.5 0 0 0 12 4.5M17 12a5 5 0 0 0-5-5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 13.5V20"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>',
    ai:        '<path d="M12 3.5l1.6 4.2 4.2 1.6-4.2 1.6L12 15.1l-1.6-4.2L6.2 9.3l4.2-1.6z"/><path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    health:    '<path d="M3.5 13h3l2-5 3 9 2.5-7 1.5 3h5"/>',
    export:    '<path d="M12 15V4M12 4 8 8M12 4l4 4"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
    puzzle:    '<path d="M10 4.5h4a1 1 0 0 1 1 1V8a2 2 0 1 1 4 0v2.5a1 1 0 0 1-1 1h-2.5a2 2 0 1 0 0 4H18a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-4.5a2 2 0 1 0-4 0H5a1 1 0 0 1-1-1v-3.5a2 2 0 1 0 0-4V6a1.5 1.5 0 0 1 1.5-1.5z"/>',
    info:      '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>',
    shield:    '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    threats:   '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 8.5v4M12 15.2v.1"/>',

    // ── Actions ──
    plus:      '<path d="M12 5v14M5 12h14"/>',
    refresh:   '<path d="M19 9a7 7 0 1 0 .8 5"/><path d="M19.5 4.5V9H15"/>',
    import:    '<path d="M12 4v11M12 15l-4-4M12 15l4-4"/><path d="M5 18.5h14"/>',
    save:      '<path d="M5 4.5h11l3 3V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18z"/><path d="M8 4.5v4h6v-4M8 19.5v-5h8v5"/>',
    upload:    '<path d="M12 14V4M12 4 8.5 7.5M12 4l3.5 3.5"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
    download:  '<path d="M12 4v10M12 14l-3.5-3.5M12 14l3.5-3.5"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
    edit:      '<path d="M16.5 4.5l3 3L8 19l-4 1 1-4z"/><path d="M14.5 6.5l3 3"/>',
    trash:     '<path d="M4.5 6.5h15M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5M6.5 6.5 7.5 19a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12.5M10 10v6M14 10v6"/>',
    copy:      '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 16V6a2 2 0 0 1 2-2h8"/>',
    check:     '<path d="M5 12.5l4.5 4.5L19 6.5"/>',
    close:     '<path d="M6 6l12 12M18 6 6 18"/>',
    search:    '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    chevron:   '<path d="M9 6l6 6-6 6"/>',
    globe:     '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.3 3.8 8.5S14.5 18.2 12 20.5C9.5 18.2 8.2 15.2 8.2 12S9.5 5.8 12 3.5z"/>',
    document:  '<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M14 3.5V8h4M9 12.5h6M9 16h6"/>',
    file:      '<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M14 3.5V8h4"/>',
    folder:    '<path d="M4 6.5a1.5 1.5 0 0 1 1.5-1.5h3.8l1.7 2H18a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18z"/>',
    clock:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alarm:     '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M4.5 6 7 3.5M19.5 6 17 3.5"/>',
    bell:      '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
    mute:      '<path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M15 9.5l4 5M19 9.5l-4 5"/>',
    bolt:      '<path d="M13 3l-7 9h5l-1 9 7-9h-5z"/>',
    plug:      '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
    moon:      '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
    sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4 5.6 5.6"/>',
    capture:   '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9.5h16M8 4v5.5"/>',

    // ── Source types ──
    rss:       '<circle cx="6.5" cy="17.5" r="1.7" fill="currentColor" stroke="none"/><path d="M5 11.5a7.5 7.5 0 0 1 7.5 7.5M5 6a13 13 0 0 1 13 13"/>',
    podcast:   '<rect x="9" y="3.5" width="6" height="10" rx="3"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M9.5 20h5"/>',
    youtube:   '<rect x="3.5" y="6" width="17" height="12" rx="3.5"/><path d="M10.5 9.5l4.5 2.5-4.5 2.5z" fill="currentColor" stroke="none"/>',
    reddit:    '<circle cx="12" cy="13" r="7"/><circle cx="9" cy="12.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none"/><path d="M9.2 15.5a4 4 0 0 0 5.6 0M16.5 8.5l-1-3.5-3.2.8"/><circle cx="18.5" cy="9" r="1.3"/>',
    mail:      '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
    blog:      '<path d="M16.5 4.5l3 3L9 18l-4 1 1-4z"/><path d="M13.5 7.5l3 3"/>',
    robot:     '<rect x="5" y="8" width="14" height="10" rx="2.5"/><path d="M12 4.5V8M9 13v1.5M15 13v1.5M3.5 12v3M20.5 12v3"/><circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/>',
    telegram:  '<circle cx="12" cy="12" r="8.5"/><path d="M6 13 18.5 8l-4 11-2.5-5 4-4-8 5z"/>',
    github:    '<path d="M12 3a9 9 0 0 0-2.846 17.533c.45.083.615-.196.615-.435l-.012-1.692c-2.502.544-3.027-1.205-3.027-1.205-.409-1.04-1-1.317-1-1.317-.817-.559.062-.547.062-.547.903.063 1.378.927 1.378.927.803 1.376 2.107.979 2.62.748.082-.582.314-.979.572-1.204-1.998-.227-4.1-1-4.1-4.449 0-.983.351-1.787.927-2.416-.093-.228-.401-1.143.088-2.382 0 0 .755-.242 2.474.923A8.617 8.617 0 0 1 12 7.84c.764.004 1.534.103 2.252.302 1.718-1.165 2.472-.923 2.472-.923.49 1.239.182 2.154.09 2.382.577.629.926 1.433.926 2.416 0 3.459-2.105 4.22-4.11 4.441.323.279.61.829.61 1.67l-.01 2.47c0 .241.162.522.618.434A9.001 9.001 0 0 0 12 3z"/>',

    // ── Status ──
    warning:   '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.4" r="0.95" fill="currentColor" stroke="none"/>',
    circle:    '<circle cx="12" cy="12" r="7.5"/>',
  };

  // Aliases so callers can use friendly / type names.
  const ALIAS = {
    'web-capture': 'capture',
    webpage: 'globe',
    newsletter: 'mail',
    digest: 'document',
    markdown: 'document',
    pdf: 'file',
    agent: 'robot',
    backup: 'save',
    opml: 'import',
    theme: 'moon',
  };

  function resolve(name) {
    if (PATHS[name]) return name;
    if (ALIAS[name]) return ALIAS[name];
    return null;
  }

  function icon(name, size) {
    const key = resolve(name);
    const inner = key ? PATHS[key] : '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>';
    const dim = size ? `width="${size}" height="${size}"` : 'width="1em" height="1em"';
    return `<svg class="pk-icon" ${dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
           `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
           `focusable="false">${inner}</svg>`;
  }

  function hydrate(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => {
      if (el.dataset.iconHydrated) return;
      const size = el.dataset.size ? Number(el.dataset.size) : undefined;
      el.innerHTML = icon(el.dataset.icon, size);
      el.dataset.iconHydrated = '1';
    });
  }

  window.PKIcons = { icon, hydrate };
  document.addEventListener('DOMContentLoaded', () => hydrate(document));
})();
