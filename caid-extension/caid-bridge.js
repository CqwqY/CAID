// CAID 扩展 · 主站配置桥接脚本（ISOLATED world content script）
// 仅在 https://graduate.dpdns.org/* 运行。
// 职责：把主站（公网站点）已保存的 LLM 配置单向同步进扩展的 chrome.storage.local.caidLlmMain，
//       作为扩展副驾"未配置时的兜底"。
// 注意：仅单向（主站 → 扩展）。副驾配置（caidLlm）与主站 AI 回答配置是两套独立配置，
//       绝不反向写回——避免在扩展设置里配的副驾 API 覆盖主站 AI 回答 API。
(function () {
  if (window.__CAID_BRIDGE__) return;
  window.__CAID_BRIDGE__ = true;

  // 主站 localStorage 键名（与 index.html 的 LS 封装一致）
  var LS_KEYS = { llm: 'llmCfg', pa: 'paCfg' };

  // 主站 llmCfg → 扩展 caidLlmMain 格式映射
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

  function readMainLlm() {
    try {
      var raw = localStorage.getItem(LS_KEYS.llm);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  // 主站 → 扩展：把主站配置推入 chrome.storage.local.caidLlmMain
  function pushMainToExt() {
    var mainLlm = readMainLlm();
    if (!mainLlm) return;
    var extLlm = mapLlmToExt(mainLlm);
    if (!extLlm) return;
    chrome.storage.local.set({ caidLlmMain: extLlm });
  }

  // 初始化：先把主站已有配置同步给扩展
  try { pushMainToExt(); } catch (e) {}

  // 轮询兜底：ISOLATED world 覆盖不了主站 MAIN world 的 localStorage.setItem，
  // 所以定时比对主站 llmCfg 是否变化（用户在主站改了配置能及时同步到扩展）。
  var lastSeen = JSON.stringify(readMainLlm());
  setInterval(function () {
    var cur = null;
    try { cur = readMainLlm(); } catch (e) { return; }
    var curStr = JSON.stringify(cur);
    if (curStr !== lastSeen) {
      lastSeen = curStr;
      try { pushMainToExt(); } catch (e) {}
    }
  }, 10000);

  // 监听主站 localStorage 变化（用户在主站设置页改了）→ 同步到扩展
  var origSetItem = localStorage.setItem;
  localStorage.setItem = function (k, v) {
    try { return origSetItem.call(localStorage, k, v); }
    finally {
      if (k === LS_KEYS.llm) {
        try { pushMainToExt(); } catch (e) {}
      }
    }
  };
})();
