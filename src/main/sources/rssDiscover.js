'use strict';

// RSS/Atom feed auto-discovery from any webpage URL.
// 1. Fetch the URL: it may already be a feed
// 2. Otherwise look for <link rel="alternate" type="application/rss+xml"> in the HTML
// 3. Probe common feed paths on the same origin (in parallel)

const cheerio = require('cheerio');
const { fetchText } = require('../http');

const GUESSES = ['/feed', '/feed.xml', '/feed.rss', '/rss', '/rss.xml', '/atom.xml', '/index.xml', '/blog/feed', '/blog/rss', '/feeds/posts/default'];
const FEED_BODY = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i;

const probe = url => fetchText(url, { timeout: 8000, retries: 0, maxBytes: 600000 }).catch(() => null);

/**
 * @param {string} url
 * @returns {Promise<string|null>} feed URL or null
 */
async function discoverFeed(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;

  const page = await probe(url);
  if (page) {
    if (FEED_BODY.test(page.text)) return page.url;
    const href = cheerio.load(page.text)('link[rel~="alternate"]').toArray()
      .map(el => el.attribs)
      .find(a => /(rss|atom)\+xml/i.test(a.type || '') && a.href)?.href;
    if (href) { try { return new URL(href, page.url).href; } catch { /* bad href — keep probing */ } }
  }

  const origin = new URL(url).origin;
  const hits = await Promise.all(GUESSES.map(async p => {
    const r = await probe(origin + p);
    return r && FEED_BODY.test(r.text) ? r.url : null;
  }));
  return hits.find(Boolean) || null;
}

module.exports = { discoverFeed };
