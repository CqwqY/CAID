// CAID 扩展 content script（ISOLATED world）
// 职责：在任意页面右下角渲染一个常驻的"启动副驾"悬浮按钮；
// 点击后通过 runtime 消息让 background 以 MAIN world 注入魔改 Page-Agent。
(function () {
  if (window.__CAID_LAUNCHER) return;
  window.__CAID_LAUNCHER = true;

  // 把扩展内部 URL 写到共享 window 上，供 MAIN world 的 caid-copilot.js 读取
  // （MAIN world 无 chrome.runtime，无法自己 getURL；ISOLATED world 设的属性 MAIN world 可读）
  try { window.__CAID_OPTIONS_URL = chrome.runtime.getURL('options.html'); } catch (e) {}

  function addButton() {
    if (!document.body) { setTimeout(addButton, 300); return; }
    if (document.getElementById('caidLauncher')) return;

    var btn = document.createElement('div');
    btn.id = 'caidLauncher';
    btn.textContent = '🤖 CAID 副驾';
    btn.title = '在当前页面启动 CAID 智能体副驾';
    btn.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483646;' +
      'background:#185FA5;color:#fff;padding:8px 14px;border-radius:20px;' +
      'font:13px/1.2 sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);' +
      'user-select:none;';

    btn.addEventListener('click', function () {
      if (window.__CAID_BOOTED) {
        var p = document.getElementById('caidExtCopilot');
        if (p) p.classList.add('open');
        return;
      }
      chrome.runtime.sendMessage({ type: 'BOOT_COPILOT' });
    });

    document.body.appendChild(btn);
  }

  addButton();

  // MAIN↔ISOLATED 桥：监听 MAIN world 派发的自定义事件，
  // 用 ISOLATED world 的 chrome.* API 执行特权操作（如打开 options 页）。
  window.addEventListener('__caid_open_options', function () {
    // 不在 content script 里直接 openOptionsPage（Edge 会当成网页导航拦截），
    // 改为发消息给 background，由特权上下文打开，绝不会被拦。
    console.log('[CAID-content] 收到 __caid_open_options 事件，转发 OPEN_OPTIONS 给 background');
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    } catch (e) {
      console.warn('[CAID-content] sendMessage OPEN_OPTIONS 失败', e);
    }
  });

  // MAIN world 的副驾内联设置表单通过此事件把配置写入扩展存储
  // （MAIN world 无 chrome.*，由 ISOLATED world 用 chrome.storage.local 写入；
  //  caid-bridge.js 监听 storage.onChanged 会把扩展配置同步回主站，实现双向同步）
  window.addEventListener('__caid_save_settings', function (e) {
    var cfg = e && e.detail;
    if (!cfg) return;
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      console.log('[CAID-content] 收到 __caid_save_settings，写入 chrome.storage.local.caidLlm');
      chrome.storage.local.set({ caidLlm: cfg });
    } catch (ex) {
      console.warn('[CAID-content] save_settings failed:', ex.message || ex);
    }
  });

  // MAIN world 的 navigate_to_url / open_url_in_new_tab 工具通过此事件把断点续传上下文传给 ISOLATED world 写入 storage.session
  window.addEventListener('__caid_store_handoff', function (e) {
    var h = e && e.detail;
    if (!h) return;
    try {
      if (!chrome || !chrome.storage || !chrome.storage.session) return;
      console.log('[CAID-content] 收到续传上下文，写入 storage.session');
      chrome.storage.session.set({ caidHandoff: h }, function () {
        if (chrome.runtime.lastError) { console.warn('[CAID-content] store_handoff 写入失败:', chrome.runtime.lastError.message); return; }
      });
    } catch (ex) {
      console.warn('[CAID-content] store_handoff failed:', ex.message || ex);
    }
  });

  // MAIN world 的副驾在任务正常结束 / 被强行终止时派发此事件，清除续传上下文，避免误触发
  window.addEventListener('__caid_clear_handoff', function () {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.session) return;
      chrome.storage.session.remove(['caidHandoff'], function () {
        if (chrome.runtime.lastError) { console.warn('[CAID-content] clear_handoff 失败:', chrome.runtime.lastError.message); }
      });
    } catch (ex) {}
  });

  // MAIN world 的副驾（无 chrome.*）把 LLM 网络请求经 window.postMessage 转交本 ISOLATED world，
  // 再由本脚本发往 background service worker 真正发起（扩展网络，不受宿主页 CSP 限制），
  // 最后把响应回传 MAIN world，由其重建为标准 Response 交给 Page-Agent。
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__caidType !== 'CAID_FETCH') return;
    try {
      if (!chrome || !chrome.runtime) return;
      chrome.runtime.sendMessage(
        { type: 'CAID_LLM_FETCH', url: d.url, method: d.method, headers: d.headers, bodyText: d.bodyText, bodyB64: d.bodyB64 },
        function (resp) {
          if (chrome.runtime.lastError) {
            window.postMessage({ __caidType: 'CAID_FETCH_RESP', id: d.id, error: String(chrome.runtime.lastError.message || chrome.runtime.lastError) }, '*');
            return;
          }
          window.postMessage({
            __caidType: 'CAID_FETCH_RESP',
            id: d.id,
            status: resp && resp.status,
            statusText: resp && resp.statusText,
            headers: resp && resp.headers,
            bodyB64: resp && resp.bodyB64
          }, '*');
        }
      );
    } catch (e) {
      window.postMessage({ __caidType: 'CAID_FETCH_RESP', id: d.id, error: e.message || String(e) }, '*');
    }
  });

  // 自动续传：若本次导航由本扩展副驾发起（存在待续传上下文且命中目标页），
  // 自动启动副驾并把上下文传进去，实现"跳转后断点续传"。
  // 扩展副驾（#caidExtCopilot 已注入）时跳过，避免重复启动。
  (function tryAutoResume() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.session) return;
      if (document.getElementById('caidExtCopilot')) return; // 扩展副驾已注入
      chrome.storage.session.get(['caidHandoff'], function (got) {
        if (chrome.runtime.lastError) return; // storage unavailable in this context
        const h = got && got.caidHandoff;
        if (!h) return;
        // 过期保护：超过 2 分钟未消费的续传上下文直接作废，避免误触发
        if (h.ts && Date.now() - h.ts > 120000) { chrome.storage.session.remove(['caidHandoff']); return; }
        // 来源页本身不续跑，避免同页循环
        if (location.href === (h.fromUrl || '')) return;
        // 续跑判定：① 显式目的地命中（toUrl 主机 == 当前页）；或 ② 已离开检查点来源页（moved，覆盖站内表单提交等任意跳转）
        let destMatch = false;
        try { if (h.toUrl) destMatch = location.host === new URL(h.toUrl).host; } catch (e) {}
        let moved = (location.href !== (h.toUrl || ''));
        if (!destMatch && !moved) return;
        // 一次性消费：清除存储并触发启动（context 经消息传给 background → window.__CAID_HANDOFF）
        chrome.storage.session.remove(['caidHandoff'], function () {
          if (chrome.runtime.lastError) return;
          chrome.runtime.sendMessage({ type: 'BOOT_COPILOT', handoff: h });
        });
      });
    } catch(e) {
      console.warn('[CAID-content] auto-resume skipped:', e.message || e);
    }
  })();
})();
