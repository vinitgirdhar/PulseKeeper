'use strict';

// Web page scraping source: fetch a URL and extract content with CSS selectors (cheerio)

const crypto = require('crypto');
const cheerio = require('cheerio');
const { fetchText } = require('../http');
const { stripHTML, toISO } = require('../util');

/**
 * Fetch and scrape a web page as a content source.
 *
 * config fields:
 *  url             – page to scrape (required)
 *  selector        – CSS selector for "items" (e.g. "article", ".post", ".item")
 *                    If absent, the whole page is one item
 *  titleSelector   – CSS selector for title within each item (default: h1–h4)
 *  linkSelector    – CSS selector for the canonical link
 *  contentSelector – CSS selector for description/body text
 *  monitorChanges  – single-page mode: items are keyed by a hash of the page text, so a
 *                    new item appears exactly when the content changes (always on).
 */
async function fetchWebpage(source) {
  const { config, maxItems = 20, name, id: sourceId } = source;
  if (!config?.url) throw new Error('Webpage source requires a URL');

  const { text: html, url: finalUrl } = await fetchText(config.url, {
    timeout: 20000, maxBytes: 2000000,
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' }
  });
  const base = finalUrl || config.url;
  const $ = cheerio.load(html);
  const fetchedAt = new Date().toISOString();
  const sourceName = name || domain(config.url);
  const abs = href => { try { return href ? new URL(href, base).href : ''; } catch { return ''; } };
  const common = { sourceId, sourceName, sourceType: 'webpage', fetchedAt };

  if (config.selector) {
    const items = [];
    $(config.selector).slice(0, maxItems).each((i, el) => {
      const $el = $(el);
      const title = ($el.find(config.titleSelector || 'h1, h2, h3, h4').first().text().trim() || $el.attr('title') || `Item ${i + 1}`).replace(/\s+/g, ' ');
      const url = abs($el.find(config.linkSelector || 'a').first().attr('href'));
      const time = $el.find('time').first();

      items.push({
        ...common,
        id: `webpage:${sourceId}:${hash(url || title)}`,
        title,
        description: stripHTML($el.find(config.contentSelector || 'p').first().text(), 800),
        url: url || config.url,
        thumbnail: abs($el.find('img').first().attr('src')) || null,
        author: $el.find('[rel="author"], .author, .byline, [itemprop="author"]').first().text().trim(),
        publishedAt: toISO(time.attr('datetime') || time.text().trim(), fetchedAt)
      });
    });
    return { items };
  }

  // Single page mode — extract main content
  $('nav, footer, aside, script, style, [role="navigation"], [role="banner"], .ad, .advertisement, #cookie-notice').remove();
  const text = $('main, article, [role="main"]').first().text().trim() || $('body').text().trim();
  const description = stripHTML(text, 800);
  const image = $('meta[property="og:image"]').attr('content') || $('img[src]').not('[src^="data"]').first().attr('src');

  return {
    items: [{
      ...common,
      id: `webpage:${sourceId}:${hash(text.replace(/\s+/g, ' ').slice(0, 5000))}`,
      title: $('h1').first().text().trim() || $('title').text().trim() || sourceName,
      description,
      url: config.url,
      thumbnail: abs(image) || null,
      author: $('meta[name="author"]').attr('content') || '',
      publishedAt: toISO($('meta[property="article:published_time"]').attr('content') || $('time').first().attr('datetime'), fetchedAt)
    }]
  };
}

const domain = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const hash = str => crypto.createHash('md5').update(str || '').digest('hex').slice(0, 12);

module.exports = { fetchWebpage };
