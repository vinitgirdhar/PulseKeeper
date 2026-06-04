'use strict';

const { fetchSource } = require('./sources/index');

class Collector {
  constructor(storage) {
    this.storage = storage;
    this._running = new Set();
    this._listeners = [];
  }

  onProgress(fn) { this._listeners.push(fn); }

  _emit(event) {
    for (const fn of this._listeners) {
      try { fn(event); } catch {}
    }
  }

  /**
   * Collect from all enabled sources (batches of 3)
   * @returns {{ succeeded: number, failed: number, errors: object[] }}
   */
  async collectAll() {
    const sources = await this.storage.getSources();
    const enabled = sources.filter(s => s.enabled);
    let succeeded = 0, failed = 0;
    const errors = [];

    this._emit({ type: 'start', total: enabled.length });

    for (let i = 0; i < enabled.length; i += 3) {
      const batch = enabled.slice(i, i + 3);
      const results = await Promise.allSettled(batch.map(s => this._collectOne(s)));
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const source = batch[j];
        if (result.status === 'fulfilled') {
          succeeded++;
          this._emit({ type: 'sourceComplete', source, count: result.value });
        } else {
          failed++;
          const errMsg = result.reason?.message || String(result.reason);
          errors.push({ sourceId: source.id, sourceName: source.name, error: errMsg });
          this._emit({ type: 'sourceError', source, error: errMsg });
        }
      }
    }

    this._emit({ type: 'complete', succeeded, failed, errors });
    return { succeeded, failed, errors };
  }

  /**
   * Collect from a single source by ID (bypasses per-source interval check)
   */
  async collectOne(sourceId) {
    const sources = await this.storage.getSources();
    const source = sources.find(s => s.id === sourceId);
    if (!source) throw new Error(`Source ${sourceId} not found`);
    return this._collectOne(source, true); // force = true bypasses interval check
  }

  async _collectOne(source, force = false) {
    if (this._running.has(source.id)) return 0;

    // Per-source refresh interval — skip if not due yet (unless forced via manual refresh)
    if (!force && source.refreshInterval && source.refreshInterval > 0) {
      const health = await this.storage.getSourceHealth();
      const h = health[source.id];
      if (h?.lastFetchedAt) {
        const minsSince = (Date.now() - new Date(h.lastFetchedAt)) / 60000;
        if (minsSince < source.refreshInterval) return 0;
      }
    }

    this._running.add(source.id);

    try {
      let items = await fetchSource(source);

      // Apply mute words filter
      const settings = await this.storage.getSettings();
      const muteWords = (settings.muteWords || [])
        .map(w => w.toLowerCase().trim())
        .filter(Boolean);

      if (muteWords.length && !source.ignoreMute) {
        items = items.filter(item => {
          const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();
          return !muteWords.some(w => text.includes(w));
        });
      }

      // Deduplicate against existing cached items
      const existing = await this.storage.getContent(source.id);
      const existingIds = new Set(existing.map(i => i.id));
      const newItems = items.filter(i => !existingIds.has(i.id));

      // Merge new items at front, then apply retention window, then cap at maxItems * 3
      const retentionMs = (settings.retentionDays || 3) * 86400000;
      const cutoff = Date.now() - retentionMs;
      const merged = [...newItems, ...existing]
        .filter(i => new Date(i.fetchedAt || i.publishedAt || 0).getTime() > cutoff)
        .slice(0, (source.maxItems || 20) * 3);
      await this.storage.saveContent(source.id, merged);

      // Update health
      await this.storage.updateSourceHealth(source.id, {
        lastFetchedAt: new Date().toISOString(),
        lastNewCount: newItems.length,
        totalCached: merged.length,
        lastError: null
      });

      return newItems.length;
    } catch (e) {
      await this.storage.updateSourceHealth(source.id, {
        lastFetchedAt: new Date().toISOString(),
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

module.exports = { Collector };
