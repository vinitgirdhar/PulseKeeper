'use strict';

// Backend smoke tests — run with `npm test` (node:test, no extra deps).
// Everything runs against local fake servers and a throwaway HOME, so no network
// and none of the real %USERPROFILE%\Documents\PulseKeeper data is touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-test-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const { Storage } = require('../src/main/storage');
const { Collector, mergeItems } = require('../src/main/collector');
const { cronEvery } = require('../src/main/scheduler');
const { stripHTML, canonicalUrl, parseOPML } = require('../src/main/util');
const { fetchRSS } = require('../src/main/sources/rss');
const { discoverFeed } = require('../src/main/sources/rssDiscover');
const { fetchWebpage } = require('../src/main/sources/webpage');
const { fetchYouTube } = require('../src/main/sources/youtube');
const { extractArticle } = require('../src/main/sources/article');
const llm = require('../src/main/llmClient');

const listen = handler => new Promise(resolve => {
  const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
});

const daysAgo = n => new Date(Date.now() - n * 86400000).toUTCString();
const feedXml = items => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Fake</title>${
  items.map(i => `<item><title>${i.title}</title><link>${i.link}</link><guid>${i.link}</guid><pubDate>${i.date}</pubDate>` +
    `<description><![CDATA[${i.desc || ''}]]></description>${i.img ? `<media:thumbnail url="${i.img}"/>` : ''}</item>`).join('')
}</channel></rss>`;

test('cronEvery: multi-hour intervals are really multi-hour', () => {
  assert.equal(cronEvery(30), '*/30 * * * *');
  assert.equal(cronEvery(120), '0 */2 * * *');
  assert.equal(cronEvery(360), '0 */6 * * *');
  assert.equal(cronEvery(24 * 60), '0 0 * * *');
});

test('util: text, url and OPML helpers', () => {
  assert.equal(stripHTML('<p>Tom &amp; Jerry&#8217;s <b>show</b></p><script>x()</script>'), 'Tom & Jerry’s show');
  assert.equal(stripHTML('word '.repeat(50), 20).endsWith('…'), true);
  assert.equal(canonicalUrl('https://www.Example.com/a/b/?utm_source=x&id=2#top'), canonicalUrl('http://example.com/a/b?id=2'));
  assert.deepEqual(parseOPML('<outline text="Tech"><outline text="A &amp; B" xmlUrl="https://a.com/f?x=1&amp;y=2"/></outline>'),
    [{ name: 'A & B', url: 'https://a.com/f?x=1&y=2', category: 'Tech' }]);
});

test('mergeItems: retention is by publish date, with a floor, and old items never count as new', () => {
  const mk = (id, ageDays) => ({ id, publishedAt: new Date(Date.now() - ageDays * 86400000).toISOString() });
  const existing = [mk('a', 0.5), mk('b', 1)];
  const incoming = [mk('b', 1), mk('c', 0.2), ...Array.from({ length: 8 }, (_, i) => mk(`old${i}`, 30 + i))];
  const { items, added } = mergeItems(existing, incoming, { maxItems: 20, retentionDays: 3 });
  assert.deepEqual(items.map(i => i.id), ['c', 'a', 'b', 'old0', 'old1']); // floor of 5 keeps the two newest old ones
  assert.equal(added, 3); // c, plus the two floor items on first sight

  // Later: a newer story pushes old1 out of the floor. Re-fetching it must not resurrect it as "new".
  const again = mergeItems(items, [mk('d', 0.1), ...incoming], { maxItems: 20, retentionDays: 3 });
  assert.equal(again.added, 1);
  assert.deepEqual(again.items.map(i => i.id), ['d', 'c', 'a', 'b', 'old0']);
});

test('fetchRSS: parses a feed, honours ETag, keeps blog type', async () => {
  const xml = feedXml([{ title: 'Hello &amp; welcome', link: 'https://x.test/1', date: daysAgo(0), desc: '<p>Body &#8217;text&#8217;</p>', img: 'https://x.test/i.png' }]);
  let hits = 0;
  const { server, base } = await listen((req, res) => {
    hits++;
    if (req.headers['if-none-match'] === '"v1"') { res.writeHead(304); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/rss+xml', ETag: '"v1"' });
    res.end(xml);
  });
  try {
    const source = { id: 's1', type: 'blog', name: 'My Blog', maxItems: 5, config: { url: `${base}/feed.xml` } };
    const first = await fetchRSS(source, {});
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].sourceType, 'blog');
    assert.equal(first.items[0].title, 'Hello & welcome');
    assert.equal(first.items[0].description, 'Body ’text’');
    assert.equal(first.items[0].thumbnail, 'https://x.test/i.png');
    assert.match(first.items[0].publishedAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(first.state.etag, '"v1"');

    const second = await fetchRSS(source, first.state);
    assert.equal(second.notModified, true);
    assert.equal(hits, 2);
  } finally { server.close(); }
});

test('discoverFeed: finds <link rel=alternate> and falls back to common paths', async () => {
  const xml = feedXml([{ title: 't', link: 'https://x.test/1', date: daysAgo(0) }]);
  const { server, base } = await listen((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><head><link type="application/rss+xml" rel="alternate" href="/custom.xml"></head></html>'); }
    if (req.url === '/custom.xml' || req.url === '/blog/feed') { res.writeHead(200); return res.end(xml); }
    res.writeHead(404); res.end('nope');
  });
  try {
    assert.equal(await discoverFeed(base + '/'), `${base}/custom.xml`);
    assert.equal(await discoverFeed(base + '/nothing-here'), `${base}/blog/feed`);
  } finally { server.close(); }
});

test('fetchWebpage: selector mode resolves links; single-page ids change with content', async () => {
  let body = `<html><head><title>News</title></head><body>
    <article><h2>First post</h2><a href="/p/1">more</a><p>Summary one</p><time datetime="2026-01-02T10:00:00Z"></time><img src="/i1.png"></article>
    <article><h2>Second post</h2><a href="https://other.test/2">more</a><p>Summary two</p></article></body></html>`;
  const { server, base } = await listen((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(body); });
  try {
    const src = { id: 'w1', name: 'Site', maxItems: 5, config: { url: `${base}/news`, selector: 'article' } };
    const { items } = await fetchWebpage(src);
    assert.deepEqual(items.map(i => i.title), ['First post', 'Second post']);
    assert.equal(items[0].url, `${base}/p/1`);
    assert.equal(items[0].thumbnail, `${base}/i1.png`);
    assert.equal(items[0].publishedAt, '2026-01-02T10:00:00.000Z');
    assert.equal(items[1].url, 'https://other.test/2');

    const single = { id: 'w2', name: 'Page', config: { url: `${base}/page` } };
    const a = (await fetchWebpage(single)).items[0].id;
    assert.equal((await fetchWebpage(single)).items[0].id, a, 'same content, same id');
    body = body.replace('Summary one', 'Summary CHANGED');
    assert.notEqual((await fetchWebpage(single)).items[0].id, a, 'changed content, new id');
  } finally { server.close(); }
});

test('fetchYouTube: direct feed URL, video ids and thumbnails', async () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
    <title>Chan</title><entry><id>yt:video:abc123</id><yt:videoId>abc123</yt:videoId><title>Video &amp; more</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/><published>2026-01-01T00:00:00+00:00</published>
    <media:group><media:description>Great video</media:description></media:group></entry></feed>`;
  const { server, base } = await listen((req, res) => { res.writeHead(200, { 'Content-Type': 'application/atom+xml' }); res.end(xml); });
  try {
    const { items } = await fetchYouTube({ id: 'y1', name: 'Chan', maxItems: 5, config: { url: `${base}/feeds/videos.xml?channel_id=UCx` } });
    assert.equal(items[0].url, 'https://www.youtube.com/watch?v=abc123');
    assert.equal(items[0].thumbnail, 'https://i.ytimg.com/vi/abc123/mqdefault.jpg');
    assert.equal(items[0].title, 'Video & more');
    assert.equal(items[0].description, 'Great video');
    assert.equal(items[0].sourceType, 'youtube');
  } finally { server.close(); }
});

test('storage + collector end to end', async () => {
  const state = { fail: false, body: feedXml([
    { title: 'Fresh security story', link: 'https://news.test/a?utm_source=rss', date: daysAgo(0.1) },
    { title: 'Sponsored: buy now', link: 'https://news.test/ad', date: daysAgo(0.2) },
    ...Array.from({ length: 6 }, (_, i) => ({ title: `Ancient story ${i}`, link: `https://news.test/old${i}`, date: daysAgo(90 + i) }))
  ]) };
  const { server, base } = await listen((req, res) => {
    if (state.fail) { res.writeHead(500); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    res.end(state.body);
  });
  try {
    const storage = new Storage();
    await storage.init();
    for (const s of await storage.getSources()) await storage.updateSource(s.id, { enabled: false }); // only our fakes

    const a = await storage.addSource({ name: 'Feed A', type: 'rss', category: 'Security', config: { url: `${base}/a.xml` } });
    const b = await storage.addSource({ name: 'Feed B', type: 'blog', category: 'Security', config: { url: `${base}/b.xml` } });
    const collector = new Collector(storage);

    // Two overlapping feeds are fetched in one sweep. Each keeps 2 fresh + the 3 newest ancient (retention floor of 5).
    const r = await collector.collectAll();
    assert.equal(r.succeeded, 2);
    assert.equal((await storage.getContent(a.id)).length, 5);

    assert.equal((await storage.queryContent()).total, 5, 'same-URL stories from two sources collapse into one');
    assert.equal((await storage.queryContent({ sourceId: b.id })).total, 5, 'a single-source view is not deduped');
    assert.deepEqual((await storage.queryContent({ search: 'security' })).items.map(i => i.title), ['Fresh security story']);
    assert.equal((await storage.queryContent({ type: 'blog' })).total, 5, 'type comes from the source, not the stored item');
    assert.equal((await storage.queryContent({ type: 'rss', sourceId: b.id })).total, 0);

    // Mute words apply retroactively, without refetching.
    await storage.saveSettings({ ...(await storage.getSettings()), muteWords: ['sponsored'] });
    assert.equal((await storage.queryContent({ search: 'buy' })).total, 0);
    assert.equal((await storage.queryContent()).total, 4);

    // Read state flows into counts.
    const [first] = (await storage.queryContent({ category: 'Security' })).items;
    await storage.markRead([first.id]);
    const ch = await storage.getChannels();
    const sec = ch.categories.find(c => c.name === 'Security');
    assert.equal(sec.sources.length, 2);
    assert.equal(sec.total, 4);
    assert.equal(sec.unread, 3);
    assert.equal(ch.total, 4);

    // Health: success clears errors; a failing feed backs off after repeated failures.
    state.fail = true;
    for (let i = 0; i < 3; i++) await collector.collectOne(a.id).catch(() => {});
    let health = (await storage.getSourceHealth())[a.id];
    assert.equal(health.consecutiveFailures, 3);
    assert.match(health.lastError, /HTTP 500/);
    assert.equal(collector._due({ id: a.id }, { ...health, lastFetchedAt: new Date().toISOString() }), false);
    state.fail = false;
    await collector.collectOne(a.id);
    health = (await storage.getSourceHealth())[a.id];
    assert.equal(health.consecutiveFailures, 0);
    assert.equal(health.lastError, null);

    // Parallel health writes must not clobber each other.
    await Promise.all(Array.from({ length: 40 }, (_, i) => storage.updateSourceHealth(`id${i}`, { n: i })));
    const h = await storage.getSourceHealth();
    assert.equal(Object.keys(h).filter(k => k.startsWith('id')).length, 40);
  } finally { server.close(); }
});

test('llm: native Ollama streaming, think-stripping, model list, per-provider keys', async () => {
  let seen;
  const ndjson = parts => parts.map(p => JSON.stringify(p)).join('\n') + '\n';
  const { server, base } = await listen((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url === '/api/tags') { res.writeHead(200); return res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen2.5:7b' }] })); }
      if (req.url === '/api/chat') {
        seen = JSON.parse(body);
        if (seen.model === 'ghost') { res.writeHead(404); return res.end(JSON.stringify({ error: "model 'ghost' not found" })); }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        return res.end(ndjson([{ message: { content: '<think>hmm</think>' } }, { message: { content: '## Digest\n- one' } }, { done: true }]));
      }
      if (req.url === '/v1/chat/completions') {
        seen = { auth: req.headers.authorization, ...JSON.parse(body) };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi ' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'there' } }] })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(404); res.end();
    });
  });
  try {
    const items = Array.from({ length: 200 }, (_, i) => ({ sourceName: 'S', title: `Story ${i}`, description: 'x'.repeat(400), url: `https://s.test/${i}`, publishedAt: '2026-01-01' }));
    const cfg = { provider: 'ollama', model: 'llama3.2', baseURL: `${base}/v1`, numCtx: 4096, maxItems: 200, timeoutMs: 5000 };

    const out = await llm.generateDigest(cfg, items);
    assert.equal(out.markdown, '## Digest\n- one');
    assert.equal(seen.options.num_ctx, 4096);
    assert.equal(seen.think, false);
    assert.ok(out.used > 0 && out.used < 200, `prompt is trimmed to fit the context window (used ${out.used})`);

    assert.deepEqual(await llm.listModels(cfg), ['llama3.2:latest', 'qwen2.5:7b']);
    await assert.rejects(llm.testConnection({ ...cfg, model: 'ghost' }), /isn't installed.*ollama pull ghost/);

    const custom = { provider: 'custom', model: 'm', baseURL: `${base}/v1`, apiKeys: { custom: 'sk-from-map' }, timeoutMs: 5000 };
    assert.equal((await llm.testConnection(custom)).reply, 'Hi there');
    assert.equal(seen.auth, 'Bearer sk-from-map');
    assert.equal(llm.isConfigured({ enabled: true, provider: 'openai', apiKeys: { openai: 'k' } }), true);
    assert.equal(llm.isConfigured({ enabled: true, provider: 'openai' }), false);
  } finally { server.close(); }
});

test('saved stories outlive pruning and their source; summaries are cached', async () => {
  const storage = new Storage();
  await storage.init();
  const src = await storage.addSource({ name: 'Keeper', type: 'blog', category: 'Reading', config: { url: 'https://k.test/feed' } });
  const item = { id: 'k:1', sourceId: src.id, sourceName: 'Keeper', sourceType: 'blog', title: 'Keep me', description: 'd', url: 'https://k.test/1', publishedAt: new Date().toISOString(), fetchedAt: new Date().toISOString() };
  await storage.saveContent(src.id, [item]);

  assert.equal(await storage.setSaved('k:1', true), true);
  await assert.rejects(storage.setSaved('nope', true), /not found/);
  assert.equal((await storage.queryContent({ sourceId: src.id })).items[0].saved, true);

  await storage.saveContent(src.id, []);            // retention pruned it…
  await storage.deleteSource(src.id);               // …and the source is gone
  const saved = await storage.queryContent({ saved: true });
  assert.deepEqual(saved.items.map(i => [i.id, i.saved, i.category]), [['k:1', true, 'Saved']]);
  assert.equal((await storage.getChannels()).saved, 1);
  assert.equal((await storage.getItem('k:1')).title, 'Keep me');

  await storage.markRead(['k:1']);
  assert.equal((await storage.getChannels()).savedUnread, 0);
  assert.equal(await storage.setSaved('k:1', false), false);
  assert.equal((await storage.queryContent({ saved: true })).total, 0);

  assert.equal(await storage.getSummary('k:1'), null);
  await storage.saveSummary('k:1', { markdown: '- one' });
  assert.equal((await storage.getSummary('k:1')).markdown, '- one');
});

test('extractArticle: finds the article body, drops page furniture', async () => {
  const para = n => `<p>Paragraph ${n} of the story with enough words to count as real article text for the extractor.</p>`;
  const page = `<html><body class="single comments-open"><nav><p>Home About Contact us today for more links and menus</p></nav>
    <article><h1>Headline</h1><h2>Subhead</h2>${para(1)}${para(2)}${para(3)}<div class="share-bar"><p>Share this story on every network you like</p></div></article>
    <aside><p>Related: some other story that should not be part of the summary text at all</p></aside><footer><p>Copyright notice that is long enough to pass the length filter easily</p></footer></body></html>`;
  const { server, base } = await listen((req, res) => {
    if (req.url === '/pdf') { res.writeHead(200); return res.end('%PDF-1.4 binary'); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page);
  });
  try {
    const text = await extractArticle(`${base}/a`);
    assert.match(text, /Paragraph 1[\s\S]*Paragraph 3/);
    assert.match(text, /## Subhead/);
    assert.doesNotMatch(text, /Home About|Share this story|Related:|Copyright/);
    assert.equal(await extractArticle(`${base}/pdf`), '');
    assert.equal(await extractArticle('file:///etc/passwd'), '');
  } finally { server.close(); }
});

test('llm: summarizeItem sends the article, trimmed to the context window', async () => {
  let seen;
  const { server, base } = await listen((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(JSON.stringify({ message: { content: '- point one\n- point two' } }) + '\n' + JSON.stringify({ done: true }) + '\n');
    });
  });
  try {
    const cfg = { provider: 'ollama', model: 'm', baseURL: base, numCtx: 2048, timeoutMs: 5000 };
    const item = { title: 'T', sourceName: 'S', publishedAt: '2026-01-01', description: 'teaser' };
    const progress = [];
    const out = await llm.summarizeItem(cfg, item, 'word '.repeat(20000), { onProgress: (n, t) => progress.push(t) });
    assert.equal(out.markdown, '- point one\n- point two');
    assert.match(seen.messages[1].content, /^Title: T\nSource: S/);
    assert.ok(seen.messages[1].content.length < 6000, 'article cut to fit a 2048-token window');
    assert.equal(seen.options.num_ctx, 2048);
    assert.ok(progress.at(-1).includes('point two'));

    await llm.summarizeItem(cfg, item, '');
    assert.match(seen.messages[1].content, /teaser$/, 'falls back to the feed teaser');
  } finally { server.close(); }
});
