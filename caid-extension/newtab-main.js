
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

// ============ 自定义确认弹窗（替代原生 confirm）============
function caidConfirm(opts) {
  return new Promise((resolve) => {
    if (typeof opts === 'string') opts = { message: opts };
    const dlg = caidQs('#caidConfirmDlg');
    if (!dlg) { resolve(window.confirm(opts.message || '')); return; } // 兜底：弹窗缺失时退回原生
    const titleEl = caidQs('#caidConfirmTitle');
    const msgEl = caidQs('#caidConfirmMsg');
    const okEl = caidQs('#caidConfirmOk');
    const cancelEl = caidQs('#caidConfirmCancel');
    titleEl.textContent = opts.title || '确认操作';
    msgEl.textContent = opts.message || '';
    okEl.textContent = opts.okText || '确认';
    cancelEl.textContent = opts.cancelText || '取消';
    okEl.classList.toggle('danger', !!opts.danger);
    // 头部图标（danger 时变红）
    let iconEl = titleEl.querySelector('i');
    if (!iconEl) { iconEl = document.createElement('i'); titleEl.prepend(iconEl); }
    iconEl.dataset.lucide = opts.icon || 'alert-circle';
    iconEl.style.color = opts.danger ? 'var(--danger, #ff5c7a)' : '';
    if (window.lucide) lucide.createIcons();
    const done = (val) => {
      dlg.classList.remove('open');
      document.body.style.overflow = '';
      okEl.removeEventListener('click', onOk);
      cancelEl.removeEventListener('click', onCancel);
      dlg.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === dlg) done(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter' && !e.isComposing) {
        // 焦点在「取消」上按 Enter = 取消，否则视为确认
        done(document.activeElement === cancelEl ? false : true);
      }
    };
    okEl.addEventListener('click', onOk);
    cancelEl.addEventListener('click', onCancel);
    dlg.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey);
    dlg.classList.add('open');
    document.body.style.overflow = 'hidden';
    okEl.focus();
  });
}

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
function fmtHistoryTime(ts){
  if(!ts) return '';
  var d=new Date(ts), now=Date.now(), diff=now-d.getTime();
  if(diff<60000) return '刚刚';
  if(diff<3600000) return Math.floor(diff/60000)+'分钟前';
  if(diff<86400000) return Math.floor(diff/3600000)+'小时前';
  if(diff<172800000) return '昨天 '+pad2(d.getHours())+':'+pad2(d.getMinutes());
  var y=d.getFullYear(), ny=new Date().getFullYear();
  return (y===ny?'':'y+')+(d.getMonth()+1)+'/'+d.getDate()+' '+pad2(d.getHours())+':'+pad2(d.getMinutes());
}

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
        { icon: 'trash-2', label: '删除', danger: true, action: async () => {
          if (await caidConfirm({ title: '删除快捷入口', message: `确认删除快捷入口「${sc.name}」？`, danger: true, okText: '删除', icon: 'trash-2' })) {
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

  bar.appendChild(add);
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
caidQs('#clearHistoryBtn').addEventListener('click', async () => {
  if (!(await caidConfirm({ title: '清空搜索历史', message: '确认清空所有搜索历史？此操作不可恢复。', danger: true, okText: '清空', icon: 'trash-2' }))) return;
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
    el.querySelector('[data-act="del"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await caidConfirm({ title: '删除代码片段', message: `删除代码片段「${item.title}」？`, danger: true, okText: '删除', icon: 'trash-2' })) {
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
caidQsa('.sidebar-section').forEach(sec => {
  const id = sec.dataset.comp;
  if (state.uiPrefs.collapsed?.[id]) sec.classList.add('collapsed');
  sec.querySelector('.sidebar-header').addEventListener('click', () => {
    sec.classList.toggle('collapsed');
    state.uiPrefs.collapsed = state.uiPrefs.collapsed || {};
    state.uiPrefs.collapsed[id] = sec.classList.contains('collapsed');
    LS.set('uiPrefs', state.uiPrefs);
  });
});

// ============ Agent Tasks ============
// 数据源：chrome.storage.local.caidMemory.history —— 副驾在任意页面完成任务后经 background 写入，
// 本页（扩展页）直接读 storage 并监听 onChanged 实时刷新；旧版 localStorage.agentTasks 做一次性迁移。
function storageAvailable() {
  try { return !!(chrome && chrome.storage && chrome.storage.local); } catch (e) { return false; }
}
async function loadAgentTasks() {
  let history = [];
  try {
    if (storageAvailable()) {
      const { caidMemory } = await chrome.storage.local.get('caidMemory');
      history = (caidMemory && Array.isArray(caidMemory.history)) ? caidMemory.history : [];
    }
  } catch (e) {}
  // 一次性迁移旧版 localStorage.agentTasks（合并去重后写入 storage，随后清除）
  try {
    const legacy = LS.get('agentTasks', []);
    if (Array.isArray(legacy) && legacy.length) {
      const seen = new Set(history.map(h => (h.goal || '') + '|' + (h.ts || 0)));
      let changed = false;
      const merged = history.slice();
      legacy.forEach(t => {
        if (!t) return;
        const goal = t.goal || t.text || '未命名任务';
        const ts = t.ts || Date.now();
        const key = goal + '|' + ts;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push({ goal, result: t.result || '', url: t.url || '', ts });
        changed = true;
      });
      if (storageAvailable()) {
        if (changed) {
          merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
          while (merged.length > 20) merged.shift();
          const { caidMemory: cur } = await chrome.storage.local.get('caidMemory');
          await chrome.storage.local.set({ caidMemory: Object.assign({}, cur || {}, { history: merged }) });
          history = merged;  // 同步局部变量，保证本次渲染即含迁移数据
        }
        LS.del('agentTasks');  // 迁移完成才清理旧数据（storage 不可用时保留，避免丢失）
      }
    }
  } catch (e) {}
  renderAgentTasks(history);
  updateCounts();
}
function renderAgentTasks(tasks) {
  const list = caidQs('#agentTaskList');
  if (!list) return;
  list.innerHTML = '';
  const arr = (tasks || []).slice().reverse();
  if (!arr.length) {
    list.innerHTML = `<div class="empty-state"><i data-lucide="bot"></i><div>暂无副驾任务记录</div><div class="agent-task-empty-tip">在任意网页打开副驾完成任务后，记录会自动出现在这里</div></div>`;
    refreshIcons();
    return;
  }
  arr.forEach(t => {
    const el = document.createElement('div');
    el.className = 'agent-task-item';
    const time = fmtHistoryTime(t.ts);
    const text = t.goal || t.text || '未命名任务';
    el.innerHTML = `
      <span class="agent-task-icon"><i data-lucide="bot"></i></span>
      <span class="agent-task-text" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
      <span class="agent-task-time">${time}</span>
    `;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleAgentTaskDetail(el, t);
    });
    list.appendChild(el);
  });
  refreshIcons();
}

// 点击任务条目：在右侧搜索框区域覆盖展开详情面板（同一时刻仅一个展开）
function toggleAgentTaskDetail(itemEl, t) {
  const wrapper = caidQs('.search-wrapper');
  if (!wrapper) return;
  const key = (t.goal || t.text || '未命名任务') + '|' + (t.ts || 0);
  const existing = wrapper.querySelector('.agent-task-detail');
  // 再点同一任务 → 收起
  if (existing && existing.dataset.key === key) {
    existing.remove();
    itemEl.classList.remove('active');
    return;
  }
  // 移除旧覆盖层 + 清除 active 标记
  if (existing) existing.remove();
  caidQsa('.agent-task-item.active').forEach(x => x.classList.remove('active'));
  itemEl.classList.add('active');

  const text = t.goal || t.text || '未命名任务';
  const result = String(t.result || '').trim();
  const url = String(t.url || '').trim();
  const detail = document.createElement('div');
  detail.className = 'agent-task-detail';
  detail.dataset.key = key;
  detail.innerHTML = `
    <div class="agent-task-detail-head">
      <span class="agent-task-detail-title"><i data-lucide="bot"></i> 副驾任务详情</span>
      <button class="agent-task-detail-close" title="关闭 (Esc)"><i data-lucide="x"></i></button>
    </div>
    <div class="agent-task-detail-body">
      <div class="agent-task-detail-label">任务</div>
      <div class="agent-task-detail-goal">${escapeHtml(text)}</div>
      <div class="agent-task-detail-meta">
        <span><i data-lucide="clock" style="width:11px;height:11px;display:inline;vertical-align:middle;margin-right:3px;"></i>${fmtFullTime(t.ts)}</span>
        ${url ? `<a class="agent-task-detail-url" href="${escapeHtml(url)}" target="_blank" rel="noopener"><i data-lucide="external-link" style="width:11px;height:11px;display:inline;vertical-align:middle;margin-right:3px;"></i>${escapeHtml(url)}</a>` : ''}
      </div>
      <div class="agent-task-detail-label">结果</div>
      <div class="agent-task-detail-result">${result ? escapeHtml(result) : '<span style="color:var(--muted)">（无结果记录）</span>'}</div>
      <div class="agent-task-detail-actions">
        <button class="btn small danger agent-task-del-btn"><i data-lucide="trash-2"></i>删除此任务</button>
      </div>
    </div>
  `;
  // 关闭按钮
  const closeBtn = detail.querySelector('.agent-task-detail-close');
  closeBtn.addEventListener('click', () => {
    detail.remove();
    caidQsa('.agent-task-item.active').forEach(x => x.classList.remove('active'));
  });
  // 删除按钮
  const delBtn = detail.querySelector('.agent-task-del-btn');
  delBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!(await caidConfirm({ title: '删除任务', message: `确定删除任务「${text}」吗？`, danger: true, okText: '删除', icon: 'trash-2' }))) return;
    detail.remove();
    await deleteAgentTask(t);
  });
  wrapper.appendChild(detail);
  refreshIcons();
}

// Esc 关闭详情覆盖层
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const wrapper = caidQs('.search-wrapper');
  if (!wrapper) return;
  const detail = wrapper.querySelector('.agent-task-detail');
  if (detail) {
    detail.remove();
    caidQsa('.agent-task-item.active').forEach(x => x.classList.remove('active'));
  }
});

function fmtFullTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 删除任务：按 goal+ts 精确匹配 storage.history 中的条目
async function deleteAgentTask(t) {
  try {
    if (!storageAvailable()) { toast('存储不可用，无法删除', 'error'); return; }
    const { caidMemory } = await chrome.storage.local.get('caidMemory');
    if (!caidMemory || !Array.isArray(caidMemory.history)) return;
    const key = (t.goal || t.text || '未命名任务') + '|' + (t.ts || 0);
    const next = caidMemory.history.filter(h =>
      ((h.goal || h.text || '未命名任务') + '|' + (h.ts || 0)) !== key
    );
    if (next.length === caidMemory.history.length) { toast('未找到该任务', 'warn'); return; }
    await chrome.storage.local.set({ caidMemory: Object.assign({}, caidMemory, { history: next }) });
    toast('任务已删除', 'success');
    loadAgentTasks();
  } catch (e) { toast('删除失败', 'error'); }
}
// 兼容旧调用（本地直接添加任务）：统一写入 chrome.storage，与副驾数据同源
async function addAgentTask(goal, result) {
  try {
    if (!storageAvailable()) return;
    const { caidMemory } = await chrome.storage.local.get('caidMemory');
    const m = Object.assign({}, caidMemory || {}, {
      facts: (caidMemory && Array.isArray(caidMemory.facts)) ? caidMemory.facts : [],
      history: (caidMemory && Array.isArray(caidMemory.history)) ? caidMemory.history : [],
    });
    m.history.push({ goal: String(goal || '').trim(), result: String(result || '').trim(), url: location.href, ts: Date.now() });
    while (m.history.length > 20) m.history.shift();
    await chrome.storage.local.set({ caidMemory: m });
    loadAgentTasks();
  } catch (e) {}
}

// ============ Counts ============
async function updateCounts() {
  try {
    caidQs('#snippetCount').textContent = await db.snippets.count() || 0;
  } catch(e){}
  caidQs('#historyCount').textContent = state.searchHistory.length;
  caidQs('#todoCount').textContent = state.todos.length;
  try {
    let n = 0;
    if (storageAvailable()) {
      const { caidMemory } = await chrome.storage.local.get('caidMemory');
      n = (caidMemory && Array.isArray(caidMemory.history)) ? caidMemory.history.length : 0;
    }
    caidQs('#agentTaskCount').textContent = n;
  } catch(e){ caidQs('#agentTaskCount').textContent = LS.get('agentTasks', []).length; }
}

// ============ Settings ============
// AI 回答配置：只读/写 localStorage.llmCfg，与副驾配置（chrome.storage.local.caidLlm）完全独立。
async function fillSettingsForm() {
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
caidQs('#saveSettingsBtn').addEventListener('click', async () => {
  // 仅保存 AI 回答配置（newtab 搜索框 AI 回答用），不再双写副驾配置。
  state.llmCfg = {
    provider: caidQs('#cfgProvider').value,
    baseUrl: caidQs('#cfgBaseUrl').value.trim(),
    apiKey: caidQs('#cfgApiKey').value.trim(),
    model: caidQs('#cfgModel').value.trim(),
    temperature: parseFloat(caidQs('#cfgTemp').value) || 0.7,
  };
  LS.set('llmCfg', state.llmCfg);
  ConfigBackup.save('llmCfg', state.llmCfg);
  // 设置变化 → 广播脱敏设置给所有插件帧（api.onSettingsChange 触发）
  const masked = desensitizeSettings(state.llmCfg);
  pluginFrameByWin.forEach((f2, win) => {
    try { win.postMessage({ __caidPlugin: true, type: 'CAID_PLUGIN_SETTINGS_CHANGE', settings: masked }, '*'); } catch (e) {}
  });
  closeModal('settingsModal');
  toast('设置已保存','success');
});

// ============ 常规设置：新标签页接管开关（存 chrome.storage.local.caidNewtabEnabled，默认开启）============
async function fillGeneralForm() {
  let ext = {};
  try { ext = await chrome.storage.local.get('caidNewtabEnabled'); } catch (e) {}
  const on = ext.caidNewtabEnabled !== false;
  const sw = caidQs('#ntOverrideSwitch');
  if (sw) {
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
  }
}
const ntOverrideSwitch = caidQs('#ntOverrideSwitch');
if (ntOverrideSwitch) ntOverrideSwitch.addEventListener('click', () => {
  ntOverrideSwitch.classList.toggle('on');
  const on = ntOverrideSwitch.classList.contains('on');
  ntOverrideSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  try { chrome.storage.local.set({ caidNewtabEnabled: on }); } catch (e) {}
  if (!on) {
    // 关闭接管立即生效：把已打开的 CAID 工作台标签页（含当前设置页）全部导航回浏览器默认
    // 新标签页，让用户直接看到"取消接管"的结果。当前页稍延迟，让 toast 提示先显示出来。
    try {
      chrome.tabs.query({ url: chrome.runtime.getURL('newtab.html') + '*' }, (tabs) => {
        if (!tabs || !tabs.length) return;
        tabs.forEach((t) => {
          if (!t.id) return;
          if (t.active) setTimeout(() => { try { chrome.tabs.update(t.id, { url: 'chrome://newtab' }); } catch (e) {} }, 400);
          else try { chrome.tabs.update(t.id, { url: 'chrome://newtab' }); } catch (e) {}
        });
      });
    } catch (e) {}
  }
  toast(on ? '已开启新标签页接管' : '已关闭接管：新标签页完全恢复为浏览器默认页面', on ? 'success' : '');
});

// ============ 副驾配置（独立于 AI 回答，存 chrome.storage.local.caidLlm）============
async function fillCopilotForm() {
  let ext = {};
  try { ext = (await chrome.storage.local.get('caidLlm')).caidLlm || {}; } catch (e) {}
  const isFree = !ext.apiKey || ext.apiKey === 'NA' || ext.apiKey === 'null' || ext.apiKey === 'undefined';
  caidQs('#cpProvider').value = isFree ? 'free' : 'custom';
  caidQs('#cpBaseUrl').value = ext.baseURL || '';
  caidQs('#cpApiKey').value = isFree ? '' : (ext.apiKey || '');
  caidQs('#cpModel').value = ext.model || '';
  caidQs('#cpProvider').dispatchEvent(new Event('change'));
}
caidQs('#cpProvider').addEventListener('change', (e) => {
  const free = e.target.value === 'free';
  ['#cpBaseUrl', '#cpApiKey', '#cpModel'].forEach((sel) => {
    const el = caidQs(sel);
    el.disabled = free;
    if (free) { el.style.opacity = '.45'; } else { el.style.opacity = ''; }
  });
});
caidQs('#saveCopilotBtn').addEventListener('click', async () => {
  const isFree = caidQs('#cpProvider').value === 'free';
  const key = caidQs('#cpApiKey').value.trim();
  // 语义与旧 options 页一致：无真实 Key → apiKey='NA' 表示内置免费代理
  const extCfg = {
    model: (isFree ? 'qwen3.5-plus' : caidQs('#cpModel').value.trim()) || 'qwen3.5-plus',
    baseURL: caidQs('#cpBaseUrl').value.trim(),
    apiKey: isFree ? 'NA' : (key || 'NA'),
    custom: !isFree && !!key,
  };
  try { await chrome.storage.local.set({ caidLlm: extCfg }); }
  catch (e) { return toast('保存失败：' + String(e), 'error', 4000); }
  toast('副驾配置已保存（已打开的页面下次注入生效）','success');
});
caidQs('#cpTestBtn').addEventListener('click', async () => {
  const isFree = caidQs('#cpProvider').value === 'free';
  const key = caidQs('#cpApiKey').value.trim();
  const baseUrl = caidQs('#cpBaseUrl').value.trim();
  const model = caidQs('#cpModel').value.trim() || 'qwen3.5-plus';
  if (isFree) { return toast('免费代理无需测试，直接保存即可','warn'); }
  if (!key) { return toast('请先填入 API Key','warn'); }
  if (!baseUrl) { return toast('请先填入 Base URL','warn'); }
  const btn = caidQs('#cpTestBtn');
  const orig = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="loader-2" style="animation:spin 1s linear infinite;"></i>测试中…`;
  refreshIcons();
  try {
    const resp = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+key },
      body: JSON.stringify({ model, messages: [{role:'user',content:'ping，用一个字回答'}], max_tokens: 10 }),
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
caidQs('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (!(await caidConfirm({ title: '导入备份', message: '导入将覆盖当前所有数据，确定继续？', okText: '继续导入', icon: 'upload' }))) { e.target.value = ''; return; }
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
      caidQsa('.sidebar-section').forEach(sec => {
        const id = sec.dataset.comp;
        sec.classList.toggle('collapsed', !!state.uiPrefs.collapsed?.[id]);
      });
      renderShortcuts();
      renderHistory();
      renderTodos();
      await renderSnippets();
      loadAgentTasks();
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
  if (!(await caidConfirm({ title: '重置全部数据', message: '⚠️ 此操作将清空全部本地数据（快捷入口、片段、历史、待办、配置）！确定继续？', danger: true, okText: '继续', icon: 'alert-triangle' }))) return;
  if (!(await caidConfirm({ title: '最后确认', message: '⚠️ 再次确认：数据将被永久删除，不可恢复！', danger: true, okText: '永久删除', icon: 'alert-triangle' }))) return;
  localStorage.clear();
  try {
    await db.snippets.clear();
    await db.history.clear();
  } catch(e){}
  try {
    if (storageAvailable()) await chrome.storage.local.remove(['caidMemory', 'caidServers', 'caidServerStats']);  // 同步清空副驾任务/长期记忆/服务器监控
  } catch(e){}
  setTimeout(() => location.reload(), 400);
  toast('正在重置…');
});

// ============ Server Monitor ============
const serverMonitorEl = caidQs('#serverMonitor');
const serverCardsEl = caidQs('#serverCards');
let serverList = [];
let serverStats = {};

async function loadServers() {
  serverList = [];
  serverStats = {};
  try {
    if (storageAvailable() && chrome.storage && chrome.storage.local) {
      const got = await chrome.storage.local.get(['caidServers', 'caidServerStats']);
      serverList = Array.isArray(got.caidServers) ? got.caidServers : [];
      serverStats = (got.caidServerStats && typeof got.caidServerStats === 'object') ? got.caidServerStats : {};
    }
  } catch (e) { console.warn('[CAID] loadServers', e); }
  renderServerList();
  renderServerCards();
}

async function saveServers() {
  try {
    if (storageAvailable() && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ caidServers: serverList, caidServerStats: serverStats });
    }
  } catch (e) { console.warn('[CAID] saveServers', e); }
}

function srvUrl(s) {
  if (s.url) return s.url;                       // 纯 URL 监控（零部署）
  return (s.proto || 'http') + '://' + s.host + ':' + (s.port || 8601) + '/probe';  // 兼容旧探针格式
}

async function probeServer(s) {
  // 零部署探活：mode:'no-cors' 绕过目标站 CORS 限制，只判断“是否可达”
  const st = serverStats[s.id] || { ok: null, ms: null, err: null, ts: 0 };
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    await fetch(srvUrl(s), { method: 'GET', mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' });
    const ms = Math.round(performance.now() - t0);
    st.ok = true; st.ms = ms; st.err = null; st.ts = Date.now();
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    st.ok = false; st.ms = ms; st.err = (e && e.name === 'AbortError') ? '超时' : '连接失败'; st.ts = Date.now();
  } finally {
    clearTimeout(timer);
  }
  serverStats[s.id] = st;
  return st;
}

async function probeAll() {
  if (!serverList.length) return;
  await Promise.all(serverList.map(probeServer));
  await saveServers();
  renderServerCards();
  renderServerList();
}

function meterHtml(label, pct, valText) {
  if (pct === null || pct === undefined) {
    return '<div class="server-meter-row"><span class="server-meter-label">' + label + '</span>' +
      '<span class="server-meter-bar"></span><span class="server-meter-val">--</span></div>';
  }
  const cls = pct >= 85 ? 'high' : (pct >= 60 ? 'warn' : '');
  return '<div class="server-meter-row"><span class="server-meter-label">' + label + '</span>' +
    '<span class="server-meter-bar"><span class="server-meter-fill ' + cls + '" style="width:' + Math.min(pct, 100) + '%"></span></span>' +
    '<span class="server-meter-val">' + valText + '</span></div>';
}

function fmtUptime(sec) {
  if (!sec) return '--';
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return (d > 0 ? d + '天' : '') + h + '时' + m + '分';
}

function renderServerCards() {
  if (!serverMonitorEl || !serverCardsEl) return;
  serverMonitorEl.style.display = '';   // 始终显示区块（含空状态引导）
  if (!serverList.length) {
    serverCardsEl.innerHTML = '<div class="server-empty">' +
      '<div class="server-empty-title">还没添加监控</div>' +
      '<div class="server-empty-desc">填一个可访问的网址（网站 / NAS 管理页 / 任意 HTTP 服务），newtab 每隔 30 秒自动探测它是否在线、响应多快。无需在服务器端安装任何程序。</div>' +
      '<button class="btn primary server-empty-btn" id="serverAddFromCard"><i data-lucide="plus"></i>添加监控</button>' +
      '</div>';
    const addBtn = caidQs('#serverAddFromCard');
    if (addBtn) addBtn.addEventListener('click', openServerSettings);
    refreshIcons();
    return;
  }
  serverCardsEl.innerHTML = serverList.map(s => {
    const st = serverStats[s.id];
    const online = st && st.ok;
    const cardCls = online === false ? 'server-card offline' : 'server-card';
    const dotCls = online === false ? 'server-dot offline' : 'server-dot';
    let body;
    if (online) {
      body = '<div class="server-card-meta" style="margin-top:0;margin-bottom:0;">在线' + (st.ms != null ? ' · ' + st.ms + 'ms' : '') + '</div>';
    } else if (st && st.ok === false) {
      body = '<div class="server-card-meta" style="margin-bottom:0;color:var(--danger);">' + escapeHtml(st.err || '离线') + (st.ms != null ? ' · ' + st.ms + 'ms' : '') + '</div>';
    } else {
      body = '<div class="server-card-meta" style="margin-bottom:0;">探测中…</div>';
    }
    const meta = st && st.ts ? new Date(st.ts).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    return '<div class="' + cardCls + '">' +
      '<div class="server-card-head"><span class="' + dotCls + '"></span>' +
      '<span class="server-card-name">' + escapeHtml(s.name || s.url) + '</span></div>' +
      '<div class="server-card-host">' + escapeHtml(s.url || (s.host + ':' + s.port)) + '</div>' +
      body +
      (meta ? '<div class="server-card-meta" style="margin-top:6px;margin-bottom:0;font-size:10px;">' + meta + '</div>' : '') +
      '</div>';
  }).join('');
}

function renderServerList() {
  const listEl = caidQs('#serverList');
  if (!listEl) return;
  if (!serverList.length) {
    listEl.innerHTML = '<div class="setting-desc" style="margin:4px 0 8px;">尚未添加服务器。填好下方表单后点击「添加服务器」。</div>';
    return;
  }
  listEl.innerHTML = serverList.map(s => {
    const st = serverStats[s.id];
    let statusHtml;
    if (st && st.ok) statusHtml = '<span class="server-item-status ok">在线 ' + st.ms + 'ms</span>';
    else if (st && st.ok === false) statusHtml = '<span class="server-item-status bad">离线</span>';
    else statusHtml = '<span class="server-item-status">--</span>';
    return '<div class="server-item">' +
      '<span class="server-item-name">' + escapeHtml(s.name || s.host) + '</span>' +
      '<span class="server-item-host">' + escapeHtml(s.url || srvUrl(s)) + '</span>' +
      statusHtml +
      '<button class="server-item-del" data-del="' + s.id + '">删除</button>' +
      '</div>';
  }).join('');
  listEl.querySelectorAll('.server-item-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      serverList = serverList.filter(x => x.id !== btn.dataset.del);
      delete serverStats[btn.dataset.del];
      await saveServers();
      renderServerList();
      renderServerCards();
      toast('已删除服务器');
    });
  });
}

function addServer() {
  const name = caidQs('#srvName').value.trim();
  const url = caidQs('#srvUrl').value.trim();
  if (!url) { toast('请填写地址', 'error'); return; }
  const norm = /^https?:\/\//i.test(url) ? url : 'http://' + url;
  serverList.push({ id: uid(), name: name || norm, url: norm });
  caidQs('#srvName').value = '';
  caidQs('#srvUrl').value = '';
  saveServers().then(() => { renderServerList(); renderServerCards(); probeAll(); });
  toast('已添加，正在探测…');
}

function switchSettingsTab(name) {
  const tab = caidQs('#settingsTabs .modal-tab[data-tab="' + name + '"]');
  if (!tab) return;
  caidQsa('#settingsTabs .modal-tab').forEach(x => x.classList.remove('active'));
  tab.classList.add('active');
  caidQsa('.settings-panel').forEach(p => p.style.display = p.dataset.panel === name ? '' : 'none');
  refreshIcons();
}
function openServerSettings() {
  openModal('settingsModal', () => { fillGeneralForm(); fillSettingsForm(); fillCopilotForm(); renderServerList(); switchSettingsTab('servers'); });
}

const addServerBtn = caidQs('#addServerBtn');
if (addServerBtn) addServerBtn.addEventListener('click', addServer);
const srvManageBtn = caidQs('#serverMonitorManage');
if (srvManageBtn) srvManageBtn.addEventListener('click', openServerSettings);

// ============ Plugin System ============
const PLUGIN_STORE_KEY = 'caidPlugins';
const pluginRegistry = {};           // id -> { def, container, dispose, mounted }
const PLUGIN_TEMPLATE = `CAID.plugin({
  id: 'my-clock',
  name: '我的时钟',
  icon: 'clock',
  mount(api) {
    const box = api.el('div', { className: 'plugin-row' });
    api.container.appendChild(box);
    const tick = () => { box.textContent = new Date().toLocaleTimeString('zh-CN'); };
    tick();
    api.setInterval(tick, 1000);
  }
});`;

// ============ 沙箱桥接（父页面侧） ============
// 插件代码在 sandbox/plugin-sandbox.html（<iframe sandbox="allow-scripts">）中执行。
// 沙箱帧拥有独立 null 源且 CSP 允许 'unsafe-eval'，可用 new Function 运行用户代码，
// 但无法访问任何 chrome.* API —— storage / fetch / toast 一律通过 postMessage 桥接回本页（拥有扩展权限）。
const pluginFrameByWin = new Map();   // contentWindow -> iframe 元素（已挂载的插件帧）
const pluginSharedStore = {};          // pluginId -> 跨视图共享对象（仅内存，刷新即清空）
let pluginMsgSeq = 0;

// 扩展版本号（api.getVersion 用）：manifest 版本优先，读取失败回退空串
let pluginVersion = '';
try { pluginVersion = chrome.runtime.getManifest().version || ''; } catch (e) {}

// 设置脱敏：只把非敏感字段暴露给插件，apiKey/secret/token 等一律打码
function desensitizeSettings(cfg) {
  const c = cfg || {};
  const out = {};
  const SENSITIVE = /(api[_-]?key|secret|token|password|authorization)/i;
  for (const k of Object.keys(c)) {
    if (SENSITIVE.test(k)) out[k] = c[k] ? (String(c[k]).slice(0, 3) + '****' + String(c[k]).slice(-3)) : '';
    else out[k] = c[k];
  }
  return out;
}

// 插件通知节流表：pluginId -> 上次通知时间戳
const pluginNotifyTs = {};
// 页面内快捷键注册表：'Ctrl+K' -> [pluginId,...]（降级方案，非浏览器全局）
const pluginShortcutHandlers = {};
// 快捷键触发防抖表：combo -> 上次触发时间
const pluginShortcutLastTrigger = {};

// 页面内快捷键解析：把 KeyboardEvent 归一化为 'Ctrl+K' 风格组合串
function normalizeShortcut(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const k = e.key;
  if (k === ' ' || k === 'Spacebar') parts.push('Space');
  else if (k && k.length === 1) parts.push(k.toUpperCase());
  else if (k) parts.push(k.length > 1 ? k : k.toUpperCase());
  return parts.join('+');
}

// 删除插件时清理运行时残留：通知节流、快捷键注册
function cleanupPluginRuntime(id) {
  delete pluginNotifyTs[id];
  for (const combo of Object.keys(pluginShortcutHandlers)) {
    const arr = pluginShortcutHandlers[combo];
    const i = arr ? arr.indexOf(id) : -1;
    if (i !== -1) arr.splice(i, 1);
    if (arr && !arr.length) delete pluginShortcutHandlers[combo];
  }
}

// 页面级 keydown：命中插件注册的快捷键 → 广播给对应插件帧（需主区域/文档聚焦，沙箱帧内按键无法上浮）
document.addEventListener('keydown', (e) => {
  if (!Object.keys(pluginShortcutHandlers).length) return;
  const combo = normalizeShortcut(e);
  const pids = pluginShortcutHandlers[combo];
  if (!pids || !pids.length) return;
  e.preventDefault();
  e.stopPropagation();
  const now = Date.now();
  if (now - (pluginShortcutLastTrigger[combo] || 0) < 250) return;   // 防抖：连按不重复触发
  pluginShortcutLastTrigger[combo] = now;
  pluginFrameByWin.forEach((f2, win) => {
    if (pids.indexOf(f2.dataset.pluginId) !== -1) {
      try { win.postMessage({ __caidPlugin: true, type: 'CAID_PLUGIN_SHORTCUT', key: combo }, '*'); } catch (err) {}
    }
  });
});

function pluginSandboxUrl() { return chrome.runtime.getURL('sandbox/plugin-sandbox.html'); }

// 全局监听：处理来自沙箱帧的桥接请求 / toast / 高度同步 / 运行错误
window.addEventListener('message', function (ev) {
  const d = ev.data;
  if (!d || !d.__caidPlugin) return;
  const src = ev.source;
  if (d.type === 'CAID_BRIDGE') {
    handlePluginBridge(src, d);
  } else if (d.type === 'CAID_TOAST') {
    if (typeof toast === 'function') toast(d.msg);
  } else if (d.type === 'CAID_PLUGIN_SIZE') {
    const f = pluginFrameByWin.get(src);
    if (f) f.style.height = Math.max(60, d.height) + 'px';
  } else if (d.type === 'CAID_PLUGIN_MODAL_CLOSE') {
    // 插件在 modal 视图内调用 api.closeModal()：按帧归属关闭对应弹窗
    const f = pluginFrameByWin.get(src);
    if (f) closePluginModalByPlugin(f.dataset.pluginId);
  } else if (d.type === 'CAID_PLUGIN_ERROR') {
    const f = pluginFrameByWin.get(src);
    const mode = f ? f.dataset.mode : null;
    if (mode === 'modal' && typeof toast === 'function') {
      toast('插件弹窗运行失败：' + (d.error || '未知错误'), 'error');
    } else {
      console.warn('[CAID-Plugin] 运行出错', d.error);
    }
  }
});

async function handlePluginBridge(src, d) {
  let payload = null;
  try {
    if (d.op === 'storageGet') {
      const r = await chrome.storage.local.get(d.data.key);
      payload = { value: r[d.data.key] };
    } else if (d.op === 'storageSet') {
      await chrome.storage.local.set({ [d.data.key]: d.data.value });
      payload = { ok: true };
    } else if (d.op === 'fetch') {
      const res = await fetch(d.data.url, d.data.opt);
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) {}
      const headers = {};
      try { res.headers.forEach((v, k) => { headers[k] = v; }); } catch (e) {}
      payload = { ok: res.ok, status: res.status, statusText: res.statusText, text: text, json: json, headers: headers };
    } else if (d.op === 'sharedGet') {
      // 返回该插件跨视图共享对象（structured clone 深拷贝，沙箱端作为本地镜像）
      const f = pluginFrameByWin.get(src);
      const pid = f ? f.dataset.pluginId : null;
      if (!pid) payload = { error: 'unknown plugin frame' };
      else {
        if (!pluginSharedStore[pid] || typeof pluginSharedStore[pid] !== 'object') pluginSharedStore[pid] = {};
        payload = pluginSharedStore[pid];
      }
    } else if (d.op === 'sharedSet') {
      const f = pluginFrameByWin.get(src);
      const pid = f ? f.dataset.pluginId : null;
      if (!pid) payload = { error: 'unknown plugin frame' };
      else {
        if (!pluginSharedStore[pid] || typeof pluginSharedStore[pid] !== 'object') pluginSharedStore[pid] = {};
        const val = d.data && d.data.value;
        if (val && typeof val === 'object') {
          // 全量替换（以发送方为准），然后广播给同插件的所有帧（含发送方，幂等）
          Object.keys(pluginSharedStore[pid]).forEach(k => delete pluginSharedStore[pid][k]);
          Object.assign(pluginSharedStore[pid], val);
          pluginFrameByWin.forEach((f2, win) => {
            if (f2.dataset.pluginId === pid) {
              win.postMessage({ __caidPlugin: true, type: 'CAID_PLUGIN_SHARED_SYNC', value: pluginSharedStore[pid] }, '*');
            }
          });
        }
        payload = { ok: true };
      }
    } else if (d.op === 'modalOpen') {
      // 插件请求打开自己的弹窗：pluginId 由帧归属反查
      const f = pluginFrameByWin.get(src);
      const pluginId = f ? f.dataset.pluginId : null;
      if (!pluginId) payload = { ok: false, error: 'unknown plugin frame' };
      else payload = await openPluginModal(pluginId, d.data || {});
    } else if (d.op === 'css') {
      // 读取父页 CSS 变量值（沙箱是独立文档读不到；校验 -- 前缀防任意属性探测）
      const key = d.data && d.data.key;
      if (typeof key === 'string' && key.indexOf('--') === 0) {
        payload = { value: getComputedStyle(document.documentElement).getPropertyValue(key).trim() };
      } else {
        payload = { value: '' };
      }
    } else if (d.op === 'copy') {
      // 复制到剪贴板：沙箱 null 源无 navigator.clipboard，扩展页是 secure context 可用
      try {
        await navigator.clipboard.writeText(String((d.data && d.data.text) || ''));
        payload = { ok: true };
      } catch (e) {
        // 兜底：textarea + execCommand（用户手势链下仍可用）
        try {
          const ta = document.createElement('textarea');
          ta.value = String((d.data && d.data.text) || '');
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy');
          ta.remove();
          payload = { ok: true };
        } catch (e2) {
          payload = { ok: false, error: '剪贴板不可用' };
        }
      }
    } else if (d.op === 'openURL') {
      // 新标签页打开 URL：协议白名单 http/https，防 chrome://、javascript:、file://
      const u = String((d.data && d.data.url) || '');
      if (/^https?:\/\//i.test(u)) {
        try { await chrome.tabs.create({ url: u }); payload = { ok: true }; }
        catch (e) { payload = { ok: false, error: e.message }; }
      } else {
        payload = { ok: false, error: '仅允许 http/https 链接' };
      }
    } else if (d.op === 'confirm') {
      // 自定义确认对话框（复用 CAID 弹窗；返回 Promise<boolean>）
      const dd = d.data || {};
      const ok = await caidConfirm({
        title: dd.title || '插件确认',
        message: dd.message || '确认继续？',
        okText: dd.okText || '确认',
        cancelText: dd.cancelText || '取消',
        danger: !!dd.danger,
        icon: dd.icon || 'alert-circle'
      });
      payload = { ok: ok };
    } else if (d.op === 'emitEvent') {
      // 插件间事件广播：发给所有插件帧（广播式，任何插件可听）
      const name = d.data && d.data.name;
      if (name) {
        pluginFrameByWin.forEach((f2, win) => {
          try {
            win.postMessage({ __caidPlugin: true, type: 'CAID_PLUGIN_EVENT', name: String(name), payload: d.data && d.data.payload }, '*');
          } catch (e) {}
        });
      }
      payload = { ok: true };
    } else if (d.op === 'exportData') {
      // 导出本插件全部数据（caidPlugin:<id>: 前缀的 storage 项）
      const f = pluginFrameByWin.get(src);
      const pid = f ? f.dataset.pluginId : null;
      if (!pid) payload = { error: 'unknown plugin frame' };
      else {
        const prefix = 'caidPlugin:' + pid + ':';
        const all = await chrome.storage.local.get(null);
        const data = {};
        for (const k of Object.keys(all)) {
          if (k.indexOf(prefix) === 0) data[k.slice(prefix.length)] = all[k];
        }
        payload = { data: data };
      }
    } else if (d.op === 'importData') {
      // 导入本插件数据：只允许写入 caidPlugin:<id>: 命名空间，拒绝越权键；大小上限 500KB
      const f = pluginFrameByWin.get(src);
      const pid = f ? f.dataset.pluginId : null;
      const data = (d.data && d.data.data) || null;
      if (!pid) payload = { error: 'unknown plugin frame' };
      else if (!data || typeof data !== 'object' || Array.isArray(data)) payload = { ok: false, error: '数据格式错误' };
      else if (JSON.stringify(data).length > 500 * 1024) payload = { ok: false, error: '数据超过 500KB 上限' };
      else {
        try {
          const prefix = 'caidPlugin:' + pid + ':';
          const toSet = {};
          for (const k of Object.keys(data)) {
            const key = String(k);
            if (key.indexOf('caidPlugin:') === 0) continue;   // 拒绝注入其他插件命名空间
            toSet[prefix + key] = data[k];
          }
          await chrome.storage.local.set(toSet);
          payload = { ok: true };
        } catch (e) {
          payload = { ok: false, error: e.message };
        }
      }
    } else if (d.op === 'notify') {
      // 浏览器原生通知：chrome.notifications，每插件节流 10 秒 1 条
      const f = pluginFrameByWin.get(src);
      const pid = f ? f.dataset.pluginId : null;
      if (!pid) payload = { error: 'unknown plugin frame' };
      else {
        const now = Date.now();
        const last = pluginNotifyTs[pid] || 0;
        if (now - last < 10000) {
          payload = { ok: false, error: '通知过于频繁（10 秒 1 条）' };
        } else {
          pluginNotifyTs[pid] = now;
          try {
            const dd = d.data || {};
            await chrome.notifications.create('caid-plugin-' + pid + '-' + now, {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon-400.png'),
              title: String(dd.title || 'CAID 插件'),
              message: String(dd.body || ''),
              priority: 1
            });
            payload = { ok: true };
          } catch (e) {
            payload = { ok: false, error: e.message };
          }
        }
      }
    } else if (d.op === 'registerShortcut') {
      // 页面内快捷键（降级方案）：父页监听 keydown，命中后转发给对应插件帧
      const f = pluginFrameByWin.get(src);
      const pid = f ? f.dataset.pluginId : null;
      const key = d.data && d.data.key;
      if (pid && key) {
        if (!pluginShortcutHandlers[key]) pluginShortcutHandlers[key] = [];
        if (pluginShortcutHandlers[key].indexOf(pid) === -1) pluginShortcutHandlers[key].push(pid);
      }
      payload = { ok: true };
    }
  } catch (e) {
    payload = { error: e.message };
  }
  src.postMessage({ __caidPlugin: true, type: 'CAID_BRIDGE_RES', reqId: d.reqId, payload: payload }, '*');
}

// ============ 插件弹窗（api.modal 打开；内容渲染在独立沙箱帧 modal 模式）============
const pluginModalMap = {};   // pluginId -> { backdrop, iframe, onKey }

function openPluginModal(pluginId, opts) {
  if (pluginModalMap[pluginId]) closePluginModalByPlugin(pluginId);   // 已开则重开
  return getPlugins().then(list => {
    const rec = list.find(x => x.id === pluginId);
    if (!rec || !rec.code) return { ok: false, error: '插件不存在' };
    const title = (opts && opts.title) || rec.name || pluginId;
    const rawW = Number((opts && opts.width) || 0);
    const width = Math.min(Math.max(rawW || 640, 320), 1200);   // 防 NaN/越界

    const backdrop = document.createElement('div');
    backdrop.className = 'plugin-modal-backdrop';
    backdrop.innerHTML =
      '<div class="plugin-modal" style="width:min(' + Number(width) + 'px, calc(100vw - 48px));">' +
        '<div class="plugin-modal-head">' +
          '<span class="plugin-modal-title">' + escapeHtml(String(title)) + '</span>' +
          '<button class="plugin-modal-close" title="关闭"><i data-lucide="x"></i></button>' +
        '</div>' +
        '<div class="plugin-modal-body">' +
          '<iframe class="plugin-modal-frame" sandbox="allow-scripts" style="min-height:120px;"></iframe>' +
        '</div>' +
      '</div>';
    const iframe = backdrop.querySelector('iframe');
    iframe.src = pluginSandboxUrl();        // 不设 src 帧停在 about:blank
    const closeBtn = backdrop.querySelector('.plugin-modal-close');
    const onKey = (e) => { if (e.key === 'Escape') closePluginModalByPlugin(pluginId); };
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closePluginModalByPlugin(pluginId); });
    closeBtn.addEventListener('click', () => closePluginModalByPlugin(pluginId));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    if (window.lucide) lucide.createIcons();

    pluginModalMap[pluginId] = { backdrop: backdrop, iframe: iframe, onKey: onKey };
    mountPluginInFrame(iframe, rec.code, pluginId, 'modal', rec.name);
    return { ok: true };
  });
}

function closePluginModalByPlugin(pluginId) {
  const rec = pluginModalMap[pluginId];
  if (!rec) return;
  if (rec.iframe.contentWindow) pluginFrameByWin.delete(rec.iframe.contentWindow);
  if (rec.onKey) document.removeEventListener('keydown', rec.onKey);
  rec.backdrop.remove();
  delete pluginModalMap[pluginId];
}

// 等待沙箱帧就绪后挂载插件代码（mode: mount 侧边栏 / panel 右侧面板 / modal 弹窗）
function mountPluginInFrame(iframe, code, pluginId, mode, pluginName) {
  iframe.dataset.pluginId = pluginId || '';
  iframe.dataset.mode = mode || 'mount';
  const onReady = function (ev) {
    if (ev.source !== iframe.contentWindow) return;
    window.removeEventListener('message', onReady);
    pluginFrameByWin.set(iframe.contentWindow, iframe);
    iframe.contentWindow.postMessage({
      __caidPlugin: true, type: 'CAID_PLUGIN_MOUNT', reqId: 'm' + (++pluginMsgSeq),
      code: code, pluginId: pluginId, mode: mode || 'mount',
      version: pluginVersion, pluginName: pluginName || pluginId || '',
      isDark: true,   // 当前扩展固定暗色主题
      settings: desensitizeSettings(state.llmCfg)
    }, '*');
  };
  window.addEventListener('message', onReady);
}

// 隐藏的校验帧：仅解析插件代码、提取 def 元数据，不渲染
let pluginValidatorFrame = null;
function getPluginValidator() {
  if (pluginValidatorFrame) return Promise.resolve(pluginValidatorFrame);
  return new Promise(function (resolve) {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.display = 'none';
    f.src = pluginSandboxUrl();
    const onReady = function (ev) {
      if (ev.source !== f.contentWindow) return;
      window.removeEventListener('message', onReady);
      clearTimeout(timer);
      pluginValidatorFrame = f;
      resolve(f);
    };
    window.addEventListener('message', onReady);
    const timer = setTimeout(function () {
      window.removeEventListener('message', onReady);
      resolve(null);            // 沙箱帧加载超时：返回 null，交由调用方兜底
    }, 1200);
    document.body.appendChild(f);
  });
}
function validatePluginCode(code) {
  return getPluginValidator().then(function (f) {
    if (!f) return { ok: true, skipped: true };
    return new Promise(function (resolve) {
      const reqId = 'v' + (++pluginMsgSeq);
      let done = false;
      const onRes = function (ev) {
        const dd = ev.data;
        if (!dd || !dd.__caidPlugin || dd.type !== 'CAID_PLUGIN_VALIDATED' || dd.reqId !== reqId) return;
        if (done) return; done = true;
        window.removeEventListener('message', onRes);
        clearTimeout(timer);
        resolve({ ok: dd.ok, error: dd.error, def: dd.def });
      };
      window.addEventListener('message', onRes);
      const timer = setTimeout(function () {
        if (done) return; done = true;
        window.removeEventListener('message', onRes);
        resolve({ ok: true, skipped: true });
      }, 1000);
      f.contentWindow.postMessage({ __caidPlugin: true, type: 'CAID_PLUGIN_VALIDATE', reqId: reqId, code: code }, '*');
    });
  });
}

async function getPlugins() {
  if (storageAvailable()) {
    const r = await chrome.storage.local.get(PLUGIN_STORE_KEY);
    return Array.isArray(r[PLUGIN_STORE_KEY]) ? r[PLUGIN_STORE_KEY] : [];
  }
  return LS.get(PLUGIN_STORE_KEY, []);
}
async function savePlugins(list) {
  if (storageAvailable()) await chrome.storage.local.set({ [PLUGIN_STORE_KEY]: list });
  else LS.set(PLUGIN_STORE_KEY, list);
}

function injectPluginSection(def) {
  const sections = caidQs('#sidebarSections') || caidQs('.sidebar-sections');
  if (!sections) return;
  // 防重复注入：registry 已有则跳过
  if (pluginRegistry[def.id]) return;
  // DOM 残留同名区块则先清理
  const stale = caidQs('.sidebar-section[data-comp="plugin:' + def.id + '"]');
  if (stale) stale.remove();
  const sec = document.createElement('div');
  sec.className = 'sidebar-section';
  sec.dataset.comp = 'plugin:' + def.id;
  sec.innerHTML =
    '<div class="sidebar-header">' +
      '<span class="sidebar-icon"><i data-lucide="' + escapeHtml(def.icon || 'puzzle') + '"></i></span>' +
      '<span class="sidebar-title">' + escapeHtml(def.name || def.id) + '</span>' +
      '<span class="plugin-kebab" title="更多操作"><i data-lucide="more-vertical"></i></span>' +
      '<span class="sidebar-chevron"><i data-lucide="chevron-down"></i></span>' +
    '</div>' +
    // mount 视图已迁移到主内容区「插件」挂载点（服务器监控下方），侧边栏仅保留管理入口
    '<div class="sidebar-body"><div class="plugin-body"><div class="plugin-inline-hint">内容显示在主区域</div></div></div>';
  const settingsSec = caidQs('.sidebar-section[data-comp="settings"]');
  if (settingsSec) sections.insertBefore(sec, settingsSec);
  else sections.appendChild(sec);
  const collapsed = state.uiPrefs.collapsed && state.uiPrefs.collapsed['plugin:' + def.id];
  if (collapsed) sec.classList.add('collapsed');
  sec.querySelector('.sidebar-header').addEventListener('click', (e) => {
    // kebab 按钮单独处理，不触发折叠
    if (e.target.closest('.plugin-kebab')) return;
    sec.classList.toggle('collapsed');
    state.uiPrefs.collapsed = state.uiPrefs.collapsed || {};
    state.uiPrefs.collapsed['plugin:' + def.id] = sec.classList.contains('collapsed');
    LS.set('uiPrefs', state.uiPrefs);
  });
  // 右键 header 区域：删除插件
  const header = sec.querySelector('.sidebar-header');
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showPluginCtxMenu(e.clientX, e.clientY, def.id, def.name || def.id);
  });
  // kebab 按钮：左键弹出菜单
  const kebab = sec.querySelector('.plugin-kebab');
  if (kebab) kebab.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = kebab.getBoundingClientRect();
    showPluginCtxMenu(r.left, r.bottom + 4, def.id, def.name || def.id);
  });
  pluginRegistry[def.id] = { def: def, iframe: null, mounted: true };
  if (window.lucide) lucide.createIcons();
}

// ============ 主内容区插件挂载点（服务器监控列表下方，mount 视图）============
function injectPluginZone(def) {
  const zone = caidQs('#pluginZone');
  const zoneBody = caidQs('#pluginZoneBody');
  if (!zone || !zoneBody) return;
  // 防重复：同名卡片已存在则只保证可见
  if (zoneBody.querySelector('.plugin-zone-card[data-pid="' + def.id + '"]')) {
    zone.style.display = 'block';
    return;
  }
  const card = document.createElement('div');
  card.className = 'plugin-zone-card';
  card.dataset.pid = def.id;
  card.innerHTML =
    '<div class="plugin-zone-card-head">' +
      '<i data-lucide="' + escapeHtml(def.icon || 'puzzle') + '" style="width:14px;height:14px;"></i>' +
      '<span>' + escapeHtml(def.name || def.id) + '</span>' +
    '</div>';
  const iframe = document.createElement('iframe');
  iframe.className = 'plugin-frame';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.width = '100%';
  iframe.style.border = '0';
  iframe.style.minHeight = '60px';
  iframe.style.background = 'transparent';
  iframe.src = pluginSandboxUrl();   // 关键：不设 src 帧停在 about:blank，沙箱页不加载
  card.appendChild(iframe);
  zoneBody.appendChild(card);
  zone.style.display = 'block';
  if (window.lucide) lucide.createIcons();
  const reg = pluginRegistry[def.id];
  if (reg) reg.iframe = iframe;
  mountPluginInFrame(iframe, def.code, def.id, 'mount', def.name);
}

function removePluginSection(id) {
  const reg = pluginRegistry[id];
  if (reg && reg.iframe) {
    if (reg.iframe.contentWindow) pluginFrameByWin.delete(reg.iframe.contentWindow);
    reg.iframe.remove();   // 移除 iframe 即销毁其内部所有定时器/DOM
  }
  delete pluginRegistry[id];
  const sec = caidQs('.sidebar-section[data-comp="plugin:' + id + '"]');
  if (sec) sec.remove();
  // 同步清理主内容区插件挂载卡片
  const zone = caidQs('#pluginZone');
  const zoneBody = caidQs('#pluginZoneBody');
  if (zoneBody) {
    const card = zoneBody.querySelector('.plugin-zone-card[data-pid="' + id + '"]');
    if (card) card.remove();
    if (zone && !zoneBody.querySelector('.plugin-zone-card')) zone.style.display = 'none';
  }
  removeRightPanel(id, true);
}

// ============ 右侧插件面板（def.panel 视图，显示在主内容区右侧）============
function injectRightPanel(rec) {
  const wrap = caidQs('#rightPanels');
  if (!wrap) return;
  if (wrap.querySelector('.right-panel-card[data-pid="' + rec.id + '"]')) return;   // 防重复
  wrap.classList.add('has-panels');
  const card = document.createElement('div');
  card.className = 'right-panel-card';
  card.dataset.pid = rec.id;
  card.innerHTML =
    '<div class="right-panel-head">' +
      '<span class="right-panel-icon"><i data-lucide="' + escapeHtml(rec.icon || 'puzzle') + '"></i></span>' +
      '<span class="right-panel-title">' + escapeHtml(rec.name || rec.id) + '</span>' +
      '<button class="right-panel-close" title="移除面板"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<iframe class="plugin-frame right-panel-frame" sandbox="allow-scripts" style="min-height:80px;"></iframe>';
  wrap.appendChild(card);
  const iframe = card.querySelector('iframe');
  iframe.src = pluginSandboxUrl();
  card.querySelector('.right-panel-close').addEventListener('click', () => {
    // 用户手动移除：持久化 panelHidden，避免每次打开 newtab 都重新出现
    getPlugins().then(list => {
      const r = list.find(x => x.id === rec.id);
      if (r) { r.panelHidden = true; return savePlugins(list); }
    }).catch(() => {});
    removeRightPanel(rec.id, false);
  });
  mountPluginInFrame(iframe, rec.code, rec.id, 'panel', rec.name);
}

function removeRightPanel(id, quiet) {
  const card = caidQs('.right-panel-card[data-pid="' + id + '"]');
  if (!card) return;
  const iframe = card.querySelector('iframe');
  if (iframe && iframe.contentWindow) pluginFrameByWin.delete(iframe.contentWindow);
  card.remove();
  const wrap = caidQs('#rightPanels');
  if (wrap && !wrap.querySelector('.right-panel-card')) wrap.classList.remove('has-panels');
  if (!quiet) toast('面板已移除');
}

let _pluginRenderToken = 0;
function renderPluginSections() {
  const myToken = ++_pluginRenderToken;
  Object.keys(pluginRegistry).forEach(removePluginSection);
  return getPlugins().then(list => {
    if (myToken !== _pluginRenderToken) return;   // 有更新的渲染任务在跑，本次作废
    list.filter(p => p.enabled !== false).forEach(p => {
      if (p.code) { injectPluginSection(p); injectPluginZone(p); }
      if (p.code && p.hasPanel && !p.panelHidden) injectRightPanel(p);
    });
    // 兼容副驾/外部保存的插件：缺 hasPanel/hasModal 元数据 → 沙箱校验补齐并写回，
    // 补注入右侧面板（若校验出 def.panel() 且用户未手动移除过）
    list.filter(p => p.code && p.hasPanel === undefined && p.hasModal === undefined)
      .forEach(p => {
        validatePluginCode(p.code).then(v => {
          if (!v || !v.def) return;
          return getPlugins().then(lst => {
            const rec = lst.find(x => x.id === p.id);
            if (rec && (rec.hasPanel !== !!v.def.hasPanel || rec.hasModal !== !!v.def.hasModal)) {
              rec.hasPanel = !!v.def.hasPanel;
              rec.hasModal = !!v.def.hasModal;
              return savePlugins(lst);
            }
          }).then(() => {
            if (v.def.hasPanel && !p.panelHidden && !caidQs('.right-panel-card[data-pid="' + p.id + '"]')) {
              injectRightPanel({ ...p, hasPanel: true, hasModal: !!v.def.hasModal });
            }
          });
        }).catch(() => {});
      });
  });
}

function loadPlugins() { return renderPluginSections(); }

function renderPluginList() {
  const listEl = caidQs('#pluginList');
  if (!listEl) return Promise.resolve();
  return getPlugins().then(list => {
    if (!list.length) {
      listEl.innerHTML = '<div class="plugin-empty">还没有插件。点「插入模板」写一个，或参考仓库 PLUGINS.md。</div>';
      return;
    }
    listEl.innerHTML = list.map(p =>
      '<div class="plugin-item" data-id="' + escapeHtml(p.id) + '">' +
        '<span class="plugin-item-name">' + escapeHtml(p.name || p.id) + '</span>' +
        '<span class="plugin-item-id">' + escapeHtml(p.id) + '</span>' +
        '<span class="plugin-item-spacer"></span>' +
        '<button class="plugin-item-btn" data-act="edit">编辑</button>' +
        '<button class="plugin-item-btn danger" data-act="del">删除</button>' +
        '<button class="plugin-toggle ' + (p.enabled !== false ? 'on' : '') + '" data-act="toggle" title="启用/停用"></button>' +
      '</div>'
    ).join('');
    caidQsa('.plugin-item', listEl).forEach(item => {
      const id = item.dataset.id;
      item.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
        const lst = await getPlugins();
        const rec = lst.find(x => x.id === id);
        if (!rec) return;
        rec.enabled = rec.enabled === false;
        await savePlugins(lst);
        renderPluginList(); renderPluginSections();
      });
      item.querySelector('[data-act="del"]').addEventListener('click', async () => {
        const name = item.querySelector('.plugin-item-name').textContent;
        if (!(await caidConfirm({ title: '删除插件', message: `确定删除插件「${name}」？`, danger: true, okText: '删除', icon: 'trash-2' }))) return;
        const lst = (await getPlugins()).filter(x => x.id !== id);
        await savePlugins(lst);
        delete pluginSharedStore[id];
        cleanupPluginRuntime(id);
        renderPluginList(); renderPluginSections();
      });
      item.querySelector('[data-act="edit"]').addEventListener('click', () => {
        getPlugins().then(lst2 => {
          const rec = lst2.find(x => x.id === id);
          if (!rec) return;
          caidQs('#pluginName').value = rec.name || '';
          caidQs('#pluginIcon').value = rec.icon || '';
          caidQs('#pluginEditor').value = rec.code || '';
          caidQs('#pluginErr').textContent = '';
          const cancel = caidQs('#pluginCancelEdit');
          cancel.style.display = '';
          cancel.dataset.editId = id;
          caidQs('#savePluginBtn').textContent = '更新插件';
        });
      });
    });
  });
}

// 兜底：从代码里粗略提取插件 id（校验帧不可用时使用）
function extractPluginIdFromCode(code) {
  const m = code.match(/id\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : ('plugin-' + Date.now());
}

async function savePlugin() {
  const code = caidQs('#pluginEditor').value.trim();
  const errEl = caidQs('#pluginErr');
  errEl.textContent = '';
  if (!code) { errEl.textContent = '请先编写插件代码'; return; }
  // best-effort 校验：校验帧正常时拦截语法错误；若沙箱帧加载异常/超时，validatePluginCode
  // 内部已兜底返回 skipped，保证「保存」永远有反应（不再因 await 卡在隐藏帧上而静默无响应）
  let validation = null;
  try {
    validation = await validatePluginCode(code);
  } catch (e) {
    validation = { ok: true, skipped: true };
  }
  if (validation && validation.error && !validation.skipped) {
    errEl.textContent = '代码解析错误：' + validation.error;
    return;
  }
  // 取 def 元数据：校验成功用沙箱解析结果；兜底时从输入框/代码提取
  const def = (validation && validation.def) ? validation.def : {};
  if (!def.id) def.id = extractPluginIdFromCode(code);
  const hName = caidQs('#pluginName').value.trim();
  const hIcon = caidQs('#pluginIcon').value.trim();
  if (hName) def.name = hName; else if (!def.name) def.name = def.id;
  if (hIcon) def.icon = hIcon; else if (!def.icon) def.icon = 'puzzle';
  const cancel = caidQs('#pluginCancelEdit');
  const editId = cancel.dataset.editId;
  const vdef = (validation && validation.def) ? validation.def : null;
  const list = await getPlugins();
  const buildRec = (prev) => ({
    id: def.id,
    name: def.name,
    icon: def.icon,
    enabled: prev ? prev.enabled !== false : true,
    panelHidden: prev ? !!prev.panelHidden : false,      // 用户手动移除右侧面板后保持隐藏
    hasPanel: !!(vdef && vdef.hasPanel),                  // 沙箱元数据：是否提供 def.panel()
    hasModal: !!(vdef && vdef.hasModal),                  // 是否提供 def.modal()
    code
  });
  if (editId) {
    def.id = editId;                       // 编辑时锁定 id，避免记录键漂移
    const i = list.findIndex(x => x.id === editId);
    if (i >= 0) list[i] = buildRec(list[i]);
    else list.push(buildRec(null));
  } else {
    if (list.some(x => x.id === def.id)) { errEl.textContent = '插件 id「' + def.id + '」已存在，请改用其他 id 或点编辑'; return; }
    list.push(buildRec(null));
  }
  await savePlugins(list);
  caidQs('#pluginEditor').value = '';
  caidQs('#pluginName').value = '';
  caidQs('#pluginIcon').value = '';
  clearPluginDraft();
  cancel.style.display = 'none';
  delete cancel.dataset.editId;
  caidQs('#savePluginBtn').textContent = '保存为新插件';
  renderPluginList(); renderPluginSections();
  toast('插件已保存');
}

const pluginTplBtn = caidQs('#pluginTplBtn');
if (pluginTplBtn) pluginTplBtn.addEventListener('click', () => {
  caidQs('#pluginEditor').value = PLUGIN_TEMPLATE;
  caidQs('#pluginErr').textContent = '';
});
const savePluginBtn = caidQs('#savePluginBtn');
if (savePluginBtn) savePluginBtn.addEventListener('click', savePlugin);
const pluginCancelEdit = caidQs('#pluginCancelEdit');
if (pluginCancelEdit) pluginCancelEdit.addEventListener('click', () => {
  caidQs('#pluginEditor').value = '';
  caidQs('#pluginName').value = '';
  caidQs('#pluginIcon').value = '';
  clearPluginDraft();
  pluginCancelEdit.style.display = 'none';
  delete pluginCancelEdit.dataset.editId;
  caidQs('#savePluginBtn').textContent = '保存为新插件';
  caidQs('#pluginErr').textContent = '';
});

// 打开插件编辑器（整站全屏视图，接管整个页面）
const openPluginEditorBtn = caidQs('#openPluginEditorBtn');
if (openPluginEditorBtn) openPluginEditorBtn.addEventListener('click', () => {
  closeModal('settingsModal');
  openPluginEditor();
});
// 侧边栏底部「创建插件」
const sidebarCreatePlugin = caidQs('#sidebarCreatePlugin');
if (sidebarCreatePlugin) sidebarCreatePlugin.addEventListener('click', () => {
  openPluginEditor();
});
// 侧边栏插件右键菜单
let pluginCtxTargetId = null;
function showPluginCtxMenu(x, y, id, name) {
  const menu = caidQs('#pluginCtxMenu');
  if (!menu) return;
  pluginCtxTargetId = id;
  const del = caidQs('#pluginCtxDelete');
  if (del) del.textContent = '删除「' + name + '」';
  menu.classList.add('open');
  const rect = menu.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > window.innerWidth) left = x - rect.width;
  if (top + rect.height > window.innerHeight) top = y - rect.height;
  menu.style.left = Math.max(4, left) + 'px';
  menu.style.top = Math.max(4, top) + 'px';
}
function hidePluginCtxMenu() {
  const menu = caidQs('#pluginCtxMenu');
  if (menu) menu.classList.remove('open');
  pluginCtxTargetId = null;
}
document.addEventListener('click', (e) => {
  const menu = caidQs('#pluginCtxMenu');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target)) hidePluginCtxMenu();
});
window.addEventListener('scroll', hidePluginCtxMenu, true);
const pluginCtxDelete = caidQs('#pluginCtxDelete');
if (pluginCtxDelete) pluginCtxDelete.addEventListener('click', async () => {
  const id = pluginCtxTargetId;
  hidePluginCtxMenu();
  if (!id) return;
  const rec = (await getPlugins()).find(x => x.id === id);
  const name = rec ? (rec.name || id) : id;
  if (!(await caidConfirm({ title: '删除插件', message: `确定删除插件「${name}」？此操作不可撤销。`, danger: true, okText: '删除', icon: 'trash-2' }))) return;
  const lst = (await getPlugins()).filter(x => x.id !== id);
  await savePlugins(lst);
  delete pluginSharedStore[id];
  cleanupPluginRuntime(id);
  renderPluginList(); renderPluginSections();
  toast('已删除插件：' + name);
});
// 菜单「编辑插件」：加载插件代码到编辑器并打开
const pluginCtxEdit = caidQs('#pluginCtxEdit');
if (pluginCtxEdit) pluginCtxEdit.addEventListener('click', () => {
  const id = pluginCtxTargetId;
  hidePluginCtxMenu();
  if (!id) return;
  getPlugins().then(list => {
    const rec = list.find(x => x.id === id);
    if (!rec) return;
    caidQs('#pluginName').value = rec.name || '';
    caidQs('#pluginIcon').value = rec.icon || '';
    caidQs('#pluginEditor').value = rec.code || '';
    caidQs('#pluginErr').textContent = '';
    const cancel = caidQs('#pluginCancelEdit');
    cancel.style.display = '';
    cancel.dataset.editId = id;
    caidQs('#savePluginBtn').textContent = '更新插件';
    openPluginEditor();
  });
});

// 新建：清空编辑器
const pluginNewBtn = caidQs('#pluginNewBtn');
if (pluginNewBtn) pluginNewBtn.addEventListener('click', () => {
  caidQs('#pluginEditor').value = '';
  caidQs('#pluginName').value = '';
  caidQs('#pluginIcon').value = '';
  clearPluginDraft();
  if (pluginCancelEdit) { pluginCancelEdit.style.display = 'none'; delete pluginCancelEdit.dataset.editId; }
  caidQs('#savePluginBtn').textContent = '保存为新插件';
  caidQs('#pluginErr').textContent = '';
});
// 实时预览：在沙箱帧里挂载当前编辑器代码
const pluginPreviewBtn = caidQs('#pluginPreviewBtn');
if (pluginPreviewBtn) pluginPreviewBtn.addEventListener('click', runPluginPreview);
let pluginPreviewReadyHandler = null;
function runPluginPreview() {
  const preview = caidQs('#pluginPreview');
  if (!preview) return;
  const code = caidQs('#pluginEditor').value.trim();
  const errEl = caidQs('#pluginErr');
  if (!code) { errEl.textContent = '请先编写插件代码'; return; }
  if (pluginPreviewReadyHandler) { window.removeEventListener('message', pluginPreviewReadyHandler); pluginPreviewReadyHandler = null; }
  preview.src = pluginSandboxUrl();
  const onReady = function (ev) {
    if (ev.source !== preview.contentWindow) return;
    window.removeEventListener('message', onReady);
    pluginPreviewReadyHandler = null;
    pluginFrameByWin.set(preview.contentWindow, preview);
    preview.contentWindow.postMessage({ __caidPlugin: true, type: 'CAID_PLUGIN_MOUNT', reqId: 'p' + (++pluginMsgSeq), code: code, pluginId: '__preview__' }, '*');
  };
  pluginPreviewReadyHandler = onReady;
  window.addEventListener('message', onReady);
}
// 插件编辑器整站视图：打开 / 关闭
function openPluginEditor() {
  const view = caidQs('#pluginEditorView');
  if (!view) return;
  const app = caidQs('.app');
  if (app) app.style.display = 'none';
  view.classList.add('open');
  // 非「编辑已有插件」状态下，恢复上次未保存的草稿
  const cancel = caidQs('#pluginCancelEdit');
  if (!cancel || !cancel.dataset.editId) {
    if (restorePluginDraft()) toast('已恢复上次未保存的草稿');
  }
  renderPluginList();
  if (window.lucide) lucide.createIcons();
}
function closePluginEditor() {
  const view = caidQs('#pluginEditorView');
  if (!view) return;
  view.classList.remove('open');
  const app = caidQs('.app');
  if (app) app.style.display = '';
  const pv = caidQs('#pluginPreview');
  if (pv) { if (pv.contentWindow) pluginFrameByWin.delete(pv.contentWindow); pv.src = 'about:blank'; }
}
const pluginEditorBack = caidQs('#pluginEditorBack');
if (pluginEditorBack) pluginEditorBack.addEventListener('click', closePluginEditor);

// 插件教程：全屏阅读 PLUGINS.md（marked 渲染 + hljs 高亮，加载一次缓存）
const PLUGIN_TUTORIAL_URL =
  (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('PLUGINS.md') : 'PLUGINS.md';
function openPluginTutorial() {
  const view = caidQs('#pluginTutorialView');
  if (!view) return;
  view.classList.add('open');
  const body = caidQs('#pluginTutorialBody');
  if (body && !body.dataset.loaded) {
    body.innerHTML = '<p style="color:var(--muted);padding:12px 2px;">正在加载插件开发指南…</p>';
    fetch(PLUGIN_TUTORIAL_URL)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(md => {
        body.dataset.loaded = '1';
        body.innerHTML = window.marked ? marked.parse(md) : '<pre>' + escapeHtml(md) + '</pre>';
        if (window.hljs) body.querySelectorAll('pre code').forEach(el => { try { hljs.highlightElement(el); } catch (e) {} });
        // 外链新标签打开，避免打断教程阅读（内部锚点链接除外）
        body.querySelectorAll('a[href]').forEach(a => {
          if (a.getAttribute('href').charAt(0) !== '#') a.target = '_blank';
        });
      })
      .catch(err => {
        body.innerHTML = '<div style="color:var(--danger);padding:16px 2px;">加载插件开发指南失败：' +
          escapeHtml(String((err && err.message) || err)) +
          '<br>请确认扩展包内存在 <code>PLUGINS.md</code> 文件。</div>';
      });
  }
  if (window.lucide) lucide.createIcons();
}
function closePluginTutorial() {
  const view = caidQs('#pluginTutorialView');
  if (view) view.classList.remove('open');
}
const pluginTutorialBtn = caidQs('#pluginTutorialBtn');
if (pluginTutorialBtn) pluginTutorialBtn.addEventListener('click', openPluginTutorial);
const pluginTutorialBack = caidQs('#pluginTutorialBack');
if (pluginTutorialBack) pluginTutorialBack.addEventListener('click', closePluginTutorial);

// ============ 更新日志（侧边栏底部入口 → 全屏阅读 CHANGELOG.md）============
const CHANGELOG_URL = chrome.runtime.getURL('CHANGELOG.md');
function openChangelog() {
  const view = caidQs('#changelogView');
  if (!view) return;
  view.classList.add('open');
  const body = caidQs('#changelogBody');
  if (body && !body.dataset.loaded) {
    body.innerHTML = '<p style="color:var(--muted);padding:12px 2px;">正在加载更新日志…</p>';
    fetch(CHANGELOG_URL)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(md => {
        body.dataset.loaded = '1';
        body.innerHTML = window.marked ? marked.parse(md) : '<pre>' + escapeHtml(md) + '</pre>';
        if (window.hljs) body.querySelectorAll('pre code').forEach(el => { try { hljs.highlightElement(el); } catch (e) {} });
        // 外链新标签打开（内部锚点除外），避免打断阅读
        body.querySelectorAll('a[href]').forEach(a => {
          if (a.getAttribute('href').charAt(0) !== '#') a.target = '_blank';
        });
      })
      .catch(err => {
        body.innerHTML = '<div style="color:var(--danger);padding:16px 2px;">加载更新日志失败：' +
          escapeHtml(String((err && err.message) || err)) +
          '<br>请确认扩展包内存在 <code>CHANGELOG.md</code> 文件。</div>';
      });
  }
  if (window.lucide) lucide.createIcons();
}
function closeChangelog() {
  const view = caidQs('#changelogView');
  if (view) view.classList.remove('open');
}
const sidebarChangelogBtn = caidQs('#sidebarChangelog');
if (sidebarChangelogBtn) sidebarChangelogBtn.addEventListener('click', openChangelog);
const changelogBack = caidQs('#changelogBack');
if (changelogBack) changelogBack.addEventListener('click', closeChangelog);

// ============ 插件编辑器：单层 textarea（2026-08-19 移除语法高亮层）============
// 此前采用「textarea 透明文字 + 底层 pre hljs 高亮」双层结构，换行/滚动条占位差异
// 导致两层逐行错位、无法根治 → 移除高亮层，textarea 直接显示文字，天然零错位。

// ============ 插件编辑器：草稿缓存（输入防抖落盘；保存/取消/新建时清除）============
const PLUGIN_DRAFT_KEY = 'caidPluginDraft';
const savePluginDraftDeb = debounce(() => {
  const code = caidQs('#pluginEditor').value;
  const name = caidQs('#pluginName').value;
  const icon = caidQs('#pluginIcon').value;
  if (!code.trim() && !name.trim()) { LS.del(PLUGIN_DRAFT_KEY); return; }
  LS.set(PLUGIN_DRAFT_KEY, { code, name, icon, ts: Date.now() });
}, 600);
function restorePluginDraft() {
  const d = LS.get(PLUGIN_DRAFT_KEY, null);
  if (!d) return false;
  const ta = caidQs('#pluginEditor'); if (ta) ta.value = d.code || '';
  const n = caidQs('#pluginName'); if (n) n.value = d.name || '';
  const ic = caidQs('#pluginIcon'); if (ic) ic.value = d.icon || '';
  return true;
}
function clearPluginDraft() { LS.del(PLUGIN_DRAFT_KEY); }

const pluginEditorTa = caidQs('#pluginEditor');
if (pluginEditorTa) {
  pluginEditorTa.addEventListener('input', () => { savePluginDraftDeb(); });
  // Tab 插入两空格缩进，不跳出编辑器
  pluginEditorTa.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = pluginEditorTa.selectionStart, en = pluginEditorTa.selectionEnd;
    pluginEditorTa.setRangeText('  ', s, en, 'end');
    pluginEditorTa.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
['#pluginName', '#pluginIcon'].forEach(sel => {
  const el = caidQs(sel);
  if (el) el.addEventListener('input', savePluginDraftDeb);
});

// ============ Init ============
async function init() {
  // （新标签页接管已改为 background 动态接管：newtab.html 只在开关开启或用户主动打开时出现，
  //   不再需要此处的自检与停用提示页）

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
  loadAgentTasks();
  updateCounts();
  loadServers().then(() => probeAll());
  setInterval(() => { if (document.visibilityState === 'visible') probeAll(); }, 30000);

  // 插件：加载并渲染已启用的侧边栏区块
  loadPlugins();

  // Sidebar settings buttons
  const btnOpenSettings = caidQs('#sidebarOpenSettings');
  if (btnOpenSettings) btnOpenSettings.addEventListener('click', () => openModal('settingsModal', () => { fillGeneralForm(); fillSettingsForm(); fillCopilotForm(); renderServerList(); renderPluginList(); }));
  const btnSetHome = caidQs('#sidebarSetHome');
  if (btnSetHome) btnSetHome.addEventListener('click', openHomepageModal);

  // Icons
  if (window.lucide) lucide.createIcons();

  // Marked options
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
  }

  // options_ui 入口（右键图标→选项）：newtab.html#settings 自动弹出设置 Modal
  if (location.hash === '#settings') {
    setTimeout(() => openModal('settingsModal', () => { fillGeneralForm(); fillSettingsForm(); fillCopilotForm(); renderServerList(); renderPluginList(); }), 150);
  }
}

// 副驾任务实时同步：副驾在任意页面完成任务 → background 写 caidMemory → 本页监听变化刷新 sidebar
try {
  if (storageAvailable() && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.caidMemory) loadAgentTasks();
      if (changes.caidServers) loadServers();
      if (changes.caidPlugins) { renderPluginList(); renderPluginSections(); }
    });
  }
} catch (e) {}

init();

