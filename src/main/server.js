'use strict';

// Local HTTP capture server for the PulseKeeper browser extension.
// The extension sends POSTs to http://localhost:7828/capture

const http = require('http');
const { v4: uuidv4 } = require('uuid');

const PORT = 7828;
const CAPTURE_SOURCE_NAME = 'Browser Captures';

class CaptureServer {
  constructor(storage) {
    this.storage = storage;
    this._server = null;
    this._captureSourceId = null;
  }

  start() {
    this._server = http.createServer((req, res) => this._handle(req, res));

    this._server.listen(PORT, '127.0.0.1', () => {
      console.log(`[PulseKeeper] Capture server listening on http://127.0.0.1:${PORT}`);
    });

    this._server.on('error', (e) => {
      if (e.code !== 'EADDRINUSE') {
        console.error('[PulseKeeper] Capture server error:', e.message);
      }
      // EADDRINUSE: another PulseKeeper instance is running, silently skip
    });
  }

  stop() {
    if (this._server) { this._server.close(); this._server = null; }
  }

  _cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  _handle(req, res) {
    this._cors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: 'PulseKeeper', version: '1.1.0', ok: true }));
      return;
    }

    if (req.method === 'POST' && req.url === '/capture') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 100000) req.destroy(); });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const item = await this._handleCapture(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id: item.id }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404); res.end();
  }

  async _handleCapture(data) {
    const { url, title, content, selection, type = 'page' } = data;
    if (!url) throw new Error('url is required');

    // Lazily create/find the Browser Captures source
    const sourceId = await this._getCaptureSourceId();

    const item = {
      id: `capture:${uuidv4()}`,
      sourceId,
      sourceName: CAPTURE_SOURCE_NAME,
      sourceType: 'web-capture',
      title: title || url,
      description: (selection || content || '').slice(0, 600),
      url,
      thumbnail: null,
      author: '',
      captureType: type,  // 'page' | 'selection' | 'link'
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString()
    };

    const existing = await this.storage.getContent(sourceId);
    // Prepend new item, keep up to 500 captures
    await this.storage.saveContent(sourceId, [item, ...existing].slice(0, 500));
    return item;
  }

  async _getCaptureSourceId() {
    if (this._captureSourceId) return this._captureSourceId;

    const sources = await this.storage.getSources();
    let source = sources.find(s => s.name === CAPTURE_SOURCE_NAME && s.type === 'web-capture');

    if (!source) {
      source = await this.storage.addSource({
        name: CAPTURE_SOURCE_NAME,
        type: 'web-capture',
        enabled: true,
        config: {},
        maxItems: 500
      });
    }

    this._captureSourceId = source.id;
    return this._captureSourceId;
  }
}

module.exports = { CaptureServer, PORT };
