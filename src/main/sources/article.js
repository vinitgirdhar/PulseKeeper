'use strict';

// Best-effort readable text of an article page, used to give the AI summary more
// than the feed's teaser. Never throws for "couldn't read it" — returns ''.

const cheerio = require('cheerio');
const { fetchText } = require('../http');
const { httpUrl, stripHTML } = require('../util');

const MAX_CHARS = 12000;
const MIN_CHARS = 200;
// Page furniture that is never article text. Applied *inside* the chosen root only:
// a class like "comments-open" on <body> must not wipe out the whole page.
const NOISE = 'script, style, noscript, nav, footer, aside, form, iframe, svg, figure, [role="navigation"], [aria-hidden="true"], '
  + '[class*="comment"], [class*="share"], [class*="cookie"], [class*="newsletter"], [class*="related"], [class*="promo"], [class*="subscribe"]';

const textOf = el => stripHTML(el.text());

async function extractArticle(url) {
  if (!httpUrl(url)) return '';
  if (/^169\.254\./.test(new URL(url).hostname)) return ''; // cloud metadata endpoints are never an article

  const res = await fetchText(url, {
    timeout: 15000, retries: 1, maxBytes: 1500000,
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-US,en;q=0.9' }
  });
  if (!/<(html|body|article)\b/i.test(res.text.slice(0, 4000))) return ''; // PDF, JSON, …

  const $ = cheerio.load(res.text);
  // The candidate holding the most paragraph text wins (listing pages have many <article>s).
  const weight = el => $(el).find('p').toArray().reduce((n, p) => n + textOf($(p)).length, 0);
  const root = [...$('article, main, [role="main"]').toArray(), $('body')[0]]
    .filter(Boolean)
    .sort((a, b) => weight(b) - weight(a))[0];
  if (!root) return '';

  const $root = $(root);
  $root.find(NOISE).remove();

  const seen = new Set();
  const parts = [];
  $root.find('h2, h3, p, li, blockquote').each((_, el) => {
    const t = textOf($(el));
    const heading = /^h[23]$/i.test(el.tagName);
    if (!t || (!heading && t.length < 40) || seen.has(t)) return;
    seen.add(t);
    parts.push(heading ? `## ${t}` : t);
  });

  let text = parts.join('\n\n');
  if (text.length < MIN_CHARS) return '';
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS).replace(/\s+\S*$/, '') + '…';
  return text;
}

module.exports = { extractArticle };
