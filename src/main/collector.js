'use strict';

const { fetchSource } = require('./sources/index');

const CONCURRENCY = 5;      // sources fetched in parallel
const MIN_KEEP = 5;         // newest items per source that survive retention, so a quiet blog never goes empty
const BACKOFF_AFTER = 3;    // consecutive failures before scheduled refreshes start backing off
const MAX_BACKOFF_MIN = 360;

const ts = it => Date.parse(it.publishedAt) || Date.parse(it.fetchedAt) || 0;

/**
 * Merge freshly fetched items into a source's cache.
 * Retention is judged by publish date, not fetch date: otherwise an old item
 * that was pruned would be re-fetched, re-added as "new" and pruned again forever.
 * @returns {{ items: object[], added: number }} newest-first cache and how many incoming items were kept
 */
function mergeItems(existing, incoming, { maxItems = 20, retentionDays = 3, now = Date.now() } = {}) {
  const seen = new Set(existing.map(i => i.id));
  const fresh = incoming.filter(i => !seen.has(i.id) && seen.add(i.id));

  const cutoff = now - retentionDays * 86400000;
  const kept = [...fresh, ...existing]
    .sort((a, b) => ts(b) - ts(a))
    .filter((it, idx) => idx < MIN_KEEP || ts(it) >= cutoff)
    .slice(0, maxItems * 3);

  const keptIds = new Set(kept.map(i => i.id));
  return { items: kept, added: fresh.filter(i => keptIds.has(i.id)).length };
}

class Collector {
  constructor(storage) {
    this.storage = storage;
    this._running = new Set();
    this._sweep = null;
    this._listeners = [];
  }

  onProgress(fn) { this._listeners.push(fn); }

  _emit(event) {
    for (const fn of this._listeners) {
      try { fn(event); } catch {}
    }
  }

  /**
   * Collect from all enabled sources, a few at a time. Concurrent callers (a
   * scheduler tick landing during a manual refresh) share the sweep in flight.
   * @returns {{ succeeded: number, failed: number, errors: object[] }}
   */
  collectAll() {
    this._sweep ||= this._collectAll().finally(() => { this._sweep = null; });
    return this._sweep;
  }

  async _collectAll() {
    // Browser captures are written by the capture server, there is nothing to fetch.
    const sources = (await this.storage.getSources()).filter(s => s.enabled && s.type !== 'web-capture');
    let succeeded = 0, done = 0;
    const errors = [];

    this._emit({ type: 'start', total: sources.length });

    let next = 0;
    const worker = async () => {
      while (next < sources.length) {
        const source = sources[next++];
        try {
          const count = await this._collectOne(source);
          succeeded++;
          this._emit({ type: 'sourceComplete', source, count });
        } catch (e) {
          errors.push({ sourceId: source.id, sourceName: source.name, error: e.message });
          this._emit({ type: 'sourceError', source, error: e.message });
        }
        this._emit({ type: 'progress', done: ++done, total: sources.length, source });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));

    const result = { succeeded, failed: errors.length, errors };
    this._emit({ type: 'complete', ...result });
    return result;
  }

  /** Collect a single source by ID (manual refresh: ignores interval and backoff). */
  async collectOne(sourceId) {
    const source = (await this.storage.getSources()).find(s => s.id === sourceId);
    if (!source) throw new Error(`Source ${sourceId} not found`);
    return this._collectOne(source, true);
  }

  // Scheduled refreshes skip sources that aren't due: per-source interval, then
  // exponential backoff for sources that keep failing (don't hammer a dead feed).
  _due(source, h) {
    if (!h.lastFetchedAt) return true;
    const minsSince = (Date.now() - Date.parse(h.lastFetchedAt)) / 60000;
    if (source.refreshInterval > 0 && minsSince < source.refreshInterval) return false;
    const fails = h.consecutiveFailures || 0;
    if (fails < BACKOFF_AFTER) return true;
    return minsSince >= Math.min(MAX_BACKOFF_MIN, 5 * 2 ** (fails - BACKOFF_AFTER + 1));
  }

  async _collectOne(source, force = false) {
    if (this._running.has(source.id)) return 0;

    const h = (await this.storage.getSourceHealth())[source.id] || {};
    if (!force && !this._due(source, h)) return 0;

    this._running.add(source.id);
    const started = Date.now();
    // Validators are only good for the exact request that produced them.
    const sig = JSON.stringify([source.type, source.config, source.maxItems]);
    const validators = h.fetchState?.sig === sig ? h.fetchState : {};

    try {
      const res = await fetchSource(source, validators);
      let added = 0;
      const patch = {};

      if (!res.notModified) {
        const settings = await this.storage.getSettings();
        const merged = mergeItems(await this.storage.getContent(source.id), res.items || [], {
          maxItems: source.maxItems || 20,
          retentionDays: settings.retentionDays || 3
        });
        await this.storage.saveContent(source.id, merged.items);
        added = merged.added;
        patch.totalCached = merged.items.length;
        patch.fetchState = res.state ? { ...res.state, sig } : null;
      }

      await this.storage.updateSourceHealth(source.id, {
        ...patch,
        lastFetchedAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastDurationMs: Date.now() - started,
        lastNewCount: added,
        consecutiveFailures: 0,
        lastError: null
      });
      return added;
    } catch (e) {
      await this.storage.updateSourceHealth(source.id, {
        lastFetchedAt: new Date().toISOString(),
        lastDurationMs: Date.now() - started,
        consecutiveFailures: (h.consecutiveFailures || 0) + 1,
        lastError: e.message
      });
      throw e;
    } finally {
      this._running.delete(source.id);
    }
  }

  isRunning(sourceId) {
    return sourceId ? this._running.has(sourceId) : this._running.size > 0;
  }
}

module.exports = { Collector, mergeItems };
