// CAID 扩展 content script（ISOLATED world）
// 职责：在任意页面右下角渲染一个常驻的"启动副驾"悬浮按钮；
// 点击后通过 runtime 消息让 background 以 MAIN world 注入魔改 Page-Agent。
(function () {
  if (window.__CAID_LAUNCHER) return;
  window.__CAID_LAUNCHER = true;

  // 品牌图标 inline SVG（content.js ISOLATED world 虽可用 chrome.runtime.getURL，但和 MAIN world 保持一致用内联更稳）
  function caidIcon(size) {
    size = size || 16;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="' + size + '" height="' + size + '" style="vertical-align:middle;margin-right:4px;display:inline-block">' +
      '<rect fill="#10182B" width="400" height="400" rx="116" ry="116"/>' +
      '<path fill="#5B8DFF" transform="translate(109.375 137.5)" d="M101.6366 39.1968L17.2616 -23.3032Q7.7009 -30.8206 -4.272 -28.6836Q-16.3481 -27.2388 -23.3032 -17.2616Q-30.8206 -7.7009 -28.6836 4.272Q-27.2388 16.3481 -17.2616 23.3032L35.6541 62.5L-17.2616 101.6968Q-27.2388 108.6519 -28.6836 120.728Q-30.8206 132.7009 -23.3032 142.2616Q-16.3481 152.2388 -4.272 153.6836Q7.7009 155.8206 17.2616 148.3032L101.6366 85.8032Q103.3627 84.5251 104.8811 83.0061Q106.4001 81.4877 107.6782 79.7616Q115.1956 70.2009 113.0586 58.228Q111.6138 46.1519 101.6366 39.1968Z" fill-rule="evenodd"/>' +
      '<rect fill="#3DD68C" transform="translate(223.438 235.938)" width="76.5625" height="43.75" rx="14" ry="14"/>' +
    '</svg>';
  }

  // 把扩展内部 URL 写到共享 window 上，供 MAIN world 的 caid-copilot.js 读取
  // （MAIN world 无 chrome.runtime，无法自己 getURL；ISOLATED world 设的属性 MAIN world 可读）
  // 设置入口已并入 newtab 工作台（#settings 锚点自动弹出设置 Modal）
  try { window.__CAID_OPTIONS_URL = chrome.runtime.getURL('newtab.html#settings'); } catch (e) {}

  // ---------- storage 双路径：直接访问优先，失败时经 background 代理 ----------
  // chrome.storage.session 在某些页面上下文会报 "Access to storage is not allowed from this context"，
  // 此时回退到 sendMessage 让 background（service worker，永远有完整权限）代为读写。
  // ⚠️ 关键：chrome.storage.session.X 的回调是异步的，不能在回调里 throw（逃逸 try-catch），
  // 必须在回调内直接走 fallback。
  function sessionGet(keys) {
    return new Promise(function (resolve) {
      if (chrome && chrome.storage && chrome.storage.session) {
        try {
          chrome.storage.session.get(keys, function (got) {
            if (chrome.runtime.lastError) {
              console.log('[CAID-content] session.get 失败, 回退 bg 代理:', chrome.runtime.lastError.message);
              try {
                chrome.runtime.sendMessage({ type: 'CAID_SESSION_GET', keys: keys }, function (resp) {
                  if (chrome.runtime.lastError) { resolve({}); return; }
                  resolve(resp && resp.data || {});
                });
              } catch (e2) { resolve({}); }
            } else { resolve(got); }
          });
        } catch (e) {
          try {
            chrome.runtime.sendMessage({ type: 'CAID_SESSION_GET', keys: keys }, function (resp) {
              if (chrome.runtime.lastError) { resolve({}); return; }
              resolve(resp && resp.data || {});
            });
          } catch (e2) { resolve({}); }
        }
      } else {
        try {
          chrome.runtime.sendMessage({ type: 'CAID_SESSION_GET', keys: keys }, function (resp) {
            resolve(resp && resp.data || {});
          });
        } catch (e2) { resolve({}); }
      }
    });
  }
  function sessionSet(data) {
    return new Promise(function (resolve) {
      if (chrome && chrome.storage && chrome.storage.session) {
        try {
          chrome.storage.session.set(data, function () {
            if (chrome.runtime.lastError) {
              console.log('[CAID-content] session.set 失败, 回退 bg 代理:', chrome.runtime.lastError.message);
              try {
                chrome.runtime.sendMessage({ type: 'CAID_SESSION_SET', data: data }, function () { if (chrome.runtime.lastError) {} resolve(true); });
              } catch (e2) { resolve(false); }
            } else { resolve(true); }
          });
        } catch (e) {
          try {
            chrome.runtime.sendMessage({ type: 'CAID_SESSION_SET', data: data }, function () { if (chrome.runtime.lastError) {} resolve(true); });
          } catch (e2) { resolve(false); }
        }
      } else {
        try {
          chrome.runtime.sendMessage({ type: 'CAID_SESSION_SET', data: data }, function () { if (chrome.runtime.lastError) {} resolve(true); });
        } catch (e2) { resolve(false); }
      }
    });
  }
  function sessionRemove(keys) {
    return new Promise(function (resolve) {
      if (chrome && chrome.storage && chrome.storage.session) {
        try {
          chrome.storage.session.remove(keys, function () {
            if (chrome.runtime.lastError) {
              console.log('[CAID-content] session.remove 失败, 回退 bg 代理:', chrome.runtime.lastError.message);
              try {
                chrome.runtime.sendMessage({ type: 'CAID_SESSION_REMOVE', keys: keys }, function () { if (chrome.runtime.lastError) {} resolve(true); });
              } catch (e2) { resolve(false); }
            } else { resolve(true); }
          });
        } catch (e) {
          try {
            chrome.runtime.sendMessage({ type: 'CAID_SESSION_REMOVE', keys: keys }, function () { if (chrome.runtime.lastError) {} resolve(true); });
          } catch (e2) { resolve(false); }
        }
      } else {
        try {
          chrome.runtime.sendMessage({ type: 'CAID_SESSION_REMOVE', keys: keys }, function () { if (chrome.runtime.lastError) {} resolve(true); });
        } catch (e2) { resolve(false); }
      }
    });
  }

  function addButton() {
    if (!document.body) { setTimeout(addButton, 300); return; }
    if (document.getElementById('caidLauncher')) return;

    var btn = document.createElement('div');
    btn.id = 'caidLauncher';
    btn.setAttribute('role', 'button');
    btn.title = 'CAID 副驾：点击输入任务，双击展开面板，按住圆球可拖动';
    // 圆球样式：圆形、内嵌品牌图标、居中
    btn.innerHTML = '<span class="caid-ball-ic">' + caidIcon(26) + '</span>';
    btn.style.cssText =
      'position:fixed;right:24px;bottom:24px;z-index:2147483647;' +
      'width:44px;height:44px;border-radius:50%;' +
      'background:radial-gradient(circle at 30% 30%,#2f6fc0,#14355f);' +
      'display:flex;align-items:center;justify-content:center;' +
      'box-shadow:0 5px 16px rgba(20,53,95,.55),inset 0 1px 0 rgba(255,255,255,.25);' +
      'cursor:pointer;user-select:none;-webkit-user-select:none;' +
      'transition:box-shadow .25s,transform .15s;' +
      'color:#fff;';
    btn.style.setProperty('pointer-events', 'auto', 'important');
    var ic = btn.querySelector('.caid-ball-ic');
    if (ic) ic.style.cssText = 'display:flex;align-items:center;justify-content:center;pointer-events:none;margin:0;line-height:0;width:100%;height:100%;';
    var svgIc = ic ? ic.querySelector('svg') : null;
    if (svgIc) { svgIc.style.margin = '0'; svgIc.style.display = 'block'; svgIc.style.verticalAlign = 'top'; }

    // 是否已注入 MAIN world 副驾（DOM 标志，两 world 共享 DOM，可安全判定）
    function isReady() {
      var cp = document.getElementById('caidExtCopilot');
      return !!(cp && cp.getAttribute('data-caid-ready') === '1');
    }
    // 单击/双击在"未注入"时的区分：双击会先触发两次 click，用 280ms 窗口正确分单/双击。
    // 单击=横向输入条，双击=完整面板。这样首次单击也不会误开整块面板。
    var bootTimer = null;
    function realBoot(intent) {
      try { chrome.runtime.sendMessage({ type: 'BOOT_COPILOT' }); } catch (e3) {}
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (isReady()) {
          clearInterval(iv);
          try { window.postMessage({ __caidBall: intent }, '*'); } catch (e4) {}
        }
        else if (tries > 40) clearInterval(iv);
      }, 250);
    }
    btn.addEventListener('click', function () {
      if (btn.__caidDragMoved) return; // 刚拖拽移动过圆球，不当作点击
      if (isReady()) { try { window.postMessage({ __caidBall: 'toggle' }, '*'); } catch (e) {} return; }
      clearTimeout(bootTimer); bootTimer = null;
      bootTimer = setTimeout(function () { realBoot('toggle'); }, 280);
    });
    btn.addEventListener('dblclick', function (e) {
      e.preventDefault();
      clearTimeout(bootTimer); bootTimer = null;
      if (isReady()) { try { window.postMessage({ __caidBall: 'dbl' }, '*'); } catch (e2) {} return; }
      realBoot('dbl');
    });
    // 圆球本身可拖动：按住拖动改变右下角停靠位置
    (function makeBallDraggable(ball) {
      var sx = 0, sy = 0, ox = 0, oy = 0, sway = false, wow = false;
      ball.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var r = ball.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        ball.style.left = r.left + 'px'; ball.style.top = r.top + 'px';
        ball.style.right = 'auto'; ball.style.bottom = 'auto';
        sway = true; wow = false;
        function mm(e2) {
          if (!sway) return;
          var dx = e2.clientX - sx, dy = e2.clientY - sy;
          if (!wow && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) wow = true;
          ball.style.left = Math.max(0, Math.min(window.innerWidth - ball.offsetWidth, ox + dx)) + 'px';
          ball.style.top = Math.max(0, Math.min(window.innerHeight - ball.offsetHeight, oy + dy)) + 'px';
          if (typeof layoutBallCompanions === 'function') layoutBallCompanions();
        }
        function up() {
          sway = false;
          window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', up);
          ball.__caidDragMoved = wow;
          setTimeout(function () { ball.__caidDragMoved = false; }, 20);
        }
        window.addEventListener('mousemove', mm); window.addEventListener('mouseup', up);
      });
    })(btn);

    document.body.appendChild(btn);

    // ---------- 圆球配套：AI 运行中的「停止键」+ 悬浮「工具菜单」 ----------
    // 停止键：副驾 running 时出现在圆球左侧，点击一键终止。
    // 悬浮菜单：鼠标悬浮圆球向上展开 → 「进入产物页」/「纠错」。
    var stopBtn = document.createElement('button');
    stopBtn.id = 'caidStopBtn';
    stopBtn.title = '终止当前任务';
    stopBtn.innerHTML = '⏹';
    stopBtn.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147483646;width:34px;height:34px;border-radius:50%;' +
      'border:none;background:#d33c3c;color:#fff;font-size:16px;line-height:34px;text-align:center;' +
      'cursor:pointer;box-shadow:0 4px 12px rgba(211,60,60,.5);display:none;user-select:none;' +
      'transition:transform .15s,opacity .2s;';
    stopBtn.addEventListener('click', function () {
      try { window.postMessage({ __caidBall: 'stop' }, '*'); } catch (e) {}
      stopBtn.style.display = 'none';
    });
    document.body.appendChild(stopBtn);

    var menuEl = document.createElement('div');
    menuEl.id = 'caidBallMenu';
    menuEl.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147483646;display:flex;flex-direction:column;gap:6px;' +
      'background:rgba(20,35,63,.94);border:1px solid rgba(255,255,255,.14);border-radius:12px;' +
      'padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);backdrop-filter:blur(8px);' +
      'opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .18s,transform .18s,visibility .18s;';
    menuEl.innerHTML =
      '<button data-act="workbench" class="caid-mn" title="打开副驾产物页">🗂 进入产物页</button>' +
      '<button data-act="mistake" class="caid-mn" title="指出副驾错误，记入错题本">✎ 纠错</button>';
    menuEl.querySelectorAll('.caid-mn').forEach(function (m) {
      m.style.cssText = 'border:none;background:transparent;color:#e8eef7;font-size:13px;padding:8px 12px;' +
        'border-radius:8px;cursor:pointer;text-align:left;white-space:nowrap;transition:background .15s;';
      m.addEventListener('mouseenter', function () { m.style.background = 'rgba(91,141,255,.22)'; });
      m.addEventListener('mouseleave', function () { m.style.background = 'transparent'; });
    });
    menuEl.querySelector('[data-act="workbench"]').addEventListener('click', function () {
      hideMenu(); // 打开产物页
      try { chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS', hash: '#history' }); } catch (e) {}
    });
    menuEl.querySelector('[data-act="mistake"]').addEventListener('click', function () {
      hideMenu(); openMistakeDialog();
    });
    document.body.appendChild(menuEl);

    // 停止键随 AI 运行态显隐：观察圆球 class，含 state-running 时显示
    try {
      new MutationObserver(function () {
        var running = btn.classList.contains('state-running');
        stopBtn.style.display = running ? '' : 'none';
        if (running) layoutBallCompanions();
      }).observe(btn, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}

    // 悬浮菜单：鼠标悬浮圆球时向上展开，移出后收
    var _hTimer = null;
    btn.addEventListener('mouseenter', function () {
      clearTimeout(_hTimer);
      menuEl.style.opacity = '1'; menuEl.style.visibility = 'visible'; menuEl.style.transform = 'translateY(0)';
      layoutBallCompanions();
    });
    btn.addEventListener('mouseleave', function () {
      clearTimeout(_hTimer);
      _hTimer = setTimeout(hideMenu, 260);
    });
    menuEl.addEventListener('mouseenter', function () { clearTimeout(_hTimer); });
    menuEl.addEventListener('mouseleave', function () { clearTimeout(_hTimer); _hTimer = setTimeout(hideMenu, 200); });
    function hideMenu() {
      menuEl.style.opacity = '0'; menuEl.style.visibility = 'hidden'; menuEl.style.transform = 'translateY(8px)';
    }

    // 纠错对话框：写入 AI 错题本
    function openMistakeDialog() {
      var old = document.getElementById('caidMistakeModal');
      if (old) old.remove();
      var modal = document.createElement('div');
      modal.id = 'caidMistakeModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);';
      modal.innerHTML =
        '<div style="width:min(460px,90vw);background:#fff;border-radius:14px;padding:20px;box-shadow:0 16px 40px rgba(0,0,0,.35);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
            '<div style="font-size:16px;font-weight:700;color:#14355f;">✎ 纠错 · AI 错题本</div>' +
            '<button id="caidMistakeClear" title="清空全部错题" style="border:none;background:#f3f5f8;color:#c0392b;font-size:12px;padding:4px 8px;border-radius:6px;cursor:pointer;">清空全部</button>' +
          '</div>' +
          '<div style="font-size:13px;color:#5a6b80;margin-bottom:8px;">指出副驾哪里出错了、应如何改正，副驾之后运行时会始终遵守。当前已存 <b id="caidMistakeCount" style="color:#2f6fc0;">0</b> 条：</div>' +
          '<div id="caidMistakeList" style="max-height:120px;overflow:auto;margin-bottom:10px;border:1px solid #eef1f5;border-radius:8px;padding:6px;background:#fafbfc;"></div>' +
          '<textarea id="caidMistakeText" placeholder="例：搜索时应该优先用 Bing 而不是默认引擎；刚才首页跳转错了，应该打开设置页…" style="width:100%;box-sizing:border-box;height:100px;border:1px solid #d7dde6;border-radius:8px;padding:10px;font-size:14px;resize:vertical;"></textarea>' +
          '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">' +
            '<button id="caidMistakeCancel" style="padding:8px 16px;border:1px solid #d7dde6;background:#fff;border-radius:8px;cursor:pointer;font-size:14px;color:#5a6b80;">取消</button>' +
            '<button id="caidMistakeSave" style="padding:8px 16px;border:none;background:#2f6fc0;color:#fff;border-radius:8px;cursor:pointer;font-size:14px;">记入错题本</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
      var ta = modal.querySelector('#caidMistakeText');
      var cntEl = modal.querySelector('#caidMistakeCount');
      var listEl = modal.querySelector('#caidMistakeList');
      setTimeout(function () { try { ta.focus(); } catch (e) {} }, 30);
      function close() { modal.remove(); }
      function mistTip(text, isErr) {
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);' + (isErr ? 'background:#c0392b;' : 'background:#14355f;') + 'color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;z-index:2147483646;box-shadow:0 6px 18px rgba(0,0,0,.3);';
        t.textContent = text;
        document.body.appendChild(t);
        setTimeout(function () { t.remove(); }, 2600);
      }
      // 错题本 CRUD：直接在 content.js（ISOLATED world）读写 chrome.storage.local，
      // 不走 background 端口往返——彻底避免 MV3 SW 端口关闭导致的写入失败。
      function mistRead(cb) {
        try {
          chrome.storage.local.get('caidMistakes', function (got) {
            cb && cb((got && Array.isArray(got.caidMistakes)) ? got.caidMistakes : []);
          });
        } catch (e) { cb && cb([]); }
      }
      function mistWrite(list, cb) {
        try {
          chrome.storage.local.set({ caidMistakes: list }, function () { cb && cb(!chrome.runtime.lastError); });
        } catch (e) { cb && cb(false); }
      }
      // 实时加载现有错题列表（可删除/清空）：让用户明确看到写入是否成功
      function loadMistakes() {
        mistRead(function (list) {
          if (cntEl) cntEl.textContent = String(list.length);
          if (!listEl) return;
          if (!list.length) { listEl.innerHTML = '<div style="color:#b8c1cd;font-size:13px;padding:6px;">暂无错题，副驾会严格按上面的纠错执行。</div>'; return; }
          listEl.innerHTML = '';
          for (var i = 0; i < list.length; i++) {
            var item = list[i];
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:6px 4px;border-bottom:1px solid #eef1f5;font-size:13px;color:#3a4a5c;';
            var txtSpan = document.createElement('span');
            txtSpan.style.cssText = 'flex:1;line-height:1.4;word-break:break-all;';
            txtSpan.textContent = (i + 1) + '. ' + String(item.text || '');
            var delBtn = document.createElement('button');
            delBtn.textContent = '删';
            delBtn.title = '删除此条';
            delBtn.style.cssText = 'border:none;background:#fdeceb;color:#c0392b;font-size:12px;padding:2px 7px;border-radius:5px;cursor:pointer;flex-shrink:0;';
            delBtn.addEventListener('click', function (id) {
              return function () {
                mistRead(function (l) {
                  for (var k = 0; k < l.length; k++) if (String(l[k].id) === id) { l.splice(k, 1); break; }
                  mistWrite(l, function () { loadMistakes(); });
                });
              };
            })(String(item.id));
            row.appendChild(txtSpan);
            row.appendChild(delBtn);
            listEl.appendChild(row);
          }
        });
      }
      loadMistakes();
      modal.querySelector('#caidMistakeCancel').addEventListener('click', close);
      modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
      modal.querySelector('#caidMistakeClear').addEventListener('click', function () {
        if (!confirm('确定清空 AI 错题本中的全部记录吗？')) return;
        mistWrite([], function () { loadMistakes(); });
      });
      modal.querySelector('#caidMistakeSave').addEventListener('click', function () {
        var txt = ta.value.trim();
        if (!txt) { ta.focus(); return; }
        mistRead(function (l) {
          l.push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: txt, url: location.href, ts: Date.now() });
          while (l.length > 50) l.shift();
          mistWrite(l, function (ok) {
            if (ok) { mistTip('✅ 已记入 AI 错题本（当前共 ' + l.length + ' 条），副驾将始终遵守'); }
            else { mistTip('❌ 写入错题本失败，请重试', true); }
            loadMistakes();
          });
        });
      });
    }

    // 配套元件始终跟随圆球（停止键在左侧、菜单在正上方）
    function layoutBallCompanions() {
      try {
        var r = btn.getBoundingClientRect();
        var stopW = stopBtn.offsetWidth || 34, stopH = stopBtn.offsetHeight || 34;
        stopBtn.style.left = Math.max(0, r.left - stopW - 12) + 'px';
        stopBtn.style.top = Math.max(0, r.top + (r.height - stopH) / 2) + 'px';
        var mH = menuEl.offsetHeight || 96;
        var mL = Math.min(r.left, Math.max(0, window.innerWidth - (menuEl.offsetWidth || 150)));
        menuEl.style.left = mL + 'px';
        menuEl.style.top = Math.max(0, r.top - mH - 8) + 'px';
      } catch (e) {}
    }
    window.addEventListener('resize', function () { layoutBallCompanions(); });
    layoutBallCompanions();
  }

  // 🤖 按钮与面板的显隐同步（双向）：
  // - 面板打开（含首次 BOOT_COPILOT 注入后默认 open）→ 隐藏按钮，避免盖在面板上；
  // - 面板关闭 → 恢复按钮。
  // DOM 在 ISOLATED/MAIN world 间共享，直接观察面板 class 变化即可，无需 MAIN world 额外派发事件。
  // 用 data-panel-open 标记让 MAIN world 的保活 observer 识别这是有意隐藏，不会强行恢复。
  var _panelWatch = null;
  function watchPanel() {
    var p = document.getElementById('caidExtCopilot');
    if (!p) { setTimeout(watchPanel, 500); return; }
    if (_panelWatch) return;
    function syncBtn() {
      var btn = document.getElementById('caidLauncher');
      if (!btn) return;
      // 仅完整面板打开时隐藏圆球（避免被面板盖住）；
      // 横向输入条打开时保留圆球，这样仍可"双击圆球"展开完整面板。
      if (p.classList.contains('open')) {
        btn.setAttribute('data-panel-open', '1');
        btn.style.display = 'none';
      } else {
        btn.removeAttribute('data-panel-open');
        btn.style.display = '';
      }
    }
    syncBtn(); // 初始同步：面板创建时可能已是 open 状态（首次注入后默认打开）
    _panelWatch = new MutationObserver(syncBtn);
    _panelWatch.observe(p, { attributes: true, attributeFilter: ['class'] });
    // 额外观察输入条的开关，让圆球显隐跟随
    var _qbTimer = null;
    var _qbWatch = new MutationObserver(function () { clearTimeout(_qbTimer); _qbTimer = setTimeout(syncBtn, 30); });
    (function waitQb() {
      var qb = document.getElementById('caidQuickBar');
      if (qb) { _qbWatch.observe(qb, { attributes: true, attributeFilter: ['data-open'] }); return; }
      setTimeout(waitQb, 500);
    })();
  }
  watchPanel();

  addButton();

  // ---------- 全局快捷键 ----------
  // Ctrl+I+L → 启动副驾（弹出输入条）；Ctrl+L → 终止当前任务。
  // 说明：Ctrl+I+L 用 I 作为第一段，需在按 L 前 <1.5s 内按过 I（按住 Ctrl 连续按）。
  // 注：浏览器可能保留 Ctrl+L（聚焦地址栏）而不透传给页面，此时终止建议用「停止键」。
  var _scSeq = '', _scT = 0;
  function _bootQuickFromKey() {
    try {
      var _cp = document.getElementById('caidExtCopilot');
      var _ready = !!(_cp && _cp.getAttribute('data-caid-ready') === '1');
      if (_ready) { window.postMessage({ __caidBall: 'toggle' }, '*'); return; }
      try { chrome.runtime.sendMessage({ type: 'BOOT_COPILOT' }); } catch (e2) {}
      var _tr = 0;
      var _iv = setInterval(function () {
        _tr++;
        var _c = document.getElementById('caidExtCopilot');
        if (_c && _c.getAttribute('data-caid-ready') === '1') { clearInterval(_iv); window.postMessage({ __caidBall: 'toggle' }, '*'); }
        else if (_tr > 40) clearInterval(_iv);
      }, 250);
    } catch (e) {}
  }
  function _stopFromKey() {
    try { window.postMessage({ __caidBall: 'stop' }, '*'); } catch (e) {}
    var _sb = document.getElementById('caidStopBtn');
    if (_sb) _sb.style.display = 'none';
  }
  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    var _k = (e.key || '').toLowerCase();
    if (_k === 'i') { _scSeq = 'i'; _scT = Date.now(); return; }
    if (_k === 'l') {
      if (_scSeq === 'i' && Date.now() - _scT < 1500) { _scSeq = ''; e.preventDefault(); _bootQuickFromKey(); }
      else { _scSeq = ''; e.preventDefault(); _stopFromKey(); }
    } else { _scSeq = ''; }
  });

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

  // MAIN world 的副驾内联设置表单通过 postMessage 把配置写入扩展存储
  // （MAIN world 无 chrome.*，由 ISOLATED world 用 chrome.storage.local 写入）
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || !d.__caid || d.kind !== 'save_settings' || !d.cfg) return;
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      console.log('[CAID-content] 收到 save_settings，写入 chrome.storage.local.caidLlm');
      chrome.storage.local.set({ caidLlm: d.cfg });
    } catch (ex) {
      console.warn('[CAID-content] save_settings failed:', ex.message || ex);
    }
  });

  // MAIN world 的 navigate_to_url / open_url_in_new_tab 工具通过 postMessage 把断点续传上下文传给 ISOLATED world 写入 storage.session
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || !d.__caid || d.kind !== 'store_handoff' || !d.handoff) return;
    var h = d.handoff;
    console.log('[CAID-R] store_handoff: 写入续传上下文, goal=', h.goal, ' toUrl=', h.toUrl);
    sessionSet({ caidHandoff: h }).then(function () {
      console.log('[CAID-R] store_handoff: 写入完成');
    }).catch(function (err) {
      console.warn('[CAID-R] store_handoff 写入失败:', err.message || err);
    });
  });

  // MAIN world 的 navigate_to_url / open_url_in_new_tab 工具（无 chrome.*）通过此 DOM 事件请求导航；
  // 由本 ISOLATED world 脚本转发给 background：background 用特权 API chrome.tabs.create/update 执行，
  // 同时把 handoff 写入 chrome.storage.session，新页面加载完成后自动注入副驾续跑。
  // 转发成功后回派 __caid_nav_ack（带 navId），MAIN world 收到即确认，停止重试/兜底。
  window.addEventListener('__caid_navigate_request', function (e) {
    var detail = e && e.detail;
    if (!detail || !detail.url) return;
    var url = detail.url;
    var active = detail.active !== false;
    var handoff = detail.handoff || null;
    var navId = detail.id || null;
    var sameTab = !!detail.sameTab;
    console.log('[CAID-content] 收到 __caid_navigate_request, url=', url, ' active=', active, ' sameTab=', sameTab, ' handoff=', !!handoff);
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
      chrome.runtime.sendMessage(
        { type: 'NAVIGATE_TO_URL', url: url, active: active, handoff: handoff, navId: navId, sameTab: sameTab },
        function (resp) {
          if (chrome.runtime.lastError) {
            console.warn('[CAID-content] 转发 NAVIGATE_TO_URL 失败:', chrome.runtime.lastError.message);
            return;
          }
          if (navId) {
            try { window.dispatchEvent(new CustomEvent('__caid_nav_ack', { detail: { id: navId } })); } catch (e2) {}
          }
        }
      );
    } catch (err) {
      console.error('[CAID-content] 转发 NAVIGATE_TO_URL 失败:', err.message || err);
    }
  });

  // 通用 background 消息桥：MAIN world（caid-copilot.js，无 chrome.*）通过 postMessage 转发任意消息给 background。
  // caidSendToBg 在扩展页直连 chrome.runtime.sendMessage（content.js 不运行），
  // 在正则网页 postMessage → 本监听器转发。
  // 消息类型：AGENT_ACTIVE / AGENT_INACTIVE / CHECKPOINT / CLEAR_CHECKPOINT / CAID_MEMORY_ADD_HISTORY 等。
  // 关键存储类操作直接在 content.js 处理（content script 有 chrome.storage 权限），不依赖 SW。
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || !d.__caid || d.kind !== 'bg_message' || !d.msg || !d.msg.type) return;
    var msg = d.msg;
    // ---- 存储类操作：直接在 content.js 处理 ----
    if (msg.type === 'CHECKPOINT' && msg.handoff) {
      try { if (chrome && chrome.storage && chrome.storage.session) chrome.storage.session.set({ caidHandoff: msg.handoff }); } catch (e) {}
    } else if (msg.type === 'CLEAR_CHECKPOINT') {
      try { if (chrome && chrome.storage && chrome.storage.session) chrome.storage.session.remove(['caidHandoff']); } catch (e) {}
    } else if (msg.type === 'CAID_MEMORY_ADD_HISTORY') {
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get('caidMemory', function (got) {
            var m = (got && got.caidMemory) || { facts: [], history: [] };
            if (!Array.isArray(m.history)) m.history = [];
            var hItem = { goal: String(msg.goal || ''), result: String(msg.result || ''), url: String(msg.url || ''), ts: Date.now() };
            if (msg.summary) hItem.summary = String(msg.summary);
            if (m.history.length >= 50) m.history.shift();
            m.history.push(hItem);
            chrome.storage.local.set({ caidMemory: m });
          });
        }
      } catch (e) {}
    }
    // ---- 非存储类操作：仍走 SW 转发 ----
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
      chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.error('[CAID-content] 转发 bg_message 失败:', err.message || err);
    }
  });

  // 有响应的请求桥：MAIN world 需要 background 返回数据时（如读取长期记忆 CAID_MEMORY_GET），
  // 用 postMessage（比 CustomEvent 跨 MAIN/ISOLATED 世界更可靠）。
  // 关键优化：存储类操作（CAID_TODO_OP / CAID_MEMORY_* / CAID_SERVER_* / CAID_SESSION_*）
  // 由 content.js 直接处理（content script 有 chrome.storage 权限），绕过 SW 桥接——
  // MV3 SW 随时可能被销毁导致 "message port closed before a response was received"。
  // MAIN world → postMessage({__caid, kind:'bg_request', reqId, msg}) → 本监听器 → 直接操作 storage
  // → 回 postMessage({__caid, kind:'bg_response', reqId, resp}) → MAIN world 按 reqId 匹配 resolve。
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || !d.__caid || d.kind !== 'bg_request' || !d.msg || !d.msg.type || !d.reqId) return;
    var msg = d.msg;
    var handled = false;
    // ---- 存储类操作：直接在 content.js 处理，不依赖 SW ----
    if (msg.type === 'CAID_TODO_OP') {
      handled = true;
      var tAction = String(msg.action || '').trim();
      var doTodoOp = function () {
        return new Promise(function (resolve) {
          try {
            if (!chrome || !chrome.storage || !chrome.storage.local) {
              resolve({ ok: false, error: 'chrome.storage.local 不可用' });
              return;
            }
            chrome.storage.local.get(['todos'], function (got) {
              if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
                return;
              }
              var list = Array.isArray(got && got.todos) ? got.todos : [];
              var result = { ok: true, action: tAction };
              if (tAction === 'add') {
                var tText = String(msg.text || '').trim().slice(0, 200);
                if (!tText) { resolve({ ok: false, error: 'text required for add' }); return; }
                var tPri = String(msg.priority || 'mid');
                if (tPri !== 'high' && tPri !== 'mid' && tPri !== 'low') tPri = 'mid';
                var item = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: tText, done: false, priority: tPri, createdAt: Date.now() };
                list.unshift(item);
                result.todo = item;
              } else if (tAction === 'complete') {
                var cId = String(msg.id || '');
                var hit = null;
                for (var i = 0; i < list.length; i++) { if (String(list[i].id) === cId) { list[i].done = !list[i].done; hit = list[i]; break; } }
                if (!hit) { resolve({ ok: false, error: 'todo not found: ' + cId }); return; }
                result.todo = hit;
              } else if (tAction === 'delete') {
                var dId = String(msg.id || '');
                var before = list.length;
                list = list.filter(function (t) { return String(t.id) !== dId; });
                if (list.length === before) { resolve({ ok: false, error: 'todo not found: ' + dId }); return; }
              } else if (tAction === 'clear_done') {
                list = list.filter(function (t) { return !t.done; });
              } else if (tAction === 'list') {
                // list 不需要修改 list
              } else {
                resolve({ ok: false, error: 'unknown action: ' + tAction });
                return;
              }
              result.todos = list;
              result.total = list.length;
              result.done = list.filter(function (t) { return t.done; }).length;
              chrome.storage.local.set({ todos: list }, function () {
                if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
                resolve(result);
              });
            });
          } catch (ex) { resolve({ ok: false, error: String(ex && ex.message || ex) }); }
        });
      };
      doTodoOp().then(function (resp) {
        try { window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: resp || null }, '*'); } catch (e2) {}
      });
    } else if (msg.type === 'CAID_MEMORY_GET') {
      handled = true;
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: null }, '*');
          return;
        }
        chrome.storage.local.get('caidMemory', function (got) {
          var m = (got && got.caidMemory) || { facts: [], history: [] };
          if (!Array.isArray(m.facts)) m.facts = [];
          if (!Array.isArray(m.history)) m.history = [];
          window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: true, memory: m } }, '*');
        });
      } catch (e) {
        window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: false, error: String(e && e.message || e) } }, '*');
      }
    } else if (msg.type === 'CAID_MISTAKES_GET') {
      handled = true;
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: null }, '*');
          return;
        }
        chrome.storage.local.get('caidMistakes', function (got) {
          var list = (got && Array.isArray(got.caidMistakes)) ? got.caidMistakes : [];
          window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: true, mistakes: list } }, '*');
        });
      } catch (e) {
        window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: false, error: String(e && e.message || e) } }, '*');
      }
    } else if (msg.type === 'CAID_MEMORY_ADD_FACT' || msg.type === 'CAID_MEMORY_DEL_FACT' ||
               msg.type === 'CAID_MEMORY_ADD_HISTORY' || msg.type === 'CAID_MEMORY_CLEAR_ALL') {
      handled = true;
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: null }, '*');
          return;
        }
        chrome.storage.local.get('caidMemory', function (got) {
          var m = (got && got.caidMemory) || { facts: [], history: [] };
          if (!Array.isArray(m.facts)) m.facts = [];
          if (!Array.isArray(m.history)) m.history = [];
          if (msg.type === 'CAID_MEMORY_ADD_FACT') {
            var factText = String(msg.fact || '').trim();
            if (factText) {
              var exists = m.facts.some(function (f) { return String(f && f.text || '') === factText; });
              if (!exists) m.facts.push({ id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: factText, ts: Date.now() });
            }
          } else if (msg.type === 'CAID_MEMORY_DEL_FACT') {
            var kw = String(msg.keyword || '').trim().toLowerCase();
            m.facts = m.facts.filter(function (f) { return String(f && f.text || '').toLowerCase().indexOf(kw) === -1; });
          } else if (msg.type === 'CAID_MEMORY_ADD_HISTORY') {
            var hItem = { goal: String(msg.goal || ''), result: String(msg.result || ''), url: String(msg.url || ''), ts: Date.now() };
            if (msg.summary) hItem.summary = String(msg.summary);
            if (m.history.length >= 50) m.history.shift();
            m.history.push(hItem);
          } else if (msg.type === 'CAID_MEMORY_CLEAR_ALL') {
            m = { facts: [], history: [] };
          }
          chrome.storage.local.set({ caidMemory: m }, function () {
            window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: true, memory: m } }, '*');
          });
        });
      } catch (e) {
        window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: false, error: String(e && e.message || e) } }, '*');
      }
    } else if (msg.type === 'CAID_SERVER_GET' || msg.type === 'CAID_SERVER_ADD' || msg.type === 'CAID_SERVER_DEL' || msg.type === 'CAID_SERVER_UPDATE' || msg.type === 'CAID_SERVER_CLEAR') {
      handled = true;
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: null }, '*');
          return;
        }
        chrome.storage.local.get('caidServers', function (got) {
          var servers = (got && got.caidServers) || [];
          if (msg.type === 'CAID_SERVER_ADD') {
            var newItem = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(msg.name || ''), url: String(msg.url || ''), type: String(msg.type || 'file' || 'file'), priority: String(msg.priority || 'mid' || 'mid'), createdAt: Date.now() };
            servers.push(newItem);
          } else if (msg.type === 'CAID_SERVER_DEL') {
            var sId = String(msg.id || '');
            servers = servers.filter(function (s) { return String(s.id) !== sId; });
          } else if (msg.type === 'CAID_SERVER_UPDATE') {
            var uId = String(msg.id || '');
            for (var si = 0; si < servers.length; si++) {
              if (String(servers[si].id) === uId) {
                if (msg.name != null) servers[si].name = String(msg.name);
                if (msg.url != null) servers[si].url = String(msg.url);
                if (msg.enabled != null) servers[si].enabled = !!msg.enabled;
                break;
              }
            }
          } else if (msg.type === 'CAID_SERVER_CLEAR') {
            servers = [];
          }
          chrome.storage.local.set({ caidServers: servers }, function () {
            window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: true, servers: servers } }, '*');
          });
        });
      } catch (e) {
        window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: false, error: String(e && e.message || e) } }, '*');
      }
    } else if (msg.type === 'CAID_PLUGIN_SAVE') {
      handled = true;
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: null }, '*');
          return;
        }
        chrome.storage.local.get('caidPlugins', function (got) {
          var plugins = (got && got.caidPlugins) || {};
          var p = msg.plugin || {};
          if (p && p.id) plugins[p.id] = p;
          chrome.storage.local.set({ caidPlugins: plugins }, function () {
            window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: true } }, '*');
          });
        });
      } catch (e) {
        window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: false, error: String(e && e.message || e) } }, '*');
      }
    } else if (msg.type === 'CAID_LAYOUT_SAVE') {
      handled = true;
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: null }, '*');
          return;
        }
        chrome.storage.local.set({ caidLayout: msg.layout }, function () {
          if (chrome.runtime.lastError) {
            window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: false, error: chrome.runtime.lastError.message } }, '*');
          } else {
            window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: true } }, '*');
          }
        });
      } catch (e) {
        window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: { ok: false, error: String(e && e.message || e) } }, '*');
      }
    }
    // ---- 非存储类操作：仍走 SW 桥接（LLM fetch / navigate 等需要扩展网络特权）----
    if (!handled) {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
        chrome.runtime.sendMessage(d.msg, function (resp) {
          if (chrome.runtime.lastError) {
            console.warn('[CAID-content] bg_request 转发失败:', chrome.runtime.lastError.message);
            resp = null;
          }
          try { window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: resp || null }, '*'); } catch (e2) {}
        });
      } catch (err) {
        console.error('[CAID-content] 转发 bg_request 失败:', err.message || err);
        try { window.postMessage({ __caid: true, kind: 'bg_response', reqId: d.reqId, resp: null }, '*'); } catch (e3) {}
      }
    }
  });

  // MAIN world 的副驾在任务正常结束 / 被强行终止时通过 postMessage 清除续传上下文
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || !d.__caid || d.kind !== 'clear_handoff') return;
    sessionRemove(['caidHandoff']).catch(function () {});
  });

  // background 自动跟随进入新标签（target=_blank）后，经此消息让本（旧）标签的 agent 停止。
  // ISOLATED world 收到 runtime 消息后派发 DOM 事件，MAIN world 的 caid-copilot.js 监听并 forceStop。
  // 同时处理右键菜单 CAID_CONTEXT_TEXT：把选中文本投递给 MAIN world 的副驾（面板已存在则
  // postMessage；否则先落 DOM dataset，副驾初始化时消费 —— 两 world 隔离但 DOM 共享，可靠）。
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'CAID_STOP_AGENT') {
        console.log('[CAID-content] 收到 CAID_STOP_AGENT，派发 __caid_force_stop 停止本页 agent');
        try { window.dispatchEvent(new CustomEvent('__caid_force_stop')); } catch (e) {}
      }
      if (msg && msg.type === 'CAID_CONTEXT_TEXT') {
        console.log('[CAID-content] 收到右键文本, mode=', msg.mode, 'text=', String(msg.text || '').slice(0, 60));
        var payload = { text: String(msg.text || ''), mode: msg.mode === 'plugin' ? 'plugin' : 'handle' };
        try {
          var cpPanel = document.getElementById('caidExtCopilot');
          if (cpPanel) {
            window.postMessage({ __caidType: 'CAID_CONTEXT_TEXT', text: payload.text, mode: payload.mode }, '*');
          } else {
            // 副驾尚未注入完成：落 DOM dataset 兜底，MAIN world 的 caid-copilot.js 初始化时消费
            document.documentElement.setAttribute('data-caid-ctx-pending', JSON.stringify(payload));
          }
        } catch (e2) {
          console.warn('[CAID-content] 投递右键文本失败:', e2.message || e2);
        }
      }
    });
  } catch (e) {}

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
  function tryAutoResumeOnce() {
    return new Promise(function (resolve) {
      try {
        if (document.getElementById('caidExtCopilot')) { console.log('[CAID-R] tryAutoResume: 副驾已注入，跳过'); return resolve(false); }
        sessionGet(['caidHandoff']).then(function (got) {
          const h = got && got.caidHandoff;
          if (!h) { console.log('[CAID-R] tryAutoResume: 无续传上下文'); return resolve(false); }
          // 过期保护：超过 2 分钟未消费的续传上下文直接作废，避免误触发
          if (h.ts && Date.now() - h.ts > 120000) { console.log('[CAID-R] tryAutoResume: 上下文已过期，作废'); sessionRemove(['caidHandoff']); return resolve(false); }
          // 来源页本身不续跑，避免同页循环
          if (location.href === (h.fromUrl || '')) { console.log('[CAID-R] tryAutoResume: 仍是来源页，跳过'); return resolve(false); }
          // 续跑判定：仅"显式目的地命中"（toUrl 主机 == 当前页，来自 navigate_to_url 的显式导航）。
          // 任意同标签页跳转 / target=_blank 的跟随改由 background 的 tabs.onUpdated + caidAgentTabs 判定——
          // 全局 caidHandoff 无法区分「agent 的 tab 跳转了」和「用户手动开了个不相关的新标签」，
          // 此前 moved 裸条件（location.href !== toUrl）几乎恒真，会把不相关新标签也误续跑。
          let destMatch = false;
          try { if (h.toUrl) destMatch = location.host === new URL(h.toUrl).host; } catch (e) {}
          console.log('[CAID-R] tryAutoResume: from=', h.fromUrl, ' to=', h.toUrl, ' destMatch=', destMatch);
          if (!destMatch) { console.log('[CAID-R] tryAutoResume: 非本页目的地的 handoff，跳过（交由 background 按 tab 状态判定）'); return resolve(false); }
          // 一次性消费：清除存储并触发启动（context 经消息传给 background → window.__CAID_HANDOFF）
          sessionRemove(['caidHandoff']).then(function () {
            console.log('[CAID-R] tryAutoResume: 消费上下文并发送 BOOT_COPILOT');
            chrome.runtime.sendMessage({ type: 'BOOT_COPILOT', handoff: h });
            resolve(true);
          }).catch(function () { resolve(false); });
        }).catch(function (err) {
          console.warn('[CAID-R] tryAutoResume: get 异常', err.message || err);
          resolve(false);
        });
      } catch (e) {
        console.warn('[CAID-R] tryAutoResume: 外层异常', e.message || e);
        resolve(false);
      }
    });
  }
  (async function () {
    const fired = await tryAutoResumeOnce();
    // 兜底1：若首轮未命中（旧页 store 尚未落库即发生跳转的竞态），700ms 后再查一次
    if (!fired) {
      const fired2 = await new Promise(function (resolve) {
        setTimeout(function () { tryAutoResumeOnce().then(resolve); }, 700);
      });
      // 兜底2：若 storage 两次都失败（"Access to storage is not allowed"），
      // 直接发消息让 background（永远有完整权限）查 handoff 并注入副驾
      if (!fired2) {
        console.log('[CAID-R] tryAutoResume: storage 两次均失败，请求 background 代查并注入');
        try {
          chrome.runtime.sendMessage({ type: 'TRY_RESUME_FROM_BG' }, function (resp) {
            if (chrome.runtime.lastError) { console.log('[CAID-R] tryAutoResume: TRY_RESUME_FROM_BG 端口关闭'); }
            else if (resp && resp.ok) console.log('[CAID-R] tryAutoResume: background 已代为注入副驾');
            else console.log('[CAID-R] tryAutoResume: background 也无有效 handoff');
          });
        } catch (e) {
          console.warn('[CAID-R] tryAutoResume: TRY_RESUME_FROM_BG 消息发送失败', e);
        }
      }
    }
  })();

  // ============ 阅读记录采集（下沉到 content.js，普通页面不点副驾也记）============
  // 原采集只在 caid-copilot.js 注入后（即用户点球启动副驾）才跑，导致没启动过副驾的页面
  // 不会被“认真看过”，相关搜索提示/空闲推荐因此永远没数据。这里放 ISOLATED world：
  // 每个页面加载即开始跟踪停留时长 + 最大滚动深度，离开时写回 caidReadLog。
  (function trackReading() {
    if (window.__caidTrackReadingInit) return;
    window.__caidTrackReadingInit = true;
    try {
      var t0 = Date.now();
      var depth = 0;
      var pageTitle = document.title || '';
      var url = location.href;
      var host = location.hostname || '';
      window.addEventListener('scroll', function () {
        try {
          var max = document.documentElement.scrollHeight - window.innerHeight;
          if (max > 50) { var d = Math.round(((window.scrollY || document.documentElement.scrollTop || 0) / max) * 100); if (d > depth) depth = d; }
        } catch (e) {}
      }, { passive: true });

      function extract() {
        try {
          var summary = '';
          try { var m = document.querySelector('meta[property="og:description"]') || document.querySelector('meta[name="description"]'); if (m) summary = String(m.getAttribute('content') || '').trim(); } catch (e) {}
          summary = summary.slice(0, 160);
          var entities = [];
          var chunks = [String(pageTitle || '')];
          try { var h = document.querySelector('h1,h2'); if (h) chunks.push(h.textContent || ''); } catch (e2) {}
          chunks.join(' ').split(/[\s|—_\-·,，。:：.()（）【】《》"'“”]+/).forEach(function (w) {
            w = w.trim();
            if (!w || entities.length >= 12) return;
            if (/^[A-Za-z][\w.-]{2,}$/.test(w)) { if (entities.indexOf(w) === -1) entities.push(w); }
            else if (/^[\u4e00-\u9fa5]{2,10}$/.test(w)) { if (entities.indexOf(w) === -1) entities.push(w); }
          });
          return { summary: summary, entities: entities };
        } catch (e) { return { summary: '', entities: [] }; }
      }

      var committed = false;
      function commit() {
        try {
          if (committed) return; committed = true;
          var dwellSec = Math.round((Date.now() - t0) / 1000);
          if (dwellSec < 3) return; // 停留不足不记
          var info = extract();
          chrome.runtime.sendMessage({ type: 'CAID_READLOG_SAVE', record: {
            url: url, host: host, title: String(pageTitle || '').slice(0, 200),
            summary: info.summary, entities: info.entities,
            dwellSec: dwellSec, maxDepth: depth
          } });
        } catch (e) { /* 采集失败不影响页面 */ }
      }
      window.addEventListener('pagehide', commit);
      window.addEventListener('beforeunload', commit);
    } catch (e) { console.warn('[CAID-content] trackReading 初始化异常:', e); }
  })();
})();
