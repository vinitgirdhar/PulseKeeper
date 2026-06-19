'use strict';

// YouTube via public RSS feeds — accepts any YouTube URL format
// Supports: @handles, /channel/UC..., /c/name, /user/name, playlist URLs
// No API key required for basic usage.

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'PersonalContentBuilder/1.0' },
  customFields: {
    item: [
      ['media:group', 'mediaGroup'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['yt:videoId', 'videoId'],
      ['yt:channelId', 'channelId']
    ]
  }
});

const YT_VIDEO_URL = (id) => `https://www.youtube.com/watch?v=${id}`;
const YT_THUMBNAIL = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/**
 * Fetch YouTube channel or playlist videos.
 * Accepts config.url as any of:
 *   https://www.youtube.com/@jolly
 *   https://www.youtube.com/channel/UCxxxxxx
 *   https://www.youtube.com/c/SomeName
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC...  (RSS directly)
 *   https://www.youtube.com/playlist?list=PL...
 */
async function fetchYouTube(source) {
  const { config, maxItems = 20, name } = source;

  // Support legacy channelId / playlistId fields
  if (!config?.url && config?.channelId) {
    config.url = `https://www.youtube.com/channel/${config.channelId}`;
  }
  if (!config?.url && config?.playlistId) {
    config.url = `https://www.youtube.com/playlist?list=${config.playlistId}`;
  }

  if (!config?.url) {
    throw new Error('YouTube source requires a channel URL (e.g. https://www.youtube.com/@channelname)');
  }

  const feedUrl = await resolveToFeedURL(config.url);
  const feed = await parser.parseURL(feedUrl);

  return (feed.items || []).slice(0, maxItems).map(item => {
    const videoId = item.videoId || extractVideoId(item.link || '');
    return {
      id: `youtube:${source.id}:${videoId || item.guid}`,
      sourceId: source.id,
      sourceName: name || feed.title || 'YouTube',
      sourceType: 'youtube',
      title: item.title || '(no title)',
      description: extractDescription(item).slice(0, 400),
      url: videoId ? YT_VIDEO_URL(videoId) : (item.link || ''),
      thumbnail: videoId ? YT_THUMBNAIL(videoId) : extractThumb(item),
      author: feed.title || item.author || '',
      publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
      videoId,
      fetchedAt: new Date().toISOString()
    };
  });
}

/**
 * Convert any YouTube URL format to an RSS feed URL.
 */
async function resolveToFeedURL(url) {
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
  const playlistMatch = trimmed.match(/[?&]list=([\w-]+)/);
  if (playlistMatch && !trimmed.includes('/channel/') && !trimmed.includes('/@')) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistMatch[1]}`;
  }

  // /channel/UC... URL — extract ID directly
  const channelIdMatch = trimmed.match(/\/channel\/(UC[\w-]+)/);
  if (channelIdMatch) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdMatch[1]}`;
  }

  // @handle URL
  const handleMatch = trimmed.match(/\/@([\w-]+)/);
  if (handleMatch) {
    const handle = handleMatch[1];

    // 1. Legacy ?user= RSS URL (instant, no network round-trip to YouTube UI)
    const legacyUrl = `https://www.youtube.com/feeds/videos.xml?user=${handle}`;
    try {
      await parser.parseURL(legacyUrl);
      return legacyUrl;
    } catch { /* not a legacy username — continue */ }

    // 2. resolve_url — innertube endpoint designed specifically to canonicalise any YT URL
    try {
      const channelId = await resolveUrlViaInnertube(`https://www.youtube.com/@${handle}`);
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    } catch { /* fall through */ }

    // 3. browse — innertube channel browse endpoint, accepts @handle as browseId
    try {
      const channelId = await resolveHandleViaInnertube(handle);
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    } catch { /* fall through to HTML scraping */ }
  }

  // /c/name or /user/name — try ?user= with the path segment
  const userMatch = trimmed.match(/\/(?:c|user)\/([\w-]+)/);
  if (userMatch) {
    const legacyUrl = `https://www.youtube.com/feeds/videos.xml?user=${userMatch[1]}`;
    try {
      await parser.parseURL(legacyUrl);
      return legacyUrl;
    } catch { /* fall through */ }
  }

  // Last resort: fetch the channel page and extract channel ID via regex
  const pageUrl = trimmed.startsWith('http') ? trimmed : `https://www.youtube.com/${trimmed}`;
  const html = await fetchPageHTML(pageUrl);

  const patterns = [
    // <link rel="alternate"> RSS tag in <head>
    { re: /type="application\/rss\+xml"[^>]+href="([^"]+feeds\/videos\.xml[^"]+)"/, full: true },
    { re: /href="([^"]+feeds\/videos\.xml[^"]+)"[^>]+type="application\/rss\+xml"/, full: true },
    // Escaped feeds URL inside JSON strings
    { re: /feeds\\\/videos\.xml\?channel_id=(UC[\w-]+)/, full: false },
    { re: /"(https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=[^"\\]+)"/, full: true },
    // ytInitialData / ytcfg embedded JSON — various channel ID fields
    { re: /"externalId"\s*:\s*"(UC[\w-]+)"/, full: false },
    { re: /"channelId"\s*:\s*"(UC[\w-]+)"/, full: false },
    { re: /"externalChannelId"\s*:\s*"(UC[\w-]+)"/, full: false },
    { re: /"browseId"\s*:\s*"(UC[\w-]+)"/, full: false },
    { re: /"ucid"\s*:\s*"(UC[\w-]+)"/, full: false },
    // itemprop / meta tags
    { re: /itemprop="channelId"[^>]+content="(UC[\w-]+)"/, full: false },
    { re: /<meta[^>]+name="channelId"[^>]+content="(UC[\w-]+)"/, full: false },
    // General UC id anywhere in page (last resort)
    { re: /\b(UC[\w-]{22})\b/, full: false },
  ];

  for (const { re, full } of patterns) {
    const m = html.match(re);
    if (m) {
      if (full) return m[1].replace(/\\u0026/g, '&');
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
    }
  }

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

/**
 * Use the innertube navigation/resolve_url endpoint to turn any YouTube URL
 * into a channel ID.  This is the most direct path — it's the same call
 * the YouTube web app makes when routing a URL internally.
 */
function resolveUrlViaInnertube(youtubeUrl) {
  const body = JSON.stringify({
    context: {
      client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20240304.00.00' }
    },
    url: youtubeUrl
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.youtube.com',
      path: '/youtubei/v1/navigation/resolve_url?prettyPrint=false',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Origin': 'https://www.youtube.com',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240304.00.00',
      }
    }, (res) => {
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
      stream.on('data', chunk => { data += chunk; if (data.length > 200000) req.destroy(); });
      stream.on('end', () => {
        if (!data) { fail(new Error('Empty resolve_url response')); return; }
        try {
          let channelId = null;
          try {
            const json = JSON.parse(data);
            // endpoint.browseEndpoint.browseId is the canonical channel ID
            channelId = json?.endpoint?.browseEndpoint?.browseId;
          } catch { /* truncated — try regex */ }
          if (!channelId) {
            const m = data.match(/"browseId"\s*:\s*"(UC[\w-]+)"/);
            channelId = m?.[1] || null;
          }
          if (channelId && channelId.startsWith('UC')) done(channelId);
          else fail(new Error('No channel ID in resolve_url response'));
        } catch (e) { fail(e); }
      });
      stream.on('error', fail);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('resolve_url timed out')); });
    req.write(body);
    req.end();
  });
}

/**
 * Resolve a YouTube @handle to a channel ID using the innertube browse endpoint.
 */
function resolveHandleViaInnertube(handle) {
  const body = JSON.stringify({
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: 'WEB',
        clientVersion: '2.20240304.00.00'
      }
    },
    browseId: `@${handle}`
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.youtube.com',
      path: '/youtubei/v1/browse?prettyPrint=false',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/@${handle}`,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240304.00.00',
      }
    };

    const req = https.request(options, (res) => {
      // Decompress response
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
      stream.on('data', chunk => {
        data += chunk;
        if (data.length > 500000) { req.destroy(); }   // truncate — channel ID is always early in response
      });
      stream.on('end', () => {
        if (!data) { fail(new Error('Empty innertube response')); return; }
        try {
          // Try structured parse first
          let channelId = null;
          try {
            const json = JSON.parse(data);
            channelId =
              json?.metadata?.channelMetadataRenderer?.externalId ||
              json?.header?.c4TabbedHeaderRenderer?.channelId ||
              json?.header?.pageHeaderRenderer?.channelId;
          } catch { /* JSON truncated — fall through to regex */ }

          // Regex fallback on raw response string
          if (!channelId || !channelId.startsWith('UC')) {
            const m = data.match(/"externalId"\s*:\s*"(UC[\w-]+)"/)
                   || data.match(/"channelId"\s*:\s*"(UC[\w-]+)"/)
                   || data.match(/\b(UC[\w-]{22})\b/);
            channelId = m?.[1] || null;
          }

          if (channelId) done(channelId);
          else fail(new Error('Channel ID not found in innertube response'));
        } catch (e) {
          fail(e);
        }
      });
      stream.on('error', fail);
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Innertube request timed out')); });
    req.write(body);
    req.end();
  });
}

function fetchPageHTML(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        // Bypass YouTube consent gate
        'Cookie': 'CONSENT=YES+cb; SOCS=CAESEwgDEgk2IgJlbg==; YSC=irrelevant; VISITOR_INFO1_LIVE=irrelevant'
      }
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://www.youtube.com${res.headers.location}`;
        res.resume();
        fetchPageHTML(loc).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching YouTube page: ${url}`));
        return;
      }

      // Decompress if the server sent gzip/deflate/br
      const enc = res.headers['content-encoding'];
      let stream = res;
      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      let html = '';
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      const fail = e => { if (!settled) { settled = true; reject(e); } };

      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        html += chunk;
        if (html.length > 600000) { req.destroy(); done(html); }
      });
      stream.on('end', () => done(html));
      stream.on('error', () => { if (html.length > 1000) done(html); else fail(new Error('Decompress error')); });
    });
    req.on('error', e => { reject(e); });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout fetching YouTube page')); });
  });
}

function extractVideoId(url) {
  const m = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
  return m?.[1] || null;
}

function extractDescription(item) {
  if (item.mediaGroup) {
    const g = Array.isArray(item.mediaGroup) ? item.mediaGroup[0] : item.mediaGroup;
    const desc = g?.['media:description']?.[0];
    if (desc) return typeof desc === 'string' ? desc : (desc._ || '');
  }
  return item.contentSnippet || item.summary || '';
}

function extractThumb(item) {
  if (item.mediaThumbnail?.$.url) return item.mediaThumbnail.$.url;
  if (item.mediaGroup) {
    const g = Array.isArray(item.mediaGroup) ? item.mediaGroup[0] : item.mediaGroup;
    const thumbs = g?.['media:thumbnail'];
    if (thumbs?.length) return thumbs[thumbs.length - 1]?.$.url || null;
  }
  return null;
}

module.exports = { fetchYouTube, resolveToFeedURL };
