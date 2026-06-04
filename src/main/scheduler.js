'use strict';

const cron = require('node-cron');

class Scheduler {
  constructor(storage, collector) {
    this.storage = storage;
    this.collector = collector;
    this._task = null;
    this._digestTask = null;
    this._listeners = [];
    this._digestListeners = [];
  }

  onTick(fn)       { this._listeners.push(fn); }
  onDigestTick(fn) { this._digestListeners.push(fn); }

  async start() {
    await this._reschedule();
  }

  stop() {
    if (this._task)       { this._task.stop();       this._task = null; }
    if (this._digestTask) { this._digestTask.stop();  this._digestTask = null; }
  }

  async restart() {
    this.stop();
    await this._reschedule();
  }

  async _reschedule() {
    const settings = await this.storage.getSettings();

    // ── Content collection task ────────────────────────────────────────────────
    const intervalMinutes = Math.max(5, settings.refreshInterval || 30);
    this._task = cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
      for (const fn of this._listeners) {
        try { fn('tick'); } catch {}
      }
      await this.collector.collectAll();
    }, { scheduled: true });

    // ── Daily auto-digest task ─────────────────────────────────────────────────
    const ad = settings.autoDigest;
    if (ad?.enabled && ad?.time) {
      const parts = (ad.time || '08:00').split(':');
      const hh = parseInt(parts[0], 10) || 8;
      const mm = parseInt(parts[1], 10) || 0;
      if (!isNaN(hh) && !isNaN(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        this._digestTask = cron.schedule(`${mm} ${hh} * * *`, () => {
          for (const fn of this._digestListeners) {
            try { fn(); } catch {}
          }
        }, { scheduled: true });
      }
    }
  }

  getNextRunMs() {
    const now = new Date();
    return new Date(Math.ceil(now.getTime() / 60000) * 60000).toISOString();
  }
}

module.exports = { Scheduler };
