'use strict';

// Universal LLM client. Cloud providers (and custom endpoints) speak the OpenAI
// chat-completions dialect, driven through the OpenAI SDK. Ollama is driven
// through its native /api/chat instead, because the OpenAI-compatible endpoint
// can't set the context window and Ollama silently truncates long prompts.
const { OpenAI } = require('openai');

// `models` is only the offline fallback — listModels() asks the provider.
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
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']
  },
  ollama: {
    label: 'Ollama (Local)',
    baseURL: 'http://localhost:11434/v1',
    models: ['llama3.2', 'llama3.1', 'mistral', 'phi3', 'gemma2', 'qwen2.5']
  }
};

// Providers that run locally / need no API key.
const LOCAL_PROVIDERS = new Set(['ollama', 'custom']);

const CLOUD_CONTEXT_TOKENS = 24000;   // prompt budget for hosted models
const DEFAULT_NUM_CTX = 8192;         // prompt+output window assumed for local models
const DIGEST_MAX_TOKENS = 4000;

const estimateTokens = text => Math.ceil(text.length / 3.5);

function getProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p }));
}

// The key for the active provider: the explicit one, or the per-provider map
// the settings screen keeps so switching providers doesn't lose keys.
function resolveApiKey(cfg) {
  return String(cfg.apiKey || cfg.apiKeys?.[cfg.provider] || '').trim();
}

// Cloud providers need an API key; local ones (Ollama, custom endpoint) don't.
function isConfigured(cfg) {
  return !!cfg?.enabled && (LOCAL_PROVIDERS.has(cfg.provider) || !!resolveApiKey(cfg));
}

// Resolve the endpoint for a config. `custom` always uses the user-supplied
// baseURL. `ollama` honours a user-supplied baseURL too (so it can point at a
// LAN box like http://192.168.1.95:11434/v1), falling back to localhost.
function resolveBaseURL(cfg) {
  const userURL = (cfg.baseURL || '').trim();
  if (cfg.provider === 'custom') return userURL;
  if (cfg.provider === 'ollama') return userURL || PROVIDERS.ollama.baseURL;
  return PROVIDERS[cfg.provider]?.baseURL || userURL;
}

// Ollama's native API lives at the server root, not under /v1.
const ollamaRoot = cfg => resolveBaseURL(cfg).replace(/\/+$/, '').replace(/\/v1$/, '');

function numCtx(cfg) {
  const n = Math.floor(Number(cfg.numCtx));
  return n >= 2048 ? n : DEFAULT_NUM_CTX;
}

// Local models (esp. CPU Ollama) can take minutes before the first token, so the
// timeout must be generous. Honour an explicit per-config override (`timeoutMs`).
function resolveTimeout(cfg, fallbackMs) {
  const t = Number(cfg.timeoutMs);
  return Number.isFinite(t) && t > 0 ? t : fallbackMs;
}

function buildClient(cfg, timeoutMs) {
  const baseURL = resolveBaseURL(cfg);
  if (!baseURL) throw new Error('No endpoint URL. Pick a provider, or set a Base URL for the custom provider.');
  const apiKey = resolveApiKey(cfg);
  return new OpenAI({
    apiKey: apiKey || 'no-key',
    baseURL,
    timeout: timeoutMs,
    // A retry after a 15-minute local timeout would triple the wait for nothing.
    maxRetries: LOCAL_PROVIDERS.has(cfg.provider) ? 0 : 2,
    // Anthropic's OpenAI-compatible endpoint authenticates via x-api-key.
    defaultHeaders: cfg.provider === 'anthropic' ? { 'anthropic-version': '2023-06-01', 'x-api-key': apiKey } : undefined
  });
}

// chat.completions params with provider-specific quirks applied.
function chatParams(cfg, messages, maxTokens, temperature) {
  const params = { model: cfg.model, messages, stream: true };
  // OpenAI reasoning models reject max_tokens/temperature and spend hidden
  // reasoning tokens from the same budget.
  if (cfg.provider === 'openai' && /^(o\d|gpt-5)/i.test(cfg.model)) {
    params.max_completion_tokens = maxTokens * 4;
  } else {
    params.max_tokens = maxTokens;
    params.temperature = temperature;
  }
  // Gemini 2.5 spends hidden "thinking" tokens that count against max_tokens and
  // can truncate the visible answer. Flash can turn thinking off; Pro cannot.
  if (cfg.provider === 'gemini') params.reasoning_effort = /pro/i.test(cfg.model) ? 'low' : 'none';
  return params;
}

// Cancels a request that has gone silent. Unlike a plain request timeout it
// restarts on every streamed chunk, so a long generation is never cut off while
// a stalled one still is.
function idleWatchdog(ms, controller) {
  let timer;
  const wd = {
    fired: false,
    kick() {
      clearTimeout(timer);
      timer = setTimeout(() => { wd.fired = true; controller.abort(); }, ms);
    },
    stop() { clearTimeout(timer); }
  };
  wd.kick();
  return wd;
}

async function openaiChat(cfg, messages, { maxTokens, temperature, timeoutMs, onProgress }) {
  const controller = new AbortController();
  const wd = idleWatchdog(timeoutMs, controller);
  try {
    const stream = await buildClient(cfg, timeoutMs).chat.completions.create(
      chatParams(cfg, messages, maxTokens, temperature), { signal: controller.signal });
    let text = '';
    for await (const chunk of stream) {
      wd.kick();
      const piece = chunk.choices?.[0]?.delta?.content;
      if (piece) { text += piece; onProgress?.(text.length, text); }
    }
    return text;
  } catch (err) {
    throw wd.fired ? idleError(timeoutMs) : err;
  } finally {
    wd.stop();
  }
}

async function ollamaChat(cfg, messages, { maxTokens, temperature, timeoutMs, onProgress }) {
  const controller = new AbortController();
  const wd = idleWatchdog(timeoutMs, controller);
  try {
    const res = await fetch(`${ollamaRoot(cfg)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model, messages, stream: true,
        think: false, // summarising doesn't need chain-of-thought, and it eats num_predict
        options: { num_ctx: numCtx(cfg), num_predict: maxTokens, temperature }
      })
    });
    if (!res.ok) {
      const detail = await res.json().then(j => j.error, () => null);
      throw Object.assign(new Error(detail || `HTTP ${res.status}`), { status: res.status, modelMissing: /not found/i.test(detail || '') });
    }

    // NDJSON: one JSON object per line.
    const decoder = new TextDecoder();
    let text = '', buffer = '';
    for await (const chunk of res.body) {
      wd.kick();
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.error) throw new Error(msg.error);
        if (msg.message?.content) { text += msg.message.content; onProgress?.(text.length, text); }
      }
    }
    return text;
  } catch (err) {
    throw wd.fired ? idleError(timeoutMs) : err;
  } finally {
    wd.stop();
  }
}

const idleError = ms => Object.assign(new Error(
  `The model sent nothing for ${Math.round(ms / 1000)}s, so the request was cancelled. Raise "Request timeout" in AI / LLM settings — slow CPU models can need minutes before the first token.`
), { friendly: true });

// Reasoning models inline their chain of thought as <think>…</think>.
const stripThinking = text => text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').replace(/<think>[\s\S]*$/i, '').trim();

// Stream a chat completion and return the cleaned text. `onProgress(chars, textSoFar)` sees cleaned text.
async function chat(cfg, messages, { onProgress, ...rest }) {
  const opts = { ...rest, onProgress: onProgress && ((n, t) => onProgress(n, stripThinking(t))) };
  let text;
  if (cfg.provider === 'ollama') {
    try { text = await ollamaChat(cfg, messages, opts); }
    catch (err) {
      // Not an Ollama server (404 on /api/chat)? Fall back to the OpenAI-compatible route.
      if (err.status !== 404 || err.modelMissing) throw err;
    }
  }
  text ??= await openaiChat(cfg, messages, opts);

  text = stripThinking(text);
  if (!text) throw Object.assign(new Error('The model returned an empty response. Try another model, or raise the context window if the prompt was cut off.'), { friendly: true });
  return text;
}

// Turn raw SDK / network errors into a short, actionable sentence.
function friendlyError(err, cfg) {
  if (err.friendly) return err.message;
  const { provider, model } = cfg;
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
  if (status === 400 || status === 413) {
    // Gemini/OpenAI-compat endpoints return 400 for an invalid key, an
    // unsupported model, an oversized prompt or a malformed request.
    if (apiMsg && !/no body/i.test(apiMsg)) return `Request rejected (${status}): ${apiMsg}`;
    return `Request rejected (${status}). Usually an invalid API key, a model not supported by this provider, or a prompt over the model's limit.${keyHint}`;
  }
  if (status === 404) {
    if (provider === 'ollama') return `Model "${model}" isn't installed on this Ollama server. Run \`ollama pull ${model}\`, or pick an installed model.`;
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

function assertUsable(cfg) {
  if (!cfg.provider) throw new Error('No provider selected.');
  if (!cfg.model) throw new Error('No model selected.');
  if (!LOCAL_PROVIDERS.has(cfg.provider) && !resolveApiKey(cfg)) {
    throw new Error('No API key set for this provider. Paste your key and try again.');
  }
}

// Lightweight auth/connectivity check — used by the "Test Connection" button.
// Goes through the same code path as a real digest, but does NOT require the
// LLM to be "enabled" or any content to have been collected.
async function testConnection(cfg) {
  assertUsable(cfg);
  const started = Date.now();
  try {
    const reply = await chat(cfg, [{ role: 'user', content: 'Reply with exactly: PulseKeeper connection OK' }],
      { maxTokens: 64, temperature: 0, timeoutMs: resolveTimeout(cfg, 60000) });
    return { ok: true, provider: cfg.provider, model: cfg.model, reply, latencyMs: Date.now() - started };
  } catch (err) {
    throw new Error(friendlyError(err, cfg));
  }
}

/**
 * Model ids the provider actually offers (installed models for Ollama), so the
 * picker never lists a model the account can't call.
 */
async function listModels(cfg) {
  if (!cfg.provider) throw new Error('No provider selected.');
  if (!LOCAL_PROVIDERS.has(cfg.provider) && !resolveApiKey(cfg)) throw new Error('Add an API key to load the model list.');
  try {
    let ids;
    if (cfg.provider === 'ollama') {
      try {
        const res = await fetch(`${ollamaRoot(cfg)}/api/tags`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        ids = (await res.json()).models.map(m => m.name);
      } catch (err) {
        if (err.status !== 404) throw err; // not Ollama's API — try the OpenAI-compatible list
      }
    }
    if (!ids) {
      const page = await buildClient({ ...cfg }, 10000).models.list({ maxRetries: 0 });
      ids = page.data.map(m => m.id.replace(/^models\//, ''));
    }
    const chatOnly = /embed|whisper|tts|dall-e|moderation|guard|imagen|veo|aqa|transcribe|realtime|audio|image/i;
    ids = ids.filter(id => !chatOnly.test(id) && (cfg.provider !== 'openai' || /^(gpt|o\d|chatgpt)/i.test(id)));
    return [...new Set(ids)].sort();
  } catch (err) {
    throw new Error(friendlyError(err, cfg));
  }
}

/**
 * Summarise content items into a Markdown digest.
 * Items are packed newest-first until the model's context budget is full, so a
 * small local model gets a smaller (complete) prompt instead of a silently truncated one.
 * @returns {{ markdown: string, used: number, total: number }}
 */
async function generateDigest(cfg, items, { onProgress } = {}) {
  assertUsable(cfg);
  const local = LOCAL_PROVIDERS.has(cfg.provider);
  const ctx = local ? numCtx(cfg) : CLOUD_CONTEXT_TOKENS;
  const maxTokens = local ? Math.min(DIGEST_MAX_TOKENS, Math.floor(ctx * 0.4)) : DIGEST_MAX_TOKENS;

  // Cap how many items go into the prompt. Fewer items = much faster on slow
  // local models (prompt prefill dominates), so this is configurable.
  const n = Number(cfg.maxItems);
  const maxItems = Number.isFinite(n) && n > 0 ? n : 50;

  const systemPrompt = 'You are a personal content curator. Generate clear, concise digests with relevant highlights and links. Format your response in Markdown.';
  const intro = `${cfg.digestPrompt || 'Summarize the following content into a daily digest:'}\n\n`;
  let budget = ctx - maxTokens - estimateTokens(systemPrompt + intro) - 100;

  const blocks = [];
  for (const [i, item] of items.slice(0, maxItems).entries()) {
    const block = `[${i + 1}] ${item.sourceName || item.sourceType || 'Unknown'} — ${item.title}\n${(item.description || '').slice(0, 400)}\nURL: ${item.url}\nDate: ${item.publishedAt}`;
    const cost = estimateTokens(block) + 8;
    if (blocks.length && cost > budget) break;
    blocks.push(block);
    budget -= cost;
  }

  try {
    const markdown = await chat(cfg, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: intro + blocks.join('\n\n---\n\n') }
    ], { maxTokens, temperature: 0.5, timeoutMs: resolveTimeout(cfg, 900000), onProgress });
    return { markdown, used: blocks.length, total: items.length };
  } catch (err) {
    throw new Error(friendlyError(err, cfg));
  }
}

/**
 * Summarise one story as a few Markdown bullets. `article` is the extracted page
 * text (falls back to the feed's teaser); it is cut to fit the model's context.
 * @returns {{ markdown: string }}
 */
async function summarizeItem(cfg, item, article = '', { onProgress } = {}) {
  assertUsable(cfg);
  const local = LOCAL_PROVIDERS.has(cfg.provider);
  const ctx = local ? numCtx(cfg) : CLOUD_CONTEXT_TOKENS;
  const maxTokens = local ? Math.min(500, Math.floor(ctx * 0.25)) : 500;

  const system = 'You summarise news stories for a busy reader. Reply with 3 to 5 short Markdown bullet points ("- "), most important first, no heading and no preamble. Use only the text provided. If the text is only a short teaser, say so in one bullet instead of guessing.';
  const head = `Title: ${item.title}\nSource: ${item.sourceName || ''}\nPublished: ${item.publishedAt || ''}\n\n`;
  const budgetChars = Math.max(1500, Math.floor((ctx - maxTokens - estimateTokens(system + head) - 100) * 3.5));
  const body = (article || item.description || '').slice(0, budgetChars);

  try {
    const markdown = await chat(cfg, [
      { role: 'system', content: system },
      { role: 'user', content: head + body }
    ], { maxTokens, temperature: 0.3, timeoutMs: resolveTimeout(cfg, 300000), onProgress });
    return { markdown };
  } catch (err) {
    throw new Error(friendlyError(err, cfg));
  }
}

module.exports = { generateDigest, summarizeItem, testConnection, listModels, getProviders, isConfigured, PROVIDERS };
