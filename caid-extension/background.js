// CAID 扩展 background service worker（MV3）
// 职责：持有 LLM 配置（chrome.storage）、响应启动指令、以 MAIN world 顺序注入
//       真实 zod-v4 → 魔改 page-agent → 配置 → caid-copilot 到当前活动标签；
//       并以 service worker 身份代理扩展内的跨域网络请求（继承系统代理、绕过页面 CSP/CORS）。

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'BOOT_COPILOT') {
    const tabId = sender.tab && sender.tab.id;
    console.log('[CAID-R] BOOT_COPILOT 收到, tabId=', tabId, ' handoff?', !!(msg.handoff));
    if (tabId) bootCopilot(tabId, null, msg.handoff);
    return false;
  }
  if (msg && msg.type === 'OPEN_OPTIONS') {
    console.log('[CAID-bg] 收到 OPEN_OPTIONS，由 background（特权上下文）打开 options 页');
    try {
      chrome.runtime.openOptionsPage();
      console.log('[CAID-bg] openOptionsPage() 已调用');
    } catch (e) {
      // 兜底：部分环境下 openOptionsPage 受限，改用 tabs.create 直接开扩展选项页
      console.warn('[CAID-bg] openOptionsPage() 失败，兜底 tabs.create:', e);
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
      } catch (e2) {
        console.error('[CAID-bg] 兜底 tabs.create 也失败:', e2);
      }
    }
    return false;
  }
  // content.js 在某些页面上下文中 chrome.storage.session 直接访问会被拒
  // （"Access to storage is not allowed from this context"），经消息让 background 代理读写
  if (msg && msg.type === 'CAID_SESSION_GET') {
    chrome.storage.session.get(msg.keys || [], function (got) {
      sendResponse({ data: got || {} });
    });
    return true;
  }
  if (msg && msg.type === 'CAID_SESSION_SET') {
    chrome.storage.session.set(msg.data || {}, function () {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg && msg.type === 'CAID_SESSION_REMOVE') {
    chrome.storage.session.remove(msg.keys || [], function () {
      sendResponse({ ok: true });
    });
    return true;
  }

  // MAIN world 的副驾（无 chrome.*）经 content.js 把 LLM 请求转交到这里，
  // 由 service worker 用扩展网络栈发起——不受宿主页（如 github.com）的 CSP 限制。
  if (msg && msg.type === 'CAID_LLM_FETCH') {
    (async () => {
      try {
        const init = { method: msg.method || 'GET', headers: msg.headers || {}, redirect: 'follow' };
        if (msg.bodyB64) {
          const bin = atob(msg.bodyB64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          init.body = bytes;
        } else if (msg.bodyText != null) {
          init.body = msg.bodyText;
        }
        const resp = await fetch(msg.url, init);
        const status = resp.status, statusText = resp.statusText;
        const headers = {};
        resp.headers.forEach((v, k) => {
          const lk = String(k).toLowerCase();
          // 剥离会被底层自动处理的传输类头，避免消费端二次解码出错
          if (lk === 'content-encoding' || lk === 'content-length' || lk === 'transfer-encoding') return;
          headers[k] = v;
        });
        const buf = await resp.arrayBuffer();
        sendResponse({ status, statusText, headers, bodyB64: bytesToBase64(new Uint8Array(buf)) });
      } catch (e) {
        sendResponse({ status: 0, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true; // 异步 sendResponse
  }
});

// 点击工具栏图标 → 在当前活动标签启动副驾
chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id) bootCopilot(tab.id, tab.url, null);
});

// 关键改进：在任意标签页加载完成时检查是否有待续传上下文（caidHandoff）。
// background service worker 永远有完整 chrome.storage.session 权限，
// 不再依赖 content.js（某些页面会报 "Access to storage is not allowed from this context"）。
//
// 触发场景：
//   A) 扩展 newtab 页面 → 始终注入副驾（有 handoff 则续跑）
//   B) 普通网站（如 bilibili.com）→ 仅当存在有效 handoff 时才注入副驾并续跑
//   C) 无 handoff 的普通页 → 不注入（零干扰），用户可点 🤖 按钮手动启动
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab || !tab.url) return;
  const nt = chrome.runtime.getURL('newtab.html');
  const isNewTab = tab.url.indexOf(nt) === 0;

  chrome.storage.session.get(['caidHandoff'], function (got) {
    var h = got && got.caidHandoff;
    var fresh = h && (!h.ts || Date.now() - h.ts <= 120000);

    if (isNewTab) {
      // A) newtab：始终启动副驾（有 handoff 则续跑）
      if (fresh) { chrome.storage.session.remove(['caidHandoff']); }
      console.log('[CAID-R] tabs.onUpdated: newtab 加载完成, handoff=', !!fresh);
      bootCopilot(tabId, tab.url, fresh ? h : null);
    } else if (fresh && tab.url !== (h.fromUrl || '') && /^https?:\/\//i.test(tab.url)) {
      // B) 普通页面 + 有效 handoff + 非来源页 + 真实 http(s) URL → 自动注入副驾并续跑
      // （防 chrome.tabs.create 过程中的 about:blank 等中间态提前消耗 handoff）
      chrome.storage.session.remove(['caidHandoff']);
      console.log('[CAID-R] tabs.onUpdated: 普通页面检测到续传, goal=', h.goal, ' url=', tab.url);
      bootCopilot(tabId, tab.url, h);
    }
    // C) 无 handoff 或已过期或来源页本身 → 不操作（用户可手动点 🤖 启动）
  });
});


async function bootCopilot(tabId, tabUrl, handoff) {
  try {

    // 0) 先在目标页 F12 控制台打印可见日志（background 的 console.log 只出现在 SW 控制台，用户看不到）
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (hasHandoff, goal) => {
        console.log('%c[CAID-R] ★★★ bootCopilot 开始注入副驾到当前页 ★★★  handoff=' + !!hasHandoff + (goal ? ' goal=' + goal : ''),
          'color:#185FA5;font-weight:bold;font-size:13px');
      },
      args: [!!handoff, handoff && handoff.goal],
      world: 'MAIN'
    });

    const stored = await chrome.storage.local.get(['caidLlm', 'caidLlmMain']);
    // 合并优先级：扩展自身设置（caidLlm，用户在 options 页显式配置）优先；
    // 若扩展未配置，则回退主站（graduate.dpdns.org）已保存的 LLM 配置（caidLlmMain，由 caid-bridge.js 同步）。
    const extLlm = stored.caidLlm || {};
    const mainLlm = stored.caidLlmMain || {};
    const extHasKey = extLlm.apiKey && extLlm.model;
    const llm = extHasKey ? extLlm : (mainLlm.apiKey ? mainLlm : extLlm);

    // 1) 注入真实 Zod v4 + 魔改 Page-Agent（顺序很重要，必须先于 caid-copilot）
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/zod-v4.umd.js', 'lib/page-agent.headless.js'],
      world: 'MAIN'
    });

    // 2) 写入 LLM 配置 + options 页 URL，供 caid-copilot 读取
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (cfg, optsUrl) => { window.__CAID_LLM_CFG = cfg; window.__CAID_OPTIONS_URL = optsUrl; },
      args: [llm, chrome.runtime.getURL('options.html')],
      world: 'MAIN'
    });

    // 3) 若携带断点续传上下文，先落地到 window，供 caid-copilot 恢复
    if (handoff) {
      console.log('[CAID-R] bootCopilot: 落地 window.__CAID_HANDOFF, goal=', handoff.goal);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (h) => {
          window.__CAID_HANDOFF = h;
          console.log('%c[CAID-R] ✅ window.__CAID_HANDOFF 已落地, goal=' + h.goal, 'color:green;font-weight:bold');
        },
        args: [handoff],
        world: 'MAIN'
      });
    }

    // 4) 启动副驾（构建 customTools + 创建 agent + 渲染面板）
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['caid-copilot.js'],
      world: 'MAIN'
    });

    // 5) 确认注入完成（在目标页 F12 可见）
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        console.log('%c[CAID-R] ✅ bootCopilot 全部注入完成（zod-v4 + page-agent + LLM_CFG + caid-copilot）',
          'color:green;font-weight:bold');
      },
      world: 'MAIN'
    });
  } catch (e) {
    console.error('[CAID] bootCopilot failed:', e);
  }
}

// ---------- 代理扩展内跨域网络请求 ----------
// MAIN world 的副驾（无 chrome.*）把 LLM 请求经 ISOLATED world 的 content.js
// 以 chrome.runtime.sendMessage 转交此处，由 service worker 用扩展网络栈发起，
// 故完全不受宿主页（如 github.com / bilibili.com）的 CSP 限制。
// 处理逻辑见上方 onMessage 的 CAID_LLM_FETCH 分支。
