'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { createServerConfig } = require('../backend/node/lib/provider-config');
const { buildUpstreamBody, createLiveCalcRequestHandler } = require('../backend/node/lib/livecalc-server');

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
  }

  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  }

  writeHead(status, headers) {
    this.statusCode = status;
    Object.entries(headers || {}).forEach(([name, value]) => this.setHeader(name, value));
    return this;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}

async function invoke(handler, options) {
  const opts = options || {};
  const payload = opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))];
  const req = Readable.from(payload);
  req.method = opts.method || 'GET';
  req.url = opts.url || '/';
  req.headers = opts.body === undefined ? {} : { 'content-type': 'application/json' };
  req.socket = { remoteAddress: '127.0.0.1' };
  const res = new MockResponse();
  const finished = new Promise((resolve, reject) => {
    res.once('finish', resolve);
    res.once('error', reject);
  });
  await handler(req, res);
  let timeout;
  try {
    await Promise.race([
      finished,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Mock response did not finish.')), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  return {
    status: res.statusCode,
    headers: res.headers,
    text: Buffer.concat(res.chunks).toString('utf8'),
    json() {
      return JSON.parse(this.text);
    },
  };
}

function openAIConfig() {
  return createServerConfig({
    OPENAI_API_KEY: 'server-only-test-key',
    OPENAI_MODELS: 'gpt-5.6-terra,gpt-5.6-sol',
    LIVECALC_RATE_LIMIT: '100',
  });
}

test('keeps provider credentials and base URL out of the accepted browser request', () => {
  const provider = openAIConfig().providers.openai;
  const body = buildUpstreamBody(
    'responses',
    {
      model: 'gpt-5.6-sol',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Explain this model.' }] }],
      instructions: 'Use the supplied notebook only.',
      reasoning: { effort: 'high', mode: 'pro' },
      text: { verbosity: 'low' },
      stream: false,
      apiKey: 'browser-secret-that-must-not-pass-through',
      baseURL: 'https://attacker.example/v1',
    },
    provider
  );

  assert.deepEqual(body, {
    model: 'gpt-5.6-sol',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Explain this model.' }] }],
    instructions: 'Use the supplied notebook only.',
    reasoning: { effort: 'high', mode: 'pro' },
    text: { verbosity: 'low' },
    stream: false,
  });
});

test('only forwards an allow-listed model to OpenAI and adds the server-side key', async () => {
  let upstreamRequest;
  const handler = createLiveCalcRequestHandler({
    config: openAIConfig(),
    fetch: async (url, init) => {
      upstreamRequest = { url, init };
      return new Response(
        JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Ready.' }] }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  });

  const response = await invoke(handler, {
    method: 'POST',
    url: '/api/ai/openai/responses',
    body: {
      model: 'gpt-5.6-sol',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
      stream: false,
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().output[0].content[0].text, 'Ready.');

  assert.equal(upstreamRequest.url, 'https://api.openai.com/v1/responses');
  assert.equal(upstreamRequest.init.headers.Authorization, 'Bearer server-only-test-key');
  assert.deepEqual(JSON.parse(upstreamRequest.init.body), {
    model: 'gpt-5.6-sol',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
    stream: false,
  });
});

test('relays an upstream Responses SSE stream without storing generated values', async () => {
  const handler = createLiveCalcRequestHandler({
    config: openAIConfig(),
    fetch: async () =>
      new Response('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      }),
  });

  const response = await invoke(handler, {
    method: 'POST',
    url: '/api/ai/openai/responses',
    body: {
      model: 'gpt-5.6-terra',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
      stream: true,
    },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/event-stream/);
  assert.match(response.text, /response\.output_text\.delta/);
  assert.match(response.text, /"delta":"Hello"/);
});

test('reports unconfigured providers without contacting an upstream endpoint', async () => {
  let called = false;
  const handler = createLiveCalcRequestHandler({
    config: createServerConfig({ LIVECALC_RATE_LIMIT: '100' }),
    fetch: async () => {
      called = true;
      throw new Error('must not be called');
    },
  });

  const response = await invoke(handler, { url: '/api/ai/openai/models' });
  const body = response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.type, 'provider_not_configured');
  assert.equal(called, false);
});

test('serves the application and hides dotfiles', async () => {
  const handler = createLiveCalcRequestHandler({ config: openAIConfig() });
  const app = await invoke(handler, { url: '/' });
  assert.equal(app.status, 200);
  assert.match(app.text, /LiveCalc/);

  const env = await invoke(handler, { url: '/.env' });
  assert.equal(env.status, 404);

  const encodedEnv = await invoke(handler, { url: '/%2eenv' });
  assert.equal(encodedEnv.status, 404);

  const post = await invoke(handler, { method: 'POST', url: '/' });
  assert.equal(post.status, 405);
});
