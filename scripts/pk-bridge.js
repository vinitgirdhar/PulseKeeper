#!/usr/bin/env node
'use strict';

/**
 * PulseKeeper Bridge Script — AgentPlatform Integration
 *
 * Used as a Script Agent in AgentPlatform. Reads the latest cached content
 * from the PulseKeeper data directory and outputs it in the requested format
 * so a chained Prompt Agent can generate an AI digest.
 *
 * Usage:
 *   node pk-bridge.js [--format text|markdown|json] [--max N]
 *
 * AgentPlatform agent config:
 *   command:    node
 *   scriptPath: /path/to/PulseKeeper/scripts/pk-bridge.js
 *   args:       ["--format", "markdown", "--max", "30"]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'Documents', 'PulseKeeper');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
};
const format = getArg('--format', 'text');   // text | markdown | json
const maxItems = parseInt(getArg('--max', '30'), 10);

// ─── Load data ────────────────────────────────────────────────────────────────
function loadSources() {
  try { return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')); }
  catch { return []; }
}

function loadContent(sourceId) {
  try { return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `${sourceId}.json`), 'utf8')); }
  catch { return []; }
}

function getAllContent(max) {
  const all = [];
  for (const s of loadSources().filter(s => s.enabled)) {
    all.push(...loadContent(s.id));
  }
  all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return all.slice(0, max);
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const ICONS = { rss:'📡', podcast:'🎙️', youtube:'▶️', twitter:'🐦', spotify:'🎵', reddit:'🔴', newsletter:'📧', blog:'✍️', webpage:'🌐', 'web-capture':'🧩' };

function formatText(items) {
  if (!items.length) return 'No content available. Open PulseKeeper and refresh your sources.';
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const byType = groupByType(items);
  const lines = [`PulseKeeper Digest — ${date}`, `${items.length} items · ${Object.keys(byType).length} source types`, '═'.repeat(60), ''];
  for (const [type, typeItems] of Object.entries(byType)) {
    lines.push(`${ICONS[type] || '📄'} ${type.toUpperCase()} (${typeItems.length})`);
    for (const item of typeItems) {
      lines.push(`  • ${item.title}`);
      if (item.author) lines.push(`    By: ${item.author}`);
      lines.push(`    ${item.url}`);
      if (item.description) lines.push(`    ${item.description.slice(0, 180).replace(/\n/g, ' ')}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function formatMarkdown(items) {
  if (!items.length) return '> No content available. Open PulseKeeper and refresh your sources.';
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const byType = groupByType(items);
  let md = `# PulseKeeper Digest\n\n_${date} · ${items.length} items_\n\n`;
  for (const [type, typeItems] of Object.entries(byType)) {
    md += `## ${ICONS[type] || '📄'} ${type.charAt(0).toUpperCase() + type.slice(1)}\n\n`;
    for (const item of typeItems) {
      md += `### [${item.title}](${item.url})\n`;
      md += `**Source:** ${item.sourceName}`;
      if (item.author) md += ` · **By:** ${item.author}`;
      md += '\n\n';
      if (item.description) md += `${item.description.slice(0, 200)}\n\n`;
    }
  }
  return md;
}

function formatJSON(items) {
  return JSON.stringify({ app: 'PulseKeeper', generatedAt: new Date().toISOString(), count: items.length, items }, null, 2);
}

function groupByType(items) {
  const byType = {};
  for (const item of items) {
    const t = item.sourceType || 'rss';
    if (!byType[t]) byType[t] = [];
    byType[t].push(item);
  }
  return byType;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(DATA_DIR)) {
    process.stderr.write(`PulseKeeper data directory not found: ${DATA_DIR}\nPlease run PulseKeeper first.\n`);
    process.exit(1);
  }
  const items = getAllContent(maxItems);
  switch (format) {
    case 'markdown': process.stdout.write(formatMarkdown(items)); break;
    case 'json':     process.stdout.write(formatJSON(items)); break;
    default:         process.stdout.write(formatText(items)); break;
  }
}

main();
