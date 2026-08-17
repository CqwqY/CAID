
// syntax error self-report (MUST run BEFORE any other <script> blocks)
(function(){
  function caidErrRep(msg, url, line, col, err) {
    try {
      var payload = 'CAID_ERR|' + Date.now() + '|' + encodeURIComponent(String(msg||'')) +
        '|L=' + (line||0) + '|C=' + (col||0) + '|src=' + encodeURIComponent(String(url||''));
      if (err && err.stack) payload += '|S=' + encodeURIComponent(String(err.stack).slice(0,500));
      location.hash = payload;
    } catch(_) {}
  }
  window.addEventListener('error', function(e){ caidErrRep(e.message, e.filename, e.lineno, e.colno, e.error); });
  window.addEventListener('unhandledrejection', function(e){
    try { caidErrRep('UNHANDLED: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)), '', 0, 0, e.reason); } catch(_){}
  });
})();
