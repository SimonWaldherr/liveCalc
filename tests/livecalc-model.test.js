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

test('normalizes vectors and record arrays into one table type for renderers and exports', () => {
  const vector = model.normalizeTable([1, 2, 3], 'year');
  assert.deepEqual(vector, {
    type: 'table',
    columns: [{ name: 'year', type: 'number', unit: undefined, values: [1, 2, 3] }],
    rowCount: 3,
  });
  assert.equal(model.tableToCsv(vector), 'year\r\n1\r\n2\r\n3');

  const records = model.normalizeTable([
    { month: 'Jan', revenue: 12 },
    { month: 'Feb', revenue: 15 },
  ]);
  assert.deepEqual(model.tableToRows(records), [
    { month: 'Jan', revenue: 12 },
    { month: 'Feb', revenue: 15 },
  ]);
  assert.match(model.tableToJson(records), /"revenue": 15/);
});

test('visualizations store references only and derive fresh points from the evaluation revision', () => {
  const runtime = model.createRuntime();
  runtime.setNotebook('months = [1, 2, 3]\nprofit = [3, 5, 4]');
  runtime.setVisualizationSpecs([
    { id: 'profit-line', type: 'line', title: 'Profit over time', x: 'months', y: 'profit', data: [999] },
  ]);

  const stored = runtime.getState().visualization.specs[0];
  assert.equal(Object.hasOwn(stored, 'data'), false);
  assert.equal(stored.valid, true);

  const first = model.deriveVisualizationData(stored, {
    revision: 3,
    status: 'valid',
    values: { months: [1, 2, 3], profit: [3, 5, 4] },
  });
  const second = model.deriveVisualizationData(stored, {
    revision: 4,
    status: 'valid',
    values: { months: [1, 2, 3], profit: [7, 1, 8] },
  });
  assert.equal(first.valid, true);
  assert.deepEqual(first.points.map((point) => point.profit), [3, 5, 4]);
  assert.equal(second.revision, 4);
  assert.deepEqual(second.points.map((point) => point.profit), [7, 1, 8]);
});

test('share serialization removes any supplied visualization data', () => {
  const encoded = model.serializeShareState({
    notebook: { source: 'profit = [3, 5, 4]' },
    visualizations: [{ id: 'profit-bars', type: 'bar', y: 'profit', values: [3, 5, 4] }],
  });
  const decoded = model.deserializeShareState(encoded);

  assert.deepEqual(decoded.visualizations, [{ id: 'profit-bars', type: 'bar', y: 'profit' }]);
});

test('an invalid visualization reference is reported without blocking model evaluation', () => {
  const runtime = model.createRuntime();
  runtime.setNotebook('profit = [3, 5, 4]');
  runtime.setVisualizationSpecs([{ id: 'missing-series', type: 'bar', y: 'revenue' }]);

  const specification = runtime.getState().visualization.specs[0];
  assert.equal(specification.valid, false);
  assert.match(specification.error, /Missing model reference: revenue/);
  assert.equal(runtime.commitEvaluation(1, { scope: { profit: [3, 5, 4] }, output: [] }), true);
  assert.equal(runtime.getState().evaluation.status, 'valid');
});
