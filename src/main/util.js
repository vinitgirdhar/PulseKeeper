'use strict';

// Small text/URL/date helpers shared by the source fetchers and storage.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·',
  laquo: '«', raquo: '»'
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ''; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// HTML -> single-line plain text, cut at a word boundary.
function stripHTML(html, max = 0) {
  let t = decodeEntities(String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|br|li|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return t;
}

// Anything Date can parse -> ISO string, clamped to "now" (bad feed clocks
// publish in the future and would pin an item to the top forever).
function toISO(value, fallback = new Date()) {
  const t = Date.parse(value);
  return new Date(Number.isFinite(t) ? Math.min(t, Date.now()) : fallback).toISOString();
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_[ce]id$|igshid$|ref(_src)?$|cmpid$)/i;

// Stable key for "same article" across sources: ignores scheme, www, fragment,
// trailing slash and tracking params.
function canonicalUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return u.hostname.replace(/^www\./, '').toLowerCase() + u.pathname.replace(/\/+$/, '') + u.search;
  } catch { return String(url || ''); }
}

function httpUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : null;
}

// OPML feed list -> [{ name, url, category }]. Attribute order doesn't matter,
// entities are decoded, and folder outlines become the category.
function parseOPML(xml) {
  const feeds = [];
  const folders = [];
  for (const m of xml.matchAll(/<outline\b([^>]*?)(\/?)>|<\/outline\s*>/gi)) {
    if (m[0].startsWith('</')) { folders.pop(); continue; }
    const attrs = {};
    for (const a of m[1].matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3]);
    const label = (attrs.title || attrs.text || '').trim();
    if (attrs.xmlurl) feeds.push({ name: label || 'Imported Feed', url: attrs.xmlurl.trim(), category: folders.at(-1) || '' });
    if (!m[2]) folders.push(label); // opening tag: children belong to this folder
  }
  return feeds;
}

module.exports = { stripHTML, decodeEntities, toISO, canonicalUrl, httpUrl, parseOPML };
