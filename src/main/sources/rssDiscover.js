'use strict';

// RSS/Atom feed auto-discovery from any webpage URL.
// 1. HEAD request to check if the URL itself is a feed
// 2. Fetch page HTML and look for <link rel="alternate" type="application/rss+xml">
// 3. Try common feed path guesses (/feed, /rss, etc.)

const https = require('https');
const http = require('http');
const zlib = require('zlib');

/**
 * Discover a feed URL from any URL.
 * @param {string} url
 * @returns {Promise<string|null>} feed URL or null
 */
async function discoverFeed(url) {
  if (!url || !url.startsWith('http')) return null;

  // If the URL itself is already a feed, return it as-is
  try {
    const ct = await getContentType(url);
    if (isFeedContentType(ct)) return url;
  } catch { /* fall through */ }

  // Fetch the page HTML and look for <link rel="alternate"> tags
  try {
    const html = await fetchPage(url);
    const found = extractFeedLinkFromHTML(html, url);
    if (found) return found;
  } catch { /* fall through */ }

  // Guess common feed paths on the same origin
  try {
    const origin = new URL(url).origin;
    const guesses = [
      '/feed', '/feed.xml', '/feed.rss', '/rss', '/rss.xml', '/rss/feed',
      '/atom.xml', '/atom', '/blog/feed', '/blog/rss', '/index.xml',
      '/feeds/posts/default', '/wp-json/wp/v2/posts?per_page=1' // last resort WP check
    ];
    for (const p of guesses) {
      try {
        const ct = await getContentType(origin + p);
        if (isFeedContentType(ct)) return origin + p;
      } catch { /* try next */ }
    }
  } catch { /* fall through */ }

  return null;
}

function extractFeedLinkFromHTML(html, baseUrl) {
  const patterns = [
    /type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i,
    /href=["']([^"']+)["'][^>]*type=["']application\/rss\+xml["']/i,
    /type=["']application\/atom\+xml["'][^>]+href=["']([^"']+)["']/i,
    /href=["']([^"']+)["'][^>]*type=["']application\/atom\+xml["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      try { return m[1].startsWith('http') ? m[1] : new URL(m[1], baseUrl).href; } catch {}
    }
  }
  return null;
}

function isFeedContentType(ct) {
  return /rss|atom|xml/i.test(ct || '');
}

function getContentType(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }, res => {
      resolve(res.headers['content-type'] || '');
      res.resume();
    });
    req.on('error', reject);
    req.setTimeout(6000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Encoding': 'gzip, deflate'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location : new URL(res.headers.location, url).href;
        fetchPage(next).then(resolve).catch(reject);
        return;
      }
      const enc = res.headers['content-encoding'];
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());

      let data = '';
      stream.setEncoding('utf8');
      stream.on('data', c => { data += c; if (data.length > 200000) { req.destroy(); resolve(data); } });
      stream.on('end', () => resolve(data));
      stream.on('error', () => { if (data.length > 100) resolve(data); else reject(new Error('stream error')); });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = { discoverFeed };
