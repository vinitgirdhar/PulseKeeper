'use strict';

// Reddit source — tries RSS feed first (more permissive), falls back to JSON API
const { fetchText } = require('../http');
const { loadFeed, summaryOf, extractThumbnail } = require('./rss');
const { stripHTML, toISO, decodeEntities } = require('../util');

// Reddit requires an app-style UA for the JSON API; the RSS endpoint wants a browser one (see http.js default).
const REDDIT_UA = 'windows:com.rodtrent.pulsekeeper:1.1.0 (by /u/pulsekeeper_app)';
const SORTS = ['hot', 'new', 'top', 'rising'];

/**
 * Fetch Reddit subreddit posts.
 * Tries the public RSS feed first; falls back to old.reddit.com JSON API.
 */
async function fetchReddit(source, state) {
  const { config, maxItems = 20, name } = source;
  if (!config?.subreddit) throw new Error('Reddit source missing subreddit name');

  // Accept both 'technology' and 'r/technology'
  const subreddit = config.subreddit.replace(/^\/?r\//, '').trim();
  if (!/^\w{2,21}$/.test(subreddit)) throw new Error(`"${config.subreddit}" is not a valid subreddit name`);
  const sort = SORTS.includes(config.sort) ? config.sort : 'hot';
  const label = name || `r/${subreddit}`;

  try {
    return await viaRSS(source, subreddit, sort, maxItems, label, state);
  } catch (rssErr) {
    try {
      return { items: await viaJSON(source, subreddit, sort, maxItems, label) };
    } catch (jsonErr) {
      throw new Error(`Reddit fetch failed for r/${subreddit} — RSS: ${rssErr.message}; JSON: ${jsonErr.message}`);
    }
  }
}

async function viaRSS(source, subreddit, sort, maxItems, label, state) {
  const loaded = await loadFeed(`https://www.reddit.com/r/${subreddit}/${sort}.rss`, state, { 'Accept-Language': 'en-US,en;q=0.9' });
  if (loaded.notModified) return { notModified: true };

  const fetchedAt = new Date().toISOString();
  const items = (loaded.feed.items || []).slice(0, maxItems).map(item => ({
    id: `reddit:${source.id}:${postId(item.link || item.guid || '')}`,
    sourceId: source.id,
    sourceName: label,
    sourceType: 'reddit',
    title: stripHTML(item.title) || '(no title)',
    description: summaryOf(item),
    url: item.link || '',
    thumbnail: extractThumbnail(item),
    author: item.creator || item.author || '',
    publishedAt: toISO(item.isoDate || item.pubDate, fetchedAt),
    fetchedAt
  }));
  return { items, state: loaded.state };
}

async function viaJSON(source, subreddit, sort, maxItems, label) {
  const url = `https://old.reddit.com/r/${subreddit}/${sort}.json?limit=${Math.min(maxItems, 100)}&raw_json=1`;
  const res = await fetchText(url, { headers: { 'User-Agent': REDDIT_UA, Accept: 'application/json' }, retries: 1 });
  let data;
  try { data = JSON.parse(res.text); } catch { throw new Error('Reddit JSON parse error'); }

  const fetchedAt = new Date().toISOString();
  return (data?.data?.children || []).filter(c => c.kind === 't3').slice(0, maxItems).map(({ data: post }) => ({
    id: `reddit:${source.id}:${post.id}`,
    sourceId: source.id,
    sourceName: label,
    sourceType: 'reddit',
    title: decodeEntities(post.title || '(no title)'),
    description: stripHTML(post.selftext, 800),
    url: `https://www.reddit.com${post.permalink}`,
    thumbnail: post.thumbnail?.startsWith('http') ? post.thumbnail : null,
    author: post.author || '',
    publishedAt: toISO((post.created_utc || 0) * 1000, fetchedAt),
    fetchedAt
  }));
}

function postId(url) {
  return /\/comments\/(\w+)/.exec(url)?.[1] || url;
}

module.exports = { fetchReddit };
