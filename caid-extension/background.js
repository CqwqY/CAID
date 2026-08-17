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

// 自己接管的 newtab（扩展页，content script 不注入）加载完成后自动启动副驾，
// 使其自带 🤖 启动按钮（面板默认收起，由 caid-copilot 自建 launcher 打开）。
// 复用 bootCopilot 链路：注入 zod-v4 + page-agent + LLM_CFG + caid-copilot。
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const nt = chrome.runtime.getURL('newtab.html');
  if (tab && tab.url && tab.url.indexOf(nt) === 0) bootCopilot(tabId, tab.url, null);
});


async function bootCopilot(tabId, tabUrl, handoff) {
  try {

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
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (h) => { window.__CAID_HANDOFF = h; },
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
  } catch (e) {
    console.error('[CAID] bootCopilot failed:', e);
  }
}

// ---------- 代理扩展内跨域网络请求 ----------
// MAIN world 的副驾（无 chrome.*）把 LLM 请求经 ISOLATED world 的 content.js
// 以 chrome.runtime.sendMessage 转交此处，由 service worker 用扩展网络栈发起，
// 故完全不受宿主页（如 github.com / bilibili.com）的 CSP 限制。
// 处理逻辑见上方 onMessage 的 CAID_LLM_FETCH 分支。
