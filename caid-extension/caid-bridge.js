// CAID 扩展 · 主站配置桥接脚本（ISOLATED world content script）
// 仅在 https://graduate.dpdns.org/* 运行。
// 职责：把主站（公网站点）已保存的 LLM 配置同步进扩展的 chrome.storage.local，
//       使扩展副驾在任意网页上能直接复用用户在主站设置好的 API Key / 模型。
//       同时支持反向同步（在扩展设置页改了配置 → 写回主站 localStorage），避免双份数据。
(function () {
  if (window.__CAID_BRIDGE__) return;
  window.__CAID_BRIDGE__ = true;

  // 主站 localStorage 键名（与 index.html 的 LS 封装一致）
  var LS_KEYS = { llm: 'llmCfg', pa: 'paCfg' };

  // 主站 llmCfg → 扩展 caidLlm 格式映射
  function mapLlmToExt(llm) {
    if (!llm || typeof llm !== 'object') return null;
    var apiKey = (llm.apiKey || '').trim();
    return {
      model: llm.model || 'qwen-plus',
      baseURL: llm.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: apiKey,
      custom: !!apiKey
    };
  }

  // 扩展 caidLlm → 主站 llmCfg 格式映射（反向写回）
  function mapExtToLlm(ext) {
    if (!ext || typeof ext !== 'object') return null;
    return {
      provider: 'dashscope',
      baseUrl: ext.baseURL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: ext.apiKey || '',
      model: ext.model || 'qwen-plus',
      temperature: 0.7
    };
  }

  function readMainLlm() {
    try {
      var raw = localStorage.getItem(LS_KEYS.llm);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function writeMainLlm(llm) {
    try { localStorage.setItem(LS_KEYS.llm, JSON.stringify(llm)); } catch (e) {}
  }

  // 主站 → 扩展：把主站配置推入 chrome.storage.local.caidLlmMain
  function pushMainToExt() {
    var mainLlm = readMainLlm();
    if (!mainLlm) return;
    var extLlm = mapLlmToExt(mainLlm);
    if (!extLlm) return;
    chrome.storage.local.set({ caidLlmMain: extLlm });
  }

  // 扩展 → 主站（仅当用户在扩展设置页显式保存时触发，由 onChanged 控制，避免循环）
  var suppressEcho = false;
  function pushExtToMain(extLlm) {
    if (!extLlm || !extLlm.custom) return; // 只在用户配置了自定义 Key 时写回主站
    var mainLlm = mapExtToLlm(extLlm);
    if (!mainLlm) return;
    suppressEcho = true;
    try { writeMainLlm(mainLlm); } finally {
      setTimeout(function () { suppressEcho = false; }, 200);
    }
  }

  // 初始化：先把主站已有配置同步给扩展
  try { pushMainToExt(); } catch (e) {}

  // 轮询兜底：ISOLATED world 覆盖不了主站 MAIN world 的 localStorage.setItem，
  // 所以定时比对主站 llmCfg 是否变化（用户在主站改了配置能及时同步到扩展）。
  var lastSeen = JSON.stringify(readMainLlm());
  setInterval(function () {
    if (suppressEcho) return;
    var cur = null;
    try { cur = readMainLlm(); } catch (e) { return; }
    var curStr = JSON.stringify(cur);
    if (curStr !== lastSeen) {
      lastSeen = curStr;
      try { pushMainToExt(); } catch (e) {}
    }
  }, 10000);

  // 监听扩展侧配置变化 → 写回主站（双向同步）
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.caidLlm && !suppressEcho) {
        var extLlm = changes.caidLlm.newValue;
        pushExtToMain(extLlm);
      }
    });
  }

  // 监听主站 localStorage 变化（用户在主站设置页改了）→ 同步到扩展
  // 用包装后的 setItem 捕获；同时定时兜底（部分页面框架不一定走我们的 LS 封装）
  var origSetItem = localStorage.setItem;
  localStorage.setItem = function (k, v) {
    try { return origSetItem.call(localStorage, k, v); }
    finally {
      if (k === LS_KEYS.llm && !suppressEcho) {
        try { pushMainToExt(); } catch (e) {}
      }
    }
  };
})();
