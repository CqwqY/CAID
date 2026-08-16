// CAID 扩展 background service worker（MV3）
// 职责：持有 LLM 配置（chrome.storage）、响应启动指令、以 MAIN world 顺序注入
//       真实 zod-v4 → 魔改 page-agent → 配置 → caid-copilot 到当前活动标签；
//       并以 service worker 身份代理扩展内的跨域网络请求（继承系统代理、绕过页面 CSP/CORS）。

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'BOOT_COPILOT') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) bootCopilot(tabId, null, msg.handoff);
    return false;
  }
});

// 点击工具栏图标 → 在当前活动标签启动副驾
chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id) bootCopilot(tab.id, tab.url, null);
});

async function bootCopilot(tabId, tabUrl, handoff) {
  try {
    // 主页（扩展自身 newtab）不注入第二套副驾，直接切换页面自带面板
    if (tabUrl && tabUrl.indexOf('chrome-extension://') === 0) {
      try { chrome.runtime.sendMessage({ type: 'CAID_TOGGLE_PANEL' }); } catch (e) {}
      return;
    }
    const stored = await chrome.storage.local.get(['caidLlm']);
    const llm = stored.caidLlm || {};

    // 0) 先注入 fetch 代理垫片（必须早于 PageAgent，使其内部 fetch 走后台代理）
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['caid-fetch-shim.js'],
      world: 'MAIN'
    });

    // 1) 注入真实 Zod v4 + 魔改 Page-Agent（顺序很重要，必须先于 caid-copilot）
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/zod-v4.umd.js', 'lib/page-agent.headless.js'],
      world: 'MAIN'
    });

    // 2) 写入 LLM 配置，供 caid-copilot 读取
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (cfg) => { window.__CAID_LLM_CFG = cfg; },
      args: [llm],
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
// 由 MAIN world 注入的 fetch 垫片经 chrome.runtime.connect 转发到此，
// 用 Chrome 网络栈（继承系统代理）发出，绕过宿主页 CSP/CORS；返回流式分块。
function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'caid-fetch') return;
  let finished = false;

  port.onMessage.addListener(async (req) => {
    if (!req || !req.url) { try { port.postMessage({ type: 'error', message: '缺少 url' }); } catch (e) {} return; }
    try {
      const init = {
        method: req.method || 'GET',
        headers: req.headers || {},
        redirect: 'follow'
      };
      if (req.bodyB64) {
        const bin = atob(req.bodyB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        init.body = bytes;
      } else if (req.body != null) {
        init.body = req.body;
      }

      const resp = await fetch(req.url, init);
      const status = resp.status;
      const statusText = resp.statusText;
      // 剥离会被底层自动处理的传输类头，避免消费端二次解码出错
      const headers = {};
      resp.headers.forEach((v, k) => {
        const lk = String(k).toLowerCase();
        if (lk === 'content-encoding' || lk === 'content-length' || lk === 'transfer-encoding') return;
        headers[k] = v;
      });
      port.postMessage({ type: 'meta', status, statusText, headers });

      if (resp.body && resp.body.getReader) {
        const reader = resp.body.getReader();
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          if (r.value) port.postMessage({ type: 'chunk', b64: bytesToBase64(r.value) });
        }
      }
      port.postMessage({ type: 'done' });
      finished = true;
    } catch (e) {
      try { port.postMessage({ type: 'error', message: String(e && e.message ? e.message : e) }); } catch (_) {}
    }
  });

  port.onDisconnect.addListener(() => {});
});
