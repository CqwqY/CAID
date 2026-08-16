// CAID 扩展 fetch 代理垫片（MAIN world，由 background 以 executeScript 最先注入）
// 仅暴露 window.__CAID_FETCH：把请求经 chrome.runtime.connect 转发到 background service worker，
// 由 background 用 Chrome 网络栈（继承系统代理、不受宿主页 CSP / CORS 限制）发出，支持流式响应与 AbortSignal。
// 注意：本文件【不】全局覆盖 window.fetch，避免把宿主页面自己的跨域请求（带登录态 cookie）也拐进后台导致串台。
// 真正只针对"LLM 域名"的劫持，由 caid-copilot.js 在 new PageAgent 之前安装。
(function () {
  if (window.__CAID_FETCH) return;

  function base64ToBytes(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function bytesToBase64(bytes) {
    var bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function normalizeHeaders(h) {
    var out = {};
    if (!h) return out;
    if (typeof Headers !== 'undefined' && h instanceof Headers) { h.forEach(function (v, k) { out[String(k).toLowerCase()] = v; }); return out; }
    if (Array.isArray(h)) { h.forEach(function (p) { out[String(p[0]).toLowerCase()] = p[1]; }); return out; }
    for (var k in h) out[String(k).toLowerCase()] = h[k];
    return out;
  }

  function caidFetch(url, init) {
    return new Promise(function (resolve, reject) {
      if (!chrome || !chrome.runtime || !chrome.runtime.connect) { reject(new Error('CAID 代理不可用')); return; }
      var port;
      try { port = chrome.runtime.connect({ name: 'caid-fetch' }); }
      catch (e) { reject(e); return; }

      var controller = null, pending = [], meta = null, finished = false;
      function enqueue(bytes) {
        if (controller) { try { controller.enqueue(bytes); } catch (e) {} }
        else pending.push(bytes);
      }
      var stream = new ReadableStream({
        start: function (c) {
          controller = c;
          while (pending.length) { try { c.enqueue(pending.shift()); } catch (e) {} }
          if (finished) { try { c.close(); } catch (e) {} }
        },
        cancel: function () { try { port.disconnect(); } catch (e) {} }
      });

      port.onMessage.addListener(function (msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'meta') {
          meta = msg;
          try {
            var resp = new Response(stream, {
              status: meta.status || 200,
              statusText: meta.statusText || '',
              headers: meta.headers || {}
            });
            resolve(resp);
          } catch (e) { reject(e); try { port.disconnect(); } catch (_) {} }
        } else if (msg.type === 'chunk') {
          if (msg.b64) enqueue(base64ToBytes(msg.b64));
        } else if (msg.type === 'done') {
          finished = true;
          if (controller) { try { controller.close(); } catch (e) {} }
          try { port.disconnect(); } catch (e) {}
        } else if (msg.type === 'error') {
          var err = new Error(msg.message || 'CAID 代理错误');
          if (controller) { try { controller.error(err); } catch (e) {} }
          else reject(err);
          try { port.disconnect(); } catch (e) {}
        }
      });

      port.onDisconnect.addListener(function () {
        if (!finished && !meta) reject(new Error('CAID 代理连接中断'));
        else if (controller && !finished) { try { controller.close(); } catch (e) {} }
      });

      var method = (init && init.method) || 'GET';
      var headers = normalizeHeaders(init && init.headers);
      var bodyStr = null, bodyB64 = null;
      if (init && init.body != null) {
        if (typeof init.body === 'string') bodyStr = init.body;
        else if (init.body instanceof ArrayBuffer) bodyB64 = bytesToBase64(new Uint8Array(init.body));
        else if (ArrayBuffer.isView(init.body)) bodyB64 = bytesToBase64(new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength));
        else bodyStr = String(init.body);
      }
      try { port.postMessage({ url: String(url), method: method, headers: headers, body: bodyStr, bodyB64: bodyB64 }); }
      catch (e) { reject(e); try { port.disconnect(); } catch (_) {} }

      if (init && init.signal) {
        init.signal.addEventListener('abort', function () { try { port.disconnect(); } catch (e) {} }, { once: true });
      }
    });
  }

  window.__CAID_FETCH = caidFetch;
})();
