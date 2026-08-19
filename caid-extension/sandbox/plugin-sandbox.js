/* CAID 插件沙箱运行时
 * 该页面由父页面(newtab)以 <iframe sandbox="allow-scripts"> 嵌入。
 * 沙箱页拥有独立的 null 源，且 CSP 允许 'unsafe-eval'，因此可安全地用 new Function 执行用户插件代码，
 * 但无法访问任何 chrome.* API —— 需要的 storage / fetch / toast 一律通过 postMessage 桥接给父页面。
 */
(function () {
  'use strict';
  var NS = 'caidPlugin:';
  var reqSeq = 0;
  var pending = new Map();      // reqId -> resolve
  var timers = new Set();
  var cleanups = [];
  var sharedCache = {};         // 跨视图共享对象（同插件所有视图共享，仅当前页面会话有效）

  function post(msg) { parent.postMessage(Object.assign({ __caidPlugin: true }, msg), '*'); }

  function bridge(op, data) {
    var reqId = ++reqSeq;
    return new Promise(function (resolve) {
      pending.set(reqId, resolve);
      post({ type: 'CAID_BRIDGE', op: op, reqId: reqId, data: data });
    });
  }

  function makeApi(pluginId, container) {
    // 跨视图共享对象：同插件所有视图（mount/panel/modal）经父页内存中转共享同一份数据，
    // 任一视图 set 后父页广播给该插件其他帧。仅当前页面会话内有效，刷新即清空。
    bridge('sharedGet', {}).then(function (v) {
      if (v && typeof v === 'object') {
        Object.keys(sharedCache).forEach(function (k) { delete sharedCache[k]; });
        Object.assign(sharedCache, v);
      }
    }).catch(function () {});
    var shared = new Proxy(sharedCache, {
      set: function (t, k, v) { t[k] = v; bridge('sharedSet', { value: t }); return true; },
      deleteProperty: function (t, k) { delete t[k]; bridge('sharedSet', { value: t }); return true; }
    });

    function el(tag, props) {
      var node = document.createElement(tag);
      if (props) {
        for (var k in props) {
          if (k === 'className') node.className = props[k];
          else if (k === 'text') node.textContent = props[k];
          else if (k === 'html') node.innerHTML = props[k];
          else if (k === 'onClick') node.addEventListener('click', props[k]);
          else if (k === 'style' && typeof props[k] === 'object') Object.assign(node.style, props[k]);
          else if (k === 'dataset' && typeof props[k] === 'object') Object.assign(node.dataset, props[k]);
          else node.setAttribute(k, props[k]);
        }
      }
      return node;
    }
    return {
      container: container,
      el: el,
      shared: shared,
      storage: {
        get: function (key) {
          return bridge('storageGet', { key: NS + pluginId + ':' + key })
            .then(function (r) { return r && r.value; });
        },
        set: function (key, val) {
          return bridge('storageSet', { key: NS + pluginId + ':' + key, value: val });
        }
      },
      // 返回标准 Response 对象（ok / status / text() / json() 与浏览器 fetch 一致）；
      // res.raw 附带 { ok, status, statusText, text, json, headers } 兼容旧版字段
      fetch: function (url, opt) {
        return bridge('fetch', { url: url, opt: opt }).then(function (r) {
          if (!r) throw new Error('fetch 桥接失败');
          if (r.error) throw new Error(r.error);
          var st = (typeof r.status === 'number' && r.status >= 200 && r.status <= 599) ? r.status : 200;
          var body = String(r.text == null ? '' : r.text);
          var res;
          try {
            res = new Response(body, {
              status: st,
              statusText: r.statusText || '',
              headers: r.headers || {}
            });
          } catch (e) {
            res = new Response(body, { status: 200 });
          }
          res.raw = r;   // 旧代码兼容：res.raw.text / res.raw.json / res.raw.ok / res.raw.status
          return res;
        });
      },
      toast: function (msg) { post({ type: 'CAID_TOAST', msg: String(msg) }); },
      // 打开本插件的弹窗视图（父页面创建弹窗帧，mode=modal 调用 def.modal(api)）
      modal: function (opts) {
        return bridge('modalOpen', { title: opts && opts.title, width: opts && opts.width });
      },
      // 关闭当前弹窗（仅在 modal 视图内调用有效）
      closeModal: function () { post({ type: 'CAID_PLUGIN_MODAL_CLOSE' }); },
      setInterval: function (fn, ms) { var id = setInterval(fn, ms); timers.add(id); return id; },
      setTimeout: function (fn, ms) { var id = setTimeout(fn, ms); timers.add(id); return id; },
      onUnmount: function (fn) { if (typeof fn === 'function') cleanups.push(fn); }
    };
  }

  function clearTimers() {
    timers.forEach(function (id) { clearInterval(id); clearTimeout(id); });
    timers.clear();
    cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
    cleanups = [];
  }

  function reportSize() {
    var h = Math.ceil(document.body.scrollHeight || document.documentElement.scrollHeight || 0);
    post({ type: 'CAID_PLUGIN_SIZE', height: h });
  }

  function runCode(code, pluginId, mode) {
    var defs = [];
    var CAID = {
      version: 1,
      plugin: function (def) {
        if (def && def.id &&
            (typeof def.mount === 'function' || typeof def.panel === 'function' || typeof def.modal === 'function')) {
          defs.push(def);
        }
      }
    };
    try {
      var fn = new Function('CAID', '"use strict";\n' + code);
      fn(CAID);
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    var def = defs[0];
    if (!def) return { ok: false, error: '未找到 CAID.plugin(...) 调用' };
    if (mode === 'validate') {
      // 只回传可序列化元数据（函数过不了 postMessage 的 structured clone）
      return { ok: true, def: {
        id: def.id,
        name: def.name,
        icon: def.icon,
        hasPanel: typeof def.panel === 'function',
        hasModal: typeof def.modal === 'function'
      } };
    }

    // mount / panel / modal：分别执行 def.mount / def.panel / def.modal
    clearTimers();
    var root = document.getElementById('pluginRoot');
    root.innerHTML = '';
    var api = makeApi(pluginId || def.id, root);
    reportSize();
    var viewFn = mode === 'modal' ? def.modal : (mode === 'panel' ? def.panel : def.mount);
    if (typeof viewFn !== 'function') {
      var vname = mode === 'modal' ? 'modal()' : (mode === 'panel' ? 'panel()' : 'mount()');
      root.innerHTML = '<div class="plugin-err">该插件未提供 ' + vname + ' 视图</div>';
      return { ok: false, error: 'no ' + (mode || 'mount') + ' view' };
    }
    try {
      viewFn(api);
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      root.innerHTML = '<div class="plugin-err">插件运行出错：' + escapeHtmlLocal(msg) + '</div>';
      return { ok: false, error: msg };
    }
    // 内容动态变化时同步高度
    if (typeof ResizeObserver !== 'undefined') {
      try {
        var ro = new ResizeObserver(reportSize);
        ro.observe(document.body);
      } catch (e) {}
    }
    reportSize();
    return { ok: true, def: def };
  }

  function escapeHtmlLocal(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || !d.__caidPlugin) return;

    if (d.type === 'CAID_BRIDGE_RES') {
      var resolve = pending.get(d.reqId);
      if (resolve) { pending.delete(d.reqId); resolve(d.payload); }
      return;
    }
    if (d.type === 'CAID_PLUGIN_SHARED_SYNC') {
      // 同插件其他视图更新了共享对象 → 同步本地镜像
      if (d.value && typeof d.value === 'object') {
        Object.keys(sharedCache).forEach(function (k) { delete sharedCache[k]; });
        Object.assign(sharedCache, d.value);
      }
      return;
    }
    if (d.type === 'CAID_PLUGIN_VALIDATE') {
      var r = runCode(d.code, d.pluginId, 'validate');
      post({ type: 'CAID_PLUGIN_VALIDATED', reqId: d.reqId, ok: r.ok, error: r.error, def: r.def });
      return;
    }
    if (d.type === 'CAID_PLUGIN_MOUNT') {
      var m = runCode(d.code, d.pluginId, d.mode || 'mount');
      post({ type: m.ok ? 'CAID_PLUGIN_READY' : 'CAID_PLUGIN_ERROR', reqId: d.reqId, error: m.error, def: m.def });
      return;
    }
  });

  post({ type: 'CAID_SANDBOX_READY' });
})();
