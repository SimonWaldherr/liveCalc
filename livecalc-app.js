const app = (() => {
  // -- DOM Elements --
  const editor = document.getElementById("editor");
  const backdrop = document.getElementById("backdrop");
  const lineNumbers = document.getElementById("lineNumbers");
  const variablesList = document.getElementById("variablesList");
  const varCount = document.getElementById("varCount");
  const plotContainer = document.getElementById("plot");
  const sidebar = document.getElementById("sidebar");
  const gridLayout = document.querySelector(".grid-layout");

  const DESKTOP_SIDEBAR_MEDIA = "(min-width: 1024px)";

  // -- Configuration --
  let isDark = localStorage.getItem("theme") === "dark" || (!("theme" in localStorage) && window.matchMedia("(prefers-color-scheme: dark)").matches);
  // Small HTML-escape helper used by highlight/preview rendering
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Synchronize scroll positions between the textarea, backdrop and line numbers
  function syncScroll() {
    try {
      const st = editor.scrollTop;
      // backdrop and lineNumbers are block elements; keep their scrollTop in sync
      if (backdrop) backdrop.scrollTop = st;
      if (lineNumbers) lineNumbers.scrollTop = st;
    } catch (e) {
      // non-fatal
    }
  }

  // Keyboard handling for editor (supports Tab indenting and Shift-Tab unindent)
  function handleKeydown(e) {
    try {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const val = editor.value;
        // Multiline selection indent/unindent
        if (start !== end) {
          const selected = val.slice(start, end);
          if (e.shiftKey) {
            // remove one leading tab or two spaces from each selected line
            const replaced = selected.replace(/^\t|^ {2}/gm, '');
            editor.value = val.slice(0, start) + replaced + val.slice(end);
            editor.selectionStart = start;
            editor.selectionEnd = start + replaced.length;
          } else {
            const replaced = selected.replace(/^/gm, '\t');
            editor.value = val.slice(0, start) + replaced + val.slice(end);
            editor.selectionStart = start;
            editor.selectionEnd = start + replaced.length;
          }
        } else {
          // single caret: insert a tab
          const insert = '\t';
          editor.value = val.slice(0, start) + insert + val.slice(end);
          editor.selectionStart = editor.selectionEnd = start + insert.length;
        }
        // Trigger update
        handleInput();
      }
    } catch (err) {
      // swallow
    }
  }

    

  // MathJS config
  math.config({
    // math.js 11.8.0 has a bug with unit arithmetic in BigNumber mode
    // (for example `radius = 5 cm` followed by `radius^2`).
    number: "number",
    precision: 64,
  });

  // ------------------------------------------------------------------
  // Define common currency units as simple base units so expressions
  // like `10000 USD` parse correctly. These are dimensionless units
  // for formatting/summing purposes.
  // Also provide a small FX table (rates expressed as USD per unit)
  // and helper to normalize currency symbols (€, $, £ etc.).
  // ------------------------------------------------------------------
  // Use centralized conversions if provided (loaded from conversions.js)
  const _LC = (typeof window !== 'undefined' && window.LC_CONVERSIONS) ? window.LC_CONVERSIONS : null;
  const fxRates = _LC && _LC.fxRates ? Object.assign({}, _LC.fxRates) : { USD: 1.0, EUR: 1.08, GBP: 1.25, JPY: 0.0072, CHF: 1.09 };
  const currencyUnits = new Set((_LC && Array.isArray(_LC.currencyUnits)) ? _LC.currencyUnits : ["USD","EUR","GBP","JPY","CHF"]);

  // Ensure currency unit names are present in math.js as simple units
  try {
    Array.from(currencyUnits).forEach((c) => {
      try { math.createUnit(c); } catch (e) { /* ignore if present */ }
    });
  } catch (e) {}

  // Register a set of common units and synonyms to improve conversion coverage
  function registerCommonUnits() {
    const units = (_LC && Array.isArray(_LC.commonUnits)) ? _LC.commonUnits : [
      ['mm', '0.001 m'],['cm', '0.01 m'],['dm', '0.1 m'],['m', '1 m'],['km', '1000 m'],
      ['mg', '1e-6 kg'],['g', '0.001 kg'],['kg', '1 kg'],['t', '1000 kg'],
      ['ml', '1e-6 m^3'],['l', '0.001 m^3'],['L', '0.001 m^3'],
      ['cm2', '0.0001 m^2'],['m2', '1 m^2'],['cm3', '1e-6 m^3'],['m3', '1 m^3'],
      ['s', '1 s'],['sec', '1 s'],['min', '60 s'],['h', '3600 s'],
      ['in', '0.0254 m'],['ft', '0.3048 m'],['yd', '0.9144 m'],['mi', '1609.344 m'],
      ['oz', '0.028349523125 kg'],['lb', '0.45359237 kg'],['atm', '101325 Pa'],['bar','100000 Pa'],['percent','0.01']
      ['sec', '1 s'],
      ['percent', '0.01'],
      ['L', '1 l']
    ];

    function unitExists(name) {
      try {
        math.evaluate('1 ' + name);
        return true;
      } catch (e) {
        return false;
      }
    }

    units.forEach(([name, def]) => {
      try {
        if (!math.unit || !math.createUnit) return;
        if (!unitExists(name)) {
          math.createUnit(name, def);
        }
      } catch (e) {
        try { math.createUnit(name, def); } catch (e2) {}
      }
    });
  }
  try { registerCommonUnits(); } catch (e) {}

  // ------------------------------------------------------------------
  // Data / Dataset support
  // - `datasets` stores uploaded/parsing results as arrays of objects
  // - datasets are injected into each math parser instance so users can
  //   reference them by name in expressions or use the simple query syntax
  // ------------------------------------------------------------------
  const datasets = {};
  const datasetMeta = {};
  let lastPreviewedDataset = null;
  let activeExternalDatasetLoad = null;

  const EXTERNAL_CACHE_PREFIX = 'livecalc:externalDataset:v1:';
  const DEFAULT_EXTERNAL_CACHE_MINUTES = 30;
  const DEFAULT_EXTERNAL_TIMEOUT_MS = 12000;
  const MAX_EXTERNAL_CACHE_MINUTES = 7 * 24 * 60;
  const MAX_EXTERNAL_TIMEOUT_MS = 60000;

  // -- Settings (persisted) --
  const SETTINGS_KEY = 'livecalc:v9:settings';
  // Number of significant digits to show when no decimal input is detected (auto mode).
  const AUTO_DEFAULT_PRECISION = 6;
  // Maximum allowed value for the roundDecimals setting.
  const MAX_DECIMAL_PLACES = 20;
  const defaultSettings = {
    roundDecimals: null, // null = auto-detect from input; number = fixed decimal places
    colorScheme: 'default', // options: default, warm, midnight, solarized, ocean, monochrome
    font: "'Fira Code', 'Menlo', 'Monaco', monospace",
    decimalSeparator: '.', // options: "." or ","
    csvDelimiter: 'auto', // options: auto, comma, semicolon, tab, pipe
    externalCacheMinutes: DEFAULT_EXTERNAL_CACHE_MINUTES,
    externalRequestTimeoutMs: DEFAULT_EXTERNAL_TIMEOUT_MS,
    accessibility: {
      largeText: false,
      highContrast: false
    }
  };
  let settings = loadSettings();

  // Prevent updateHash from overwriting an incoming shared hash during initial load.
  let suppressHashUpdate = false;

  // Cache for auto-detected decimal places (updated on every handleInput call)
  let _autoDecimalPlaces = null;

  // Detect the maximum number of decimal places used in any literal number in the code.
  // Returns null if no decimal numbers are found (fall back to smart formatting).
  function detectInputDecimalPlaces(code) {
    const matches = code.match(/\b\d+[.,](\d+)\b/g);
    if (!matches || matches.length === 0) return null;
    let maxPlaces = 0;
    for (const m of matches) {
      const sep = m.indexOf(',') >= 0 ? ',' : '.';
      const parts = m.split(sep);
      const dec = parts[1] || '';
      // Strip trailing zeros: 1.50 counts as 1 significant decimal place
      const significant = dec.replace(/0+$/, '');
      if (significant.length > maxPlaces) maxPlaces = significant.length;
    }
    return maxPlaces > 0 ? maxPlaces : 0;
  }

  // Example snippets available to load into the editor
  const examples = [
    { id: 'geometry', title: 'Geometry — Circle Area', desc: 'radius = 5 cm\narea = pi * radius^2\nperimeter = 2 * pi * radius', content: `# Geometry example\nradius = 5 cm\narea = pi * radius^2\nperimeter = 2 * pi * radius` },
    { id: 'finance', title: 'Finance — Compound Interest', desc: 'P = 10000 USD\nr = 0.05\nt = 10\nA = P * (1 + r)^t', content: `# Compound Interest example\nP = 10000 USD\nr = 0.05\nt = 10\nA = P * (1 + r)^t` },
    { id: 'sum', title: 'Sum — Mixed Units', desc: 'val1 = 10 m\nval2 = 20 cm\nsum', content: `# Sum example\nval1 = 10 m\nval2 = 20 cm\nval3 = 50 cm\nsum` },
    { id: 'table', title: 'Table — CSV import & query', desc: 'Instructions for using demo dataset', content: `# Table demo\n# Upload a CSV (or use demo.csv). After import try:\n# sum price from demo where qty > 2\n# count order_id from demo where region == 'North'` },
    { id: 'dataplot', title: 'Data Plot — avg price per region', desc: 'Example for data-driven plotting', content: `# Data Plot demo\n# Import 'demo.csv' (provided) or your own dataset named 'demo'.\n# Use query() to compute aggregates inside expressions.\navgPriceNorth = query('demo', 'avg price where region == "North"')\nf(x) = avgPriceNorth + sin(x)` },
    { id: 'conv_all', title: 'Conversions — Mixed examples', desc: 'Collection of common conversions (weight, pressure, area, volume, force, mass, temperature, currency)', content: `# Conversions example\n# Weight\n30 lb in kg\n\n# Pressure\n14.7 psi in bar\n\n# Area\n200 in^2 in cm^2\n\n# Volume\n1 gal in L\n\n# Force\n10 lbf in N\n\n# Mass (imperial)\n1 slug in kg\n\n# Temperature (F <-> C)\n# If your environment doesn't have F/C units defined, a manual formula is provided below\n100 F in C\n# Manual (formula) alternative:\n(100 - 32) * 5/9\n\n# Currency\n100 EUR in USD\n\n# Mixed units and sum\na = 20 cm\nb = 0.5 m\nc = 3 in\n# list values then an explicit 'sum' line to show block sum\na\nb\nc\nsum\n# Convert sum to m\nsum in m` }
  ];

  function normalizeSettings(input) {
    const merged = Object.assign({}, defaultSettings, input || {});
    merged.accessibility = Object.assign(
      {},
      defaultSettings.accessibility,
      (input && input.accessibility) || {}
    );
    merged.decimalSeparator = merged.decimalSeparator === ',' ? ',' : '.';
    const allowedDelims = new Set(['auto', 'comma', 'semicolon', 'tab', 'pipe']);
    merged.csvDelimiter = allowedDelims.has(merged.csvDelimiter) ? merged.csvDelimiter : 'auto';
    const cacheMins = Number(merged.externalCacheMinutes);
    merged.externalCacheMinutes = Number.isFinite(cacheMins)
      ? Math.max(0, Math.min(MAX_EXTERNAL_CACHE_MINUTES, Math.round(cacheMins)))
      : DEFAULT_EXTERNAL_CACHE_MINUTES;
    const timeout = Number(merged.externalRequestTimeoutMs);
    merged.externalRequestTimeoutMs = Number.isFinite(timeout)
      ? Math.max(1000, Math.min(MAX_EXTERNAL_TIMEOUT_MS, Math.round(timeout)))
      : DEFAULT_EXTERNAL_TIMEOUT_MS;
    return merged;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return normalizeSettings(defaultSettings);
      const parsed = JSON.parse(raw);
      return normalizeSettings(parsed);
    } catch (e) {
      return normalizeSettings(defaultSettings);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  let _schemeStyleEl = null;
  function applySettings() {
    // Apply font to editor/backdrop layers
    try {
      const els = document.querySelectorAll('.editor-font');
      els.forEach((el) => {
        el.style.fontFamily = settings.font;
      });
      const editorEl = document.getElementById('editor');
      if (editorEl) editorEl.style.fontFamily = settings.font;
    } catch (e) {}

    // Apply color scheme by injecting CSS variables and a small style block
    try {
      if (_schemeStyleEl) _schemeStyleEl.remove();
      _schemeStyleEl = document.createElement('style');
      _schemeStyleEl.id = 'livecalc-scheme-style';
      const palettes = {
        default: ['#2563eb', '#10b981', '#ec4899', '#64748b', '#8b5cf6'],
        warm: ['#c2410c', '#b45309', '#92400e', '#78350f', '#4b2e05'],
        midnight: ['#0ea5e9', '#7c3aed', '#60a5fa', '#94a3b8', '#111827'],
        solarized: ['#268bd2', '#2aa198', '#b58900', '#cb4b16', '#6c71c4'],
        ocean: ['#2b6cb0', '#38b2ac', '#2c7a7b', '#2a4365', '#81e6d9'],
        monochrome: ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db']
      };
      const p = palettes[settings.colorScheme] || palettes.default;
      // set CSS variables for use in UI or for palette preview
      let css = `:root { --lc-accent: ${p[0]}; --lc-accent-2: ${p[1]}; --lc-muted: ${p[3]}; }
        .token-keyword { color: ${p[2]} !important; }
        .token-number { color: ${p[0]} !important; }
        .token-result { color: ${p[1]} !important; }
      `;
      // high-contrast overrides handled elsewhere (class toggle)
      _schemeStyleEl.textContent = css;
      document.head.appendChild(_schemeStyleEl);
    } catch (e) {}

    // Accessibility: large text and high contrast
    try {
      const html = document.documentElement;
      if (settings.accessibility && settings.accessibility.largeText) {
        // scale the entire page for larger text to ensure all UI elements enlarge
        try { document.body.style.zoom = '1.3'; } catch (e) {
          // fallback: increase editor/backdrop font sizes
          const editorEl = document.getElementById('editor');
          const backEls = document.querySelectorAll('.editor-font');
          if (editorEl) editorEl.style.fontSize = '17px';
          backEls.forEach((el) => (el.style.fontSize = '17px'));
        }
      } else {
        try { document.body.style.zoom = ''; } catch (e) {
          const editorEl = document.getElementById('editor');
          const backEls = document.querySelectorAll('.editor-font');
          if (editorEl) editorEl.style.fontSize = '';
          backEls.forEach((el) => (el.style.fontSize = ''));
        }
      }

      if (settings.accessibility && settings.accessibility.highContrast) {
        html.classList.add('lc-high-contrast');
      } else {
        html.classList.remove('lc-high-contrast');
      }
    } catch (e) {}

    saveSettings();
    // re-render to pick up font/format changes
    try { handleInput(); } catch (e) {}
    try {
      if (lastPreviewedDataset) {
        const rowsSelect = document.getElementById('previewRowsSelect');
        renderDatasetPreview(lastPreviewedDataset, rowsSelect ? rowsSelect.value : 10);
      }
    } catch (e) {}
  }

  function setSettings(next) {
    const merged = Object.assign({}, settings, next || {});
    if (next && next.accessibility) {
      merged.accessibility = Object.assign({}, settings.accessibility || {}, next.accessibility);
    }
    settings = normalizeSettings(merged);
    applySettings();
    return settings;
  }

  function getSettings() {
    return JSON.parse(JSON.stringify(settings));
  }

  function cleanDatasetName(name) {
    return String(name || '')
      .trim()
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^_+/, '')
      || 'dataset';
  }

  function uniqueDatasetName(base) {
    const root = cleanDatasetName(base);
    let attempt = root;
    let i = 1;
    while (datasets[attempt]) {
      attempt = root + '_' + (i++);
    }
    return attempt;
  }

  function inferDatasetNameFromUrl(url) {
    try {
      const u = new URL(url);
      const seg = (u.pathname.split('/').pop() || 'dataset').replace(/\.[^/.]+$/, '');
      return cleanDatasetName(seg || 'dataset');
    } catch (e) {
      return 'dataset';
    }
  }

  function getDatasetColumns(data) {
    if (!Array.isArray(data) || data.length === 0) return 0;
    const first = data[0];
    return first && typeof first === 'object' ? Object.keys(first).length : 0;
  }

  function setDatasetStatus(text, level = 'info') {
    const statusEl = document.getElementById('datasetStatus');
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'text-[10px] mt-1';
    if (level === 'error') {
      statusEl.classList.add('text-red-500');
    } else if (level === 'success') {
      statusEl.classList.add('text-green-600', 'dark:text-green-400');
    } else if (level === 'muted') {
      statusEl.classList.add('text-gray-400');
    } else {
      statusEl.classList.add('text-blue-600', 'dark:text-blue-400');
    }
  }

  function mapDelimiterSetting(choice) {
    if (choice === 'comma') return ',';
    if (choice === 'semicolon') return ';';
    if (choice === 'tab') return '\t';
    if (choice === 'pipe') return '|';
    return 'auto';
  }

  function detectDecimalSeparatorFromValue(raw) {
    const s = String(raw || '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot === -1 && lastComma === -1) return null;
    if (lastDot === -1) return ',';
    if (lastComma === -1) return '.';
    return lastComma > lastDot ? ',' : '.';
  }

  function parseMaybeNumber(value, forcedDecimalSeparator) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    let s = value.trim();
    if (!s) return null;
    s = s.replace(/\u00A0/g, '').replace(/\s+/g, '');
    if (!/[0-9]/.test(s)) return null;
    s = s.replace(/^[^\d+\-]*/, '').replace(/[^\d]*$/, '');
    if (!/^[+\-]?\d[\d.,]*(?:[eE][+\-]?\d+)?$/.test(s)) return null;

    const decimal = forcedDecimalSeparator || detectDecimalSeparatorFromValue(s);
    if (decimal === ',') {
      s = s.replace(/\./g, '').replace(/,/g, '.');
    } else {
      s = s.replace(/,/g, '');
    }
    if ((s.match(/\./g) || []).length > 1) return null;
    const num = Number(s);
    return Number.isFinite(num) ? num : null;
  }

  function normalizeDatasetValue(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : v;
    if (typeof v === 'string') {
      const forcedDecimal = settings && settings.decimalSeparator === ',' ? ',' : null;
      const parsed = parseMaybeNumber(v, forcedDecimal);
      return parsed === null ? v.trim() : parsed;
    }
    return v;
  }

  function normalizeDatasetRows(data) {
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((row) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const out = {};
        Object.keys(row).forEach((k) => {
          out[k] = normalizeDatasetValue(row[k]);
        });
        return out;
      }
      if (Array.isArray(row)) {
        const out = {};
        row.forEach((val, idx) => {
          out['col' + (idx + 1)] = normalizeDatasetValue(val);
        });
        return out;
      }
      return { value: normalizeDatasetValue(row) };
    });
  }

  function registerDataset(name, data, meta = {}) {
    if (!name) return false;
    const safeName = cleanDatasetName(name);
    const normalized = normalizeDatasetRows(data);
    datasets[safeName] = normalized;
    datasetMeta[safeName] = Object.assign(
      {
        sourceType: 'memory',
        source: '',
        format: 'unknown',
        loadedAt: Date.now(),
        rows: normalized.length,
        columns: getDatasetColumns(normalized),
        cached: false
      },
      meta || {},
      { rows: normalized.length, columns: getDatasetColumns(normalized), loadedAt: Date.now() }
    );
    // trigger a re-evaluation so new dataset is available
    try {
      handleInput();
    } catch (e) {}
    // Update dataset list and auto-open preview for convenience
    try {
      if (typeof renderDatasetList === 'function') renderDatasetList();
      if (typeof renderDatasetPreview === 'function') {
        renderDatasetPreview(safeName, 10);
      }
      try { localStorage.setItem('livecalc:lastDataset', safeName); } catch (e) {}
    } catch (e) {}
    return true;
  }

  function deleteDataset(name) {
    if (!name || !datasets[name]) return false;
    delete datasets[name];
    delete datasetMeta[name];
    if (lastPreviewedDataset === name) {
      lastPreviewedDataset = null;
      clearDatasetPreview();
    }
    try {
      handleInput();
      renderDatasetList();
    } catch (e) {}
    setDatasetStatus('Dataset "' + name + '" deleted', 'muted');
    return true;
  }

  function detectDelimiter(text) {
    const sampleLines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 15);
    if (sampleLines.length === 0) return ',';
    const candidates = [',', ';', '\t', '|'];

    function countOutsideQuotes(line, delim) {
      let count = 0;
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          const escapedQuote = inQuotes && line[i + 1] === '"';
          if (escapedQuote) {
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (!inQuotes && ch === delim) {
          count += 1;
        }
      }
      return count;
    }

    let best = { delim: ',', score: -1 };
    candidates.forEach((cand) => {
      const counts = sampleLines.map((ln) => countOutsideQuotes(ln, cand));
      const positive = counts.filter((n) => n > 0);
      if (positive.length === 0) return;
      const avg = positive.reduce((a, b) => a + b, 0) / positive.length;
      const consistencyPenalty = counts.reduce((acc, n) => acc + Math.abs(n - avg), 0) / counts.length;
      const score = avg - consistencyPenalty;
      if (score > best.score) best = { delim: cand, score };
    });
    return best.delim;
  }

  function parseDelimitedRows(text, delim) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i += 1;
        continue;
      }
      if (!inQuotes && ch === delim) {
        row.push(field);
        field = '';
        i += 1;
        continue;
      }
      if (!inQuotes && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }
    row.push(field);
    rows.push(row);
    return rows.filter((r) => r.some((cell) => String(cell || '').trim() !== ''));
  }

  function parseCSV(text, delim = 'auto') {
    const resolvedDelim = delim === 'auto' ? detectDelimiter(text) : delim;
    const rows = parseDelimitedRows(String(text || ''), resolvedDelim);
    if (rows.length === 0) return [];
    const headers = rows[0].map((h, idx) => {
      const clean = String(h || '').trim();
      return clean || ('col' + (idx + 1));
    });
    const body = rows.slice(1).map((parts) => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const raw = parts[i] === undefined ? '' : String(parts[i]).trim();
        const forcedDecimal = settings && settings.decimalSeparator === ',' ? ',' : null;
        const num = parseMaybeNumber(raw, forcedDecimal);
        obj[headers[i]] = raw === '' ? '' : (num === null ? raw : num);
      }
      return obj;
    });
    return body;
  }

  function parseXML(text) {
    try {
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      const root = doc.documentElement;
      if (!root) return [];
      const parserErr = doc.querySelector('parsererror');
      if (parserErr) return [];

      const counts = {};
      for (let i = 0; i < root.children.length; i++) {
        const n = root.children[i].nodeName;
        counts[n] = (counts[n] || 0) + 1;
      }
      let repeated = null;
      for (const k in counts) {
        if (counts[k] > 1) {
          repeated = k;
          break;
        }
      }
      const arr = [];
      if (repeated) {
        const elems = root.getElementsByTagName(repeated);
        for (let i = 0; i < elems.length; i++) {
          const e = elems[i];
          const obj = {};
          for (let j = 0; j < e.children.length; j++) {
            const c = e.children[j];
            obj[c.nodeName] = normalizeDatasetValue(c.textContent.trim());
          }
          arr.push(obj);
        }
      } else {
        const obj = {};
        for (let j = 0; j < root.children.length; j++) {
          const c = root.children[j];
          obj[c.nodeName] = normalizeDatasetValue(c.textContent.trim());
        }
        return [obj];
      }
      return arr;
    } catch (e) {
      return [];
    }
  }

  function detectFormat(nameOrUrl, contentType) {
    const target = String(nameOrUrl || '').toLowerCase();
    const type = String(contentType || '').toLowerCase();
    if (target.endsWith('.json') || type.includes('application/json')) return 'json';
    if (target.endsWith('.xml') || type.includes('application/xml') || type.includes('text/xml')) return 'xml';
    if (target.endsWith('.tsv') || type.includes('text/tab-separated-values')) return 'tsv';
    if (target.endsWith('.csv') || type.includes('text/csv')) return 'csv';
    return 'auto';
  }

  function parseDatasetPayload(text, formatHint = 'auto') {
    const hint = (formatHint || 'auto').toLowerCase();
    let data = [];
    let format = hint;
    if (hint === 'json') {
      data = JSON.parse(text);
    } else if (hint === 'xml') {
      data = parseXML(text);
    } else if (hint === 'tsv') {
      data = parseCSV(text, '\t');
      format = 'tsv';
    } else if (hint === 'csv') {
      data = parseCSV(text, mapDelimiterSetting(settings.csvDelimiter));
      format = 'csv';
    } else {
      try {
        data = JSON.parse(text);
        format = 'json';
      } catch (e) {
        const maybeXml = String(text || '').trim();
        if (maybeXml.startsWith('<')) {
          data = parseXML(text);
          format = 'xml';
        } else {
          const autoDelim = mapDelimiterSetting(settings.csvDelimiter);
          data = parseCSV(text, autoDelim);
          format = autoDelim === '\t' ? 'tsv' : 'csv';
        }
      }
    }
    const normalized = normalizeDatasetRows(data);
    if (
      format === 'json' &&
      data &&
      typeof data === 'object' &&
      !Array.isArray(data)
    ) {
      const firstArrayKey = Object.keys(data).find((k) => Array.isArray(data[k]));
      if (firstArrayKey) {
        return { data: normalizeDatasetRows(data[firstArrayKey]), format };
      }
    }
    return { data: normalized, format };
  }

  function getExternalCacheKey(url) {
    return EXTERNAL_CACHE_PREFIX + encodeURIComponent(url);
  }

  function readExternalDatasetCache(url) {
    const ttlMinutes = Number(settings.externalCacheMinutes) || 0;
    if (ttlMinutes <= 0) return null;
    try {
      const raw = localStorage.getItem(getExternalCacheKey(url));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.text || !parsed.savedAt) return null;
      const ageMs = Date.now() - Number(parsed.savedAt);
      if (ageMs > ttlMinutes * 60 * 1000) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeExternalDatasetCache(url, payload) {
    const ttlMinutes = Number(settings.externalCacheMinutes) || 0;
    if (ttlMinutes <= 0) return;
    try {
      localStorage.setItem(
        getExternalCacheKey(url),
        JSON.stringify({
          text: payload.text,
          contentType: payload.contentType || '',
          formatHint: payload.formatHint || 'auto',
          savedAt: Date.now()
        })
      );
    } catch (e) {}
  }

  async function importDatasetFromUrl(inputUrl, explicitName) {
    const trimmed = String(inputUrl || '').trim();
    if (!trimmed) throw new Error('Please enter a dataset URL');
    let url;
    try {
      url = new URL(trimmed, window.location.href).href;
    } catch (e) {
      throw new Error('Invalid URL');
    }

    const cached = readExternalDatasetCache(url);
    if (cached) {
      const cachedParsed = parseDatasetPayload(cached.text, cached.formatHint || detectFormat(url, cached.contentType));
      const cachedName = uniqueDatasetName(explicitName || inferDatasetNameFromUrl(url));
      registerDataset(cachedName, cachedParsed.data, {
        sourceType: 'url',
        source: url,
        format: cachedParsed.format,
        cached: true
      });
      return { datasetName: cachedName, rows: cachedParsed.data.length, format: cachedParsed.format, cached: true };
    }

    if (activeExternalDatasetLoad && activeExternalDatasetLoad.controller) {
      activeExternalDatasetLoad.controller.abort();
    }
    const controller = new AbortController();
    activeExternalDatasetLoad = { controller, url };

    const timeoutMs = Number(settings.externalRequestTimeoutMs) || DEFAULT_EXTERNAL_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store' });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Request timed out');
      throw new Error('Failed to fetch URL');
    } finally {
      clearTimeout(timeoutId);
      activeExternalDatasetLoad = null;
    }

    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' while loading dataset');
    }

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    const formatHint = detectFormat(url, contentType);
    const parsed = parseDatasetPayload(text, formatHint);
    writeExternalDatasetCache(url, { text, contentType, formatHint });
    const dsName = uniqueDatasetName(explicitName || inferDatasetNameFromUrl(url));
    registerDataset(dsName, parsed.data, {
      sourceType: 'url',
      source: url,
      format: parsed.format,
      cached: false
    });
    return { datasetName: dsName, rows: parsed.data.length, format: parsed.format, cached: false };
  }

  // Simple query engine: supports queries like
  // sum price from sales where qty > 10
  // avg value from dataset where col == 'x'
  function runSimpleQuery(op, col, datasetName, whereExpr) {
    const data = datasets[datasetName];
    if (!data || !Array.isArray(data)) throw new Error("Dataset not found: " + datasetName);
    let rows = data;
    if (whereExpr) {
      // very small sandbox: create a function with r in scope
      try {
        const normalizedWhere = normalizeDecimalInput(whereExpr);
        const fn = new Function('r', 'with(r){ return (' + normalizedWhere + '); }');
        rows = rows.filter((r) => {
          try { return !!fn(r); } catch (e) { return false; }
        });
      } catch (e) {
        throw new Error('Invalid where expression');
      }
    }
    if (op === 'count') return rows.length;
    if (!col) throw new Error('No column specified');
    const vals = rows.map((r) => {
      const v = r[col];
      if (typeof v === 'number') return v;
      const forcedDecimal = settings && settings.decimalSeparator === ',' ? ',' : null;
      const parsed = parseMaybeNumber(String(v), forcedDecimal);
      return parsed === null ? NaN : parsed;
    }).filter((v) => isFinite(v));
    if (op === 'sum') return vals.reduce((a, b) => a + b, 0);
    if (op === 'avg') return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    if (op === 'min') return vals.length ? Math.min(...vals) : null;
    if (op === 'max') return vals.length ? Math.max(...vals) : null;
    throw new Error('Unsupported op: ' + op);
  }

  // Explicit query helper usable from inside the editor via parser:
  // query(datasetName, "sum price where qty>10") -> number
  function queryHelper(datasetName, qstring) {
    if (!datasetName) throw new Error('Missing dataset name');
    if (!qstring) throw new Error('Missing query string');
    // allow calling with either (ds, "sum price where ...") or (ds, "sum(price) where ...")
    const m = qstring.match(/^\s*(sum|avg|min|max|count)\s*(?:\(|\s+)?\s*([A-Za-z_][A-Za-z0-9_]*)?\s*(?:\))?\s*(?:where\s+(.+))?$/i);
    if (!m) throw new Error('Invalid query string');
    const op = m[1].toLowerCase();
    const col = m[2];
    const where = m[3];
    return runSimpleQuery(op, col, datasetName, where);
  }

  // Normalize common currency symbols and compact notations to unit names
  function normalizeCurrencySymbols(s) {
    if (!s || typeof s !== "string") return s;
    // Replace euro sign after number: 300€ -> 300 EUR
    s = s.replace(/(\d[\d\.,]*)\s*€/g, "$1 EUR");
    // Replace pound sign after number: 100£ -> 100 GBP
    s = s.replace(/(\d[\d\.,]*)\s*£/g, "$1 GBP");
    // Dollar sign before or after number: $300 or 300$ -> 300 USD
    s = s.replace(/\$(\d[\d\.,]*)/g, "$1 USD");
    s = s.replace(/(\d[\d\.,]*)\s*\$/g, "$1 USD");
    // Yen symbol
    s = s.replace(/(\d[\d\.,]*)\s*¥/g, "$1 JPY");
    // Common abbreviations with no space: 100USD -> 100 USD
    s = s.replace(/(\d)\s*(USD|EUR|GBP|JPY|CHF)\b/gi, function (m, a, b) {
      return a + " " + b.toUpperCase();
    });
    return s;
  }

  function normalizeDecimalInput(line) {
    if (!line || typeof line !== 'string') return line;
    if (!settings || settings.decimalSeparator !== ',') return line;
    if (!/\d,\d/.test(line)) return line;

    // Keep comma-separated function arguments and array literals intact.
    if (/[A-Za-z_][A-Za-z0-9_]*\s*\([^()]*,[^()]*\)/.test(line)) return line;
    if (/\[[^\]]*,[^\]]*\]/.test(line)) return line;

    return line.replace(/(\d),(\d)/g, '$1.$2');
  }

  function localizeNumericText(text) {
    if (!settings || settings.decimalSeparator !== ',') return String(text);
    return String(text).replace(/(-?\d+\.\d+(?:[eE][+-]?\d+)?)/g, (m) => m.replace('.', ','));
  }

  // Initialize section states from localStorage
  function initSectionStates() {
    ['graph', 'variables', 'dataset', 'examples', 'history'].forEach(section => {
      try {
        const state = localStorage.getItem('livecalc:section:' + section);
        const content = document.getElementById(section + 'Content');
        const icon = document.getElementById(section + 'ToggleIcon');
        const header = icon?.closest('.section-header');
        
        if (state === 'collapsed') {
          if (content && icon) {
            content.classList.add('collapsed');
            content.style.maxHeight = '0px';
            icon.textContent = 'expand_more';
            if (header) header.setAttribute('aria-expanded', 'false');
          }
        } else {
          // Ensure expanded state
          if (content && icon) {
            content.classList.remove('collapsed');
            content.style.maxHeight = 'none';
            icon.textContent = 'expand_less';
            if (header) header.setAttribute('aria-expanded', 'true');
          }
        }
      } catch (e) {}
    });
  }

  // Render the examples list in the sidebar
  function renderExamples() {
    const list = document.getElementById('examplesList');
    if (!list) return;
    if (!examples || examples.length === 0) {
      list.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">No examples available</div>';
      return;
    }
    list.innerHTML = examples.map(ex => `
      <div class="flex items-start justify-between gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        <div class="flex-1">
          <div class="text-xs font-semibold text-gray-700 dark:text-gray-200">${escapeHtml(ex.title)}</div>
          <div class="text-[10px] text-gray-400 mt-1">${escapeHtml(ex.desc)}</div>
        </div>
        <div class="flex flex-col gap-1">
          <button onclick="(function(id){ if(window.app && window.app.loadExample) window.app.loadExample(id); })('${ex.id}')" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Load</button>
          <button onclick="(function(id){ if(window.app && window.app.insertExampleToEditor) window.app.insertExampleToEditor(id); })('${ex.id}')" class="text-[10px] bg-gray-50 text-gray-700 px-2 py-0.5 rounded">Insert</button>
        </div>
      </div>
    `).join('');
  }

  function loadExample(id) {
    const ex = examples.find(e => e.id === id);
    if (!ex) { showToast('Example not found'); return; }
    editor.value = ex.content;
    handleInput();
    showToast('Loaded example: ' + ex.title);
  }

  function insertExampleToEditor(id) {
    const ex = examples.find(e => e.id === id);
    if (!ex) { showToast('Example not found'); return; }
    insert('\n' + ex.content + '\n');
    showToast('Inserted example: ' + ex.title);
  }

  // Try several heuristics to decode a base64 hash into UTF-8 text.
  function tryDecodeHash(hash) {
    if (!hash) return '';
    const candidates = [hash];
    try { candidates.push(decodeURIComponent(hash)); } catch (e) {}
    for (const c of candidates) {
      if (!c) continue;
      try {
        // common approach: atob then percent-encode bytes -> decodeURIComponent
        const bin = window.atob(c);
        let esc = '';
        for (let i = 0; i < bin.length; i++) {
          const code = bin.charCodeAt(i).toString(16).toUpperCase();
          esc += '%' + ('00' + code).slice(-2);
        }
        const decoded = decodeURIComponent(esc);
        if (decoded && decoded.trim()) {
          // if decoded looks like another base64 blob, try one more decode
          const maybeB64 = decoded.replace(/\s+/g, '');
          if (/^[A-Za-z0-9+/=]+$/.test(maybeB64) && maybeB64.length > 40) {
            try {
              const bin2 = window.atob(maybeB64);
              let esc2 = '';
              for (let j = 0; j < bin2.length; j++) esc2 += '%' + ('00' + bin2.charCodeAt(j).toString(16)).slice(-2);
              const decoded2 = decodeURIComponent(esc2);
              if (decoded2 && decoded2.trim()) return decoded2;
            } catch (e) {
              // fall back to first decode
              return decoded;
            }
          }
          return decoded;
        }
      } catch (e) {
        // ignore and try next
      }
      try {
        // fallback: maybe it's a percent-encoded base64 of the text
        const uri = decodeURIComponent(c);
        const bin2 = window.atob(uri);
        let esc2 = '';
        for (let i = 0; i < bin2.length; i++) esc2 += '%' + ('00' + bin2.charCodeAt(i).toString(16)).slice(-2);
        const decoded2 = decodeURIComponent(esc2);
        if (decoded2 && decoded2.trim()) return decoded2;
      } catch (e) {}
    }
    return '';
  }

  // Robust base64 <-> UTF8 helpers
  function utf8_to_b64(str) {
    try {
      return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
        return String.fromCharCode('0x' + p1);
      }));
    } catch (e) {
      try { return btoa(unescape(encodeURIComponent(str))); } catch (e2) { return ''; }
    }
  }

  function b64_to_utf8(b64) {
    try {
      return decodeURIComponent(Array.prototype.map.call(atob(b64), function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    } catch (e) {
      try { return decodeURIComponent(escape(atob(b64))); } catch (e2) { return ''; }
    }
  }

  // -- Initialization --
  function init() {
    // Suppress hash updates during the entire init phase so that applyTheme/applySettings
    // cannot accidentally clear an incoming shared hash before the editor is populated.
    suppressHashUpdate = true;

    applyTheme();
    applySettings();
    
    // Load history on init
    renderHistory();
    
    // Initialize section collapse states (defer to next tick to allow DOM to be ready)
    setTimeout(() => {
      initSectionStates();
    }, 0);

    // Load content
    // Prefer pre-decoded value if page injected it early
    const preshared = window.__livecalc_shared;
    if (preshared && preshared.length > 0) {
      editor.value = preshared;
    } else {
      const hash = window.location.hash.substring(1);
      if (hash.length > 0) {
        try {
          const decoded = tryDecodeHash(hash) || '';
          if (decoded) {
            editor.value = decoded;
          } else {
            // last attempt using legacy helper
            try { editor.value = b64_to_utf8(hash); } catch (e) { console.error('hash decode failed', e); }
          }
        } catch (e) {
          console.error(e);
        }
      } else {
        
      }
    }
      // Default welcome text (only if editor is still empty after loading)
      if (!editor.value || editor.value.trim() === '') {
        editor.value = `# Welcome to LiveCalc Pro!
# Variables, Units, and Functions are supported.

radius = 5 cm
area = pi * radius^2

# Currency & Conversions
price = 12.50
qty = 4
total = price * qty

# Define functions to graph them (look right ->)
f(x) = sin(x) * x
g(x) = x^2 / 10

# Use 'sum' to total previous blocks
sum`;
      }

    // Attach listeners
    editor.addEventListener("input", handleInput);
    editor.addEventListener("scroll", syncScroll);
    editor.addEventListener("keydown", handleKeydown); // For tab support
    window.addEventListener("resize", () => {
      plotFunctions();
    });

    // Data file input handling (upload CSV/TSV/JSON/XML)
    const fileInput = document.getElementById('dataFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = function(e) {
          const text = e.target.result;
          const nameParts = (f.name || 'dataset').split('.');
          const ext = (nameParts.pop() || '').toLowerCase();
          let parsed = { data: [], format: ext || 'auto' };
          try {
            parsed = parseDatasetPayload(text, detectFormat(f.name, f.type));
          } catch (e) {
            showToast('Failed to parse file');
            setDatasetStatus('Could not parse "' + f.name + '"', 'error');
            return;
          }
          // ask user for dataset name
          const base = nameParts.join('.') || 'data';
          let dsName = uniqueDatasetName(base);
          // prompt user to rename (non-blocking)
          const custom = prompt('Dataset name', dsName);
          if (custom && custom.trim()) dsName = uniqueDatasetName(custom.trim());
          registerDataset(dsName, parsed.data, {
            sourceType: 'file',
            source: f.name || '',
            format: parsed.format || ext || 'auto',
            cached: false
          });
          showToast('Imported ' + f.name + ' as ' + dsName);
          setDatasetStatus(
            'Loaded "' + dsName + '" (' + parsed.data.length + ' rows, ' + (parsed.format || ext || 'auto').toUpperCase() + ')',
            'success'
          );
          // clear input so same file can be re-selected later
          fileInput.value = '';
        };
        reader.readAsText(f);
      });
    }

      // Dataset list + preview controls wiring
      if (typeof renderDatasetList === 'function') renderDatasetList();
      const datasetSelect = document.getElementById('datasetSelect');
      const previewRowsSelect = document.getElementById('previewRowsSelect');
      if (datasetSelect) {
        // ensure change handled also if renderDatasetList didn't attach
        datasetSelect.addEventListener('change', () => {
          const v = datasetSelect.value;
          try { localStorage.setItem('livecalc:lastDataset', v); } catch (e) {}
          if (v) renderDatasetPreview(v, previewRowsSelect ? previewRowsSelect.value : 10);
        });
      }
      if (previewRowsSelect) previewRowsSelect.addEventListener('change', () => {
        const v = previewRowsSelect.value;
        const sel = datasetSelect || document.getElementById('datasetSelect');
        const ds = sel ? sel.value : lastPreviewedDataset;
        if (ds) renderDatasetPreview(ds, v);
      });
      const datasetUrlInput = document.getElementById('datasetUrlInput');
      const datasetLoadUrlBtn = document.getElementById('datasetLoadUrlBtn');
      if (datasetUrlInput && datasetLoadUrlBtn) {
        const triggerUrlLoad = async () => {
          const url = datasetUrlInput.value.trim();
          if (!url) {
            setDatasetStatus('Enter a dataset URL first', 'error');
            return;
          }
          datasetLoadUrlBtn.disabled = true;
          datasetLoadUrlBtn.classList.add('opacity-60', 'cursor-not-allowed');
          setDatasetStatus('Loading external dataset...', 'info');
          try {
            const loaded = await importDatasetFromUrl(url);
            const sourceNote = loaded.cached ? 'from cache' : 'from network';
            setDatasetStatus(
              'Loaded "' + loaded.datasetName + '" (' + loaded.rows + ' rows, ' + loaded.format.toUpperCase() + ', ' + sourceNote + ')',
              'success'
            );
            showToast('External dataset loaded: ' + loaded.datasetName);
          } catch (err) {
            setDatasetStatus(err && err.message ? err.message : 'External load failed', 'error');
            showToast('External dataset load failed');
          } finally {
            datasetLoadUrlBtn.disabled = false;
            datasetLoadUrlBtn.classList.remove('opacity-60', 'cursor-not-allowed');
          }
        };
        datasetLoadUrlBtn.addEventListener('click', triggerUrlLoad);
        datasetUrlInput.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            triggerUrlLoad();
          }
        });
      }
      setDatasetStatus('No dataset loaded', 'muted');

      // Render examples list
      try { renderExamples(); } catch (e) {}

      restoreSidebarState();
      window.addEventListener('resize', syncSidebarToggleUi);

    // Initial render (don't update URL during this first pass)
    handleInput();
    // allow subsequent edits to update the hash
    suppressHashUpdate = false;
    // Set the URL hash to the current content if there was none on load (fresh page)
    // so that "Copy Link" immediately gives a shareable URL.
    if (!window.location.hash || window.location.hash === '#') {
      updateHash(editor.value);
    }
  }

  // -- Core Logic --

  function handleInput() {
    // 0. Update auto-detected decimal places from current input
    _autoDecimalPlaces = detectInputDecimalPlaces(editor.value);

    // 1. Evaluate Math
    const results = evalMath(editor.value);

    // 2. Update Backdrop (Syntax Highlight + Results)
    renderBackdrop(editor.value, results);

    // 3. Update Line Numbers
    renderLineNumbers(editor.value);

    // 4. Update Variables Sidebar
    updateVariables(results.scope, results.functions);

    // 5. Update Graph
    plotFunctions(results.functions);

    // 6. Update URL State
    updateHash(editor.value);
  }

  function evalMath(code) {
    const parser = math.parser();
    // inject datasets into parser scope for easy access if user wants to reference them
    try {
      for (const dn of Object.keys(datasets)) {
        parser.set(dn, datasets[dn]);
      }
    } catch (e) {}
    // expose explicit query function in parser scope
    try {
      parser.set('query', function(dsName, q) {
        try { return queryHelper(dsName, q); } catch (e) { throw new Error(e.message); }
      });
    } catch (e) {}
    let lines = code.split("\n");
    // collect function RHS strings (f(x) = expr) so we can pass raw expressions to function-plot
    const functionDefs = {};

    // Pre-process for comma decimals if needed (European support simple check)
    // Note: this breaks function arguments like max(1,2) if not careful.
    // We'll skip aggressive replacement for now to keep functions working.

    let outputLines = [];

    // Accumulators for 'sum'
    let globalSum = math.bignumber(0);
    // blockSum will be either a math.Unit, a BigNumber, or null when empty
    let blockSum = null;
    let blockSumIsUnit = false;
    let blockSumIsCurrency = false;
    let blockSumCurrencyBase = null; // currency code when summing currencies

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const trimmed = line.trim();

      // Skip empty or comments for eval
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
        outputLines.push(null);
        // blank line resets block sum
        if (trimmed === "") {
          blockSum = null;
          blockSumIsUnit = false;
          blockSumIsCurrency = false;
          blockSumCurrencyBase = null;
        }
        continue;
      }

      // Detect function definition like f(x) = expr and capture RHS for plotting
      const fnMatch = trimmed.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*=\s*(.+)$/,
      );
      if (fnMatch) {
        const name = fnMatch[1];
        const expr = fnMatch[3];
        functionDefs[name] = expr.trim();
        try {
          parser.evaluate(normalizeDecimalInput(trimmed)); // register function in scope
          outputLines.push(null);
        } catch (e) {
          outputLines.push({ value: e.message, type: "error" });
        }
        continue;
      }

      // Detect simple assignment where RHS might be a query expression, e.g. `val = sum price from demo where qty>9`
      const assignMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (assignMatch) {
        const varName = assignMatch[1];
        const rhs = assignMatch[2].trim();
        const qMatch2 = rhs.match(/^(sum|avg|min|max|count)\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+where\s+(.+))?$/i);
        if (qMatch2) {
          // run query and assign into parser scope
          try {
            const op = qMatch2[1].toLowerCase();
            const col = qMatch2[2];
            const ds = qMatch2[3];
            const where = qMatch2[4];
            const val = runSimpleQuery(op, col, ds, where);
            // set in parser so subsequent lines can use it
            try { parser.set(varName, val); } catch (e) {}
            outputLines.push({ value: formatResult(val), type: "result" });
          } catch (e) {
            outputLines.push({ value: e.message, type: "error" });
          }
          continue;
        }
        // else fallthrough and let the normal parser evaluate the assignment
      }

      // Prepare processed line (normalize currency symbols etc.)
      const proc = normalizeDecimalInput(normalizeCurrencySymbols(trimmed));

      // Check for 'sum' keyword
      if (/^(total|sum|summe|gesamt)$/i.test(trimmed)) {
        // It's a sum line
        try {
          let display;
          if (blockSum === null) {
            display = formatResult(0);
          } else if (blockSumIsCurrency) {
            display = formatResult(blockSum) + ' ' + (blockSumCurrencyBase || '');
          } else if (blockSumIsUnit) {
            display = formatResult(blockSum);
          } else {
            display = formatResult(blockSum);
          }
          outputLines.push({ value: display, type: "sum" });
        } catch (e) {
          outputLines.push({ value: e.message, type: "error" });
        }
        // Reset block sum
        blockSum = null;
        blockSumIsUnit = false;
        blockSumIsCurrency = false;
        blockSumCurrencyBase = null;
        continue;
      }

      // Check for simple query syntax: op col from dataset [where expr]
      const qMatch = trimmed.match(/^(sum|avg|min|max|count)\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+where\s+(.+))?$/i);
      if (qMatch) {
        const op = qMatch[1].toLowerCase();
        const col = qMatch[2];
        const ds = qMatch[3];
        const where = qMatch[4];
        try {
          const val = runSimpleQuery(op, col, ds, where);
          outputLines.push({ value: formatResult(val), type: 'result' });
        } catch (e) {
          outputLines.push({ value: e.message, type: 'error' });
        }
        continue;
      }

      // Handle conversion syntax:  expr in UNIT (especially for currencies)
      const convMatch = trimmed.match(/^(.+?)\s+in\s+([A-Za-z0-9^_\-]+)$/i);
      if (convMatch) {
        const leftExpr = convMatch[1].trim();
          const rawTarget = convMatch[2].trim();
          // Temperature heuristic: allow converting plain numeric temperatures even if units aren't registered
          const tempMatch = leftExpr.match(/^\s*([+-]?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)\s*(°?F|F|°?C|C|K)\s*$/i);
          if (tempMatch) {
            try {
              const forcedDecimal = settings && settings.decimalSeparator === ',' ? ',' : null;
              const num = parseMaybeNumber(tempMatch[1], forcedDecimal);
              if (num === null) throw new Error('Invalid temperature value');
              const src = tempMatch[2].replace('°', '').toUpperCase();
              const tgt = rawTarget.replace('°', '').toUpperCase();
              let celsius;
              if (src === 'F') celsius = (num - 32) * 5/9;
              else if (src === 'K') celsius = num - 273.15;
              else celsius = num; // already C
              let out;
              if (tgt === 'C') out = celsius;
              else if (tgt === 'F') out = celsius * 9/5 + 32;
              else if (tgt === 'K') out = celsius + 273.15;
              if (typeof out !== 'undefined') {
                outputLines.push({ value: formatResult(out) + ' ' + tgt, type: 'result' });
                continue;
              }
            } catch (e) {
              // fallthrough to normal conversion logic
            }
          }
          // Try sensible target candidates (user may type 'kg', 'KG', 'm^2', etc.)
          const candidates = [rawTarget, rawTarget.toLowerCase(), rawTarget.toUpperCase()];
        try {
          let val;
          try {
            val = parser.evaluate(normalizeDecimalInput(normalizeCurrencySymbols(leftExpr)));
          } catch (e) {
            outputLines.push({ value: 'Failed to evaluate expression: ' + e.message, type: 'error' });
            continue;
          }

          if (!val || !val.isUnit) {
            outputLines.push({ value: 'Cannot convert non-unit value', type: 'error' });
            continue;
          }

          // Determine source unit name
          const srcUnitName = (val.units && val.units[0] && val.units[0].unit && val.units[0].unit.name) || '';

          // Currency special-case: use fxRates if both sides are currencies
          const tryCurrency = (u) => currencyUnits.has(srcUnitName) && currencyUnits.has(u);

          let success = false;
          for (const cand of candidates) {
            try {
              if (tryCurrency(cand.toUpperCase())) {
                const amountNum = val.toNumber(srcUnitName);
                const converted = amountNum * (fxRates[srcUnitName] / (fxRates[cand.toUpperCase()] || 1));
                outputLines.push({ value: formatResult(converted) + ' ' + cand.toUpperCase(), type: 'result' });
                success = true;
                break;
              }

              // try mathjs unit conversion
              let mathConverted = null;
              try {
                mathConverted = val.to(cand);
              } catch (e) {
                // try uppercase/lowercase variations handled by candidates
                mathConverted = null;
              }
              if (mathConverted !== null) {
                outputLines.push({ value: formatResult(mathConverted), type: 'result' });
                success = true;
                break;
              }
            } catch (e) {
              // continue trying other candidates
            }
          }

          if (!success) {
            outputLines.push({ value: 'Conversion failed: incompatible or unknown unit "' + rawTarget + '"', type: 'error' });
          }
        } catch (e) {
          outputLines.push({ value: 'Conversion error: ' + (e && e.message ? e.message : String(e)), type: 'error' });
        }
        continue;
      }

      try {
        // Evaluate (use processed line so symbols like € are replaced)
        let res = parser.evaluate(proc);

        if (res !== undefined && res !== null) {
          // Format result
          let formatted = formatResult(res);
          // Store for display
          outputLines.push({ value: formatted, type: "result" });

          // Update Sums logic
          // Accumulate numbers and units while preserving correct conversions
          try {
            if (res && res.isUnit) {
              const u = (res.units && res.units[0] && res.units[0].unit && res.units[0].unit.name) || null;
              if (u) {
                // Currency handling (use fxRates table)
                if (currencyUnits.has(u)) {
                  const amount = res.toNumber(u);
                  if (blockSum === null) {
                    blockSum = math.bignumber(amount);
                    blockSumIsCurrency = true;
                    blockSumCurrencyBase = u;
                  } else if (blockSumIsCurrency) {
                    // convert incoming to base currency
                    const rSrc = fxRates[u] || 1;
                    const rBase = fxRates[blockSumCurrencyBase] || 1;
                    const converted = math.bignumber(amount).mul(math.bignumber(rSrc)).div(math.bignumber(rBase));
                    blockSum = math.add(blockSum, converted);
                  } else {
                    // incompatible with non-currency block sum, skip
                  }
                } else {
                  // Non-currency units: prefer math.add on Unit objects (mathjs will convert compatible units)
                  if (blockSum === null) {
                    blockSum = res; // store Unit
                    blockSumIsUnit = true;
                  } else if (blockSumIsUnit) {
                    try {
                      blockSum = math.add(blockSum, res);
                    } catch (e) {
                      // incompatible units — skip adding
                    }
                  } else {
                    // blockSum currently numeric, cannot add unit — skip
                  }
                }
              }
            } else if (typeof res === "number" || (res && res.isBigNumber)) {
              // Numeric add
              const num = res && res.isBigNumber ? res : math.bignumber(res);
              if (blockSum === null) {
                blockSum = num;
                blockSumIsUnit = false;
                blockSumIsCurrency = false;
                blockSumCurrencyBase = null;
              } else if (!blockSumIsUnit && !blockSumIsCurrency) {
                blockSum = math.add(blockSum, num);
              } else {
                // cannot sensibly add raw number to a unit or currency block; skip
              }
            }
          } catch (e) {
            /* ignore unit mismatch in sum */
          }
        } else {
          outputLines.push(null); // Valid execution but no output (e.g. assignment)
        }
      } catch (err) {
        outputLines.push({ value: err.message, type: "error" });
      }
    }

    // Extract scope for sidebar
    // parser.getAll() returns all vars
    const scope = parser.getAll();

    // Identify functions vs variables
    const vars = {};
    const funcs = {};

    for (const [key, val] of Object.entries(scope)) {
      if (typeof val === "function" && !isBuiltIn(key)) {
        // Prefer the RHS string we parsed earlier for plotting
        if (functionDefs[key]) {
          funcs[key] = functionDefs[key];
        } else {
          // fallback: skip adding complex function objects to plotting list
        }
      } else if (shouldDisplayScopeValue(key, val)) {
        vars[key] = val;
      }
    }

    return { output: outputLines, scope: vars, functions: funcs };
  }

  function isBuiltIn(name) {
    // Simple check to avoid listing all mathjs built-ins if they leak into scope
    // Usually parser scope is clean.
    return false;
  }

  function renderBackdrop(code, evalData) {
    const lines = code.split("\n");
    // Build DOM fragment to avoid HTML-entity rendering issues for result text
    const frag = document.createDocumentFragment();

    lines.forEach((line, i) => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'line min-h-[1.6em]';

      // 1. Highlight Input Line (safe HTML returned by highlightSyntax)
      const inputSpan = document.createElement('span');
      inputSpan.innerHTML = highlightSyntax(line) || '&nbsp;';
      lineDiv.appendChild(inputSpan);

      // 2. Append Result (if any) using textContent to preserve raw characters
      const res = evalData.output[i];
      if (res) {
        const span = document.createElement('span');
        if (res.type === 'error') {
          span.className = 'text-red-500 text-xs ml-4';
          span.textContent = '⚠️ ' + String(res.value);
        } else if (res.type === 'sum') {
          span.className = 'token-result font-bold text-blue-600 dark:text-blue-400';
          span.textContent = ' = ' + String(res.value);
        } else {
          span.className = 'token-result';
          span.textContent = ' = ' + String(res.value);
        }
        lineDiv.appendChild(span);
      }

      frag.appendChild(lineDiv);
    });

    // Replace backdrop content
    backdrop.innerHTML = '';
    backdrop.appendChild(frag);
  }

  function highlightSyntax(line) {
    if (!line) return "";
    // Comments
    if (line.trim().startsWith("#") || line.trim().startsWith("//")) {
      return `<span class="token-comment">${escapeHtml(line)}</span>`;
    }

    const escaped = escapeHtml(line);

    // Tokenize the line to avoid replacing inside injected HTML
    // Token types: whitespace, identifiers, numbers, operators, punctuation
    const tokenRE =
      /(\s+|[A-Za-z_][A-Za-z0-9_]*|\d+[.,]\d+|\d+|==|!=|<=|>=|\+|\-|\*|\/|\^|=|\(|\)|\[|\]|,|;|\.|%)/g;
    const tokens = escaped.match(tokenRE) || [escaped];

    let out = "";
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (/^\s+$/.test(tok)) {
        out += tok;
        continue;
      }
      if (/^[0-9]+([.,][0-9]+)?$/.test(tok)) {
        out += `<span class="token-number">${tok}</span>`;
        continue;
      }
      if (/^(\+|\-|\*|\/|\^|==|!=|<=|>=|=)$/.test(tok)) {
        const optok = prettyOperator(tok);
        out += `<span class="token-operator">${optok}</span>`;
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) {
        // Keyword check
        if (/^(sum|total|pi|sin|cos|tan|sqrt|log|summe|gesamt)$/i.test(tok)) {
          out += `<span class="token-keyword">${tok}</span>`;
          continue;
        }
        // Variable on left of assignment
        // Look ahead for optional whitespace and '=' operator
        let k = i + 1;
        // skip whitespace tokens between identifier and '=' (tokens array already separates whitespace)
        while (k < tokens.length && /^\s+$/.test(tokens[k])) k++;
        if (k < tokens.length && tokens[k] === "=") {
          const prettyId = toPrettyUnits(tok);
          out += `<span class="token-variable">${prettyId}</span>`;
        } else {
          out += toPrettyUnits(tok);
        }
        continue;
      }
      // punctuation, fallback
      out += tok;
    }

    return out;
  }

  function renderLineNumbers(code) {
    const count = code.split("\n").length;
    let html = "";
    for (let i = 1; i <= count; i++) {
      html += `<div>${i}</div>`;
    }
    lineNumbers.innerHTML = html;
  }

  function updateVariables(vars, funcs) {
    const keys = Object.keys(vars).sort();
    const funcKeys = Object.keys(funcs).sort();
    varCount.textContent = keys.length + funcKeys.length + " defined";

    if (keys.length === 0 && funcKeys.length === 0) {
      variablesList.innerHTML =
        '<div class="text-center text-sm text-gray-400 mt-10 italic">No variables defined yet.</div>';
      return;
    }

    let html = "";

    // Variables
    keys.forEach((key) => {
      let val = vars[key];
      let displayVal;
      try {
        displayVal = formatResult(val);
      } catch (e) {
        return;
      }
      html += `
            <div role="button" tabindex="0" class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-colors cursor-pointer" onclick="app.insert('${key}')" onkeydown="if(event.key==='Enter'||event.key===' ') app.insert('${key}');" title="Click to insert">
              <div class="flex items-center gap-2 overflow-hidden">
                <span class="text-xs font-bold text-purple-600 dark:text-purple-400 font-mono">${key}</span>
                <span class="text-xs text-gray-400">=</span>
                <span class="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">${displayVal}</span>
              </div>
              <span class="material-symbols-outlined text-[14px] text-gray-300 opacity-0 group-hover:opacity-100">data_array</span>
            </div>
          `;
    });

    // Functions
    if (funcKeys.length > 0) {
      html += `<div class="mt-2 mb-1 text-[10px] font-bold text-gray-400 uppercase">Functions</div>`;
      funcKeys.forEach((key) => {
        // We construct a simple signature representation
        html += `
              <div class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-pink-600 dark:text-pink-400 font-mono">${key}(x)</span>
                </div>
                <button onclick="app.forcePlot('${key}')" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300">Plot</button>
              </div>
             `;
      });
    }

    // Datasets
    const dsKeys = Object.keys(datasets).sort();
    if (dsKeys.length > 0) {
      html += `<div class="mt-2 mb-1 text-[10px] font-bold text-gray-400 uppercase">Datasets</div>`;
      dsKeys.forEach((key) => {
        const meta = datasetMeta[key] || {};
        const sourceLabel = meta.sourceType === 'url' ? 'URL' : (meta.sourceType === 'file' ? 'File' : 'Local');
        html += `
          <div role="button" tabindex="0" onclick="app.insert('${key}')" class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-colors cursor-pointer" title="Insert dataset name">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-green-600 dark:text-green-400 font-mono">${key}</span>
              <span class="text-xs text-gray-400">rows</span>
              <span class="text-xs font-mono text-gray-700 dark:text-gray-300">${(datasets[key] && datasets[key].length) || 0}</span>
              <span class="text-[10px] text-gray-400 uppercase">${sourceLabel}</span>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="(function(e,k){ if(e && e.stopPropagation) e.stopPropagation(); if(window.app && window.app.previewDataset) window.app.previewDataset(k); })(event,'${key}')" class="text-[10px] bg-gray-50 text-gray-700 px-2 py-0.5 rounded">Preview</button>
              <button onclick="(function(e,k){ if(e && e.stopPropagation) e.stopPropagation(); const ans=prompt('Rename dataset', k); if(ans) { if(window.app && window.app.renameDataset) window.app.renameDataset(k, ans); } })(event,'${key}')" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Rename</button>
              <button onclick="(function(e,k){ if(e && e.stopPropagation) e.stopPropagation(); if(confirm('Delete dataset \"' + k + '\"?')) { if(window.app && window.app.deleteDataset) window.app.deleteDataset(k); } })(event,'${key}')" class="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded">Delete</button>
            </div>
          </div>
        `;
      });
    }

    variablesList.innerHTML = html;
  }

  // ------------------------------------------------------------
  // Result formatting (numbers, BigNumbers, Units) with rounding &
  // pretty unit superscripts.
  // ------------------------------------------------------------

  // Smart number formatter: strips unnecessary trailing zeros but keeps meaningful precision.
  function smartFormat(num, autoPlaces) {
    try {
      if (autoPlaces !== null && autoPlaces !== undefined) {
        // Use auto-detected decimal places, but cap at MAX_DECIMAL_PLACES
        const places = Math.min(autoPlaces, MAX_DECIMAL_PLACES);
        const fixed = Number(num).toFixed(places);
        // Strip trailing zeros after decimal point
        return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
      }
      // Fallback: use AUTO_DEFAULT_PRECISION significant digits, strip trailing zeros
      const n = Number(num);
      if (!isFinite(n)) return String(num);
      const s = n.toPrecision(AUTO_DEFAULT_PRECISION).replace(/\.?0+$/, '');
      return s;
    } catch (e) {
      return String(num);
    }
  }

  function isMathNodeValue(value) {
    if (!value || typeof value !== 'object') return false;
    if (value.isNode) return true;
    if (typeof value.type === 'string' && /Node$/.test(value.type)) return true;
    const ctorName = value.constructor && value.constructor.name;
    return typeof ctorName === 'string' && /Node$/.test(ctorName);
  }

  function shouldDisplayScopeValue(key, value) {
    if (key === 'query') return false;
    if (value === undefined || value === null) return false;
    if (typeof value === 'function') return false;
    if (isMathNodeValue(value)) return false;
    return true;
  }

  function finalizeResultText(value) {
    return localizeNumericText(toPrettyUnits(String(value)));
  }

  function formatResult(res) {
    if (res === undefined || res === null) {
      return finalizeResultText(res);
    }

    if (isMathNodeValue(res)) {
      return finalizeResultText(res.toString ? res.toString() : '');
    }

    // Determine rounding: explicit setting takes priority; null = use auto-detection.
    const explicitRd = (settings && typeof settings.roundDecimals === 'number') ? settings.roundDecimals : null;
    const rd = explicitRd; // null means "auto"

    // BigNumber
    if (res && res.isBigNumber) {
      if (rd !== null && res.toFixed) return finalizeResultText(res.toFixed(rd));
      // Auto: use detected decimal places
      return finalizeResultText(smartFormat(res.toNumber ? res.toNumber() : Number(res.toString()), _autoDecimalPlaces));
    }

    // Unit (including currencies)
    if (res && res.isUnit) {
      try {
        if (rd !== null) {
          const fmt = math.format(res, { precision: rd });
          return finalizeResultText(fmt);
        }
        // Auto: format with math.format then apply smart rounding to the numeric part
        const rawFmt = math.format(res);
        const numMatch = rawFmt.match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(.*)/);
        if (numMatch) {
          const numPart = smartFormat(parseFloat(numMatch[1]), _autoDecimalPlaces);
          const unitPart = numMatch[2] ? ' ' + numMatch[2] : '';
          return finalizeResultText(numPart + unitPart);
        }
        return finalizeResultText(rawFmt);
      } catch (e) {
        return finalizeResultText(res.toString());
      }
    }

    if (typeof res === 'number') {
      if (rd !== null) return finalizeResultText(res.toFixed(rd));
      return finalizeResultText(smartFormat(res, _autoDecimalPlaces));
    }

    // Objects/arrays/matrices -> try math.format for readable output (handles matrices)
    if (typeof res === 'object') {
      try {
        const fmt = (rd !== null) ? math.format(res, { precision: rd }) : math.format(res);
        return finalizeResultText(fmt);
      } catch (e) {
        try { return finalizeResultText(JSON.stringify(res).replace(/"/g,'')); } catch (e2) { return finalizeResultText(res); }
      }
    }

    return finalizeResultText(res);
  }

  function isDesktopViewport() {
    return window.matchMedia(DESKTOP_SIDEBAR_MEDIA).matches;
  }

  function syncSidebarToggleUi() {
    const toggleBtn = document.getElementById("sidebarToggle");
    const toggleIcon = document.getElementById("sidebarToggleIcon");
    const overlay = document.getElementById("sidebarOverlay");
    const desktopCollapsed = !!(gridLayout && gridLayout.classList.contains("sidebar-collapsed"));
    const mobileOpen = sidebar.classList.contains("open");
    const visible = isDesktopViewport() ? !desktopCollapsed : mobileOpen;

    sidebar.setAttribute("aria-hidden", visible ? "false" : "true");

    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", visible ? "true" : "false");
      toggleBtn.setAttribute("aria-label", visible ? "Hide sidebar" : "Show sidebar");
      toggleBtn.title = visible ? "Hide sidebar" : "Show sidebar";
    }

    if (toggleIcon) {
      toggleIcon.textContent = visible ? "right_panel_close" : "right_panel_open";
    }

    if (overlay) {
      overlay.classList.toggle("hidden", isDesktopViewport() || !mobileOpen);
    }
  }

  function restoreSidebarState() {
    if (gridLayout) {
      const desktopCollapsed = localStorage.getItem("livecalc:sidebarCollapsed") === "true";
      gridLayout.classList.toggle("sidebar-collapsed", desktopCollapsed);
    }

    sidebar.classList.remove("open");
    syncSidebarToggleUi();
  }

  // -- Plotting --
  // We keep track of the last plotted functions to avoid unnecessary re-renders
  let currentPlots = [];

  function plotFunctions(funcs) {
    // Detect functions named f, g, h or anything that takes 1 argument and plot them
    // For simplicity, we auto-plot f(x) and g(x) if they exist, or just everything.
    // LIMIT: Plotting everything might be chaotic. Let's plot only 'f' and 'g' by default,
    // or whatever the user explicitly defined as single-variable functions.

    if (!funcs) return;

    const containerWidth = plotContainer.offsetWidth;
    const containerHeight = plotContainer.offsetHeight;

    if (containerWidth === 0) return; // collapsed

    // Filter valid plot targets (prefer RHS expression strings)
    const targets = [];
    for (const [name, fn] of Object.entries(funcs)) {
      // fn may be a string expression (preferred) or a function object (fallback)
      const expr = typeof fn === "string" ? fn : `${name}(x)`;
      targets.push({ fn: expr, color: getRandomColor(name) });
    }

    if (targets.length === 0) {
      plotContainer.innerHTML =
        '<div class="text-gray-400 text-sm"><!-- Define a function like f(x)=x^2 to plot --></div>';
      return;
    }

    // Debounce or check diff? FunctionPlot is fast enough for small counts.
    try {
      functionPlot({
        target: "#plot",
        width: containerWidth,
        height: containerHeight,
        grid: true,
        data: targets.map((t) => ({
          fn: t.fn,
          color: t.color,
        })),
        tip: {
          xLine: true,
          yLine: true,
        },
      });
    } catch (e) {
      // Squelch errors during typing
    }
  }

  // -- Dataset Preview Rendering --
  function renderDatasetPreview(name, rowsCount = 10) {
    lastPreviewedDataset = name;
    const table = document.getElementById('datasetPreviewTable');
    const emptyState = document.getElementById('datasetEmptyState');
    const head = document.getElementById('datasetPreviewHead');
    const body = document.getElementById('datasetPreviewBody');
    const info = document.getElementById('datasetInfo');
    
    if (!table || !head || !body || !emptyState) return;
    
    const data = datasets[name];
    if (!data || !Array.isArray(data)) {
      table.classList.add('hidden');
      emptyState.classList.remove('hidden');
      emptyState.textContent = 'Dataset not found';
      if (info) info.textContent = '';
      return;
    }
    
    const n = Math.max(0, Number(rowsCount) || 10);
    const rows = data.slice(0, n);
    
    // Build header from keys of first row
    const keys = rows.length ? Object.keys(rows[0]) : (data.length ? Object.keys(data[0]) : []);
    head.innerHTML = '<tr>' + keys.map(k => `<th class="text-left px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">${escapeHtml(k)}</th>`).join('') + '</tr>';
    body.innerHTML = rows.map(r => '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800">' + keys.map(k => {
      const cell = r[k] === undefined ? '' : r[k];
      const view = typeof cell === 'number' ? localizeNumericText(cell) : String(cell);
      return `<td class="px-2 py-1 text-xs text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">${escapeHtml(view)}</td>`;
    }).join('') + '</tr>').join('');
    
    table.classList.remove('hidden');
    emptyState.classList.add('hidden');
    const meta = datasetMeta[name] || {};
    if (info) {
      const src = meta.sourceType === 'url' ? 'URL' : (meta.sourceType === 'file' ? 'File' : 'Local');
      const fmt = (meta.format || 'unknown').toUpperCase();
      const cacheNote = meta.cached ? ', cached' : '';
      info.textContent = `${name}: ${data.length} rows, ${keys.length} cols, ${fmt}, ${src}${cacheNote}`;
    }
    setDatasetStatus('Previewing "' + name + '"', 'muted');
    
    // Expand the dataset section if collapsed
    const datasetContent = document.getElementById('datasetContent');
    if (datasetContent && datasetContent.classList.contains('collapsed')) {
      if (typeof app !== 'undefined' && app.toggleSection) {
        app.toggleSection('dataset');
      }
    }
  }

  function clearDatasetPreview() {
    const table = document.getElementById('datasetPreviewTable');
    const emptyState = document.getElementById('datasetEmptyState');
    const info = document.getElementById('datasetInfo');
    
    if (table) table.classList.add('hidden');
    if (emptyState) {
      emptyState.classList.remove('hidden');
      emptyState.textContent = 'No dataset loaded';
    }
    if (info) info.textContent = '';
  }

  // -- Dataset List Rendering & Selection --
  function renderDatasetList() {
    const sel = document.getElementById('datasetSelect');
    if (!sel) return;
    // clear
    const keys = Object.keys(datasets || {});
    // remember current value
    const cur = sel.value;
    sel.innerHTML = '<option value="">Select dataset</option>' + keys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
    // restore previous selection if possible
    let chosen = cur && keys.includes(cur) ? cur : (localStorage.getItem('livecalc:lastDataset') || (keys.length ? keys[0] : ''));
    if (chosen && keys.includes(chosen)) {
      sel.value = chosen;
      // render preview for chosen
      renderDatasetPreview(chosen, document.getElementById('previewRowsSelect') ? document.getElementById('previewRowsSelect').value : 10);
    } else if (keys.length === 0) {
      clearDatasetPreview();
      setDatasetStatus('No dataset loaded', 'muted');
    }
    // change handler attached during init to avoid duplicates
  }

  // ------------------------------------------------------------
  // Pretty-printing helpers (visual only)
  // ------------------------------------------------------------
  function toPrettyUnits(str) {
    if (!str || typeof str !== 'string') return str;
    return str
      // superscript 2/3 after unit letters (optionally with caret)
      .replace(/\b([A-Za-z]{1,5})\^?2\b/g, '$1²')
      .replace(/\b([A-Za-z]{1,5})\^?3\b/g, '$1³');
  }

  function prettyOperator(op) {
    switch (op) {
      case '<=': return '≤';
      case '>=': return '≥';
      case '!=': return '≠';
      default: return op;
    }
  }

  // Deterministic color picker for plotting based on function name
  function getRandomColor(name) {
    try {
      let h = 0;
      for (let i = 0; i < name.length; i++) {
        h = (h << 5) - h + name.charCodeAt(i);
        h |= 0;
      }
      const hue = Math.abs(h) % 360;
      return `hsl(${hue} 65% 45%)`;
    } catch (e) {
      return '#4f46e5';
    }
  }

  function updateHash(content) {
    if (suppressHashUpdate) return;
    const hash = content ? utf8_to_b64(content) : "";
    history.replaceState(null, null, "#" + hash);
  }

  // -- Actions --
  function toggleTheme() {
    isDark = !isDark;
    applyTheme();
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }

  function applyTheme() {
    const html = document.documentElement;
    const icon = document.querySelector(".theme-icon");
    if (isDark) {
      html.classList.add("dark");
      icon.textContent = "light_mode";
    } else {
      html.classList.remove("dark");
      icon.textContent = "dark_mode";
    }
    // Re-render graph in next tick for style updates (grid colors)
    setTimeout(() => handleInput(), 50);
  }

  function insert(text) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const val = editor.value;
    editor.value = val.substring(0, start) + text + val.substring(end);
    editor.selectionStart = editor.selectionEnd = start + text.length;
    editor.focus();
    handleInput();
  }

  function clear() {
    if (confirm("Clear all text?")) {
      editor.value = "";
      handleInput();
    }
  }

  function download() {
    // Create text file
    let text = editor.value;
    // Append results? Maybe. Let's just download source for now.
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "calculation.txt";
    a.click();
  }

  function toggleSidebar() {
    let open = false;

    if (isDesktopViewport()) {
      if (gridLayout) {
        const collapsed = gridLayout.classList.toggle("sidebar-collapsed");
        localStorage.setItem("livecalc:sidebarCollapsed", collapsed ? "true" : "false");
        open = !collapsed;
      }
    } else {
      open = sidebar.classList.toggle("open");
    }

    syncSidebarToggleUi();

    if (open) {
      const first = sidebar.querySelector("button, [tabindex]");
      if (first) first.focus();
    }
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    syncSidebarToggleUi();
    const toggleBtn = document.getElementById("sidebarToggle");
    if (toggleBtn) toggleBtn.focus();
  }

  // Close sidebar on Escape for accessibility
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (sidebar.classList.contains("open")) {
        closeSidebar();
      }
    }
  });

  function resetGraph() {
    // Redraw with default view logic (functionPlot doesn't have easy reset, we just re-call plot)
    handleInput();
  }

  function insertExample() {
    editor.value = `# Compound Interest Calculator
P = 10000 USD   # Principal
r = 5%          # Rate
n = 12          # Times compounded per year
t = 10          # Years

# Formula
A = P * (1 + r/n) ^ (n*t)

# Monthly Payment Function
payment(loan, rate, years) = (loan * rate/12) / (1 - (1 + rate/12)^(-years*12))

loan = 300000 USD
rate = 3.5%
monthly = payment(loan, rate, 30)

# Total cost over 30 years
total_cost = monthly * 12 * 30

# Simple plot
f(x) = x^2 - 5*x`;
    handleInput();
  }

  // Expose necessary functions
  return {
    init,
    toggleTheme,
    insert,
    clear,
    insertExample,
    download,
    toggleSidebar,
    closeSidebar,
    resetGraph,
      previewDataset: (name, n) => { renderDatasetPreview(name, n); },
      clearDatasetPreview: () => { clearDatasetPreview(); },
    deleteDataset: (name) => deleteDataset(name),
    renameDataset: (oldName, newName) => {
      if (!datasets[oldName] || !newName) return false;
      const clean = cleanDatasetName(newName);
      if (clean !== oldName && datasets[clean]) return false;
      if (clean === oldName) return true;
      datasets[clean] = datasets[oldName];
      delete datasets[oldName];
      if (datasetMeta[oldName]) {
        datasetMeta[clean] = datasetMeta[oldName];
        delete datasetMeta[oldName];
      }
      if (lastPreviewedDataset === oldName) lastPreviewedDataset = clean;
      try {
        localStorage.setItem('livecalc:lastDataset', clean);
      } catch (e) {}
      renderDatasetList();
      handleInput();
      setDatasetStatus('Dataset renamed to "' + clean + '"', 'success');
      return true;
    },
    forcePlot: (name) => {
      // Re-evaluate to ensure we have latest function RHS strings
      const results = evalMath(editor.value);
      if (results.functions && results.functions[name]) {
        plotFunctions({ [name]: results.functions[name] });
      } else {
        alert(
          "Function '" + name + "' not found or not in a plot-able format.",
        );
      }
    },
      // Settings API
      setSettings: (s) => setSettings(s),
      getSettings: () => getSettings(),
      openSettings: () => {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;
        // populate fields
        const roundInput = document.getElementById('settingsRound');
        const colorSelect = document.getElementById('settingsColor');
        const fontSelect = document.getElementById('settingsFont');
        const decimalSelect = document.getElementById('settingsDecimalSeparator');
        const csvDelimiterSelect = document.getElementById('settingsCsvDelimiter');
        const cacheInput = document.getElementById('settingsExternalCacheMinutes');
        const timeoutInput = document.getElementById('settingsExternalTimeoutMs');
        const largeChk = document.getElementById('settingsLargeText');
        const highChk = document.getElementById('settingsHighContrast');
        // null/undefined → empty string (auto-detect mode)
        if (roundInput) roundInput.value = (settings && typeof settings.roundDecimals === 'number') ? settings.roundDecimals : '';
        if (colorSelect) colorSelect.value = settings.colorScheme || 'default';
        if (fontSelect) fontSelect.value = settings.font || defaultSettings.font;
        if (decimalSelect) decimalSelect.value = settings.decimalSeparator || '.';
        if (csvDelimiterSelect) csvDelimiterSelect.value = settings.csvDelimiter || 'auto';
        if (cacheInput) cacheInput.value = String(settings.externalCacheMinutes ?? DEFAULT_EXTERNAL_CACHE_MINUTES);
        if (timeoutInput) timeoutInput.value = String(settings.externalRequestTimeoutMs ?? DEFAULT_EXTERNAL_TIMEOUT_MS);
        if (largeChk && settings && settings.accessibility) largeChk.checked = !!settings.accessibility.largeText;
        if (highChk && settings && settings.accessibility) highChk.checked = !!settings.accessibility.highContrast;
        modal.classList.remove('hidden');
      },
      closeSettings: () => {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.add('hidden');
      },
      saveSettingsFromModal: () => {
        const roundInput = document.getElementById('settingsRound');
        const colorSelect = document.getElementById('settingsColor');
        const fontSelect = document.getElementById('settingsFont');
        const decimalSelect = document.getElementById('settingsDecimalSeparator');
        const csvDelimiterSelect = document.getElementById('settingsCsvDelimiter');
        const cacheInput = document.getElementById('settingsExternalCacheMinutes');
        const timeoutInput = document.getElementById('settingsExternalTimeoutMs');
        const largeChk = document.getElementById('settingsLargeText');
        const highChk = document.getElementById('settingsHighContrast');
        const next = {};
        if (roundInput) {
          const v = roundInput.value.trim();
          next.roundDecimals = v === '' ? null : (isNaN(parseInt(v, 10)) ? null : Math.max(0, Math.min(MAX_DECIMAL_PLACES, parseInt(v, 10))));
        }
        if (colorSelect) next.colorScheme = colorSelect.value;
        if (fontSelect) next.font = fontSelect.value;
        if (decimalSelect) next.decimalSeparator = decimalSelect.value === ',' ? ',' : '.';
        if (csvDelimiterSelect) next.csvDelimiter = csvDelimiterSelect.value || 'auto';
        if (cacheInput) {
          const mins = parseInt(cacheInput.value, 10);
          next.externalCacheMinutes = isNaN(mins) ? DEFAULT_EXTERNAL_CACHE_MINUTES : mins;
        }
        if (timeoutInput) {
          const ms = parseInt(timeoutInput.value, 10);
          next.externalRequestTimeoutMs = isNaN(ms) ? DEFAULT_EXTERNAL_TIMEOUT_MS : ms;
        }
        next.accessibility = {
          largeText: largeChk ? largeChk.checked : false,
          highContrast: highChk ? highChk.checked : false
        };
        setSettings(next);
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.add('hidden');
        showToast('Settings saved');
      },
      
      // Section toggle functionality with state persistence
      toggleSection: (sectionName) => {
        const contentId = sectionName + 'Content';
        const iconId = sectionName + 'ToggleIcon';
        const content = document.getElementById(contentId);
        const icon = document.getElementById(iconId);
        const header = icon?.closest('.section-header');
        
        if (!content || !icon) return;
        
        const isCollapsed = content.classList.contains('collapsed');
        
        if (isCollapsed) {
          // Expand
          content.classList.remove('collapsed');
          content.style.maxHeight = content.scrollHeight + 'px';
          icon.textContent = 'expand_less';
          if (header) header.setAttribute('aria-expanded', 'true');
          // Remove max-height after animation completes for flexible sizing
          setTimeout(() => {
            if (!content.classList.contains('collapsed')) {
              content.style.maxHeight = 'none';
            }
          }, 300);
          // Store state
          try {
            localStorage.setItem('livecalc:section:' + sectionName, 'expanded');
          } catch (e) {}
        } else {
          // Collapse
          content.style.maxHeight = content.scrollHeight + 'px';
          // Force reflow
          content.offsetHeight;
          content.classList.add('collapsed');
          content.style.maxHeight = '0px';
          icon.textContent = 'expand_more';
          if (header) header.setAttribute('aria-expanded', 'false');
          // Store state
          try {
            localStorage.setItem('livecalc:section:' + sectionName, 'collapsed');
          } catch (e) {}
        }
      },
      
      // Initialize section states from localStorage
      initSectionStates: initSectionStates,
      
      // History management
      saveToHistory: () => {
        const editorContent = editor.value;
        if (!editorContent.trim()) {
          showToast('Nothing to save');
          return;
        }
        
        const history = getHistory();
        const timestamp = new Date().toLocaleString();
        const entry = {
          id: Date.now(),
          timestamp: timestamp,
          content: editorContent
        };
        
        history.unshift(entry);
        // Keep only last 20 entries
        if (history.length > 20) {
          history.splice(20);
        }
        
        saveHistory(history);
        renderHistory();
        showToast('Saved to history');
      },
      
      loadFromHistory: (id) => {
        const history = getHistory();
        const entry = history.find(e => e.id === id);
        if (entry) {
          editor.value = entry.content;
          handleInput();
          showToast('Loaded from history');
        }
      },
      
      deleteFromHistory: (id) => {
        const history = getHistory();
        const filtered = history.filter(e => e.id !== id);
        saveHistory(filtered);
        renderHistory();
        showToast('Deleted from history');
      },
      // Examples API
      loadExample: (id) => loadExample(id),
      insertExampleToEditor: (id) => insertExampleToEditor(id),
  };
  
  // History helper functions
  function getHistory() {
    try {
      const stored = localStorage.getItem('livecalc:history');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }
  
  function saveHistory(history) {
    try {
      localStorage.setItem('livecalc:history', JSON.stringify(history));
    } catch (e) {
      console.error('Failed to save history', e);
    }
  }
  
  function renderHistory() {
    const historyContent = document.getElementById('historyContent');
    if (!historyContent) return;
    
    const history = getHistory();
    
    if (history.length === 0) {
      historyContent.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">No history saved yet</div>';
      return;
    }
    
    historyContent.innerHTML = history.map(entry => `
      <div class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700">
        <div class="flex-1 overflow-hidden mr-2">
          <div class="text-[10px] text-gray-400 mb-1">${entry.timestamp}</div>
          <div class="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">${entry.content.split('\n')[0]}</div>
        </div>
        <div class="flex gap-1 flex-shrink-0">
          <button onclick="app.loadFromHistory(${entry.id})" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300">Load</button>
          <button onclick="app.deleteFromHistory(${entry.id})" class="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300">Delete</button>
        </div>
      </div>
    `).join('');
  }
})();

// Expose `app` on the window so other inline scripts can call `window.app.*` safely.
try { window.app = app; } catch (e) {}
window.onload = app.init;
