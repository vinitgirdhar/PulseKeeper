'use strict';

// YouTube via public RSS feeds — accepts any YouTube URL format
// Supports: @handles, /channel/UC..., /c/name, /user/name, playlist URLs
// No API key required for basic usage.

const { fetchText } = require('../http');
const { loadFeed } = require('./rss');
const { stripHTML, toISO } = require('../util');

const YT_VIDEO_URL = (id) => `https://www.youtube.com/watch?v=${id}`;
const YT_THUMBNAIL = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const FEED = (query) => `https://www.youtube.com/feeds/videos.xml?${query}`;
const CLIENT = { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20240304.00.00' };

// Resolving an @handle costs 1–3 round trips and the answer never changes, so remember it.
const resolved = new Map();

/**
 * Fetch YouTube channel or playlist videos.
 * Accepts config.url as any of:
 *   https://www.youtube.com/@jolly
 *   https://www.youtube.com/channel/UCxxxxxx
 *   https://www.youtube.com/c/SomeName
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC...  (RSS directly)
 *   https://www.youtube.com/playlist?list=PL...
 */
async function fetchYouTube(source, state) {
  const { config = {}, maxItems = 20, name } = source;

  // Support legacy channelId / playlistId fields
  const url = config.url
    || (config.channelId && `https://www.youtube.com/channel/${config.channelId}`)
    || (config.playlistId && `https://www.youtube.com/playlist?list=${config.playlistId}`);
  if (!url) throw new Error('YouTube source requires a channel URL (e.g. https://www.youtube.com/@channelname)');

  const loaded = await loadFeed(await resolveToFeedURL(url), state);
  if (loaded.notModified) return { notModified: true };

  const fetchedAt = new Date().toISOString();
  const items = (loaded.feed.items || []).slice(0, maxItems).map(item => {
    const videoId = item.videoId || /[?&]v=([^&]+)/.exec(item.link || '')?.[1] || null;
    return {
      id: `youtube:${source.id}:${videoId || item.guid}`,
      sourceId: source.id,
      sourceName: name || loaded.feed.title || 'YouTube',
      sourceType: 'youtube',
      title: stripHTML(item.title) || '(no title)',
      description: stripHTML(descriptionOf(item), 800),
      url: videoId ? YT_VIDEO_URL(videoId) : (item.link || ''),
      thumbnail: videoId ? YT_THUMBNAIL(videoId) : null,
      author: loaded.feed.title || item.author || '',
      publishedAt: toISO(item.isoDate || item.pubDate, fetchedAt),
      videoId,
      fetchedAt
    };
  });
  return { items, state: loaded.state };
}

function descriptionOf(item) {
  const g = Array.isArray(item.mediaGroup) ? item.mediaGroup[0] : item.mediaGroup;
  const desc = g?.['media:description']?.[0];
  return (typeof desc === 'string' ? desc : desc?._) || item.contentSnippet || item.summary || '';
}

/** Convert any YouTube URL format to an RSS feed URL (memoised). */
async function resolveToFeedURL(url) {
  if (!resolved.has(url)) resolved.set(url, await resolve(url));
  return resolved.get(url);
}

async function resolve(url) {
  // Normalize: ensure www.youtube.com and strip tracking params
  let trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    if (u.hostname === 'youtube.com') u.hostname = 'www.youtube.com';
    for (const param of ['si', 'feature', 'ab_channel', 'pp']) u.searchParams.delete(param);
    trimmed = u.toString();
  } catch { /* malformed URL — leave as-is */ }

  // Already a YouTube RSS feed URL
  if (trimmed.includes('feeds/videos.xml')) return trimmed;

  // Playlist URL
  const playlist = /[?&]list=([\w-]+)/.exec(trimmed);
  if (playlist && !trimmed.includes('/channel/') && !trimmed.includes('/@')) return FEED(`playlist_id=${playlist[1]}`);

  // /channel/UC... URL — extract ID directly
  const channel = /\/channel\/(UC[\w-]+)/.exec(trimmed);
  if (channel) return FEED(`channel_id=${channel[1]}`);

  // @handle URL
  const handle = /\/@([\w.-]+)/.exec(trimmed)?.[1];
  if (handle) {
    // 1. Legacy ?user= RSS URL (instant, no round-trip to the YouTube UI)
    const legacy = FEED(`user=${handle}`);
    try { await loadFeed(legacy); return legacy; } catch { /* not a legacy username */ }

    // 2. resolve_url — the call the web app makes to canonicalise any YT URL
    // 3. browse — channel browse endpoint, accepts @handle as browseId
    for (const lookup of [channelViaResolveUrl, channelViaBrowse]) {
      try {
        const id = await lookup(handle);
        if (id) return FEED(`channel_id=${id}`);
      } catch { /* try the next one */ }
    }
  }

  // /c/name or /user/name — try ?user= with the path segment
  const user = /\/(?:c|user)\/([\w-]+)/.exec(trimmed)?.[1];
  if (user) {
    const legacy = FEED(`user=${user}`);
    try { await loadFeed(legacy); return legacy; } catch { /* fall through */ }
  }

  // Last resort: fetch the channel page and pull the channel ID out of it
  const html = (await fetchText(trimmed.startsWith('http') ? trimmed : `https://www.youtube.com/${trimmed}`, {
    timeout: 20000, maxBytes: 600000,
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      // Bypass YouTube consent gate
      Cookie: 'CONSENT=YES+cb; SOCS=CAESEwgDEgk2IgJlbg==; YSC=irrelevant; VISITOR_INFO1_LIVE=irrelevant'
    }
  })).text;

  const feedLink = /type="application\/rss\+xml"[^>]+href="([^"]+feeds\/videos\.xml[^"]+)"/.exec(html)
    || /href="([^"]+feeds\/videos\.xml[^"]+)"[^>]+type="application\/rss\+xml"/.exec(html)
    || /"(https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=[^"\\]+)"/.exec(html);
  if (feedLink) return feedLink[1].replace(/\\u0026/g, '&');

  const id = firstId(html, ['externalId', 'channelId', 'externalChannelId', 'browseId', 'ucid'])
    || /(?:itemprop|name)="channelId"[^>]+content="(UC[\w-]+)"/.exec(html)?.[1]
    || /\b(UC[\w-]{22})\b/.exec(html)?.[1];
  if (id) return FEED(`channel_id=${id}`);

  throw new Error(
    `Could not resolve YouTube channel for: ${url}\n\n` +
    `Most reliable fix: use the channel ID URL directly.\n` +
    `  1. Go to the channel on YouTube\n` +
    `  2. Click any video → right-click → Copy video URL\n` +
    `     Or: YouTube Studio → Settings → Channel → Basic Info → Channel ID\n` +
    `  3. Use: https://www.youtube.com/channel/UC<channelId>\n\n` +
    `Example: https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx`
  );
}

// First "<key>":"UC…" value found for any of the keys, in priority order.
function firstId(text, keys) {
  for (const key of keys) {
    const id = new RegExp(`"${key}"\\s*:\\s*"(UC[\\w-]+)"`).exec(text)?.[1];
    if (id) return id;
  }
  return null;
}

async function innertube(endpoint, payload, referer) {
  const res = await fetchText(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST', timeout: 15000, retries: 1, maxBytes: 500000, // channel ID is always early in the response
    body: JSON.stringify({ context: { client: CLIENT }, ...payload }),
    headers: {
      'Content-Type': 'application/json', Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://www.youtube.com', Referer: referer,
      'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': CLIENT.clientVersion
    }
  });
  return res.text;
}

async function channelViaResolveUrl(handle) {
  const url = `https://www.youtube.com/@${handle}`;
  return firstId(await innertube('navigation/resolve_url', { url }, url), ['browseId']);
}

async function channelViaBrowse(handle) {
  const text = await innertube('browse', { browseId: `@${handle}` }, `https://www.youtube.com/@${handle}`);
  return firstId(text, ['externalId', 'channelId']) || /\b(UC[\w-]{22})\b/.exec(text)?.[1];
}

module.exports = { fetchYouTube, resolveToFeedURL };
