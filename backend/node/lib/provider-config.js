'use strict';

const DEFAULT_OPENAI_MODELS = Object.freeze(['gpt-5.6-terra', 'gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-luna']);

function cleanBaseURL(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error(`Invalid provider base URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Provider base URLs must use HTTP or HTTPS.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function csv(value, fallback) {
  const parsed = String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length ? parsed : Array.isArray(fallback) ? fallback.slice() : [];
}

function bool(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum || parsed);
}

function createProvider(id, label, options) {
  const baseURL = options.baseURL ? cleanBaseURL(options.baseURL) : '';
  return Object.freeze({
    id,
    label,
    baseURL,
    apiKey: String(options.apiKey || '').trim(),
    defaultModel: String(options.defaultModel || '').trim(),
    models: Object.freeze(options.models || []),
    supportsResponsesApi: !!options.supportsResponsesApi,
    supportsChatCompletions: options.supportsChatCompletions !== false,
    configured: !!baseURL && (options.requiresApiKey === false || !!String(options.apiKey || '').trim()),
  });
}

function createProviderRegistry(sourceEnv) {
  const env = sourceEnv || process.env;
  const openai = createProvider('openai', 'OpenAI', {
    baseURL: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.OPENAI_API_KEY,
    defaultModel: env.OPENAI_MODEL || 'gpt-5.6-terra',
    models: csv(env.OPENAI_MODELS, DEFAULT_OPENAI_MODELS),
    supportsResponsesApi: true,
    supportsChatCompletions: true,
  });

  const local = createProvider('local', 'Local OpenAI-compatible', {
    baseURL: env.LOCAL_LLM_BASE_URL,
    apiKey: env.LOCAL_LLM_API_KEY,
    defaultModel: env.LOCAL_LLM_MODEL || 'llama3.1',
    models: csv(env.LOCAL_LLM_MODELS, []),
    supportsResponsesApi: bool(env.LOCAL_LLM_SUPPORTS_RESPONSES),
    supportsChatCompletions: true,
    requiresApiKey: false,
  });

  const custom = createProvider('custom', 'Custom OpenAI-compatible', {
    baseURL: env.CUSTOM_LLM_BASE_URL,
    apiKey: env.CUSTOM_LLM_API_KEY,
    defaultModel: env.CUSTOM_LLM_MODEL,
    models: csv(env.CUSTOM_LLM_MODELS, []),
    supportsResponsesApi: bool(env.CUSTOM_LLM_SUPPORTS_RESPONSES),
    supportsChatCompletions: true,
    requiresApiKey: false,
  });

  return Object.freeze({ openai, local, custom });
}

function createServerConfig(sourceEnv) {
  const env = sourceEnv || process.env;
  return Object.freeze({
    providers: createProviderRegistry(env),
    port: positiveInteger(env.PORT, 3000, 65535),
    host: String(env.HOST || '127.0.0.1'),
    requestTimeoutMs: positiveInteger(env.LIVECALC_AI_TIMEOUT_MS, 120000, 300000),
    maxBodyBytes: positiveInteger(env.LIVECALC_MAX_REQUEST_BYTES, 1024 * 1024, 5 * 1024 * 1024),
    rateLimit: positiveInteger(env.LIVECALC_RATE_LIMIT, 60, 10000),
    rateWindowMs: positiveInteger(env.LIVECALC_RATE_WINDOW_MS, 60000, 3600000),
    allowedOrigins: csv(env.LIVECALC_ALLOWED_ORIGINS, []),
  });
}

function publicProvider(provider) {
  return {
    id: provider.id,
    label: provider.label,
    configured: provider.configured,
    defaultModel: provider.defaultModel,
    configuredModels: provider.models.slice(),
    supportsResponsesApi: provider.supportsResponsesApi,
    supportsChatCompletions: provider.supportsChatCompletions,
  };
}

module.exports = {
  DEFAULT_OPENAI_MODELS,
  cleanBaseURL,
  createProviderRegistry,
  createServerConfig,
  publicProvider,
};
