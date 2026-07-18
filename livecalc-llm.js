(function () {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 45000;
  const GPT_56_REASONING_EFFORTS = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  const TEXT_VERBOSITY_LEVELS = Object.freeze(['low', 'medium', 'high']);
  const GPT_56_MODEL_PRESETS = Object.freeze([
    'gpt-5.6-terra',
    'gpt-5.6',
    'gpt-5.6-sol',
    'gpt-5.6-luna',
  ]);

  const PROVIDERS = Object.freeze({
    openai: {
      id: 'openai',
      label: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      apiStyle: 'openai-compatible',
      requiresApiKey: true,
      // Terra is the balanced interactive default. The gpt-5.6 alias and
      // both other family tiers remain available in the Settings picker.
      defaultModel: 'gpt-5.6-terra',
      supportsStreaming: true,
      supportsTools: true,
      supportsResponsesApi: true,
      supportsChatCompletions: true,
    },
    local: {
      id: 'local',
      label: 'Local OpenAI-Compatible',
      baseURL: 'http://localhost:1234/v1',
      apiStyle: 'openai-compatible',
      requiresApiKey: false,
      defaultModel: 'llama3.1',
      supportsStreaming: true,
      supportsTools: true,
      supportsResponsesApi: false,
      supportsChatCompletions: true,
    },
    custom: {
      id: 'custom',
      label: 'Custom OpenAI-Compatible',
      baseURL: 'http://localhost:1234/v1',
      apiStyle: 'openai-compatible',
      requiresApiKey: false,
      defaultModel: '',
      supportsStreaming: true,
      supportsTools: true,
      supportsResponsesApi: false,
      supportsChatCompletions: true,
    },
  });

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createDefaultLlmSettings() {
    return {
      providerId: 'local',
      streaming: true,
      preferResponsesApi: true,
      // GPT-5.6 defaults to medium when omitted. Keep this explicit so a
      // user's latency/cost choice is not changed by an API default later.
      reasoningEffort: 'medium',
      textVerbosity: 'medium',
      reasoningMode: 'standard',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      providers: {
        openai: {
          baseURL: PROVIDERS.openai.baseURL,
          model: PROVIDERS.openai.defaultModel,
          apiKey: '',
          requiresApiKey: true,
        },
        local: {
          baseURL: PROVIDERS.local.baseURL,
          model: PROVIDERS.local.defaultModel,
          apiKey: '',
          requiresApiKey: false,
        },
        custom: {
          baseURL: PROVIDERS.custom.baseURL,
          model: '',
          apiKey: '',
          requiresApiKey: false,
        },
      },
    };
  }

  function isLocalhostHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  }

  function sanitizeBaseURL(input, fallback) {
    const raw = String(input || '').trim() || String(fallback || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      u.hash = '';
      u.search = '';
      return u.toString().replace(/\/+$/, '');
    } catch (e) {
      return String(fallback || '')
        .trim()
        .replace(/\/+$/, '');
    }
  }

  function deriveLegacyBaseURL(endpoint) {
    const raw = String(endpoint || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      const path = u.pathname.replace(/\/+$/, '');
      let nextPath = path;
      if (/\/v1\/chat\/completions$/i.test(path)) {
        nextPath = path.replace(/\/chat\/completions$/i, '');
      } else if (/\/v1\/responses$/i.test(path)) {
        nextPath = path.replace(/\/responses$/i, '');
      } else if (/\/api\/chat$/i.test(path)) {
        nextPath = '/v1';
      }
      return (u.origin + nextPath).replace(/\/+$/, '');
    } catch (e) {
      return raw.replace(/\/(chat\/completions|responses)$/i, '').replace(/\/+$/, '');
    }
  }

  function inferProviderFromBaseURL(baseURL) {
    try {
      const u = new URL(baseURL);
      if (u.hostname === 'api.openai.com') return 'openai';
      if (isLocalhostHost(u.hostname)) return 'local';
    } catch (e) {}
    return 'custom';
  }

  function normalizeLlmSettings(rawLlm) {
    const defaults = createDefaultLlmSettings();
    const raw = rawLlm && typeof rawLlm === 'object' ? rawLlm : {};

    const legacyEndpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
    const legacyModel = typeof raw.model === 'string' ? raw.model.trim() : '';
    const legacyApiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    const migratedBaseURL = legacyEndpoint ? deriveLegacyBaseURL(legacyEndpoint) : '';
    const migratedProvider = legacyEndpoint ? inferProviderFromBaseURL(migratedBaseURL) : null;

    const result = {
      providerId: raw.providerId && defaults.providers[raw.providerId] ? raw.providerId : defaults.providerId,
      streaming: raw.streaming !== undefined ? !!raw.streaming : defaults.streaming,
      preferResponsesApi: raw.preferResponsesApi !== undefined ? !!raw.preferResponsesApi : defaults.preferResponsesApi,
      reasoningEffort: GPT_56_REASONING_EFFORTS.includes(raw.reasoningEffort)
        ? raw.reasoningEffort
        : defaults.reasoningEffort,
      textVerbosity: TEXT_VERBOSITY_LEVELS.includes(raw.textVerbosity) ? raw.textVerbosity : defaults.textVerbosity,
      reasoningMode: raw.reasoningMode === 'pro' ? 'pro' : 'standard',
      timeoutMs:
        typeof raw.timeoutMs === 'number' && isFinite(raw.timeoutMs)
          ? Math.max(5000, Math.min(180000, Math.round(raw.timeoutMs)))
          : defaults.timeoutMs,
      providers: deepClone(defaults.providers),
    };

    if (raw.providers && typeof raw.providers === 'object') {
      Object.keys(defaults.providers).forEach((providerId) => {
        const incoming = raw.providers[providerId];
        if (!incoming || typeof incoming !== 'object') return;
        result.providers[providerId] = {
          baseURL: sanitizeBaseURL(incoming.baseURL, defaults.providers[providerId].baseURL),
          model: typeof incoming.model === 'string' ? incoming.model.trim() : defaults.providers[providerId].model,
          apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey.trim() : defaults.providers[providerId].apiKey,
          requiresApiKey:
            providerId === 'custom' ? !!incoming.requiresApiKey : !!defaults.providers[providerId].requiresApiKey,
        };
      });
    }

    if (legacyEndpoint) {
      const providerId = migratedProvider || result.providerId;
      const target = result.providers[providerId] || result.providers.custom;
      target.baseURL = sanitizeBaseURL(migratedBaseURL, target.baseURL);
      if (legacyModel) target.model = legacyModel;
      if (legacyApiKey) target.apiKey = legacyApiKey;
      result.providerId = providerId;
    }

    Object.keys(defaults.providers).forEach((providerId) => {
      const p = result.providers[providerId];
      p.baseURL = sanitizeBaseURL(p.baseURL, defaults.providers[providerId].baseURL);
      if (typeof p.model !== 'string') p.model = defaults.providers[providerId].model;
      if (typeof p.apiKey !== 'string') p.apiKey = '';
      if (providerId !== 'custom') p.requiresApiKey = !!defaults.providers[providerId].requiresApiKey;
    });

    if (!result.providers[result.providerId]) result.providerId = defaults.providerId;

    return result;
  }

  function getProviderCatalog() {
    return Object.keys(PROVIDERS).map((id) => {
      return Object.assign({}, PROVIDERS[id]);
    });
  }

  function getOpenAIModelPresets() {
    return GPT_56_MODEL_PRESETS.slice();
  }

  function isGpt56Model(model) {
    return /^gpt-5\.6(?:$|[-.])/i.test(String(model || '').trim());
  }

  function normalizeMessageContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part) return '';
          if (typeof part === 'string') return part;
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (content && typeof content.text === 'string') return content.text;
    return '';
  }

  function toChatMessages(messages) {
    return (messages || []).map((msg) => {
      const role = typeof msg.role === 'string' ? msg.role : 'user';
      return {
        role,
        content: normalizeMessageContent(msg.content),
      };
    });
  }

  function toResponsesInputMessages(messages) {
    return (messages || [])
      .filter((msg) => msg && msg.role !== 'system')
      .map((msg) => {
        const role = msg.role === 'assistant' ? 'assistant' : msg.role === 'tool' ? 'assistant' : 'user';
        const text = normalizeMessageContent(msg.content);
        return {
          role,
          content: [{ type: 'input_text', text }],
        };
      });
  }

  function getSystemInstruction(messages) {
    const parts = [];
    (messages || []).forEach((msg) => {
      if (msg && msg.role === 'system') {
        const text = normalizeMessageContent(msg.content);
        if (text) parts.push(text);
      }
    });
    return parts.join('\n\n').trim();
  }

  function buildUrl(baseURL, path) {
    return String(baseURL || '').replace(/\/+$/, '') + path;
  }

  function maybeNumber(value) {
    return typeof value === 'number' && isFinite(value) ? value : undefined;
  }

  function extractTextFromNode(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) {
      return node
        .map((x) => extractTextFromNode(x))
        .filter(Boolean)
        .join('');
    }
    if (typeof node.text === 'string') return node.text;
    if (typeof node.content === 'string') return node.content;
    if (Array.isArray(node.content)) return extractTextFromNode(node.content);
    if (node.delta !== undefined) return extractTextFromNode(node.delta);
    return '';
  }

  function extractToolCalls(raw) {
    const out = [];
    if (!raw || typeof raw !== 'object') return out;
    if (raw.choices && raw.choices[0] && raw.choices[0].message && Array.isArray(raw.choices[0].message.tool_calls)) {
      out.push(...raw.choices[0].message.tool_calls);
    }
    if (Array.isArray(raw.output)) {
      raw.output.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        if (entry.type && /tool/i.test(entry.type)) out.push(entry);
      });
    }
    return out;
  }

  function extractTextFromCompatiblePayload(raw) {
    if (!raw) return '';

    if (typeof raw.output_text === 'string' && raw.output_text.trim()) {
      return raw.output_text;
    }

    if (Array.isArray(raw.output_text)) {
      const text = raw.output_text.map((x) => extractTextFromNode(x)).join('');
      if (text.trim()) return text;
    }

    if (Array.isArray(raw.output)) {
      let text = '';
      raw.output.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        if (typeof item.content === 'string') {
          text += item.content;
          return;
        }
        if (Array.isArray(item.content)) {
          item.content.forEach((part) => {
            if (!part) return;
            if (typeof part.text === 'string') text += part.text;
            if (typeof part.output_text === 'string') text += part.output_text;
            if (typeof part.content === 'string') text += part.content;
          });
        }
      });
      if (text.trim()) return text;
    }

    if (raw.message && raw.message.content !== undefined) {
      const text = extractTextFromNode(raw.message.content);
      if (text.trim()) return text;
    }

    if (Array.isArray(raw.choices) && raw.choices[0]) {
      const c0 = raw.choices[0];
      const fromMsg = c0.message ? extractTextFromNode(c0.message.content) : '';
      if (fromMsg.trim()) return fromMsg;
      const fromDelta = c0.delta ? extractTextFromNode(c0.delta.content || c0.delta.text || c0.delta) : '';
      if (fromDelta.trim()) return fromDelta;
      if (typeof c0.text === 'string' && c0.text.trim()) return c0.text;
    }

    if (raw.content !== undefined) {
      const text = extractTextFromNode(raw.content);
      if (text.trim()) return text;
    }

    return '';
  }

  function normalizeLLMResponse(raw) {
    const usageSource = raw && raw.usage ? raw.usage : {};
    const usage = {
      inputTokens: maybeNumber(usageSource.input_tokens) || maybeNumber(usageSource.prompt_tokens),
      outputTokens: maybeNumber(usageSource.output_tokens) || maybeNumber(usageSource.completion_tokens),
      totalTokens: maybeNumber(usageSource.total_tokens),
    };

    const finishReason =
      (raw && raw.finish_reason) ||
      (raw && raw.choices && raw.choices[0] && raw.choices[0].finish_reason) ||
      (raw && raw.status) ||
      undefined;

    const text = extractTextFromCompatiblePayload(raw) || '';
    const toolCalls = extractToolCalls(raw);

    const normalized = {
      text,
      raw,
      finishReason,
      toolCalls,
    };

    if (usage.inputTokens !== undefined || usage.outputTokens !== undefined || usage.totalTokens !== undefined) {
      normalized.usage = usage;
    }

    return normalized;
  }

  function extractStreamDelta(eventName, payload) {
    if (!payload) return '';

    if (typeof payload.delta === 'string') return payload.delta;
    if (typeof payload.output_text_delta === 'string') return payload.output_text_delta;

    if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') return payload.delta;
    if (payload.type === 'response.output_text.done' && typeof payload.text === 'string') return payload.text;

    if (payload.choices && payload.choices[0]) {
      const d = payload.choices[0].delta;
      if (d && typeof d.content === 'string') return d.content;
      if (d && Array.isArray(d.content)) return extractTextFromNode(d.content);
    }

    if (payload.message && payload.message.content !== undefined) {
      return extractTextFromNode(payload.message.content);
    }

    if (eventName === 'message' && payload.output_text !== undefined) {
      return extractTextFromNode(payload.output_text);
    }

    return '';
  }

  class LLMRequestError extends Error {
    constructor(code, userMessage, options) {
      super(userMessage);
      this.name = 'LLMRequestError';
      this.code = code;
      this.userMessage = userMessage;
      this.status = options && options.status !== undefined ? options.status : undefined;
      this.details = options && options.details ? options.details : undefined;
      this.cause = options && options.cause ? options.cause : undefined;
    }
  }

  // -----------------------------------------------------------------
  // i18n helper — falls back to the embedded English string when the
  // optional LCi18n module is absent. Keeps llm.js standalone-usable.
  // -----------------------------------------------------------------
  function lct(key, fallback, params) {
    try {
      if (typeof window !== 'undefined' && window.LCi18n && typeof window.LCi18n.t === 'function') {
        var v = window.LCi18n.t(key, params);
        if (v && v !== key) return v;
      }
    } catch (e) {}
    if (fallback && params) {
      return String(fallback).replace(/\{(\w+)\}/g, function (_, k) {
        return params[k] !== undefined && params[k] !== null ? String(params[k]) : '{' + k + '}';
      });
    }
    return fallback || key;
  }

  function isMixedContentBlocked(url) {
    try {
      const pageProtocol = window.location && window.location.protocol;
      const u = new URL(url);
      if (pageProtocol !== 'https:') return false;
      if (u.protocol !== 'http:') return false;
      return !isLocalhostHost(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function mapNetworkError(err, url) {
    const msg = err && err.message ? String(err.message) : String(err || 'Network error');

    if (isMixedContentBlocked(url)) {
      return new LLMRequestError(
        'MIXED_CONTENT',
        lct(
          'llm.error.mixedContent',
          'The HTTPS app cannot load this HTTP endpoint (mixed content). Use HTTPS or localhost.'
        ),
        { details: { url, message: msg }, cause: err }
      );
    }

    try {
      const u = new URL(url);
      if (isLocalhostHost(u.hostname)) {
        return new LLMRequestError(
          'LOCALHOST_UNREACHABLE',
          lct(
            'llm.error.localhostUnreachable',
            'Local LLM server on localhost is not reachable. Check that it is running on this device with CORS enabled.'
          ),
          { details: { url, message: msg }, cause: err }
        );
      }
    } catch (e) {}

    if (/cors/i.test(msg)) {
      return new LLMRequestError(
        'CORS',
        lct(
          'llm.error.cors',
          'The endpoint blocks browser access (CORS). Allow your app origin on the LLM server.'
        ),
        {
          details: { url, message: msg },
          cause: err,
        }
      );
    }

    return new LLMRequestError(
      'NETWORK',
      lct(
        'llm.error.network',
        'Network error reaching the LLM endpoint. Check URL, CORS and server availability.'
      ),
      {
        details: { url, message: msg },
        cause: err,
      }
    );
  }

  function parseErrorSnippet(text) {
    if (!text) return '';
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.slice(0, 300);
  }

  function mapHttpError(status, bodyText, url) {
    const snippet = parseErrorSnippet(bodyText);
    if (status === 401 || status === 403) {
      return new LLMRequestError(
        status === 401 ? 'HTTP_401' : 'HTTP_403',
        lct('llm.error.auth', 'Authentication failed. Check API key and permissions.'),
        {
          status,
          details: { url, bodyText: snippet },
        }
      );
    }
    if (status === 404) {
      return new LLMRequestError('HTTP_404', lct('llm.error.notFound', 'Endpoint not found (404). Check base URL and API path.'), {
        status,
        details: { url, bodyText: snippet },
      });
    }
    if (status === 429) {
      return new LLMRequestError('HTTP_429', lct('llm.error.rateLimit', 'Rate limit reached (429). Please try again later.'), {
        status,
        details: { url, bodyText: snippet },
      });
    }
    if (status >= 500) {
      return new LLMRequestError('HTTP_5XX', lct('llm.error.server', 'Provider error ({status}). Please try again later.', { status: status }), {
        status,
        details: { url, bodyText: snippet },
      });
    }
    return new LLMRequestError(`HTTP_${status}`, lct('llm.error.generic', 'LLM request failed ({status}).', { status: status }), {
      status,
      details: { url, bodyText: snippet },
    });
  }

  function shouldFallbackToChatCompletions(err, runtime) {
    // api.openai.com supports Responses. Falling back there can silently
    // discard Responses-only settings such as Pro mode or text.verbosity.
    if (runtime && runtime.provider && runtime.provider.id === 'openai') return false;
    if (!(err instanceof LLMRequestError)) return false;
    if (err.code === 'HTTP_404' || err.code === 'HTTP_405') return true;
    if (err.code === 'HTTP_400') {
      const detail = (err.details && err.details.bodyText) || '';
      if (/responses|unknown|unsupported|not found|no route/i.test(detail)) return true;
    }
    return false;
  }

  function makeFetchOptions(runtime, method, body, signal) {
    const headers = { 'Content-Type': 'application/json' };
    if (runtime.apiKey) headers.Authorization = 'Bearer ' + runtime.apiKey;
    return {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    };
  }

  async function performFetch(url, init, timeoutMs, externalSignal) {
    const controller = new AbortController();
    let timedOut = false;
    let abortedExternally = false;

    const onExternalAbort = () => {
      abortedExternally = true;
      controller.abort();
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        abortedExternally = true;
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
    } catch (err) {
      if (controller.signal.aborted) {
        if (abortedExternally) {
          throw new LLMRequestError('ABORTED', 'Anfrage wurde abgebrochen.', {
            details: { url },
            cause: err,
          });
        }
        if (timedOut) {
          throw new LLMRequestError('TIMEOUT', `Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)}s.`, {
            details: { url, timeoutMs },
            cause: err,
          });
        }
      }
      throw mapNetworkError(err, url);
    } finally {
      clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  async function parseJsonResponse(resp, url) {
    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
      throw mapHttpError(resp.status, text, url);
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new LLMRequestError('INVALID_JSON', 'Ungültige JSON-Antwort vom Provider.', {
        status: resp.status,
        details: { url, bodyText: parseErrorSnippet(text) },
        cause: err,
      });
    }
  }

  async function readSSEStream(resp, handlers) {
    if (!resp.body || typeof resp.body.getReader !== 'function') {
      throw new LLMRequestError('INVALID_STREAM', 'Streaming wird von dieser Antwort nicht unterstützt.', {
        details: { status: resp.status },
      });
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';
    let dataLines = [];
    let doneSeen = false;

    function emitEvent() {
      if (!dataLines.length) {
        eventName = 'message';
        return;
      }
      const payloadText = dataLines.join('\n').trim();
      dataLines = [];
      if (!payloadText) {
        eventName = 'message';
        return;
      }
      if (payloadText === '[DONE]') {
        doneSeen = true;
        return;
      }
      try {
        const payload = JSON.parse(payloadText);
        handlers.onEvent(eventName, payload);
      } catch (err) {
        handlers.onMalformedEvent(payloadText, err);
      }
      eventName = 'message';
    }

    while (!doneSeen) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);

        if (!line) {
          emitEvent();
          if (doneSeen) break;
          continue;
        }

        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    if (!doneSeen && dataLines.length) emitEvent();
  }

  function getGpt56RequestOptions(runtime) {
    if (!runtime || !runtime.isOpenAIGpt56) return {};

    const normalized = runtime.normalized || {};
    const reasoning = { effort: normalized.reasoningEffort };
    if (normalized.reasoningMode === 'pro') reasoning.mode = 'pro';

    return {
      reasoning,
      text: { verbosity: normalized.textVerbosity },
    };
  }

  function buildChatRequestBody(runtime, messages, opts) {
    const body = {
      model: runtime.model,
      messages: toChatMessages(messages),
      stream: !!opts.streaming,
    };

    // Chat Completions has a different field name. We intentionally do not
    // send text.verbosity or Pro mode here: both are Responses API features.
    if (runtime.isOpenAIGpt56) {
      body.reasoning_effort = runtime.normalized.reasoningEffort;
    }

    return body;
  }

  function buildResponsesRequestBody(runtime, messages, opts) {
    const body = {
      model: runtime.model,
      input: toResponsesInputMessages(messages),
      stream: !!opts.streaming,
    };

    const instructions = getSystemInstruction(messages);
    if (instructions) body.instructions = instructions;

    Object.assign(body, getGpt56RequestOptions(runtime));
    return body;
  }

  async function requestChatCompletions(runtime, messages, opts) {
    if (!runtime.provider.supportsChatCompletions) {
      throw new LLMRequestError('UNSUPPORTED', 'Dieser Provider unterstützt keine Chat-Completions.', {});
    }

    const url = buildUrl(runtime.baseURL, '/chat/completions');
    const body = buildChatRequestBody(runtime, messages, opts);

    const resp = await performFetch(
      url,
      makeFetchOptions(runtime, 'POST', body, opts.signal),
      runtime.timeoutMs,
      opts.signal
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw mapHttpError(resp.status, errText, url);
    }

    if (!opts.streaming) {
      const raw = await parseJsonResponse(resp, url);
      return normalizeLLMResponse(raw);
    }

    const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/event-stream')) {
      const raw = await parseJsonResponse(resp, url);
      const normalized = normalizeLLMResponse(raw);
      if (normalized.text && opts.onDelta) opts.onDelta(normalized.text);
      return normalized;
    }

    let text = '';
    let finishReason;
    let usage;

    await readSSEStream(resp, {
      onEvent: (eventName, payload) => {
        const delta = extractStreamDelta(eventName, payload);
        if (delta) {
          text += delta;
          if (opts.onDelta) opts.onDelta(delta);
        }
        if (payload && payload.choices && payload.choices[0] && payload.choices[0].finish_reason) {
          finishReason = payload.choices[0].finish_reason;
        }
        if (payload && payload.usage) {
          usage = {
            inputTokens: maybeNumber(payload.usage.input_tokens) || maybeNumber(payload.usage.prompt_tokens),
            outputTokens: maybeNumber(payload.usage.output_tokens) || maybeNumber(payload.usage.completion_tokens),
            totalTokens: maybeNumber(payload.usage.total_tokens),
          };
        }
      },
      onMalformedEvent: () => {
        // Ignore malformed stream chunks and continue; many compatible servers send occasional non-JSON lines.
      },
    });

    return {
      text,
      raw: { source: 'chat.completions.stream' },
      finishReason,
      usage,
      toolCalls: [],
    };
  }

  async function requestResponses(runtime, messages, opts) {
    if (!runtime.provider.supportsResponsesApi) {
      throw new LLMRequestError('UNSUPPORTED', 'Dieser Provider unterstützt die Responses-API nicht.', {});
    }

    const url = buildUrl(runtime.baseURL, '/responses');
    const body = buildResponsesRequestBody(runtime, messages, opts);

    const resp = await performFetch(
      url,
      makeFetchOptions(runtime, 'POST', body, opts.signal),
      runtime.timeoutMs,
      opts.signal
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw mapHttpError(resp.status, errText, url);
    }

    if (!opts.streaming) {
      const raw = await parseJsonResponse(resp, url);
      return normalizeLLMResponse(raw);
    }

    const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/event-stream')) {
      const raw = await parseJsonResponse(resp, url);
      const normalized = normalizeLLMResponse(raw);
      if (normalized.text && opts.onDelta) opts.onDelta(normalized.text);
      return normalized;
    }

    let text = '';
    let finalRaw = null;

    await readSSEStream(resp, {
      onEvent: (eventName, payload) => {
        const delta = extractStreamDelta(eventName, payload);
        if (delta) {
          text += delta;
          if (opts.onDelta) opts.onDelta(delta);
        }
        if (payload && payload.type === 'response.completed') {
          finalRaw = payload.response || payload;
        }
      },
      onMalformedEvent: () => {
        // Ignore malformed stream chunks and continue; many compatible servers send occasional non-JSON lines.
      },
    });

    if (finalRaw) {
      const normalizedFinal = normalizeLLMResponse(finalRaw);
      if (!text && normalizedFinal.text) text = normalizedFinal.text;
      return Object.assign({}, normalizedFinal, { text });
    }

    return {
      text,
      raw: { source: 'responses.stream' },
      toolCalls: [],
    };
  }

  function resolveProviderRuntime(llmSettings) {
    const normalized = normalizeLlmSettings(llmSettings);
    const providerId = normalized.providerId;
    const provider = PROVIDERS[providerId] || PROVIDERS.local;
    const cfg = normalized.providers[provider.id] || {};

    const baseURL = sanitizeBaseURL(cfg.baseURL, provider.baseURL);
    const model = String(cfg.model || '').trim() || provider.defaultModel;
    const apiKey = String(cfg.apiKey || '').trim();
    const requiresApiKey = provider.id === 'custom' ? !!cfg.requiresApiKey : !!provider.requiresApiKey;

    return {
      normalized,
      provider,
      baseURL,
      model,
      apiKey,
      requiresApiKey,
      streaming: !!normalized.streaming,
      preferResponsesApi: !!normalized.preferResponsesApi,
      timeoutMs: normalized.timeoutMs || DEFAULT_TIMEOUT_MS,
      isOpenAIGpt56: provider.id === 'openai' && isGpt56Model(model),
    };
  }

  async function sendLLMRequest(options) {
    const opts = options || {};
    const messages = Array.isArray(opts.messages) ? opts.messages : [];

    if (!messages.length) {
      throw new LLMRequestError('INVALID_REQUEST', 'Keine Nachrichten zum Senden vorhanden.', {});
    }

    const runtime = resolveProviderRuntime(opts.settings);

    if (!runtime.baseURL) {
      throw new LLMRequestError('INVALID_CONFIG', 'Keine Base-URL für den LLM-Provider konfiguriert.', {});
    }

    if (!runtime.model) {
      throw new LLMRequestError('INVALID_CONFIG', 'Kein Modellname konfiguriert.', {});
    }

    if (runtime.requiresApiKey && !runtime.apiKey) {
      throw new LLMRequestError('AUTH_REQUIRED', 'Für diesen Provider ist ein API-Key erforderlich.', {});
    }

    const requestOpts = {
      signal: opts.signal,
      onDelta: typeof opts.onDelta === 'function' ? opts.onDelta : null,
      streaming: !!runtime.streaming && typeof opts.onDelta === 'function' && runtime.provider.supportsStreaming,
    };

    if (runtime.isOpenAIGpt56 && runtime.normalized.reasoningMode === 'pro' && !runtime.preferResponsesApi) {
      throw new LLMRequestError(
        'RESPONSES_REQUIRED',
        'GPT-5.6 Pro-Modus benötigt die Responses-API. Aktiviere „Responses API bevorzugen“ in den Einstellungen.',
        {}
      );
    }

    if (runtime.preferResponsesApi && runtime.provider.supportsResponsesApi) {
      try {
        return await requestResponses(runtime, messages, requestOpts);
      } catch (err) {
        if (shouldFallbackToChatCompletions(err, runtime) && runtime.provider.supportsChatCompletions) {
          return requestChatCompletions(runtime, messages, requestOpts);
        }
        throw err;
      }
    }

    return requestChatCompletions(runtime, messages, requestOpts);
  }

  async function fetchModels(llmSettings) {
    const runtime = resolveProviderRuntime(llmSettings);

    if (!runtime.baseURL) {
      throw new LLMRequestError('INVALID_CONFIG', 'Keine Base-URL für den LLM-Provider konfiguriert.', {});
    }

    if (runtime.requiresApiKey && !runtime.apiKey) {
      throw new LLMRequestError('AUTH_REQUIRED', 'Für diesen Provider ist ein API-Key erforderlich.', {});
    }

    const headers = { 'Content-Type': 'application/json' };
    if (runtime.apiKey) headers.Authorization = 'Bearer ' + runtime.apiKey;

    const candidates = [];
    candidates.push(buildUrl(runtime.baseURL, '/models'));

    try {
      const u = new URL(runtime.baseURL);
      if (!/\/v1$/i.test(u.pathname)) {
        candidates.push((u.origin + '/v1/models').replace(/\/+$/, ''));
      }
      if (isLocalhostHost(u.hostname)) {
        candidates.push((u.origin + '/api/tags').replace(/\/+$/, ''));
      }
    } catch (e) {}

    const seen = new Set();
    const uniqueCandidates = candidates.filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });

    let lastError;
    for (const url of uniqueCandidates) {
      try {
        const resp = await performFetch(
          url,
          {
            method: 'GET',
            headers,
          },
          runtime.timeoutMs,
          null
        );

        const data = await parseJsonResponse(resp, url);
        let models = [];

        if (Array.isArray(data.data)) {
          models = data.data.map((m) => m && m.id).filter(Boolean);
        }

        if (!models.length && Array.isArray(data.models)) {
          models = data.models.map((m) => (m && (m.name || m.model)) || '').filter(Boolean);
        }

        if (models.length) {
          return models
            .slice()
            .sort((a, b) => a.localeCompare(b))
            .filter((item, idx, arr) => idx === 0 || arr[idx - 1] !== item);
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) throw lastError;
    return [];
  }

  async function testConnection(llmSettings) {
    const runtime = resolveProviderRuntime(llmSettings);

    if (!runtime.baseURL) {
      throw new LLMRequestError('INVALID_CONFIG', 'Keine Base-URL gesetzt.', {});
    }

    const models = await fetchModels(llmSettings);
    return {
      ok: true,
      provider: runtime.provider.id,
      baseURL: runtime.baseURL,
      models,
      message: models.length
        ? `Endpoint erreichbar, ${models.length} Modell(e) gefunden.`
        : 'Endpoint erreichbar, aber keine Modelle zurückgegeben.',
    };
  }

  const publicApi = {
    PROVIDERS,
    LLMRequestError,
    DEFAULT_TIMEOUT_MS,
    GPT_56_REASONING_EFFORTS,
    TEXT_VERBOSITY_LEVELS,
    createDefaultLlmSettings,
    normalizeLlmSettings,
    resolveProviderRuntime,
    getProviderCatalog,
    getOpenAIModelPresets,
    isGpt56Model,
    buildChatRequestBody,
    buildResponsesRequestBody,
    normalizeLLMResponse,
    sendLLMRequest,
    fetchModels,
    testConnection,
  };

  if (typeof window !== 'undefined') window.livecalcLLM = publicApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = publicApi;
})();
