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
      // 扩展页（如自己接管的 newtab）的 MAIN world 拥有完整 chrome.*：
      // 直接经 runtime 转发 background 真正发起（复用 CAID_LLM_FETCH 分支），
      // 绕过 ISOLATED world 的 postMessage 桥（content.js 不在该环境运行，桥无人接收）。
      // 普通页注入的 MAIN world 没有 chrome.*，会落到下面的 postMessage 桥。
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        var cmethod = (init && init.method) || 'GET';
        var cheaders = _normHeaders(init && init.headers);
        var cbodyText = null, cbodyB64 = null;
        if (init && init.body != null) {
          if (typeof init.body === 'string') cbodyText = init.body;
          else if (init.body instanceof ArrayBuffer) cbodyB64 = _b64enc(new Uint8Array(init.body));
          else if (ArrayBuffer.isView(init.body)) cbodyB64 = _b64enc(new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength));
          else cbodyText = String(init.body);
        }
        try {
          chrome.runtime.sendMessage(
            { type: 'CAID_LLM_FETCH', url: String(url), method: cmethod, headers: cheaders, bodyText: cbodyText, bodyB64: cbodyB64 },
            function (resp) {
              if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message || 'runtime.lastError')); return; }
              if (!resp) { reject(new Error('CAID_LLM_FETCH: 无响应')); return; }
              if (resp.error) { reject(new Error(resp.error)); return; }
              try {
                var body = resp.bodyB64 ? _b64dec(resp.bodyB64) : (resp.bodyText || '');
                resolve(new Response(body, { status: resp.status || 200, statusText: resp.statusText || '', headers: resp.headers || {} }));
              } catch (e) { reject(e); }
            }
          );
        } catch (e) { reject(e); }
        return;
      }
      // 原 postMessage 桥（普通页 MAIN world，无 chrome.*，需 ISOLATED world 的 content.js 转发）
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

  // 内联设置面板：直接在主站 DOM 的副驾面板里展开，彻底绕开被拦截器拦的 chrome-extension://newtab.html 导航
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
  // 自建启动按钮：仅当 content.js（ISOLATED world）未创建 #caidLauncher 时调用。
  // 用于扩展页 / 自己接管的 newtab —— content script 不注入该环境，没有常驻启动按钮。
  // 注意 MAIN 与 ISOLATED world 的 window 是隔离的，但 DOM 共享，故用 getElementById 判定可靠。
  function ensureLauncher() {
    var existing = document.getElementById('caidLauncher');
    // 面板开着时按钮应保持隐藏（与 content.js watchPanel 的 data-panel-open 语义一致）
    var panelOpen = false;
    try { var cpEl = document.getElementById('caidExtCopilot'); panelOpen = !!(cpEl && cpEl.classList.contains('open')); } catch (e) {}
    if (existing) {
      // 按钮已存在（通常由 content.js ISOLATED world 创建）—— 升级样式到最高优先级
      existing.style.setProperty('z-index', '2147483647', 'important');
      existing.style.setProperty('pointer-events', 'auto', 'important');
      if (panelOpen) {
        existing.setAttribute('data-panel-open', '1');
        existing.style.setProperty('display', 'none', 'important');
      }
      return;
    }
    var btn = document.createElement('div');
    btn.id = 'caidLauncher';
    btn.textContent = '🤖 CAID 副驾';
    btn.title = '在当前页面启动 CAID 智能体副驾';
    btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647!important;background:#185FA5;color:#fff;padding:8px 14px;border-radius:20px;font:13px/1.2 sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);user-select:none;pointer-events:auto!important;' + (panelOpen ? 'display:none!important;' : '');
    if (panelOpen) btn.setAttribute('data-panel-open', '1');
    btn.addEventListener('click', function () {
      var cp = document.getElementById('caidExtCopilot');
      if (cp) cp.classList.add('open');
    });
    document.body.appendChild(btn);
  }

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
  // content.js 不运行在扩展页 / 接管的 new标签页：这些环境没有 #caidLauncher，这里自建一个。
  if (!document.getElementById('caidLauncher')) {
    var _cpEl0 = document.getElementById('caidExtCopilot');
    if (_cpEl0) _cpEl0.classList.remove('open'); // 扩展页默认收起，避免每次开新标签占满右栏
    ensureLauncher();
  }

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
        'RULES: this tool is ONLY for in-page actions — scroll, click non-navigating buttons, fill forms, mutate DOM, read data. ' +
        'NEVER write navigation code in the script: location.href= / location.assign / location.replace, window.open, ' +
        'clicking <a href> links, or form submit that navigates away. ' +
        'If the goal is to open another page, read the full href first (execute_javascript can read it), ' +
        'then use navigate_to_url or open_url_in_new_tab to navigate — the task continues automatically on the new page. ' +
        'Scripts that change the page URL are detected: the tool returns a warning, and you must switch to the navigation tools.',
      inputSchema: mkObj({ script: 'string' }),
      execute: async function (input, ctx) {
        const signal = ctx && ctx.signal;
        // 跳转护栏：执行前记录当前 URL（忽略 hash），执行后若地址变化则判定为脚本内跳转，
        // 返回警告引导模型改用导航工具（提示词 + 运行时检测双保险）。
        const stripHash = (u) => { try { const a = new URL(u); a.hash = ''; return a.href; } catch (e) { return String(u || ''); } };
        let before = '';
        try { before = stripHash(window.location.href); } catch (e) {}
        let out;
        if (!this || !this.pageController || typeof this.pageController.executeJavascript !== 'function') {
          const result = (0, eval)(String(input && input.script));
          out = (result && typeof result.then === 'function') ? (await result) : String(result ?? '');
        } else {
          const r = await this.pageController.executeJavascript(String(input && input.script), signal);
          signal && signal.throwIfAborted && signal.throwIfAborted();
          out = (r && r.message) || String((r && r.result) ?? '');
        }
        try {
          const after = stripHash(window.location.href);
          if (before && after && after !== before) {
            out = '⚠️ 检测到脚本导致了页面导航（URL 从 ' + before + ' 变为 ' + after + '）。' +
              '跳转必须由 navigate_to_url / open_url_in_new_tab 工具接管（任务会自动续跑），' +
              '不要在 execute_javascript 里写跳转代码。如需进入该页面，请改用导航工具打开 ' + after + '。' +
              '\n[脚本输出] ' + String(out);
          }
        } catch (e) {}
        return out;
      }
    },

    navigate_to_url: {
      description: 'Open a given URL in a NEW browser tab, preserving the current page (the original page is never replaced). The agent continues on the new tab.',
      inputSchema: mkObj({ url: 'string:url' }),
      execute: async function (input) {
        const url = String(input && input.url || '').trim();
        console.log('[CAID-R] ★★★ navigate_to_url 工具被调用! input=', JSON.stringify(input), ' resolved url=', url);
        if (!url) throw new Error('navigate_to_url: url is required');
        // 断点续传：构建 handoff，经 caidRequestNavigate 桥接发给 background（handoff 存储与开标签都在 background 完成）。
        let handoff = null;
        try {
          handoff = buildHandoff(url);
          if (handoff) {
            console.log('[CAID-R] navigate_to_url: buildHandoff goal=', handoff.goal, ' toUrl=', handoff.toUrl);
          } else {
            console.warn('[CAID-R] navigate_to_url: buildHandoff 返回 null（无历史/无 goal），不存续传');
          }
        } catch (e) { console.warn('[CAID-R] navigate_to_url: buildHandoff 异常', e); }
        // 立即终止当前页 agent，避免它在原页面继续空转输出；
        // 检查点已保存，新标签副驾会自动续跑（控制权转移到新标签，原页面保留）。
        isHandingOff = true;
        try { if (agent && agent.status === 'running') agent.stop(); } catch (_) {}
        cleanupAgentOverlays();  // 清理残留覆盖层，避免遮挡原页 UI
        // caidRequestNavigate 路由：扩展页 MAIN world 自带 chrome API → 直连 background；
        // 正则网页 MAIN world 无 chrome.* → 派发 __caid_navigate_request DOM 事件，由 ISOLATED world
        // 的 content.js 转发给 background。background 用 chrome.tabs.create 打开新标签并存储 handoff
        // （chrome.storage.session 永远有权限）→ 新标签加载完成 tabs.onUpdated 读 handoff 注入副驾续跑。
        caidRequestNavigate(url, true, handoff);
        return `✅ Opened in new tab (task continues there): ${url}`;
      }
    },

    open_url_in_new_tab: {
      description: 'Open a URL in a new browser tab (does not leave the current page).',
      inputSchema: mkObj({ url: 'string:url' }),
      execute: async function (input) {
        const url = String(input && input.url || '').trim();
        if (!url) throw new Error('open_url_in_new_tab: url is required');
        // 断点续传：构建 handoff 并随导航消息发给 background（不再依赖 content.js 桥接，扩展页上 content.js 不运行）
        let h2 = null;
        try {
          h2 = buildHandoff(url);
          if (h2) console.log('[CAID-R] open_url_in_new_tab: buildHandoff goal=', h2.goal);
          else console.warn('[CAID-R] open_url_in_new_tab: buildHandoff 返回 null');
        } catch (e) { console.warn('[CAID-R] open_url_in_new_tab: buildHandoff 异常', e); }
        // 经桥接把「导航目标 + 续传上下文」发给 background（扩展页直连 / 正则网页走 content.js DOM 桥）
        caidRequestNavigate(url, false, h2);
        // 当前页 agent 无法操作新标签，立即终止本页 agent，使控制权转移到新标签续跑的副驾。
        isHandingOff = true;
        try { if (agent && agent.status === 'running') agent.stop(); } catch (e) {}
        return `✅ Opened in new tab (task will continue there): ${url}`;
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
    if (!agent) { console.warn('[CAID-R] buildHandoff: agent 不存在'); return null; }
    const hist = agent.history || [];
    // 提取目标（优先从历史找 user 消息，回退到输入框当前值）
    let goal = '';
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i] && hist[i].type === 'user') { goal = hist[i].content; break; }
    }
    // 【关键修复】不再因"无历史/无 user 条目"就返回 null——三级回退：
    // ① agent.history 里的 user 消息 → ② inputEl.value → ③ _currentGoal（sendTask 时存的原始指令）
    if (!goal && inputEl) goal = String(inputEl.value || '').trim();
    if (!goal && _currentGoal) goal = _currentGoal;
    if (!goal) { console.warn('[CAID-R] buildHandoff: 无法提取 goal（history=', hist.length, ', inputEl=', inputEl ? '"' + inputEl.value + '"' : 'N/A', ', _currentGoal=', '"' + _currentGoal + '"', ')'); return null; }
    const recent = hist.slice(-12).map(function (ev) {
      if (ev.type === 'user') return { type: 'user', content: ev.content };
      if (ev.type === 'assistant') return { type: 'assistant', content: ev.content };
      if (ev.type === 'step') return { type: 'step', action: { name: ev.action && ev.action.name, input: ev.action && ev.action.input, output: (ev.action && ev.action.output || '').slice(0, 300) } };
      if (ev.type === 'error') return { type: 'error', message: ev.message };
      return { type: ev.type };
    }).filter(function (ev) { return ev.type !== 'error'; });
    return { goal: goal, fromUrl: location.href, toUrl: targetUrl, ts: Date.now(), recent: recent };
  }

  // ---------- 持续检查点：任务运行期间不断把上下文快照写入 storage.session ----------
  // 这样无论跳转由哪个工具触发、还是站内表单提交/意外崩溃，新页面都能捡起续跑。
  var isHandingOff = false;     // 正在因跳转而终止当前页 agent（此时不要清除检查点）
  var _currentGoal = '';         // 【续传兜底】sendTask 时存原始指令，buildHandoff 在 history/inputEl 均空时使用
  var isResuming = false;       // 正在恢复上次任务（此时不要重复检查点）
  var _lastCpTs = 0;
  function checkpoint() {
    if (!agent || isHandingOff || isResuming) return;
    if (agent.status !== 'running') return;
    var now = Date.now();
    if (now - _lastCpTs < 1500) return;   // 节流，避免每步都写存储
    _lastCpTs = now;
    try {
      var h = buildHandoff(null);         // toUrl=null：任何跳转目的地都可续跑
      if (h) {
        console.log('[CAID-R] checkpoint: 续传快照已派发, goal=', h.goal);
        window.dispatchEvent(new CustomEvent('__caid_store_handoff', { detail: h }));
        caidSendToBg({ type: 'CHECKPOINT', handoff: h });  // 扩展页直连 background（content.js 不运行时兜底）
      }
    } catch (e) {}
  }
  function clearCheckpoint() {
    try { window.dispatchEvent(new CustomEvent('__caid_clear_handoff')); } catch (e) {}
    caidSendToBg({ type: 'CLEAR_CHECKPOINT' });
  }

  // ---------- 导航请求桥接：MAIN world 无 chrome.*，统一经 DOM 事件交给 ISOLATED world 的 content.js 转发 ----------
  // 背景：navigate_to_url / open_url_in_new_tab 在正则网页（MAIN world）上拿不到 chrome.runtime，
  // 直接发消息会抛 no-chrome-runtime，此前误用 window.open 兜底导致 handoff 未写入、续跑中断。
  // 方案：① 扩展页（newtab 等，MAIN world 自带 chrome API）直接发消息给 background；
  //       ② 正则网页改派发 __caid_navigate_request DOM 事件，由 content.js（ISOLATED world）转发给 background；
  //       ③ 终极兜底才用 window.open（此时无法续跑，但至少打开页面）。
  // background 收到后：存储 handoff（chrome.storage.session，永远有权限）+ 用 chrome.tabs.create 打开新标签，
  // 新标签加载完成触发 tabs.onUpdated → 自动注入副驾续跑。
  function caidRequestNavigate(url, active, handoff) {
    // ① 扩展页 MAIN world 自带 chrome API → 直接发消息（最可靠）
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_URL', url: url, active: active !== false, handoff: handoff || null });
        console.log('[CAID-R] caidRequestNavigate: 已直接发 NAVIGATE_TO_URL 给 background (url=' + url + ', handoff=' + !!(handoff) + ')');
        return;
      }
    } catch (e) {
      console.warn('[CAID-R] caidRequestNavigate: 直接发送失败, 转 DOM 桥:', e.message || e);
    }
    // ② 正则网页 MAIN world 无 chrome API → 派发 DOM 事件，由 content.js（ISOLATED world）转发
    try {
      window.dispatchEvent(new CustomEvent('__caid_navigate_request', {
        detail: { url: url, active: active !== false, handoff: handoff || null }
      }));
      console.log('[CAID-R] caidRequestNavigate: 已派发 __caid_navigate_request 给 content.js（DOM 桥）');
      return;
    } catch (e2) {
      console.warn('[CAID-R] caidRequestNavigate: DOM 桥失败, 最后回退 window.open:', e2.message || e2);
    }
    // ③ 终极兜底：仅打开页面（无法续跑）
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e3) {}
  }

  // ---------- 通用 background 消息桥 ----------
  // 与 caidRequestNavigate 同理：扩展页（MAIN world 有 chrome API）直接发消息；
  // 正则网页（MAIN world 无 chrome API）改派发 __caid_bg_message DOM 事件，由 content.js（ISOLATED world）转发。
  // 用途：AGENT_ACTIVE / AGENT_INACTIVE / CHECKPOINT / CLEAR_CHECKPOINT 等消息。
  function caidSendToBg(msg) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage(msg);
        return;
      }
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('__caid_bg_message', { detail: msg }));
    } catch (e) {}
  }

  // ---------- 创建 agent ----------
  const cfg = window.__CAID_LLM_CFG || {};
  // 【诊断】打印实际配置，排查"面板显示与实际使用不一致"
  console.log('[CAID-R] agent 创建配置 dump:', JSON.stringify({
    model: cfg.model, baseURL: cfg.baseURL, hasKey: !!(cfg.apiKey && cfg.apiKey !== 'NA' && cfg.apiKey !== 'null' && cfg.apiKey !== 'undefined'),
    isCustom: !!(cfg.baseURL) && !!(cfg.apiKey && cfg.apiKey !== 'NA' && cfg.apiKey !== 'null' && cfg.apiKey !== 'undefined'),
    FREE_PROXY: 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run'
  }));
  // 注意：扩展配置 schema 的键是 baseURL（大写 URL），与内联保存（cpSave）和 caid-bridge 写入保持一致。
  // 判定是否为"自定义 LLM"：必须填了可用的 baseURL + 真实 API Key（非占位 'NA'）。
  // 否则一律走内置免费代理（qwen3.5-plus），避免因为 baseURL 缺失触发 PageAgent 的 config required 报错。
  const hasRealKey = cfg.apiKey && cfg.apiKey !== 'NA' && cfg.apiKey !== 'null' && cfg.apiKey !== 'undefined';
  const isCustom = !!(cfg.baseURL) && hasRealKey;
  const FREE_PROXY = 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run';
  const sysPrompt = '你是一个运行在任意网页上的智能体副驾（CAID）。你可以：用 execute_javascript 执行脚本、' +
    'navigate_to_url / open_url_in_new_tab 控制导航、search_web / search_code 检索、output_code 输出代码、' +
    'auto_fill_form 填表、extract_page_data 提取数据、navigate_to_main_site 回到工作台。' +
    '优先使用合适的工具完成任务，最后用 done 汇报结果。' +
    '跳转其他网站时优先用 navigate_to_url（在新标签打开、保留当前页面）；' +
    '无论是跨站还是站内跳转（如搜索后进入结果页），任务都会自动续跑，不要因为页面切换而中断或重复已完成的工作。' +
    '【跳转链接规则】页面观察结果中的链接会带 href=URL：当你的目标是"进入某链接/打开某页面"时，' +
    '不要用 click 点击链接（点击后页面切换无法控制），而是直接从 href 读取完整 URL，' +
    '用 open_url_in_new_tab 或 navigate_to_url 打开它，任务会自动在新页面续跑。' +
    '若 href 显示被截断（以 ... 结尾），先用 execute_javascript 读取元素的完整 href 再跳转。' +
    '【行动 vs 跳转判断】execute_javascript 只做当前页面内的行动：滚动、点击不跳转的按钮、填表、修改 DOM、读取数据。' +
    '凡是会让页面切换地址的操作——点击带 href 的链接、location.href= / location.assign / location.replace、' +
    'window.open、表单提交跳转——都属于跳转，一律先读出完整 URL，改用 navigate_to_url / open_url_in_new_tab 打开。' +
    'execute_javascript 脚本里禁止任何跳转语句；若脚本导致地址变化，工具会返回警告并要求改用导航工具。';
  const customTools = tools;
  // includeAttributes: ['href'] —— 让简化 HTML 里的链接带上 URL（默认白名单没有 href，
  // 模型看不到链接地址，才会"点了跳转链接但不知道去哪"。加上后模型能直接看到
  // [12]<a href=https://...>视频标题</a>，从而用 navigate 工具接管跳转）。
  const baseCfg = { language: 'zh-CN', instructions: { system: sysPrompt }, experimentalScriptExecutionTool: true, enableMask: true, customTools, includeAttributes: ['href'] };
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
  function renderStatus() { var st = agent.status; if (statusEl) statusEl.textContent = ({ idle: '空闲', running: '运行中…', completed: '已完成', error: '出错', stopped: '已停止' })[st] || String(st); if (stopEl) { if (st === 'running') stopEl.classList.add('running'); else stopEl.classList.remove('running'); } if (st === 'completed' || st === 'error' || st === 'stopped') { if (!(st === 'stopped' && isHandingOff)) { clearCheckpoint(); caidSendToBg({ type: 'AGENT_INACTIVE' }); } } renderApiInfo(); }
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
    mc(function () { var pushed = preprocessDoneToAssistant(); renderHistory(); renderApiInfo(); checkpoint(); if (pushed) setTimeout(function () { renderHistory(); renderApiInfo(); }, 0); });
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
    _currentGoal = t; // 【续传兜底】保存原始指令，buildHandoff 在 history/inputEl 均空时使用
    caidSendToBg({ type: 'AGENT_ACTIVE', goal: t, fromUrl: location.href });  // 通知 background：本 tab 有活跃 agent，页面导航时自动跟随
    agent.history = agent.history || [];
    agent.history.push({ type: 'user', content: t });
    agent.dispatchEvent(new Event('historychange'));
    try { await agent.execute(t); }
    catch (e) { if (!isHandingOff) { agent.history.push({ type: 'error', message: String(e && e.message ? e.message : e) }); agent.dispatchEvent(new Event('historychange')); } }
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
    // 清理 PageAgent 可能残留的高 z-index 覆盖层（观察/高亮/标注等），
    // 防止它们遮挡 🤖 启动按钮导致"按钮点不开"。
    cleanupAgentOverlays();
    isHandingOff = false;
    caidSendToBg({ type: 'AGENT_INACTIVE' });  // 通知 background：本 tab agent 已停止，不再自动跟随
  }

  // background 自动跟随到新标签（target=_blank）后，经 content.js 派发此事件让本（旧）页 agent 停止，
  // 避免旧页 agent 在原地空转（"发懵"）、两边上下文互相覆盖。
  window.addEventListener('__caid_force_stop', function () {
    try {
      if (agent && agent.status === 'running') {
        console.log('[CAID-R] 收到 __caid_force_stop：任务已在新页面续跑，停止本页 agent');
        logBubble('assistant', '⏹ 任务已跳转到新页面继续，本页 agent 已停止。');
        forceStop();
      }
    } catch (e) {}
  });

  // 清理 PageAgent 运行期间可能创建的覆盖层 DOM，恢复页面可交互性
  // PageAgent 会创建观察框、高亮标注、全屏 pointer-events 拦截层等，
  // agent.stop() 后这些残留 DOM 会遮挡 🤖 启动按钮导致无法点击。
  function cleanupAgentOverlays() {
    try {
      // 策略1：按已知选择器精确清除
      var selectors = [
        '[data-page-agent]', '.pa-overlay', '.pa-highlight', '.pa-observation',
        '#page-agent-root', '#page-agent-ui', '.page-agent-screenshot',
        '[style*="z-index"][style*="2147483647"]', '[style*="z-index"][style*="2147483646"]',
        '.page-agent-shield', '.pa-modal', '.pa-backdrop'
      ];
      selectors.forEach(function (sel) {
        try { document.querySelectorAll(sel).forEach(function (el) { el.remove(); }); } catch (_) {}
      });
      // 策略2：暴力清除所有 position:fixed/absolute 且 z-index > 1000000 的非 CAID 元素（PageAgent 常用超高 z-index）
      document.querySelectorAll('*').forEach(function (el) {
        try {
          var s = getComputedStyle(el);
          if ((s.position === 'fixed' || s.position === 'absolute') && parseInt(s.zIndex || '0', 10) > 1000000 &&
              el.id !== 'caidLauncher' && el.id !== 'caidExtCopilot' && !el.closest('#caidExtCopilot')) {
            console.log('[CAID] cleanupAgentOverlays: 移除残留高 z-index 元素', el.tagName, '#' + el.id, '.' + el.className);
            el.remove();
          }
        } catch (_) {}
      });
    } catch (_) {}
    // 策略3：确保 🤖 按钮存在且可点击
    ensureLauncher();
    var btn = document.getElementById('caidLauncher');
    if (btn) {
      btn.style.display = '';
      btn.style.visibility = 'visible';
      btn.style.setProperty('pointer-events', 'auto', 'important');
      btn.style.setProperty('z-index', '2147483647', 'important');
      // 移到 body 末尾，确保相同 z-index 时 DOM 顺序最后 → 始终在最上层
      if (btn.parentNode && btn.parentNode.lastChild !== btn) {
        btn.parentNode.appendChild(btn);
      }
    }
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
      console.log('[CAID-R] resumeIfNeeded: 启动, handoff?', !!h, ' agent?', !!agent, ' inputEl?', !!inputEl);
      if (!h || !agent) return;
      isResuming = true;
      isHandingOff = false;
      // 恢复历史展示
      if (Array.isArray(h.recent) && h.recent.length) {
        agent.history = h.recent;
        agent.dispatchEvent(new Event('historychange'));
      }
      if (inputEl && typeof sendTask === 'function') {
        const cont = '【任务续传】你正在协助用户完成：' + (h.goal || '') +
          '\n此前你已离开 ' + (h.fromUrl || '上一页') + ' 并自动跳转到当前页面 ' + location.href +
          '。请先观察当前页面（URL 可能已变化），然后继续完成上述任务（例如执行搜索 / 操作 / 填表）。';
        logBubble('assistant', '⟳ 检测到任务续传：' + (h.goal || ''));
        console.log('[CAID-R] resumeIfNeeded: 500ms 后自动 sendTask 续跑');
        setTimeout(function () { console.log('[CAID-R] resumeIfNeeded: 调用 sendTask'); inputEl.value = cont; sendTask(); isResuming = false; }, 500);
      } else {
        console.warn('[CAID-R] resumeIfNeeded: inputEl 或 sendTask 不可用，放弃自动续跑');
        isResuming = false;
      }
      window.__CAID_HANDOFF = null;
    } catch (e) { console.warn('[CAID-R] resumeIfNeeded: 续传失败', e); isResuming = false; }
  })();

  // 🛡️ MutationObserver：保活 🤖 启动按钮
  // PageAgent 或其他脚本可能移除/遮挡按钮，此 observer 确保按钮始终存在、可见、可点击。
  // 使用 debounce 避免短时间内大量 DOM 变更触发频繁重建。
  var _launcherGuardTimer = null;
  var _launcherGuard = new MutationObserver(function () {
    if (_launcherGuardTimer) return;
    _launcherGuardTimer = setTimeout(function () {
      _launcherGuardTimer = null;
      var btn = document.getElementById('caidLauncher');
      if (!btn) { ensureLauncher(); return; }
      // 面板打开时按钮是有意隐藏的（content.js 设置了 data-panel-open），保活逻辑必须跳过，否则按钮盖在面板上
      if (btn.getAttribute('data-panel-open') === '1') return;
      // 确保按钮可见、可点击、z-index 最高
      var s = getComputedStyle(btn);
      if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') {
        btn.style.display = '';
        btn.style.visibility = 'visible';
      }
      btn.style.setProperty('pointer-events', 'auto', 'important');
      btn.style.setProperty('z-index', '2147483647', 'important');
      // 将按钮移到 body 末尾：相同 z-index 时 DOM 顺序最后的元素在最上层
      if (btn.parentNode && btn.parentNode.lastChild !== btn) {
        btn.parentNode.appendChild(btn);
      }
    }, 300);
  });
  _launcherGuard.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true });
})();
