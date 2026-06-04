#!/usr/bin/env node
'use strict';

/**
 * PCB Bridge Script — AgentPlatform Integration
 *
 * Called by AgentPlatform as a Script Agent. Reads the latest cached content
 * from the Personal Content Builder data directory and outputs it in the
 * requested format so a chained Prompt Agent can consume it.
 *
 * Usage:
 *   node pcb-bridge.js [--format text|markdown|json] [--max N]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'Documents', 'PersonalContentBuilder');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');

// ─── Parse args ───────────────────────────────────────────────────────────────
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
  try {
    const file = path.join(CONTENT_DIR, `${sourceId}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return []; }
}

function getAllContent(max) {
  const sources = loadSources().filter(s => s.enabled);
  const all = [];
  for (const s of sources) {
    const items = loadContent(s.id);
    all.push(...items);
  }
  all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return all.slice(0, max);
}

// ─── Format output ────────────────────────────────────────────────────────────
function formatText(items) {
  if (!items.length) return 'No content available. Run the Personal Content Builder to collect content.';

  const byType = {};
  for (const item of items) {
    const t = item.sourceType || 'rss';
    if (!byType[t]) byType[t] = [];
    byType[t].push(item);
  }

  const lines = [
    `Personal Content Builder — ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Total: ${items.length} items from ${Object.keys(byType).length} source types`,
    '═'.repeat(60),
    ''
  ];

  for (const [type, typeItems] of Object.entries(byType)) {
    lines.push(`── ${type.toUpperCase()} (${typeItems.length} items) ──`);
    for (const item of typeItems) {
      lines.push(`• ${item.title}`);
      if (item.author) lines.push(`  By: ${item.author}`);
      lines.push(`  Source: ${item.sourceName}`);
      lines.push(`  URL: ${item.url}`);
      if (item.description) lines.push(`  ${item.description.slice(0, 200).replace(/\n/g, ' ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatMarkdown(items) {
  if (!items.length) return '> No content available. Run the Personal Content Builder to collect content.';

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const byType = {};
  for (const item of items) {
    const t = item.sourceType || 'rss';
    if (!byType[t]) byType[t] = [];
    byType[t].push(item);
  }

  let md = `# Personal Content Digest\n\n_${date} · ${items.length} items_\n\n`;

  for (const [type, typeItems] of Object.entries(byType)) {
    md += `## ${type.charAt(0).toUpperCase() + type.slice(1)}\n\n`;
    for (const item of typeItems) {
      md += `### [${item.title}](${item.url})\n`;
      md += `**Source:** ${item.sourceName}`;
      if (item.author) md += ` · **By:** ${item.author}`;
      md += `\n\n`;
      if (item.description) md += `${item.description.slice(0, 200)}\n\n`;
    }
  }

  return md;
}

function formatJSON(items) {
  return JSON.stringify({ generatedAt: new Date().toISOString(), count: items.length, items }, null, 2);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error('Personal Content Builder data directory not found.');
    console.error(`Expected: ${DATA_DIR}`);
    console.error('Please run the Personal Content Builder app first.');
    process.exit(1);
  }

  const items = getAllContent(maxItems);

  switch (format) {
    case 'markdown': process.stdout.write(formatMarkdown(items)); break;
    case 'json': process.stdout.write(formatJSON(items)); break;
    default: process.stdout.write(formatText(items)); break;
  }
}

main();
