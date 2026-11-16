// BHC debug overlay (rebuild only, not part of the original app).
// Shows console output, JS errors and fetch() traffic on screen; also keeps them in window.__bhcLog.
// Toggle visibility: tap the top-left corner 3x quickly.
(function () {
  var MAX = 60;
  var log = (window.__bhcLog = []);
  var box;

  function fmt(a) {
    if (a instanceof Error || (a && a.message && a.stack)) return a.name + ': ' + a.message + ' | ' + String(a.stack || '').split('\n').slice(0, 3).join(' < ');
    if (a && typeof a === 'object' && a.constructor && /Error|Exception/.test(a.constructor.name)) return a.constructor.name + ': ' + (a.message || String(a));
    try { var j = typeof a === 'string' ? a : JSON.stringify(a); return j === '{}' ? Object.prototype.toString.call(a) + ' ' + String(a) : j; } catch (e) { return String(a); }
  }
  function push(kind, args) {
    var t = new Date().toISOString().slice(11, 23);
    var line = t + ' ' + kind + ' ' + Array.prototype.map.call(args, fmt).join(' ');
    log.push(line);
    if (log.length > 500) log.shift();
    if (box) {
      var div = document.createElement('div');
      div.textContent = line;
      if (kind === 'ERR' || kind === 'error') div.style.color = '#ff6b6b';
      else if (kind === 'NET') div.style.color = '#7fd1ff';
      else if (kind === 'warn') div.style.color = '#ffd166';
      box.appendChild(div);
      while (box.childNodes.length > MAX) box.removeChild(box.firstChild);
      box.scrollTop = box.scrollHeight;
    }
  }

  var inLog = false;
  function wrapConsole() {
    var c = window.console;
    if (!c || c.__bhc) return;
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (k) {
      var orig = c[k] ? c[k].bind(c) : function () {};
      // Re-entrancy guard: Cordova's console plugin replaces window.console with one that calls the previous
      // (already wrapped) console, so after a re-wrap one call would be logged twice.
      c[k] = function () {
        if (inLog) return orig.apply(null, arguments);
        inLog = true;
        try { push(k, arguments); orig.apply(null, arguments); } finally { inLog = false; }
      };
    });
    try { c.__bhc = true; } catch (e) {}
  }
  wrapConsole();
  // Cordova's console plugin replaces window.console while booting: wrap again as early as possible.
  document.addEventListener('deviceready', wrapConsole, true);
  var wcTries = 0, wcTimer = setInterval(function () { wrapConsole(); if (++wcTries > 50) clearInterval(wcTimer); }, 100);
  window.addEventListener('error', function (e) {
    push('ERR', [e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || '')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    push('ERR', ['unhandled rejection: ' + (r && (r.stack || r.message) || fmt(r))]);
  });

  function wrapFetch() {
    if (!window.fetch || window.fetch.__bhc) return;
    var orig = window.fetch;
    var wrapped = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      var t0 = Date.now();
      push('NET', ['-> ' + url]);
      var slow = setTimeout(function () { push('NET', ['... still pending after 10 s: ' + url]); }, 10000);
      return orig.apply(this, arguments).then(function (r) {
        clearTimeout(slow);
        push('NET', ['<- ' + r.status + ' ' + url + ' (' + (Date.now() - t0) + ' ms)']);
        return r;
      }, function (err) {
        clearTimeout(slow);
        push('NET', ['xx ' + url + ' ' + (err && err.message || err) + ' (' + (Date.now() - t0) + ' ms)']);
        throw err;
      });
    };
    wrapped.__bhc = true;
    window.fetch = wrapped;
  }
  wrapFetch();
  // cordova-plugin-ios-xhr replaces fetch while Cordova boots; wrap its version too.
  document.addEventListener('deviceready', function () {
    wrapFetch();
    push('info', ['deviceready']);
    // DOM snapshot: what screen is the game on?
    [3000, 8000, 15000].forEach(function (ms) {
      setTimeout(function () {
        var app = document.getElementById('appContainer');
        var first = app && app.firstElementChild;
        push('info', ['@' + ms / 1000 + 's body.class="' + document.body.className + '" appContainer: ' +
          (app ? app.children.length + ' children, html ' + app.innerHTML.length + ' B' : 'missing') +
          (first ? ', first=<' + first.tagName.toLowerCase() + ' id="' + first.id + '" class="' + first.className + '">' : '') +
          ' videos=' + document.querySelectorAll('video').length]);
      }, ms);
    });
    // Native bridge watch: report plugin calls (cordova.callbacks ids like "Service123") that wait > 2 s.
    var seen = {};
    setInterval(function () {
      var cbs = (window.cordova && window.cordova.callbacks) || {};
      var now = Date.now();
      // Long-lived listeners (keepCallback) are expected to stay open; don't report them.
      var QUIET = /^(NetworkStatus|StatusBar|Battery|Media|Diagnostic|BluetoothLe|Insomnia)/;
      Object.keys(cbs).forEach(function (id) {
        if (QUIET.test(id)) return;
        if (!seen[id]) seen[id] = { t: now, reported: false };
        var s = seen[id];
        if (!s.reported && now - s.t > 2000) {
          s.reported = true;
          push('warn', ['native call pending: ' + id.replace(/\d+$/, '') + ' (' + id + ')']);
        }
      });
      Object.keys(seen).forEach(function (id) {
        if (!cbs[id]) {
          if (seen[id].reported) push('info', ['native call finished: ' + id + ' after ' + (now - seen[id].t) + ' ms']);
          delete seen[id];
        }
      });
    }, 1000);
  });

  document.addEventListener('DOMContentLoaded', function () {
    box = document.createElement('div');
    box.id = 'bhc-debug';
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:30%;overflow:auto;z-index:2147483647;' +
      'background:rgba(0,0,0,.75);color:#ddd;font:10px/1.25 Menlo,monospace;zoom:1;transform:none;padding:4px 6px;pointer-events:none;white-space:pre-wrap';
    document.documentElement.appendChild(box); // not body: the game scales body
    log.slice(-MAX).forEach(function (l) { var d = document.createElement('div'); d.textContent = l; box.appendChild(d); });
    var taps = [];
    document.addEventListener('touchstart', function (e) {
      var p = e.touches[0];
      if (!p || p.clientX > 60 || p.clientY > 60) return;
      var now = Date.now();
      taps = taps.filter(function (t) { return now - t < 800; }).concat(now);
      if (taps.length >= 3) { box.style.display = box.style.display === 'none' ? '' : 'none'; taps = []; }
    }, true);
  });
})();
