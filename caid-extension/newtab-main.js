
/* ======================================================================
   CAID Workbench · Single-file SPA
   Pure HTML/CSS/JS. All modules in one file for simple deployment.
   ====================================================================== */

// ---- syntax error self-report (temporary debug hook, removed in production)
(function(){
  function caidErrRep(msg, url, line, col, err) {
    try {
      var payload = 'CAID_ERR|' + Date.now() + '|' + encodeURIComponent(String(msg||'')) +
        '|L=' + (line||0) + '|C=' + (col||0);
      if (err && err.stack) payload += '|S=' + encodeURIComponent(String(err.stack).slice(0,400));
      location.hash = payload;
    } catch(_) {}
  }
  window.addEventListener('error', function(e){ caidErrRep(e.message, e.filename, e.lineno, e.colno, e.error); });
  window.addEventListener('unhandledrejection', function(e){
    try { caidErrRep('UNHANDLED: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)), '', 0, 0, e.reason); } catch(_){}
  });
})();

// ============ Utilities ============
// 注意：不要用全局名 `$`，因为主网站（graduate.dpdns.org）可能已经声明过 const/let $，
// 跨 <script> 在同一全局词法作用域会报 "Identifier '$' has already been declared"。
const caidQs = (sel, el = document) => el.querySelector(sel);
const caidQsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10);
const debounce = (fn, ms = 200) => {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// lucide.createIcons 防抖版：合并短时间内的多次调用，避免全量 DOM 扫描
const refreshIcons = debounce(() => { if (window.lucide) lucide.createIcons(); }, 50);

// ============ 主网站信息（给 Page-Agent 读）============
const MAIN_SITE_URL = 'https://graduate.dpdns.org/';
const MAIN_SITE_NAME = '程序员工作台 · CAID';
function navigateToMainSite() {
  try { (window.top || window).location.href = MAIN_SITE_URL; }
  catch(e) { window.location.href = MAIN_SITE_URL; }
}
window.navigateToMainSite = navigateToMainSite;
window.__MAIN_SITE_URL__ = MAIN_SITE_URL;
window.__MAIN_SITE_NAME__ = MAIN_SITE_NAME;

// ============ Local Storage Wrapper ============
const LS = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
    catch(e) { return def; }
  },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem(k); },
};

// ============ 配置持久化（IndexedDB 备份 + 自动恢复） ============
// localStorage 可能因浏览器清缓存/路径变更/隐私模式而丢失
// IndexedDB 更持久，作为配置的二级备份
const ConfigBackup = {
  async save(key, value) {
    try { await db.config.put({ key, value, savedAt: Date.now() }); } catch(e) {}
  },
  async load(key) {
    try { const row = await db.config.get(key); return row?.value ?? null; } catch(e) { return null; }
  },
  // 检查 localStorage 中的配置是否丢失，如果丢失则从 IndexedDB 恢复
  async restoreIfMissing(key, currentVal) {
    if (currentVal && Object.keys(currentVal).length > 0 &&
        (currentVal.apiKey || currentVal.baseUrl || currentVal.model)) {
      // localStorage 有有效配置，备份到 IndexedDB
      await this.save(key, currentVal);
      return currentVal;
    }
    // localStorage 无有效配置，尝试从 IndexedDB 恢复
    const backup = await this.load(key);
    if (backup) {
      LS.set(key, backup);
      return backup;
    }
    return currentVal;
  },
};

// 颜色混合：用于胶囊按钮渐变深色端（hexA 向 hexB 按 ratio 混合，ratio=0 返回 A, =1 返回 B）
function mixWith(hexA, hexB, ratio = 0.5) {
  const a = hexA.replace('#','');
  const b = hexB.replace('#','');
  const ar = parseInt(a.slice(0,2),16), ag = parseInt(a.slice(2,4),16), ab = parseInt(a.slice(4,6),16);
  const br = parseInt(b.slice(0,2),16), bg = parseInt(b.slice(2,4),16), bb = parseInt(b.slice(4,6),16);
  const r = Math.round(ar*(1-ratio) + br*ratio);
  const g = Math.round(ag*(1-ratio) + bg*ratio);
  const bv = Math.round(ab*(1-ratio) + bb*ratio);
  return '#' + [r,g,bv].map(x => x.toString(16).padStart(2,'0')).join('');
}
// 加深颜色（按百分比 d 降低 RGB）
function darken(hex, d = 0.15) {
  const h = hex.replace('#','');
  const r = Math.max(0, Math.round(parseInt(h.slice(0,2),16)*(1-d)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2,4),16)*(1-d)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4,6),16)*(1-d)));
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

// ============ IndexedDB via Dexie ============
const db = new Dexie('caid_workbench');
db.version(1).stores({
  snippets: '++id, title, lang, *tags, createdAt',
  history: '++id, query, mode, timestamp',
});
db.version(2).stores({
  snippets: '++id, title, lang, *tags, createdAt',
  history: '++id, query, mode, timestamp',
  config: 'key',  // 配置备份表（比 localStorage 更持久）
});

// ============ Toast ============
function toast(msg, type = 'info', dur = 2500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  caidQs('#toastContainer').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, dur);
}

// ============ Clock & Greeting ============
function updateClock() {
  const now = new Date();
  caidQs('#clockTime').textContent = fmtTime(now);
  caidQs('#clockDate').textContent = fmtDate(now);
  const h = now.getHours();
  let g = '继续加油！';
  if (h < 6) g = '夜深了，注意休息 🌙';
  else if (h < 9) g = '早上好，开启元气满满的一天 ☀️';
  else if (h < 12) g = '上午好，代码愉快 💻';
  else if (h < 14) g = '中午好，记得吃饭 🍜';
  else if (h < 18) g = '下午好，专注工作 ✨';
  else if (h < 22) g = '晚上好，辛苦了 ☕';
  else g = '夜深了，早点休息 🌙';
  caidQs('#clockGreeting').textContent = g;
}

// ============ Clock formatters (used by updateClock) ============
function pad2(n){ return n<10 ? '0'+n : ''+n; }
function fmtTime(d){ return pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds()); }
function fmtDate(d){ var w=['日','一','二','三','四','五','六'][d.getDay()]; return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日 周'+w; }

// ============ Default Data ============
const DEFAULT_SHORTCUTS = [];

const DEFAULT_SNIPPETS = [];

const DEFAULT_LLM_CFG = {
  provider: 'dashscope',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen-plus',
  temperature: 0.7,
};

// 默认配置（副驾相关字段已废弃，保留以防旧数据兼容）
const DEFAULT_PA_CFG = {
  mode: 'demo',           // 'demo' = 免费 LLM | 'custom' = 自定义 Key
  provider: 'dashscope',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen-turbo',
  language: 'zh-CN',
};

// ============ App State ============
const state = {
  shortcuts: LS.get('shortcuts', DEFAULT_SHORTCUTS),
  searchHistory: LS.get('searchHistory', []),
  todos: LS.get('todos', []),
  uiPrefs: LS.get('uiPrefs', { collapsed: {} }),
  llmCfg: LS.get('llmCfg', DEFAULT_LLM_CFG),
  paCfg: LS.get('paCfg', DEFAULT_PA_CFG),
  searchMode: 'bing',
  suggestionIdx: -1,
  suggestions: [],
  editingShortcut: null,
  editingSnippet: null,
};

// ============ Shortcuts (Top Blue Bar) ============
function renderShortcuts() {
  const bar = caidQs('#shortcutBar');
  bar.innerHTML = '';

  // 空状态提示
  if (state.shortcuts.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'shortcut-empty-hint';
    hint.innerHTML = `<i data-lucide="sparkles" style="width:16px;height:16px;color:var(--accent);"></i>暂无快捷入口，点击右侧 <b>添加</b> 按钮自定义常用站点`;
    bar.appendChild(hint);
  }

  state.shortcuts.forEach((sc, i) => {
    const el = document.createElement('div');
    el.className = 'shortcut';
    el.draggable = true;
    el.dataset.id = sc.id;
    el.dataset.idx = i;
    // 用户自定义颜色胶囊渐变（与CSS风格一致：三段渐变+内阴影）
    const c = sc.color || '#5b8dff';
    const c2 = darken(c, 0.16);
    const c3 = darken(c, 0.3);
    el.style.background = `linear-gradient(135deg, ${c} 0%, ${c2} 55%, ${c3} 100%)`;
    el.innerHTML = `
      <span class="shortcut-icon"><i data-lucide="${sc.icon || 'globe'}"></i></span>
      <span class="shortcut-name">${escapeHtml(sc.name)}</span>
    `;
    el.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      window.open(sc.url, '_blank');
      addHistory(sc.name, 'nav', sc.url);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, [
        { icon: 'external-link', label: '在新标签打开', action: () => window.open(sc.url, '_blank') },
        { icon: 'edit', label: '编辑', action: () => openShortcutModal(sc) },
        { icon: 'copy', label: '复制链接', action: () => { navigator.clipboard.writeText(sc.url); toast('链接已复制','success'); } },
        { sep: true },
        { icon: 'trash-2', label: '删除', danger: true, action: () => {
          if (confirm(`确认删除快捷入口「${sc.name}」？`)) {
            state.shortcuts = state.shortcuts.filter(s => s.id !== sc.id);
            LS.set('shortcuts', state.shortcuts);
            renderShortcuts();
            toast('已删除','success');
          }
        }},
      ]);
    });
    // Drag & Drop
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.setData('text/plain', sc.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const dragId = e.dataTransfer.getData('text/plain');
      const from = state.shortcuts.findIndex(s => s.id === dragId);
      const to = state.shortcuts.findIndex(s => s.id === sc.id);
      if (from === -1 || to === -1 || from === to) return;
      const [moved] = state.shortcuts.splice(from, 1);
      state.shortcuts.splice(to, 0, moved);
      LS.set('shortcuts', state.shortcuts);
      renderShortcuts();
    });
    bar.appendChild(el);
  });

  // Add button
  const add = document.createElement('div');
  add.className = 'shortcut shortcut-add';
  add.innerHTML = `
    <span class="shortcut-icon"><i data-lucide="plus"></i></span>
    <span class="shortcut-name">添加</span>
  `;
  add.addEventListener('click', () => openShortcutModal());

  // Settings & top-right controls
  const ctrl = document.createElement('div');
  ctrl.className = 'topbar-controls';
  ctrl.innerHTML = `
    <button class="icon-btn" id="btnSetHome" title="设为首页"><i data-lucide="home"></i></button>
    <button class="icon-btn" id="btnSettings" title="设置"><i data-lucide="settings"></i></button>
  `;
  bar.appendChild(add);
  bar.appendChild(ctrl);
  const btnSettings = ctrl.querySelector('#btnSettings');
  if (btnSettings) btnSettings.addEventListener('click', () => openModal('settingsModal', fillSettingsForm));
  const btnSetHome = ctrl.querySelector('#btnSetHome');
  if (btnSetHome) btnSetHome.addEventListener('click', openHomepageModal);
  refreshIcons();
}

function openShortcutModal(sc = null) {
  state.editingShortcut = sc;
  caidQs('#shortcutModalTitle').textContent = sc ? '编辑快捷入口' : '添加快捷入口';
  caidQs('#scName').value = sc?.name || '';
  caidQs('#scIcon').value = sc?.icon || '';
  caidQs('#scUrl').value = sc?.url || '';
  caidQs('#scColor').value = sc?.color || '#58a6ff';
  openModal('shortcutModal');
}

caidQs('#saveShortcutBtn').addEventListener('click', () => {
  const name = caidQs('#scName').value.trim();
  let url = caidQs('#scUrl').value.trim();
  if (!name) return toast('请输入名称','warn');
  if (!url) return toast('请输入 URL','warn');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const sc = {
    id: state.editingShortcut?.id || uid(),
    name,
    url,
    icon: caidQs('#scIcon').value.trim() || 'globe',
    color: caidQs('#scColor').value,
  };
  if (state.editingShortcut) {
    const i = state.shortcuts.findIndex(s => s.id === sc.id);
    if (i >= 0) state.shortcuts[i] = sc;
  } else {
    state.shortcuts.push(sc);
  }
  LS.set('shortcuts', state.shortcuts);
  renderShortcuts();
  closeModal('shortcutModal');
  toast('已保存','success');
});

// ============ Context Menu ============
function showCtxMenu(x, y, items) {
  const menu = caidQs('#ctxMenu');
  menu.innerHTML = '';
  items.forEach(it => {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      menu.appendChild(s);
    } else {
      const el = document.createElement('div');
      el.className = 'ctx-item' + (it.danger ? ' danger' : '');
      el.innerHTML = `<i data-lucide="${it.icon}"></i><span>${it.label}</span>`;
      el.addEventListener('click', () => { hideCtxMenu(); it.action(); });
      menu.appendChild(el);
    }
  });
  menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - items.length * 34) + 'px';
  menu.classList.add('open');
  refreshIcons();
  setTimeout(() => document.addEventListener('click', hideCtxMenu, { once: true }), 0);
}
function hideCtxMenu() { caidQs('#ctxMenu').classList.remove('open'); }

// ============ Modals ============
function openModal(id, onOpen) {
  const m = caidQs('#' + id);
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (onOpen) onOpen();
  refreshIcons();
}
function closeModal(id) {
  caidQs('#' + id).classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) {
    const modal = e.target.closest('.modal-backdrop');
    if (modal) closeModal(modal.id);
  }
  if (e.target.matches('.modal-backdrop')) closeModal(e.target.id);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-backdrop.open');
    if (open) { closeModal(open.id); e.preventDefault(); }
  }
});

// 设为首页 / 新标签页弹窗（扩展内提示新标签已被接管，网页版则提供可复制的地址）
function openHomepageModal() {
  var urlEl = document.getElementById('homeUrl');
  if (urlEl) {
    var inExt = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    urlEl.textContent = inExt ? '（CAID 扩展已接管新标签页，开新标签即为本工作台）' : 'https://graduate.dpdns.org/';
  }
  var copyBtn = document.getElementById('copyHomeUrl');
  if (copyBtn && !copyBtn.dataset.bound) {
    copyBtn.dataset.bound = '1';
    copyBtn.addEventListener('click', function () {
      var url = (document.getElementById('homeUrl') || {}).textContent || 'https://graduate.dpdns.org/';
      var text = url.indexOf('http') === 0 ? url : 'https://graduate.dpdns.org/';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('已复制主页地址', 'success'); })
          .catch(function () { toast('复制失败', 'error'); });
      } else { toast('复制失败：浏览器不支持', 'error'); }
    });
  }
  // 按浏览器显示正确的设置入口（Edge 与 Chrome 的 settings URL 不同）
  var homeSteps = document.getElementById('homeSteps');
  if (homeSteps) {
    if (/Edg\//.test(navigator.userAgent)) {
      homeSteps.innerHTML =
        '<li>地址栏输入 <code>edge://settings/startHome</code> 打开「开始、主页和新建选项卡页」</li>' +
        '<li>开启<b>显示主页按钮</b>，并把主页设为上面的地址</li>' +
        '<li>同一页的<b>新建选项卡页</b>已被 CAID 扩展自动接管（若已安装扩展），开新标签即为工作台</li>' +
        '<li>若还想让<b>启动时</b>打开本页：地址栏输入 <code>edge://settings/startup</code> → 「打开特定页面或一组页面」→ 添加上面的地址</li>';
    } else {
      homeSteps.innerHTML =
        '<li>地址栏输入 <code>chrome://settings/appearance</code> 打开「外观」</li>' +
        '<li>开启<b>显示主页按钮</b>，并把主页设为上面的地址</li>' +
        '<li>地址栏输入 <code>chrome://settings/onStartup</code> → 选择「打开特定网页或一组网页」，添加上面的地址</li>' +
        '<li>若已安装 CAID 扩展：新标签页已被自动接管为本工作台，开新标签即为工作台</li>';
    }
  }
  openModal('homepageModal');
}

// Settings Tabs
caidQs('#settingsTabs').addEventListener('click', (e) => {
  const t = e.target.closest('.modal-tab');
  if (!t) return;
  caidQsa('#settingsTabs .modal-tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const name = t.dataset.tab;
  caidQsa('.settings-panel').forEach(p => p.style.display = p.dataset.panel === name ? '' : 'none');
});

// ============ Search Engine ============
const searchInput = caidQs('#searchInput');
const suggestionsEl = caidQs('#suggestions');

async function fetchBingSuggestions(q) {
  return new Promise((resolve) => {
    const cbName = '__bing_cb_' + uid();
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup(); resolve([]);
    }, 1500);
    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();
    }
    window[cbName] = (data) => {
      try {
        const results = (data?.AS?.Results || []).map(r => r.Text).filter(Boolean);
        cleanup(); resolve(results);
      } catch(e) { cleanup(); resolve([]); }
    };
    script.onerror = () => { cleanup(); resolve([]); };
    script.src = `https://api.bing.com/qsonhs.aspx?type=cb&q=${encodeURIComponent(q)}&cb=${cbName}`;
    document.head.appendChild(script);
  });
}

const highlightMatch = (text, query) => {
  if (!query) return escapeHtml(text);
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  return escapeHtml(text).replace(re, m => `<b>${m}</b>`);
};

async function updateSuggestions() {
  const q = searchInput.value.trim();
  state.suggestions = [];
  state.suggestionIdx = -1;
  if (!q) {
    // Show recent history
    const recent = state.searchHistory.slice(0, 5);
    if (recent.length === 0) { suggestionsEl.classList.remove('open'); return; }
    const html = `
      <div class="suggestions-group-label">最近搜索</div>
      ${recent.map((h, i) => `
        <div class="suggestion-item" data-idx="${i}">
          <span class="suggestion-icon"><i data-lucide="clock"></i></span>
          <span class="suggestion-text">${escapeHtml(h.query)}</span>
          <span class="suggestion-tag ${h.mode === 'bing' ? '' : h.mode === 'ai' ? 'green' : 'blue'}">${historyModeLabel(h.mode)}</span>
        </div>
      `).join('')}
    `;
    suggestionsEl.innerHTML = html;
    state.suggestions = recent.map(h => ({ text: h.query, type: 'history', mode: h.mode }));
    suggestionsEl.classList.add('open');
    refreshIcons();
    return;
  }
  // Bing + local history in parallel
  const qLower = q.toLowerCase();
  const [bing, localH] = await Promise.all([
    fetchBingSuggestions(q),
    Promise.resolve(state.searchHistory.filter(h => h.query.toLowerCase().includes(qLower)).slice(0, 5).map(h => h.query)),
  ]);
  // Dedup & build list
  const seen = new Set();
  const groups = [];
  const push = (text, type, tag, tagCls, extra = {}) => {
    const k = text.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    state.suggestions.push({ text, type, ...extra });
    groups.push({ text, type, tag, tagCls });
  };
  localH.forEach(h => push(h, 'history', '历史', 'blue'));
  bing.forEach(b => push(b, 'bing', 'Bing', ''));
  if (groups.length === 0) { suggestionsEl.classList.remove('open'); return; }
  // Render
  const byType = {};
  groups.forEach(g => { (byType[g.type] ||= []).push(g); });
  const labelMap = { history: '历史匹配', bing: 'Bing 建议' };
  let html = '';
  let i = 0;
  Object.entries(byType).forEach(([type, items]) => {
    html += `<div class="suggestions-group-label">${labelMap[type] || type}</div>`;
    items.forEach(g => {
      const icon = g.type === 'history' ? 'clock' : 'search';
      html += `
        <div class="suggestion-item" data-idx="${i}">
          <span class="suggestion-icon"><i data-lucide="${icon}"></i></span>
          <span class="suggestion-text">${highlightMatch(g.text, q)}</span>
          ${g.tag ? `<span class="suggestion-tag ${g.tagCls}">${g.tag}</span>` : ''}
        </div>`;
      i++;
    });
  });
  suggestionsEl.innerHTML = html;
  suggestionsEl.classList.add('open');
  refreshIcons();
}

const debouncedSuggest = debounce(updateSuggestions, 200);
searchInput.addEventListener('input', () => {
  debouncedSuggest();
  updateIntentHint();
});
searchInput.addEventListener('focus', () => { updateSuggestions(); updateIntentHint(); });
caidQs('#searchGoBtn').addEventListener('click', () => executeSearch(searchInput.value));
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrapper')) suggestionsEl.classList.remove('open');
});

suggestionsEl.addEventListener('click', (e) => {
  const item = e.target.closest('.suggestion-item');
  if (!item) return;
  const i = +item.dataset.idx;
  const s = state.suggestions[i];
  if (!s) return;
  searchInput.value = s.text;
  executeSearch(s.text);
});

// Keyboard nav
searchInput.addEventListener('keydown', (e) => {
  const items = caidQsa('.suggestion-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!suggestionsEl.classList.contains('open')) { updateSuggestions(); return; }
    state.suggestionIdx = Math.min(state.suggestionIdx + 1, items.length - 1);
    updateSugSelection(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.suggestionIdx = Math.max(state.suggestionIdx - 1, -1);
    updateSugSelection(items);
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    cycleSearchMode();
  } else if (e.key === 'Escape') {
    suggestionsEl.classList.remove('open');
    searchInput.value = '';
    caidQs('#intentHint').textContent = '';
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const selected = state.suggestionIdx >= 0 ? state.suggestions[state.suggestionIdx] : null;
    if (!e.ctrlKey && selected) {
      searchInput.value = selected.text;
      if (selected.type === 'bookmark' && selected.url) {
        window.open(selected.url, '_blank');
        addHistory(selected.text, 'nav', selected.url);
        return;
      }
      executeSearch(selected.text);
    } else {
      executeSearch(searchInput.value.trim());
    }
  }
});
function updateSugSelection(items) {
  items.forEach((it, i) => it.classList.toggle('active', i === state.suggestionIdx));
  if (state.suggestionIdx >= 0) items[state.suggestionIdx]?.scrollIntoView({ block: 'nearest' });
}

// ============ Mode Bar ============
caidQsa('.mode-pill').forEach(p => {
  p.addEventListener('click', () => setSearchMode(p.dataset.mode));
});
function setSearchMode(m) {
  state.searchMode = m;
  caidQsa('.mode-pill').forEach(p => p.classList.toggle('active', p.dataset.mode === m));
  updateIntentHint();
}
function cycleSearchMode() {
  const order = ['ai-ans', 'bing'];
  const cur = order.indexOf(state.searchMode);
  setSearchMode(order[(cur + 1) % order.length]);
}

// ============ Execute Search ============
function executeSearch(q) {
  if (!q) return;
  suggestionsEl.classList.remove('open');
  state.suggestionIdx = -1;
  const trimmed = q.trim();
  // URL 直接打开
  if (/^(https?:\/\/|www\.)/i.test(trimmed) || /^[\w-]+\.(com|cn|net|org|io|dev|ai|app|co|me|xyz|top)(\/|$)/i.test(trimmed)) {
    let url = trimmed;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    window.open(url, '_blank');
    addHistory(trimmed, 'nav', url);
    searchInput.value = '';
    caidQs('#intentHint').textContent = '';
    return;
  }
  // 命令识别："帮我搜一下 XXX"
  const searchCmd = trimmed.match(/^(?:帮我搜一下|帮我搜|搜一下|搜索)\s*(.+)/i);
  if (searchCmd) {
    const query = searchCmd[1].trim();
    runAIAnswer(query, true); // true = 搜索模式
    addHistory(query, 'ai');
    searchInput.value = '';
    caidQs('#intentHint').textContent = '';
    return;
  }
  // 命令识别："保存 XXX" 快捷保存代码片段
  const saveCmd = trimmed.match(/^(?:保存|存一下|保存片段)\s*([\s\S]+)/i);
  if (saveCmd) {
    const text = saveCmd[1].trim();
    openSnippetModal(null, { title: '快速保存', code: text, lang: 'text' });
    searchInput.value = '';
    caidQs('#intentHint').textContent = '';
    toast('已打开保存面板', 'info');
    return;
  }
  const mode = state.searchMode;
  if (mode === 'bing') {
    window.open('https://www.bing.com/search?q=' + encodeURIComponent(trimmed), '_blank');
    addHistory(trimmed, 'bing');
  } else {
    // ai-ans
    runAIAnswer(trimmed);
    addHistory(trimmed, 'ai');
  }
  searchInput.value = '';
  caidQs('#intentHint').textContent = '';
}

function updateIntentHint() {
  const q = searchInput.value.trim();
  const hint = caidQs('#intentHint');
  if (!q) { hint.innerHTML = ''; return; }
  // 命令识别
  if (/^(?:帮我搜一下|帮我搜|搜一下|搜索)\s/i.test(q)) {
    hint.innerHTML = `<b style="color:var(--accent2);">AI 搜索</b> · AI 先给结论再附链接`;
    return;
  }
  if (/^(?:保存|存一下|保存片段)\s/i.test(q)) {
    hint.innerHTML = `<b style="color:var(--purple);">保存片段</b> · 快速保存到代码片段`;
    return;
  }
  const map = { 'ai-ans':'AI 回答模式', 'bing':'Bing 搜索模式' };
  hint.innerHTML = `当前模式：<b>${map[state.searchMode]||''}</b> · 按 <kbd style="font-size:10px;padding:1px 5px;background:var(--bg3);border-radius:3px;">Tab</kbd> 切换`;
}

// ============ History ============
function addHistory(query, mode, extra = '') {
  state.searchHistory.unshift({ id: uid(), query, mode, extra, timestamp: Date.now() });
  state.searchHistory = state.searchHistory.slice(0, 200);
  LS.set('searchHistory', state.searchHistory);
  try { db.history.add({ query, mode, extra, timestamp: Date.now() }).catch(()=>{}); } catch(e){}
  renderHistory();
  updateCounts();
}
function historyModeLabel(m) {
  return { bing:'Bing', ai:'AI回答', nav:'导航' }[m] || m;
}
function renderHistory(filter = '') {
  const list = caidQs('#historyList');
  let items = state.searchHistory;
  if (filter) {
    const f = filter.toLowerCase();
    items = items.filter(h => h.query.toLowerCase().includes(f));
  }
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><i data-lucide="history"></i>暂无搜索记录</div>`;
    refreshIcons();
    return;
  }
  list.innerHTML = items.slice(0, 100).map(h => `
    <div class="history-item" data-id="${h.id}">
      <span class="history-time">${fmtHistoryTime(h.timestamp)}</span>
      <span class="history-query" title="${escapeHtml(h.query)}">${escapeHtml(h.query)}</span>
      <span class="history-mode ${h.mode}">${historyModeLabel(h.mode)}</span>
      <button class="history-del" title="删除"><i data-lucide="x"></i></button>
    </div>
  `).join('');
  list.querySelectorAll('.history-item').forEach(el => {
    const id = el.dataset.id;
    const h = state.searchHistory.find(x => x.id === id);
    if (!h) return;
    el.querySelector('.history-query').addEventListener('click', (e) => {
      e.stopPropagation();
      searchInput.value = h.query;
      searchInput.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    el.addEventListener('click', () => {
      if (h.mode === 'nav' && h.extra) {
        window.open(h.extra, '_blank');
      } else {
        searchInput.value = h.query;
        searchInput.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    el.querySelector('.history-del').addEventListener('click', (e) => {
      e.stopPropagation();
      state.searchHistory = state.searchHistory.filter(x => x.id !== id);
      LS.set('searchHistory', state.searchHistory);
      renderHistory(filter);
      updateCounts();
    });
  });
  refreshIcons();
}
caidQs('#historySearch').addEventListener('input', (e) => renderHistory(e.target.value));
caidQs('#clearHistoryBtn').addEventListener('click', () => {
  if (!confirm('确认清空所有搜索历史？此操作不可恢复。')) return;
  state.searchHistory = [];
  LS.set('searchHistory', []);
  db.history.clear().catch(()=>{});
  renderHistory();
  updateCounts();
  toast('已清空','success');
});

// ============ AI Answer ============
async function runAIAnswer(q, isSearch = false) {
  openAnswerPanel();
  const body = caidQs('#answerBody');
  const cfg = state.llmCfg;
  const providerLabel = { dashscope:'通义千问', openai:'OpenAI', ollama:'Ollama', custom:'自定义' };
  caidQs('#answerModel').textContent = (isSearch ? 'AI 搜索 · ' : '') + (providerLabel[cfg.provider] || 'LLM');
  body.innerHTML = `<div style="display:flex;align-items:center;gap:10px;color:var(--muted);"><i data-lucide="loader-2" style="animation:spin 1s linear infinite;"></i>${isSearch ? '正在搜索并总结…' : '正在生成回答…'}</div>`;
  refreshIcons();

  // 搜索模式：无 API Key 时直接回退 Bing + 提示
  if (isSearch && !cfg.apiKey) {
    body.innerHTML = `
      <div style="padding:14px;background:rgba(255,180,84,0.08);border:1px solid rgba(255,180,84,0.2);border-radius:10px;color:var(--warn);margin-bottom:12px;">
        <b>未配置 LLM API Key</b>，无法执行 AI 搜索总结。
      </div>
      <div style="color:var(--muted);font-size:13px;line-height:1.8;">
        你可以：
        <ol style="margin-left:18px;">
          <li>前往 <b>设置 → AI 回答</b> 配置 API Key 后重试</li>
          <li>按 <kbd style="font-size:11px;padding:1px 5px;background:var(--bg3);border-radius:3px;">Tab</kbd> 切换到 Bing 模式直接搜索</li>
        </ol>
      </div>
      <div style="margin-top:16px;">
        <button class="btn primary" onclick="window.open('https://www.bing.com/search?q=${encodeURIComponent(q)}','_blank')">
          <i data-lucide="external-link" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:4px;"></i>
          用 Bing 搜索「${escapeHtml(q)}」
        </button>
      </div>`;
    refreshIcons();
    return;
  }

  if (!cfg.apiKey) {
    // Rule engine fallback
    body.innerHTML = ruleEngineFallback(q);
    if (window.hljs) caidQsa('#answerBody pre code').forEach(block => hljs.highlightElement(block));
    addSaveButtons(body);
    const af = caidQs('#answerFooter');
    if (af) af.innerHTML = '<span class="ans-tok-badge" style="background:rgba(248,81,73,0.12);color:#f87171;">无 API Key</span><span>本地规则引擎兜底</span>';
    return;
  }
  // Call LLM
  const ansFooter = caidQs('#answerFooter');
  if (ansFooter) ansFooter.innerHTML = '';
  try {
    let url = cfg.baseUrl + '/chat/completions';
    const sysPrompt = isSearch
      ? `你是一个搜索助手。用户想搜索某个主题，请：
1. 先用一句话给出结论/概述
2. 然后补充关键要点（2-4 条）
3. 最后附上 2-4 个参考链接（用 Markdown 格式，标题+URL）
回答简洁、信息密度高。代码块用 Markdown 标注语言。`
      : '你是一个帮助程序员的助手。回答简洁，代码块使用 Markdown 标注语言，必要时给出示例代码。';
    const body_data = {
      model: cfg.model,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: q }
      ],
      temperature: +cfg.temperature || 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey,
    };
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body_data) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().slice(0,200)}`);
    const reader = resp.body?.getReader();
    if (!reader) throw new Error('无流式响应');
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullMd = '';
    let usage = null;
    body.innerHTML = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const c = j?.choices?.[0]?.delta?.content;
          if (c) {
            fullMd += c;
            body.innerHTML = marked.parse(fullMd);
            body.scrollTop = body.scrollHeight;
          }
          // 捕获 usage（流式最后一帧或非流式响应里携带）
          if (j?.usage) usage = j.usage;
        } catch(e){}
      }
    }
    if (!fullMd) throw new Error('无返回内容');
    body.innerHTML = marked.parse(fullMd);
    if (window.hljs) caidQsa('#answerBody pre code').forEach(block => hljs.highlightElement(block));
    // 为代码块和链接添加"保存"按钮
    addSaveButtons(body);
    // 显示 token 消耗
    if (ansFooter && usage && usage.total_tokens) {
      ansFooter.innerHTML = '<span class="ans-tok-badge">'+escapeHtml(cfg.model||'')+'</span>'
        + '<span>Token: '+usage.total_tokens+' (↑'+(usage.prompt_tokens||0)+' ↓'+(usage.completion_tokens||0)+')</span>';
    } else if (ansFooter && cfg.model) {
      ansFooter.innerHTML = '<span class="ans-tok-badge">'+escapeHtml(cfg.model)+'</span>';
    }
  } catch (e) {
    body.innerHTML = `
      <div style="padding:14px;background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.2);border-radius:8px;color:var(--danger);">
        <b>调用 LLM 失败</b><br>
        <span style="color:var(--muted);font-size:12px;">${escapeHtml(e.message || String(e))}</span><br><br>
        <span style="color:var(--muted);font-size:13px;">可能原因：</span>
        <ul style="margin-left:18px;color:var(--muted);font-size:13px;">
          <li>未配置正确的 API Key（设置 → AI 回答）</li>
          <li>Base URL 不可达或模型名称错误</li>
          <li>当前为 file:// 协议被浏览器 CORS 拦截（建议部署到静态托管）</li>
        </ul>
      </div>
      <hr style="border-color:var(--rule);margin:16px 0;">
      <div style="color:var(--muted);font-size:12px;margin-bottom:8px;">🔽 以下为本地规则引擎兜底回答（无 LLM）：</div>
      ${ruleEngineFallback(q)}
    `;
    if (window.hljs) caidQsa('#answerBody pre code').forEach(block => hljs.highlightElement(block));
    addSaveButtons(body);
  }
}

// ============ 为 AI 回答添加"保存"按钮 ============
function addSaveButtons(container) {
  // 为每个代码块添加"保存到片段"按钮
  container.querySelectorAll('pre').forEach((pre, i) => {
    if (pre.querySelector('.pa-save-bar')) return; // 避免重复添加
    const code = pre.querySelector('code');
    if (!code) return;
    const lang = (code.className.match(/language-(\w+)/) || [])[1] || 'text';
    const codeText = code.textContent;
    const bar = document.createElement('div');
    bar.className = 'pa-save-bar';
    bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-bottom:none;border-radius:8px 8px 0 0;font-size:12px;color:var(--muted);';
    bar.innerHTML = `<span style="font-family:monospace;">${escapeHtml(lang)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.cssText = 'padding:3px 10px;font-size:12px;height:auto;';
    btn.innerHTML = `<i data-lucide="bookmark-plus" style="width:12px;height:12px;display:inline;vertical-align:middle;margin-right:3px;"></i>保存到片段`;
    btn.addEventListener('click', () => {
      // 从代码内容推断标题
      let title = 'AI 回答片段';
      const firstLine = codeText.split('\n')[0].trim();
      if (firstLine.length > 0 && firstLine.length <= 50) title = firstLine.replace(/^(function|const|class|def|import|export)\s+/, '').slice(0, 40);
      openSnippetModal(null, { title, code: codeText, lang });
      toast('已打开保存面板', 'info');
    });
    bar.appendChild(btn);
    pre.style.borderRadius = '0 0 8px 8px';
    pre.parentNode.insertBefore(bar, pre);
  });
  // 为链接列表添加"保存全部链接"按钮（如果有多个链接）
  const links = container.querySelectorAll('a[href]');
  if (links.length >= 2) {
    const linkBar = document.createElement('div');
    linkBar.style.cssText = 'margin-top:12px;padding:8px 12px;background:rgba(91,141,255,0.06);border:1px solid rgba(91,141,255,0.15);border-radius:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    const saveAllBtn = document.createElement('button');
    saveAllBtn.className = 'btn primary';
    saveAllBtn.style.cssText = 'padding:4px 12px;font-size:12px;height:auto;';
    saveAllBtn.innerHTML = `<i data-lucide="bookmark-plus" style="width:12px;height:12px;display:inline;vertical-align:middle;margin-right:3px;"></i>保存全部链接到片段`;
    saveAllBtn.addEventListener('click', () => {
      const md = Array.from(links).map(a => `- [${escapeHtml(a.textContent)}](${a.href})`).join('\n');
      openSnippetModal(null, { title: 'AI 回答参考链接', code: md, lang: 'markdown' });
      toast('已打开保存面板', 'info');
    });
    linkBar.appendChild(saveAllBtn);
    container.appendChild(linkBar);
  }
  refreshIcons();
}

function ruleEngineFallback(q) {
  const ql = q.toLowerCase();
  let ans = '';
  if (/debounce|防抖/.test(ql)) {
    ans = `## 防抖函数 (Debounce)

防抖：事件触发后，**延迟一段时间**才执行。若该段时间内再次触发，则重新计时。常用于搜索框输入、窗口 resize 等场景。

\`\`\`javascript
function debounce(fn, wait = 300) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

// 使用
const onSearch = debounce((val) => {
  console.log('搜索:', val);
}, 300);
\`\`\`

> 💡 建议在"代码片段"组件中保存常用工具函数，随时查找。`;
  } else if (/throttle|节流/.test(ql)) {
    ans = `## 节流函数 (Throttle)

节流：**固定频率**执行函数。若单位时间内多次触发，只有第一次生效。常用于滚动监听、按钮防重复点击。

\`\`\`javascript
function throttle(fn, wait = 300) {
  let last = 0;
  return function(...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    }
  };
}
\`\`\`

**防抖 vs 节流**：防抖是"等用户安静下来再执行"，节流是"按节奏匀速执行"。`;
  } else if (/promise|async|await|异步/.test(ql)) {
    ans = `## JavaScript 异步编程

### Promise 基础
\`\`\`javascript
function fetchData() {
  return new Promise((resolve, reject) => {
    setTimeout(() => resolve({ data: 'ok' }), 1000);
  });
}
fetchData().then(res => console.log(res)).catch(err => console.error(err));
\`\`\`

### async/await (推荐)
\`\`\`javascript
async function main() {
  try {
    const res = await fetchData();
    console.log(res);
  } catch (err) {
    console.error(err);
  }
}
\`\`\`

### 并行执行
\`\`\`javascript
const [a, b] = await Promise.all([taskA(), taskB()]);
\`\`\``;
  } else if (/fetch|axios|请求|api|http/.test(ql)) {
    ans = `## Fetch API 调用示例

\`\`\`javascript
async function request(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

// GET
const users = await request('/api/users');

// POST
const created = await request('/api/users', {
  method: 'POST',
  body: JSON.stringify({ name: '张三' }),
});
\`\`\`

> ⚠️ 若使用配置了 API Key 的外部 LLM，此栏会显示完整的 AI 回答。请在「设置 → AI 模型」中配置。`;
  } else {
    ans = `## 关于「${escapeHtml(q)}」

> ⚠️ **当前为本地规则引擎的兜底回答**。未检测到有效的 LLM API Key 配置。

### 获得完整 AI 回答

请点击右上角 **⚙️ 设置 → AI 模型**，填入：

| 项目 | 建议值 |
|---|---|
| Provider | DashScope (通义千问) |
| Base URL | \`https://dashscope.aliyuncs.com/compatible-mode/v1\` |
| API Key | 前往 [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com/) 获取 |
| Model | \`qwen-plus\` 或 \`qwen-turbo\` |

保存后即可获得高质量 AI 回答。

### 本地快速搜索

- **Bing 搜索**：按 \`Tab\` 切换到 Bing 模式后再 Enter
- **代码片段**：在「代码片段」中搜索相关代码`;
  }
  return ans;
}

function openAnswerPanel() { caidQs('#answerPanel').classList.add('open'); }
caidQs('#closeAnswer').addEventListener('click', () => caidQs('#answerPanel').classList.remove('open'));

// ============ Snippets ============
// 语义搜索：中英文同义词映射表
const SYNONYM_MAP = {
  '防抖': ['debounce', '防抖', 'delay'],
  '节流': ['throttle', '节流', 'throttle'],
  '异步': ['async', 'await', 'promise', '异步', 'then', 'resolve'],
  '请求': ['fetch', 'axios', 'request', '请求', 'http', 'xhr', 'ajax'],
  '路由': ['router', 'route', '路由', 'navigation', 'navigate'],
  '状态': ['state', 'store', '状态', 'redux', 'vuex', 'pinia'],
  '钩子': ['hook', 'hooks', 'useEffect', 'useMemo', 'useCallback', 'useState', '钩子'],
  '组件': ['component', '组件', 'vue', 'react', 'svelte'],
  '样式': ['css', 'style', '样式', 'scss', 'tailwind', 'styled'],
  '深拷贝': ['deep', 'clone', '深拷贝', 'copy', 'structuredClone'],
  '排序': ['sort', '排序', 'order', 'arrange'],
  '加密': ['crypto', 'encrypt', '加密', 'hash', 'md5', 'sha'],
  '正则': ['regex', 'regexp', '正则', 'match', 'pattern', 'replace'],
  '存储': ['storage', 'localstorage', '存储', 'cookie', 'sessionstorage', 'indexeddb'],
  '时间': ['date', 'time', '时间', 'moment', 'dayjs', 'format'],
  '工具': ['util', 'utils', '工具', 'helper', 'format'],
  '类型': ['type', 'typescript', '类型', 'interface', 'enum', 'generic'],
  '错误': ['error', '错误', 'catch', 'try', 'exception', 'throw'],
  '测试': ['test', '测试', 'jest', 'vitest', 'mocha', 'spec'],
  '动画': ['animation', '动画', 'transition', 'transform', 'keyframe'],
};
// 扩展搜索词：返回包含原词 + 同义词的数组
function expandQuery(q) {
  const ql = q.toLowerCase();
  const terms = new Set([ql, q]);
  for (const [cn, syns] of Object.entries(SYNONYM_MAP)) {
    if (ql.includes(cn) || syns.some(s => ql.includes(s.toLowerCase()))) {
      syns.forEach(s => terms.add(s.toLowerCase()));
    }
  }
  return Array.from(terms);
}
// 模糊匹配：Levenshtein 距离的简化版（判断是否有部分匹配）
function fuzzyMatch(text, query) {
  if (!text || !query) return false;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return true;
  // 允许 1 个字符的拼写错误（仅对长度 >= 4 的词）
  if (q.length >= 4) {
    for (let i = 0; i <= t.length - q.length; i++) {
      let mismatches = 0;
      for (let j = 0; j < q.length; j++) {
        if (t[i+j] !== q[j]) { mismatches++; if (mismatches > 1) break; }
      }
      if (mismatches <= 1) return true;
    }
  }
  return false;
}

async function renderSnippets(filter = '') {
  const list = caidQs('#snippetList');
  let items = await db.snippets.orderBy('createdAt').reverse().toArray().catch(() => []);
  if (filter) {
    // 语义搜索：扩展关键词 + 模糊匹配
    const terms = expandQuery(filter);
    items = items.filter(s => {
      const haystack = [
        (s.title||''), (s.code||''), (s.lang||''),
        ...(s.tags||[])
      ].join(' ').toLowerCase();
      // 任一扩展词命中即匹配
      return terms.some(term => haystack.includes(term) || fuzzyMatch(haystack, term));
    });
  }
  caidQs('#snippetCount').textContent = items.length;
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><i data-lucide="file-code"></i>暂无代码片段</div>`;
    refreshIcons();
    return;
  }
  list.innerHTML = items.map(s => `
    <div class="snippet-item" data-id="${s.id}">
      <div class="snippet-head">
        <span class="snippet-lang">${escapeHtml(s.lang||'text')}</span>
        <span class="snippet-title">${escapeHtml(s.title)}</span>
        <span class="snippet-meta">${fmtHistoryTime(s.createdAt)}</span>
        <div class="snippet-actions">
          <button class="icon-btn-xs" title="复制代码" data-act="copy"><i data-lucide="copy"></i></button>
          <button class="icon-btn-xs" title="编辑" data-act="edit"><i data-lucide="edit"></i></button>
          <button class="icon-btn-xs" title="删除" data-act="del" style="color:var(--danger);"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
      <div class="snippet-code">
        <pre><code class="language-${escapeHtml(s.lang||'text')}">${escapeHtml(s.code||'')}</code></pre>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.snippet-item').forEach(el => {
    const id = el.dataset.id;
    const item = items.find(s => s.id == id);
    if (!item) return;
    el.querySelector('.snippet-head').addEventListener('click', (e) => {
      if (e.target.closest('.icon-btn-xs')) return;
      el.classList.toggle('open');
      if (el.classList.contains('open') && window.hljs) {
        const code = el.querySelector('pre code');
        if (code) hljs.highlightElement(code);
      }
    });
    el.querySelector('[data-act="copy"]').addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(item.code||'').then(() => toast('已复制到剪贴板','success'));
    });
    el.querySelector('[data-act="edit"]').addEventListener('click', (e) => { e.stopPropagation(); openSnippetModal(item); });
    el.querySelector('[data-act="del"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`删除代码片段「${item.title}」？`)) {
        db.snippets.delete(item.id).then(() => { renderSnippets(filter); updateCounts(); toast('已删除','success'); });
      }
    });
  });
  refreshIcons();
}
caidQs('#snippetSearch').addEventListener('input', (e) => renderSnippets(e.target.value));
caidQs('#addSnippetBtn').addEventListener('click', () => openSnippetModal());
function openSnippetModal(s = null, prefill = null) {
  state.editingSnippet = s;
  caidQs('#snippetModalTitle').textContent = s ? '编辑代码片段' : (prefill ? '保存代码片段' : '添加代码片段');
  caidQs('#snTitle').value = s?.title || prefill?.title || '';
  caidQs('#snLang').value = s?.lang || prefill?.lang || 'javascript';
  caidQs('#snTags').value = (s?.tags||[]).join(', ') || (prefill?.tags||[]).join(', ');
  caidQs('#snCode').value = s?.code || prefill?.code || '';
  openModal('snippetModal');
}
caidQs('#saveSnippetBtn').addEventListener('click', async () => {
  const title = caidQs('#snTitle').value.trim();
  const lang = caidQs('#snLang').value;
  const tags = caidQs('#snTags').value.split(/[,，]/).map(t => t.trim()).filter(Boolean);
  const code = caidQs('#snCode').value;
  if (!title) return toast('请输入标题','warn');
  if (!code) return toast('请输入代码','warn');
  if (state.editingSnippet) {
    await db.snippets.update(state.editingSnippet.id, { title, lang, tags, code });
  } else {
    await db.snippets.add({ id: uid(), title, lang, tags, code, createdAt: Date.now() });
  }
  closeModal('snippetModal');
  renderSnippets();
  updateCounts();
  toast('已保存','success');
});

// ============ Todos ============
function addTodoItem(text, priority = 'mid') {
  if (!text) return;
  state.todos.unshift({ id: uid(), text, done: false, priority, createdAt: Date.now() });
  LS.set('todos', state.todos);
  renderTodos();
  updateCounts();
}
function renderTodos(filter = '') {
  const list = caidQs('#todoList');
  let items = [...state.todos];
  if (filter) {
    const f = filter.toLowerCase();
    items = items.filter(t => t.text.toLowerCase().includes(f));
  }
  caidQs('#todoCount').textContent = items.length;
  const total = state.todos.length;
  const done = state.todos.filter(t => t.done).length;
  caidQs('#todoProgressText').textContent = `${done} / ${total}`;
  caidQs('#todoProgressFill').style.width = (total ? (done/total*100) : 0) + '%';
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><i data-lucide="check-square"></i>暂无待办任务，加一条试试？</div>`;
    refreshIcons();
    return;
  }
  const pLabel = { high:'高', mid:'中', low:'低' };
  list.innerHTML = items.map(t => `
    <div class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
      <div class="todo-check"><i data-lucide="check"></i></div>
      <div class="todo-text">${escapeHtml(t.text)}</div>
      <span class="todo-priority ${t.priority||'mid'}">${pLabel[t.priority||'mid']}</span>
      <button class="todo-del" title="删除"><i data-lucide="x"></i></button>
    </div>
  `).join('');
  list.querySelectorAll('.todo-item').forEach(el => {
    const id = el.dataset.id;
    const t = state.todos.find(x => x.id === id);
    if (!t) return;
    el.querySelector('.todo-check').addEventListener('click', (e) => {
      e.stopPropagation();
      t.done = !t.done;
      LS.set('todos', state.todos);
      renderTodos(filter);
    });
    el.querySelector('.todo-del').addEventListener('click', (e) => {
      e.stopPropagation();
      state.todos = state.todos.filter(x => x.id !== id);
      LS.set('todos', state.todos);
      renderTodos(filter);
      updateCounts();
    });
  });
  refreshIcons();
}
caidQs('#addTodoBtn').addEventListener('click', () => {
  const v = caidQs('#todoInput').value.trim();
  if (!v) return;
  addTodoItem(v, caidQs('#todoPriority').value);
  caidQs('#todoInput').value = '';
});
caidQs('#todoInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { caidQs('#addTodoBtn').click(); e.preventDefault(); }
});

// ============ Component Collapse ============
caidQsa('.comp-card').forEach(card => {
  const id = card.dataset.comp;
  if (state.uiPrefs.collapsed?.[id]) card.classList.add('collapsed');
  card.querySelector('.comp-header').addEventListener('click', () => {
    card.classList.toggle('collapsed');
    state.uiPrefs.collapsed = state.uiPrefs.collapsed || {};
    state.uiPrefs.collapsed[id] = card.classList.contains('collapsed');
    LS.set('uiPrefs', state.uiPrefs);
  });
});

// ============ Counts ============
async function updateCounts() {
  try {
    caidQs('#snippetCount').textContent = await db.snippets.count() || 0;
  } catch(e){}
  caidQs('#historyCount').textContent = state.searchHistory.length;
  caidQs('#todoCount').textContent = state.todos.length;
}

// ============ Settings ============
function fillSettingsForm() {
  const c = state.llmCfg;
  caidQs('#cfgProvider').value = c.provider || 'dashscope';
  caidQs('#cfgBaseUrl').value = c.baseUrl || '';
  caidQs('#cfgApiKey').value = c.apiKey || '';
  caidQs('#cfgModel').value = c.model || '';
  caidQs('#cfgTemp').value = c.temperature ?? 0.7;
  caidQs('#cfgProvider').dispatchEvent(new Event('change'));
}
caidQs('#cfgProvider').addEventListener('change', (e) => {
  const p = e.target.value;
  const presets = {
    dashscope: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
    custom: { baseUrl: '', model: '' },
  };
  const pr = presets[p];
  if (!caidQs('#cfgBaseUrl').value) caidQs('#cfgBaseUrl').value = pr.baseUrl;
  if (!caidQs('#cfgModel').value) caidQs('#cfgModel').value = pr.model;
});
caidQs('#saveSettingsBtn').addEventListener('click', () => {
  // AI 回答 LLM 配置
  state.llmCfg = {
    provider: caidQs('#cfgProvider').value,
    baseUrl: caidQs('#cfgBaseUrl').value.trim(),
    apiKey: caidQs('#cfgApiKey').value.trim(),
    model: caidQs('#cfgModel').value.trim(),
    temperature: parseFloat(caidQs('#cfgTemp').value) || 0.7,
  };
  LS.set('llmCfg', state.llmCfg);
  ConfigBackup.save('llmCfg', state.llmCfg);
  closeModal('settingsModal');
  toast('设置已保存','success');
});
caidQs('#testLLMBtn').addEventListener('click', async () => {
  const c = {
    provider: caidQs('#cfgProvider').value,
    baseUrl: caidQs('#cfgBaseUrl').value.trim(),
    apiKey: caidQs('#cfgApiKey').value.trim(),
    model: caidQs('#cfgModel').value.trim(),
  };
  if (!c.apiKey) return toast('请先填入 API Key','warn');
  const btn = caidQs('#testLLMBtn');
  const orig = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="loader-2" style="animation:spin 1s linear infinite;"></i>测试中…`;
  refreshIcons();
  try {
    const resp = await fetch(c.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+c.apiKey },
      body: JSON.stringify({ model: c.model, messages: [{role:'user',content:'ping，用一个字回答'}], max_tokens: 10 }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    toast('连接成功！✅','success');
  } catch (e) {
    toast('连接失败：' + (e.message||String(e)), 'error', 4000);
  } finally {
    btn.innerHTML = orig;
    refreshIcons();
  }
});

// Export
caidQs('#exportBtn').addEventListener('click', async () => {
  const out = { exportedAt: new Date().toISOString(), version: 1, localStorage: {}, indexedDB: {} };
  // localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && !k.startsWith('__bing_cb_')) out.localStorage[k] = localStorage.getItem(k);
  }
  // IndexedDB tables
  const tables = ['snippets','history','config'];
  for (const t of tables) {
    try { out.indexedDB[t] = await db[t].toArray(); } catch(e){}
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `caid_workbench_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('导出完成','success');
});
caidQs('#importBtn').addEventListener('click', () => caidQs('#importFile').click());
caidQs('#importFile').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (!confirm('导入将覆盖当前所有数据，确定继续？')) { e.target.value = ''; return; }
  const r = new FileReader();
  r.onload = async () => {
    try {
      const data = JSON.parse(r.result);
      if (data.localStorage) {
        Object.entries(data.localStorage).forEach(([k,v]) => localStorage.setItem(k, v));
      }
      if (data.indexedDB) {
        for (const [t, rows] of Object.entries(data.indexedDB)) {
          if (db[t] && Array.isArray(rows)) {
            await db[t].clear();
            if (rows.length) await db[t].bulkAdd(rows);
          }
        }
      }
      // Reload state
      state.shortcuts = LS.get('shortcuts', DEFAULT_SHORTCUTS);
      state.searchHistory = LS.get('searchHistory', []);
      state.todos = LS.get('todos', []);
      state.uiPrefs = LS.get('uiPrefs', { collapsed: {} });
      state.llmCfg = LS.get('llmCfg', DEFAULT_LLM_CFG);
      // Apply collapse state
      caidQsa('.comp-card').forEach(card => {
        const id = card.dataset.comp;
        card.classList.toggle('collapsed', !!state.uiPrefs.collapsed?.[id]);
      });
      renderShortcuts();
      renderHistory();
      renderTodos();
      renderSnippets();
      updateCounts();
      toast('导入成功！','success');
    } catch (err) {
      toast('导入失败：' + (err.message||String(err)), 'error');
    }
    e.target.value = '';
  };
  r.readAsText(f);
});
caidQs('#resetBtn').addEventListener('click', async () => {
  if (!confirm('⚠️ 此操作将清空全部本地数据（快捷入口、片段、历史、待办、配置）！确定继续？')) return;
  if (!confirm('⚠️ 再次确认：数据将被永久删除，不可恢复！')) return;
  localStorage.clear();
  try {
    await db.snippets.clear();
    await db.history.clear();
  } catch(e){}
  setTimeout(() => location.reload(), 400);
  toast('正在重置…');
});

// ============ Init ============
async function init() {
  // 配置恢复：如果 localStorage 丢失配置，从 IndexedDB 备份恢复
  state.llmCfg = await ConfigBackup.restoreIfMissing('llmCfg', state.llmCfg);
  state.paCfg = await ConfigBackup.restoreIfMissing('paCfg', state.paCfg);

  // Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Render everything
  renderShortcuts();
  renderHistory();
  renderTodos();
  await renderSnippets();
  updateCounts();

  // Icons
  if (window.lucide) lucide.createIcons();

  // Marked options
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
  }
}

init();

