'use strict';

// Handles RSS, Atom, and podcast feeds (also reused by the Reddit/YouTube fetchers)
const Parser = require('rss-parser');
const { fetchText } = require('../http');
const { stripHTML, toISO, httpUrl } = require('../util');

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:group', 'mediaGroup'],
      ['itunes:image', 'itunesImage'],
      ['itunes:duration', 'duration'],
      ['itunes:author', 'itunesAuthor'],
      ['yt:videoId', 'videoId']
    ]
  }
});

const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';

/**
 * Download + parse a feed with conditional GET.
 * @param {object} [state] validators from the previous fetch ({ etag, lastModified })
 * @returns {{ feed, state } | { notModified: true }}
 */
async function loadFeed(url, state = {}, headers = {}) {
  const res = await fetchText(url, { headers: { Accept: ACCEPT, ...headers }, etag: state.etag, lastModified: state.lastModified });
  if (res.notModified) return { notModified: true };
  let feed;
  try { feed = await parser.parseString(res.text); }
  catch (e) { throw new Error(`Not a valid RSS/Atom feed (${e.message.split('\n')[0]})`); }
  return { feed, state: { etag: res.etag, lastModified: res.lastModified } };
}

/**
 * Fetch RSS/Atom/Podcast feed
 * @param {object} source  - source config from storage
 * @param {object} [state] - conditional-GET validators from the last fetch
 */
async function fetchRSS(source, state) {
  const { config, maxItems = 20, name } = source;
  if (!config?.url) throw new Error('RSS source missing url');

  const loaded = await loadFeed(config.url, state);
  if (loaded.notModified) return { notModified: true };
  const { feed } = loaded;

  // A plain "rss" source that turns out to be a podcast feed is promoted; blog/newsletter keep their type.
  const isPodcast = !!(feed.itunes || feed.items?.[0]?.enclosure?.type?.startsWith('audio'));
  const sourceType = source.type === 'rss' && isPodcast ? 'podcast' : source.type;
  const fetchedAt = new Date().toISOString();

  const items = (feed.items || []).slice(0, maxItems).map(item => ({
    id: `rss:${source.id}:${item.guid || item.link || item.title}`,
    sourceId: source.id,
    sourceName: name || feed.title || 'RSS Feed',
    sourceType,
    title: stripHTML(item.title) || '(no title)',
    description: summaryOf(item),
    url: item.link || (httpUrl(item.guid) ? item.guid : ''),
    thumbnail: extractThumbnail(item),
    author: item.itunesAuthor || item.creator || item.author || feed.title || '',
    publishedAt: toISO(item.isoDate || item.pubDate, fetchedAt),
    duration: item.duration || null,
    enclosureUrl: item.enclosure?.url || null,
    fetchedAt
  }));
  return { items, state: loaded.state };
}

// First non-empty of snippet / summary / full content, as plain text.
function summaryOf(item) {
  for (const raw of [item.contentSnippet, item.summary, item['content:encoded'], item.content]) {
    const t = stripHTML(raw, 800);
    if (t) return t;
  }
  return '';
}

// rss-parser gives a single object, or an array when the tag repeats.
const attr = (v, k) => (Array.isArray(v) ? v[0] : v)?.$?.[k];

function extractThumbnail(item) {
  const group = Array.isArray(item.mediaGroup) ? item.mediaGroup[0] : item.mediaGroup;
  const candidates = [
    attr(item.mediaThumbnail, 'url'),
    attr(item.mediaContent, 'url'),
    attr(item.itunesImage, 'href'),
    attr(group?.['media:thumbnail'], 'url'),
    item.enclosure?.type?.startsWith('image') ? item.enclosure.url : null,
    /<img[^>]+src=["']([^"']+)["']/i.exec(item['content:encoded'] || item.content || '')?.[1]
  ];
  return candidates.find(httpUrl) || null;
}

module.exports = { fetchRSS, loadFeed, summaryOf, extractThumbnail };
