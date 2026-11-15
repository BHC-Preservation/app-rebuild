// BHC compat shims (rebuild only). Loaded before cordova.js and the game.
// Each shim fixes behaviour that changed between the 2023 build (iOS SDK 16.2) and current iOS/WebKit.
(function () {
  // 1) screen.orientation.lock(): the game does `await screen.orientation.lock("landscape")` right after
  //    deviceready (entry module). On current WKWebView it is either missing (TypeError -> startup aborts,
  //    black screen) or a promise that never settles (startup hangs, black screen).
  //    Replace it with: ask cordova-plugin-screen-orientation natively, resolve immediately.
  var MASKS = { any: 15, portrait: 3, 'portrait-primary': 1, 'portrait-secondary': 2,
                landscape: 12, 'landscape-primary': 4, 'landscape-secondary': 8 };
  function lock(mode) {
    var mask = MASKS[mode];
    if (mask && window.cordova && cordova.exec) {
      try { cordova.exec(null, null, 'CDVOrientation', 'screenOrientation', [mask, mode]); }
      catch (e) { console.warn('[bhc-compat] CDVOrientation failed:', e && e.message || e); }
    }
    return Promise.resolve();
  }
  lock.__bhc = true;
  function patch() {
    var o = window.screen && window.screen.orientation;
    if (!o || (o.lock && o.lock.__bhc)) return;
    try { Object.defineProperty(o, 'lock', { value: lock, configurable: true, writable: true }); }
    catch (e) { try { o.lock = lock; } catch (e2) { console.warn('[bhc-compat] cannot patch orientation.lock'); } }
  }
  patch();
  // cordova-plugin-screen-orientation may replace screen.orientation while Cordova boots; patch again.
  document.addEventListener('deviceready', patch, true);
})();
(function () {
  // 2) Dead publisher API: after reading the ARC firmware the game awaits fw_status and fw_app on exogen.space
  //    before showing the main menu ("checking firmware"). The host now serves a self-signed cert with no backend
  //    and WKWebView's fetch() can stay pending forever, so the app never reaches its own offline fallback
  //    (isAppCompatibleLocally, FW >= MIN_FW). Reject such requests after a timeout instead.
  var TIMEOUT_MS = 8000;
  var HOST = /^https?:\/\/([^\/]*\.)?exogen\.space\//i;
  function wrap() {
    if (!window.fetch || window.fetch.__bhcTimeout) return;
    var orig = window.fetch;
    var wrapped = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = orig.apply(this, arguments);
      if (!HOST.test(url)) return p;
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () {
          console.warn('[bhc-compat] fetch timeout after ' + TIMEOUT_MS + ' ms: ' + url);
          reject(new TypeError('bhc-compat: timeout ' + url));
        }, TIMEOUT_MS);
        p.then(function (r) { clearTimeout(t); resolve(r); }, function (e) { clearTimeout(t); reject(e); });
      });
    };
    wrapped.__bhcTimeout = true;
    window.fetch = wrapped;
  }
  wrap();
  // fetch may be replaced while Cordova boots (see bhc-debug.js); wrap again.
  document.addEventListener('deviceready', wrap, true);
})();
