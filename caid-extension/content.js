// CAID 扩展 content script（ISOLATED world）
// 职责：在任意页面右下角渲染一个常驻的"启动副驾"悬浮按钮；
// 点击后通过 runtime 消息让 background 以 MAIN world 注入魔改 Page-Agent。
(function () {
  if (window.__CAID_LAUNCHER) return;
  window.__CAID_LAUNCHER = true;

  // 把扩展内部 URL 写到共享 window 上，供 MAIN world 的 caid-copilot.js 读取
  // （MAIN world 无 chrome.runtime，无法自己 getURL；ISOLATED world 设的属性 MAIN world 可读）
  try { window.__CAID_OPTIONS_URL = chrome.runtime.getURL('options.html'); } catch (e) {}

  // ---------- storage 双路径：直接访问优先，失败时经 background 代理 ----------
  // 某些场景下（如扩展 context invalidated 后恢复、特定页面上下文）content script 的
  // chrome.storage.session 会报 "Access to storage is not allowed from this context"，
  // 此时回退到 sendMessage 让 background（service worker，永远有完整权限）代为读写。
  function sessionGet(keys) {
    return new Promise(function (resolve) {
      try {
        if (chrome && chrome.storage && chrome.storage.session) {
          chrome.storage.session.get(keys, function (got) {
            if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
            resolve(got);
          });
        } else { throw new Error('no-session'); }
      } catch (e) {
        console.log('[CAID-content] session.get 直接访问失败, 回退 background 代理:', e.message || e);
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
      try {
        if (chrome && chrome.storage && chrome.storage.session) {
          chrome.storage.session.set(data, function () {
            if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
            resolve(true);
          });
        } else { throw new Error('no-session'); }
      } catch (e) {
        console.log('[CAID-content] session.set 直接访问失败, 回退 background 代理:', e.message || e);
        try {
          chrome.runtime.sendMessage({ type: 'CAID_SESSION_SET', data: data }, function () { resolve(true); });
        } catch (e2) { resolve(false); }
      }
    });
  }
  function sessionRemove(keys) {
    return new Promise(function (resolve) {
      try {
        if (chrome && chrome.storage && chrome.storage.session) {
          chrome.storage.session.remove(keys, function () {
            resolve(true);
          });
        } else { throw new Error('no-session'); }
      } catch (e) {
        console.log('[CAID-content] session.remove 直接访问失败, 回退 background 代理:', e.message || e);
        try {
          chrome.runtime.sendMessage({ type: 'CAID_SESSION_REMOVE', keys: keys }, function () { resolve(true); });
        } catch (e2) { resolve(false); }
      }
    });
  }

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
      // ⚠️ MV3 关键：ISOLATED world 和 MAIN world 的 window 属性是隔离的！
      // caid-copilot.js（MAIN world）设置的 window.__CAID_BOOTED 在这里永远读不到。
      // 改查 DOM（DOM 在两个 world 间共享）—— 面板已存在就直接打开，不再重复发 BOOT_COPILOT。
      var p = document.getElementById('caidExtCopilot');
      if (p) {
        p.classList.add('open');
        // 面板打开后隐藏 🤖 按钮（MAIN world 的保活 observer 通过 data-panel-open 识别这是有意隐藏，不会恢复）
        btn.setAttribute('data-panel-open', '1');
        btn.style.display = 'none';
        return;
      }
      chrome.runtime.sendMessage({ type: 'BOOT_COPILOT' });
    });

    document.body.appendChild(btn);
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
  }
  watchPanel();

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
    console.log('[CAID-R] store_handoff: 写入续传上下文, goal=', h.goal, ' toUrl=', h.toUrl);
    sessionSet({ caidHandoff: h }).then(function () {
      console.log('[CAID-R] store_handoff: 写入完成');
    }).catch(function (err) {
      console.warn('[CAID-R] store_handoff 写入失败:', err.message || err);
    });
  });

  // MAIN world 的 navigate_to_url / open_url_in_new_tab 工具（无 chrome.*）通过此 DOM 事件请求开新标签；
  // 由本 ISOLATED world 脚本转发给 background，background 用特权 API chrome.tabs.create 打开，
  // 同时把 handoff 写入 chrome.storage.session，新标签加载完成后自动注入副驾续跑。
  window.addEventListener('__caid_navigate_request', function (e) {
    var detail = e && e.detail;
    if (!detail || !detail.url) return;
    var url = detail.url;
    var active = detail.active !== false;
    var handoff = detail.handoff || null;
    console.log('[CAID-content] 收到 __caid_navigate_request, url=', url, ' active=', active, ' handoff=', !!handoff);
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_URL', url: url, active: active, handoff: handoff });
      console.log('[CAID-content] 已转发 NAVIGATE_TO_URL 给 background');
    } catch (err) {
      console.error('[CAID-content] 转发 NAVIGATE_TO_URL 失败:', err.message || err);
    }
  });

  // 通用 background 消息桥：MAIN world（caid-copilot.js，无 chrome.*）通过 DOM 事件转发任意消息给 background。
  // caidSendToBg 在扩展页直连 chrome.runtime.sendMessage（content.js 不运行），
  // 在正则网页派发 __caid_bg_message 事件 → 本监听器转发。
  // 消息类型：AGENT_ACTIVE / AGENT_INACTIVE / CHECKPOINT / CLEAR_CHECKPOINT 等。
  window.addEventListener('__caid_bg_message', function (e) {
    var msg = e && e.detail;
    if (!msg || !msg.type) return;
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
      chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.error('[CAID-content] 转发 bg_message 失败:', err.message || err);
    }
  });

  // MAIN world 的副驾在任务正常结束 / 被强行终止时派发此事件，清除续传上下文，避免误触发
  window.addEventListener('__caid_clear_handoff', function () {
    sessionRemove(['caidHandoff']).catch(function () {});
  });

  // background 自动跟随进入新标签（target=_blank）后，经此消息让本（旧）标签的 agent 停止。
  // ISOLATED world 收到 runtime 消息后派发 DOM 事件，MAIN world 的 caid-copilot.js 监听并 forceStop。
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'CAID_STOP_AGENT') {
        console.log('[CAID-content] 收到 CAID_STOP_AGENT，派发 __caid_force_stop 停止本页 agent');
        try { window.dispatchEvent(new CustomEvent('__caid_force_stop')); } catch (e) {}
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
            if (resp && resp.ok) console.log('[CAID-R] tryAutoResume: background 已代为注入副驾');
            else console.log('[CAID-R] tryAutoResume: background 也无有效 handoff');
          });
        } catch (e) {
          console.warn('[CAID-R] tryAutoResume: TRY_RESUME_FROM_BG 消息发送失败', e);
        }
      }
    }
  })();
})();
