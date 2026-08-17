// CAID 扩展 content script（ISOLATED world）
// 职责：在任意页面右下角渲染一个常驻的"启动副驾"悬浮按钮；
// 点击后通过 runtime 消息让 background 以 MAIN world 注入魔改 Page-Agent。
(function () {
  if (window.__CAID_LAUNCHER) return;
  // 主站自带副驾，扩展不在主站展示悬浮按钮 / 注入第二套副驾
  function isMainSite(url) {
    if (!url) return false;
    if (url.indexOf('chrome-extension://') === 0) return true;
    if (/^https?:\/\/graduate\.dpdns\.org\//.test(url)) return true;
    return false;
  }
  if (isMainSite(location.href)) return;
  window.__CAID_LAUNCHER = true;

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
    console.log('[CAID-content] 收到 __caid_open_options 事件，转发 OPEN_OPTIONS 给 background');
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  });

  // MAIN world 的 navigate_to_url 工具通过此事件把断点续传上下文传给 ISOLATED world 写入 storage.session
  window.addEventListener('__caid_store_handoff', function (e) {
    var h = e && e.detail;
    if (!h) return;
    console.log('[CAID-content] 收到续传上下文，写入 storage.session');
    try { chrome.storage.session.set({ caidHandoff: h }); } catch (ex) {}
  });

  // 自动续传：若本次导航由本扩展副驾发起（存在待续传上下文且命中目标页），
  // 自动启动副驾并把上下文传进去，实现"跳转后断点续传"。
  // 主站自带副驾（#caidCopilot 存在）时跳过，避免双副驾。
  (function tryAutoResume() {
    if (!chrome || !chrome.storage || !chrome.storage.session) return;
    if (document.getElementById('caidCopilot')) return; // 主站自带副驾
    chrome.storage.session.get(['caidHandoff'], function (got) {
      const h = got && got.caidHandoff;
      if (!h || !h.toUrl) return;
      // 过期保护：超过 2 分钟未消费的续传上下文直接作废，避免误触发
      if (h.ts && Date.now() - h.ts > 120000) { chrome.storage.session.remove(['caidHandoff']); return; }
      let match = false;
      try { match = location.host === new URL(h.toUrl).host; } catch (e) {}
      if (!match) return;
      // 一次性消费：清除存储并触发启动（context 经消息传给 background → window.__CAID_HANDOFF）
      chrome.storage.session.remove(['caidHandoff'], function () {
        chrome.runtime.sendMessage({ type: 'BOOT_COPILOT', handoff: h });
      });
    });
  })();
})();
