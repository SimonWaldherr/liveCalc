'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { createServerConfig, publicProvider } = require('./provider-config');

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
});

const MODEL_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const TEXT_VERBOSITIES = new Set(['low', 'medium', 'high']);

function json(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function errorPayload(message, type, status) {
  return { error: { message, type: type || 'request_error', status } };
}

function getClientAddress(req) {
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function createRateLimiter(limit, windowMs) {
  const entries = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const current = entries.get(key);
      if (!current || now >= current.resetAt) {
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (current.count >= limit) return { allowed: false, retryAfterMs: Math.max(0, current.resetAt - now) };
      current.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

function applyCors(req, res, allowedOrigins) {
  const origin = String(req.headers.origin || '');
  if (!origin || !allowedOrigins.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return true;
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let finished = false;

    function fail(error) {
      if (finished) return;
      finished = true;
      reject(error);
    }

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('Request body is too large.');
        error.code = 'BODY_TOO_LARGE';
        fail(error);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', fail);
    req.on('end', () => {
      if (finished) return;
      finished = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (cause) {
        const error = new Error('Request body must be valid JSON.');
        error.code = 'INVALID_JSON';
        error.cause = cause;
        reject(error);
      }
    });
  });
}

function requireString(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  if (value.length > maximum) throw new Error(`${name} is too long.`);
  return value;
}

function validateModel(requestedModel, provider) {
  const model = String(requestedModel || provider.defaultModel || '').trim();
  if (!MODEL_PATTERN.test(model)) throw new Error('A valid model name is required.');
  if (provider.models.length && !provider.models.includes(model)) {
    throw new Error(`The model "${model}" is not enabled for this provider.`);
  }
  return model;
}

function normalizeReasoning(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  if (value.effort !== undefined) {
    if (!REASONING_EFFORTS.has(value.effort)) throw new Error('Unsupported reasoning effort.');
    result.effort = value.effort;
  }
  if (value.mode !== undefined) {
    if (value.mode !== 'pro') throw new Error('Unsupported reasoning mode.');
    result.mode = value.mode;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeText(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (value.verbosity === undefined) return undefined;
  if (!TEXT_VERBOSITIES.has(value.verbosity)) throw new Error('Unsupported text verbosity.');
  return { verbosity: value.verbosity };
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 80) {
    throw new Error('messages must be a non-empty array with at most 80 entries.');
  }
  const textLength = JSON.stringify(messages).length;
  if (textLength > 750000) throw new Error('messages are too large.');
  return messages;
}

function validateResponsesInput(input) {
  if ((typeof input !== 'string' && !Array.isArray(input)) || (Array.isArray(input) && !input.length)) {
    throw new Error('input must be a non-empty string or array.');
  }
  if (JSON.stringify(input).length > 750000) throw new Error('input is too large.');
  return input;
}

function buildUpstreamBody(kind, body, provider) {
  const model = validateModel(body.model, provider);
  const stream = body.stream === undefined ? false : !!body.stream;

  if (kind === 'responses') {
    const next = { model, input: validateResponsesInput(body.input), stream };
    if (body.instructions !== undefined) next.instructions = requireString(body.instructions, 'instructions', 250000);
    const reasoning = normalizeReasoning(body.reasoning);
    const text = normalizeText(body.text);
    if (reasoning) next.reasoning = reasoning;
    if (text) next.text = text;
    return next;
  }

  const next = { model, messages: validateMessages(body.messages), stream };
  if (body.reasoning_effort !== undefined) {
    if (!REASONING_EFFORTS.has(body.reasoning_effort)) throw new Error('Unsupported reasoning effort.');
    next.reasoning_effort = body.reasoning_effort;
  }
  return next;
}

function upstreamUrl(provider, suffix) {
  return `${provider.baseURL.replace(/\/+$/, '')}${suffix}`;
}

function upstreamHeaders(provider, stream) {
  const headers = {
    Accept: stream ? 'text/event-stream' : 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'LiveCalc-AI-Proxy/1.0',
  };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  return headers;
}

function createUpstreamController(req, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Upstream request timed out.')), timeoutMs);
  const close = () => controller.abort(new Error('Client disconnected.'));
  req.once('aborted', close);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      req.removeListener('aborted', close);
    },
  };
}

async function readErrorMessage(response) {
  const raw = await response.text().catch(() => '');
  if (response.status === 401 || response.status === 403) return 'The selected provider rejected the server credentials.';
  if (response.status === 429) return 'The selected provider is rate limiting requests. Please try again shortly.';
  try {
    const parsed = JSON.parse(raw);
    const message = parsed && parsed.error && parsed.error.message;
    if (typeof message === 'string' && message.trim()) return message.slice(0, 500);
  } catch (error) {}
  return `The selected provider returned HTTP ${response.status}.`;
}

async function relayResponse(upstream, res) {
  const headers = {
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  };
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;
  res.writeHead(upstream.status, headers);

  if (!upstream.body) return res.end();
  try {
    for await (const chunk of upstream.body) {
      if (res.destroyed || res.writableEnded) break;
      if (!res.write(chunk)) await once(res, 'drain');
    }
    if (!res.writableEnded) res.end();
  } catch (error) {
    if (!res.writableEnded) res.destroy(error);
  }
}

function isSafeStaticPath(pathname) {
  return !pathname.split('/').some((part) => part.startsWith('.') && part.length > 1);
}

function serveStatic(req, res, rootDir, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch (error) {
    json(res, 400, errorPayload('Invalid URL path.', 'invalid_path', 400));
    return true;
  }
  if (!isSafeStaticPath(decoded)) {
    json(res, 404, errorPayload('Not found.', 'not_found', 404));
    return true;
  }

  const root = path.resolve(rootDir);
  const target = path.resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    json(res, 404, errorPayload('Not found.', 'not_found', 404));
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    json(res, 404, errorPayload('Not found.', 'not_found', 404));
    return true;
  }
  if (!stat.isFile()) {
    json(res, 404, errorPayload('Not found.', 'not_found', 404));
    return true;
  }

  const contentType = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': path.extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    fs.createReadStream(target).pipe(res);
  }
  return true;
}

function createLiveCalcRequestHandler(options) {
  const opts = options || {};
  const config = opts.config || createServerConfig(opts.env);
  const fetchImpl = opts.fetch || globalThis.fetch;
  const rootDir = opts.rootDir || path.resolve(__dirname, '../../..');
  const limiter = opts.rateLimiter || createRateLimiter(config.rateLimit, config.rateWindowMs);

  if (typeof fetchImpl !== 'function') throw new Error('A Fetch API implementation is required (Node.js 18+).');

  return async function liveCalcRequestHandler(req, res) {
    const requestUrl = new URL(req.url || '/', 'http://livecalc.local');
    const pathname = requestUrl.pathname;
    applyCors(req, res, config.allowedOrigins);

    if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      json(res, 200, {
        status: 'ok',
        providers: Object.values(config.providers).map(publicProvider),
      });
      return;
    }

    if (pathname === '/api/ai/providers' && req.method === 'GET') {
      json(res, 200, { providers: Object.values(config.providers).map(publicProvider) });
      return;
    }

    const route = pathname.match(/^\/api\/ai\/(openai|local|custom)\/(responses|models|chat\/completions)$/);
    if (route) {
      const provider = config.providers[route[1]];
      const operation = route[2];
      const limit = limiter.allow(getClientAddress(req));
      if (!limit.allowed) {
        res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000));
        json(res, 429, errorPayload('Too many AI requests. Please try again shortly.', 'rate_limit', 429));
        return;
      }
      if (!provider || !provider.configured) {
        json(
          res,
          503,
          errorPayload(
            `${route[1] === 'openai' ? 'OpenAI' : 'This provider'} is not configured on this LiveCalc server.`,
            'provider_not_configured',
            503
          )
        );
        return;
      }
      if (operation === 'models') {
        if (req.method !== 'GET') {
          json(res, 405, errorPayload('Method not allowed.', 'method_not_allowed', 405));
          return;
        }
        const controller = createUpstreamController(req, config.requestTimeoutMs);
        try {
          const upstream = await fetchImpl(upstreamUrl(provider, '/models'), {
            method: 'GET',
            headers: upstreamHeaders(provider, false),
            signal: controller.signal,
          });
          if (!upstream.ok) {
            const message = await readErrorMessage(upstream);
            json(res, upstream.status, errorPayload(message, 'provider_error', upstream.status));
            return;
          }
          const payload = await upstream.json();
          const models = Array.isArray(payload && payload.data)
            ? payload.data
                .map((model) => (model && typeof model.id === 'string' ? model.id : ''))
                .filter((model) => !provider.models.length || provider.models.includes(model))
            : provider.models.slice();
          json(res, 200, { object: 'list', data: models.map((id) => ({ id, object: 'model' })) });
        } catch (error) {
          const timedOut = controller.signal.aborted;
          json(
            res,
            502,
            errorPayload(timedOut ? 'The provider request timed out.' : 'Could not reach the configured provider.', 'provider_unavailable', 502)
          );
        } finally {
          controller.cleanup();
        }
        return;
      }

      if (req.method !== 'POST') {
        json(res, 405, errorPayload('Method not allowed.', 'method_not_allowed', 405));
        return;
      }
      if (operation === 'responses' && !provider.supportsResponsesApi) {
        json(res, 501, errorPayload('This provider is not configured for the Responses API.', 'unsupported', 501));
        return;
      }
      if (operation === 'chat/completions' && !provider.supportsChatCompletions) {
        json(res, 501, errorPayload('This provider is not configured for Chat Completions.', 'unsupported', 501));
        return;
      }

      let requestBody;
      try {
        requestBody = await readJsonBody(req, config.maxBodyBytes);
      } catch (error) {
        const status = error.code === 'BODY_TOO_LARGE' ? 413 : 400;
        json(res, status, errorPayload(error.message, error.code || 'invalid_request', status));
        return;
      }

      let upstreamBody;
      try {
        upstreamBody = buildUpstreamBody(operation === 'responses' ? 'responses' : 'chat', requestBody, provider);
      } catch (error) {
        json(res, 400, errorPayload(error.message, 'invalid_request', 400));
        return;
      }

      const controller = createUpstreamController(req, config.requestTimeoutMs);
      try {
        const suffix = operation === 'responses' ? '/responses' : '/chat/completions';
        const upstream = await fetchImpl(upstreamUrl(provider, suffix), {
          method: 'POST',
          headers: upstreamHeaders(provider, upstreamBody.stream),
          body: JSON.stringify(upstreamBody),
          signal: controller.signal,
        });
        if (!upstream.ok) {
          const message = await readErrorMessage(upstream);
          json(res, upstream.status, errorPayload(message, 'provider_error', upstream.status));
          return;
        }
        await relayResponse(upstream, res);
      } catch (error) {
        if (!res.headersSent) {
          const timedOut = controller.signal.aborted;
          json(
            res,
            502,
            errorPayload(timedOut ? 'The provider request timed out.' : 'Could not reach the configured provider.', 'provider_unavailable', 502)
          );
        }
      } finally {
        controller.cleanup();
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      json(res, 404, errorPayload('API route not found.', 'not_found', 404));
      return;
    }

    if (!serveStatic(req, res, rootDir, pathname)) {
      json(res, 405, errorPayload('Method not allowed.', 'method_not_allowed', 405));
    }
  };
}

function createLiveCalcServer(options) {
  return http.createServer(createLiveCalcRequestHandler(options));
}

module.exports = {
  buildUpstreamBody,
  createLiveCalcRequestHandler,
  createLiveCalcServer,
  createRateLimiter,
  readJsonBody,
};
