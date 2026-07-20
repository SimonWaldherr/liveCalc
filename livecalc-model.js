/*
 * LiveCalc model runtime
 *
 * The editor source is the canonical model. This module deliberately stores
 * only source-derived values and structural UI specifications: controls and
 * visualizations never own a copy of a calculated value.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveCalcModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SHARE_PREFIX = 'lc1.';
  const SHARE_VERSION = 1;
  const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const BUILTIN_NAMES = new Set([
    'abs',
    'acos',
    'asin',
    'atan',
    'ceil',
    'cos',
    'e',
    'exp',
    'floor',
    'log',
    'max',
    'mean',
    'min',
    'pi',
    'round',
    'sin',
    'sqrt',
    'sum',
    'tan',
    'true',
    'false',
  ]);
  const VISUALIZATION_TYPES = new Set(['line', 'bar', 'waterfall']);

  function safeString(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function escapeRegExp(value) {
    return safeString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function valueToArray(value) {
    if (Array.isArray(value)) return value.slice();
    if (ArrayBuffer.isView(value)) return Array.prototype.slice.call(value);
    if (value && typeof value.toArray === 'function') {
      try {
        const arrayValue = value.toArray();
        return Array.isArray(arrayValue) ? arrayValue : null;
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  function isQuantity(value) {
    return !!value && typeof value === 'object' && value.isUnit === true;
  }

  function getQuantityUnit(value) {
    try {
      const first = value && value.units && value.units[0];
      return first && first.unit && first.unit.name ? String(first.unit.name) : '';
    } catch (error) {
      return '';
    }
  }

  function getQuantityNumber(value, unit) {
    try {
      if (value && typeof value.toNumber === 'function') return value.toNumber(unit || undefined);
    } catch (error) {
      return null;
    }
    return null;
  }

  function plainValue(value) {
    if (value === undefined || value === null) return null;
    if (isQuantity(value)) {
      const unit = getQuantityUnit(value);
      const numeric = getQuantityNumber(value, unit);
      return Number.isFinite(numeric) ? numeric : String(value);
    }
    if (value instanceof Date) return value.toISOString();
    if (value && value.isBigNumber && typeof value.toNumber === 'function') return value.toNumber();
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
    if (value && typeof value.valueOf === 'function') {
      const primitive = value.valueOf();
      if (typeof primitive === 'number' || typeof primitive === 'string' || typeof primitive === 'boolean') return primitive;
    }
    return String(value);
  }

  function inferColumnType(values) {
    const present = values.filter(function (value) {
      return value !== null && value !== undefined;
    });
    if (!present.length) return 'unknown';
    if (present.every(function (value) { return isQuantity(value); })) return 'quantity';
    if (present.every(function (value) { return typeof value === 'number' || (value && value.isBigNumber); })) return 'number';
    if (present.every(function (value) { return typeof value === 'boolean'; })) return 'boolean';
    if (present.every(function (value) { return value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)); })) return 'date';
    return 'string';
  }

  function normalizeColumn(name, values, requestedType, requestedUnit) {
    const rawValues = Array.isArray(values) ? values : [];
    const type = requestedType || inferColumnType(rawValues);
    const unit = requestedUnit || (type === 'quantity' ? getQuantityUnit(rawValues.find(isQuantity)) : '');
    return {
      name: safeString(name) || 'value',
      type: type,
      unit: unit || undefined,
      values: rawValues.map(function (value) {
        if (value === undefined) return null;
        if (type === 'quantity' && isQuantity(value)) return plainValue(value);
        return plainValue(value);
      }),
    };
  }

  // Tables are a shared internal value type. The evaluator, table renderer,
  // visualization derivation, and exporters all consume this shape instead
  // of maintaining their own copies of a dataset.
  function normalizeTable(value, defaultColumnName) {
    const name = safeString(defaultColumnName) || 'value';
    if (value && value.type === 'table' && Array.isArray(value.columns)) {
      const columns = value.columns.map(function (column, index) {
        const source = column && typeof column === 'object' ? column : {};
        return normalizeColumn(source.name || 'column_' + (index + 1), source.values, source.type, source.unit);
      });
      const rowCount = columns.length ? Math.min.apply(null, columns.map(function (column) { return column.values.length; })) : 0;
      columns.forEach(function (column) { column.values = column.values.slice(0, rowCount); });
      return { type: 'table', columns: columns, rowCount: rowCount };
    }

    const arrayValue = valueToArray(value);
    if (!arrayValue) return null;
    if (!arrayValue.length) return { type: 'table', columns: [], rowCount: 0 };

    if (arrayValue.every(function (row) { return isPlainObject(row) && !isQuantity(row); })) {
      const keys = [];
      arrayValue.forEach(function (row) {
        Object.keys(row).forEach(function (key) {
          if (!keys.includes(key)) keys.push(key);
        });
      });
      return {
        type: 'table',
        columns: keys.map(function (key) {
          return normalizeColumn(key, arrayValue.map(function (row) { return row[key]; }));
        }),
        rowCount: arrayValue.length,
      };
    }

    if (arrayValue.every(Array.isArray)) {
      const width = arrayValue.reduce(function (max, row) { return Math.max(max, row.length); }, 0);
      return {
        type: 'table',
        columns: Array.from({ length: width }, function (_, index) {
          return normalizeColumn('column_' + (index + 1), arrayValue.map(function (row) { return row[index]; }));
        }),
        rowCount: arrayValue.length,
      };
    }

    return { type: 'table', columns: [normalizeColumn(name, arrayValue)], rowCount: arrayValue.length };
  }

  function tableToRows(table) {
    const normalized = normalizeTable(table);
    if (!normalized) return [];
    return Array.from({ length: normalized.rowCount }, function (_, rowIndex) {
      const row = {};
      normalized.columns.forEach(function (column) { row[column.name] = column.values[rowIndex]; });
      return row;
    });
  }

  function tableToCsv(table) {
    const normalized = normalizeTable(table);
    if (!normalized) return '';
    const escapeCell = function (value) {
      const source = value === null || value === undefined ? '' : String(value);
      return /[",\n\r]/.test(source) ? '"' + source.replace(/"/g, '""') + '"' : source;
    };
    const rows = [normalized.columns.map(function (column) { return escapeCell(column.name); }).join(',')];
    tableToRows(normalized).forEach(function (row) {
      rows.push(normalized.columns.map(function (column) { return escapeCell(row[column.name]); }).join(','));
    });
    return rows.join('\r\n');
  }

  function tableToJson(table) {
    return JSON.stringify(tableToRows(table), null, 2);
  }

  function hashSource(source) {
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function getExpressionReferences(expression, mathInstance) {
    const manualReferences = safeString(expression).match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    if (!mathInstance || typeof mathInstance.parse !== 'function') return unique(manualReferences);

    try {
      const parsedExpression = mathInstance.parse(expression);
      const references = [];
      if (parsedExpression && typeof parsedExpression.traverse === 'function') {
        parsedExpression.traverse(function (node) {
          if (node && node.type === 'SymbolNode' && node.name) references.push(node.name);
        });
      }
      return unique(references.length ? references : manualReferences);
    } catch (error) {
      return unique(manualReferences);
    }
  }

  function parseNotebook(source, revision, mathInstance) {
    const text = safeString(source);
    const lines = text.split('\n');
    const definitions = {};
    const diagnostics = [];

    lines.forEach(function (line, index) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

      const functionMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*=\s*(.+)$/);
      const assignmentMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      const match = functionMatch || assignmentMatch;
      if (!match) return;

      const name = match[1];
      const parameters = functionMatch
        ? (functionMatch[2].match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter(function (parameter) {
            return IDENTIFIER_RE.test(parameter);
          })
        : [];
      const expression = functionMatch ? functionMatch[3].trim() : assignmentMatch[2].trim();

      if (definitions[name]) {
        diagnostics.push({
          severity: 'warning',
          line: index + 1,
          code: 'duplicate-symbol',
          message: '"' + name + '" is defined more than once; the last definition wins.',
        });
      }

      definitions[name] = {
        name: name,
        line: index + 1,
        expression: expression,
        parameters: parameters,
        kind: functionMatch ? 'function' : 'variable',
        ast: null,
        references: [],
      };

      if (mathInstance && typeof mathInstance.parse === 'function') {
        try {
          definitions[name].ast = mathInstance.parse(expression);
        } catch (error) {
          // The evaluator supplies the user-facing error. The structural parser
          // keeps an explicit warning so consumers never silently use old data.
          diagnostics.push({
            severity: 'warning',
            line: index + 1,
            code: 'unparsed-expression',
            message: 'The expression could not be parsed structurally yet.',
          });
        }
      }
    });

    const symbolNames = Object.keys(definitions);
    const symbolSet = new Set(symbolNames);
    const references = {};
    const dependents = {};
    symbolNames.forEach(function (name) {
      dependents[name] = [];
    });

    symbolNames.forEach(function (name) {
      const definition = definitions[name];
      const candidates = getExpressionReferences(definition.expression, mathInstance);
      const directReferences = candidates.filter(function (candidate) {
        return (
          candidate !== name &&
          !definition.parameters.includes(candidate) &&
          symbolSet.has(candidate) &&
          !BUILTIN_NAMES.has(candidate)
        );
      });
      definition.references = unique(directReferences);
      references[name] = definition.references;
      definition.references.forEach(function (dependency) {
        dependents[dependency].push(name);
      });
    });

    Object.keys(dependents).forEach(function (name) {
      dependents[name] = unique(dependents[name]);
    });

    return {
      revision: revision,
      sourceHash: hashSource(text),
      symbols: symbolNames.map(function (name) {
        return definitions[name];
      }),
      definitions: definitions,
      references: references,
      dependents: dependents,
      diagnostics: diagnostics,
    };
  }

  function walkGraph(start, graph) {
    const seen = new Set();
    const visit = function (name) {
      (graph[name] || []).forEach(function (next) {
        if (seen.has(next)) return;
        seen.add(next);
        visit(next);
      });
    };
    visit(start);
    return Array.from(seen);
  }

  function getDependencyContext(parsedModel, name) {
    if (!parsedModel || !parsedModel.definitions[name]) return null;
    return {
      directDependencies: parsedModel.references[name] || [],
      directDependents: parsedModel.dependents[name] || [],
      upstream: walkGraph(name, parsedModel.references),
      downstream: walkGraph(name, parsedModel.dependents),
      usages: (parsedModel.dependents[name] || []).map(function (dependent) {
        const definition = parsedModel.definitions[dependent];
        return { name: dependent, line: definition ? definition.line : null };
      }),
    };
  }

  function normalizeControlSpec(specification, parsedModel) {
    const spec = specification && typeof specification === 'object' ? specification : {};
    const variable = safeString(spec.variable).trim();
    const type = spec.type === 'select' || spec.type === 'checkbox' || spec.type === 'date' ? spec.type : 'range';
    const requestedId = safeString(spec.id)
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, '');
    const normalized = {
      id: requestedId || 'control-' + variable,
      variable: variable,
      type: type,
      label: safeString(spec.label).trim() || variable,
      description: safeString(spec.description).trim(),
      min: Number.isFinite(Number(spec.min)) ? Number(spec.min) : undefined,
      max: Number.isFinite(Number(spec.max)) ? Number(spec.max) : undefined,
      step: Number.isFinite(Number(spec.step)) && Number(spec.step) > 0 ? Number(spec.step) : undefined,
      options: Array.isArray(spec.options) ? spec.options.map(safeString) : [],
    };
    const errors = [];
    if (!variable) errors.push('A control must reference a variable.');
    if (variable && (!parsedModel || !parsedModel.definitions[variable])) {
      errors.push('The variable "' + variable + '" no longer exists in the notebook.');
    }
    if (
      type === 'range' &&
      normalized.min !== undefined &&
      normalized.max !== undefined &&
      normalized.min >= normalized.max
    ) {
      errors.push('The minimum must be smaller than the maximum.');
    }
    return { spec: normalized, errors: errors, valid: errors.length === 0 };
  }

  function normalizeVisualizationSpec(specification) {
    const spec = specification && typeof specification === 'object' ? specification : {};
    const type = VISUALIZATION_TYPES.has(spec.type) ? spec.type : 'line';
    const y = Array.isArray(spec.y)
      ? spec.y.filter(function (item) { return typeof item === 'string' && item.trim(); })
      : typeof spec.y === 'string' && spec.y.trim()
        ? spec.y.trim()
        : typeof spec.variable === 'string' && spec.variable.trim()
          ? spec.variable.trim()
          : [];
    const id = safeString(spec.id)
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, '');
    const normalized = {
      id: id || 'visualization-' + type + '-' + (Array.isArray(y) ? y.join('-') : y || 'model'),
      type: type,
      title: safeString(spec.title).trim(),
      x: typeof spec.x === 'string' && spec.x.trim() ? spec.x.trim() : undefined,
      y: y,
      labels: spec.labels && typeof spec.labels === 'object' ? Object.assign({}, spec.labels) : undefined,
      options: spec.options && typeof spec.options === 'object' ? Object.assign({}, spec.options) : undefined,
    };
    Object.keys(normalized).forEach(function (key) {
      if (normalized[key] === undefined || (key === 'title' && !normalized[key])) delete normalized[key];
    });
    return normalized;
  }

  function visualizationReferences(specification) {
    const spec = specification && typeof specification === 'object' ? specification : {};
    const references = [];
    ['x', 'y'].forEach(function (key) {
      const value = spec[key];
      if (typeof value === 'string') references.push(value);
      if (Array.isArray(value))
        references.push.apply(
          references,
          value.filter(function (item) {
            return typeof item === 'string';
          })
        );
    });
    return unique(references);
  }

  function validateVisualizationSpec(specification, parsedModel) {
    const spec = normalizeVisualizationSpec(specification);
    const references = visualizationReferences(spec);
    const missing = unique(references).filter(function (reference) {
      return parsedModel && !parsedModel.definitions[reference];
    });
    const errors = [];
    if (!references.length) errors.push('A visualization must reference at least one model variable.');
    if (specification && (Object.hasOwn(specification, 'data') || Object.hasOwn(specification, 'values'))) {
      errors.push('Visualization data is derived from the current evaluation and cannot be stored in a specification.');
    }
    if (missing.length) errors.push('Missing model reference: ' + missing.join(', '));
    return {
      spec: spec,
      valid: errors.length === 0,
      missing: missing,
      message: errors.join(' '),
    };
  }

  function getSeriesValues(value) {
    const table = normalizeTable(value);
    if (!table) {
      const scalar = plainValue(value);
      const numeric = typeof scalar === 'number' ? scalar : Number(scalar);
      return Number.isFinite(numeric) ? { values: [numeric], unit: isQuantity(value) ? getQuantityUnit(value) : '', type: 'number' } : null;
    }
    if (table.columns.length !== 1) return null;
    const column = table.columns[0];
    const values = column.values.map(function (item) {
      const numeric = typeof item === 'number' ? item : Number(item);
      return Number.isFinite(numeric) ? numeric : null;
    });
    return { values: values, unit: column.unit || '', type: column.type };
  }

  // This is intentionally pure: chart data is created from the current
  // EvaluationState at render/export time, never written back into the chart
  // specification. A chart therefore cannot become stale independently of
  // the notebook revision that produced it.
  function deriveVisualizationData(specification, evaluationState) {
    const checked = validateVisualizationSpec(specification, null);
    const evaluation = evaluationState && typeof evaluationState === 'object' ? evaluationState : {};
    const values = evaluation.values && typeof evaluation.values === 'object' ? evaluation.values : {};
    const spec = checked.spec;
    const yReferences = Array.isArray(spec.y) ? spec.y : [spec.y];
    const missing = visualizationReferences(spec).filter(function (name) {
      return !Object.prototype.hasOwnProperty.call(values, name);
    });
    if (!checked.valid || missing.length || evaluation.status === 'invalid') {
      const problems = [];
      if (checked.message) problems.push(checked.message);
      if (missing.length) problems.push('Missing evaluated value: ' + missing.join(', '));
      if (evaluation.status === 'invalid') problems.push('The current model is invalid.');
      return { revision: evaluation.revision || 0, spec: spec, valid: false, error: problems.join(' ') };
    }

    const series = yReferences.map(function (name) {
      const value = getSeriesValues(values[name]);
      return value ? { id: name, label: name, values: value.values, unit: value.unit } : null;
    });
    if (series.some(function (item) { return !item; })) {
      return { revision: evaluation.revision || 0, spec: spec, valid: false, error: 'Visualization values must be numeric vectors or numbers.' };
    }

    let xValues = null;
    if (spec.x) {
      const x = getSeriesValues(values[spec.x]);
      if (!x) return { revision: evaluation.revision || 0, spec: spec, valid: false, error: 'The x reference must be a vector or number.' };
      xValues = x.values;
    }
    const pointCount = series.reduce(function (count, item) { return Math.max(count, item.values.length); }, 0);
    if (!pointCount) return { revision: evaluation.revision || 0, spec: spec, valid: false, error: 'The visualization has no values to display.' };
    if (xValues && xValues.length !== pointCount) {
      return { revision: evaluation.revision || 0, spec: spec, valid: false, error: 'The x and y vectors must have the same length.' };
    }
    if (series.some(function (item) { return item.values.length !== pointCount; })) {
      return { revision: evaluation.revision || 0, spec: spec, valid: false, error: 'All plotted vectors must have the same length.' };
    }

    const labels = spec.labels && Array.isArray(spec.labels.x) ? spec.labels.x.slice(0, pointCount) : null;
    const x = xValues || Array.from({ length: pointCount }, function (_, index) { return index + 1; });
    const points = Array.from({ length: pointCount }, function (_, index) {
      const point = { x: x[index], label: labels ? labels[index] : String(x[index]) };
      series.forEach(function (item) { point[item.id] = item.values[index]; });
      return point;
    });
    if (spec.type === 'waterfall') {
      let total = 0;
      points.forEach(function (point) {
        const delta = point[series[0].id];
        point.start = total;
        total += delta;
        point.end = total;
      });
    }
    return { revision: evaluation.revision || 0, spec: spec, valid: true, x: x, series: series, points: points };
  }

  function encodeUtf8(value) {
    const source = safeString(value);
    if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
      const bytes = new TextEncoder().encode(source);
      let binary = '';
      bytes.forEach(function (byte) {
        binary += String.fromCharCode(byte);
      });
      return btoa(binary);
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(source, 'utf8').toString('base64');
    return '';
  }

  function decodeUtf8(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      if (typeof TextDecoder !== 'undefined' && typeof atob === 'function') {
        const binary = atob(value);
        const bytes = Uint8Array.from(binary, function (character) {
          return character.charCodeAt(0);
        });
        return new TextDecoder().decode(bytes);
      }
      if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('utf8');
    } catch (error) {
      return '';
    }
    return '';
  }

  function serializeShareState(shareState) {
    const state = shareState && typeof shareState === 'object' ? shareState : {};
    const payload = {
      version: SHARE_VERSION,
      notebook: { source: safeString(state.notebook && state.notebook.source) },
      visualizations: Array.isArray(state.visualizations)
        ? state.visualizations.map(function (specification) { return normalizeVisualizationSpec(specification); })
        : [],
      controls: Array.isArray(state.controls) ? state.controls : [],
      layout: state.layout && typeof state.layout === 'object' ? state.layout : {},
      locale: state.locale && typeof state.locale === 'object' ? state.locale : {},
      metadata: state.metadata && typeof state.metadata === 'object' ? state.metadata : {},
    };
    return SHARE_PREFIX + encodeUtf8(JSON.stringify(payload));
  }

  function deserializeShareState(hash) {
    const encoded = safeString(hash).replace(/^#/, '');
    if (!encoded.startsWith(SHARE_PREFIX)) return null;
    try {
      const parsed = JSON.parse(decodeUtf8(encoded.slice(SHARE_PREFIX.length)));
      if (!parsed || parsed.version !== SHARE_VERSION || !parsed.notebook || typeof parsed.notebook.source !== 'string')
        return null;
      return {
        notebook: { source: parsed.notebook.source },
        visualizations: Array.isArray(parsed.visualizations) ? parsed.visualizations : [],
        controls: Array.isArray(parsed.controls) ? parsed.controls : [],
        layout: parsed.layout && typeof parsed.layout === 'object' ? parsed.layout : {},
        locale: parsed.locale && typeof parsed.locale === 'object' ? parsed.locale : {},
        metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {},
      };
    } catch (error) {
      return null;
    }
  }

  function replaceAssignmentValue(source, name, value) {
    const lines = safeString(source).split('\n');
    const assignment = new RegExp('^(\\s*' + escapeRegExp(name) + '\\s*=\\s*)(.*)$');
    const numericValue = safeString(value).trim();
    let replaced = false;

    const nextLines = lines.map(function (line) {
      if (replaced) return line;
      const match = line.match(assignment);
      if (!match) return line;

      const rhs = match[2];
      const commentMatch = rhs.match(/^(.*?)(\s+(?:#|\/\/).*?)$/);
      const expression = commentMatch ? commentMatch[1].trim() : rhs.trim();
      const comment = commentMatch ? commentMatch[2] : '';
      const unitMatch = expression.match(
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s+([A-Za-z°][A-Za-z0-9°_^*/.-]*)$/
      );
      const suffix = unitMatch ? ' ' + unitMatch[1] : '';
      replaced = true;
      return match[1] + numericValue + suffix + comment;
    });

    return { source: nextLines.join('\n'), replaced: replaced };
  }

  function createRuntime(options) {
    const config = options && typeof options === 'object' ? options : {};
    const mathInstance = config.math || null;
    let state = {
      notebook: { source: '', revision: 0 },
      parsedModel: parseNotebook('', 0, mathInstance),
      evaluation: { revision: 0, status: 'idle', values: {}, tables: {}, functions: {}, output: [], errors: [], warnings: [] },
      visualization: { specs: [], selectedId: null },
      controls: { specs: [], selectedId: null },
      share: { layout: {}, locale: {}, metadata: {} },
      selection: { kind: null, id: null },
    };

    function cloneState() {
      return state;
    }

    function validateSpecs() {
      state.controls.specs = state.controls.specs.map(function (specification) {
        const checked = normalizeControlSpec(specification, state.parsedModel);
        return Object.assign({}, checked.spec, { valid: checked.valid, errors: checked.errors });
      });
      state.visualization.specs = state.visualization.specs.map(function (specification) {
        const checked = validateVisualizationSpec(specification, state.parsedModel);
        return Object.assign({}, checked.spec, {
          valid: checked.valid,
          missing: checked.missing,
          error: checked.message,
        });
      });
    }

    function setNotebook(source) {
      const nextSource = safeString(source);
      const revision = state.notebook.revision + 1;
      state.notebook = { source: nextSource, revision: revision };
      state.parsedModel = parseNotebook(nextSource, revision, mathInstance);
      state.evaluation = {
        revision: revision,
        status: 'pending',
        values: {},
        tables: {},
        functions: {},
        output: [],
        errors: [],
        warnings: [],
      };
      validateSpecs();
      return revision;
    }

    function commitEvaluation(revision, legacyResult) {
      if (revision !== state.notebook.revision) return false;
      const result = legacyResult && typeof legacyResult === 'object' ? legacyResult : {};
      const errors = (result.output || [])
        .map(function (entry, index) {
          return entry && entry.type === 'error' ? { line: index + 1, message: safeString(entry.value) } : null;
        })
        .filter(Boolean);
      const values = result.scope || {};
      const tables = {};
      Object.keys(values).forEach(function (name) {
        const table = normalizeTable(values[name], name);
        if (table) tables[name] = table;
      });
      state.evaluation = {
        revision: revision,
        status: errors.length ? 'invalid' : 'valid',
        values: values,
        tables: tables,
        functions: result.functions || {},
        output: result.output || [],
        errors: errors,
        warnings: state.parsedModel.diagnostics || [],
      };
      return true;
    }

    function select(kind, id) {
      state.selection = { kind: kind || null, id: id || null };
    }

    function setControlSpecs(specifications) {
      state.controls.specs = Array.isArray(specifications) ? specifications.slice() : [];
      validateSpecs();
    }

    function addControl(specification) {
      const checked = normalizeControlSpec(specification, state.parsedModel);
      const existingIndex = state.controls.specs.findIndex(function (spec) {
        return spec.id === checked.spec.id || spec.variable === checked.spec.variable;
      });
      const next = Object.assign({}, checked.spec, { valid: checked.valid, errors: checked.errors });
      if (existingIndex >= 0) state.controls.specs.splice(existingIndex, 1, next);
      else state.controls.specs.push(next);
      return next;
    }

    function removeControl(id) {
      state.controls.specs = state.controls.specs.filter(function (specification) {
        return specification.id !== id;
      });
    }

    function setVisualizationSpecs(specifications) {
      state.visualization.specs = Array.isArray(specifications)
        ? specifications.map(function (specification) { return normalizeVisualizationSpec(specification); })
        : [];
      validateSpecs();
    }

    function getShareState() {
      return {
        notebook: { source: state.notebook.source },
        visualizations: state.visualization.specs.map(function (specification) {
          const copy = Object.assign({}, specification);
          delete copy.valid;
          delete copy.missing;
          delete copy.error;
          return copy;
        }),
        controls: state.controls.specs.map(function (specification) {
          const copy = Object.assign({}, specification);
          delete copy.valid;
          delete copy.errors;
          return copy;
        }),
        layout: state.share.layout,
        locale: state.share.locale,
        metadata: state.share.metadata,
      };
    }

    function setShareOptions(options) {
      const next = options && typeof options === 'object' ? options : {};
      ['layout', 'locale', 'metadata'].forEach(function (key) {
        if (next[key] && typeof next[key] === 'object') {
          state.share[key] = Object.assign({}, state.share[key], next[key]);
        }
      });
    }

    function hydrate(shareState) {
      const shared = shareState && typeof shareState === 'object' ? shareState : {};
      state.visualization.specs = Array.isArray(shared.visualizations) ? shared.visualizations.slice() : [];
      state.controls.specs = Array.isArray(shared.controls) ? shared.controls.slice() : [];
      state.share = {
        layout: shared.layout && typeof shared.layout === 'object' ? shared.layout : {},
        locale: shared.locale && typeof shared.locale === 'object' ? shared.locale : {},
        metadata: shared.metadata && typeof shared.metadata === 'object' ? shared.metadata : {},
      };
      if (shared.notebook && typeof shared.notebook.source === 'string') setNotebook(shared.notebook.source);
      else validateSpecs();
    }

    return {
      getState: cloneState,
      setNotebook: setNotebook,
      commitEvaluation: commitEvaluation,
      select: select,
      setControlSpecs: setControlSpecs,
      addControl: addControl,
      removeControl: removeControl,
      setVisualizationSpecs: setVisualizationSpecs,
      getShareState: getShareState,
      setShareOptions: setShareOptions,
      hydrate: hydrate,
    };
  }

  return {
    SHARE_PREFIX: SHARE_PREFIX,
    SHARE_VERSION: SHARE_VERSION,
    createRuntime: createRuntime,
    parseNotebook: parseNotebook,
    getDependencyContext: getDependencyContext,
    normalizeTable: normalizeTable,
    tableToRows: tableToRows,
    tableToCsv: tableToCsv,
    tableToJson: tableToJson,
    normalizeControlSpec: normalizeControlSpec,
    normalizeVisualizationSpec: normalizeVisualizationSpec,
    validateVisualizationSpec: validateVisualizationSpec,
    deriveVisualizationData: deriveVisualizationData,
    replaceAssignmentValue: replaceAssignmentValue,
    serializeShareState: serializeShareState,
    deserializeShareState: deserializeShareState,
  };
});
