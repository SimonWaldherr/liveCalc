const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../livecalc-model.js');

test('parses definitions and derives the dependency graph from references', () => {
  const parsed = model.parseNotebook(
    ['principal = 10000', 'rate = 0.05', 'interest = principal * rate', 'total = principal + interest'].join('\n'),
    4
  );

  assert.deepEqual(parsed.references.interest, ['principal', 'rate']);
  assert.deepEqual(parsed.references.total, ['principal', 'interest']);
  assert.deepEqual(parsed.dependents.principal, ['interest', 'total']);

  const context = model.getDependencyContext(parsed, 'principal');
  assert.deepEqual(context.downstream.sort(), ['interest', 'total']);
  assert.deepEqual(context.usages, [
    { name: 'interest', line: 3 },
    { name: 'total', line: 4 },
  ]);
});

test('functions exclude their parameters from dependency references', () => {
  const parsed = model.parseNotebook(['rate = 0.05', 'growth(year) = year * rate'].join('\n'), 1);

  assert.deepEqual(parsed.references.growth, ['rate']);
});

test('a stale evaluator result can never overwrite a newer notebook revision', () => {
  const runtime = model.createRuntime();
  const oldRevision = runtime.setNotebook('a = 1');
  const currentRevision = runtime.setNotebook('a = 2');

  assert.equal(runtime.commitEvaluation(oldRevision, { scope: { a: 1 }, output: [{ value: '1', type: 'result' }] }), false);
  assert.equal(runtime.commitEvaluation(currentRevision, { scope: { a: 2 }, output: [{ value: '2', type: 'result' }] }), true);
  assert.equal(runtime.getState().evaluation.values.a, 2);
  assert.equal(runtime.getState().evaluation.revision, currentRevision);
});

test('controls contain references and configuration, never a separate current value', () => {
  const runtime = model.createRuntime();
  runtime.setNotebook('rate = 0.05\ntotal = rate * 100');
  const control = runtime.addControl({ variable: 'rate', type: 'range', min: 0, max: 0.2, step: 0.01 });

  assert.equal(control.valid, true);
  assert.equal(Object.hasOwn(control, 'value'), false);
  assert.equal(runtime.getState().controls.specs[0].variable, 'rate');

  runtime.setNotebook('interest = 12');
  assert.equal(runtime.getState().controls.specs[0].valid, false);
  assert.match(runtime.getState().controls.specs[0].errors[0], /no longer exists/);
});

test('changing a slider value rewrites the editor assignment and preserves units and comments', () => {
  const result = model.replaceAssignmentValue('principal = 10000 USD # cash invested\nprofit = principal * 0.1', 'principal', '12500');

  assert.equal(result.replaced, true);
  assert.equal(result.source, 'principal = 12500 USD # cash invested\nprofit = principal * 0.1');
});

test('share payload contains editable model state but no evaluation cache', () => {
  const encoded = model.serializeShareState({
    notebook: { source: 'price = 12\nrevenue = price * 3' },
    controls: [{ id: 'control-price', variable: 'price', type: 'range', min: 0, max: 50, step: 1 }],
    visualizations: [{ id: 'revenue-chart', type: 'bar', y: 'revenue' }],
    layout: { mode: 'editor' },
    locale: { language: 'de', unitSystem: 'metric' },
    metadata: { title: 'Pricing' },
    evaluation: { values: { revenue: 36 } },
  });
  const decoded = model.deserializeShareState(encoded);

  assert.ok(encoded.startsWith(model.SHARE_PREFIX));
  assert.deepEqual(decoded.notebook, { source: 'price = 12\nrevenue = price * 3' });
  assert.deepEqual(decoded.controls, [{ id: 'control-price', variable: 'price', type: 'range', min: 0, max: 50, step: 1 }]);
  assert.equal(Object.hasOwn(decoded, 'evaluation'), false);
});
