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
const AIDIGEST_FILE = path.join(DATA_DIR, 'ai-digest.json');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.json');

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
  seededSourceIds: [],
  llm: {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: '',
    baseURL: '',
    timeoutMs: 900000,     // 15 min — slow local CPU models need lots of headroom
    maxItems: 50,          // how many items to summarize; lower = much faster locally
    generateDigest: true,
    digestPrompt: 'Summarize the following content items into a concise daily digest with key highlights and insights:',
    severityScoring: false,  // tag each highlight [CRITICAL]/[HIGH]/[MEDIUM]/[INFO]
    aiAttribution: false,    // extract Threat Actors and MITRE ATT&CK techniques
    categoryDigests: false,  // group items by source category, one section + prompt each
    categories: [],          // [{ name, prompt }] — per-category digest framing
    knowledgeEnabled: false, // accumulate a running knowledge base across digests
    knowledgeMaxWords: 600   // cap the memory size so prompts stay bounded
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
  },
  webhooks: {
    enabled: false,
    url: ''
  },
  security: {
    iocExtraction: true,  // parse IPs/domains/hashes/CVEs from items + tag severity
    defangIoCs: true,      // normalize hxxp/[.] etc. before extracting (currently always on)
    alertWords: ['zero-day', 'ransomware', 'exploit', 'apt']
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
  },

  // ── Cybersecurity ──
  {
    id: uuidv4(),
    name: 'Microsoft Security Update Guide',
    seedId: 'cyber-msrc',
    type: 'rss',
    enabled: true,
    config: { url: 'https://api.msrc.microsoft.com/update-guide/rss' },
    maxItems: 20,
    icon: 'rss'
  },
  {
    id: uuidv4(),
    name: 'The Hacker News',
    seedId: 'cyber-thn',
    type: 'rss',
    enabled: true,
    config: { url: 'https://feeds.feedburner.com/TheHackersNews' },
    maxItems: 12,
    icon: 'rss'
  },
  {
    id: uuidv4(),
    name: 'BleepingComputer',
    seedId: 'cyber-bleeping',
    type: 'rss',
    enabled: true,
    config: { url: 'https://www.bleepingcomputer.com/feed/' },
    maxItems: 12,
    icon: 'rss'
  },
  {
    id: uuidv4(),
    name: 'Krebs on Security',
    seedId: 'cyber-krebs',
    type: 'blog',
    enabled: true,
    config: { url: 'https://krebsonsecurity.com/feed/' },
    maxItems: 10,
    icon: 'blog'
  },
  {
    id: uuidv4(),
    name: 'Dark Reading',
    seedId: 'cyber-darkreading',
    type: 'rss',
    enabled: true,
    config: { url: 'https://www.darkreading.com/rss.xml' },
    maxItems: 12,
    icon: 'rss'
  },
  {
    id: uuidv4(),
    name: 'The Record',
    seedId: 'cyber-therecord',
    type: 'rss',
    enabled: true,
    config: { url: 'https://therecord.media/feed' },
    maxItems: 10,
    icon: 'rss'
  },
  {
    id: uuidv4(),
    name: 'r/cybersecurity',
    seedId: 'cyber-r-cybersecurity',
    type: 'reddit',
    enabled: true,
    config: { subreddit: 'cybersecurity', sort: 'hot' },
    maxItems: 10,
    icon: 'reddit'
  },
  {
    id: uuidv4(),
    name: 'r/netsec',
    seedId: 'cyber-r-netsec',
    type: 'reddit',
    enabled: true,
    config: { subreddit: 'netsec', sort: 'hot' },
    maxItems: 10,
    icon: 'reddit'
  },

  // ── Sequretek ──
  {
    id: uuidv4(),
    name: 'Sequretek Blog',
    seedId: 'sequretek-blog',
    type: 'blog',
    enabled: true,
    config: { url: 'https://www.sequretek.com/feed/' },
    maxItems: 10,
    icon: 'blog'
  },
  {
    id: uuidv4(),
    name: 'MITRE CAR — Detection Analytics',
    seedId: 'sequretek-gh-mitre-car',
    type: 'github',
    enabled: true,
    config: { repoUrl: 'https://github.com/mitre-attack/car', feedType: 'commits' },
    maxItems: 15,
    icon: 'github'
  },
  {
    id: uuidv4(),
    name: 'Open-Source Threat Intel Feeds',
    seedId: 'sequretek-gh-osint-feeds',
    type: 'github',
    enabled: true,
    config: { repoUrl: 'https://github.com/Bert-JanP/Open-Source-Threat-Intel-Feeds', feedType: 'commits' },
    maxItems: 15,
    icon: 'github'
  },

  // ── AI News ──
  {
    id: uuidv4(),
    name: 'OpenAI News',
    seedId: 'ai-openai',
    type: 'blog',
    enabled: true,
    config: { url: 'https://openai.com/news/rss.xml' },
    maxItems: 10,
    icon: 'blog'
  },
  {
    id: uuidv4(),
    name: 'Google DeepMind Blog',
    seedId: 'ai-deepmind',
    type: 'blog',
    enabled: true,
    config: { url: 'https://deepmind.google/blog/rss.xml' },
    maxItems: 10,
    icon: 'blog'
  },
  {
    id: uuidv4(),
    name: 'Hugging Face Blog',
    seedId: 'ai-huggingface',
    type: 'blog',
    enabled: true,
    config: { url: 'https://huggingface.co/blog/feed.xml' },
    maxItems: 10,
    icon: 'blog'
  },
  {
    id: uuidv4(),
    name: 'VentureBeat AI',
    seedId: 'ai-venturebeat',
    type: 'rss',
    enabled: true,
    config: { url: 'https://venturebeat.com/category/ai/feed/' },
    maxItems: 12,
    icon: 'rss'
  },
  {
    id: uuidv4(),
    name: 'MIT Tech Review — AI',
    seedId: 'ai-mit-techreview',
    type: 'rss',
    enabled: true,
    config: { url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
    maxItems: 10,
    icon: 'rss'
  },
  {
    id: uuidv4(),
    name: 'r/artificial',
    seedId: 'ai-r-artificial',
    type: 'reddit',
    enabled: true,
    config: { subreddit: 'artificial', sort: 'hot' },
    maxItems: 10,
    icon: 'reddit'
  },

  // ── Dark Web (Telegram) ──
  {
    id: uuidv4(),
    name: 'COMBO AI',
    seedId: 'darkweb-tg-combo445544',
    type: 'telegram',
    enabled: true,
    category: 'Dark Web',
    // Supergroup (per source details). The public t.me/s/ preview only works for
    // public channels — to actually read this group, edit the source and switch
    // Access Method to "bot", then paste a Bot Token (the bot must be a member).
    config: { accessMethod: 'public', channelName: 'Combo445544' },
    maxItems: 20,
    icon: 'telegram'
  },

  // ── Threat Intelligence (IoC / CVE feeds, no API key) ──
  {
    id: uuidv4(),
    name: 'CISA Known Exploited Vulns',
    seedId: 'ti-cisa-kev',
    type: 'cisaKev',
    enabled: true,
    category: 'Threat Intel',
    config: {},
    maxItems: 25,
    icon: 'shield'
  },
  {
    id: uuidv4(),
    name: 'NVD CVEs (High & Critical)',
    seedId: 'ti-nvd-cve',
    type: 'cve',
    enabled: false, // off by default — NVD is rate-limited; enable when needed
    category: 'Threat Intel',
    config: { minCvss: '7.0', results: '25' },
    maxItems: 25,
    icon: 'shield'
  },
  {
    id: uuidv4(),
    name: 'Abuse.ch URLhaus (Malware URLs)',
    seedId: 'ti-abusech-urlhaus',
    type: 'abusech',
    enabled: true,
    category: 'Threat Intel',
    config: { feed: 'urlhaus' },
    maxItems: 30,
    icon: 'shield'
  },
  {
    id: uuidv4(),
    name: 'Abuse.ch Feodo (Botnet C2s)',
    seedId: 'ti-abusech-feodo',
    type: 'abusech',
    enabled: false,
    category: 'Threat Intel',
    config: { feed: 'feodo' },
    maxItems: 30,
    icon: 'shield'
  },
  {
    id: uuidv4(),
    name: 'Exploit-DB',
    seedId: 'ti-exploit-db',
    type: 'rss',
    enabled: false,
    category: 'Threat Intel',
    config: { url: 'https://www.exploit-db.com/rss.xml' },
    maxItems: 15,
    icon: 'shield'
  },
  {
    id: uuidv4(),
    name: 'Google Project Zero',
    seedId: 'ti-project-zero',
    type: 'blog',
    enabled: true,
    category: 'Threat Intel',
    config: { url: 'https://googleprojectzero.blogspot.com/feeds/posts/default' },
    maxItems: 10,
    icon: 'shield'
  },
  {
    id: uuidv4(),
    name: 'SANS Internet Storm Center',
    seedId: 'ti-sans-isc',
    type: 'rss',
    enabled: true,
    category: 'Threat Intel',
    config: { url: 'https://isc.sans.edu/rssfeed_full.xml' },
    maxItems: 12,
    icon: 'shield'
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
    await this._seedCuratedSources();
  }

  // Add curated default sources (cybersecurity / Sequretek / AI) to existing
  // installs exactly once. Sources carry a stable `seedId`; once a seedId has
  // been seeded it's never re-added, so deleting one won't bring it back.
  async _seedCuratedSources() {
    const curated = DEFAULT_SOURCES.filter(s => s.seedId);
    if (!curated.length) return;
    const settings = await this.getSettings();
    const seeded = new Set(settings.seededSourceIds || []);
    const sources = await this.getSources();
    const present = new Set(sources.filter(s => s.seedId).map(s => s.seedId));
    let changed = false;
    for (const def of curated) {
      if (present.has(def.seedId)) {           // already in sources.json (fresh install)
        if (!seeded.has(def.seedId)) { seeded.add(def.seedId); changed = true; }
        continue;
      }
      if (seeded.has(def.seedId)) continue;    // seeded before, user removed it — leave it gone
      sources.push({ ...def, id: uuidv4() });
      seeded.add(def.seedId);
      changed = true;
    }
    if (changed) {
      await this.saveSources(sources);
      settings.seededSourceIds = [...seeded];
      await this.saveSettings(settings);
    }
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

  // ─── Cached AI Digest ─────────────────────────────────────────────────────────
  // The AI summary is expensive (a slow local model can take minutes), so it's
  // generated on a schedule and cached here. Opening the digest reads this cache
  // instead of re-calling the model every time.
  async getAIDigest() {
    try { return JSON.parse(fs.readFileSync(AIDIGEST_FILE, 'utf8')); }
    catch { return null; }
  }

  async saveAIDigest(data) {
    await this._write(AIDIGEST_FILE, { generatedAt: new Date().toISOString(), ...data });
  }

  // ─── Knowledge base (running "model memory" accumulated across digests) ────────
  async getKnowledge() {
    try { return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8')); }
    catch { return { text: '', digestCount: 0, updatedAt: null }; }
  }

  async saveKnowledge({ text, itemCount = 0 }) {
    const prev = await this.getKnowledge();
    await this._write(KNOWLEDGE_FILE, {
      text: text || '',
      digestCount: (prev.digestCount || 0) + 1,
      lastItemCount: itemCount,
      updatedAt: new Date().toISOString()
    });
  }

  async clearKnowledge() {
    await this._write(KNOWLEDGE_FILE, { text: '', digestCount: 0, updatedAt: null });
  }

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
