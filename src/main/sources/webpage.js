'use strict';

// Web page scraping source
// Fetches a URL and extracts content using CSS selectors (via cheerio)
// Falls back to basic regex extraction if cheerio is unavailable

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

// Try to load cheerio (optional dep — gracefully degrade if missing)
let cheerio;
try { cheerio = require('cheerio'); } catch {}

/**
 * Fetch and scrape a web page as a content source.
 *
 * config fields:
 *  url             – page to scrape (required)
 *  selector        – CSS selector for "items" (e.g. "article", ".post", ".item")
 *                    If absent, the whole page is one item
 *  titleSelector   – CSS selector for title within each item (default: h1, h2, h3)
 *  linkSelector    – CSS selector for the canonical link
 *  contentSelector – CSS selector for description/body text
 *  monitorChanges  – if true, returns an item only when content hash changes
 */
async function fetchWebpage(source) {
  const { config, maxItems = 20, name, id: sourceId } = source;
  if (!config?.url) throw new Error('Webpage source requires a URL');

  const html = await fetchHTML(config.url);

  if (cheerio) {
    return parseWithCheerio(html, source);
  } else {
    return parseWithRegex(html, source);
  }
}

// ─── Cheerio parser (full CSS selector support) ───────────────────────────────
function parseWithCheerio(html, source) {
  const { config, maxItems = 20, name, id: sourceId } = source;
  const $ = cheerio.load(html);
  const items = [];

  if (config.selector) {
    // Multiple items mode
    $(config.selector).slice(0, maxItems).each((i, el) => {
      const $el = $(el);

      const titleEl = config.titleSelector
        ? $el.find(config.titleSelector).first()
        : $el.find('h1, h2, h3, h4').first();
      const title = titleEl.text().trim() || $el.attr('title') || `Item ${i + 1}`;

      const linkEl = config.linkSelector
        ? $el.find(config.linkSelector).first()
        : $el.find('a').first();
      const href = linkEl.attr('href') || '';
      const url = resolveURL(href, config.url);

      const contentEl = config.contentSelector
        ? $el.find(config.contentSelector).first()
        : $el.find('p').first();
      const description = contentEl.text().trim().slice(0, 400);

      const imgSrc = $el.find('img').first().attr('src');
      const thumbnail = imgSrc ? resolveURL(imgSrc, config.url) : null;

      if (!title && !url) return;

      items.push({
        id: `webpage:${sourceId}:${contentHash(url || title)}`,
        sourceId,
        sourceName: name || extractDomain(config.url),
        sourceType: 'webpage',
        title,
        description,
        url: url || config.url,
        thumbnail,
        author: extractAuthor($el) || '',
        publishedAt: extractDate($el) || new Date().toISOString(),
        fetchedAt: new Date().toISOString()
      });
    });
  } else {
    // Single page mode — extract main content
    // Remove nav, footer, ads, scripts
    $('nav, footer, aside, script, style, [role="navigation"], [role="banner"], .ad, .advertisement, #cookie-notice').remove();

    const title = $('h1').first().text().trim() || $('title').text().trim() || name || extractDomain(config.url);
    const description = $('main, article, [role="main"]').first().text().trim().slice(0, 500)
      || $('body').text().trim().slice(0, 500);
    const thumbnail = $('meta[property="og:image"]').attr('content')
      || $('img[src]').not('[src^="data"]').first().attr('src');

    const hash = contentHash(description);
    const pageId = `webpage:${sourceId}:${hash}`;

    if (config.monitorChanges) {
      // Only return item if hash changed (change detection)
      if (source._lastHash === hash) return [];
      source._lastHash = hash;
    }

    items.push({
      id: pageId,
      sourceId,
      sourceName: name || extractDomain(config.url),
      sourceType: 'webpage',
      title,
      description,
      url: config.url,
      thumbnail: thumbnail ? resolveURL(thumbnail, config.url) : null,
      author: $('meta[name="author"]').attr('content') || '',
      publishedAt: $('meta[property="article:published_time"]').attr('content')
        || $('time').first().attr('datetime')
        || new Date().toISOString(),
      fetchedAt: new Date().toISOString()
    });
  }

  return items;
}

// ─── Regex fallback (no cheerio) ─────────────────────────────────────────────
function parseWithRegex(html, source) {
  const { config, maxItems = 20, name, id: sourceId } = source;

  // Extract basic metadata
  const title = (html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]
    || html.match(/<title>([^<]+)<\/title>/i)?.[1]
    || name
    || extractDomain(config.url)).trim();

  // Strip tags and normalize whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1];

  return [{
    id: `webpage:${sourceId}:${contentHash(text)}`,
    sourceId,
    sourceName: name || extractDomain(config.url),
    sourceType: 'webpage',
    title,
    description: text,
    url: config.url,
    thumbnail: ogImage || null,
    author: html.match(/<meta[^>]+name="author"[^>]+content="([^"]+)"/i)?.[1] || '',
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString()
  }];
}

// ─── HTTP fetch ───────────────────────────────────────────────────────────────
function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        fetchHTML(loc).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching: ${url}`));
        return;
      }

      const enc = res.headers['content-encoding'];
      let stream = res;
      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      let data = '';
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      const fail = e => { if (!settled) { settled = true; reject(e); } };

      stream.setEncoding('utf8');
      stream.on('data', c => { data += c; if (data.length > 2000000) { req.destroy(); done(data); } });
      stream.on('end', () => done(data));
      stream.on('error', () => { if (data.length > 100) done(data); else fail(new Error('Decompress error')); });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout fetching: ' + url)); });
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function extractAuthor($el) {
  const a = $el.find('[rel="author"], .author, .byline, [itemprop="author"]').first();
  return a.text().trim();
}

function extractDate($el) {
  const t = $el.find('time').first();
  return t.attr('datetime') || t.text().trim() || null;
}

function resolveURL(href, base) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  try { return new URL(href, base).href; } catch { return href; }
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function contentHash(str) {
  return crypto.createHash('md5').update(str || '').digest('hex').slice(0, 12);
}

module.exports = { fetchWebpage };
