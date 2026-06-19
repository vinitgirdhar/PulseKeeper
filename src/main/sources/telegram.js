'use strict';

const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

let cheerio;
try { cheerio = require('cheerio'); } catch {}

// Persist Bot API offsets across collection cycles within a session.
// Resets on app restart — acceptable because Telegram queues unread bot
// updates for 24h and the collector deduplicates by item ID anyway.
const _botOffsets = new Map();

function contentHash(str) {
  return crypto.createHash('md5').update(str || '').digest('hex').slice(0, 12);
}

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
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
        reject(new Error(`HTTP ${res.statusCode} fetching Telegram preview`));
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
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout fetching Telegram page')); });
  });
}

// Scrape https://t.me/s/{channel} — works for public channels, no API key needed
async function fetchPublicTelegram(source) {
  const { config, maxItems = 20, name, id: sourceId } = source;
  const channelName = (config.channelName || '')
    .replace(/^@/, '')
    .replace(/^https?:\/\/t\.me\//, '')
    .trim();
  if (!channelName) throw new Error('Telegram source requires a Channel Username');

  const html = await fetchHTML(`https://t.me/s/${channelName}`);
  if (!cheerio) throw new Error('cheerio unavailable — cannot parse Telegram preview page');

  const $ = cheerio.load(html);
  const items = [];

  $('.tgme_widget_message').each((i, el) => {
    if (items.length >= maxItems) return;
    const $el = $(el);
    const text = $el.find('.tgme_widget_message_text').text().trim();
    const dateEl = $el.find('.tgme_widget_message_date');
    const link = dateEl.attr('href') || '';
    const dateStr = dateEl.find('time').attr('datetime') || '';
    const hasMedia = $el.find('.tgme_widget_message_photo_wrap, .tgme_widget_message_video_wrap').length > 0;

    if (!text && !hasMedia && !link) return;

    const title = text
      ? (text.length > 100 ? text.slice(0, 100) + '…' : text)
      : (hasMedia ? '[Media post]' : 'Telegram post');

    items.push({
      id: `telegram:${sourceId}:${contentHash(link || text)}`,
      sourceId,
      sourceName: name || `@${channelName}`,
      sourceType: 'telegram',
      title,
      description: text.slice(0, 500),
      url: link || `https://t.me/${channelName}`,
      thumbnail: null,
      author: `@${channelName}`,
      publishedAt: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
      fetchedAt: new Date().toISOString()
    });
  });

  return items;
}

// Telegram Bot API — works for private channels where the bot is added as admin
function telegramApiGet(botToken, method, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const path = `/bot${botToken}/${method}?${qs}`;
    const req = https.get(
      { hostname: 'api.telegram.org', path, headers: { 'User-Agent': 'PulseKeeper/1.1.0' } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON from Telegram Bot API')); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Telegram Bot API timeout')); });
  });
}

async function fetchBotTelegram(source) {
  const { config, maxItems = 50, name, id: sourceId } = source;
  if (!config.botToken) throw new Error('Bot access method requires a Bot Token (get one from @BotFather)');

  const params = {
    limit: String(Math.min(maxItems, 100)),
    allowed_updates: JSON.stringify(['channel_post', 'message'])
  };
  const lastOffset = _botOffsets.get(sourceId);
  if (lastOffset !== undefined) params.offset = String(lastOffset + 1);

  const data = await telegramApiGet(config.botToken, 'getUpdates', params);
  if (!data.ok) {
    throw new Error(`Telegram Bot API: ${data.description || 'unknown error'} (code ${data.error_code})`);
  }

  const updates = data.result;
  if (!updates.length) return [];

  // Advance offset so next fetch only returns new messages
  _botOffsets.set(sourceId, updates[updates.length - 1].update_id);

  // Optional: filter to a specific chat if chatId or channelName is configured
  const filterChat = (config.chatId || config.channelName || '').replace(/^@/, '').trim();

  const items = [];
  for (const u of updates) {
    const msg = u.channel_post || u.message;
    if (!msg) continue;

    if (filterChat) {
      const strId = String(msg.chat.id);
      const matchById = strId === filterChat || strId === `-100${filterChat}` || strId === filterChat.replace(/^-100/, '');
      const matchByName = msg.chat.username &&
        msg.chat.username.toLowerCase() === filterChat.toLowerCase();
      if (!matchById && !matchByName) continue;
    }

    const text = msg.text || msg.caption || '';
    const chatTitle = msg.chat.title || msg.chat.username || 'Telegram';
    const msgUrl = msg.chat.username
      ? `https://t.me/${msg.chat.username}/${msg.message_id}`
      : `https://t.me/c/${String(msg.chat.id).replace(/^-100/, '')}/${msg.message_id}`;

    items.push({
      id: `telegram:${sourceId}:${u.update_id}`,
      sourceId,
      sourceName: name || chatTitle,
      sourceType: 'telegram',
      title: text ? (text.length > 100 ? text.slice(0, 100) + '…' : text) : '[Media / file post]',
      description: text.slice(0, 500),
      url: msgUrl,
      thumbnail: null,
      author: chatTitle,
      publishedAt: new Date(msg.date * 1000).toISOString(),
      fetchedAt: new Date().toISOString()
    });
  }

  return items;
}

async function fetchTelegram(source) {
  const method = source.config?.accessMethod || 'public';
  return method === 'bot' ? fetchBotTelegram(source) : fetchPublicTelegram(source);
}

module.exports = { fetchTelegram };
