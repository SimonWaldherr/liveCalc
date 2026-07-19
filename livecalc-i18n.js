/**
 * livecalc-i18n.js — Lightweight i18n layer for LiveCalc.
 *
 * Provides:
 *   LCi18n.t(key, params)          → translated string with {placeholder} support
 *   LCi18n.setLocale(loc)          → switch language; updates <html lang> and re-applies translations
 *   LCi18n.getLocale()             → current locale code
 *   LCi18n.getAvailableLocales()   → [{ code, label }, ...]
 *   LCi18n.applyTranslations(root) → walk DOM and translate elements with [data-i18n] / [data-i18n-attr]
 *   LCi18n.formatNumber(n, opts)   → locale-aware number formatting (decimal/thousands separator)
 *   LCi18n.detectLocale()          → best-guess locale from navigator
 *
 * Element annotation conventions:
 *   <span data-i18n="settings.title">Settings</span>
 *   <input data-i18n-attr="placeholder:editor.placeholder,title:editor.title" />
 *
 * The module is plain ES5-ish so it works in browsers without a build step.
 * It dispatches a `livecalc:locale-changed` CustomEvent on document whenever
 * the locale changes, so other modules (LLM, AI panel) can react.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Translation catalogs.
  // Keep keys flat (dot-separated) and stable; values may contain
  // {param} placeholders which t() will substitute.
  // ---------------------------------------------------------------
  var CATALOGS = {
    en: {
      'app.title': 'LiveCalc Pro - Interactive Math Studio',
      'app.tagline': 'Interactive Math Studio',
      'app.poweredBy': 'Powered by Math.js & Function Plot',

      // Header buttons / tooltips
      'header.toggleDarkMode': 'Toggle Dark Mode',
      'header.aiChat': 'AI Chat',
      'header.aiChatToggle': 'Toggle AI Chat',
      'header.hideSidebar': 'Hide sidebar',
      'header.showSidebar': 'Show sidebar',
      'header.examples': 'Examples',
      'header.examplesOpen': 'Open examples menu',
      'header.download': 'Download',
      'header.downloadAria': 'Download math as text',
      'header.settings': 'Settings',
      'header.copyLink': 'Copy link',
      'header.copyLinkAria': 'Copy link to clipboard',
      'header.uploadData': 'Upload data file',
      'header.clearAll': 'Clear All',

      // Helper toolbar
      'helper.sqrt': 'Square Root',
      'helper.power': 'Power',
      'helper.pi': 'Pi',
      'helper.sin': 'Sine',
      'helper.cos': 'Cosine',

      // Examples menu items
      'examples.menu.geometry': 'Geometry — circle area',
      'examples.menu.finance': 'Finance — compound interest',
      'examples.menu.solarPayback': 'Solar payback — interactive demo',
      'examples.menu.sum': 'Sum — mixed units',
      'examples.menu.random': 'Random example',
      'examples.menu.table': 'Table — CSV import & query',
      'examples.menu.dataplot': 'Data Plot — avg price per region',

      // Example cards (sidebar)
      'examples.geometry.title': 'Geometry — Circle Area',
      'examples.geometry.desc': 'radius = 5 cm\narea = pi * radius^2\nperimeter = 2 * pi * radius',
      'examples.finance.title': 'Finance — Compound Interest',
      'examples.finance.desc': 'P = 10000 USD\nr = 0.05\nt = 10\nA = P * (1 + r)^t',
      'examples.solarPayback.title': 'Solar Payback — Interactive Model',
      'examples.solarPayback.desc': 'Adjust costs, annual generation, and self-consumption. Inspect the payback formula and share the model.',
      'examples.sum.title': 'Sum — Mixed Units',
      'examples.sum.desc': 'val1 = 10 m\nval2 = 20 cm\nsum',
      'examples.table.title': 'Table — CSV import & query',
      'examples.table.desc': 'Instructions for using demo dataset',
      'examples.dataplot.title': 'Data Plot — avg price per region',
      'examples.dataplot.desc': 'Example for data-driven plotting',
      'examples.conv_all.title': 'Conversions — Mixed examples',
      'examples.conv_all.desc':
        'Common conversions (weight, pressure, area, volume, force, mass, temperature, currency)',

      // Editor
      'editor.placeholder': 'Type math here... e.g. a = 10 + 5',

      // Sidebar sections
      'sidebar.graph': 'Graph',
      'sidebar.graph.hint': 'f(x), g(x)',
      'sidebar.graph.reset': 'Reset',
      'sidebar.variables': 'Variables',
      'sidebar.variables.count': '{count} defined',
      'sidebar.variables.functions': 'Functions',
      'sidebar.variables.plot': 'Plot',
      'sidebar.datasets': 'Datasets',
      'sidebar.datasets.select': 'Select dataset',
      'sidebar.datasets.rows5': '5 rows',
      'sidebar.datasets.rows10': '10 rows',
      'sidebar.datasets.rows25': '25 rows',
      'sidebar.datasets.upload': 'Upload',
      'sidebar.datasets.empty': 'No dataset loaded',
      'sidebar.examples': 'Examples',
      'sidebar.examples.hint': 'Load example snippets',
      'sidebar.examples.load': 'Load',
      'sidebar.examples.insert': 'Insert',
      'sidebar.examples.empty': 'No examples available',
      'sidebar.history': 'History',
      'sidebar.history.save': 'Save',
      'sidebar.history.empty': 'No history saved yet',
      'sidebar.variables.empty': 'No variables defined yet.',
      'history.delete': 'Delete',

      // AI panel
      'ai.section': 'AI Assistant',
      'ai.placeholder': 'Ask the AI about your calculation…',
      'ai.input.placeholder': 'Ask a question or describe what to calculate…',
      'ai.send': 'Send (Ctrl+Enter)',
      'ai.cancel': 'Cancel request',
      'ai.help': 'Ctrl+Enter to send • The AI sees your current calculation',
      'ai.status.connected': 'Connected',
      'ai.status.thinking': 'Thinking...',
      'ai.status.streaming': 'Streaming...',
      'ai.status.cancelled': 'Cancelled',
      'ai.status.error': 'Error',
      'ai.thinking': 'Thinking...',
      'ai.insertButton': 'Insert into editor',
      'ai.error.empty': 'No text content was returned by the provider.',
      'ai.error.unknown': 'Unknown error while contacting LLM provider.',
      'ai.error.noBaseUrl': 'The LiveCalc AI backend route is unavailable.',
      'ai.error.noModel': 'Please set a model name in Settings.',
      'ai.error.configure': 'Please configure LLM settings first.',
      'ai.error.prefix': 'Error: {message}',

      // LLM transport errors
      'llm.error.mixedContent':
        'The HTTPS app cannot load this HTTP endpoint (mixed content). Use HTTPS or localhost.',
      'llm.error.localhostUnreachable':
        'Local LLM server on localhost is not reachable. Check that it is running on this device with CORS enabled.',
      'llm.error.cors':
        'The endpoint blocks browser access (CORS). Allow your app origin on the LLM server.',
      'llm.error.network': 'Network error reaching the LiveCalc AI backend. Check that the app server is running.',
      'llm.error.auth': 'Authentication failed. Check the server-side provider credentials and permissions.',
      'llm.error.notFound': 'LiveCalc AI backend route not found (404). Check the app server.',
      'llm.error.rateLimit': 'Rate limit reached (429). Please try again later.',
      'llm.error.server': 'Provider error ({status}). Please try again later.',
      'llm.error.generic': 'LLM request failed ({status}).',

      // Toasts
      'toast.exampleNotFound': 'Example not found',
      'toast.exampleLoaded': 'Loaded example: {title}',
      'toast.exampleInserted': 'Inserted example: {title}',
      'toast.parseFileFailed': 'Failed to parse file',
      'toast.importedAs': 'Imported {name} as {dsName}',
      'toast.settingsSaved': 'Settings saved',
      'toast.nothingToSave': 'Nothing to save',
      'toast.savedToHistory': 'Saved to history',
      'toast.loadedFromHistory': 'Loaded from history',
      'toast.deletedFromHistory': 'Deleted from history',
      'toast.editorCleared': 'Editor cleared',
      'toast.exampleInsertedShort': 'Example inserted',
      'toast.geometryInserted': 'Geometry example inserted',
      'toast.financeInserted': 'Finance example inserted',
      'toast.tableDemoInserted': 'Table demo inserted',
      'toast.sumInserted': 'Sum example inserted',
      'toast.dataplotInserted': 'Data plot demo inserted',
      'toast.downloaded': 'Downloaded',
      'toast.linkCopied': 'Link copied',
      'toast.insertedIntoEditor': 'Inserted into editor',
      'toast.functionNotPlottable': "Function '{name}' not found or not in a plottable format.",
      'toast.copyFailed': 'Copy failed',
      'toast.copyPrompt': 'Copy this link',
      'dataset.namePrompt': 'Dataset name',

      // Footer / misc
      'footer.tip': 'Tip: type "in m" to convert SI, or "1 in cm" for unit conversion.',

      // Settings modal
      'settings.title': 'Settings',
      'settings.tab.appearance': 'Appearance',
      'settings.tab.ai': 'AI / LLM',
      'settings.reset': 'Reset defaults',
      'settings.cancel': 'Cancel',
      'settings.save': 'Save',
      'settings.close': 'Close',

      'settings.language': 'Language',
      'settings.language.help': 'Select the user-interface language. Number/unit defaults adapt automatically.',

      'settings.decimalPlaces': 'Decimal places',
      'settings.decimalPlaces.placeholder': 'Auto (leave empty for auto-detect)',
      'settings.decimalPlaces.help': 'Leave empty to auto-detect precision from your input numbers.',
      'settings.decimalSeparator': 'Decimal separator',
      'settings.decimalSeparator.dot': 'Dot (1.23)',
      'settings.decimalSeparator.comma': 'Comma (1,23)',
      'settings.thousandsSeparator': 'Thousands separator',
      'settings.thousandsSeparator.none': 'None (1234567)',
      'settings.thousandsSeparator.space': 'Space (1 234 567)',
      'settings.thousandsSeparator.comma': 'Comma (1,234,567)',
      'settings.thousandsSeparator.dot': 'Dot (1.234.567)',
      'settings.thousandsSeparator.apostrophe': "Apostrophe (1'234'567)",
      'settings.unitSystem': 'Unit system',
      'settings.unitSystem.metric': 'Metric / SI (m, kg, l, °C)',
      'settings.unitSystem.imperial': 'Imperial / US (ft, lb, gal, °F)',
      'settings.unitSystem.all': 'Both (no preference)',
      'settings.unitSystem.help': 'Hints the calculator (and the AI) which units to prefer in suggestions.',

      'settings.csvDelimiter': 'CSV delimiter',
      'settings.csvDelimiter.auto': 'Auto-detect',
      'settings.csvDelimiter.comma': 'Comma (,)',
      'settings.csvDelimiter.semicolon': 'Semicolon (;)',
      'settings.csvDelimiter.tab': 'Tab',
      'settings.csvDelimiter.pipe': 'Pipe (|)',
      'settings.colorScheme': 'Color scheme',
      'settings.color.default': 'Default',
      'settings.color.warm': 'Warm',
      'settings.color.midnight': 'Midnight',
      'settings.color.solarized': 'Solarized',
      'settings.color.ocean': 'Ocean',
      'settings.color.monochrome': 'Monochrome',
      'settings.font': 'Editor font',
      'settings.font.firaCode': 'Fira Code',
      'settings.font.menlo': 'Menlo / Mono',
      'settings.font.courier': 'Courier New',
      'settings.font.system': 'System UI',
      'settings.largeText': 'Large text',
      'settings.highContrast': 'High contrast',

      'settings.llm.provider': 'Provider',
      'settings.llm.provider.openai': 'OpenAI',
      'settings.llm.provider.local': 'Local OpenAI-Compatible',
      'settings.llm.provider.custom': 'Custom OpenAI-Compatible',
      'settings.llm.baseUrl': 'Backend route',
      'settings.llm.baseUrl.help': 'Provider URLs are configured on the LiveCalc server.',
      'settings.llm.backend': 'AI backend',
      'settings.llm.backend.help': 'LiveCalc sends requests to its own backend. Provider URLs and API keys stay on the server.',
      'settings.llm.model': 'Model',
      'settings.llm.detect': 'Detect',
      'settings.llm.detect.title': 'Auto-detect available models',
      'settings.llm.model.help': 'Click Detect to load available models from the server.',
      'settings.llm.apiKey': 'Server credential',
      'settings.llm.apiKey.help': 'Credentials are configured on the server and never in this browser.',
      'settings.llm.customRequiresApiKey': 'Custom provider credential is server-side',
      'settings.llm.streaming': 'Use streaming in chat',
      'settings.llm.responsesApi': 'Prefer Responses API (fallback to chat/completions)',
      'settings.llm.reasoningEffort': 'Reasoning',
      'settings.llm.reasoning.none': 'None',
      'settings.llm.reasoning.low': 'Low',
      'settings.llm.reasoning.medium': 'Medium',
      'settings.llm.reasoning.high': 'High',
      'settings.llm.reasoning.xhigh': 'Extra high',
      'settings.llm.reasoning.max': 'Max',
      'settings.llm.verbosity': 'Answer detail',
      'settings.llm.verbosity.low': 'Low',
      'settings.llm.verbosity.medium': 'Medium',
      'settings.llm.verbosity.high': 'High',
      'settings.llm.proMode': 'Use GPT-5.6 Pro mode for difficult requests',
      'settings.llm.gpt56.help':
        'GPT-5.6 uses the Responses API. Medium reasoning is a balanced default; Pro takes longer and uses more tokens.',
      'settings.llm.gpt56.responsesRequired': 'Pro mode requires the Responses API. Re-enable it to use Pro mode.',
      'settings.llm.testConnection': 'Test connection',
      'settings.llm.aiLanguage.help':
        'AI replies in the UI language and is asked to prefer the chosen unit system.',
    },

    de: {
      'app.title': 'LiveCalc Pro – Interaktives Mathe-Studio',
      'app.tagline': 'Interaktives Mathe-Studio',
      'app.poweredBy': 'Bereitgestellt von Math.js & Function Plot',

      'header.toggleDarkMode': 'Dunkelmodus umschalten',
      'header.aiChat': 'KI-Chat',
      'header.aiChatToggle': 'KI-Chat ein-/ausblenden',
      'header.hideSidebar': 'Seitenleiste ausblenden',
      'header.showSidebar': 'Seitenleiste einblenden',
      'header.examples': 'Beispiele',
      'header.examplesOpen': 'Beispiele-Menü öffnen',
      'header.download': 'Herunterladen',
      'header.downloadAria': 'Berechnung als Text herunterladen',
      'header.settings': 'Einstellungen',
      'header.copyLink': 'Link kopieren',
      'header.copyLinkAria': 'Link in die Zwischenablage kopieren',
      'header.uploadData': 'Datendatei hochladen',
      'header.clearAll': 'Alles löschen',

      'helper.sqrt': 'Quadratwurzel',
      'helper.power': 'Potenz',
      'helper.pi': 'Pi',
      'helper.sin': 'Sinus',
      'helper.cos': 'Kosinus',

      'examples.menu.geometry': 'Geometrie – Kreisfläche',
      'examples.menu.finance': 'Finanzen — Zinseszins',
      'examples.menu.solarPayback': 'Solar-Amortisation — interaktive Demo',
      'examples.menu.sum': 'Summe – gemischte Einheiten',
      'examples.menu.random': 'Zufallsbeispiel',
      'examples.menu.table': 'Tabelle – CSV-Import & Abfrage',
      'examples.menu.dataplot': 'Daten-Plot – Ø Preis je Region',

      'examples.geometry.title': 'Geometrie – Kreisfläche',
      'examples.geometry.desc': 'radius = 5 cm\narea = pi * radius^2\nperimeter = 2 * pi * radius',
      'examples.finance.title': 'Finanzen – Zinseszins',
      'examples.finance.desc': 'P = 10000 EUR\nr = 0.05\nt = 10\nA = P * (1 + r)^t',
      'examples.solarPayback.title': 'Solar-Amortisation — interaktives Modell',
      'examples.solarPayback.desc': 'Kosten, Jahresertrag und Eigenverbrauch ändern, die Formel prüfen und das Modell teilen.',
      'examples.sum.title': 'Summe – gemischte Einheiten',
      'examples.sum.desc': 'val1 = 10 m\nval2 = 20 cm\nsum',
      'examples.table.title': 'Tabelle – CSV-Import & Abfrage',
      'examples.table.desc': 'Anleitung zur Demo-Datentabelle',
      'examples.dataplot.title': 'Daten-Plot – Ø Preis je Region',
      'examples.dataplot.desc': 'Beispiel für datengetriebenes Plotten',
      'examples.conv_all.title': 'Umrechnungen – gemischte Beispiele',
      'examples.conv_all.desc':
        'Übliche Umrechnungen (Gewicht, Druck, Fläche, Volumen, Kraft, Masse, Temperatur, Währung)',

      'editor.placeholder': 'Hier Mathe eingeben… z.B. a = 10 + 5',

      'sidebar.graph': 'Graph',
      'sidebar.graph.hint': 'f(x), g(x)',
      'sidebar.graph.reset': 'Zurücksetzen',
      'sidebar.variables': 'Variablen',
      'sidebar.variables.count': '{count} definiert',
      'sidebar.variables.functions': 'Funktionen',
      'sidebar.variables.plot': 'Plot',
      'sidebar.datasets': 'Datensätze',
      'sidebar.datasets.select': 'Datensatz wählen',
      'sidebar.datasets.rows5': '5 Zeilen',
      'sidebar.datasets.rows10': '10 Zeilen',
      'sidebar.datasets.rows25': '25 Zeilen',
      'sidebar.datasets.upload': 'Hochladen',
      'sidebar.datasets.empty': 'Kein Datensatz geladen',
      'sidebar.examples': 'Beispiele',
      'sidebar.examples.hint': 'Beispiel-Snippets laden',
      'sidebar.examples.load': 'Laden',
      'sidebar.examples.insert': 'Einfügen',
      'sidebar.examples.empty': 'Keine Beispiele verfügbar',
      'sidebar.history': 'Verlauf',
      'sidebar.history.save': 'Speichern',
      'sidebar.history.empty': 'Noch kein Verlauf gespeichert',
      'sidebar.variables.empty': 'Noch keine Variablen definiert.',
      'history.delete': 'Löschen',

      'ai.section': 'KI-Assistent',
      'ai.placeholder': 'Frag die KI zu deiner Berechnung…',
      'ai.input.placeholder': 'Frage stellen oder beschreiben, was berechnet werden soll…',
      'ai.send': 'Senden (Strg+Enter)',
      'ai.cancel': 'Anfrage abbrechen',
      'ai.help': 'Strg+Enter zum Senden • Die KI sieht deine aktuelle Berechnung',
      'ai.status.connected': 'Verbunden',
      'ai.status.thinking': 'Denkt nach…',
      'ai.status.streaming': 'Antwortet…',
      'ai.status.cancelled': 'Abgebrochen',
      'ai.status.error': 'Fehler',
      'ai.thinking': 'Denkt nach…',
      'ai.insertButton': 'In Editor einfügen',
      'ai.error.empty': 'Der Provider hat keinen Text zurückgegeben.',
      'ai.error.unknown': 'Unbekannter Fehler beim Aufruf des LLM-Providers.',
      'ai.error.noBaseUrl': 'Die Route zum LiveCalc-KI-Backend ist nicht verfügbar.',
      'ai.error.noModel': 'Bitte einen Modellnamen in den Einstellungen setzen.',
      'ai.error.configure': 'Bitte zuerst die LLM-Einstellungen konfigurieren.',
      'ai.error.prefix': 'Fehler: {message}',

      'llm.error.mixedContent':
        'Die HTTPS-App darf diesen HTTP-Endpoint nicht laden (Mixed Content). Nutze HTTPS oder localhost.',
      'llm.error.localhostUnreachable':
        'Lokaler LLM-Server unter localhost ist nicht erreichbar. Prüfe, ob er auf diesem Gerät läuft und CORS aktiv ist.',
      'llm.error.cors':
        'Der Endpoint blockiert Browser-Zugriffe (CORS). Erlaube den Origin deiner App auf dem LLM-Server.',
      'llm.error.network':
        'Netzwerkfehler beim Zugriff auf das LiveCalc-KI-Backend. Prüfe, ob der App-Server läuft.',
      'llm.error.auth': 'Authentifizierung fehlgeschlagen. Prüfe die serverseitigen Provider-Zugangsdaten und Berechtigungen.',
      'llm.error.notFound': 'Route zum LiveCalc-KI-Backend nicht gefunden (404). Prüfe den App-Server.',
      'llm.error.rateLimit': 'Rate Limit erreicht (429). Bitte später erneut versuchen.',
      'llm.error.server': 'Provider-Fehler ({status}). Bitte später erneut versuchen.',
      'llm.error.generic': 'LLM-Anfrage fehlgeschlagen ({status}).',

      'toast.exampleNotFound': 'Beispiel nicht gefunden',
      'toast.exampleLoaded': 'Beispiel geladen: {title}',
      'toast.exampleInserted': 'Beispiel eingefügt: {title}',
      'toast.parseFileFailed': 'Datei konnte nicht gelesen werden',
      'toast.importedAs': '{name} als {dsName} importiert',
      'toast.settingsSaved': 'Einstellungen gespeichert',
      'toast.nothingToSave': 'Nichts zu speichern',
      'toast.savedToHistory': 'In Verlauf gespeichert',
      'toast.loadedFromHistory': 'Aus Verlauf geladen',
      'toast.deletedFromHistory': 'Aus Verlauf gelöscht',
      'toast.editorCleared': 'Editor geleert',
      'toast.exampleInsertedShort': 'Beispiel eingefügt',
      'toast.geometryInserted': 'Geometrie-Beispiel eingefügt',
      'toast.financeInserted': 'Finanz-Beispiel eingefügt',
      'toast.tableDemoInserted': 'Tabellen-Demo eingefügt',
      'toast.sumInserted': 'Summen-Beispiel eingefügt',
      'toast.dataplotInserted': 'Daten-Plot-Demo eingefügt',
      'toast.downloaded': 'Heruntergeladen',
      'toast.linkCopied': 'Link kopiert',
      'toast.insertedIntoEditor': 'In Editor eingefügt',
      'toast.functionNotPlottable': "Funktion '{name}' nicht gefunden oder nicht plotbar.",
      'toast.copyFailed': 'Kopieren fehlgeschlagen',
      'toast.copyPrompt': 'Diesen Link kopieren',
      'dataset.namePrompt': 'Datensatzname',

      'footer.tip': 'Tipp: schreibe „in m" zum Umrechnen in SI oder „1 in cm" für eine Einheitenumrechnung.',

      'settings.title': 'Einstellungen',
      'settings.tab.appearance': 'Darstellung',
      'settings.tab.ai': 'KI / LLM',
      'settings.reset': 'Zurücksetzen',
      'settings.cancel': 'Abbrechen',
      'settings.save': 'Speichern',
      'settings.close': 'Schließen',

      'settings.language': 'Sprache',
      'settings.language.help': 'Sprache der Oberfläche wählen. Zahlen- und Einheitenvorgaben passen sich automatisch an.',

      'settings.decimalPlaces': 'Nachkommastellen',
      'settings.decimalPlaces.placeholder': 'Automatisch (leer lassen)',
      'settings.decimalPlaces.help': 'Leer lassen, um die Genauigkeit aus den Eingaben zu erkennen.',
      'settings.decimalSeparator': 'Dezimaltrennzeichen',
      'settings.decimalSeparator.dot': 'Punkt (1.23)',
      'settings.decimalSeparator.comma': 'Komma (1,23)',
      'settings.thousandsSeparator': 'Tausendertrennzeichen',
      'settings.thousandsSeparator.none': 'Keins (1234567)',
      'settings.thousandsSeparator.space': 'Leerzeichen (1 234 567)',
      'settings.thousandsSeparator.comma': 'Komma (1,234,567)',
      'settings.thousandsSeparator.dot': 'Punkt (1.234.567)',
      'settings.thousandsSeparator.apostrophe': "Apostroph (1'234'567)",
      'settings.unitSystem': 'Einheitensystem',
      'settings.unitSystem.metric': 'Metrisch / SI (m, kg, l, °C)',
      'settings.unitSystem.imperial': 'Imperial / US (ft, lb, gal, °F)',
      'settings.unitSystem.all': 'Beide (keine Präferenz)',
      'settings.unitSystem.help': 'Beeinflusst Vorschläge des Rechners und der KI.',

      'settings.csvDelimiter': 'CSV-Trennzeichen',
      'settings.csvDelimiter.auto': 'Automatisch erkennen',
      'settings.csvDelimiter.comma': 'Komma (,)',
      'settings.csvDelimiter.semicolon': 'Semikolon (;)',
      'settings.csvDelimiter.tab': 'Tabulator',
      'settings.csvDelimiter.pipe': 'Pipe (|)',
      'settings.colorScheme': 'Farbschema',
      'settings.color.default': 'Standard',
      'settings.color.warm': 'Warm',
      'settings.color.midnight': 'Mitternacht',
      'settings.color.solarized': 'Solarized',
      'settings.color.ocean': 'Ozean',
      'settings.color.monochrome': 'Monochrom',
      'settings.font': 'Editor-Schrift',
      'settings.font.firaCode': 'Fira Code',
      'settings.font.menlo': 'Menlo / Mono',
      'settings.font.courier': 'Courier New',
      'settings.font.system': 'System-UI',
      'settings.largeText': 'Große Schrift',
      'settings.highContrast': 'Hoher Kontrast',

      'settings.llm.provider': 'Anbieter',
      'settings.llm.provider.openai': 'OpenAI',
      'settings.llm.provider.local': 'Lokaler OpenAI-kompatibler Server',
      'settings.llm.provider.custom': 'Eigener OpenAI-kompatibler Server',
      'settings.llm.baseUrl': 'Backend-Route',
      'settings.llm.baseUrl.help': 'Provider-URLs werden auf dem LiveCalc-Server konfiguriert.',
      'settings.llm.backend': 'KI-Backend',
      'settings.llm.backend.help':
        'LiveCalc sendet Anfragen an sein eigenes Backend. Provider-URLs und API-Schlüssel bleiben auf dem Server.',
      'settings.llm.model': 'Modell',
      'settings.llm.detect': 'Erkennen',
      'settings.llm.detect.title': 'Verfügbare Modelle automatisch erkennen',
      'settings.llm.model.help': 'Auf „Erkennen" klicken, um verfügbare Modelle abzurufen.',
      'settings.llm.apiKey': 'Server-Zugangsdaten',
      'settings.llm.apiKey.help': 'Zugangsdaten werden auf dem Server konfiguriert, nie in diesem Browser.',
      'settings.llm.customRequiresApiKey': 'Zugangsdaten für eigene Anbieter sind serverseitig',
      'settings.llm.streaming': 'Streaming im Chat verwenden',
      'settings.llm.responsesApi': 'Responses-API bevorzugen (Fallback auf chat/completions)',
      'settings.llm.reasoningEffort': 'Reasoning',
      'settings.llm.reasoning.none': 'Keins',
      'settings.llm.reasoning.low': 'Niedrig',
      'settings.llm.reasoning.medium': 'Mittel',
      'settings.llm.reasoning.high': 'Hoch',
      'settings.llm.reasoning.xhigh': 'Sehr hoch',
      'settings.llm.reasoning.max': 'Maximal',
      'settings.llm.verbosity': 'Antwortumfang',
      'settings.llm.verbosity.low': 'Kurz',
      'settings.llm.verbosity.medium': 'Mittel',
      'settings.llm.verbosity.high': 'Ausführlich',
      'settings.llm.proMode': 'GPT-5.6-Pro-Modus für schwierige Anfragen verwenden',
      'settings.llm.gpt56.help':
        'GPT-5.6 verwendet die Responses-API. Mittleres Reasoning ist ausgewogen; Pro braucht länger und mehr Tokens.',
      'settings.llm.gpt56.responsesRequired': 'Der Pro-Modus benötigt die Responses-API. Aktiviere sie wieder für Pro.',
      'settings.llm.testConnection': 'Verbindung testen',
      'settings.llm.aiLanguage.help':
        'Die KI antwortet in der UI-Sprache und wird gebeten, das gewählte Einheitensystem zu bevorzugen.',
    },
  };

  var AVAILABLE_LOCALES = [
    { code: 'en', label: 'English' },
    { code: 'de', label: 'Deutsch' },
  ];

  var DEFAULT_LOCALE = 'en';
  var currentLocale = DEFAULT_LOCALE;

  function detectLocale() {
    try {
      var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || navigator.userLanguage || '']) || [];
      for (var i = 0; i < langs.length; i++) {
        var l = String(langs[i] || '').toLowerCase();
        if (!l) continue;
        if (l.indexOf('de') === 0) return 'de';
        if (l.indexOf('en') === 0) return 'en';
      }
    } catch (e) {}
    return DEFAULT_LOCALE;
  }

  function getCatalog(loc) {
    return CATALOGS[loc] || CATALOGS[DEFAULT_LOCALE] || {};
  }

  function format(str, params) {
    if (!params) return str;
    return String(str).replace(/\{(\w+)\}/g, function (_, k) {
      return params[k] !== undefined && params[k] !== null ? String(params[k]) : '{' + k + '}';
    });
  }

  function t(key, params) {
    if (!key) return '';
    var cat = getCatalog(currentLocale);
    var v = cat[key];
    if (v === undefined) {
      // Fallback chain: default locale, then key itself
      var fallback = getCatalog(DEFAULT_LOCALE)[key];
      v = fallback !== undefined ? fallback : key;
    }
    return format(v, params);
  }

  function applyTranslations(root) {
    root = root || document;
    try {
      // Text content nodes
      var elems = root.querySelectorAll('[data-i18n]');
      for (var i = 0; i < elems.length; i++) {
        var el = elems[i];
        var key = el.getAttribute('data-i18n');
        if (!key) continue;
        // Only update if there is a translation; preserve original on missing keys.
        var cat = getCatalog(currentLocale);
        if (cat[key] !== undefined || getCatalog(DEFAULT_LOCALE)[key] !== undefined) {
          el.textContent = t(key);
        }
      }
      // Attribute translations: data-i18n-attr="placeholder:editor.placeholder,title:editor.title"
      var attrEls = root.querySelectorAll('[data-i18n-attr]');
      for (var j = 0; j < attrEls.length; j++) {
        var ae = attrEls[j];
        var spec = ae.getAttribute('data-i18n-attr') || '';
        var pairs = spec.split(',');
        for (var k = 0; k < pairs.length; k++) {
          var pair = pairs[k].trim();
          if (!pair) continue;
          var idx = pair.indexOf(':');
          if (idx < 0) continue;
          var attr = pair.slice(0, idx).trim();
          var pkey = pair.slice(idx + 1).trim();
          if (!attr || !pkey) continue;
          ae.setAttribute(attr, t(pkey));
        }
      }
    } catch (e) {
      // best effort
    }
    // Update <title> if it carries data-i18n
    try {
      var titleEl = document.querySelector('title[data-i18n]');
      if (titleEl) document.title = t(titleEl.getAttribute('data-i18n'));
    } catch (e) {}
  }

  function setLocale(loc) {
    if (!loc) return;
    if (!CATALOGS[loc]) return; // unknown locale, ignore
    if (loc === currentLocale) {
      // still re-apply, in case DOM changed
      applyTranslations(document);
      return;
    }
    currentLocale = loc;
    try {
      document.documentElement.setAttribute('lang', loc);
    } catch (e) {}
    applyTranslations(document);
    try {
      document.dispatchEvent(
        new CustomEvent('livecalc:locale-changed', { detail: { locale: loc } })
      );
    } catch (e) {}
  }

  function getLocale() {
    return currentLocale;
  }

  function getAvailableLocales() {
    return AVAILABLE_LOCALES.slice();
  }

  function defaultsForLocale(loc) {
    // Sensible per-locale defaults for separators / unit system
    if (loc === 'de') {
      return { decimalSeparator: ',', thousandsSeparator: '.', unitSystem: 'metric' };
    }
    return { decimalSeparator: '.', thousandsSeparator: ',', unitSystem: 'metric' };
  }

  // ---------------------------------------------------------------
  // Locale-aware number formatting.
  // Returns a string. opts: { decimalSeparator, thousandsSeparator,
  //                            decimals, smart }. `smart` true means
  // strip insignificant trailing zeros after the decimal.
  // ---------------------------------------------------------------
  function formatNumber(n, opts) {
    opts = opts || {};
    var decSep = opts.decimalSeparator || '.';
    var thouSep = opts.thousandsSeparator || '';
    var smart = !!opts.smart;
    var decimals = typeof opts.decimals === 'number' ? opts.decimals : null;

    if (n === null || n === undefined) return '';
    var num = typeof n === 'number' ? n : Number(n);
    if (!isFinite(num)) return String(n);

    var str;
    if (decimals !== null) {
      str = num.toFixed(decimals);
    } else {
      str = String(num);
    }

    // Strip trailing zeros if smart formatting requested
    if (smart && str.indexOf('.') >= 0) {
      str = str.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    }

    // Split into integer + fractional parts using JS's native '.'
    var parts = str.split('.');
    var intPart = parts[0];
    var fracPart = parts.length > 1 ? parts[1] : '';
    var sign = '';
    if (intPart.charAt(0) === '-') {
      sign = '-';
      intPart = intPart.slice(1);
    }

    // Apply thousands separator
    if (thouSep) {
      intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thouSep);
    }

    return sign + intPart + (fracPart ? decSep + fracPart : '');
  }

  // Convert an already-formatted number string (using JS standard '.' decimal,
  // no thousands grouping) to use the user's preferred decimal/thousands
  // separators. Useful for cleaning up math.format() output.
  function applyLocaleSeparators(str, decSep, thouSep) {
    if (str === null || str === undefined) return '';
    var s = String(str);
    // Match leading numeric token (with optional exponent) and reformat it.
    return s.replace(/(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/, function (m) {
      // Don't touch if exponent present (rare) — just swap decimal sep.
      if (/[eE]/.test(m)) {
        return decSep === '.' ? m : m.replace('.', decSep);
      }
      var parts = m.split('.');
      var intPart = parts[0];
      var fracPart = parts.length > 1 ? parts[1] : '';
      var sign = '';
      if (intPart.charAt(0) === '-') {
        sign = '-';
        intPart = intPart.slice(1);
      }
      if (thouSep) {
        intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thouSep);
      }
      return sign + intPart + (fracPart ? decSep + fracPart : '');
    });
  }

  // Public API
  window.LCi18n = {
    t: t,
    setLocale: setLocale,
    getLocale: getLocale,
    getAvailableLocales: getAvailableLocales,
    applyTranslations: applyTranslations,
    detectLocale: detectLocale,
    defaultsForLocale: defaultsForLocale,
    formatNumber: formatNumber,
    applyLocaleSeparators: applyLocaleSeparators,
  };

  // Initial best-effort locale detection: prefer persisted setting, fall back
  // to navigator. The app module will call setLocale() again once settings load.
  try {
    var initial = DEFAULT_LOCALE;
    try {
      var raw = localStorage.getItem('livecalc:v9:settings');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.language === 'string' && CATALOGS[parsed.language]) {
          initial = parsed.language;
        } else {
          initial = detectLocale();
        }
      } else {
        initial = detectLocale();
      }
    } catch (e) {
      initial = detectLocale();
    }
    currentLocale = initial;
    try {
      document.documentElement.setAttribute('lang', currentLocale);
    } catch (e) {}
  } catch (e) {}

  // Apply translations as soon as DOM is ready
  function ready() {
    applyTranslations(document);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
