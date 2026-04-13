/**
 * livecalc-ai.js — LLM / AI chat integration for LiveCalc Pro
 *
 * Compatible with any OpenAI-compatible endpoint:
 *   LM-Studio  → http://localhost:1234/v1/chat/completions
 *   llmster     → http://localhost:PORT/v1/chat/completions
 *   Ollama      → http://localhost:11434/api/chat  (also supports openai-compat port 11434)
 *
 * The AI receives the current editor content as context and can suggest
 * text to insert via a code fence: ```livecalc ... ``` or just ``` ... ```.
 */

(function () {
  'use strict';

  const HISTORY_LIMIT = 40; // max messages kept in chat history

  let chatHistory = []; // { role: 'user'|'assistant', content: string }

  // ------------------------------------------------------------------ helpers

  function getLlmSettings() {
    try {
      if (window.app && typeof window.app.getLlmSettings === 'function') {
        return window.app.getLlmSettings();
      }
    } catch (e) {}
    // fallback: read from localStorage directly
    try {
      const raw = localStorage.getItem('livecalc:v9:settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.llm || { endpoint: '', model: '', apiKey: '' };
      }
    } catch (e) {}
    return { endpoint: '', model: '', apiKey: '' };
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
    // fallback
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

  // ------------------------------------------------------------------ UI

  function updateVisibility() {
    const cfg = getLlmSettings();
    const hasEndpoint = cfg && cfg.endpoint && cfg.endpoint.trim().length > 0;
    const section = document.getElementById('aiChatSection');
    const headerBtn = document.getElementById('aiChatToggleBtn');
    if (section) {
      if (hasEndpoint) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
      }
    }
    if (headerBtn) {
      if (hasEndpoint) {
        headerBtn.classList.remove('hidden');
      } else {
        headerBtn.classList.add('hidden');
      }
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
    // scroll into view
    setTimeout(() => {
      const input = document.getElementById('aiChatInput');
      if (input) input.focus();
    }, 100);
  }

  // Extract insertable content from an AI reply:
  // looks for ```livecalc ... ``` or plain ``` ... ``` blocks
  function extractCodeBlocks(text) {
    const blocks = [];
    const re = /```(?:livecalc|calc|math|plaintext|text)?\n?([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const content = m[1].trim();
      if (content) blocks.push(content);
    }
    return blocks;
  }

  function renderMessage(role, content) {
    const msgs = document.getElementById('aiChatMessages');
    if (!msgs) return;

    // remove placeholder
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
      // Render code blocks with insert buttons
      let html = '';
      let remaining = content;
      const re = /```(?:livecalc|calc|math|plaintext|text)?\n?([\s\S]*?)```/gi;
      let lastIndex = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(content)) !== null) {
        const before = content.slice(lastIndex, m.index).trim();
        if (before) html += `<p class="whitespace-pre-wrap break-words">${escapeHtml(before)}</p>`;
        const code = m[1].trim();
        const escaped = escapeHtml(code);
        const encoded = btoa(unescape(encodeURIComponent(code)));
        html += `<div class="rounded bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-1.5 my-1">
          <pre class="text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all">${escaped}</pre>
          <button onclick="lcAI.insertBlock('${encoded}')"
            class="mt-1 text-[10px] bg-blue-600 text-white rounded px-2 py-0.5 hover:bg-blue-700 flex items-center gap-1">
            <span class="material-symbols-outlined text-[12px]">add</span> Insert into editor
          </button>
        </div>`;
        lastIndex = m.index + m[0].length;
      }
      const tail = content.slice(lastIndex).trim();
      if (tail) html += `<p class="whitespace-pre-wrap break-words">${escapeHtml(tail)}</p>`;
      if (!html) html = `<p class="whitespace-pre-wrap break-words">${escapeHtml(content)}</p>`;
      bubble.innerHTML = html;
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
    el.innerHTML = `<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400 animate-pulse">Thinking…</div>`;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
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
      showToast && showToast('Inserted into editor');
    } catch (e) {
      console.error('lcAI.insertBlock error', e);
    }
  }

  // ------------------------------------------------------------------ model discovery

  /**
   * Fetch the list of available model names from the configured server.
   * Supports:
   *   OpenAI-compat  GET /v1/models          → { data: [{ id }] }
   *   Ollama native  GET /api/tags            → { models: [{ name }] }
   *   Ollama native  GET /api/ps (running)    → { models: [{ name }] }
   *
   * @param {string} endpointUrl  - the chat endpoint URL (used to derive the base)
   * @param {string} [apiKey]     - optional Bearer token
   * @returns {Promise<string[]>} sorted list of model names
   */
  async function fetchModels(endpointUrl, apiKey) {
    const url = endpointUrl.trim();
    if (!url) throw new Error('No endpoint URL provided.');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey.trim()) headers['Authorization'] = 'Bearer ' + apiKey.trim();

    // Derive base URL (strip path after host:port)
    let base;
    try {
      const u = new URL(url);
      base = u.origin; // e.g. http://localhost:1234
    } catch (e) {
      throw new Error('Invalid endpoint URL.');
    }

    const isOllamaNative = /\/api\//.test(url);

    // Candidates to try in order
    const candidates = isOllamaNative
      ? [
          { url: base + '/api/tags', extract: (d) => (d.models || []).map((m) => m.name || m.model).filter(Boolean) },
          { url: base + '/api/ps', extract: (d) => (d.models || []).map((m) => m.name || m.model).filter(Boolean) },
          { url: base + '/v1/models', extract: (d) => (d.data || []).map((m) => m.id).filter(Boolean) },
        ]
      : [
          { url: base + '/v1/models', extract: (d) => (d.data || []).map((m) => m.id).filter(Boolean) },
          { url: base + '/api/tags', extract: (d) => (d.models || []).map((m) => m.name || m.model).filter(Boolean) },
        ];

    let lastErr = null;
    for (const candidate of candidates) {
      try {
        const resp = await fetch(candidate.url, { method: 'GET', headers });
        if (!resp.ok) {
          lastErr = new Error(`Server returned ${resp.status} for ${candidate.url}`);
          continue;
        }
        const data = await resp.json();
        const models = candidate.extract(data);
        if (models.length > 0) return models.slice().sort((a, b) => a.localeCompare(b));
        // empty list — try next candidate
      } catch (e) {
        lastErr = friendlyFetchError(e, candidate.url);
      }
    }
    throw lastErr || new Error('Could not retrieve models from server.');
  }

  // ------------------------------------------------------------------ API

  /**
   * Translate raw fetch() errors into user-friendly messages.
   * "Failed to fetch" typically means CORS blocked or server unreachable.
   */
  function friendlyFetchError(err, url) {
    const msg = err && err.message ? err.message : String(err);
    if (/failed to fetch|networkerror|network request failed/i.test(msg)) {
      return new Error(
        `Cannot reach server at ${url}. ` +
          'Make sure the server is running and allows cross-origin requests (CORS). ' +
          'LM-Studio: enable CORS in settings. Ollama: set OLLAMA_ORIGINS=* env var.'
      );
    }
    if (/cors/i.test(msg)) {
      return new Error(`CORS blocked: the server at ${url} rejected the request. Enable CORS on the server.`);
    }
    return err;
  }

  async function callLlm(messages) {
    const cfg = getLlmSettings();
    if (!cfg || !cfg.endpoint) throw new Error('No LLM endpoint configured.');

    const endpoint = cfg.endpoint.trim();
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey && cfg.apiKey.trim()) {
      headers['Authorization'] = 'Bearer ' + cfg.apiKey.trim();
    }

    // Detect Ollama native API (not openai-compat)
    const isOllamaNative = /\/api\/chat/.test(endpoint);

    let body;
    if (isOllamaNative) {
      // Ollama native format
      body = {
        model: cfg.model || 'llama3',
        messages: messages,
        stream: false,
      };
    } else {
      // OpenAI-compatible format (LM-Studio, llmster, Ollama openai-compat, etc.)
      body = {
        messages: messages,
        stream: false,
      };
      if (cfg.model && cfg.model.trim()) body.model = cfg.model.trim();
    }

    let resp;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw friendlyFetchError(e, endpoint);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error(`LLM server error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();

    // Extract assistant message from various response shapes
    let reply = '';
    if (data.message && data.message.content) {
      // Ollama native
      reply = data.message.content;
    } else if (data.choices && data.choices[0]) {
      const choice = data.choices[0];
      reply = (choice.message && choice.message.content) || choice.text || '';
    } else if (data.content) {
      reply = data.content;
    } else {
      reply = JSON.stringify(data);
    }

    return reply;
  }

  async function send() {
    const inputEl = document.getElementById('aiChatInput');
    if (!inputEl) return;
    const userText = inputEl.value.trim();
    if (!userText) return;

    const cfg = getLlmSettings();
    if (!cfg || !cfg.endpoint) {
      alert('Please configure an LLM endpoint in Settings first.');
      if (window.app && typeof window.app.openSettings === 'function') app.openSettings();
      return;
    }

    inputEl.value = '';
    inputEl.disabled = true;

    renderMessage('user', userText);

    // Build messages array with system context
    const editorContent = getEditorContent();
    const systemPrompt = `You are a helpful math and calculation assistant integrated into LiveCalc Pro — a live math notebook that evaluates expressions using math.js syntax.

The user's current calculation notebook content is:
\`\`\`
${editorContent || '(empty)'}
\`\`\`

You can help the user understand their calculations, explain results, suggest improvements, or write new calculation snippets.

When you want to suggest something the user can insert into their notebook, wrap it in a code fence:
\`\`\`livecalc
# your suggestion here
x = 42
\`\`\`

Keep responses concise and focused on math/calculations. Use math.js syntax (e.g., units like \`5 m\`, \`10 kg\`, expressions like \`sqrt(x^2 + y^2)\`).`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-HISTORY_LIMIT),
      { role: 'user', content: userText },
    ];

    chatHistory.push({ role: 'user', content: userText });

    const thinking = renderThinking();
    setStatus('Thinking…', 'text-yellow-500');

    try {
      const reply = await callLlm(messages);
      removeThinking();
      renderMessage('assistant', reply);
      chatHistory.push({ role: 'assistant', content: reply });
      setStatus('Connected', 'text-green-500');
    } catch (err) {
      removeThinking();
      setStatus('Error', 'text-red-500');
      renderMessage('assistant', '⚠️ Error: ' + err.message);
    } finally {
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  // ------------------------------------------------------------------ init

  function init() {
    // Check on page load if LLM is configured
    updateVisibility();
    // Check again after app initializes (slight delay)
    setTimeout(updateVisibility, 800);
  }

  // Expose global lcAI object
  window.lcAI = {
    send,
    togglePanel,
    updateVisibility,
    insertBlock,
    fetchModels,
  };

  // Init after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
