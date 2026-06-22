'use strict';

// Mirror of AgentPlatform's grokClient.js — universal LLM client via OpenAI SDK
const { OpenAI } = require('openai');

const PROVIDERS = {
  xai: {
    label: 'xAI (Grok)',
    baseURL: 'https://api.x.ai/v1',
    models: ['grok-3', 'grok-3-fast', 'grok-3-mini']
  },
  groq: {
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'gemma2-9b-it', 'deepseek-r1-distill-llama-70b']
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini']
  },
  gemini: {
    label: 'Google (Gemini)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    baseURL: 'https://api.anthropic.com/v1',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
  },
  ollama: {
    label: 'Ollama (Local)',
    baseURL: 'http://localhost:11434/v1',
    models: ['llama3.2', 'llama3.1', 'mistral', 'phi3', 'gemma2', 'qwen2.5']
  }
};

// Providers that run locally / need no API key.
const LOCAL_PROVIDERS = new Set(['ollama', 'custom']);

function getProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p }));
}

// Resolve the endpoint for a config. `custom` always uses the user-supplied
// baseURL. `ollama` honours a user-supplied baseURL too (so it can point at a
// LAN box like http://192.168.1.95:11434/v1), falling back to localhost.
function resolveBaseURL(llmConfig) {
  const { provider, baseURL } = llmConfig;
  const userURL = (baseURL || '').trim();
  if (provider === 'custom') return userURL;
  if (provider === 'ollama') return userURL || PROVIDERS.ollama.baseURL;
  return PROVIDERS[provider]?.baseURL || userURL;
}

// Local models (esp. CPU Ollama) can take minutes to generate a long digest, so
// the request timeout must be generous. Honour an explicit per-config override
// (`timeoutMs`); otherwise fall back to the provided default.
function resolveTimeout(llmConfig, fallbackMs) {
  const t = Number(llmConfig.timeoutMs);
  return Number.isFinite(t) && t > 0 ? t : fallbackMs;
}

// Build an OpenAI-SDK client pointed at the right provider endpoint.
function buildClient(llmConfig) {
  const { provider, apiKey } = llmConfig;
  const effectiveBase = resolveBaseURL(llmConfig);
  if (!effectiveBase) {
    throw new Error('No endpoint URL. Pick a provider, or set a Base URL for the custom provider.');
  }
  return new OpenAI({
    apiKey: apiKey || 'no-key',
    baseURL: effectiveBase,
    // Anthropic's OpenAI-compatible endpoint authenticates via x-api-key.
    defaultHeaders: provider === 'anthropic'
      ? { 'anthropic-version': '2023-06-01', 'x-api-key': apiKey }
      : undefined
  });
}

// Build the chat.completions params, applying provider-specific quirks.
function chatParams(llmConfig, messages, maxTokens, temperature) {
  const params = { model: llmConfig.model, messages, max_tokens: maxTokens, temperature };
  // Gemini 2.5 models spend hidden "thinking" tokens that count against
  // max_tokens — they can starve or truncate the visible answer (e.g. a digest
  // cut off mid-sentence). We don't need reasoning for summarize/echo tasks, so
  // turn it off and give the whole budget to the actual output.
  if (llmConfig.provider === 'gemini') params.reasoning_effort = 'none';
  return params;
}

// Turn raw SDK / network errors into a short, actionable sentence.
function friendlyError(err, provider) {
  const status = err?.status ?? err?.response?.status;
  const code = err?.code || err?.cause?.code;
  const apiMsg = err?.error?.message || err?.response?.data?.error?.message || err?.message;

  const keyHint = provider === 'gemini' ? ' Get one at aistudio.google.com/apikey.'
    : provider === 'openai' ? ' Get one at platform.openai.com/api-keys.'
    : provider === 'anthropic' ? ' Get one at console.anthropic.com.'
    : provider === 'groq' ? ' Get one at console.groq.com/keys.'
    : '';

  if (status === 401 || status === 403) {
    return `Authentication failed (${status}). The API key is missing, wrong, or lacks access.${keyHint}`;
  }
  if (status === 400) {
    // Gemini/OpenAI-compat endpoints return 400 for an invalid key, an
    // unsupported model, or a malformed request — give the message if present.
    if (apiMsg && !/no body/i.test(apiMsg)) return `Request rejected (400): ${apiMsg}`;
    return `Request rejected (400). Usually an invalid API key or a model not supported by this provider.${keyHint}`;
  }
  if (status === 404) {
    return `Not found (404). The model name is probably wrong for this provider${provider === 'custom' ? ', or the Base URL is incorrect' : ''}.`;
  }
  if (status === 429) {
    return 'Rate limited / out of quota (429). Check your plan or billing, then retry.';
  }
  if (status >= 500) {
    return `The provider returned a server error (${status}). Try again shortly.`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Network error: could not resolve the endpoint host. Check your internet connection or Base URL.';
  }
  if (code === 'ECONNREFUSED') {
    return provider === 'ollama'
      ? 'Connection refused. Is Ollama running? Start it with `ollama serve` (default http://localhost:11434).'
      : 'Connection refused at the endpoint. Check the Base URL / that the server is running.';
  }
  if (code === 'ETIMEDOUT') {
    return 'The request timed out. Check your connection and try again.';
  }
  return apiMsg || String(err);
}

// Lightweight auth/connectivity check. Sends a tiny prompt and returns the
// model's reply — used by the "Test Connection" button. Does NOT require the
// LLM to be "enabled" or any content to have been collected.
async function testConnection(llmConfig) {
  const { provider, model } = llmConfig;
  if (!provider) throw new Error('No provider selected.');
  if (!model) throw new Error('No model selected.');
  if (!LOCAL_PROVIDERS.has(provider) && !llmConfig.apiKey) {
    throw new Error('No API key set for this provider. Paste your key and try again.');
  }

  const client = buildClient(llmConfig);
  const started = Date.now();
  try {
    const response = await client.chat.completions.create(
      chatParams(llmConfig, [{ role: 'user', content: 'Reply with exactly: PulseKeeper connection OK' }], 64, 0),
      { timeout: resolveTimeout(llmConfig, 60000) }
    );
    const reply = response.choices?.[0]?.message?.content?.trim() || '(model returned an empty response)';
    return { ok: true, provider, model, reply, latencyMs: Date.now() - started };
  } catch (err) {
    throw new Error(friendlyError(err, provider));
  }
}

async function generateDigest(llmConfig, contentItems) {
  const { provider, digestPrompt } = llmConfig;
  const client = buildClient(llmConfig);

  // Cap how many items go into the prompt. Fewer items = much faster on slow
  // local models (prompt prefill dominates), so this is configurable.
  const n = Number(llmConfig.maxItems);
  const maxItems = Number.isFinite(n) && n > 0 ? n : 50;

  // Format content items for the prompt
  const contentText = contentItems.slice(0, maxItems).map((item, i) =>
    `[${i + 1}] ${item.sourceName || item.sourceType || 'Unknown'} — ${item.title}\n${item.description || ''}\nURL: ${item.url}\nDate: ${item.publishedAt}`
  ).join('\n\n---\n\n');

  let systemPrompt = 'You are a personal content curator. Generate clear, concise digests with relevant highlights and links. Format your response in Markdown.';
  // Severity scoring: ask the model to prefix every highlight with a triage tag
  // so SOC analysts can scan the digest by priority. Tags are colorized when the
  // HTML digest is rendered (see outputRenderer.colorizeSeverity).
  if (llmConfig.severityScoring) {
    systemPrompt += ' For every highlighted item, begin the line with a severity tag in square brackets — exactly one of [CRITICAL], [HIGH], [MEDIUM], or [INFO] — placed before the title. Judge severity by security/operational impact: [CRITICAL] = actively exploited vulnerabilities, zero-days, or major breaches; [HIGH] = important security issues or significant developments; [MEDIUM] = notable but non-urgent items; [INFO] = general news or context.';
  }
  if (llmConfig.aiAttribution) {
    systemPrompt += ' For each highlight, analyze the content and identify any Threat Actors / Groups (e.g. APT29, LockBit) and MITRE ATT&CK Techniques (e.g. T1566 Phishing) involved. List these clearly at the end of each item summary (e.g. "Actors: APT29 | Techniques: T1566").';
  }

  // Running "model memory": fold in what the model learned from prior digests so
  // it builds on context (recurring actors, ongoing stories) and flags what's new.
  const knowledge = (llmConfig.knowledgeContext || '').trim();
  let knowledgeBlock = '';
  if (knowledge) {
    systemPrompt += ' You have a running knowledge base from previous digests (provided below). Use it for context: connect new items to ongoing stories, recurring entities, and prior events, and call out what is genuinely new or changed since then. Do not just repeat the knowledge base.';
    knowledgeBlock = `WHAT YOU ALREADY KNOW (from previous digests):\n${knowledge}\n\n---\n\n`;
  }

  const userPrompt = `${digestPrompt || 'Summarize the following content into a daily digest:'}\n\n${knowledgeBlock}${contentText}`;

  try {
    const response = await client.chat.completions.create(
      chatParams(llmConfig, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], 4000, 0.5),
      { timeout: resolveTimeout(llmConfig, 900000) }
    );
    return response.choices[0]?.message?.content || '';
  } catch (err) {
    throw new Error(friendlyError(err, provider));
  }
}

// Distill an updated knowledge base from the prior memory + the items in this
// digest. This is what makes the model "smarter each digest": it maintains a
// compact, evolving record of recurring entities and ongoing stories that is fed
// back into the next digest. Returns plain text; caps length via knowledgeMaxWords.
async function updateKnowledge(llmConfig, priorKnowledge, contentItems) {
  const { provider } = llmConfig;
  const client = buildClient(llmConfig);

  const n = Number(llmConfig.maxItems);
  const maxItems = Number.isFinite(n) && n > 0 ? n : 50;
  const maxWords = Number(llmConfig.knowledgeMaxWords) > 0 ? Number(llmConfig.knowledgeMaxWords) : 600;

  const contentText = contentItems.slice(0, maxItems).map((item, i) =>
    `[${i + 1}] ${item.sourceName || item.sourceType || 'Unknown'} — ${item.title}\n${item.description || ''}`
  ).join('\n\n');

  const systemPrompt = 'You maintain a compact, evolving knowledge base (a long-term memory) about the topics this user tracks. ' +
    'Given the EXISTING knowledge base and the NEW items, output an UPDATED knowledge base. ' +
    'Merge in new facts; track recurring entities (threat actors, CVEs, vulnerabilities, products, companies, people) and ongoing stories; note status changes and emerging trends; drop stale or one-off trivia. ' +
    `Be dense and factual, organized as short bullet points. Keep it under ${maxWords} words. Output ONLY the updated knowledge base as plain text — no preamble, no commentary.`;

  const userPrompt = `EXISTING KNOWLEDGE BASE:\n${(priorKnowledge || '').trim() || '(empty — this is the first digest)'}\n\n---\n\nNEW ITEMS:\n${contentText}\n\n---\n\nProduce the updated knowledge base now.`;

  try {
    const response = await client.chat.completions.create(
      chatParams(llmConfig, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], 2000, 0.3),
      { timeout: resolveTimeout(llmConfig, 900000) }
    );
    return response.choices[0]?.message?.content?.trim() || (priorKnowledge || '');
  } catch (err) {
    throw new Error(friendlyError(err, provider));
  }
}

module.exports = { generateDigest, updateKnowledge, testConnection, getProviders, PROVIDERS };
