'use strict';

// Single HTTP helper for every source fetcher: UA, timeout, size cap, charset,
// retry on transient failures, conditional GET. Uses the built-in fetch, which
// already follows redirects and decodes gzip/deflate/br.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_BYTES = 5 * 1024 * 1024;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isTransient(e) {
  if (e.status) return e.status >= 502 && e.status <= 504;
  return true; // network error / timeout
}

// "fetch failed" is useless to a user — surface the underlying cause instead.
function describe(e, timeout) {
  if (e.status) return `HTTP ${e.status}`;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return `Timed out after ${Math.round(timeout / 1000)}s`;
  const code = e.cause?.code || e.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Host not found — check the URL or your connection';
  if (code === 'ECONNREFUSED') return 'Connection refused';
  if (code === 'ECONNRESET') return 'Connection reset by server';
  return code || e.cause?.message || e.message;
}

async function readCapped(res, maxBytes) {
  const type = res.headers.get('content-type') || '';
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1];
  let decoder;
  try { decoder = new TextDecoder(charset || 'utf-8'); } catch { decoder = new TextDecoder('utf-8'); }

  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= maxBytes) { await reader.cancel(); break; } // truncate, don't fail
  }
  return decoder.decode(Buffer.concat(chunks));
}

/**
 * GET (or POST) a URL as text.
 * @returns {{ text, url, status, etag, lastModified, notModified }}
 *   `notModified` is true on a 304 — the caller's cached copy is still current.
 */
async function fetchText(url, opts = {}) {
  const {
    timeout = 15000, retries = 2, maxBytes = MAX_BYTES,
    method = 'GET', body, headers = {}, etag, lastModified
  } = opts;

  const h = { 'User-Agent': UA, ...headers };
  if (etag) h['If-None-Match'] = etag;
  if (lastModified) h['If-Modified-Since'] = lastModified;

  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(400 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { method, headers: h, body, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
      if (res.status === 304) return { text: '', url: res.url, status: 304, etag, lastModified, notModified: true };
      if (!res.ok) { res.body?.cancel().catch(() => {}); throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }); }
      return {
        text: await readCapped(res, maxBytes), url: res.url, status: res.status,
        etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), notModified: false
      };
    } catch (e) {
      last = e;
      if (!isTransient(e)) break;
    }
  }
  throw Object.assign(new Error(describe(last, timeout)), { status: last.status });
}

module.exports = { fetchText, UA };
