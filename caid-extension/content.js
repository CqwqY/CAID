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
        var p = document.getElementById('caidCopilot');
        if (p) p.classList.add('open');
        return;
      }
      chrome.runtime.sendMessage({ type: 'BOOT_COPILOT' });
    });

    document.body.appendChild(btn);
  }

  addButton();
})();
