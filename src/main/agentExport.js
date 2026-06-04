'use strict';

// Exports PulseKeeper as an AgentPlatform-compatible agent pack
// Compatible with: https://github.com/rod-trent/AgentPlatform

const path = require('path');
const os = require('os');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');

// When packaged, scripts/ is placed as an extraResource outside the asar archive
// so AgentPlatform can invoke it directly with `node`.
const PK_BRIDGE_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts', 'pk-bridge.js')
  : path.join(__dirname, '../../scripts/pk-bridge.js');

function buildCronExpr(intervalMinutes) {
  const mins = Math.max(5, Math.min(1440, intervalMinutes));
  if (mins < 60) return `*/${mins} * * * *`;
  return `0 */${Math.floor(mins / 60)} * * *`;
}

/**
 * Full pack: chained Script Agent (pk-bridge.js) + Prompt Agent (AI digest)
 */
function buildAgentPack(settings) {
  const scriptId = uuidv4();
  const promptId = uuidv4();

  return {
    version: '1.0',
    name: 'PulseKeeper Pack',
    description: 'Collects and AI-summarizes content from your PulseKeeper sources: RSS, YouTube, Reddit, newsletters, blogs, podcasts, web pages, and more.',
    author: 'PulseKeeper',
    agents: [
      {
        id: scriptId,
        name: 'PulseKeeper — Content Collector',
        description: 'Runs pk-bridge.js to collect the latest content from all enabled PulseKeeper sources.',
        type: 'script',
        enabled: true,
        schedule: buildCronExpr(settings?.refreshInterval || 30),
        command: 'node',
        scriptPath: PK_BRIDGE_PATH,
        args: ['--format', 'markdown', '--max', '40'],
        timeoutMs: 60000,
        chainTo: [promptId]
      },
      {
        id: promptId,
        name: 'PulseKeeper — AI Digest',
        description: 'Uses an LLM to generate a concise digest from the collected PulseKeeper content.',
        type: 'prompt',
        enabled: !!(settings?.llm?.apiKey),
        schedule: buildCronExpr(settings?.refreshInterval || 30),
        provider: settings?.llm?.provider || 'anthropic',
        model: settings?.llm?.model || 'claude-sonnet-4-6',
        temperature: 0.5,
        systemPrompt: 'You are a personal content curator for PulseKeeper. Summarize content clearly with key highlights. Format in Markdown with sections per content type. Include links.',
        userPrompt: settings?.llm?.digestPrompt || 'Summarize the following content into a concise daily digest with key highlights and links:'
      }
    ]
  };
}

/**
 * Script-only pack (no LLM required)
 */
function buildScriptOnlyPack(settings) {
  return {
    version: '1.0',
    name: 'PulseKeeper — Collector',
    description: 'Collects the latest content from all enabled PulseKeeper sources.',
    author: 'PulseKeeper',
    agents: [{
      id: uuidv4(),
      name: 'PulseKeeper — Content Collector',
      description: 'Fetches latest content from all enabled PulseKeeper sources via pk-bridge.js.',
      type: 'script',
      enabled: true,
      schedule: buildCronExpr(settings?.refreshInterval || 30),
      command: 'node',
      scriptPath: PK_BRIDGE_PATH,
      args: ['--format', 'markdown', '--max', '50'],
      timeoutMs: 60000
    }]
  };
}

function exportPack(settings, scriptOnly = false) {
  const pack = scriptOnly ? buildScriptOnlyPack(settings) : buildAgentPack(settings);
  return JSON.stringify(pack, null, 2);
}

module.exports = { exportPack, buildAgentPack, buildScriptOnlyPack };
