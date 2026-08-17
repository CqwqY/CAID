// CAID 副驾注入脚本（MAIN world，由 background 通过 chrome.scripting 注入到目标页）
// 站外页面没有主站那套 UI，所以本脚本自带面板 + 真实 Zod v4 构建的 9 个 customTools。
// 关键：zod-v4 / page-agent 已由前序注入文件就位，这里直接用真实 Zod v4，无需 duck fallback。
(function () {
  if (window.__CAID_BOOTED) {
    var ex = document.getElementById('caidExtCopilot');
    if (ex) ex.classList.add('open');
    return;
  }
  window.__CAID_BOOTED = true;

  // ---------- 跨 world 网络代理（绕过宿主页 CSP/CORS）----------
  // MAIN world 注入的副驾没有 chrome.* API，无法直接 fetch 受限域名
  // （github.com / bilibili.com 等会拦截向 api.deepseek.com 等外部 LLM 的请求）。
  // 因此把请求经 window.postMessage 转交 ISOLATED world 的 content.js，
  // 由它再转发 background service worker 真正发起（扩展网络，不受页面 CSP 限制），
  // 最后把响应（二进制安全）回传，重建为标准 Response 交给 Page-Agent。
  function _b64enc(bytes) {
    var bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function _b64dec(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function _normHeaders(h) {
    var out = {};
    if (!h) return out;
    if (typeof Headers !== 'undefined' && h instanceof Headers) { h.forEach(function (v, k) { out[String(k).toLowerCase()] = v; }); return out; }
    if (Array.isArray(h)) { h.forEach(function (p) { out[String(p[0]).toLowerCase()] = p[1]; }); return out; }
    for (var k in h) out[String(k).toLowerCase()] = h[k];
    return out;
  }
  var _fetchPending = new Map();
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__caidType !== 'CAID_FETCH_RESP') return;
    var p = _fetchPending.get(d.id);
    if (p) { _fetchPending.delete(d.id); p(d); }
  });
  function caidNet(url, init) {
    return new Promise(function (resolve, reject) {
      var id = 'cf' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
      _fetchPending.set(id, function (resp) {
        if (resp.error) { reject(new Error(resp.error)); return; }
        try {
          var body = resp.bodyB64 ? _b64dec(resp.bodyB64) : (resp.bodyText || '');
          resolve(new Response(body, { status: resp.status || 200, statusText: resp.statusText || '', headers: resp.headers || {} }));
        } catch (e) { reject(e); }
      });
      var method = (init && init.method) || 'GET';
      var headers = _normHeaders(init && init.headers);
      var bodyText = null, bodyB64 = null;
      if (init && init.body != null) {
        if (typeof init.body === 'string') bodyText = init.body;
        else if (init.body instanceof ArrayBuffer) bodyB64 = _b64enc(new Uint8Array(init.body));
        else if (ArrayBuffer.isView(init.body)) bodyB64 = _b64enc(new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength));
        else bodyText = String(init.body);
      }
      try {
        window.postMessage({ __caidType: 'CAID_FETCH', id: id, url: String(url), method: method, headers: headers, bodyText: bodyText, bodyB64: bodyB64 }, '*');
      } catch (e) { reject(e); }
    });
  }

  const MAIN_URL = 'https://graduate.dpdns.org/';
  const z = window.ZodV4 && window.ZodV4.z;
  if (!z) { console.error('[CAID] window.ZodV4.z 未加载，副驾无法初始化'); return; }
  if (!window.PageAgent) { console.error('[CAID] window.PageAgent 未加载，副驾无法初始化'); return; }

  // ---------- 真实 Zod v4 schema 构建器（替代书签的 mkObj duck fallback）----------
  function mkObj(fields) {
    const shape = {};
    for (const k in fields) { shape[k] = z.string(); }
    return z.object(shape);
  }

  function cpEscapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 内联设置面板：直接在主站 DOM 的副驾面板里展开，彻底绕开被拦截器拦的 chrome-extension://options.html 导航
  function toggleSettings() {
    var panel = document.getElementById('cpSettingsPanel');
    if (!panel) return;
    if (panel.classList.toggle('open')) fillSettings();
  }
  function fillSettings() {
    var cfg = window.__CAID_LLM_CFG || {};
    var hasKey = cfg.apiKey && cfg.apiKey !== 'NA' && cfg.apiKey !== 'null' && cfg.apiKey !== 'undefined';
    var f = document.getElementById('cpUseFree'), m = document.getElementById('cpModel'),
        u = document.getElementById('cpBaseUrl'), k = document.getElementById('cpApiKey');
    if (f) f.checked = !hasKey;
    if (m) m.value = cfg.model || 'qwen3.5-plus';
    if (u) u.value = cfg.baseURL || 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run';
    if (k) k.value = (cfg.apiKey && cfg.apiKey !== 'NA') ? cfg.apiKey : '';
  }

  // ---------- 面板 UI（自带样式，不依赖宿主页 CSS）----------
  const STYLE = `
#caidExtCopilot{position:fixed;top:0;right:0;width:400px;height:100vh;max-height:100vh;z-index:2147483647;background:#0f1722;color:#e6f1fb;font:13px/1.5 system-ui,sans-serif;display:none;box-shadow:-6px 0 28px rgba(0,0,0,.45);border-left:1px solid #1f3650;font-family:inherit;}\n#caidExtCopilot.open{display:flex;flex-direction:column;}
#caidExtCopilot *{box-sizing:border-box;}
#caidExtCopilot .cp-head{padding:12px 14px;background:#10243b;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #1f3650;}
#caidExtCopilot .cp-title{font-weight:600;font-size:14px;}
#caidExtCopilot .cp-status{font-size:11px;color:#7fb0e0;}
#caidExtCopilot .cp-close{flex:0 0 auto;width:28px;height:28px;border-radius:6px;border:0;background:transparent;color:#9fb6cf;font-size:16px;cursor:pointer;}
#caidExtCopilot .cp-close:hover{background:#1f3650;}
#caidExtCopilot .cp-stop{flex:0 0 auto;width:28px;height:28px;border-radius:6px;border:0;background:transparent;color:#5b7187;font-size:14px;cursor:not-allowed;opacity:.4;}
#caidExtCopilot .cp-stop.running{color:#ff6b6b;cursor:pointer;opacity:1;background:#2a1414;}
#caidExtCopilot .cp-stop.running:hover{background:#3a1a1a;}
#caidExtCopilot .cp-api-info{padding:4px 14px;font-size:11px;color:#9fb6cf;background:#10243b;border-bottom:1px solid #1f3650;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
#caidExtCopilot .cp-api-badge{padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600;}
#caidExtCopilot .cp-api-badge.custom{background:#1f6feb;color:#fff;}
#caidExtCopilot .cp-api-badge.free{background:#2a9d5c;color:#fff;}
#caidExtCopilot .cp-api-badge.nokey{background:#7a3b3b;color:#fff;}
#caidExtCopilot .cp-activity{padding:6px 14px;font-size:12px;color:#ffd479;min-height:18px;border-bottom:1px solid #16273c;}
#caidExtCopilot .cp-log{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}
#caidExtCopilot .cp-bubble{padding:8px 11px;border-radius:10px;white-space:pre-wrap;word-break:break-word;max-width:100%;}
#caidExtCopilot .cp-bubble-user{background:#16324f;align-self:flex-end;}
#caidExtCopilot .cp-bubble-assistant{background:#13233a;}
#caidExtCopilot .cp-evt-error{color:#ff8a8a;}
#caidExtCopilot .cp-tool{display:inline-block;padding:1px 6px;border-radius:4px;background:#1f3650;color:#9fe1cb;font-size:11px;margin-right:4px;}
#caidExtCopilot .cp-tool-call{padding:6px 8px;border-radius:8px;background:#0b2a22;color:#9fe1cb;font-size:11px;margin:0 14px 6px;word-break:break-word;}
#caidExtCopilot .cp-code{margin:8px 14px;padding:8px;background:#08111c;border-radius:8px;color:#cfe;white-space:pre-wrap;font:11px/1.4 monospace;max-height:160px;overflow:auto;}
#caidExtCopilot .cp-search{margin:8px 14px;padding:8px;border-radius:8px;background:#0b1a2a;font-size:12px;}
#caidExtCopilot .cp-search a{color:#7fb0e0;}
#caidExtCopilot .cp-tools{padding:0 0 8px;}
#caidExtCopilot .cp-input-row{padding:10px 12px;border-top:1px solid #1f3650;display:flex;gap:8px;}
#caidExtCopilot .cp-input{flex:1;padding:8px 10px;border-radius:8px;background:#0b1420;color:#e6f1fb;border:1px solid #294a6b;outline:none;}
#caidExtCopilot .cp-send{background:#185FA5;color:#fff;border:0;padding:0 16px;border-radius:8px;cursor:pointer;}\n#caidExtCopilot .cp-settings{padding:10px 14px;background:#0b1a2a;border-bottom:1px solid #1f3650;display:none;}\n#caidExtCopilot .cp-settings.open{display:block;}\n#caidExtCopilot .cp-settings label{display:block;margin:8px 0 3px;font-size:12px;color:#9fb6cf;}\n#caidExtCopilot .cp-settings input[type=text],#caidExtCopilot .cp-settings input[type=password]{width:100%;padding:6px 8px;border-radius:6px;background:#0b1420;color:#e6f1fb;border:1px solid #294a6b;box-sizing:border-box;font-size:12px;}\n#caidExtCopilot .cp-settings .cp-row{display:flex;align-items:center;gap:6px;margin:4px 0 8px;}\n#caidExtCopilot .cp-settings .cp-save{background:#185FA5;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:8px;}\n#caidExtCopilot .cp-settings .cp-hint{color:#7a8ba0;font-size:11px;margin-top:6px;line-height:1.5;}\n#caidExtCopilot .cp-settings .cp-saved{color:#2a9d5c;font-size:12px;margin-top:6px;min-height:14px;}
`;
  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const aside = document.createElement('aside');
    aside.id = 'caidExtCopilot';
    aside.className = 'open';
    aside.innerHTML =
      '<div class="cp-head">' +
        '<span class="cp-title">🤖 CAID 副驾</span>' +
        '<span class="cp-status" id="cpStatus">就绪</span>' +
        '<button class="cp-stop" id="cpStop" title="强行终止当前任务 (Ctrl+.)">⏹</button>' +
        '<button class="cp-close" id="cpSettings" title="副驾设置（LLM / 模型）">⚙</button>' +
        '<button class="cp-close" id="cpClose" title="关闭">×</button>' +
      '</div>' +
      '<div class="cp-api-info" id="cpApiInfo"></div>' +
      '<div class="cp-settings" id="cpSettingsPanel">' +
        '<div class="cp-row"><input type="checkbox" id="cpUseFree" checked /> <label style="margin:0" for="cpUseFree">使用 DashScope 免费代理</label></div>' +
        '<label>模型 (model)</label>' +
        '<input type="text" id="cpModel" placeholder="qwen3.5-plus" />' +
        '<label>Base URL</label>' +
        '<input type="text" id="cpBaseUrl" placeholder="https://..." />' +
        '<label>API Key</label>' +
        '<input type="password" id="cpApiKey" placeholder="留空则用免费代理" />' +
        '<button class="cp-save" id="cpSave">保存</button>' +
        '<div class="cp-saved" id="cpSaved"></div>' +
        '<div class="cp-hint">默认走免费代理；填自己的 OpenAI / 兼容端点后自动切换。设置保存在本机扩展存储，并会同步回主站。</div>' +
      '</div>' +
      '<div class="cp-activity" id="cpActivity"></div>' +
      '<div class="cp-log" id="cpLog"></div>' +
      '<div class="cp-search" id="cpSearch" style="display:none;"></div>' +
      '<div class="cp-code" id="cpCode" style="display:none;"></div>' +
      '<div class="cp-tools" id="cpTools"></div>' +
      '<div class="cp-input-row">' +
        '<input class="cp-input" id="cpInput" placeholder="描述任务，例如：在这个页面注册一个账号…" />' +
        '<button class="cp-send" id="cpSend">发送</button>' +
      '</div>';
    document.body.appendChild(aside);
    return aside;
  }
  buildPanel();

  const logEl = document.getElementById('cpLog');
  const statusEl = document.getElementById('cpStatus');
  const activityEl = document.getElementById('cpActivity');
  const apiInfoEl = document.getElementById('cpApiInfo');
  const toolsEl = document.getElementById('cpTools');
  const codeEl = document.getElementById('cpCode');
  const searchEl = document.getElementById('cpSearch');
  const inputEl = document.getElementById('cpInput');
  const sendEl = document.getElementById('cpSend');
  const closeEl = document.getElementById('cpClose');
  const stopEl = document.getElementById('cpStop');

  function logBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'cp-bubble ' + (role === 'user' ? 'cp-bubble-user' : 'cp-bubble-assistant');
    div.innerHTML = cpEscapeHtml(text).replace(/\n/g, '<br>');
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // 工具回填渲染（search_web / search_code / output_code 调用）
  const cpRender = {
    renderSearch(results) {
      if (!results || !results.length) return;
      searchEl.style.display = 'block';
      searchEl.innerHTML = results.map(r =>
        '<div>• <a href="' + cpEscapeHtml(r.url || '#') + '" target="_blank" rel="noopener">' +
        cpEscapeHtml(r.title || '') + '</a>' + (r.snippet ? '<div style="color:#7fb0e0;">' + cpEscapeHtml(r.snippet) + '</div>' : '') + '</div>'
      ).join('');
    },
    renderCode(code, lang) {
      if (!code) { codeEl.style.display = 'none'; return; }
      codeEl.style.display = 'block';
      codeEl.textContent = String(code) + (lang ? '\n// lang: ' + lang : '');
    }
  };

  // ---------- 9 个 customTools（忠实移植自主站 buildCaidCustomTools）----------
  const tools = {
    execute_javascript: {
      description:
        'Execute arbitrary JavaScript code on the current page. Supports async/await. ' +
        'An AbortSignal named `signal` is available in scope. ' +
        'Examples: navigate: window.location.href = "URL"; open tab: var a=document.createElement("a");a.href="URL";a.target="_blank";document.body.appendChild(a);a.click();',
      inputSchema: mkObj({ script: 'string' }),
      execute: async function (input, ctx) {
        const signal = ctx && ctx.signal;
        if (!this || !this.pageController || typeof this.pageController.executeJavascript !== 'function') {
          const result = (0, eval)(String(input && input.script));
          return (result && typeof result.then === 'function') ? (await result) : String(result ?? '');
        }
        const r = await this.pageController.executeJavascript(String(input && input.script), signal);
        signal && signal.throwIfAborted && signal.throwIfAborted();
        return (r && r.message) || String((r && r.result) ?? '');
      }
    },

    navigate_to_url: {
      description: 'Navigate the current browser page to a given URL (replaces current page).',
      inputSchema: mkObj({ url: 'string:url' }),
      execute: async function (input) {
        const url = String(input && input.url || '').trim();
        if (!url) throw new Error('navigate_to_url: url is required');
        // 断点续传：跳转前保存任务上下文，供新页面副驾续传
        // MAIN world 无 chrome.storage，通过 DOM 事件桥接到 ISOLATED world 的 content.js 写入
        try {
          const h = buildHandoff(url);
          if (h) {
            window.dispatchEvent(new CustomEvent('__caid_store_handoff', { detail: h }));
          }
        } catch (e) { console.warn('[CAID] 保存续传上下文失败', e); }
        try { (window.top || window).location.href = url; }
        catch (e) { window.location.href = url; }
        return `✅ Navigating to: ${url}`;
      }
    },

    open_url_in_new_tab: {
      description: 'Open a URL in a new browser tab (does not leave the current page).',
      inputSchema: mkObj({ url: 'string:url' }),
      execute: async function (input) {
        const url = String(input && input.url || '').trim();
        if (!url) throw new Error('open_url_in_new_tab: url is required');
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); a.remove();
        return `✅ Opened in new tab: ${url}`;
      }
    },

    navigate_to_main_site: {
      description: 'Immediately navigate back to the CAID main workbench (home / main site). Takes NO parameters.',
      inputSchema: mkObj({}),
      execute: async function () {
        try { (window.top || window).location.href = MAIN_URL; }
        catch (e) { window.location.href = MAIN_URL; }
        return `✅ Navigating back to CAID main workbench: ${MAIN_URL}`;
      }
    },

    search_web: {
      description: 'Search the web for information. Returns Wikipedia summaries and search engine links.',
      inputSchema: mkObj({ query: 'string' }),
      execute: async function (input, ctx) {
        var query = String(input && input.query || '').trim();
        if (!query) throw new Error('search_web: query is required');
        var signal = ctx && ctx.signal;
        var results = [];
        try {
          var wikiUrl = 'https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
            encodeURIComponent(query) + '&format=json&origin=*&srlimit=5';
          var resp = await caidNet(wikiUrl, { signal: signal });
          if (resp.ok) {
            var data = await resp.json();
            results = (data.query && data.query.search || []).map(function (r) {
              return {
                title: r.title,
                url: 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(String(r.title).replace(/ /g, '_')),
                snippet: r.snippet ? String(r.snippet).replace(/<[^>]+>/g, '') : ''
              };
            });
          }
        } catch (e) { /* CORS 或网络失败，继续走搜索引擎链接 */ }
        if (results.length < 3) {
          try {
            var wikiEnUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
              encodeURIComponent(query) + '&format=json&origin=*&srlimit=3';
            var resp2 = await caidNet(wikiEnUrl, { signal: signal });
            if (resp2.ok) {
              var data2 = await resp2.json();
              var enResults = (data2.query && data2.query.search || []).map(function (r) {
                return {
                  title: r.title + ' (EN)',
                  url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(r.title).replace(/ /g, '_')),
                  snippet: r.snippet ? String(r.snippet).replace(/<[^>]+>/g, '') : ''
                };
              });
              results = results.concat(enResults);
            }
          } catch (e) {}
        }
        var googleUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
        var bingUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(query);
        results.push({ title: '🔍 Google: ' + query, url: googleUrl, snippet: '点击查看完整搜索结果' });
        results.push({ title: '🔍 Bing: ' + query, url: bingUrl, snippet: '点击查看完整搜索结果' });
        if (this && this.__cpRender && this.__cpRender.renderSearch) this.__cpRender.renderSearch(results);
        var summary = results.filter(function (r) { return r.snippet && r.url.indexOf('google.com') < 0 && r.url.indexOf('bing.com') < 0; })
          .map(function (r) { return r.title + ': ' + r.snippet; }).join('\n');
        return '🔍 网页搜索 "' + query + '" 结果:\n' + (summary || '未找到维基百科条目') +
          '\n\n完整搜索: Google ' + googleUrl + ' | Bing ' + bingUrl;
      }
    },

    search_code: {
      description: 'Search for code on GitHub. Returns matching files with repository and path info.',
      inputSchema: mkObj({ query: 'string' }),
      execute: async function (input, ctx) {
        var query = String(input && input.query || '').trim();
        if (!query) throw new Error('search_code: query is required');
        var signal = ctx && ctx.signal;
        var results = [];
        try {
          var ghUrl = 'https://api.github.com/search/code?q=' + encodeURIComponent(query) + '&per_page=8';
          var resp = await caidNet(ghUrl, { signal: signal, headers: { 'Accept': 'application/vnd.github.v3+json' } });
          if (resp.ok) {
            var data = await resp.json();
            results = (data.items || []).map(function (r) {
              return { title: (r.repository && r.repository.full_name || '') + ' / ' + r.name, url: r.html_url, snippet: r.path || '' };
            });
          }
        } catch (e) { /* CORS 或速率限制 */ }
        if (this && this.__cpRender && this.__cpRender.renderSearch) this.__cpRender.renderSearch(results);
        var summary = results.length ?
          results.map(function (r) { return r.title + ' → ' + r.url + (r.snippet ? ' (' + r.snippet + ')' : ''); }).join('\n') :
          '未找到代码结果（可能触发了 GitHub API 速率限制，请稍后重试）';
        return '💻 代码搜索 "' + query + '" 结果:\n' + summary;
      }
    },

    output_code: {
      description: 'Display generated code in the copilot code output panel for the user to review/copy/execute.',
      inputSchema: mkObj({ code: 'string', language: 'string', description: 'string' }),
      execute: async function (input) {
        var code = String(input && input.code || '');
        var lang = String(input && input.language || input && input.lang || '');
        var desc = String(input && input.description || input && input.desc || '');
        if (!code) throw new Error('output_code: code is required');
        if (this && this.__cpRender && this.__cpRender.renderCode) this.__cpRender.renderCode(code, lang, desc);
        return '✅ 代码已输出到代码区' + (lang ? ' (' + lang + ')' : '') + '。用户可复制或点击执行。';
      }
    },

    auto_fill_form: {
      description: 'Automatically fill form fields and optionally submit. field_values is a JSON string mapping names/selectors to values.',
      inputSchema: mkObj({ field_values: 'string', submit: 'string', form_selector: 'string' }),
      execute: async function (input) {
        var raw = String(input && input.field_values || '{}');
        var fields;
        try { fields = JSON.parse(raw); } catch (e) { throw new Error('auto_fill_form: field_values 必须是合法 JSON: ' + e.message); }
        var doSubmit = String(input && input.submit || '').toLowerCase() === 'true';
        var formSel = String(input && input.form_selector || '').trim();
        var filled = 0, failed = [];
        for (var key in fields) {
          var val = String(fields[key]);
          var el = null;
          try { el = document.querySelector(key); } catch (e2) {}
          if (!el) {
            var inputs = document.querySelectorAll('input, textarea, select');
            for (var i = 0; i < inputs.length; i++) {
              var inp = inputs[i];
              var ph = inp.placeholder || '', nm = inp.name || '', id = inp.id || '', tp = inp.type || '';
              if (ph.indexOf(key) >= 0 || nm.indexOf(key) >= 0 || id.indexOf(key) >= 0 ||
                (tp === 'email' && key.toLowerCase().indexOf('邮') >= 0) ||
                (tp === 'password' && (key.toLowerCase().indexOf('密') >= 0 || key.toLowerCase().indexOf('pass') >= 0)) ||
                (tp === 'search' && key.toLowerCase().indexOf('搜') >= 0)) {
                el = inp; break;
              }
            }
          }
          if (el) {
            try {
              var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (!nativeSetter) nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
              if (nativeSetter && nativeSetter.set) nativeSetter.set.call(el, val);
              else el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              filled++;
            } catch (e3) { failed.push(key + ': ' + e3.message); }
          } else { failed.push(key + ': 未找到匹配的输入框'); }
        }
        var resultMsg = '填写了 ' + filled + ' 个字段';
        if (failed.length) resultMsg += '，失败: ' + failed.join('; ');
        if (doSubmit) {
          var form = formSel ? document.querySelector(formSel) : null;
          if (!form) { var firstInput = document.querySelector('input, textarea'); if (firstInput && firstInput.form) form = firstInput.form; }
          if (form) {
            try { form.submit(); resultMsg += '，已提交表单'; }
            catch (e4) {
              try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); resultMsg += '，已触发 submit 事件'; }
              catch (e5) { resultMsg += '，提交失败: ' + e5.message; }
            }
          } else {
            var submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
            if (submitBtn) { submitBtn.click(); resultMsg += '，已点击提交按钮'; }
            else resultMsg += '，未找到提交按钮';
          }
        }
        return '✅ ' + resultMsg;
      }
    },

    extract_page_data: {
      description: 'Extract structured data from the current page: table / links / text / images / meta. Pass type and optional selector.',
      inputSchema: mkObj({ type: 'string', selector: 'string' }),
      execute: async function (input) {
        var type = String(input && input.type || 'all').toLowerCase().trim();
        var sel = String(input && input.selector || '').trim();
        var scope = sel ? null : document;
        try { if (sel) scope = document.querySelector(sel); } catch (e6) {}
        if (!scope) scope = document;
        var data = {};
        if (type === 'table' || type === 'all') {
          var tables = scope.querySelectorAll('table'); data.tables = [];
          tables.forEach(function (t) {
            var rows = [];
            t.querySelectorAll('tr').forEach(function (tr) {
              var cells = [];
              tr.querySelectorAll('th, td').forEach(function (td) { cells.push(td.innerText.trim()); });
              if (cells.length) rows.push(cells);
            });
            if (rows.length) data.tables.push(rows);
          });
        }
        if (type === 'links' || type === 'all') {
          data.links = [];
          scope.querySelectorAll('a[href]').forEach(function (a) { data.links.push({ text: a.innerText.trim().slice(0, 100), href: a.href }); });
        }
        if (type === 'text' || type === 'all') { data.text = scope.body ? scope.body.innerText.slice(0, 5000) : ''; }
        if (type === 'images' || type === 'all') {
          data.images = [];
          scope.querySelectorAll('img[src]').forEach(function (img) { data.images.push({ src: img.src, alt: img.alt || '', width: img.naturalWidth || 0, height: img.naturalHeight || 0 }); });
        }
        if (type === 'meta' || type === 'all') {
          data.meta = { title: document.title, url: location.href, description: '', keywords: '' };
          var desc = document.querySelector('meta[name="description"]'); if (desc) data.meta.description = desc.content || '';
          var kw = document.querySelector('meta[name="keywords"]'); if (kw) data.meta.keywords = kw.content || '';
        }
        var json = JSON.stringify(data, null, 2);
        if (json.length > 8000) json = json.slice(0, 8000) + '\n... (截断，共 ' + json.length + ' 字符)';
        return '📋 页面数据提取 (' + type + '):\n' + json;
      }
    }
  };
  for (const k in tools) tools[k].__cpRender = cpRender;

  // ---------- 断点续传：跳转前序列化任务上下文 ----------
  function buildHandoff(targetUrl) {
    if (!agent) return null;
    const hist = agent.history || [];
    if (!hist.length) return null;
    let goal = '';
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i] && hist[i].type === 'user') { goal = hist[i].content; break; }
    }
    if (!goal) return null;
    const recent = hist.slice(-12).map(function (ev) {
      if (ev.type === 'user') return { type: 'user', content: ev.content };
      if (ev.type === 'assistant') return { type: 'assistant', content: ev.content };
      if (ev.type === 'step') return { type: 'step', action: { name: ev.action && ev.action.name, input: ev.action && ev.action.input, output: (ev.action && ev.action.output || '').slice(0, 300) } };
      if (ev.type === 'error') return { type: 'error', message: ev.message };
      return { type: ev.type };
    });
    return { goal: goal, fromUrl: location.href, toUrl: targetUrl, ts: Date.now(), recent: recent };
  }

  // ---------- 创建 agent ----------
  const cfg = window.__CAID_LLM_CFG || {};
  // 注意：扩展配置 schema 的键是 baseURL（大写 URL），与内联保存（cpSave）和 caid-bridge 写入保持一致。
  // 判定是否为"自定义 LLM"：必须填了可用的 baseURL + 真实 API Key（非占位 'NA'）。
  // 否则一律走内置免费代理（qwen3.5-plus），避免因为 baseURL 缺失触发 PageAgent 的 config required 报错。
  const hasRealKey = cfg.apiKey && cfg.apiKey !== 'NA' && cfg.apiKey !== 'null' && cfg.apiKey !== 'undefined';
  const isCustom = !!(cfg.baseURL) && hasRealKey;
  const FREE_PROXY = 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run';
  const sysPrompt = '你是一个运行在任意网页上的智能体副驾（CAID）。你可以：用 execute_javascript 执行脚本、' +
    'navigate_to_url / open_url_in_new_tab 控制导航、search_web / search_code 检索、output_code 输出代码、' +
    'auto_fill_form 填表、extract_page_data 提取数据、navigate_to_main_site 回到工作台。' +
    '优先使用合适的工具完成任务，最后用 done 汇报结果。';
  const customTools = tools;
  const baseCfg = { language: 'zh-CN', instructions: { system: sysPrompt }, experimentalScriptExecutionTool: true, enableMask: true, customTools };
  const config = isCustom
    ? Object.assign({}, baseCfg, { model: cfg.model, baseURL: cfg.baseURL, apiKey: cfg.apiKey })
    : Object.assign({}, baseCfg, { model: 'qwen3.5-plus', baseURL: FREE_PROXY, apiKey: 'NA' });

  // 关键：Page-Agent 的 OpenAIClient 用 config.customFetch 发起 LLM 请求。
  // 这里注入 caidNet——它把请求经 window.postMessage 转交 ISOLATED world 的 content.js，
  // 再由 background service worker 真正发起（扩展网络，不受宿主页如 github.com 的 CSP 限制）。
  // 这样无论用自定义 deepseek 还是内置免费代理，都不会再被页面 CSP 拦截。
  config.customFetch = caidNet;

  function renderApiInfo() {
    if (!apiInfoEl) return;
    var apiKey = String(config.apiKey || '').trim();
    var hasKey = apiKey && apiKey !== 'NA' && apiKey !== 'null' && apiKey !== 'undefined';
    var isCustom = config.model && config.model !== 'qwen3.5-plus';
    var isFreeProxy = apiKey === 'NA';
    var badge = isCustom && hasKey ? '<span class="cp-api-badge custom">自定义</span>'
      : isFreeProxy ? '<span class="cp-api-badge free">免费代理</span>'
      : !hasKey ? '<span class="cp-api-badge nokey">无 API Key</span>'
      : '<span class="cp-api-badge free">免费代理</span>';
    apiInfoEl.innerHTML = badge + '<span>' + cpEscapeHtml(config.model || '未知') + '</span>';
    if (!hasKey && !isFreeProxy) { apiInfoEl.style.cursor = 'pointer'; apiInfoEl.title = '未配置 LLM，点击设置'; apiInfoEl.onclick = toggleSettings; }
    else { apiInfoEl.style.cursor = 'default'; apiInfoEl.title = ''; apiInfoEl.onclick = null; }
  }
  function renderStatus() { if (statusEl) statusEl.textContent = ({ idle: '空闲', running: '运行中…', completed: '已完成', error: '出错', stopped: '已停止' })[agent.status] || String(agent.status); if (stopEl) { if (agent.status === 'running') stopEl.classList.add('running'); else stopEl.classList.remove('running'); } renderApiInfo(); }
  function renderActivity(detail) {
    if (!activityEl) return;
    if (!detail) { activityEl.textContent = ''; return; }
    if (detail.type === 'thinking') activityEl.textContent = '🧠 思考中…';
    else if (detail.type === 'executing') activityEl.textContent = '⚙️ 执行 ' + detail.tool;
    else if (detail.type === 'executed') activityEl.textContent = '✅ ' + detail.tool + ' (' + Math.round(detail.duration || 0) + 'ms)';
    else if (detail.type === 'retrying') activityEl.textContent = '🔁 重试 ' + detail.attempt + '/' + detail.maxAttempts;
    else if (detail.type === 'error') activityEl.textContent = '❌ ' + detail.message;
  }
  function renderTools() {
    if (!toolsEl) return;
    if (!cpToolCalls.length) { toolsEl.innerHTML = ''; return; }
    toolsEl.innerHTML = '';
    cpToolCalls.forEach(function (tc) {
      var div = document.createElement('div'); div.className = 'cp-tool-call';
      div.innerHTML = '<span class="cp-tool">' + cpEscapeHtml(tc.name) + '</span> ' + cpEscapeHtml(JSON.stringify(tc.args || {}).slice(0, 120)) +
        (tc.result ? '<div>' + cpEscapeHtml(String(tc.result).slice(0, 200)) + '</div>' : '');
      toolsEl.appendChild(div);
    });
    toolsEl.scrollTop = toolsEl.scrollHeight;
  }
  function renderHistory() {
    if (!logEl) return;
    logEl.innerHTML = '';
    (agent.history || []).forEach(function (ev) {
      var div = document.createElement('div');
      if (ev.type === 'user') { div.className = 'cp-bubble cp-bubble-user'; div.innerHTML = cpEscapeHtml(String(ev.content || '')).replace(/\n/g, '<br>'); }
      else if (ev.type === 'assistant') { div.className = 'cp-bubble cp-bubble-assistant'; div.innerHTML = cpEscapeHtml(String(ev.content || '')).replace(/\n/g, '<br>'); }
      else if (ev.type === 'step') {
        var tn = ev.action && ev.action.name ? ev.action.name : '';
        var out = String(ev.action && ev.action.output || '');
        if (tn === 'done') {
          var doneText = String(ev.action && ev.action.input && ev.action.input.text || '(无文本)');
          div.className = 'cp-bubble cp-bubble-assistant';
          div.innerHTML = cpEscapeHtml(doneText).replace(/\n/g, '<br>');
        } else {
          div.className = 'cp-evt';
          div.innerHTML = '<span class="cp-tool">[' + cpEscapeHtml(tn) + ']</span> ' + cpEscapeHtml(out.slice(0, 240));
        }
      }
      else if (ev.type === 'observation') { div.className = 'cp-evt'; div.textContent = '👁 ' + String(ev.content).slice(0, 300); }
      else if (ev.type === 'error') { div.className = 'cp-evt-error'; div.textContent = '❌ ' + String(ev.message); }
      else { div.className = 'cp-evt'; div.textContent = JSON.stringify(ev).slice(0, 200); }
      logEl.appendChild(div);
    });
    logEl.scrollTop = logEl.scrollHeight;
  }
  function preprocessDoneToAssistant() {
    if (!agent.history || !Array.isArray(agent.history)) return false;
    var hist = agent.history, lastStep = null;
    for (var i = hist.length - 1; i >= 0; i--) { if (hist[i] && hist[i].type === 'step') { lastStep = hist[i]; break; } }
    if (!lastStep || !lastStep.action || lastStep.action.name !== 'done') return false;
    var input = lastStep.action.input; if (!input || typeof input !== 'object') return false;
    var doneText = String(input.text || ''); if (!doneText) return false;
    for (var j = 0; j < hist.length; j++) { var h = hist[j]; if (h && h.type === 'assistant' && String(h.content || '') === doneText) return false; }
    agent.history = hist.concat([{ type: 'assistant', content: doneText }]);
    return true;
  }
  function onHistoryChangeSafe() {
    var mc = typeof queueMicrotask === 'function' ? queueMicrotask : function (f) { setTimeout(f, 0); };
    mc(function () { var pushed = preprocessDoneToAssistant(); renderHistory(); renderApiInfo(); if (pushed) setTimeout(function () { renderHistory(); renderApiInfo(); }, 0); });
  }

  var cpToolCalls = [];
  var agent = null;
  try {
    if (window.agent && typeof window.agent.dispose === 'function') { try { window.agent.dispose(); } catch (_) {} }
    agent = new window.PageAgent(config);
    window.agent = agent;
    agent.addEventListener('statuschange', renderStatus);
    agent.addEventListener('activity', function (e) { renderActivity(e.detail); });
    agent.addEventListener('historychange', onHistoryChangeSafe);
    agent.addEventListener('dispose', function () { if (statusEl) statusEl.textContent = '已销毁'; });
    agent.onAskUser = function (q) { return Promise.resolve(window.prompt(q) || ''); };
    renderApiInfo();
  } catch (err) {
    console.error('[CAID] agent init error:', err);
    if (statusEl) statusEl.textContent = '初始化失败: ' + err.message;
  }

  // ---------- 发送任务 ----------
  async function sendTask() {
    if (!inputEl || !agent) return;
    var t = inputEl.value.trim(); if (!t) return; inputEl.value = '';
    agent.history = agent.history || [];
    agent.history.push({ type: 'user', content: t });
    agent.dispatchEvent(new Event('historychange'));
    try { await agent.execute(t); }
    catch (e) { agent.history.push({ type: 'error', message: String(e && e.message ? e.message : e) }); agent.dispatchEvent(new Event('historychange')); }
  }
  if (sendEl) sendEl.addEventListener('click', sendTask);
  if (inputEl) inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTask(); } });
  if (closeEl) closeEl.addEventListener('click', function () { var cp = document.getElementById('caidExtCopilot'); if (cp) cp.classList.remove('open'); });

  // ---------- 强行终止当前任务 ----------
  // PageAgent 内置 agent.stop()：abort 内部 AbortController -> 循环中的 signal.throwIfAborted() 抛错 -> 结束 execute()。
  function forceStop() {
    if (!agent) { logBubble('assistant', '⏹ 没有可用的副驾实例。'); return; }
    if (agent.status !== 'running') { logBubble('assistant', '⏹ 当前没有运行中的任务。'); return; }
    try {
      var p = agent.stop();
      if (p && typeof p.catch === 'function') p.catch(function (e) { console.warn('[CAID] stop() rejected:', e); });
      logBubble('assistant', '⏹ 已强行终止当前任务（快捷键 Ctrl+.）。');
    } catch (e) {
      console.warn('[CAID] forceStop error:', e);
      logBubble('assistant', '⏹ 终止时出错：' + (e && e.message ? e.message : e));
    }
    if (statusEl) statusEl.textContent = '已停止';
    if (stopEl) stopEl.classList.remove('running');
  }
  if (stopEl) stopEl.addEventListener('click', forceStop);
  // 全局快捷键：Ctrl+. (或 Cmd+.) 强行终止运行中任务
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === '.' || e.code === 'Period')) {
      if (agent && agent.status === 'running') { e.preventDefault(); forceStop(); }
    }
  });

  var settingsEl = document.getElementById('cpSettings');
  if (settingsEl) settingsEl.addEventListener('click', toggleSettings);

  // 内联设置表单：保存经 content.js 事件桥接写入 chrome.storage.local（MAIN world 无 chrome.*）
  var saveEl = document.getElementById('cpSave');
  if (saveEl) saveEl.addEventListener('click', function () {
    var f = document.getElementById('cpUseFree');
    var m = document.getElementById('cpModel');
    var u = document.getElementById('cpBaseUrl');
    var k = document.getElementById('cpApiKey');
    var useFree = f ? f.checked : true;
    var apiKey = (k && k.value) ? k.value.trim() : '';
    var model = (m && m.value) ? m.value.trim() : 'qwen3.5-plus';
    var baseUrl = (u && u.value) ? u.value.trim() : '';
    var cfg = { model: model, baseURL: baseUrl, apiKey: useFree ? 'NA' : apiKey, custom: !useFree };
    try { window.dispatchEvent(new CustomEvent('__caid_save_settings', { detail: cfg })); } catch (e) {}
    // 立即更新本会话配置，便于当前副驾恢复后使用
    window.__CAID_LLM_CFG = cfg;
    if (config) { config.model = cfg.model; config.baseURL = cfg.baseURL; config.apiKey = cfg.apiKey; }
    renderApiInfo();
    var saved = document.getElementById('cpSaved');
    if (saved) { saved.textContent = '已保存 ✓ 重新发送消息即生效'; setTimeout(function () { if (saved) saved.textContent = ''; }, 2500); }
  });

  // ---------- 断点续传：若本次启动携带上次跳转的上下文，恢复历史并自动继续 ----------
  (async function resumeIfNeeded() {
    try {
      const h = window.__CAID_HANDOFF;
      if (!h || !agent) return;
      // 恢复历史展示
      if (Array.isArray(h.recent) && h.recent.length) {
        agent.history = h.recent;
        agent.dispatchEvent(new Event('historychange'));
      }
      if (inputEl && typeof sendTask === 'function') {
        const cont = '【任务续传】你正在协助用户完成：' + (h.goal || '') +
          '\n此前你已离开 ' + (h.fromUrl || '上一页') + ' 并自动跳转到当前页面 ' + location.href +
          '。请先观察当前页面，然后继续完成上述任务（例如执行搜索 / 操作 / 填表）。';
        logBubble('assistant', '⟳ 检测到任务续传：' + (h.goal || ''));
        setTimeout(function () { inputEl.value = cont; sendTask(); }, 500);
      }
      window.__CAID_HANDOFF = null;
    } catch (e) { console.warn('[CAID] 续传失败', e); }
  })();
})();
