// CAID 副驾（纯净版）设置页：读写 chrome.storage.local.caidLlm
// 与副驾面板内联设置（cpSave）保持一致：无真实 Key 时 apiKey='NA' 表示走内置免费代理。
// 更新后 background bootCopilot 每次启动读最新配置，无需重启扩展。
(function () {
  const FREE_BASE = 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run';
  const FREE_MODEL = 'qwen3.5-plus';
  const $ = (id) => document.getElementById(id);

  async function load() {
    let cfg = {};
    try { cfg = (await chrome.storage.local.get('caidLlm')).caidLlm || {}; } catch (e) {}
    const isFree = !cfg.apiKey || cfg.apiKey === 'NA' || cfg.apiKey === 'null' || cfg.apiKey === 'undefined';
    $('useFree').checked = isFree;
    $('baseURL').value = cfg.baseURL || FREE_BASE;
    $('model').value = cfg.model || FREE_MODEL;
    $('apiKey').value = isFree ? '' : (cfg.apiKey || '');
  }

  async function save() {
    const useFree = $('useFree').checked;
    const key = $('apiKey').value.trim();
    const cfg = {
      model: $('model').value.trim() || FREE_MODEL,
      baseURL: $('baseURL').value.trim() || FREE_BASE,
      apiKey: useFree ? 'NA' : (key || 'NA'),
      custom: !useFree
    };
    try { await chrome.storage.local.set({ caidLlm: cfg }); }
    catch (e) {
      const s = $('status');
      s.textContent = '保存失败：' + (e && e.message || e);
      s.className = 'err';
      return;
    }
    const s = $('status');
    s.textContent = '✅ 已保存（' + (useFree ? '免费代理' : cfg.model) + '）';
    s.className = 'ok';
    setTimeout(() => { s.textContent = ''; }, 2500);
  }

  document.addEventListener('DOMContentLoaded', load);
  $('save').addEventListener('click', save);
})();