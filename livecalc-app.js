const app = (() => {
  // -- DOM Elements --
  const editor = document.getElementById("editor");
  const backdrop = document.getElementById("backdrop");
  const lineNumbers = document.getElementById("lineNumbers");
  const variablesList = document.getElementById("variablesList");
  const varCount = document.getElementById("varCount");
  const plotContainer = document.getElementById("plot");
  const sidebar = document.getElementById("sidebar");

  // -- Configuration --
  let isDark =
    localStorage.getItem("theme") === "dark" ||
    (!("theme" in localStorage) &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  // MathJS config
  math.config({
    number: "BigNumber",
    precision: 64,
  });

  // ------------------------------------------------------------------
  // Define common currency units as simple base units so expressions
  // like `10000 USD` parse correctly. These are dimensionless units
  // for formatting/summing purposes.
  // Also provide a small FX table (rates expressed as USD per unit)
  // and helper to normalize currency symbols (€, $, £ etc.).
  // ------------------------------------------------------------------
  const currencyUnits = new Set(["USD", "EUR", "GBP", "JPY", "CHF"]);
  const fxRates = { USD: 1.0, EUR: 1.08, GBP: 1.25, JPY: 0.0072, CHF: 1.09 };
  try {
    ["USD", "EUR", "GBP", "JPY", "CHF"].forEach((c) => {
      try {
        math.createUnit(c);
      } catch (e) {
        /* ignore if already present */
      }
    });
  } catch (e) {
    /* non-fatal */
  }

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
  const defaultSettings = {
    roundDecimals: 2,
    colorScheme: 'default', // options: default, warm, midnight, solarized, ocean, monochrome
    font: "'Fira Code', 'Menlo', 'Monaco', monospace",
    accessibility: {
      largeText: false,
      highContrast: false
    }
  };
  let settings = loadSettings();

  // Prevent updateHash from overwriting an incoming shared hash during initial load.
  let suppressHashUpdate = false;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return Object.assign({}, defaultSettings);
      const parsed = JSON.parse(raw);
      return Object.assign({}, defaultSettings, parsed);
    } catch (e) {
      return Object.assign({}, defaultSettings);
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
  }

  function setSettings(next) {
    settings = Object.assign({}, settings, next || {});
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
      try { localStorage.setItem('livecalc:lastDataset', name); } catch (e) {}
    } catch (e) {}
    return true;
  }

  function parseCSV(text, delim = ",") {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) return [];
    const headers = lines[0].split(delim).map((h) => h.trim());
    const rows = lines.slice(1).map((ln) => {
      const parts = ln.split(delim).map((p) => p.trim());
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        let v = parts[i] === undefined ? "" : parts[i];
        // try number
        const num = Number(v.replace(/,/g, ""));
        obj[headers[i]] = isFinite(num) && v !== "" ? num : v;
      }
      return obj;
    });
    return rows;
  }

  function parseXML(text) {
    try {
      const doc = new DOMParser().parseFromString(text, "text/xml");
      // find the first repeating child collection
      const root = doc.documentElement;
      // find child node name which repeats
      const counts = {};
      for (let i = 0; i < root.children.length; i++) {
        const n = root.children[i].nodeName;
        counts[n] = (counts[n] || 0) + 1;
      }
      let repeated = null;
      for (const k in counts) if (counts[k] > 1) { repeated = k; break; }
      const arr = [];
      if (repeated) {
        const elems = root.getElementsByTagName(repeated);
        for (let i = 0; i < elems.length; i++) {
          const e = elems[i];
          const obj = {};
          for (let j = 0; j < e.children.length; j++) {
            const c = e.children[j];
            const txt = c.textContent.trim();
            const num = Number(txt.replace(/,/g, ""));
            obj[c.nodeName] = isFinite(num) && txt !== "" ? num : txt;
          }
          arr.push(obj);
        }
      } else {
        // fallback: use children of root as single object
        const obj = {};
        for (let j = 0; j < root.children.length; j++) {
          const c = root.children[j];
          const txt = c.textContent.trim();
          const num = Number(txt.replace(/,/g, ""));
          obj[c.nodeName] = isFinite(num) && txt !== "" ? num : txt;
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
    if (!data || !Array.isArray(data)) throw new Error("Dataset not found: " + datasetName);
    let rows = data;
    if (whereExpr) {
      // very small sandbox: create a function with r in scope
      try {
        const fn = new Function('r', 'with(r){ return (' + whereExpr + '); }');
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
      return typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]+/g, ''));
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

  // Initialize section states from localStorage
  function initSectionStates() {
    ['graph', 'variables', 'dataset', 'history'].forEach(section => {
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

  // -- Initialization --
  function init() {
    applyTheme();
    applySettings();
    
    // Load history on init
    renderHistory();
    
    // Initialize section collapse states (defer to next tick to allow DOM to be ready)
    setTimeout(() => {
      initSectionStates();
    }, 0);

    // Load content
    suppressHashUpdate = true; // avoid overwriting incoming hash during initial load
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
      // Default welcome text
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
          let data = [];
          try {
            if (ext === 'csv' || f.type === 'text/csv') data = parseCSV(text, ',');
            else if (ext === 'tsv' || f.type === 'text/tab-separated-values') data = parseCSV(text, '\t');
            else if (ext === 'json' || f.type === 'application/json') data = JSON.parse(text);
            else if (ext === 'xml' || f.type === 'text/xml' || f.type === 'application/xml') data = parseXML(text);
            else {
              // try JSON first
              try { data = JSON.parse(text); } catch (e) { data = parseCSV(text, ','); }
            }
          } catch (e) {
            showToast('Failed to parse file');
            return;
          }
          // normalize non-array JSON to array
          if (!Array.isArray(data)) data = [data];
          // ask user for dataset name
          const base = nameParts.join('.') || 'data';
          let dsName = base.replace(/[^A-Za-z0-9_]/g, '_');
          let attempt = dsName;
          let i = 1;
          while (datasets[attempt]) { attempt = dsName + '_' + (i++); }
          dsName = attempt;
          // prompt user to rename (non-blocking)
          const custom = prompt('Dataset name', dsName);
          if (custom && custom.trim()) dsName = custom.trim().replace(/[^A-Za-z0-9_]/g, '_');
          registerDataset(dsName, data);
          showToast('Imported ' + f.name + ' as ' + dsName);
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

    // Initial render (don't update URL during this first pass)
    handleInput();
    // allow subsequent edits to update the hash
    suppressHashUpdate = false;
  }

  // -- Core Logic --

  function handleInput() {
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
    let blockSum = math.bignumber(0);
    let baseUnit = null; // normalized unit for current block

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const trimmed = line.trim();

      // Skip empty or comments for eval
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
        outputLines.push(null);
        // blank line resets block sum
        if (trimmed === "") {
          blockSum = math.bignumber(0);
          lastUnit = null;
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
          parser.evaluate(trimmed); // register function in scope
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
            outputLines.push({ value: String(val), type: "result" });
          } catch (e) {
            outputLines.push({ value: e.message, type: "error" });
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
          const display = lastUnit
            ? blockSum.toString() + " " + lastUnit
            : math.format(blockSum, { precision: 14 });
          outputLines.push({ value: display, type: "sum" });
        } catch (e) {
          outputLines.push({ value: e.message, type: "error" });
        }
        blockSum = math.bignumber(0); // Reset block sum
        lastUnit = null;
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
          outputLines.push({ value: String(val), type: 'result' });
        } catch (e) {
          outputLines.push({ value: e.message, type: 'error' });
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
          // Only sum numbers or units in a consistent unit
          try {
            if (res && res.isUnit) {
              // Attempt to extract primary unit name and convert to baseUnit
              const u =
                (res.units &&
                  res.units[0] &&
                  res.units[0].unit &&
                  res.units[0].unit.name) ||
                null;
              if (u) {
                // If this is a currency unit and baseUnit is another currency,
                // use fxRates for conversion since mathjs won't convert different base units.
                const isCurrency = currencyUnits.has(u);
                const baseIsCurrency = baseUnit && currencyUnits.has(baseUnit);
                try {
                  // If this is the first unit in the block, choose it as baseUnit
                  if (!baseUnit) baseUnit = u;
                  let numeric;
                  if (isCurrency && baseIsCurrency) {
                    // Convert via fxRates: amount_in_base = amount * (rate[source] / rate[base])
                    const amount =
                      res.value && res.value.toString
                        ? math.bignumber(res.value.toString())
                        : math.bignumber(res.value || 0);
                    const rSrc = fxRates[u] || 1;
                    const rBase = fxRates[baseUnit] || 1;
                    numeric = math
                      .bignumber(amount)
                      .mul(math.bignumber(rSrc))
                      .div(math.bignumber(rBase));
                  } else {
                    // Try to convert the current unit to baseUnit using mathjs
                    numeric = math.bignumber(res.toNumber(baseUnit));
                  }
                  blockSum = math.add(blockSum, math.bignumber(numeric));
                } catch (e) {
                  // Conversion to baseUnit failed. Try converting baseUnit to this unit to see if we can normalize the other way around.
                  if (baseUnit) {
                    try {
                      // convert existing blockSum to current unit and set new baseUnit
                      let converted;
                      if (currencyUnits.has(u) && currencyUnits.has(baseUnit)) {
                        // convert blockSum (which is numeric in baseUnit) into new unit u
                        const rSrc = fxRates[baseUnit] || 1; // baseUnit currently
                        const rTarget = fxRates[u] || 1;
                        converted = math
                          .bignumber(blockSum)
                          .mul(math.bignumber(rSrc))
                          .div(math.bignumber(rTarget));
                      } else {
                        converted = math.bignumber(
                          math.unit(blockSum.toString(), baseUnit).toNumber(u),
                        );
                      }
                      // replace blockSum with converted and set baseUnit to current unit
                      blockSum = converted;
                      baseUnit = u;
                      // now add current numeric value (converted from res to baseUnit which is now u)
                      const numeric = res.toNumber(baseUnit);
                      blockSum = math.add(blockSum, math.bignumber(numeric));
                    } catch (e2) {
                      // incompatible units — skip adding to sum
                    }
                  }
                }
              }
            } else if (typeof res === "number") {
              blockSum = math.add(blockSum, math.bignumber(res));
            } else if (res && res.isBigNumber) {
              blockSum = math.add(blockSum, res);
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
      } else if (typeof val !== "function") {
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
      /(\s+|[A-Za-z_][A-Za-z0-9_]*|\d+\.\d+|\d+|==|!=|<=|>=|\+|\-|\*|\/|\^|=|\(|\)|\[|\]|,|\.|%)/g;
    const tokens = escaped.match(tokenRE) || [escaped];

    let out = "";
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
        out += `<span class="token-operator">${tok}</span>`;
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
          out += `<span class="token-variable">${tok}</span>`;
        } else {
          out += tok;
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
      let displayVal = formatResult(val);
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
        html += `
          <div role="button" tabindex="0" onclick="app.insert('${key}')" class="group flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-colors cursor-pointer" title="Insert dataset name">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-green-600 dark:text-green-400 font-mono">${key}</span>
              <span class="text-xs text-gray-400">rows</span>
              <span class="text-xs font-mono text-gray-700 dark:text-gray-300">${(datasets[key] && datasets[key].length) || 0}</span>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="(function(e,k){ if(e && e.stopPropagation) e.stopPropagation(); if(window.app && window.app.previewDataset) window.app.previewDataset(k); })(event,'${key}')" class="text-[10px] bg-gray-50 text-gray-700 px-2 py-0.5 rounded">Preview</button>
              <button onclick="(function(e,k){ if(e && e.stopPropagation) e.stopPropagation(); const ans=prompt('Rename dataset', k); if(ans) { if(window.app && window.app.renameDataset) window.app.renameDataset(k, ans); } })(event,'${key}')" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Rename</button>
            </div>
          </div>
        `;
      });
    }

    variablesList.innerHTML = html;
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
    const keys = rows.length ? Object.keys(rows[0]) : (data.length ? Object.keys(data[0]) : []);
    head.innerHTML = '<tr>' + keys.map(k => `<th class="text-left px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">${escapeHtml(k)}</th>`).join('') + '</tr>';
    body.innerHTML = rows.map(r => '<tr class="hover:bg-gray-50 dark:hover:bg-gray-800">' + keys.map(k => `<td class="px-2 py-1 text-xs text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">${escapeHtml(String(r[k] === undefined ? '' : r[k]))}</td>`).join('') + '</tr>').join('');
    
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
    sel.innerHTML = '<option value="">Select dataset</option>' + keys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
    // restore previous selection if possible
    let chosen = cur && keys.includes(cur) ? cur : (localStorage.getItem('livecalc:lastDataset') || (keys.length ? keys[0] : ''));
    if (chosen && keys.includes(chosen)) {
      sel.value = chosen;
      // render preview for chosen
      renderDatasetPreview(chosen, document.getElementById('previewRowsSelect') ? document.getElementById('previewRowsSelect').value : 10);
    }
    // change handler attached during init to avoid duplicates
  }

  // -- Helper Functions --
  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatResult(res) {
    const rd = (settings && typeof settings.roundDecimals === 'number') ? settings.roundDecimals : null;
    if (res && res.isBigNumber) {
      if (rd !== null) {
        try {
          if (typeof res.toFixed === 'function') return res.toFixed(rd);
          // fallback: convert to number and format (may lose precision for huge values)
          return Number(res.toNumber()).toFixed(rd);
        } catch (e) {
          return math.format(res, { precision: 14 });
        }
      }
      return math.format(res, { precision: 14 });
    }
    if (res && res.isUnit) {
      try {
        if (rd !== null) {
          const n = res.toNumber();
          const unitName = (res.units && res.units[0] && res.units[0].unit && res.units[0].unit.name) ? res.units[0].unit.name : '';
          // n may be BigNumber or Number; ensure formatting
          if (typeof n === 'number') return (isFinite(n) ? n.toFixed(rd) : String(n)) + (unitName ? ' ' + unitName : '');
          try {
            // try BigNumber toFixed
            if (n && typeof n.toFixed === 'function') return n.toFixed(rd) + (unitName ? ' ' + unitName : '');
          } catch (e) {}
          return String(n) + (unitName ? ' ' + unitName : '');
        }
      } catch (e) {}
      return res.toString();
    }
    if (typeof res === "object")
      return JSON.stringify(res.entries || res).replace(/"/g, "");
    if (typeof res === 'number') {
      if (rd !== null) return res.toFixed(rd);
      return String(res);
    }
    return res !== undefined && res !== null ? res.toString() : '';
  }

  function syncScroll() {
    // Sync backdrop and line numbers
    backdrop.parentElement.scrollTop = editor.scrollTop;
    lineNumbers.scrollTop = editor.scrollTop;
  }

  function handleKeydown(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    }
  }

  function getRandomColor(str) {
    // Consistent color from string
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return "#" + "00000".substring(0, 6 - c.length) + c;
  }

  function b64_to_utf8(str) {
    try {
      // atob -> percent-encode each byte -> decodeURIComponent to get UTF-8 string
      const bin = window.atob(str);
      let esc = '';
      for (let i = 0; i < bin.length; i++) {
        const code = bin.charCodeAt(i).toString(16).toUpperCase();
        esc += '%' + ('00' + code).slice(-2);
      }
      return decodeURIComponent(esc);
    } catch (e) {
      // fallback to older approach or raw atob
      try { return decodeURIComponent(escape(window.atob(str))); } catch (e2) { try { return window.atob(str); } catch (e3) { return ''; } }
    }
  }
  function utf8_to_b64(str) {
    try {
      // encodeURIComponent -> percent-encoded UTF-8 -> convert percent escapes to raw bytes for btoa
      const utf8 = encodeURIComponent(str);
      // convert percent encodings to raw bytes
      const bytes = utf8.replace(/%([0-9A-F]{2})/g, function(match, p1) {
        return String.fromCharCode('0x' + p1);
      });
      return window.btoa(bytes);
    } catch (e) {
      try { return window.btoa(unescape(encodeURIComponent(str))); } catch (e2) { return window.btoa(str); }
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
    const toggleBtn = document.getElementById("sidebarToggle");
    const open = sidebar.classList.toggle("open");
    // Update ARIA attributes for accessibility
    if (toggleBtn)
      toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    sidebar.setAttribute("aria-hidden", open ? "false" : "true");
    // When opening, focus first focusable element in sidebar for keyboard users
    if (open) {
      const first = sidebar.querySelector("button, [tabindex]");
      if (first) first.focus();
    }
  }

  // Close sidebar on Escape for accessibility
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (sidebar.classList.contains("open")) {
        sidebar.classList.remove("open");
        sidebar.setAttribute("aria-hidden", "true");
        const toggleBtn = document.getElementById("sidebarToggle");
        if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn && toggleBtn.focus();
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
    resetGraph,
      previewDataset: (name, n) => { renderDatasetPreview(name, n); },
      clearDatasetPreview: () => { clearDatasetPreview(); },
    renameDataset: (oldName, newName) => {
      if (!datasets[oldName] || !newName) return false;
      const clean = newName.trim().replace(/[^A-Za-z0-9_]/g, '_');
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
        const largeChk = document.getElementById('settingsLargeText');
        const highChk = document.getElementById('settingsHighContrast');
        if (roundInput) roundInput.value = (settings && typeof settings.roundDecimals === 'number') ? settings.roundDecimals : '';
        if (colorSelect) colorSelect.value = settings.colorScheme || 'default';
        if (fontSelect) fontSelect.value = settings.font || defaultSettings.font;
        if (largeChk && settings && settings.accessibility) largeChk.checked = !!settings.accessibility.largeText;
        if (highChk && settings && settings.accessibility) highChk.checked = !!settings.accessibility.highContrast;
        modal.classList.remove('hidden');
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
  
  return api;
})();

// Expose `app` on the window so other inline scripts can call `window.app.*` safely.
try { window.app = app; } catch (e) {}
window.onload = app.init;
