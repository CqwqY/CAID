// CAID 扩展 options 页逻辑：读写 chrome.storage.local 的 caidLlm 配置。
const FREE = {
  model: 'qwen3.5-plus',
  baseURL: 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run',
  apiKey: 'NA'
};

const $ = (id) => document.getElementById(id);

function applyFree(useFree) {
  if (useFree) {
    $('model').value = FREE.model;
    $('baseUrl').value = FREE.baseURL;
    $('apiKey').value = FREE.apiKey;
  }
}

async function load() {
  const stored = await chrome.storage.local.get(['caidLlm', 'caidLlmMain']);
  // 扩展自身配置优先；若为空（用户从未在扩展里设过），回退主站（graduate.dpdns.org）已保存的 LLM 配置
  const extLlm = stored.caidLlm || {};
  const mainLlm = stored.caidLlmMain || {};
  const llm = (!extLlm.apiKey && !extLlm.custom && mainLlm.apiKey) ? mainLlm : extLlm;
  const useFree = !llm.custom && !llm.apiKey;
  $('useFree').checked = useFree;
  $('model').value = llm.model || FREE.model;
  $('baseUrl').value = llm.baseURL || FREE.baseURL;
  $('apiKey').value = llm.apiKey || FREE.apiKey;
}

$('useFree').addEventListener('change', (e) => applyFree(e.target.checked));

$('save').addEventListener('click', async () => {
  const useFree = $('useFree').checked;
  const cfg = {
    model: $('model').value.trim() || FREE.model,
    baseURL: $('baseUrl').value.trim() || FREE.baseURL,
    apiKey: $('apiKey').value.trim() || FREE.apiKey,
    custom: !useFree
  };
  await chrome.storage.local.set({ caidLlm: cfg });
  $('status').textContent = '已保存 ✓';
  setTimeout(() => { $('status').textContent = ''; }, 2000);
});

load();
