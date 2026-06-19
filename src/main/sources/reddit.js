'use strict';

// Reddit source — tries RSS feed first (more permissive), falls back to JSON API
const https = require('https');
const zlib = require('zlib');
const Parser = require('rss-parser');

// Browser UA for the RSS web endpoint (Cloudflare blocks non-browser UAs)
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// Reddit-format UA for the JSON API (Reddit requires this for app-style access)
const REDDIT_UA  = 'windows:com.rodtrent.pulsekeeper:1.1.0 (by /u/pulsekeeper_app)';

const rssParser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': BROWSER_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
  },
  customFields: {
    item: [
      ['media:thumbnail', 'mediaThumbnail'],
      ['content:encoded', 'contentEncoded']
    ]
  }
});

const REDDIT_RSS  = (sub, sort) => `https://www.reddit.com/r/${sub}/${sort}.rss`;
const REDDIT_JSON = (sub, sort, limit) =>
  `https://old.reddit.com/r/${sub}/${sort}.json?limit=${limit}&raw_json=1`;

/**
 * Fetch Reddit subreddit posts.
 * Tries the public RSS feed first; falls back to old.reddit.com JSON API.
 */
async function fetchReddit(source) {
  const { config, maxItems = 20, name } = source;
  if (!config?.subreddit) throw new Error('Reddit source missing subreddit name');

  // Accept both 'technology' and 'r/technology'
  const subreddit = config.subreddit.replace(/^\/?r\//, '').trim();
  const sort = config.sort || 'hot';

  try {
    return await _fetchViaRSS(source, subreddit, sort, maxItems, name);
  } catch (rssErr) {
    try {
      return await _fetchViaJSON(source, subreddit, sort, maxItems, name);
    } catch (jsonErr) {
      throw new Error(
        `Reddit fetch failed for r/${subreddit}.\n` +
        `RSS error: ${rssErr.message}\n` +
        `JSON error: ${jsonErr.message}`
      );
    }
  }
}

// ── RSS path ──────────────────────────────────────────────────────────────────

async function _fetchViaRSS(source, subreddit, sort, maxItems, name) {
  const feed = await rssParser.parseURL(REDDIT_RSS(subreddit, sort));

  return (feed.items || []).slice(0, maxItems).map(item => ({
    id: `reddit:${source.id}:${_postId(item.link || item.guid || '')}`,
    sourceId: source.id,
    sourceName: name || `r/${subreddit}`,
    sourceType: 'reddit',
    title: _decodeEntities(item.title || '(no title)'),
    description: _stripHTML(item.contentSnippet || item.content || '').slice(0, 300),
    url: item.link || '',
    thumbnail: item.mediaThumbnail?.$.url || _thumbFromContent(item.content || item.contentEncoded || ''),
    author: item.creator || item.author || '',
    publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
    fetchedAt: new Date().toISOString()
  }));
}

// ── JSON API fallback ─────────────────────────────────────────────────────────

async function _fetchViaJSON(source, subreddit, sort, maxItems, name) {
  const url = REDDIT_JSON(subreddit, sort, Math.min(maxItems, 100));
  const data = await _getJSON(url);
  const posts = (data?.data?.children || []).filter(c => c.kind === 't3');

  return posts.slice(0, maxItems).map(({ data: post }) => ({
    id: `reddit:${source.id}:${post.id}`,
    sourceId: source.id,
    sourceName: name || `r/${subreddit}`,
    sourceType: 'reddit',
    title: _decodeEntities(post.title || '(no title)'),
    description: (post.selftext || '').slice(0, 300),
    url: `https://www.reddit.com${post.permalink}`,
    thumbnail: post.thumbnail?.startsWith('http') ? post.thumbnail : null,
    author: post.author || '',
    publishedAt: new Date((post.created_utc || 0) * 1000).toISOString(),
    fetchedAt: new Date().toISOString()
  }));
}

function _getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': REDDIT_UA,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate'
      }
    }, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow one redirect (old.reddit.com sometimes redirects)
        res.resume();
        _getJSON(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Reddit JSON API returned HTTP ${res.statusCode}`));
        return;
      }
      const enc = res.headers['content-encoding'];
      let stream = res;
      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => { body += chunk; });
      stream.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Reddit JSON parse error')); }
      });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Reddit request timed out')); });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _postId(url) {
  const m = url.match(/\/comments\/([\w]+)/);
  return m ? m[1] : url;
}

function _stripHTML(html) {
  return String(html).replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function _decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function _thumbFromContent(html) {
  const m = html.match(/<img[^>]+src="([^"]+)"/i);
  return m?.[1] || null;
}

module.exports = { fetchReddit };
