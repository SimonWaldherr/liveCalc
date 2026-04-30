/**
 * livecalc-ai.js — UI integration for provider-agnostic LLM chat.
 *
 * Uses window.livecalcLLM as centralized transport/normalization layer.
 */

(function () {
  'use strict';

  const HISTORY_LIMIT = 40;
  let chatHistory = []; // { role: 'user'|'assistant', content: string }
  let activeAbortController = null;

  function getLlmCore() {
    if (!window.livecalcLLM) {
      throw new Error('LLM layer not loaded.');
    }
    return window.livecalcLLM;
  }

  function getLlmSettings() {
    let raw = null;

    try {
      if (window.app && typeof window.app.getLlmSettings === 'function') {
        raw = window.app.getLlmSettings();
      }
    } catch (e) {}

    if (!raw) {
      try {
        const s = localStorage.getItem('livecalc:v9:settings');
        if (s) {
          const parsed = JSON.parse(s);
          raw = parsed && parsed.llm ? parsed.llm : null;
        }
      } catch (e) {}
    }

    try {
      return getLlmCore().normalizeLlmSettings(raw);
    } catch (e) {
      return raw || {};
    }
  }

  function getEditorContent() {
    try {
      if (window.app && typeof window.app.getEditorContent === 'function') {
        return window.app.getEditorContent();
      }
    } catch (e) {}
    const el = document.getElementById('editor');
    return el ? el.value : '';
  }

  function insertIntoEditor(text) {
    try {
      if (window.app && typeof window.app.insertIntoEditor === 'function') {
        window.app.insertIntoEditor(text);
        return;
      }
    } catch (e) {}

    const el = document.getElementById('editor');
    if (!el) return;
    const pos = el.selectionEnd;
    const val = el.value;
    const before = val.slice(0, pos);
    const insert = (before.length > 0 && !before.endsWith('\n') ? '\n' : '') + text;
    el.value = before + insert + val.slice(pos);
    el.selectionStart = el.selectionEnd = pos + insert.length;
    el.dispatchEvent(new Event('input'));
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  
  function escapeHtmlWithLineBreaks(s) {
    return escapeHtml(s).replace(/\r?\n/g, '<br />');
  }

  function renderPlainTextParagraphs(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    return `<p class="whitespace-pre-wrap break-words">${escapeHtmlWithLineBreaks(trimmed)}</p>`;
  }

  // Translation helper used throughout the AI panel. Falls back to the
  // English string when LCi18n is unavailable.
  function lct(key, fallback, params) {
    try {
      if (typeof window !== 'undefined' && window.LCi18n && typeof window.LCi18n.t === 'function') {
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

  function renderInsertBlock(snippet) {
    const code = String(snippet || '').trim();
    if (!code) return '';
    const escaped = escapeHtml(code);
    const encoded = btoa(unescape(encodeURIComponent(code)));
    const insertLabel = escapeHtml(lct('ai.insertButton', 'Insert into editor'));
    return `<div class="rounded bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-1.5 my-1">
          <pre class="text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all">${escaped}</pre>
          <button onclick="lcAI.insertBlock('${encoded}')"
            class="mt-1 text-[10px] bg-blue-600 text-white rounded px-2 py-0.5 hover:bg-blue-700 flex items-center gap-1">
            <span class="material-symbols-outlined text-[12px]">add</span> ${insertLabel}
          </button>
        </div>`;
  }

  function renderKatex(expr, displayMode) {
    const source = String(expr || '').trim();
    if (!source) return '';

    if (window.katex && typeof window.katex.renderToString === 'function') {
      try {
        return window.katex.renderToString(source, {
          displayMode: !!displayMode,
          throwOnError: false,
          strict: 'ignore',
        });
      } catch (e) {}
    }

    const escaped = escapeHtml(source);
    return displayMode
      ? `<div class="my-1 whitespace-pre-wrap break-words">${escaped}</div>`
      : `<span class="whitespace-pre-wrap break-words">${escaped}</span>`;
  }

  function renderAssistantText(text) {
    const source = String(text || '');
    const mathRe = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;
    let html = '';
    let lastIndex = 0;
    let match;

    while ((match = mathRe.exec(source)) !== null) {
      const before = source.slice(lastIndex, match.index);
      if (before) {
        html += renderPlainTextParagraphs(before);
      }

      if (match[1] !== undefined) {
        html += `<div class="my-1 overflow-x-auto">${renderKatex(match[1], true)}</div>`;
      } else {
        html += renderKatex(match[2], false);
      }

      lastIndex = match.index + match[0].length;
    }

    const tail = source.slice(lastIndex);
    if (tail) html += renderPlainTextParagraphs(tail);
    return html || renderPlainTextParagraphs(source);
  }

  function renderAssistantContent(text) {
    const source = String(text || '');
    // Be tolerant of both LF and CRLF because different providers / proxies may
    // normalize newlines differently. Keep support for multiple insert blocks in
    // one answer and across later assistant replies.
    const markerRe = /(?:^|\r?\n)LIVECALC_INSERT_START\s*\r?\n([\s\S]*?)\r?\nLIVECALC_INSERT_END(?:\r?\n|$)/gi;
    let html = '';
    let lastIndex = 0;
    let match;

    while ((match = markerRe.exec(source)) !== null) {
      const before = source.slice(lastIndex, match.index).trim();
      if (before) html += renderAssistantText(before);
      html += renderInsertBlock(match[1]);
      lastIndex = match.index + match[0].length;
    }

    const tail = source.slice(lastIndex).trim();
    if (tail) html += renderAssistantText(tail);
    return html || renderAssistantText(source);
  }

  function setSendBusy(isBusy) {
    const btn = document.getElementById('aiChatSendBtn');
    const icon = document.getElementById('aiChatSendIcon');
    if (btn) {
      btn.title = isBusy ? 'Cancel request' : 'Send (Ctrl+Enter)';
      btn.classList.toggle('bg-red-600', isBusy);
      btn.classList.toggle('hover:bg-red-700', isBusy);
      btn.classList.toggle('bg-blue-600', !isBusy);
      btn.classList.toggle('hover:bg-blue-700', !isBusy);
    }
    if (icon) {
      icon.textContent = isBusy ? 'stop' : 'send';
    }
  }

  function cancelActiveRequest() {
    if (!activeAbortController) return false;
    activeAbortController.abort();
    activeAbortController = null;
    setSendBusy(false);
    setStatus(lct('ai.status.cancelled', 'Cancelled'), 'text-gray-400');
    return true;
  }

  function updateVisibility() {
    let hasProvider = false;
    try {
      const runtime = getLlmCore().resolveProviderRuntime(getLlmSettings());
      hasProvider = !!(runtime && runtime.baseURL);
    } catch (e) {
      hasProvider = false;
    }

    const section = document.getElementById('aiChatSection');
    const headerBtn = document.getElementById('aiChatToggleBtn');
    const sidebar = document.getElementById('sidebar');
    const graphSection = sidebar ? sidebar.firstElementChild : null;

    if (section) {
      section.classList.toggle('hidden', !hasProvider);
      if (hasProvider && sidebar && graphSection && graphSection !== section) {
        sidebar.insertBefore(section, graphSection);
      }
    }
    if (headerBtn) {
      headerBtn.classList.toggle('hidden', !hasProvider);
    }
  }

  function togglePanel() {
    const section = document.getElementById('aiChatSection');
    if (!section) return;

    if (section.classList.contains('hidden')) {
      section.classList.remove('hidden');
    } else {
      if (typeof app !== 'undefined' && typeof app.toggleSection === 'function') {
        app.toggleSection('aiChat');
      }
    }

    setTimeout(() => {
      const input = document.getElementById('aiChatInput');
      if (input) input.focus();
    }, 100);
  }

  function renderMessage(role, content) {
    const msgs = document.getElementById('aiChatMessages');
    if (!msgs) return;

    const placeholder = document.getElementById('aiChatPlaceholder');
    if (placeholder) placeholder.remove();

    const wrapper = document.createElement('div');
    wrapper.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';

    const bubble = document.createElement('div');
    bubble.className =
      role === 'user'
        ? 'max-w-[85%] bg-blue-600 text-white rounded-lg px-2 py-1.5 text-xs whitespace-pre-wrap break-words'
        : 'max-w-[90%] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs space-y-1';

    if (role === 'user') {
      bubble.textContent = content;
    } else {
      bubble.innerHTML = renderAssistantContent(content);
    }

    wrapper.appendChild(bubble);
    msgs.appendChild(wrapper);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function renderThinking() {
    const msgs = document.getElementById('aiChatMessages');
    if (!msgs) return null;
    const el = document.createElement('div');
    el.className = 'flex justify-start';
    el.id = 'aiThinking';
    el.innerHTML =
      '<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400">' +
      escapeHtml(lct('ai.thinking', 'Thinking...')) +
      '</div>';
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function updateThinkingText(el, text) {
    if (!el) return;
    const box = el.firstElementChild;
    if (!box) return;
    box.textContent = text || lct('ai.thinking', 'Thinking...');

    const msgs = document.getElementById('aiChatMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function removeThinking() {
    const el = document.getElementById('aiThinking');
    if (el) el.remove();
  }

  function setStatus(text, color) {
    const el = document.getElementById('aiChatStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'text-[10px] ' + (color || 'text-gray-400');
  }

  function insertBlock(encoded) {
    try {
      const text = decodeURIComponent(escape(atob(encoded)));
      insertIntoEditor(text);
      if (typeof showToast === 'function') showToast(lct('toast.insertedIntoEditor', 'Inserted into editor'));
    } catch (e) {
      console.error('lcAI.insertBlock error', e);
    }
  }

  function buildLegacyLlmSettings(endpointUrl, apiKey) {
    return {
      endpoint: endpointUrl,
      apiKey: apiKey || '',
      model: '',
    };
  }

  async function fetchModels(settingsOrEndpoint, maybeApiKey) {
    const core = getLlmCore();

    if (typeof settingsOrEndpoint === 'string') {
      return core.fetchModels(buildLegacyLlmSettings(settingsOrEndpoint, maybeApiKey));
    }

    const cfg = settingsOrEndpoint && typeof settingsOrEndpoint === 'object' ? settingsOrEndpoint : getLlmSettings();
    return core.fetchModels(cfg);
  }

  async function testConnection(settingsLike) {
    const core = getLlmCore();
    const cfg = settingsLike && typeof settingsLike === 'object' ? settingsLike : getLlmSettings();
    return core.testConnection(cfg);
  }

  async function send() {
    if (activeAbortController) {
      cancelActiveRequest();
      return;
    }

    const inputEl = document.getElementById('aiChatInput');
    if (!inputEl) return;
    const userText = inputEl.value.trim();
    if (!userText) return;

    let llmSettings;
    try {
      llmSettings = getLlmSettings();
      const runtime = getLlmCore().resolveProviderRuntime(llmSettings);
      if (!runtime.baseURL) {
        throw new Error(lct('ai.error.noBaseUrl', 'Please set a Base URL in Settings.'));
      }
      if (!runtime.model) {
        throw new Error(lct('ai.error.noModel', 'Please set a model name in Settings.'));
      }
    } catch (err) {
      alert(err.userMessage || err.message || lct('ai.error.configure', 'Please configure LLM settings first.'));
      if (window.app && typeof window.app.openSettings === 'function') app.openSettings();
      return;
    }

    inputEl.value = '';
    inputEl.disabled = true;

    renderMessage('user', userText);

    const editorContent = getEditorContent();
    // Determine the user's preferred reply language and unit system so the
    // model can match them. We pull these from the persisted app settings
    // (if available) and from the active i18n locale as a fallback.
    let langCode = 'en';
    let langLabel = 'English';
    let unitSystem = 'metric';
    let decimalSeparator = '.';
    try {
      if (window.LCi18n && typeof window.LCi18n.getLocale === 'function') {
        langCode = window.LCi18n.getLocale() || langCode;
      }
      if (window.app && typeof window.app.getSettings === 'function') {
        const s = window.app.getSettings() || {};
        if (s.language) langCode = s.language;
        if (s.unitSystem) unitSystem = s.unitSystem;
        if (s.decimalSeparator) decimalSeparator = s.decimalSeparator;
      }
      const labels = { en: 'English', de: 'German (Deutsch)' };
      langLabel = labels[langCode] || langCode;
    } catch (e) {}
    const unitGuidance =
      unitSystem === 'imperial'
        ? 'Prefer Imperial / US units (ft, lb, gal, °F) when giving examples or suggestions.'
        : unitSystem === 'all'
        ? 'No unit-system preference; pick whichever is clearest for the question.'
        : 'Strongly prefer SI / metric units (m, kg, l, s, °C) when giving examples or suggestions.';
    const systemPrompt = `You are a helpful math and calculation assistant integrated into LiveCalc Pro — a live math notebook that evaluates expressions using math.js syntax.

User preferences:
- Reply language: ${langLabel} (${langCode}). Always answer in this language unless the user asks otherwise.
- Unit system: ${unitSystem}. ${unitGuidance}
- Decimal separator the user reads/writes: "${decimalSeparator}".

The user's current calculation notebook content is:
\`\`\`
${editorContent || '(empty)'}
\`\`\`

You can help the user understand their calculations, explain results, suggest improvements, or write new calculation snippets.

Important notebook rules:
- LiveCalc evaluates the notebook line by line from top to bottom.
- Always define variables before any calculation line that uses them.
- If you suggest a snippet, make it self-contained: include every required variable / function definition before the final calculation or conversion lines.
- Prefer small, directly usable snippets over abstract formulas.

Respond in plain text only. Do not use Markdown or any other formatting, including code fences, bullet points, numbered lists, headings, tables, emphasis, or inline code.

If you want to suggest text that the user can insert into the notebook, put only the exact snippet between these two lines:
LIVECALC_INSERT_START
LIVECALC_INSERT_END

You may emit such insert blocks in any reply where they are useful, including later follow-up replies in the same chat. If you provide more than one distinct snippet, use a separate LIVECALC_INSERT_START / LIVECALC_INSERT_END block for each snippet.

Keep responses concise and focused on math/calculations. Use math.js syntax (e.g., units like 5 m, 10 kg, expressions like sqrt(x^2 + y^2)). Inside the LIVECALC_INSERT_START/END block always use a dot ('.') as the decimal separator regardless of the user's display preference, because math.js requires it.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-HISTORY_LIMIT),
      { role: 'user', content: userText },
    ];

    chatHistory.push({ role: 'user', content: userText });

    const thinking = renderThinking();
    const streamBuffer = { text: '' };

    setStatus(lct('ai.status.thinking', 'Thinking...'), 'text-yellow-500');
    setSendBusy(true);

    activeAbortController = new AbortController();

    try {
      const result = await getLlmCore().sendLLMRequest({
        settings: llmSettings,
        messages,
        signal: activeAbortController.signal,
        onDelta: (delta) => {
          if (!delta) return;
          streamBuffer.text += delta;
          updateThinkingText(thinking, streamBuffer.text);
          setStatus(lct('ai.status.streaming', 'Streaming...'), 'text-yellow-500');
        },
      });

      removeThinking();

      const finalText = (result && result.text) || streamBuffer.text || '';
      if (!finalText.trim()) {
        renderMessage('assistant', lct('ai.error.empty', 'No text content was returned by the provider.'));
      } else {
        renderMessage('assistant', finalText);
        chatHistory.push({ role: 'assistant', content: finalText });
      }

      setStatus(lct('ai.status.connected', 'Connected'), 'text-green-500');
    } catch (err) {
      removeThinking();
      if (err && err.code === 'ABORTED') {
        setStatus(lct('ai.status.cancelled', 'Cancelled'), 'text-gray-400');
      } else {
        setStatus(lct('ai.status.error', 'Error'), 'text-red-500');
        const userMessage =
          (err && (err.userMessage || err.message)) || lct('ai.error.unknown', 'Unknown error while contacting LLM provider.');
        renderMessage('assistant', lct('ai.error.prefix', 'Error: {message}', { message: userMessage }));

        try {
          console.warn('LLM request failed', {
            code: err && err.code,
            status: err && err.status,
            details: err && err.details,
          });
        } catch (e) {}
      }
    } finally {
      activeAbortController = null;
      setSendBusy(false);
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  function init() {
    updateVisibility();
    setTimeout(updateVisibility, 800);
  }

  window.lcAI = {
    send,
    togglePanel,
    updateVisibility,
    insertBlock,
    fetchModels,
    testConnection,
    cancel: cancelActiveRequest,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
