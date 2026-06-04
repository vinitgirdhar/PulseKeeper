'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR    = path.join(os.homedir(), 'Documents', 'PulseKeeper');
const SOURCES_FILE  = path.join(DATA_DIR, 'sources.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const OUTPUT_DIR  = path.join(DATA_DIR, 'output');
const HISTORY_DIR   = path.join(DATA_DIR, 'history');
const EXTENSION_DIR = path.join(DATA_DIR, 'extension');
const READ_FILE   = path.join(DATA_DIR, 'read.json');
const HEALTH_FILE = path.join(DATA_DIR, 'health.json');

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
    time: '08:00'
  },
  muteWords: [],
  historyMaxCount: 10,
  llm: {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: '',
    generateDigest: true,
    digestPrompt: 'Summarize the following content items into a concise daily digest with key highlights and insights:'
  },
  display: {
    theme: 'dark',
    accentColor: '#0078d4',
    showThumbnails: true,
    groupBySource: false,
    sortBy: 'date',
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

class Storage {
  constructor() {
    this._lock = false;
  }

  async init() {
    for (const dir of [DATA_DIR, CONTENT_DIR, OUTPUT_DIR, HISTORY_DIR, EXTENSION_DIR]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(SETTINGS_FILE)) await this._write(SETTINGS_FILE, DEFAULT_SETTINGS);
    if (!fs.existsSync(SOURCES_FILE))  await this._write(SOURCES_FILE, DEFAULT_SOURCES);
  }

  // ─── Settings ────────────────────────────────────────────────────────────────
  async getSettings() {
    try {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return deepMerge(DEFAULT_SETTINGS, JSON.parse(raw));
    } catch {
      return deepMerge({}, DEFAULT_SETTINGS);
    }
  }

  async saveSettings(settings) {
    await this._write(SETTINGS_FILE, settings);
  }

  // ─── Sources ─────────────────────────────────────────────────────────────────
  async getSources() {
    try {
      const raw = fs.readFileSync(SOURCES_FILE, 'utf8');
      return JSON.parse(raw);
    } catch { return []; }
  }

  async saveSources(sources) {
    await this._write(SOURCES_FILE, sources);
  }

  async addSource(source) {
    const sources = await this.getSources();
    const newSource = { id: uuidv4(), enabled: true, maxItems: 20, ...source };
    sources.push(newSource);
    await this.saveSources(sources);
    return newSource;
  }

  async updateSource(id, updates) {
    const sources = await this.getSources();
    const idx = sources.findIndex(s => s.id === id);
    if (idx === -1) throw new Error(`Source ${id} not found`);
    sources[idx] = { ...sources[idx], ...updates };
    await this.saveSources(sources);
    return sources[idx];
  }

  async deleteSource(id) {
    let sources = await this.getSources();
    sources = sources.filter(s => s.id !== id);
    await this.saveSources(sources);
    const contentFile = path.join(CONTENT_DIR, `${id}.json`);
    if (fs.existsSync(contentFile)) fs.unlinkSync(contentFile);
    // Clean up health entry
    const health = await this.getSourceHealth();
    delete health[id];
    await this._write(HEALTH_FILE, health);
  }

  // ─── Content Cache ────────────────────────────────────────────────────────────
  async getContent(sourceId) {
    const file = path.join(CONTENT_DIR, `${sourceId}.json`);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return []; }
  }

  async saveContent(sourceId, items) {
    await this._write(path.join(CONTENT_DIR, `${sourceId}.json`), items);
  }

  async getAllContent() {
    const sources = await this.getSources();
    const allItems = [];
    for (const source of sources.filter(s => s.enabled)) {
      allItems.push(...(await this.getContent(source.id)));
    }
    allItems.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return allItems;
  }

  // ─── Output ───────────────────────────────────────────────────────────────────
  getOutputPath(format) {
    const ext = format === 'markdown' ? 'md' : format;
    return path.join(OUTPUT_DIR, `digest.${ext}`);
  }

  async saveOutput(format, content) {
    const file = this.getOutputPath(format);
    if (Buffer.isBuffer(content)) fs.writeFileSync(file, content);
    else fs.writeFileSync(file, content, 'utf8');
    // Also save a timestamped copy to history
    await this.saveHistory(format, content);
    return file;
  }

  getDataDir()      { return DATA_DIR; }
  getOutputDir()    { return OUTPUT_DIR; }
  getHistoryDir()   { return HISTORY_DIR; }
  getExtensionDir() { return EXTENSION_DIR; }

  // ─── Digest History ───────────────────────────────────────────────────────────
  async saveHistory(format, content) {
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const ext = format === 'markdown' ? 'md' : format;
    const file = path.join(HISTORY_DIR, `digest-${stamp}.${ext}`);
    if (Buffer.isBuffer(content)) fs.writeFileSync(file, content);
    else fs.writeFileSync(file, content, 'utf8');
    const settings = await this.getSettings();
    await this._pruneHistory(settings.historyMaxCount || 10);
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

  async _pruneHistory(maxCount) {
    if (!fs.existsSync(HISTORY_DIR)) return;
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.html') && f.startsWith('digest-'))
      .sort();
    while (files.length > maxCount) {
      try { fs.unlinkSync(path.join(HISTORY_DIR, files.shift())); } catch {}
    }
  }

  // ─── Read Tracking ────────────────────────────────────────────────────────────
  async getReadIds() {
    try { return new Set(JSON.parse(fs.readFileSync(READ_FILE, 'utf8'))); }
    catch { return new Set(); }
  }

  async markRead(ids) {
    const existing = await this.getReadIds();
    for (const id of (Array.isArray(ids) ? ids : [ids])) existing.add(id);
    await this._write(READ_FILE, [...existing].slice(-10000));
  }

  async markAllRead(itemIds) {
    const existing = await this.getReadIds();
    for (const id of itemIds) existing.add(id);
    await this._write(READ_FILE, [...existing].slice(-10000));
  }

  // ─── Source Health ────────────────────────────────────────────────────────────
  async getSourceHealth() {
    try { return JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')); }
    catch { return {}; }
  }

  async updateSourceHealth(sourceId, data) {
    const health = await this.getSourceHealth();
    health[sourceId] = { ...(health[sourceId] || {}), ...data };
    await this._write(HEALTH_FILE, health);
  }

  // ─── Backup ───────────────────────────────────────────────────────────────────
  async exportBackup() {
    const sources = await this.getSources();
    const settings = await this.getSettings();
    return JSON.stringify(
      { version: '1.0', exportedAt: new Date().toISOString(), sources, settings },
      null, 2
    );
  }

  async importBackup(json) {
    const bundle = JSON.parse(json);
    if (!bundle.sources || !bundle.settings) throw new Error('Invalid backup file — missing sources or settings');
    await this.saveSources(bundle.sources);
    await this.saveSettings(bundle.settings);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────
  async _write(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }
}

module.exports = { Storage };
