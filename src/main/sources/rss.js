'use strict';

// Handles RSS, Atom, and podcast feeds
const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['itunes:image', 'itunesImage'],
      ['itunes:duration', 'duration'],
      ['itunes:author', 'itunesAuthor']
    ]
  }
});

/**
 * Fetch RSS/Atom/Podcast feed
 * @param {object} source  - source config from storage
 * @returns {ContentItem[]}
 */
async function fetchRSS(source) {
  const { config, maxItems = 20, name } = source;
  if (!config?.url) throw new Error('RSS source missing url');

  const feed = await parser.parseURL(config.url);
  const isPodcast = !!(feed.itunes || feed.items?.[0]?.enclosure?.type?.startsWith('audio'));

  return (feed.items || []).slice(0, maxItems).map(item => ({
    id: `rss:${source.id}:${item.guid || item.link || item.title}`,
    sourceId: source.id,
    sourceName: name || feed.title || 'RSS Feed',
    sourceType: isPodcast ? 'podcast' : 'rss',
    title: item.title || '(no title)',
    description: stripHTML(item.contentSnippet || item.summary || item.content || '').slice(0, 300),
    url: item.link || item.guid || '',
    thumbnail: extractThumbnail(item),
    author: item.itunesAuthor || item.creator || item.author || feed.title || '',
    publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
    duration: item.duration || null,
    enclosureUrl: item.enclosure?.url || null,
    fetchedAt: new Date().toISOString()
  }));
}

function extractThumbnail(item) {
  if (item.mediaThumbnail?.$.url) return item.mediaThumbnail.$.url;
  if (item.mediaContent?.$.url) return item.mediaContent.$.url;
  if (item.itunesImage?.$.href) return item.itunesImage.$.href;
  // Try to find img tag in content
  const imgMatch = (item.content || item['content:encoded'] || '').match(/<img[^>]+src="([^"]+)"/i);
  return imgMatch?.[1] || null;
}

function stripHTML(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { fetchRSS };
