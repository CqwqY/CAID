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

  function post(msg) { parent.postMessage(Object.assign({ __caidPlugin: true }, msg), '*'); }

  function bridge(op, data) {
    var reqId = ++reqSeq;
    return new Promise(function (resolve) {
      pending.set(reqId, resolve);
      post({ type: 'CAID_BRIDGE', op: op, reqId: reqId, data: data });
    });
  }

  function makeApi(pluginId, container) {
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
      storage: {
        get: function (key) {
          return bridge('storageGet', { key: NS + pluginId + ':' + key })
            .then(function (r) { return r && r.value; });
        },
        set: function (key, val) {
          return bridge('storageSet', { key: NS + pluginId + ':' + key, value: val });
        }
      },
      fetch: function (url, opt) { return bridge('fetch', { url: url, opt: opt }); },
      toast: function (msg) { post({ type: 'CAID_TOAST', msg: String(msg) }); },
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
      plugin: function (def) { if (def && def.id && typeof def.mount === 'function') defs.push(def); }
    };
    try {
      var fn = new Function('CAID', '"use strict";\n' + code);
      fn(CAID);
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    var def = defs[0];
    if (!def) return { ok: false, error: '未找到 CAID.plugin(...) 调用' };
    if (mode === 'validate') return { ok: true, def: def };

    // mount
    clearTimers();
    var root = document.getElementById('pluginRoot');
    root.innerHTML = '';
    var api = makeApi(pluginId || def.id, root);
    reportSize();
    try {
      def.mount(api);
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
    if (d.type === 'CAID_PLUGIN_VALIDATE') {
      var r = runCode(d.code, d.pluginId, 'validate');
      post({ type: 'CAID_PLUGIN_VALIDATED', reqId: d.reqId, ok: r.ok, error: r.error, def: r.def });
      return;
    }
    if (d.type === 'CAID_PLUGIN_MOUNT') {
      var m = runCode(d.code, d.pluginId, 'mount');
      post({ type: m.ok ? 'CAID_PLUGIN_READY' : 'CAID_PLUGIN_ERROR', reqId: d.reqId, error: m.error, def: m.def });
      return;
    }
  });

  post({ type: 'CAID_SANDBOX_READY' });
})();
