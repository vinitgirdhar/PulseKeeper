'use strict';

// Mirror of AgentPlatform's grokClient.js — universal LLM client via OpenAI SDK
const { OpenAI } = require('openai');

const PROVIDERS = {
  xai: {
    label: 'xAI (Grok)',
    baseURL: 'https://api.x.ai/v1',
    models: ['grok-3', 'grok-3-fast', 'grok-3-mini']
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini']
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

// Resolve the endpoint for a config (custom uses the user-supplied baseURL).
function resolveBaseURL(llmConfig) {
  const { provider, baseURL } = llmConfig;
  if (provider === 'custom') return (baseURL || '').trim();
  return PROVIDERS[provider]?.baseURL || (baseURL || '').trim();
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
      chatParams(llmConfig, [{ role: 'user', content: 'Reply with exactly: PulseKeeper connection OK' }], 64, 0)
    );
    const reply = response.choices?.[0]?.message?.content?.trim() || '(model returned an empty response)';
    return { ok: true, provider, model, reply, latencyMs: Date.now() - started };
  } catch (err) {
    throw new Error(friendlyError(err, provider));
  }
}

async function generateDigest(llmConfig, contentItems) {
  const { provider, model, digestPrompt } = llmConfig;
  const client = buildClient(llmConfig);

  // Format content items for the prompt
  const contentText = contentItems.slice(0, 50).map((item, i) =>
    `[${i + 1}] ${item.sourceName || item.sourceType || 'Unknown'} — ${item.title}\n${item.description || ''}\nURL: ${item.url}\nDate: ${item.publishedAt}`
  ).join('\n\n---\n\n');

  const systemPrompt = 'You are a personal content curator. Generate clear, concise digests with relevant highlights and links. Format your response in Markdown.';
  const userPrompt = `${digestPrompt || 'Summarize the following content into a daily digest:'}\n\n${contentText}`;

  try {
    const response = await client.chat.completions.create(
      chatParams(llmConfig, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], 4000, 0.5)
    );
    return response.choices[0]?.message?.content || '';
  } catch (err) {
    throw new Error(friendlyError(err, provider));
  }
}

module.exports = { generateDigest, testConnection, getProviders, PROVIDERS };
