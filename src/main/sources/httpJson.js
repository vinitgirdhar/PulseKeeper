'use strict';

// Shared HTTPS JSON fetch helper for the security feeds (CVE, CISA KEV,
// Abuse.ch). Mirrors the gzip/redirect handling already used in reddit.js so we
// stay consistent with the codebase and avoid relying on global fetch.
const https = require('https');
const zlib = require('zlib');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * GET a URL and return the raw response body as a string.
 * @param {string} url
 * @param {object} [opts]  { headers, timeout, maxRedirects }
 * @returns {Promise<string>}
 */
function getText(url, opts = {}) {
  const { headers = {}, timeout = 15000, maxRedirects = 3 } = opts;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Encoding': 'gzip, deflate, br', ...headers }
    }, res => {
      const code = res.statusCode;
      if ((code === 301 || code === 302 || code === 307 || code === 308) && res.headers.location) {
        res.resume();
        if (maxRedirects <= 0) { reject(new Error('Too many redirects')); return; }
        getText(res.headers.location, { ...opts, maxRedirects: maxRedirects - 1 }).then(resolve, reject);
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`HTTP ${code} from ${url}`));
        return;
      }
      const enc = res.headers['content-encoding'];
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', c => { body += c; });
      stream.on('end', () => resolve(body));
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`Request to ${url} timed out`)); });
  });
}

/**
 * GET a URL and parse the body as JSON.
 * @returns {Promise<any>}
 */
async function getJSON(url, opts = {}) {
  const body = await getText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  try { return JSON.parse(body); }
  catch { throw new Error(`Invalid JSON from ${url}`); }
}

module.exports = { getText, getJSON, BROWSER_UA };
