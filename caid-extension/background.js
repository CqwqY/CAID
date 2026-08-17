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

// ---------- Agent 活跃状态跟踪（自动跟随） ----------
// 当 agent 在某 tab 开始任务时（sendTask），caid-copilot.js 经 caidSendToBg 发 AGENT_ACTIVE。
// background 记住「tab X 正在跑 goal Y」。之后该 tab 任意导航（同页跳转/链接新标签/表单提交）
// 触发 tabs.onUpdated 时，background 直接用存储的 goal 创建 handoff 并 bootCopilot 续跑——
// 不依赖 checkpoint 的时序（checkpoint 走 DOM 事件 → content.js → storage，扩展页上 content.js 不运行）。
var activeAgentTabs = new Map();       // tabId → { goal, fromUrl, ts }
var _autoFollowCooldown = new Map();   // tabId → ts（5s 内不重复注入）

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'BOOT_COPILOT') {
    const tabId = sender.tab && sender.tab.id;
    console.log('[CAID-R] BOOT_COPILOT 收到, tabId=', tabId, ' handoff?', !!(msg.handoff));
    if (tabId) {
      if (msg.handoff) {
        bootCopilot(tabId, null, msg.handoff);
      } else {
        // 先尝试直接打开已有面板（避免重复注入 zod-v4 / page-agent 可能出错）
        ensureCopilotOpen(tabId);
      }
    }
    return false;
  }
  // MAIN world 的 navigate_to_url / open_url_in_new_tab 工具经此消息请求 background
  // 用特权 API chrome.tabs.create 打开新标签（MAIN world 无 chrome.tabs，window.open 又易被拦截）。
  // 同时：若携带 handoff（续传上下文），由 background 直接写入 chrome.storage.session
  // （永远有权限，不依赖 content.js 桥接 —— 修复扩展页/newtab 上 content.js 不运行导致 handoff 丢失的根因）。
  // 新标签加载完成后，下方 tabs.onUpdated 会自动检测 caidHandoff 并注入副驾续跑。
  if (msg && msg.type === 'NAVIGATE_TO_URL') {
    // 先存储 handoff（若有），再开标签 —— 确保 tabs.onUpdated 触发时 handoff 已在 storage 中
    var storePromise = Promise.resolve();
    if (msg.handoff) {
      storePromise = new Promise(function (resolve) {
        chrome.storage.session.set({ caidHandoff: msg.handoff }, function () {
          if (chrome.runtime.lastError) {
            console.warn('[CAID-R] NAVIGATE_TO_URL: handoff 存储失败:', chrome.runtime.lastError.message);
          } else {
            console.log('[CAID-R] NAVIGATE_TO_URL: handoff 已存入 storage.session, goal=', msg.handoff.goal);
          }
          resolve();
        });
      });
    }
    storePromise.then(function () {
      try {
        const opts = { url: msg.url, active: msg.active !== false };
        chrome.tabs.create(opts, function (tab) {
          if (chrome.runtime.lastError) {
            console.warn('[CAID-R] NAVIGATE_TO_URL: chrome.tabs.create 失败:', chrome.runtime.lastError.message);
          } else {
            console.log('[CAID-R] NAVIGATE_TO_URL: background 已用 chrome.tabs.create 打开新标签, tabId=', tab && tab.id, ' url=', msg.url, ' handoff=', !!msg.handoff);
          }
        });
      } catch (e) {
        console.error('[CAID-R] NAVIGATE_TO_URL: 异常', e);
      }
    });
    return false; // 同步处理，无需异步 sendResponse
  }

  // content.js 在目标页 storage 两次均失败时的终极兜底：
  // 由 background（永远有完整权限）查 handoff，若有则直接 bootCopilot 注入副驾。
  if (msg && msg.type === 'TRY_RESUME_FROM_BG') {
    const tabId = sender.tab && sender.tab.id;
    const tabUrl = sender.tab && sender.tab.url;
    chrome.storage.session.get(['caidHandoff'], function (got) {
      var h = got && got.caidHandoff;
      var fresh = h && (!h.ts || Date.now() - h.ts <= 120000);
      if (fresh && tabUrl && tabUrl !== (h.fromUrl || '') && /^https?:\/\//i.test(tabUrl)) {
        chrome.storage.session.remove(['caidHandoff']);
        console.log('[CAID-R] TRY_RESUME_FROM_BG: 检测到有效 handoff, goal=', h.goal, ' 注入副驾到', tabUrl);
        bootCopilot(tabId, tabUrl, h);
        sendResponse({ ok: true });
      } else {
        console.log('[CAID-R] TRY_RESUME_FROM_BG: 无有效 handoff 或不满足条件');
        sendResponse({ ok: false });
      }
    });
    return true; // 异步 sendResponse
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

  // ---------- Agent 活跃状态通知（经 caidSendToBg 桥接，扩展页直连 / 正则网页走 content.js DOM 桥）----------
  if (msg && msg.type === 'AGENT_ACTIVE') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      activeAgentTabs.set(tabId, { goal: msg.goal, fromUrl: msg.fromUrl || '', ts: Date.now() });
      console.log('[CAID-R] AGENT_ACTIVE tabId=', tabId, 'goal=', msg.goal);
    }
    return false;
  }
  if (msg && msg.type === 'AGENT_INACTIVE') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      activeAgentTabs.delete(tabId);
      console.log('[CAID-R] AGENT_INACTIVE tabId=', tabId);
    }
    return false;
  }
  // checkpoint 直接写 storage（扩展页 content.js 不运行时兜底）
  if (msg && msg.type === 'CHECKPOINT') {
    if (msg.handoff) {
      chrome.storage.session.set({ caidHandoff: msg.handoff }, function () {
        console.log('[CAID-R] CHECKPOINT: handoff 已存入 storage.session, goal=', msg.handoff.goal);
      });
    }
    return false;
  }
  if (msg && msg.type === 'CLEAR_CHECKPOINT') {
    chrome.storage.session.remove(['caidHandoff']);
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
  if (tab && tab.id) ensureCopilotOpen(tab.id);
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
    } else {
      // C) 无显式 handoff → 检查本 tab（或 opener tab）是否有活跃 agent
      // 场景：agent 用 execute_javascript 点击视频卡片 / 用户手动点链接 / 表单提交 →
      // 页面导航但 agent 没调 navigate_to_url → checkpoint 可能没来得及写 →
      // background 用 AGENT_ACTIVE 时存的 goal 直接创建 handoff 并续跑
      var now = Date.now();
      if (_autoFollowCooldown.has(tabId) && now - _autoFollowCooldown.get(tabId) < 5000) return;

      // 同 tab 导航（点击链接导致同页跳转）或新 tab 导航（target=_blank 链接，openerTabId 指向源 tab）
      var agentState = activeAgentTabs.get(tabId);
      if (!agentState && tab.openerTabId) agentState = activeAgentTabs.get(tab.openerTabId);
      if (agentState && now - agentState.ts < 300000 && tab.url !== agentState.fromUrl && /^https?:\/\//i.test(tab.url)) {
        _autoFollowCooldown.set(tabId, now);
        var autoHandoff = {
          goal: agentState.goal,
          fromUrl: agentState.fromUrl,
          toUrl: tab.url,
          ts: now,
          recent: [],
          source: 'auto-follow'
        };
        console.log('[CAID-R] ★ auto-follow: 页面导航时 agent 仍活跃, 自动续跑到新页面, goal=', agentState.goal, ' url=', tab.url, ' sameTab=', activeAgentTabs.has(tabId));
        bootCopilot(tabId, tab.url, autoHandoff);
      }
    }
  });
});

// 清理已关闭 tab 的 agent 状态
chrome.tabs.onRemoved.addListener((tabId) => {
  activeAgentTabs.delete(tabId);
  _autoFollowCooldown.delete(tabId);
});


// 轻量级"打开面板"：先检查面板是否已存在（已 boot 过），存在则直接 add('open')，
// 不存在才走全量 bootCopilot（避免重复注入 zod-v4 / page-agent 导致潜在错误）。
async function ensureCopilotOpen(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        var ex = document.getElementById('caidExtCopilot');
        if (ex) { ex.classList.add('open'); return true; }
        return false;
      },
      world: 'MAIN'
    });
    if (results && results[0] && results[0].result) {
      console.log('[CAID-bg] 面板已存在，直接打开');
      return;
    }
  } catch (e) {
    console.warn('[CAID-bg] 检查面板失败，回退全量注入:', e.message || e);
  }
  bootCopilot(tabId, null, null);
}

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
