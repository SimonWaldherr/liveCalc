const test = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../livecalc-llm.js');

test('normalizes GPT-5.6 request controls to safe explicit defaults', () => {
  const settings = llm.normalizeLlmSettings({
    providerId: 'openai',
    reasoningEffort: 'invalid',
    textVerbosity: 'invalid',
    reasoningMode: 'unexpected',
  });

  assert.equal(settings.providers.openai.model, 'gpt-5.6-terra');
  assert.equal(settings.reasoningEffort, 'medium');
  assert.equal(settings.textVerbosity, 'medium');
  assert.equal(settings.reasoningMode, 'standard');
});

test('builds the documented GPT-5.6 Responses request shape', () => {
  const runtime = llm.resolveProviderRuntime({
    providerId: 'openai',
    reasoningEffort: 'high',
    textVerbosity: 'low',
    reasoningMode: 'pro',
    providers: {
      openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-5.6-sol', apiKey: 'test-key' },
    },
  });

  const body = llm.buildResponsesRequestBody(
    runtime,
    [
      { role: 'system', content: 'Keep the calculator deterministic.' },
      { role: 'user', content: 'Build a break-even model.' },
    ],
    { streaming: true }
  );

  assert.equal(runtime.isOpenAIGpt56, true);
  assert.equal(body.model, 'gpt-5.6-sol');
  assert.equal(body.instructions, 'Keep the calculator deterministic.');
  assert.deepEqual(body.reasoning, { effort: 'high', mode: 'pro' });
  assert.deepEqual(body.text, { verbosity: 'low' });
  assert.equal(body.stream, true);
  assert.deepEqual(body.input, [{ role: 'user', content: [{ type: 'input_text', text: 'Build a break-even model.' }] }]);
});

test('uses the Chat Completions field only when that endpoint is selected', () => {
  const runtime = llm.resolveProviderRuntime({
    providerId: 'openai',
    reasoningEffort: 'low',
    textVerbosity: 'high',
    providers: {
      openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-5.6', apiKey: 'test-key' },
    },
  });

  const body = llm.buildChatRequestBody(runtime, [{ role: 'user', content: 'Explain revenue.' }], { streaming: false });

  assert.equal(body.reasoning_effort, 'low');
  assert.equal(Object.hasOwn(body, 'text'), false);
  assert.equal(Object.hasOwn(body, 'reasoning'), false);
});

test('does not add GPT-5.6-only fields to older OpenAI models', () => {
  const runtime = llm.resolveProviderRuntime({
    providerId: 'openai',
    providers: {
      openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: 'test-key' },
    },
  });

  const body = llm.buildResponsesRequestBody(runtime, [{ role: 'user', content: 'Hello' }], { streaming: false });

  assert.equal(runtime.isOpenAIGpt56, false);
  assert.equal(Object.hasOwn(body, 'reasoning'), false);
  assert.equal(Object.hasOwn(body, 'text'), false);
});

test('rejects GPT-5.6 Pro mode when Responses has been disabled', async () => {
  await assert.rejects(
    () =>
      llm.sendLLMRequest({
        settings: {
          providerId: 'openai',
          preferResponsesApi: false,
          reasoningMode: 'pro',
          providers: {
            openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-5.6-terra', apiKey: 'test-key' },
          },
        },
        messages: [{ role: 'user', content: 'Build a model.' }],
      }),
    (err) => err && err.code === 'RESPONSES_REQUIRED'
  );
});
