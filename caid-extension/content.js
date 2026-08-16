// CAID 扩展 content script（ISOLATED world）
// 职责：在任意页面右下角渲染一个常驻的"启动副驾"悬浮按钮；
// 点击后通过 runtime 消息让 background 以 MAIN world 注入魔改 Page-Agent。
(function () {
  if (window.__CAID_LAUNCHER) return;
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
