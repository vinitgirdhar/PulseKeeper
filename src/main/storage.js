'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { canonicalUrl } = require('./util');

const DATA_DIR    = path.join(os.homedir(), 'Documents', 'PulseKeeper');
const SOURCES_FILE  = path.join(DATA_DIR, 'sources.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const OUTPUT_DIR  = path.join(DATA_DIR, 'output');
const HISTORY_DIR   = path.join(DATA_DIR, 'history');
const EXTENSION_DIR = path.join(DATA_DIR, 'extension');
const READ_FILE   = path.join(DATA_DIR, 'read.json');
const HEALTH_FILE = path.join(DATA_DIR, 'health.json');
const AIDIGEST_FILE = path.join(DATA_DIR, 'ai-digest.json');
const SAVED_FILE  = path.join(DATA_DIR, 'saved.json');
const SUMMARIES_FILE = path.join(DATA_DIR, 'summaries.json');

const DEFAULT_SETTINGS = {
  refreshInterval: 30,
  runAtStartup: false,
  collectOnStartup: true,
  maxItemsPerSource: 20,
  outputFormat: 'html',
  digestBrowser: 'internal',
  retentionDays: 3,
  autoDigest: {
    enabled: false,
    mode: 'interval',      // 'interval' = every N hours, 'daily' = once at `time`
    everyHours: 8,
    time: '08:00'
  },
  muteWords: [],
  historyMaxCount: 10,
  llm: {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    apiKey: '',
    baseURL: '',
    timeoutMs: 900000,     // 15 min — slow local CPU models need lots of headroom
    numCtx: 8192,          // Ollama context window (tokens); also bounds how much content is sent
    maxItems: 50,          // how many items to summarize; lower = much faster locally
    generateDigest: true,
    digestPrompt: 'Summarize the following content items into a concise daily digest with key highlights and insights:'
  },
  display: {
    theme: 'dark',
    accentColor: 'blue',   // blue | purple | pink | red | orange | green | graphite
    digestFontSize: 'medium'
  },
  notifications: {
    enabled: true,
    onRefresh: false,
    onNewContent: true
  },
  captureServer: {
    enabled: true,
    port: 7828
  }
};

const DEFAULT_SOURCES = [
  {
    id: uuidv4(),
    name: 'Hacker News',
    type: 'rss',
    enabled: true,
    config: { url: 'https://news.ycombinator.com/rss' },
    maxItems: 15,
    icon: 'rss'
  },
  {
    id: uuidv4(),
    name: 'r/technology',
    type: 'reddit',
    enabled: true,
    config: { subreddit: 'technology' },
    maxItems: 10,
    icon: 'reddit'
  }
];

const categoryOf = s => s.category || (s.type === 'web-capture' ? 'Clips' : 'General');

const READ_CAP = 10000;
const SAVED_CAP = 1000;
const SUMMARY_CAP = 300;

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (overrides[key] !== null && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])
        && typeof defaults[key] === 'object' && defaults[key] !== null) {
      result[key] = deepMerge(defaults[key], overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}

const ts = it => Date.parse(it.publishedAt) || Date.parse(it.fetchedAt) || 0;
const newestFirst = (a, b) => ts(b) - ts(a);

// One story per canonical URL — the first (newest) copy wins.
function dedupe(items) {
  const seen = new Set();
  return items.filter(it => {
    const key = it.url ? canonicalUrl(it.url) : it.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/*
 * File-backed store. Every read-modify-write below is fully synchronous (no
 * `await` between the read and the write), so concurrent callers — parallel
 * collectors, IPC handlers, the capture server — can never interleave and lose
 * an update. The async public methods are thin wrappers kept for API stability.
 *
 * Reads are cached by (mtime, size): re-parsing only happens when a file
 * actually changed, including edits made by external tools (pk-bridge, a text
 * editor). Cached values are shared — treat them as immutable.
 */
class Storage {
  constructor() {
    this._cache = new Map();
    this._memo = {};
    this._quarantined = new Set();
  }

  async init() {
    for (const dir of [DATA_DIR, CONTENT_DIR, OUTPUT_DIR, HISTORY_DIR, EXTENSION_DIR]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(SETTINGS_FILE)) this._write(SETTINGS_FILE, DEFAULT_SETTINGS);
    if (!fs.existsSync(SOURCES_FILE))  this._write(SOURCES_FILE, DEFAULT_SOURCES);
  }

  // ─── Settings ────────────────────────────────────────────────────────────────
  getSettingsSync() {
    const raw = this._read(SETTINGS_FILE, {});
    if (this._memo.settingsRaw !== raw) {
      this._memo.settingsRaw = raw;
      this._memo.settings = deepMerge(DEFAULT_SETTINGS, raw);
    }
    return structuredClone(this._memo.settings);
  }

  async getSettings() { return this.getSettingsSync(); }

  async saveSettings(settings) { this._write(SETTINGS_FILE, settings); }

  // ─── Sources ─────────────────────────────────────────────────────────────────
  _sources() {
    const raw = this._read(SOURCES_FILE, []);
    if (this._memo.sourcesRaw !== raw) {
      this._memo.sourcesRaw = raw;
      this._memo.sources = raw.map(s => ({ ...s, category: categoryOf(s) }));
    }
    return this._memo.sources;
  }

  async getSources() { return structuredClone(this._sources()); }

  async saveSources(sources) { this._write(SOURCES_FILE, sources); }

  async addSource(source) {
    const maxItems = this.getSettingsSync().maxItemsPerSource || 20;
    const newSource = { id: uuidv4(), enabled: true, maxItems, ...source };
    this._write(SOURCES_FILE, [...this._sources(), newSource]);
    return { ...newSource, category: categoryOf(newSource) };
  }

  async updateSource(id, updates) {
    const sources = this._sources();
    if (!sources.some(s => s.id === id)) throw new Error(`Source ${id} not found`);
    const next = sources.map(s => (s.id === id ? { ...s, ...updates, id } : s));
    this._write(SOURCES_FILE, next);
    return next.find(s => s.id === id);
  }

  async deleteSource(id) {
    this._write(SOURCES_FILE, this._sources().filter(s => s.id !== id));
    fs.rmSync(path.join(CONTENT_DIR, `${id}.json`), { force: true });
    const health = { ...this._read(HEALTH_FILE, {}) };
    delete health[id];
    this._write(HEALTH_FILE, health);
  }

  // ─── Content Cache ────────────────────────────────────────────────────────────
  _content(sourceId) { return this._read(path.join(CONTENT_DIR, `${sourceId}.json`), []); }

  async getContent(sourceId) { return this._content(sourceId); }

  async saveContent(sourceId, items) { this._write(path.join(CONTENT_DIR, `${sourceId}.json`), items, false); }

  // An item as the UI sees it: stamped with its source's *current* name/type/category
  // (so renames and re-categorising take effect without re-fetching), plus read/saved flags.
  // A saved item whose source was deleted keeps the values it was saved with.
  _stamp(it, source, read, saved) {
    return {
      ...it,
      sourceName: source ? source.name : it.sourceName,
      sourceType: source ? (source.type === 'rss' && it.sourceType === 'podcast' ? 'podcast' : source.type) : it.sourceType,
      category: source ? source.category : (it.category || 'Saved'),
      read: read.has(it.id),
      saved: saved.has(it.id)
    };
  }

  // Enabled sources with their visible items (global + per-source mute words applied).
  _snapshot() {
    const mute = (this.getSettingsSync().muteWords || []).map(w => String(w).toLowerCase().trim()).filter(Boolean);
    const read = this._readSet();
    const saved = this._savedSet();
    return this._sources().filter(s => s.enabled).map(source => {
      const muted = mute.length && !source.ignoreMute
        ? it => { const text = `${it.title || ''} ${it.description || ''}`.toLowerCase(); return mute.some(w => text.includes(w)); }
        : () => false;
      const items = [];
      for (const it of this._content(source.id)) if (!muted(it)) items.push(this._stamp(it, source, read, saved));
      return { source, items };
    });
  }

  // ─── Saved stories ────────────────────────────────────────────────────────────
  // A saved story is stored as a full snapshot, so it outlives retention pruning
  // and deleting its source.
  _saved() { return this._read(SAVED_FILE, []); }

  _savedSet() {
    const arr = this._saved();
    if (this._memo.savedArr !== arr) {
      this._memo.savedArr = arr;
      this._memo.savedSet = new Set(arr.map(i => i.id));
    }
    return this._memo.savedSet;
  }

  _findItem(id) {
    for (const s of this._sources()) {
      const it = this._content(s.id).find(i => i.id === id);
      if (it) return it;
    }
    return null;
  }

  /** A story by id — from the live cache, else from saved snapshots. */
  async getItem(id) { return this._findItem(id) || this._saved().find(i => i.id === id) || null; }

  /** @returns {boolean} whether the story is saved afterwards */
  async setSaved(id, saved) {
    const list = this._saved();
    const has = list.some(i => i.id === id);
    if (!saved) {
      if (has) this._write(SAVED_FILE, list.filter(i => i.id !== id), false);
      return false;
    }
    if (has) return true;
    const item = this._findItem(id);
    if (!item) throw new Error('Story not found — it may have been pruned already.');
    this._write(SAVED_FILE, [{ ...item, savedAt: new Date().toISOString() }, ...list].slice(0, SAVED_CAP), false);
    return true;
  }

  // ─── AI story summaries (cached so reopening a story is instant) ─────────────
  async getSummary(id) { return this._read(SUMMARIES_FILE, {})[id] || null; }

  async saveSummary(id, data) {
    const all = { ...this._read(SUMMARIES_FILE, {}) };
    delete all[id]; // re-insert at the end: oldest entries are trimmed first
    all[id] = data;
    for (const key of Object.keys(all).slice(0, Math.max(0, Object.keys(all).length - SUMMARY_CAP))) delete all[key];
    this._write(SUMMARIES_FILE, all, false);
  }

  /**
   * Read model for the news view, tray popup, digest and LLM: filter, search,
   * sort, dedupe and page here so the renderer never holds the whole corpus.
   * @param {{ sourceId?, category?, type?, saved?, unreadOnly?, search?, sort?: 'newest'|'oldest'|'source', limit?, offset? }} q
   * @returns {{ items: object[], total: number }}
   */
  async queryContent(q = {}) {
    const { sourceId, category, type, saved, unreadOnly, search, sort = 'newest', limit, offset = 0 } = q;
    const terms = String(search || '').toLowerCase().split(/\s+/).filter(Boolean);

    let items;
    if (saved) { // most recently saved first; not muted, not deduped, whatever the source's state
      const byId = new Map(this._sources().map(s => [s.id, s]));
      const read = this._readSet();
      const set = this._savedSet();
      items = this._saved().map(it => this._stamp(it, byId.get(it.sourceId), read, set));
    } else {
      items = this._snapshot()
        .filter(({ source }) => (!sourceId || source.id === sourceId) && (!category || source.category === category))
        .flatMap(g => g.items)
        .sort(newestFirst);
    }

    if (type) items = items.filter(i => i.sourceType === type);
    if (unreadOnly) items = items.filter(i => !i.read);
    if (terms.length) {
      items = items.filter(i => {
        const hay = `${i.title} ${i.description} ${i.sourceName} ${i.author}`.toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    if (!sourceId && !saved) items = dedupe(items); // one source is shown whole; every wider view is one story per URL
    if (sort === 'oldest') items.reverse();
    else if (sort === 'source') items.sort((a, b) => a.sourceName.localeCompare(b.sourceName) || newestFirst(a, b));

    const total = items.length;
    return { items: limit ? items.slice(offset, offset + limit) : items.slice(offset), total };
  }

  async getAllContent() { return (await this.queryContent()).items; }

  /**
   * Navigation tree for the news sidebar: categories → sources, with totals and
   * unread counts that match exactly what queryContent returns for each node.
   */
  async getChannels() {
    const health = this._read(HEALTH_FILE, {});
    const unreadOf = list => list.reduce((n, i) => n + (i.read ? 0 : 1), 0);
    // Same rule as queryContent: filter first, then one story per URL.
    const counts = sorted => ({ total: dedupe(sorted).length, unread: dedupe(sorted.filter(i => !i.read)).length });
    const categories = new Map();
    for (const { source, items } of this._snapshot()) {
      if (!categories.has(source.category)) categories.set(source.category, { name: source.category, groups: [] });
      categories.get(source.category).groups.push({ source, items });
    }

    const everything = [];
    const tree = [...categories.values()].map(c => {
      const items = c.groups.flatMap(g => g.items);
      everything.push(...items);
      return {
        name: c.name,
        ...counts(items.sort(newestFirst)),
        sources: c.groups.map(({ source, items }) => ({
          id: source.id, name: source.name, type: source.type, total: items.length, unread: unreadOf(items),
          error: health[source.id]?.lastError || null
        }))
      };
    });
    const read = this._readSet();
    const saved = this._saved();
    return {
      ...counts(everything.sort(newestFirst)),
      saved: saved.length,
      savedUnread: saved.filter(i => !read.has(i.id)).length,
      categories: tree
    };
  }

  // ─── Output ───────────────────────────────────────────────────────────────────
  getOutputPath(format) {
    const ext = format === 'markdown' ? 'md' : format;
    return path.join(OUTPUT_DIR, `digest.${ext}`);
  }

  async saveOutput(format, content) {
    const file = this.getOutputPath(format);
    fs.writeFileSync(file, content, Buffer.isBuffer(content) ? undefined : 'utf8');
    // Also save a timestamped copy to history
    await this.saveHistory(format, content);
    return file;
  }

  getDataDir()      { return DATA_DIR; }
  getOutputDir()    { return OUTPUT_DIR; }
  getHistoryDir()   { return HISTORY_DIR; }
  getExtensionDir() { return EXTENSION_DIR; }

  // ─── Cached AI Digest ─────────────────────────────────────────────────────────
  // The AI summary is expensive (a slow local model can take minutes), so it's
  // generated on a schedule and cached here. Opening the digest reads this cache
  // instead of re-calling the model every time.
  async getAIDigest() { return this._read(AIDIGEST_FILE, null); }

  async saveAIDigest(data) { this._write(AIDIGEST_FILE, { generatedAt: new Date().toISOString(), ...data }); }

  // ─── Digest History ───────────────────────────────────────────────────────────
  async saveHistory(format, content) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const ext = format === 'markdown' ? 'md' : format;
    const file = path.join(HISTORY_DIR, `digest-${stamp}.${ext}`);
    fs.writeFileSync(file, content, Buffer.isBuffer(content) ? undefined : 'utf8');
    this._pruneHistory(this.getSettingsSync().historyMaxCount || 10);
    return file;
  }

  async getHistory() {
    if (!fs.existsSync(HISTORY_DIR)) return [];
    return fs.readdirSync(HISTORY_DIR)
      .filter(f => /^digest-.+\.(html|md|pdf)$/.test(f))
      .sort().reverse()
      .slice(0, 30)
      .map(f => {
        const label = f
          .replace(/^digest-/, '')
          .replace(/\.(html|md|pdf)$/, '')
          .replace(/_/, ' ')
          .replace(/-(\d{2})$/, ':$1');
        return { file: f, path: path.join(HISTORY_DIR, f), label, ext: path.extname(f).slice(1) };
      });
  }

  _pruneHistory(maxCount) {
    if (!fs.existsSync(HISTORY_DIR)) return;
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.html') && f.startsWith('digest-'))
      .sort();
    while (files.length > maxCount) {
      try { fs.unlinkSync(path.join(HISTORY_DIR, files.shift())); } catch {}
    }
  }

  // ─── Read Tracking ────────────────────────────────────────────────────────────
  _readSet() {
    const arr = this._read(READ_FILE, []);
    if (this._memo.readArr !== arr) {
      this._memo.readArr = arr;
      this._memo.readSet = new Set(arr);
    }
    return this._memo.readSet;
  }

  async getReadIds() { return new Set(this._readSet()); }

  // The same story syndicated by two sources is one story: reading either copy reads both.
  _withDuplicates(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
    const all = this._sources().flatMap(s => this._content(s.id));
    const urls = new Set(all.filter(it => it.url && wanted.has(it.id)).map(it => canonicalUrl(it.url)));
    for (const it of all) if (it.url && urls.has(canonicalUrl(it.url))) wanted.add(it.id);
    return wanted;
  }

  async markRead(ids) {
    const set = new Set(this._readSet());
    for (const id of this._withDuplicates(ids)) set.add(id);
    this._write(READ_FILE, [...set].slice(-READ_CAP), false);
  }

  async markUnread(ids) {
    const set = new Set(this._readSet());
    for (const id of this._withDuplicates(ids)) set.delete(id);
    this._write(READ_FILE, [...set], false);
  }

  async markAllRead(itemIds) { return this.markRead(itemIds); }

  // ─── Source Health ────────────────────────────────────────────────────────────
  async getSourceHealth() { return this._read(HEALTH_FILE, {}); }

  async updateSourceHealth(sourceId, data) {
    const health = this._read(HEALTH_FILE, {});
    this._write(HEALTH_FILE, { ...health, [sourceId]: { ...health[sourceId], ...data } });
  }

  // ─── Backup ───────────────────────────────────────────────────────────────────
  async exportBackup() {
    return JSON.stringify(
      { version: '1.0', exportedAt: new Date().toISOString(), sources: this._sources(), settings: this.getSettingsSync(), saved: this._saved() },
      null, 2
    );
  }

  async importBackup(json) {
    const bundle = JSON.parse(json);
    if (!Array.isArray(bundle.sources) || !bundle.settings || typeof bundle.settings !== 'object') {
      throw new Error('Invalid backup file — missing sources or settings');
    }
    this._write(SOURCES_FILE, bundle.sources);
    this._write(SETTINGS_FILE, bundle.settings);
    if (Array.isArray(bundle.saved)) this._write(SAVED_FILE, bundle.saved, false);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────
  _read(file, fallback) {
    try {
      const st = fs.statSync(file);
      const hit = this._cache.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this._cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
      return data;
    } catch (e) {
      // Unreadable (not just missing): keep a copy so a later save can't destroy a hand-edited file.
      if (e.code !== 'ENOENT' && !this._quarantined.has(file)) {
        this._quarantined.add(file);
        try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
      }
      return fallback;
    }
  }

  // Atomic: write a temp file, then rename over the target.
  _write(file, data, pretty = true) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
    this._cache.delete(file);
  }
}

module.exports = { Storage };
