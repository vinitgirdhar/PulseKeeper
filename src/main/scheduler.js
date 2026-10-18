'use strict';

const cron = require('node-cron');

// "Every N minutes" as a cron expression. Cron fields can't express a step
// larger than their range, so >= 60 minutes becomes "every H hours at :00".
function cronEvery(minutes) {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `*/${m} * * * *`;
  const hours = Math.round(m / 60);
  return hours >= 24 ? '0 0 * * *' : `0 */${hours} * * *`;
}

class Scheduler {
  constructor(storage, collector) {
    this.storage = storage;
    this.collector = collector;
    this._tasks = [];
    this._digestListeners = [];
  }

  onDigestTick(fn) { this._digestListeners.push(fn); }

  async start() {
    await this._reschedule();
  }

  stop() {
    this._tasks.forEach(t => t.stop());
    this._tasks = [];
  }

  async restart() {
    this.stop();
    await this._reschedule();
  }

  async _reschedule() {
    const settings = await this.storage.getSettings();

    // ── Content collection task ────────────────────────────────────────────────
    this._tasks.push(cron.schedule(cronEvery(Math.max(5, settings.refreshInterval || 30)), () => {
      this.collector.collectAll().catch(() => {});
    }));

    // ── Auto-digest task ───────────────────────────────────────────────────────
    // Two modes: 'interval' runs every N hours (spreads the load for slow local
    // models); 'daily' runs once at a fixed time. Default is interval.
    const ad = settings.autoDigest;
    if (!ad?.enabled) return;

    const fire = () => {
      for (const fn of this._digestListeners) {
        try { fn(); } catch {}
      }
    };
    if ((ad.mode || 'interval') === 'interval') {
      const hours = Math.min(24, Math.max(1, parseInt(ad.everyHours, 10) || 8));
      this._tasks.push(cron.schedule(cronEvery(hours * 60), fire));
    } else {
      const [hh, mm] = String(ad.time || '08:00').split(':').map(n => parseInt(n, 10));
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) this._tasks.push(cron.schedule(`${mm} ${hh} * * *`, fire));
    }
  }
}

module.exports = { Scheduler, cronEvery };
