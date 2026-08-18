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
    // 先存储 handoff（若有），再导航 —— 确保 tabs.onUpdated 触发时 handoff 已在 storage 中
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
        var senderTabId = sender && sender.tab && sender.tab.id;
        if (msg.sameTab && senderTabId) {
          // 同页跳转（点击站内链接）：tabs.update 替换当前标签页（不新建），
          // 续跑由 tabs.onUpdated 的「本 tab 有活跃 agent」判定接管（caidAgentTabs 心跳保持新鲜）。
          chrome.tabs.update(senderTabId, { url: msg.url }, function (tab) {
            if (chrome.runtime.lastError) {
              console.warn('[CAID-R] NAVIGATE_TO_URL: tabs.update 失败:', chrome.runtime.lastError.message);
            } else {
              console.log('[CAID-R] NAVIGATE_TO_URL: 已同页导航 tabId=', senderTabId, ' url=', msg.url, ' handoff=', !!msg.handoff);
            }
          });
        } else {
          const opts = { url: msg.url, active: msg.active !== false };
          // 带 opener 关系：新标签加载后 tabs.onUpdated 的 viaOpener 判定才能命中
          // （click 拦截等无 handoff 的站外导航，靠 opener 的活跃 agent 走 auto-follow 续跑）
          if (senderTabId) opts.openerTabId = senderTabId;
          chrome.tabs.create(opts, function (tab) {
            if (chrome.runtime.lastError) {
              console.warn('[CAID-R] NAVIGATE_TO_URL: chrome.tabs.create 失败:', chrome.runtime.lastError.message);
            } else {
              console.log('[CAID-R] NAVIGATE_TO_URL: background 已用 chrome.tabs.create 打开新标签, tabId=', tab && tab.id, ' url=', msg.url, ' handoff=', !!msg.handoff);
            }
          });
        }
      } catch (e) {
        console.error('[CAID-R] NAVIGATE_TO_URL: 异常', e);
      }
    });
    // ack 回执：立即通知发送方（MAIN world）导航请求已被受理，停止其重试/兜底计时。
    // 无 navId（copilot 导航工具的旧路径）也统一回执，避免 content.js 回调误报 lastError。
    try { sendResponse({ ok: true, id: msg.navId || null }); } catch (e) {}
    return true; // 异步 sendResponse（storePromise.then 完成后才真正导航）
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
        chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html#settings') });
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
  // 【关键】必须同步持久化到 chrome.storage.session：MV3 service worker 约 30s 空闲即被 Chrome 销毁，
  // 内存 Map(activeAgentTabs) 会丢失 → 同标签页跳转时 tabs.onUpdated 查不到状态 → 自动跟随失效。
  // storage.session 跨 SW 重启存活（浏览器会话内有效），是同标签页续跟的可靠载体。
  if (msg && msg.type === 'AGENT_ACTIVE') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      var stA = { goal: msg.goal, fromUrl: msg.fromUrl || '', ts: Date.now() };
      activeAgentTabs.set(tabId, stA);
      chrome.storage.session.get(['caidAgentTabs'], function (got) {
        var tabs = (got && got.caidAgentTabs) || {};
        tabs[tabId] = stA;
        chrome.storage.session.set({ caidAgentTabs: tabs });
      });
      console.log('[CAID-R] AGENT_ACTIVE tabId=', tabId, 'goal=', msg.goal);
    }
    return false;
  }
  if (msg && msg.type === 'AGENT_INACTIVE') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      activeAgentTabs.delete(tabId);
      chrome.storage.session.get(['caidAgentTabs'], function (got) {
        var tabs = (got && got.caidAgentTabs) || {};
        if (tabs[tabId]) { delete tabs[tabId]; chrome.storage.session.set({ caidAgentTabs: tabs }); }
      });
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

  // 同时读 handoff + 持久化的 agent 活跃表（caidAgentTabs 跨 SW 重启存活，内存 Map 只是加速缓存）
  chrome.storage.session.get(['caidHandoff', 'caidAgentTabs'], function (got) {
    var h = got && got.caidHandoff;
    var fresh = h && (!h.ts || Date.now() - h.ts <= 120000);
    var now = Date.now();

    // 统一判别：本 tab（同标签页跳转）或其 opener（target=_blank 新标签）是否有活跃 agent。
    // 这是"本次导航与 agent 相关"的可靠依据——全局 caidHandoff 无法区分
    // 「agent 的 tab 跳转了」和「用户手动开了个不相关的新标签」（后者绝不能误续跑）。
    var tabs = (got && got.caidAgentTabs) || {};
    var st = tabs[tabId] || activeAgentTabs.get(tabId) || null;
    var viaOpener = false;
    if (!st && tab.openerTabId) {
      st = tabs[tab.openerTabId] || activeAgentTabs.get(tab.openerTabId) || null;
      viaOpener = !!st;
    }
    var linked = !!(st && now - st.ts < 300000);

    if (isNewTab) {
      // A) newtab：始终启动副驾；仅消费"显式导航意图"的 handoff（h.toUrl 非空，来自 navigate_to_url）。
      // checkpoint/auto 类 handoff（toUrl=null）不消费——否则 agent 在别的 tab 运行时，
      // 用户随手开个新标签页都会被误续跑。
      var consumeA = fresh && h.toUrl;
      if (consumeA) chrome.storage.session.remove(['caidHandoff']);
      console.log('[CAID-R] tabs.onUpdated: newtab 加载完成, handoff=', !!consumeA);
      bootCopilot(tabId, tab.url, consumeA ? h : null);
    } else if (fresh && (h.toUrl || linked) && tab.url !== (h.fromUrl || '') && /^https?:\/\//i.test(tab.url)) {
      // B) 普通页面 + 有效 handoff + (显式导航意图 或 本 tab/opener 有活跃 agent) + 非来源页 → 续跑
      chrome.storage.session.remove(['caidHandoff']);
      console.log('[CAID-R] tabs.onUpdated: 普通页面检测到续传, goal=', h.goal, ' url=', tab.url, ' linked=', linked, ' viaOpener=', viaOpener);
      bootCopilot(tabId, tab.url, h);
      if (viaOpener && tab.openerTabId) stopAgentInTab(tab.openerTabId);
      markFollowed(tabId, tab.url);
    } else if (linked && tab.url !== st.fromUrl && /^https?:\/\//i.test(tab.url)) {
      // C) 无可用 handoff，但本 tab（同页跳转：点链接/表单提交/execute_javascript 点击）或
      // opener（target=_blank 新标签）有活跃 agent → 用跟踪的 goal 直接建 handoff 自动跟随。
      // 这条路径不依赖 checkpoint 的写入时序（页面可能在步骤中途卸载，checkpoint 来不及写）。
      if (_autoFollowCooldown.has(tabId) && now - _autoFollowCooldown.get(tabId) < 5000) return;
      _autoFollowCooldown.set(tabId, now);
      var autoHandoff = {
        goal: st.goal,
        fromUrl: st.fromUrl,
        toUrl: tab.url,
        ts: now,
        recent: [],
        source: 'auto-follow'
      };
      console.log('[CAID-R] ★ auto-follow: 页面导航时 agent 仍活跃, 自动续跑到新页面, goal=', st.goal, ' url=', tab.url, ' viaOpener=', viaOpener);
      bootCopilot(tabId, tab.url, autoHandoff);
      if (viaOpener && tab.openerTabId) stopAgentInTab(tab.openerTabId);
      markFollowed(tabId, tab.url);
    }
  });
});

// 自动跟随后把该 tab 的跟踪状态 fromUrl 更新为新 URL，支持连续多跳（A→B→C 都能继续跟随）
function markFollowed(tabId, url) {
  var st = activeAgentTabs.get(tabId);
  if (st) st.fromUrl = url;
  chrome.storage.session.get(['caidAgentTabs'], function (got) {
    var tabs = (got && got.caidAgentTabs) || {};
    if (tabs[tabId]) { tabs[tabId].fromUrl = url; chrome.storage.session.set({ caidAgentTabs: tabs }); }
  });
}

// 跟随进入新标签（target=_blank）后，通知旧标签的 agent 停止——
// 否则旧标签的 agent 还在原地空转（"发懵"），两边的状态也会互相覆盖。
function stopAgentInTab(tabId) {
  try {
    chrome.tabs.sendMessage(tabId, { type: 'CAID_STOP_AGENT' }, function () {
      void chrome.runtime.lastError; // content.js 不在的页面（扩展页等）忽略
    });
  } catch (e) {}
  // 双保险：旧页 forceStop 也会发 AGENT_INACTIVE 清理，这里先清跟踪状态
  activeAgentTabs.delete(tabId);
  chrome.storage.session.get(['caidAgentTabs'], function (got) {
    var tabs = (got && got.caidAgentTabs) || {};
    if (tabs[tabId]) { delete tabs[tabId]; chrome.storage.session.set({ caidAgentTabs: tabs }); }
  });
}

// 清理已关闭 tab 的 agent 状态
chrome.tabs.onRemoved.addListener((tabId) => {
  activeAgentTabs.delete(tabId);
  _autoFollowCooldown.delete(tabId);
  chrome.storage.session.get(['caidAgentTabs'], function (got) {
    var tabs = (got && got.caidAgentTabs) || {};
    if (tabs[tabId]) { delete tabs[tabId]; chrome.storage.session.set({ caidAgentTabs: tabs }); }
  });
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
      args: [llm, chrome.runtime.getURL('newtab.html#settings')],
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
