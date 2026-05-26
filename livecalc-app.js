const app = (() => {
  // -- DOM Elements --
  const editor = document.getElementById('editor');
  const backdrop = document.getElementById('backdrop');
  const lineNumbers = document.getElementById('lineNumbers');
  const variablesList = document.getElementById('variablesList');
  const varCount = document.getElementById('varCount');
  const plotContainer = document.getElementById('plot');
  const sidebar = document.getElementById('sidebar');
  const gridLayout = document.querySelector('.grid-layout');

  const DESKTOP_SIDEBAR_MEDIA = '(min-width: 1024px)';
  const SIDEBAR_WIDTH_KEY = 'livecalc:sidebarWidth';
  const DEFAULT_SIDEBAR_WIDTH = 300;
  const MIN_SIDEBAR_WIDTH = 240;
  const MAX_SIDEBAR_WIDTH = 640;
  const MIN_EDITOR_WIDTH = 360;

  // -- Configuration --
  let isDark =
    localStorage.getItem('theme') === 'dark' ||
    (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
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

  function getKnownUnitNames() {
    const names = new Set();
    try {
      if (_LC && Array.isArray(_LC.commonUnits)) {
        _LC.commonUnits.forEach((entry) => {
          if (Array.isArray(entry) && entry[0]) names.add(String(entry[0]));
        });
      }
      if (_LC && Array.isArray(_LC.currencyUnits)) {
        _LC.currencyUnits.forEach((entry) => names.add(String(entry)));
      }
    } catch (e) {}
    return Array.from(names).sort((a, b) => b.length - a.length);
  }

  function getScopeUnitCandidates(scope) {
    const candidates = [];
    if (!scope || typeof scope !== 'object') return candidates;

    Object.keys(scope).forEach((key) => {
      const value = scope[key];
      if (!value || !value.isUnit) return;
      const unitName = (value.units && value.units[0] && value.units[0].unit && value.units[0].unit.name) || '';
      if (!unitName) return;
      candidates.push({ token: key, unitName });
    });

    return candidates;
  }

  function getUnitDisplayTarget(unitValue) {
    if (!unitValue || !unitValue.isUnit || !Array.isArray(unitValue.units)) return '';

    const parts = [];
    unitValue.units.forEach((part) => {
      const name = (part && part.unit && part.unit.name) || '';
      if (!name) return;
      const power = typeof part.power === 'number' && isFinite(part.power) ? part.power : 1;
      if (power === 1) {
        parts.push(name);
      } else {
        parts.push(name + '^' + power);
      }
    });

    return parts.join(' * ');
  }

  function getUnitConversionCandidates(unitName) {
    const candidates = [];
    const raw = normalizeUnitToken(unitName);
    if (!raw) return candidates;

    candidates.push(raw);
    candidates.push(raw.toLowerCase());
    candidates.push(raw.toUpperCase());

    const powerMatch = raw.match(/^([A-Za-z]+)\^([23])$/);
    if (powerMatch) {
      candidates.push(powerMatch[1] + powerMatch[2]);
    }

    return Array.from(new Set(candidates));
  }

  function detectPreferredUnit(expr, scope) {
    const text = String(expr || '').trim();
    if (!text) return '';

    const unitNames = getKnownUnitNames();
    const candidates = [];

    unitNames.forEach((name) => candidates.push({ token: name, unitName: name }));
    getScopeUnitCandidates(scope).forEach((item) => candidates.push(item));

    if (!candidates.length) return '';

    const seen = new Set();
    const uniqueCandidates = candidates
      .map((item) => ({ token: String(item.token || ''), unitName: String(item.unitName || '') }))
      .filter((item) => item.token && item.unitName && !seen.has(item.token + '|' + item.unitName) && seen.add(item.token + '|' + item.unitName));

    let best = null;

    uniqueCandidates.forEach((candidate) => {
      const tokenRe = new RegExp(`\\b${candidate.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      let matchCount = 0;
      let exponent = '';
      let tokenMatch;
      while ((tokenMatch = tokenRe.exec(text)) !== null) {
        matchCount += 1;
        const after = text.slice(tokenMatch.index + tokenMatch[0].length);
        const exponentMatch = after.match(/^\s*(?:\)\s*)*\^\s*([+-]?\d+)/);
        if (exponentMatch) {
          exponent = exponentMatch[1].replace(/^\+/, '');
          break;
        }
      }

      if (!exponent && matchCount > 1 && /[*/]/.test(text) && !/[+-]/.test(text)) {
        exponent = String(matchCount);
      }

      if (matchCount > 0) {
        const candidateUnit = exponent ? candidate.unitName + '^' + exponent : candidate.unitName;
        const score = text.indexOf(candidate.token) + (candidate.token === candidate.unitName ? 0.25 : 0);
        if (!best || score < best.score || (score === best.score && candidateUnit.length > best.unit.length)) {
          best = { score, unit: candidateUnit };
        }
      }
    });

    return best ? best.unit : '';
  }

  function getSidebarWidthLimits() {
    if (!gridLayout) {
      return { min: MIN_SIDEBAR_WIDTH, max: MAX_SIDEBAR_WIDTH };
    }

    const width = gridLayout.getBoundingClientRect().width || window.innerWidth || 0;
    const maxBySpace = Math.floor(width - 40 - 8 - MIN_EDITOR_WIDTH);
    const max = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, Number.isFinite(maxBySpace) ? maxBySpace : MAX_SIDEBAR_WIDTH)
    );

    return { min: MIN_SIDEBAR_WIDTH, max };
  }

  function clampSidebarWidth(value) {
    const width = Number.isFinite(value) ? value : DEFAULT_SIDEBAR_WIDTH;
    const limits = getSidebarWidthLimits();
    return Math.max(limits.min, Math.min(limits.max, Math.round(width)));
  }

  function getStoredSidebarWidth() {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return clampSidebarWidth(parsed);
    } catch (e) {
      return DEFAULT_SIDEBAR_WIDTH;
    }
  }

  function applySidebarWidth(width, persist) {
    if (!gridLayout) return DEFAULT_SIDEBAR_WIDTH;
    const next = clampSidebarWidth(width);
    gridLayout.style.setProperty('--sidebar-width', next + 'px');
    if (persist !== false) {
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
      } catch (e) {}
    }
    return next;
  }

  function syncSidebarWidth() {
    applySidebarWidth(getStoredSidebarWidth(), false);
  }

  function initSidebarResize() {
    const handle = document.getElementById('sidebarResizeHandle');
    if (!handle || !gridLayout) return;

    let dragging = false;
    let activePointerId = null;

    const stopDragging = () => {
      if (!dragging) return;
      dragging = false;
      activePointerId = null;
      document.documentElement.classList.remove('sidebar-resizing');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };

    const onPointerMove = (event) => {
      if (!dragging || !isDesktopViewport() || gridLayout.classList.contains('sidebar-collapsed')) return;
      const rect = gridLayout.getBoundingClientRect();
      const nextWidth = clampSidebarWidth(rect.right - event.clientX);
      applySidebarWidth(nextWidth);
      event.preventDefault();
    };

    handle.addEventListener('pointerdown', (event) => {
      if (!isDesktopViewport() || gridLayout.classList.contains('sidebar-collapsed')) return;
      dragging = true;
      activePointerId = event.pointerId;
      document.documentElement.classList.add('sidebar-resizing');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      if (typeof handle.setPointerCapture === 'function') {
        try {
          handle.setPointerCapture(activePointerId);
        } catch (e) {}
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', stopDragging);
      window.addEventListener('pointercancel', stopDragging);
      onPointerMove(event);
      event.preventDefault();
    });

    handle.addEventListener('dblclick', () => {
      applySidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    });
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
    number: 'number',
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
  const _LC = typeof window !== 'undefined' && window.LC_CONVERSIONS ? window.LC_CONVERSIONS : null;
  const fxRates =
    _LC && _LC.fxRates ? Object.assign({}, _LC.fxRates) : { USD: 1.0, EUR: 1.08, GBP: 1.25, JPY: 0.0072, CHF: 1.09 };
  const currencyUnits = new Set(
    (_LC && Array.isArray(_LC.currencyUnits) ? _LC.currencyUnits : ['USD', 'EUR', 'GBP', 'JPY', 'CHF']).map((c) =>
      String(c).toUpperCase()
    )
  );
  const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const RESERVED_ASSIGNMENT_NAMES = new Set(['query']);

  function isSafeIdentifier(name) {
    return IDENTIFIER_RE.test(String(name || ''));
  }

  function sanitizeIdentifier(name, fallback) {
    let next = String(name || '')
      .trim()
      .replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(next)) next = '_' + next;
    if (!isSafeIdentifier(next)) next = fallback || 'data';
    return next || fallback || 'data';
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeUnitToken(unit) {
    return String(unit || '').trim().replace(/^°/, '');
  }

  function getCurrencyUnit(unit) {
    const upper = normalizeUnitToken(unit).toUpperCase();
    return currencyUnits.has(upper) ? upper : '';
  }

  function getCurrencyCodePattern() {
    return Array.from(currencyUnits).map(escapeRegExp).join('|');
  }

  // Ensure currency unit names are present in math.js as simple units
  try {
    Array.from(currencyUnits).forEach((c) => {
      try {
        math.createUnit(c);
      } catch (e) {
        /* ignore if present */
      }
    });
  } catch (e) {}

  // Register a set of common units and synonyms to improve conversion coverage
  function registerCommonUnits() {
    const units =
      _LC && Array.isArray(_LC.commonUnits)
        ? _LC.commonUnits
        : [
            ['mm', '0.001 m'],
            ['cm', '0.01 m'],
            ['dm', '0.1 m'],
            ['m', '1 m'],
            ['km', '1000 m'],
            ['mg', '1e-6 kg'],
            ['g', '0.001 kg'],
            ['kg', '1 kg'],
            ['t', '1000 kg'],
            ['ml', '1e-6 m^3'],
            ['l', '0.001 m^3'],
            ['L', '0.001 m^3'],
            ['cm2', '0.0001 m^2'],
            ['m2', '1 m^2'],
            ['cm3', '1e-6 m^3'],
            ['m3', '1 m^3'],
            ['s', '1 s'],
            ['sec', '1 s'],
            ['min', '60 s'],
            ['h', '3600 s'],
            ['in', '0.0254 m'],
            ['ft', '0.3048 m'],
            ['yd', '0.9144 m'],
            ['mi', '1609.344 m'],
            ['oz', '0.028349523125 kg'],
            ['lb', '0.45359237 kg'],
            ['atm', '101325 Pa'],
            ['bar', '100000 Pa'],
            ['percent', '0.01'],
            ['L', '1 l'],
          ];

    function unitExists(name) {
      try {
        math.evaluate('1 ' + name);
        return true;
      } catch (e) {
        return false;
      }
    }

    units.forEach((entry) => {
      try {
        if (!Array.isArray(entry) || entry.length < 2) return;
        const name = normalizeUnitToken(entry[0]);
        const def = String(entry[1] || '').trim();
        if (!name || !def) return;
        if (!math.unit || !math.createUnit) return;
        if (!unitExists(name)) {
          math.createUnit(name, def);
        }
      } catch (e) {
        try {
          math.createUnit(name, def);
        } catch (e2) {}
      }
    });
  }
  try {
    registerCommonUnits();
  } catch (e) {}

  // ------------------------------------------------------------------
  // Data / Dataset support
  // - `datasets` stores uploaded/parsing results as arrays of objects
  // - datasets are injected into each math parser instance so users can
  //   reference them by name in expressions or use the simple query syntax
  // ------------------------------------------------------------------
  const datasets = {};
  let lastPreviewedDataset = null;

  // -- Settings (persisted) --
  const SETTINGS_KEY = 'livecalc:v9:settings';
  // Number of significant digits to show when no decimal input is detected (auto mode).
  const AUTO_DEFAULT_PRECISION = 6;
  // Maximum allowed value for the roundDecimals setting.
  const MAX_DECIMAL_PLACES = 20;

  // -----------------------------------------------------------------
  // i18n helpers — thin wrappers around window.LCi18n that gracefully
  // fall back to the English string when the i18n module is missing.
  // -----------------------------------------------------------------
  function t(key, fallback, params) {
    try {
      if (window.LCi18n && typeof window.LCi18n.t === 'function') {
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

  // Apply the user's preferred decimal/thousands separator to a numeric
  // string that uses JS's native '.' decimal and no thousands grouping.
  function applySeparators(numStr) {
    try {
      var decSep = (settings && settings.decimalSeparator) || '.';
      var thouSep = settings && typeof settings.thousandsSeparator === 'string' ? settings.thousandsSeparator : '';
      if (decSep === '.' && !thouSep) return numStr;
      if (window.LCi18n && typeof window.LCi18n.applyLocaleSeparators === 'function') {
        return window.LCi18n.applyLocaleSeparators(numStr, decSep, thouSep);
      }
      return numStr;
    } catch (e) {
      return numStr;
    }
  }

  const LLM_PROVIDER_DEFAULTS = {
    openai: {
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: '',
      requiresApiKey: true,
    },
    local: {
      baseURL: 'http://localhost:1234/v1',
      model: 'llama3.1',
      apiKey: '',
      requiresApiKey: false,
    },
    custom: {
      baseURL: 'http://localhost:1234/v1',
      model: '',
      apiKey: '',
      requiresApiKey: false,
    },
  };
  const LLM_DEFAULT_SETTINGS = {
    providerId: 'local',
    streaming: true,
    preferResponsesApi: true,
    timeoutMs: 45000,
    providers: LLM_PROVIDER_DEFAULTS,
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isLocalhostHost(host) {
    const h = String(host || '').toLowerCase();
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
    const defaults = clone(LLM_DEFAULT_SETTINGS);
    const raw = rawLlm && typeof rawLlm === 'object' ? rawLlm : {};
    const legacyEndpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
    const legacyModel = typeof raw.model === 'string' ? raw.model.trim() : '';
    const legacyApiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    const migratedBaseURL = legacyEndpoint ? deriveLegacyBaseURL(legacyEndpoint) : '';
    const migratedProvider = legacyEndpoint ? inferProviderFromBaseURL(migratedBaseURL) : null;

    const result = {
      providerId: raw.providerId && defaults.providers[raw.providerId] ? raw.providerId : defaults.providerId,
      streaming: raw.streaming !== undefined ? !!raw.streaming : !!defaults.streaming,
      preferResponsesApi:
        raw.preferResponsesApi !== undefined ? !!raw.preferResponsesApi : !!defaults.preferResponsesApi,
      timeoutMs:
        typeof raw.timeoutMs === 'number' && isFinite(raw.timeoutMs)
          ? Math.max(5000, Math.min(180000, Math.round(raw.timeoutMs)))
          : defaults.timeoutMs,
      providers: clone(defaults.providers),
    };

    if (raw.providers && typeof raw.providers === 'object') {
      ['openai', 'local', 'custom'].forEach((providerId) => {
        const next = raw.providers[providerId];
        if (!next || typeof next !== 'object') return;
        result.providers[providerId] = {
          baseURL: sanitizeBaseURL(next.baseURL, defaults.providers[providerId].baseURL),
          model: typeof next.model === 'string' ? next.model.trim() : defaults.providers[providerId].model,
          apiKey: typeof next.apiKey === 'string' ? next.apiKey.trim() : defaults.providers[providerId].apiKey,
          requiresApiKey:
            providerId === 'custom' ? !!next.requiresApiKey : !!defaults.providers[providerId].requiresApiKey,
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

    ['openai', 'local', 'custom'].forEach((providerId) => {
      const p = result.providers[providerId];
      p.baseURL = sanitizeBaseURL(p.baseURL, defaults.providers[providerId].baseURL);
      if (typeof p.model !== 'string') p.model = defaults.providers[providerId].model;
      if (typeof p.apiKey !== 'string') p.apiKey = '';
      if (providerId !== 'custom') {
        p.requiresApiKey = !!defaults.providers[providerId].requiresApiKey;
      }
    });

    return result;
  }

  const defaultSettings = {
    language: 'en', // 'en' | 'de' (UI language); auto-detected on first run
    roundDecimals: null, // null = auto-detect from input; number = fixed decimal places
    decimalSeparator: '.', // '.' or ','
    thousandsSeparator: '', // '', ' ', ',', '.', "'"
    unitSystem: 'metric', // 'metric' (SI), 'imperial', 'all'
    csvDelimiter: 'auto', // 'auto', 'comma', 'semicolon', 'tab', 'pipe'
    colorScheme: 'default', // options: default, warm, midnight, solarized, ocean, monochrome
    font: "'Fira Code', 'Menlo', 'Monaco', monospace",
    accessibility: {
      largeText: false,
      highContrast: false,
    },
    llm: clone(LLM_DEFAULT_SETTINGS),
  };
  // First-run i18n bootstrap: pick a sensible language + locale defaults
  // from the browser if the user has no persisted settings yet.
  try {
    if (window.LCi18n && !localStorage.getItem(SETTINGS_KEY)) {
      var detected = window.LCi18n.detectLocale();
      var locDefaults = window.LCi18n.defaultsForLocale(detected) || {};
      defaultSettings.language = detected;
      if (locDefaults.decimalSeparator) defaultSettings.decimalSeparator = locDefaults.decimalSeparator;
      if (locDefaults.thousandsSeparator !== undefined)
        defaultSettings.thousandsSeparator = locDefaults.thousandsSeparator;
      if (locDefaults.unitSystem) defaultSettings.unitSystem = locDefaults.unitSystem;
    }
  } catch (e) {}
  let settings = loadSettings();
  // Sync i18n module to persisted/active language as soon as possible.
  try {
    if (window.LCi18n && settings && settings.language) {
      window.LCi18n.setLocale(settings.language);
    }
  } catch (e) {}

  // Prevent updateHash from overwriting an incoming shared hash during initial load.
  let suppressHashUpdate = false;

  // Cache for auto-detected decimal places (updated on every handleInput call)
  let _autoDecimalPlaces = null;

  // Detect the maximum number of decimal places used in any literal number in the code.
  // Returns null if no decimal numbers are found (fall back to smart formatting).
  function detectInputDecimalPlaces(code) {
    // Match decimal numbers like 3.14, 0.5, 12.50 (anywhere in the expression)
    const matches = code.match(/\b\d+\.(\d+)\b/g);
    if (!matches || matches.length === 0) return null;
    let maxPlaces = 0;
    for (const m of matches) {
      const dec = m.split('.')[1] || '';
      // Strip trailing zeros: 1.50 counts as 1 significant decimal place
      const significant = dec.replace(/0+$/, '');
      if (significant.length > maxPlaces) maxPlaces = significant.length;
    }
    return maxPlaces > 0 ? maxPlaces : 0;
  }

  // Example snippets available to load into the editor.
  // Each example uses an i18n key for its title/description so the sidebar
  // localizes correctly when the language is switched.
  const examples = [
    {
      id: 'geometry',
      i18nTitle: 'examples.geometry.title',
      i18nDesc: 'examples.geometry.desc',
      content: `# Geometry example\nradius = 5 cm\narea = pi * radius^2\nperimeter = 2 * pi * radius`,
    },
    {
      id: 'finance',
      i18nTitle: 'examples.finance.title',
      i18nDesc: 'examples.finance.desc',
      content: `# Compound Interest example\nP = 10000 USD\nr = 0.05\nt = 10\nA = P * (1 + r)^t`,
    },
    {
      id: 'sum',
      i18nTitle: 'examples.sum.title',
      i18nDesc: 'examples.sum.desc',
      content: `# Sum example\nval1 = 10 m\nval2 = 20 cm\nval3 = 50 cm\nsum`,
    },
    {
      id: 'table',
      i18nTitle: 'examples.table.title',
      i18nDesc: 'examples.table.desc',
      content: `# Table demo\n# Upload a CSV (or use demo.csv). After import try:\n# sum price from demo where qty > 2\n# count order_id from demo where region == 'North'`,
    },
    {
      id: 'dataplot',
      i18nTitle: 'examples.dataplot.title',
      i18nDesc: 'examples.dataplot.desc',
      content: `# Data Plot demo\n# Import 'demo.csv' (provided) or your own dataset named 'demo'.\n# Use query() to compute aggregates inside expressions.\navgPriceNorth = query('demo', 'avg price where region == "North"')\nf(x) = avgPriceNorth + sin(x)`,
    },
    {
      id: 'conv_all',
      i18nTitle: 'examples.conv_all.title',
      i18nDesc: 'examples.conv_all.desc',
      content: `# Conversions example\n# Weight\n30 lb in kg\n\n# Pressure\n14.7 psi in bar\n\n# Area\n200 in^2 in cm^2\n\n# Volume\n1 gal in L\n\n# Force\n10 lbf in N\n\n# Mass (imperial)\n1 slug in kg\n\n# Temperature (F <-> C)\n# If your environment doesn't have F/C units defined, a manual formula is provided below\n100 F in C\n# Manual (formula) alternative:\n(100 - 32) * 5/9\n\n# Currency\n100 EUR in USD\n\n# Mixed units and sum\na = 20 cm\nb = 0.5 m\nc = 3 in\n# list values then an explicit 'sum' line to show block sum\na\nb\nc\nsum\n# Convert sum to m\nsum in m`,
    },
  ];

  // Resolve the localized title/desc for an example (used by sidebar render
  // and toasts).
  function exampleTitle(ex) {
    return ex && ex.i18nTitle ? t(ex.i18nTitle, ex.id) : (ex && ex.title) || '';
  }
  function exampleDesc(ex) {
    return ex && ex.i18nDesc ? t(ex.i18nDesc, '') : (ex && ex.desc) || '';
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return Object.assign({}, defaultSettings, { llm: normalizeLlmSettings(defaultSettings.llm) });
      const parsed = JSON.parse(raw);
      const merged = Object.assign({}, defaultSettings, parsed || {});
      merged.accessibility = Object.assign({}, defaultSettings.accessibility, (parsed && parsed.accessibility) || {});
      merged.llm = normalizeLlmSettings(parsed && parsed.llm);
      return merged;
    } catch (e) {
      return Object.assign({}, defaultSettings, { llm: normalizeLlmSettings(defaultSettings.llm) });
    }
  }

  function saveSettings() {
    try {
      // UX tradeoff: user-entered LLM API keys are persisted locally in browser storage.
      // Do not use this behavior on shared/untrusted devices.
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
        monochrome: ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db'],
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
        try {
          document.body.style.zoom = '1.3';
        } catch (e) {
          // fallback: increase editor/backdrop font sizes
          const editorEl = document.getElementById('editor');
          const backEls = document.querySelectorAll('.editor-font');
          if (editorEl) editorEl.style.fontSize = '17px';
          backEls.forEach((el) => (el.style.fontSize = '17px'));
        }
      } else {
        try {
          document.body.style.zoom = '';
        } catch (e) {
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
    try {
      handleInput();
    } catch (e) {}
  }

  function setSettings(next) {
    const merged = Object.assign({}, settings, next || {});
    const nextA11y = next && next.accessibility ? next.accessibility : {};
    merged.accessibility = Object.assign({}, settings.accessibility || {}, nextA11y);
    if (next && Object.prototype.hasOwnProperty.call(next, 'llm')) {
      merged.llm = normalizeLlmSettings(next.llm);
    } else {
      merged.llm = normalizeLlmSettings(settings.llm);
    }
    settings = merged;
    applySettings();
    return settings;
  }

  function getSettings() {
    return Object.assign({}, settings);
  }

  function registerDataset(name, data) {
    if (!name) return false;
    datasets[name] = data;
    // trigger a re-evaluation so new dataset is available
    try {
      handleInput();
    } catch (e) {}
    // Update dataset list and auto-open preview for convenience
    try {
      if (typeof renderDatasetList === 'function') renderDatasetList();
      if (typeof renderDatasetPreview === 'function') {
        renderDatasetPreview(name, 10);
      }
      try {
        localStorage.setItem('livecalc:lastDataset', name);
      } catch (e) {}
    } catch (e) {}
    return true;
  }

  function parseCSV(text, delim = ',') {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return [];
    const headers = lines[0].split(delim).map((h) => h.trim());
    const rows = lines.slice(1).map((ln) => {
      const parts = ln.split(delim).map((p) => p.trim());
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        let v = parts[i] === undefined ? '' : parts[i];
        // try number
        const num = Number(v.replace(/,/g, ''));
        obj[headers[i]] = isFinite(num) && v !== '' ? num : v;
      }
      return obj;
    });
    return rows;
  }

  function parseXML(text) {
    try {
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      // find the first repeating child collection
      const root = doc.documentElement;
      // find child node name which repeats
      const counts = {};
      for (let i = 0; i < root.children.length; i++) {
        const n = root.children[i].nodeName;
        counts[n] = (counts[n] || 0) + 1;
      }
      let repeated = null;
      for (const k in counts)
        if (counts[k] > 1) {
          repeated = k;
          break;
        }
      const arr = [];
      if (repeated) {
        const elems = root.getElementsByTagName(repeated);
        for (let i = 0; i < elems.length; i++) {
          const e = elems[i];
          const obj = {};
          for (let j = 0; j < e.children.length; j++) {
            const c = e.children[j];
            const txt = c.textContent.trim();
            const num = Number(txt.replace(/,/g, ''));
            obj[c.nodeName] = isFinite(num) && txt !== '' ? num : txt;
          }
          arr.push(obj);
        }
      } else {
        // fallback: use children of root as single object
        const obj = {};
        for (let j = 0; j < root.children.length; j++) {
          const c = root.children[j];
          const txt = c.textContent.trim();
          const num = Number(txt.replace(/,/g, ''));
          obj[c.nodeName] = isFinite(num) && txt !== '' ? num : txt;
        }
        return [obj];
      }
      return arr;
    } catch (e) {
      return [];
    }
  }

  // Simple query engine: supports queries like
  // sum price from sales where qty > 10
  // avg value from dataset where col == 'x'
  function runSimpleQuery(op, col, datasetName, whereExpr) {
    const data = datasets[datasetName];
    if (!data || !Array.isArray(data)) throw new Error('Dataset not found: ' + datasetName);
    let rows = data;
    if (whereExpr) {
      // very small sandbox: create a function with r in scope
      try {
        const fn = new Function('r', 'with(r){ return (' + whereExpr + '); }');
        rows = rows.filter((r) => {
          try {
            return !!fn(r);
          } catch (e) {
            return false;
          }
        });
      } catch (e) {
        throw new Error('Invalid where expression');
      }
    }
    if (op === 'count') return rows.length;
    if (!col) throw new Error('No column specified');
    const vals = rows
      .map((r) => {
        const v = r[col];
        return typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]+/g, ''));
      })
      .filter((v) => isFinite(v));
    if (op === 'sum') return vals.reduce((a, b) => a + b, 0);
    if (op === 'avg') return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
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
    const m = qstring.match(
      /^\s*(sum|avg|min|max|count)\s*(?:\(|\s+)?\s*([A-Za-z_][A-Za-z0-9_]*)?\s*(?:\))?\s*(?:where\s+(.+))?$/i
    );
    if (!m) throw new Error('Invalid query string');
    const op = m[1].toLowerCase();
    const col = m[2];
    const where = m[3];
    return runSimpleQuery(op, col, datasetName, where);
  }

  // Normalize common currency symbols and compact notations to unit names
  function normalizeCurrencySymbols(s) {
    if (!s || typeof s !== 'string') return s;
    const codePattern = getCurrencyCodePattern();
    // Replace euro sign after number: 300€ -> 300 EUR
    s = s.replace(/(\d[\d\.,]*)\s*€/g, '$1 EUR');
    // Replace pound sign after number: 100£ -> 100 GBP
    s = s.replace(/(\d[\d\.,]*)\s*£/g, '$1 GBP');
    // Dollar sign before or after number: $300 or 300$ -> 300 USD
    s = s.replace(/\$(\d[\d\.,]*)/g, '$1 USD');
    s = s.replace(/(\d[\d\.,]*)\s*\$/g, '$1 USD');
    // Yen symbol
    s = s.replace(/(\d[\d\.,]*)\s*¥/g, '$1 JPY');
    // Common abbreviations with no space: 100USD -> 100 USD.
    // Keep the list in sync with the centralized currency registry.
    if (codePattern) {
      s = s.replace(new RegExp('(\\d)\\s*(' + codePattern + ')\\b', 'gi'), function (m, a, b) {
        return a + ' ' + b.toUpperCase();
      });
    }
    return s;
  }

  // Initialize section states from localStorage
  function initSectionStates() {
    ['graph', 'variables', 'dataset', 'examples', 'history'].forEach((section) => {
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
      list.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">' + escapeHtml(t('sidebar.examples.empty', 'No examples available')) + '</div>';
      return;
    }
    const loadLabel = escapeHtml(t('sidebar.examples.load', 'Load'));
    const insertLabel = escapeHtml(t('sidebar.examples.insert', 'Insert'));
    list.innerHTML = examples
      .map(
        (ex) => `
      <div class="flex items-start justify-between gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        <div class="flex-1">
          <div class="text-xs font-semibold text-gray-700 dark:text-gray-200">${escapeHtml(exampleTitle(ex))}</div>
          <div class="text-[10px] text-gray-400 mt-1">${escapeHtml(exampleDesc(ex))}</div>
        </div>
        <div class="flex flex-col gap-1">
          <button onclick="(function(id){ if(window.app && window.app.loadExample) window.app.loadExample(id); })('${ex.id}')" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded">${loadLabel}</button>
          <button onclick="(function(id){ if(window.app && window.app.insertExampleToEditor) window.app.insertExampleToEditor(id); })('${ex.id}')" class="text-[10px] bg-gray-50 text-gray-700 px-2 py-0.5 rounded">${insertLabel}</button>
        </div>
      </div>
    `
      )
      .join('');
  }

  function loadExample(id) {
    const ex = examples.find((e) => e.id === id);
    if (!ex) {
      showToast(t('toast.exampleNotFound', 'Example not found'));
      return;
    }
    editor.value = ex.content;
    handleInput();
    showToast(t('toast.exampleLoaded', 'Loaded example: {title}', { title: exampleTitle(ex) }));
  }

  function insertExampleToEditor(id) {
    const ex = examples.find((e) => e.id === id);
    if (!ex) {
      showToast(t('toast.exampleNotFound', 'Example not found'));
      return;
    }
    insert('\n' + ex.content + '\n');
    showToast(t('toast.exampleInserted', 'Inserted example: {title}', { title: exampleTitle(ex) }));
  }

  // Try several heuristics to decode a base64 hash into UTF-8 text.
  function tryDecodeHash(hash) {
    if (!hash) return '';
    const candidates = [hash];
    try {
      candidates.push(decodeURIComponent(hash));
    } catch (e) {}
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
      return btoa(
        encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
          return String.fromCharCode('0x' + p1);
        })
      );
    } catch (e) {
      try {
        return btoa(unescape(encodeURIComponent(str)));
      } catch (e2) {
        return '';
      }
    }
  }

  function b64_to_utf8(b64) {
    try {
      return decodeURIComponent(
        Array.prototype.map
          .call(atob(b64), function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join('')
      );
    } catch (e) {
      try {
        return decodeURIComponent(escape(atob(b64)));
      } catch (e2) {
        return '';
      }
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
            try {
              editor.value = b64_to_utf8(hash);
            } catch (e) {
              console.error('hash decode failed', e);
            }
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
    editor.addEventListener('input', handleInput);
    editor.addEventListener('scroll', syncScroll);
    editor.addEventListener('keydown', handleKeydown); // For tab support
    window.addEventListener('resize', () => {
      plotFunctions();
    });

    // Data file input handling (upload CSV/TSV/JSON/XML)
    const fileInput = document.getElementById('dataFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = function (e) {
          const text = e.target.result;
          const nameParts = (f.name || 'dataset').split('.');
          const ext = (nameParts.pop() || '').toLowerCase();
          let data = [];
          try {
            const csvDelim = (function () {
              const d = settings && settings.csvDelimiter;
              if (d === 'semicolon') return ';';
              if (d === 'tab') return '\t';
              if (d === 'pipe') return '|';
              if (d === 'comma') return ',';
              return ','; // auto or default
            })();
            if (ext === 'csv' || f.type === 'text/csv') data = parseCSV(text, csvDelim);
            else if (ext === 'tsv' || f.type === 'text/tab-separated-values') data = parseCSV(text, '\t');
            else if (ext === 'json' || f.type === 'application/json') data = JSON.parse(text);
            else if (ext === 'xml' || f.type === 'text/xml' || f.type === 'application/xml') data = parseXML(text);
            else {
              // try JSON first
              try {
                data = JSON.parse(text);
              } catch (e) {
                data = parseCSV(text, ',');
              }
            }
          } catch (e) {
            showToast(t('toast.parseFileFailed', 'Failed to parse file'));
            return;
          }
          // normalize non-array JSON to array
          if (!Array.isArray(data)) data = [data];
          // ask user for dataset name
          const base = nameParts.join('.') || 'data';
          let dsName = sanitizeIdentifier(base, 'data');
          let attempt = dsName;
          let i = 1;
          while (datasets[attempt]) {
            attempt = dsName + '_' + i++;
          }
          dsName = attempt;
          // prompt user to rename (non-blocking)
          const custom = prompt(t('dataset.namePrompt', 'Dataset name'), dsName);
          if (custom && custom.trim()) {
            const requested = sanitizeIdentifier(custom, dsName);
            attempt = requested;
            i = 1;
            while (datasets[attempt]) {
              attempt = requested + '_' + i++;
            }
            dsName = attempt;
          }
          registerDataset(dsName, data);
          showToast(t('toast.importedAs', 'Imported {name} as {dsName}', { name: f.name, dsName: dsName }));
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
        try {
          localStorage.setItem('livecalc:lastDataset', v);
        } catch (e) {}
        if (v) renderDatasetPreview(v, previewRowsSelect ? previewRowsSelect.value : 10);
      });
    }
    if (previewRowsSelect)
      previewRowsSelect.addEventListener('change', () => {
        const v = previewRowsSelect.value;
        const sel = datasetSelect || document.getElementById('datasetSelect');
        const ds = sel ? sel.value : lastPreviewedDataset;
        if (ds) renderDatasetPreview(ds, v);
      });

    // Render examples list
    try {
      renderExamples();
    } catch (e) {}

    // Re-render locale-dependent dynamic content whenever the language
    // changes at runtime, so the variables panel, examples list, and
    // history switch language without a page reload.
    try {
      document.addEventListener('livecalc:locale-changed', () => {
        try {
          renderExamples();
        } catch (e) {}
        try {
          renderHistory();
        } catch (e) {}
        try {
          if (typeof handleInput === 'function') handleInput();
        } catch (e) {}
      });
    } catch (e) {}

    initSidebarResize();
    restoreSidebarState();
    window.addEventListener('resize', () => {
      syncSidebarToggleUi();
      if (isDesktopViewport()) {
        syncSidebarWidth();
      }
    });

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

    // 0b. If comma-as-decimal is configured, pre-substitute before eval
    let editorValue = editor.value;
    if (settings && settings.decimalSeparator === ',') {
      // Replace decimal commas (e.g. 1,23) with dots, but leave function-arg commas alone.
      // Strategy: only replace comma that is surrounded by digits on both sides.
      editorValue = editorValue.replace(/(\d),(\d)/g, '$1.$2');
    }

    // 1. Evaluate Math
    const results = evalMath(editorValue);

    // 2. Update Backdrop (Syntax Highlight + Results)
    renderBackdrop(editorValue, results);

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
      parser.set('query', function (dsName, q) {
        try {
          return queryHelper(dsName, q);
        } catch (e) {
          throw new Error(e.message);
        }
      });
    } catch (e) {}
    let lines = code.split('\n');
    // collect function RHS strings (f(x) = expr) so we can pass raw expressions to function-plot
    const functionDefs = {};

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
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        outputLines.push(null);
        // blank line resets block sum
        if (trimmed === '') {
          blockSum = null;
          blockSumIsUnit = false;
          blockSumIsCurrency = false;
          blockSumCurrencyBase = null;
        }
        continue;
      }

      // Detect function definition like f(x) = expr and capture RHS for plotting
      const fnMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*=\s*(.+)$/);
      if (fnMatch) {
        const name = fnMatch[1];
        const expr = fnMatch[3];
        if (RESERVED_ASSIGNMENT_NAMES.has(name)) {
          outputLines.push({ value: '"' + name + '" is reserved and cannot be assigned', type: 'error' });
          continue;
        }
        functionDefs[name] = expr.trim();
        try {
          parser.evaluate(trimmed); // register function in scope
          outputLines.push(null);
        } catch (e) {
          outputLines.push({ value: e.message, type: 'error' });
        }
        continue;
      }

      // Detect simple assignment where RHS might be a query expression, e.g. `val = sum price from demo where qty>9`
      const assignMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (assignMatch) {
        const varName = assignMatch[1];
        const rhs = assignMatch[2].trim();
        if (RESERVED_ASSIGNMENT_NAMES.has(varName)) {
          outputLines.push({ value: '"' + varName + '" is reserved and cannot be assigned', type: 'error' });
          continue;
        }
        const qMatch2 = rhs.match(
          /^(sum|avg|min|max|count)\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+where\s+(.+))?$/i
        );
        if (qMatch2) {
          // run query and assign into parser scope
          try {
            const op = qMatch2[1].toLowerCase();
            const col = qMatch2[2];
            const ds = qMatch2[3];
            const where = qMatch2[4];
            const val = runSimpleQuery(op, col, ds, where);
            // set in parser so subsequent lines can use it
            try {
              parser.set(varName, val);
            } catch (e) {}
            outputLines.push({ value: String(val), type: 'result' });
          } catch (e) {
            outputLines.push({ value: e.message, type: 'error' });
          }
          continue;
        }
        // else fallthrough and let the normal parser evaluate the assignment
      }

      // Prepare processed line (normalize currency symbols etc.)
      const proc = normalizeCurrencySymbols(trimmed);

      // Check for 'sum' keyword
      if (/^(total|sum|summe|gesamt)$/i.test(trimmed)) {
        // It's a sum line
        try {
          let display;
          if (blockSum === null) {
            display = '0';
          } else if (blockSumIsCurrency) {
            display = math.format(blockSum, { precision: 14 }) + ' ' + (blockSumCurrencyBase || '');
          } else if (blockSumIsUnit) {
            display = math.format(blockSum, { precision: 14 });
          } else {
            display = math.format(blockSum, { precision: 14 });
          }
          outputLines.push({ value: display, type: 'sum' });
        } catch (e) {
          outputLines.push({ value: e.message, type: 'error' });
        }
        // Reset block sum
        blockSum = null;
        blockSumIsUnit = false;
        blockSumIsCurrency = false;
        blockSumCurrencyBase = null;
        continue;
      }

      // Check for simple query syntax: op col from dataset [where expr]
      const qMatch = trimmed.match(
        /^(sum|avg|min|max|count)\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+where\s+(.+))?$/i
      );
      if (qMatch) {
        const op = qMatch[1].toLowerCase();
        const col = qMatch[2];
        const ds = qMatch[3];
        const where = qMatch[4];
        try {
          const val = runSimpleQuery(op, col, ds, where);
          outputLines.push({ value: String(val), type: 'result' });
        } catch (e) {
          outputLines.push({ value: e.message, type: 'error' });
        }
        continue;
      }

      // Handle conversion syntax:  expr in UNIT (especially for currencies)
      const convMatch = trimmed.match(/^(.+?)\s+in\s+(.+)$/i);
      if (convMatch) {
        const leftExpr = convMatch[1].trim();
        const rawTarget = normalizeUnitToken(convMatch[2]);
        if (!rawTarget) {
          outputLines.push({ value: 'Missing conversion target unit', type: 'error' });
          continue;
        }
        // Temperature heuristic: allow converting plain numeric temperatures even if units aren't registered
        const tempMatch = leftExpr.match(/^\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(°?F|F|°?C|C|K)\s*$/i);
        if (tempMatch) {
          try {
            const num = Number(tempMatch[1]);
            const src = tempMatch[2].replace('°', '').toUpperCase();
            const tgt = rawTarget.replace('°', '').toUpperCase();
            let celsius;
            if (src === 'F') celsius = ((num - 32) * 5) / 9;
            else if (src === 'K') celsius = num - 273.15;
            else celsius = num; // already C
            let out;
            if (tgt === 'C') out = celsius;
            else if (tgt === 'F') out = (celsius * 9) / 5 + 32;
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
        const candidates = getUnitConversionCandidates(rawTarget);
        try {
          let val;
          try {
            val = parser.evaluate(normalizeCurrencySymbols(leftExpr));
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
          const tryCurrency = (u) => getCurrencyUnit(srcUnitName) && getCurrencyUnit(u);

          let success = false;
          for (const cand of candidates) {
            try {
              const targetCurrency = getCurrencyUnit(cand);
              const sourceCurrency = getCurrencyUnit(srcUnitName);
              if (tryCurrency(cand)) {
                const amountNum = val.toNumber(srcUnitName);
                const converted = amountNum * (fxRates[sourceCurrency] / (fxRates[targetCurrency] || 1));
                outputLines.push({ value: formatResult(converted) + ' ' + targetCurrency, type: 'result' });
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
                outputLines.push({ value: formatResult(mathConverted, cand), type: 'result' });
                success = true;
                break;
              }
            } catch (e) {
              // continue trying other candidates
            }
          }

          if (!success) {
            outputLines.push({
              value: 'Conversion failed: incompatible or unknown unit "' + rawTarget + '"',
              type: 'error',
            });
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
          const preferredUnit = res && res.isUnit ? detectPreferredUnit(proc, parser.getAll()) : '';
          let formatted = formatResult(res, preferredUnit);
          // Store for display
          outputLines.push({ value: formatted, type: 'result' });

          // Update Sums logic
          // Accumulate numbers and units while preserving correct conversions
          try {
            if (res && res.isUnit) {
              const u = (res.units && res.units[0] && res.units[0].unit && res.units[0].unit.name) || null;
              if (u) {
                // Currency handling (use fxRates table)
                const currencyUnit = getCurrencyUnit(u);
                if (currencyUnit) {
                  const amount = res.toNumber(u);
                  if (blockSum === null) {
                    blockSum = math.bignumber(amount);
                    blockSumIsCurrency = true;
                    blockSumCurrencyBase = currencyUnit;
                  } else if (blockSumIsCurrency) {
                    // convert incoming to base currency
                    const rSrc = fxRates[currencyUnit] || 1;
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
            } else if (typeof res === 'number' || (res && res.isBigNumber)) {
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
        outputLines.push({ value: err.message, type: 'error' });
      }
    }

    // Extract scope for sidebar
    // parser.getAll() returns all vars
    const scope = parser.getAll();

    // Identify functions vs variables
    const vars = {};
    const funcs = {};

    for (const [key, val] of Object.entries(scope)) {
      if (typeof val === 'function' && !isBuiltIn(key)) {
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
    const lines = code.split('\n');
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
    if (!line) return '';
    // Comments
    if (line.trim().startsWith('#') || line.trim().startsWith('//')) {
      return `<span class="token-comment">${escapeHtml(line)}</span>`;
    }

    const escaped = escapeHtml(line);

    // Tokenize the line to avoid replacing inside injected HTML
    // Token types: whitespace, identifiers, numbers, operators, punctuation
    const tokenRE = /(\s+|[A-Za-z_][A-Za-z0-9_]*|\d+\.\d+|\d+|==|!=|<=|>=|\+|\-|\*|\/|\^|=|\(|\)|\[|\]|,|;|\.|%)/g;
    const tokens = escaped.match(tokenRE) || [escaped];

    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (/^\s+$/.test(tok)) {
        out += tok;
        continue;
      }
      if (/^[0-9]+(\.[0-9]+)?$/.test(tok)) {
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
        if (k < tokens.length && tokens[k] === '=') {
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
    const count = code.split('\n').length;
    let html = '';
    for (let i = 1; i <= count; i++) {
      html += `<div>${i}</div>`;
    }
    lineNumbers.innerHTML = html;
  }

  function updateVariables(vars, funcs) {
    const keys = Object.keys(vars).sort();
    const funcKeys = Object.keys(funcs).sort();
    varCount.textContent = t('sidebar.variables.count', '{count} defined', { count: keys.length + funcKeys.length });

    if (keys.length === 0 && funcKeys.length === 0) {
      variablesList.innerHTML =
        '<div class="text-center text-sm text-gray-400 mt-10 italic">' + escapeHtml(t('sidebar.variables.empty', 'No variables defined yet.')) + '</div>';
      return;
    }

    let html = '';

    // Variables
    keys.forEach((key) => {
      let val = vars[key];
      let displayVal;
      try {
        displayVal = formatResult(val, getUnitDisplayTarget(val));
      } catch (e) {
        return;
      }
      const safeKey = escapeHtml(key);
      const safeDisplayVal = escapeHtml(displayVal);
      html += `
            <div role="button" tabindex="0" data-insert-token="${safeKey}" class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-colors cursor-pointer" onclick="app.insert(this.getAttribute('data-insert-token'))" onkeydown="if(event.key==='Enter'||event.key===' ') app.insert(this.getAttribute('data-insert-token'));" title="Click to insert">
              <div class="flex items-center gap-2 overflow-hidden">
                <span class="text-xs font-bold text-purple-600 dark:text-purple-400 font-mono">${safeKey}</span>
                <span class="text-xs text-gray-400">=</span>
                <span class="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">${safeDisplayVal}</span>
              </div>
              <span class="material-symbols-outlined text-[14px] text-gray-300 opacity-0 group-hover:opacity-100">data_array</span>
            </div>
          `;
    });

    // Functions
    if (funcKeys.length > 0) {
      html += `<div class="mt-2 mb-1 text-[10px] font-bold text-gray-400 uppercase">Functions</div>`;
      funcKeys.forEach((key) => {
        const safeKey = escapeHtml(key);
        // We construct a simple signature representation
        html += `
              <div class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-pink-600 dark:text-pink-400 font-mono">${safeKey}(x)</span>
                </div>
                <button data-plot-token="${safeKey}" onclick="app.forcePlot(this.getAttribute('data-plot-token'))" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300">Plot</button>
              </div>
             `;
      });
    }

    // Datasets
    const dsKeys = Object.keys(datasets).sort();
    if (dsKeys.length > 0) {
      html += `<div class="mt-2 mb-1 text-[10px] font-bold text-gray-400 uppercase">Datasets</div>`;
      dsKeys.forEach((key) => {
        const safeKey = escapeHtml(key);
        const rowCount = escapeHtml((datasets[key] && datasets[key].length) || 0);
        html += `
          <div role="button" tabindex="0" data-insert-token="${safeKey}" onclick="app.insert(this.getAttribute('data-insert-token'))" class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-colors cursor-pointer" title="Insert dataset name">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-green-600 dark:text-green-400 font-mono">${safeKey}</span>
              <span class="text-xs text-gray-400">rows</span>
              <span class="text-xs font-mono text-gray-700 dark:text-gray-300">${rowCount}</span>
            </div>
            <div class="flex items-center gap-2">
              <button data-dataset-token="${safeKey}" onclick="(function(e,el){ if(e && e.stopPropagation) e.stopPropagation(); if(window.app && window.app.previewDataset) window.app.previewDataset(el.getAttribute('data-dataset-token')); })(event,this)" class="text-[10px] bg-gray-50 text-gray-700 px-2 py-0.5 rounded">Preview</button>
              <button data-dataset-token="${safeKey}" onclick="(function(e,el){ if(e && e.stopPropagation) e.stopPropagation(); const k=el.getAttribute('data-dataset-token'); const ans=prompt('Rename dataset', k); if(ans) { if(window.app && window.app.renameDataset) window.app.renameDataset(k, ans); } })(event,this)" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Rename</button>
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
  // Always returns the result formatted with the user's preferred decimal /
  // thousands separators (so output respects locale, not just input).
  function smartFormat(num, autoPlaces) {
    try {
      var raw;
      if (autoPlaces !== null && autoPlaces !== undefined) {
        // Use auto-detected decimal places, but cap at MAX_DECIMAL_PLACES
        const places = Math.min(autoPlaces, MAX_DECIMAL_PLACES);
        const fixed = Number(num).toFixed(places);
        // Strip trailing zeros after decimal point
        raw = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
      } else {
        // Fallback: use AUTO_DEFAULT_PRECISION significant digits, strip trailing zeros
        const n = Number(num);
        if (!isFinite(n)) return String(num);
        raw = n.toPrecision(AUTO_DEFAULT_PRECISION).replace(/\.?0+$/, '');
      }
      return applySeparators(raw);
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
    if (!isSafeIdentifier(key)) return false;
    if (value === undefined || value === null) return false;
    if (typeof value === 'function') return false;
    if (isMathNodeValue(value)) return false;
    return true;
  }

  function formatResult(res, preferredUnit) {
    if (res === undefined || res === null) {
      return String(res);
    }

    if (isMathNodeValue(res)) {
      return res.toString ? res.toString() : '';
    }

    // Determine rounding: explicit setting takes priority; null = use auto-detection.
    const explicitRd = settings && typeof settings.roundDecimals === 'number' ? settings.roundDecimals : null;
    const rd = explicitRd; // null means "auto"

    // BigNumber
    if (res && res.isBigNumber) {
      if (rd !== null && res.toFixed) return applySeparators(res.toFixed(rd));
      // Auto: use detected decimal places
      return smartFormat(res.toNumber ? res.toNumber() : Number(res.toString()), _autoDecimalPlaces);
    }

    // Unit (including currencies)
    if (res && res.isUnit) {
      try {
        const displayUnit = preferredUnit || getUnitDisplayTarget(res);
        if (displayUnit) {
          try {
            const conversionCandidates = getUnitConversionCandidates(displayUnit);
            for (const candidateUnit of conversionCandidates) {
              try {
                const converted = res.to(candidateUnit);
                const numericValue = converted.toNumber(candidateUnit);
                const numericText = rd !== null ? applySeparators(Number(numericValue).toFixed(rd)) : smartFormat(numericValue, _autoDecimalPlaces);
                return toPrettyUnits(numericText + ' ' + displayUnit);
              } catch (e) {}
            }
          } catch (e) {}
        }
        if (rd !== null) {
          const fmt = math.format(res, { precision: rd });
          return toPrettyUnits(applySeparators(String(fmt)));
        }
        // Auto: format with math.format then apply smart rounding to the numeric part
        const rawFmt = math.format(res);
        const numMatch = rawFmt.match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(.*)/);
        if (numMatch) {
          const numPart = smartFormat(parseFloat(numMatch[1]), _autoDecimalPlaces);
          const unitPart = numMatch[2] ? ' ' + numMatch[2] : '';
          return toPrettyUnits(numPart + unitPart);
        }
        return toPrettyUnits(applySeparators(rawFmt));
      } catch (e) {
        return toPrettyUnits(res.toString());
      }
    }

    if (typeof res === 'number') {
      if (rd !== null) return applySeparators(res.toFixed(rd));
      return smartFormat(res, _autoDecimalPlaces);
    }

    // Objects/arrays/matrices -> try math.format for readable output (handles matrices)
    if (typeof res === 'object') {
      try {
        const fmt = rd !== null ? math.format(res, { precision: rd }) : math.format(res);
        return toPrettyUnits(applySeparators(String(fmt)));
      } catch (e) {
        try {
          return JSON.stringify(res).replace(/"/g, '');
        } catch (e2) {
          return String(res);
        }
      }
    }

    return toPrettyUnits(String(res));
  }

  function isDesktopViewport() {
    return window.matchMedia(DESKTOP_SIDEBAR_MEDIA).matches;
  }

  function syncSidebarToggleUi() {
    const toggleBtn = document.getElementById('sidebarToggle');
    const toggleIcon = document.getElementById('sidebarToggleIcon');
    const overlay = document.getElementById('sidebarOverlay');
    const resizeHandle = document.getElementById('sidebarResizeHandle');
    const desktopCollapsed = !!(gridLayout && gridLayout.classList.contains('sidebar-collapsed'));
    const mobileOpen = sidebar.classList.contains('open');
    const visible = isDesktopViewport() ? !desktopCollapsed : mobileOpen;

    sidebar.setAttribute('aria-hidden', visible ? 'false' : 'true');

    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', visible ? 'Hide sidebar' : 'Show sidebar');
      toggleBtn.title = visible ? 'Hide sidebar' : 'Show sidebar';
    }

    if (toggleIcon) {
      toggleIcon.textContent = visible ? 'right_panel_close' : 'right_panel_open';
    }

    if (overlay) {
      overlay.classList.toggle('hidden', isDesktopViewport() || !mobileOpen);
    }

    if (resizeHandle) {
      resizeHandle.classList.toggle('hidden', !isDesktopViewport() || desktopCollapsed);
    }
  }

  function restoreSidebarState() {
    if (gridLayout) {
      const desktopCollapsed = localStorage.getItem('livecalc:sidebarCollapsed') === 'true';
      gridLayout.classList.toggle('sidebar-collapsed', desktopCollapsed);
      applySidebarWidth(getStoredSidebarWidth(), false);
    }

    sidebar.classList.remove('open');
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
      const expr = typeof fn === 'string' ? fn : `${name}(x)`;
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
        target: '#plot',
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

    if (!table || !head || !body || !emptyState) return;

    const data = datasets[name];
    if (!data || !Array.isArray(data)) {
      table.classList.add('hidden');
      emptyState.classList.remove('hidden');
      emptyState.textContent = 'Dataset not found';
      return;
    }

    const n = Math.max(0, Number(rowsCount) || 10);
    const rows = data.slice(0, n);

    // Build header from keys of first row
    const keys = rows.length ? Object.keys(rows[0]) : data.length ? Object.keys(data[0]) : [];
    head.innerHTML =
      '<tr>' +
      keys
        .map(
          (k) =>
            `<th class="text-left px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">${escapeHtml(k)}</th>`
        )
        .join('') +
      '</tr>';
    body.innerHTML = rows
      .map(
        (r) =>
          '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800">' +
          keys
            .map(
              (k) =>
                `<td class="px-2 py-1 text-xs text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">${escapeHtml(String(r[k] === undefined ? '' : r[k]))}</td>`
            )
            .join('') +
          '</tr>'
      )
      .join('');

    table.classList.remove('hidden');
    emptyState.classList.add('hidden');

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

    if (table) table.classList.add('hidden');
    if (emptyState) {
      emptyState.classList.remove('hidden');
      emptyState.textContent = 'No dataset loaded';
    }
  }

  // -- Dataset List Rendering & Selection --
  function renderDatasetList() {
    const sel = document.getElementById('datasetSelect');
    if (!sel) return;
    // clear
    const keys = Object.keys(datasets || {});
    // remember current value
    const cur = sel.value;
    sel.innerHTML =
      '<option value="">Select dataset</option>' +
      keys.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
    // restore previous selection if possible
    let chosen =
      cur && keys.includes(cur) ? cur : localStorage.getItem('livecalc:lastDataset') || (keys.length ? keys[0] : '');
    if (chosen && keys.includes(chosen)) {
      sel.value = chosen;
      // render preview for chosen
      renderDatasetPreview(
        chosen,
        document.getElementById('previewRowsSelect') ? document.getElementById('previewRowsSelect').value : 10
      );
    }
    // change handler attached during init to avoid duplicates
  }

  // ------------------------------------------------------------
  // Pretty-printing helpers (visual only)
  // ------------------------------------------------------------
  function toPrettyUnits(str) {
    if (!str || typeof str !== 'string') return str;
    return (
      str
        // superscript 2/3 after unit letters (optionally with caret)
        .replace(/\b([A-Za-z]{1,5})\^?2\b/g, '$1²')
        .replace(/\b([A-Za-z]{1,5})\^?3\b/g, '$1³')
    );
  }

  function prettyOperator(op) {
    switch (op) {
      case '<=':
        return '≤';
      case '>=':
        return '≥';
      case '!=':
        return '≠';
      default:
        return op;
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
    const hash = content ? utf8_to_b64(content) : '';
    history.replaceState(null, null, '#' + hash);
  }

  // -- Actions --
  function toggleTheme() {
    isDark = !isDark;
    applyTheme();
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  function applyTheme() {
    const html = document.documentElement;
    const icon = document.querySelector('.theme-icon');
    if (isDark) {
      html.classList.add('dark');
      icon.textContent = 'light_mode';
    } else {
      html.classList.remove('dark');
      icon.textContent = 'dark_mode';
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
    if (confirm('Clear all text?')) {
      editor.value = '';
      handleInput();
    }
  }

  function download() {
    // Create text file
    let text = editor.value;
    // Append results? Maybe. Let's just download source for now.
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calculation.txt';
    a.click();
  }

  function toggleSidebar() {
    let open = false;

    if (isDesktopViewport()) {
      if (gridLayout) {
        const collapsed = gridLayout.classList.toggle('sidebar-collapsed');
        localStorage.setItem('livecalc:sidebarCollapsed', collapsed ? 'true' : 'false');
        open = !collapsed;
      }
    } else {
      open = sidebar.classList.toggle('open');
    }

    syncSidebarToggleUi();

    if (open) {
      const first = sidebar.querySelector('button, [tabindex]');
      if (first) first.focus();
    }
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    syncSidebarToggleUi();
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) toggleBtn.focus();
  }

  // Close sidebar on Escape for accessibility
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sidebar.classList.contains('open')) {
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
    previewDataset: (name, n) => {
      renderDatasetPreview(name, n);
    },
    clearDatasetPreview: () => {
      clearDatasetPreview();
    },
    renameDataset: (oldName, newName) => {
      if (!datasets[oldName] || !newName) return false;
      const clean = sanitizeIdentifier(newName, oldName);
      if (clean === oldName) return true;
      if (datasets[clean]) return false;
      datasets[clean] = datasets[oldName];
      delete datasets[oldName];
      handleInput();
      return true;
    },
      forcePlot: (name) => {
        // Re-evaluate to ensure we have latest function RHS strings
        const results = evalMath(editor.value);
        if (results.functions && results.functions[name]) {
          plotFunctions({ [name]: results.functions[name] });
        } else {
          alert(t('toast.functionNotPlottable', "Function '{name}' not found or not in a plottable format.", { name: name }));
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
      const largeChk = document.getElementById('settingsLargeText');
      const highChk = document.getElementById('settingsHighContrast');
      const langSelect = document.getElementById('settingsLanguage');
      const unitSysSelect = document.getElementById('settingsUnitSystem');
      const thouSepSel = document.getElementById('settingsThousandsSeparator');
      const llmProvider = document.getElementById('settingsLlmProvider');
      const llmBaseURL = document.getElementById('settingsLlmBaseUrl');
      const llmModel = document.getElementById('settingsLlmModel');
      const llmApiKey = document.getElementById('settingsLlmApiKey');
      const llmStreaming = document.getElementById('settingsLlmStreaming');
      const llmResponses = document.getElementById('settingsLlmUseResponses');
      const llmCustomRequiresApiKey = document.getElementById('settingsLlmCustomRequiresApiKey');
      const llmCfg = normalizeLlmSettings(settings && settings.llm);
      const providerId = llmCfg.providerId || 'local';
      const providerCfg = llmCfg.providers[providerId] || llmCfg.providers.local;

      // Populate language dropdown from LCi18n's available locales (once,
      // idempotent — it's safe to re-build to reflect new options).
      if (langSelect) {
        try {
          const locales = (window.LCi18n && window.LCi18n.getAvailableLocales && window.LCi18n.getAvailableLocales()) || [
            { code: 'en', label: 'English' },
            { code: 'de', label: 'Deutsch' },
          ];
          // Rebuild only if option set differs
          const existingValues = Array.from(langSelect.options).map((o) => o.value).join(',');
          const desiredValues = locales.map((l) => l.code).join(',');
          if (existingValues !== desiredValues) {
            langSelect.innerHTML = '';
            for (const l of locales) {
              const opt = document.createElement('option');
              opt.value = l.code;
              opt.textContent = l.label;
              langSelect.appendChild(opt);
            }
          }
          langSelect.value = (settings && settings.language) || (window.LCi18n && window.LCi18n.getLocale && window.LCi18n.getLocale()) || 'en';
        } catch (e) {}
      }
      if (unitSysSelect) unitSysSelect.value = (settings && settings.unitSystem) || 'metric';
      if (thouSepSel) thouSepSel.value = (settings && typeof settings.thousandsSeparator === 'string') ? settings.thousandsSeparator : '';

      // null/undefined → empty string (auto-detect mode)
      if (roundInput)
        roundInput.value = settings && typeof settings.roundDecimals === 'number' ? settings.roundDecimals : '';
      if (colorSelect) colorSelect.value = settings.colorScheme || 'default';
      if (fontSelect) fontSelect.value = settings.font || defaultSettings.font;
      if (largeChk && settings && settings.accessibility) largeChk.checked = !!settings.accessibility.largeText;
      if (highChk && settings && settings.accessibility) highChk.checked = !!settings.accessibility.highContrast;
      if (llmProvider) llmProvider.value = providerId;
      if (llmBaseURL) llmBaseURL.value = providerCfg.baseURL || '';
      if (llmModel) llmModel.value = providerCfg.model || '';
      if (llmApiKey) llmApiKey.value = providerCfg.apiKey || '';
      if (llmStreaming) llmStreaming.checked = !!llmCfg.streaming;
      if (llmResponses) llmResponses.checked = !!llmCfg.preferResponsesApi;
      if (llmCustomRequiresApiKey) llmCustomRequiresApiKey.checked = !!llmCfg.providers.custom.requiresApiKey;
      const decSepSel = document.getElementById('settingsDecimalSeparator');
      const csvDelimSel = document.getElementById('settingsCsvDelimiter');
      if (decSepSel) decSepSel.value = (settings && settings.decimalSeparator) || '.';
      if (csvDelimSel) csvDelimSel.value = (settings && settings.csvDelimiter) || 'auto';
      modal.classList.remove('hidden');
      try {
        document.dispatchEvent(
          new CustomEvent('livecalc:settings-opened', {
            detail: { settings: getSettings(), llm: normalizeLlmSettings(llmCfg) },
          })
        );
      } catch (e) {}
    },
    closeSettings: () => {
      const modal = document.getElementById('settingsModal');
      if (modal) modal.classList.add('hidden');
    },
    saveSettingsFromModal: () => {
      const roundInput = document.getElementById('settingsRound');
      const colorSelect = document.getElementById('settingsColor');
      const fontSelect = document.getElementById('settingsFont');
      const largeChk = document.getElementById('settingsLargeText');
      const highChk = document.getElementById('settingsHighContrast');
      const langSelect = document.getElementById('settingsLanguage');
      const unitSysSelect = document.getElementById('settingsUnitSystem');
      const thouSepSel = document.getElementById('settingsThousandsSeparator');
      const llmProvider = document.getElementById('settingsLlmProvider');
      const llmBaseURL = document.getElementById('settingsLlmBaseUrl');
      const llmModel = document.getElementById('settingsLlmModel');
      const llmApiKey = document.getElementById('settingsLlmApiKey');
      const llmStreaming = document.getElementById('settingsLlmStreaming');
      const llmResponses = document.getElementById('settingsLlmUseResponses');
      const llmCustomRequiresApiKey = document.getElementById('settingsLlmCustomRequiresApiKey');
      const next = {};
      if (roundInput) {
        const v = roundInput.value.trim();
        next.roundDecimals =
          v === '' ? null : isNaN(parseInt(v, 10)) ? null : Math.max(0, Math.min(MAX_DECIMAL_PLACES, parseInt(v, 10)));
      }
      if (colorSelect) next.colorScheme = colorSelect.value;
      if (fontSelect) next.font = fontSelect.value;
      next.accessibility = {
        largeText: largeChk ? largeChk.checked : false,
        highContrast: highChk ? highChk.checked : false,
      };
      const llmNext = normalizeLlmSettings(settings && settings.llm);
      const providerId =
        llmProvider && llmProvider.value && llmNext.providers[llmProvider.value]
          ? llmProvider.value
          : llmNext.providerId;
      llmNext.providerId = providerId;
      llmNext.streaming = llmStreaming ? !!llmStreaming.checked : llmNext.streaming;
      llmNext.preferResponsesApi = llmResponses ? !!llmResponses.checked : llmNext.preferResponsesApi;
      const providerCfg = llmNext.providers[providerId] || llmNext.providers.local;
      if (llmBaseURL) providerCfg.baseURL = llmBaseURL.value.trim();
      if (llmModel) providerCfg.model = llmModel.value.trim();
      if (llmApiKey) providerCfg.apiKey = llmApiKey.value.trim();
      if (llmCustomRequiresApiKey) {
        llmNext.providers.custom.requiresApiKey = !!llmCustomRequiresApiKey.checked;
      }
      next.llm = normalizeLlmSettings(llmNext);
      const decSepSel = document.getElementById('settingsDecimalSeparator');
      const csvDelimSel = document.getElementById('settingsCsvDelimiter');
      if (decSepSel) next.decimalSeparator = decSepSel.value || '.';
      if (csvDelimSel) next.csvDelimiter = csvDelimSel.value || 'auto';
      if (langSelect && langSelect.value) next.language = langSelect.value;
      if (unitSysSelect && unitSysSelect.value) next.unitSystem = unitSysSelect.value;
      if (thouSepSel) next.thousandsSeparator = typeof thouSepSel.value === 'string' ? thouSepSel.value : '';
      setSettings(next);
      // Apply language change immediately to the UI.
      try {
        if (window.LCi18n && next.language) {
          window.LCi18n.setLocale(next.language);
        }
      } catch (e) {}
      // Re-render parts of the UI whose strings come from JS so they update
      // immediately when the language or separators change.
      try {
        renderExamples();
      } catch (e) {}
      try {
        if (typeof handleInput === 'function') handleInput();
      } catch (e) {}
      const modal = document.getElementById('settingsModal');
      if (modal) modal.classList.add('hidden');
      // update AI chat visibility
      try {
        if (typeof window.lcAI !== 'undefined') window.lcAI.updateVisibility();
      } catch (e) {}
      showToast(t('toast.settingsSaved', 'Settings saved'));
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
        showToast(t('toast.nothingToSave', 'Nothing to save'));
        return;
      }

      const history = getHistory();
      const timestamp = new Date().toLocaleString();
      const entry = {
        id: Date.now(),
        timestamp: timestamp,
        content: editorContent,
      };

      history.unshift(entry);
      // Keep only last 20 entries
      if (history.length > 20) {
        history.splice(20);
      }

      saveHistory(history);
      renderHistory();
      showToast(t('toast.savedToHistory', 'Saved to history'));
    },

    loadFromHistory: (id) => {
      const history = getHistory();
      const entry = history.find((e) => e.id === id);
      if (entry) {
        editor.value = entry.content;
        handleInput();
        showToast(t('toast.loadedFromHistory', 'Loaded from history'));
      }
    },

    deleteFromHistory: (id) => {
      const history = getHistory();
      const filtered = history.filter((e) => e.id !== id);
      saveHistory(filtered);
      renderHistory();
      showToast(t('toast.deletedFromHistory', 'Deleted from history'));
    },
    // Examples API
    loadExample: (id) => loadExample(id),
    insertExampleToEditor: (id) => insertExampleToEditor(id),
    // LLM API
    getEditorContent: () => (editor ? editor.value : ''),
    insertIntoEditor: (text) => {
      if (!editor) return;
      const pos = editor.selectionEnd;
      const val = editor.value;
      const before = val.slice(0, pos);
      const after = val.slice(pos);
      const insert = (before.length > 0 && !before.endsWith('\n') ? '\n' : '') + text;
      editor.value = before + insert + after;
      editor.selectionStart = editor.selectionEnd = pos + insert.length;
      editor.dispatchEvent(new Event('input'));
    },
    getLlmSettings: () =>
      settings && settings.llm ? normalizeLlmSettings(settings.llm) : normalizeLlmSettings(defaultSettings.llm),
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
      historyContent.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">' + escapeHtml(t('sidebar.history.empty', 'No history saved yet')) + '</div>';
      return;
    }

    const loadLabel = escapeHtml(t('sidebar.examples.load', 'Load'));
    const deleteLabel = escapeHtml(t('history.delete', 'Delete'));

    historyContent.innerHTML = history
      .map(
        (entry) => `
      <div class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700">
        <div class="flex-1 overflow-hidden mr-2">
          <div class="text-[10px] text-gray-400 mb-1">${entry.timestamp}</div>
          <div class="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">${entry.content.split('\n')[0]}</div>
        </div>
        <div class="flex gap-1 flex-shrink-0">
          <button onclick="app.loadFromHistory(${entry.id})" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300">${loadLabel}</button>
          <button onclick="app.deleteFromHistory(${entry.id})" class="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300">${deleteLabel}</button>
        </div>
      </div>
    `
      )
      .join('');
  }

  return api;
})();

// Expose `app` on the window so other inline scripts can call `window.app.*` safely.
try {
  window.app = app;
} catch (e) {}
window.onload = app.init;
