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
  // 2) Dead publisher API (exogen.space/bhcapi). After reading the ARC firmware the game awaits fw_status and fw_app
  //    before showing the main menu ("checking firmware"). The host now serves a self-signed cert with no backend and
  //    WKWebView's fetch() can stay pending forever, so the app never reaches its own offline fallback
  //    (isAppCompatibleLocally, FW >= MIN_FW). API_MODE decides what happens to requests for that API:
  //      'timeout'  pass through, fail after TIMEOUT_MS (default; the URL mode below uses the same timeout)
  //      'block'    fail immediately, nothing leaves the phone
  //      'fake'     answer locally: fw_status -> {"status":"current"}, fw_app -> 200 (compatible), everything else -> 404
  //      <URL>      send to a replacement server instead: "https://exogen.space/bhcapi/?a=..." -> "<URL>?a=..."
  //                 (fetch, XHR and the native downloader used for firmware zips)
  //    Set by `setup.sh --api=<mode>`; for testing, localStorage.bhcApiMode overrides it (Web Inspector, then reload).
  var API_MODE = 'timeout';
  var TIMEOUT_MS = 1000;
  var API = /^https?:\/\/(dev\.)?exogen\.space\/bhcapi\//i;
  try { API_MODE = localStorage.getItem('bhcApiMode') || API_MODE; } catch (e) {}
  var proxy = /^https?:\/\//i.test(API_MODE) ? API_MODE : null;
  console.log('[bhc-compat] publisher API mode: ' + API_MODE);

  function rewrite(url) { return proxy && API.test(url) ? url.replace(API, proxy) : url; }
  function action(url) { var m = /[?&]a=([^\/&]+)/.exec(url); return m ? m[1] : ''; }
  function fake(url) {
    var a = action(url), body = '404 page not found', status = 404, type = 'text/plain';
    if (a === 'fw_status') { status = 200; body = '{"status":"current"}'; type = 'application/json'; }
    else if (a === 'fw_app') { status = 200; body = ''; }
    console.log('[bhc-compat] fake ' + status + ' for ' + url);
    return new Response(body, { status: status, headers: { 'Content-Type': type } });
  }

  function wrapFetch() {
    if (!window.fetch || window.fetch.__bhcApi) return;
    var orig = window.fetch;
    var wrapped = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!API.test(url)) return orig.apply(this, arguments);
      if (API_MODE === 'block') return Promise.reject(new TypeError('bhc-compat: blocked ' + url));
      if (API_MODE === 'fake') return Promise.resolve(fake(url));
      // timeout mode and proxy mode (a replacement server that is down must not hang startup either)
      if (proxy) url = rewrite(url);
      var p = proxy ? orig.call(this, typeof input === 'string' ? url : new Request(url, input), init)
                    : orig.apply(this, arguments);
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () {
          console.warn('[bhc-compat] fetch timeout after ' + TIMEOUT_MS + ' ms: ' + url);
          reject(new TypeError('bhc-compat: timeout ' + url));
        }, TIMEOUT_MS);
        p.then(function (r) { clearTimeout(t); resolve(r); }, function (e) { clearTimeout(t); reject(e); });
      });
    };
    wrapped.__bhcApi = true;
    window.fetch = wrapped;
  }

  // Firmware download (3488.js ~l. 1081) goes through jQuery ajax (XHR) and then the native file downloader:
  // only redirected in proxy mode, the other modes never get that far (fw_status does not say "upgradeable").
  if (proxy) {
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = rewrite(String(url));
      return open.apply(this, args);
    };
  }
  function wrapDownloader() {
    var d = window.downloader;
    if (!proxy || !d || !d.get || d.get.__bhcApi) return;
    var get = d.get;
    d.get = function (url) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = rewrite(String(url));
      return get.apply(this, args);
    };
    d.get.__bhcApi = true;
  }

  wrapFetch();
  // fetch / downloader may be (re)defined while Cordova boots; wrap again.
  document.addEventListener('deviceready', function () { wrapFetch(); wrapDownloader(); }, true);
})();
(function () {
  // 3) Stale BLE sessions. When the previous app process is killed (Xcode Stop/Run, swipe-away) iOS can keep its link
  //    to the ARC alive for a while. The next process then "connects" instantly to a link that never answers
  //    (getCurVerProtocol retries; after 5 of them the game even lowers its protocol version), or bluetoothle.discover
  //    never calls back and the app sits on "connecting to ARC" forever.
  //    a) bluetoothle.close() on iOS only forgets the peripheral, it never cancels the link (only disconnect() calls
  //       cancelPeripheralConnection), and the game only ever calls close(). Make close() disconnect first.
  //    b) Before the first connect to an address in this process: if iOS reports it as connected (retrieveConnected
  //       on NUS), connect + close it ourselves, wait a moment for the ARC to notice, then do the app's connect.
  //    c) If discover does not answer within DISCOVER_MS, report a "service" error: the game's own handler
  //       (3488.js ~l. 1233) then closes the connection and reconnects. Late callbacks are dropped.
  var NUS = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
  var DISCOVER_MS = 5000, DISCONNECT_MS = 2000, RESET_WAIT_MS = 1500, RESET_MAX_MS = 5000;
  var cleaned = {};
  function log(m) { console.log('[bhc-compat] ' + m); }
  function once(fn) { var called = false; return function () { if (!called) { called = true; fn.apply(this, arguments); } }; }

  function resetStale(ble, connect, address, done) {
    var finish = once(function (why) {
      log('stale session reset (' + why + '), connecting in ' + RESET_WAIT_MS + ' ms');
      setTimeout(done, RESET_WAIT_MS);
    });
    var close = once(function (why) {
      ble.close(function () { finish(why); }, function () { finish(why + ', close failed'); }, { address: address });
    });
    setTimeout(function () { close('timeout'); }, RESET_MAX_MS);
    // connect() registers the peripheral with this plugin instance, so close() (disconnect + close, see a) can drop it
    connect.call(ble, function (r) { if (r && r.status === 'connected') close('closed'); },
                 function () { close('connect error'); }, { address: address });
  }

  function wrap() {
    var ble = window.bluetoothle;
    if (!ble || ble.__bhcStale) return;
    ble.__bhcStale = true;

    var close = ble.close;
    ble.close = function (success, error, params) {
      var self = this, args = arguments;
      var go = once(function () { close.apply(self, args); });
      setTimeout(go, DISCONNECT_MS);
      // errors here mean "already disconnected" / "never connected": just close
      ble.disconnect(go, go, params);
    };

    var connect = ble.connect;
    ble.connect = function (success, error, params) {
      var self = this, args = arguments, address = params && params.address;
      if (!address || cleaned[address] || !ble.retrieveConnected) return connect.apply(self, args);
      cleaned[address] = true;
      ble.retrieveConnected(function (list) {
        var stale = (list || []).some(function (d) { return d.address === address; });
        if (!stale) return connect.apply(self, args);
        log('ARC ' + address + ' still connected from a previous session, closing it first');
        resetStale(ble, connect, address, function () { connect.apply(self, args); });
      }, function () { connect.apply(self, args); }, { services: [NUS] });
    };

    var discover = ble.discover;
    ble.discover = function (success, error, params) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        log('discover timeout after ' + DISCOVER_MS + ' ms');
        if (error) error({ error: 'service', message: 'bhc-compat: discover timeout', address: params && params.address });
      }, DISCOVER_MS);
      return discover.call(this,
        function () { if (done) return; done = true; clearTimeout(t); return success && success.apply(this, arguments); },
        function () { if (done) return; done = true; clearTimeout(t); return error && error.apply(this, arguments); },
        params);
    };
  }
  document.addEventListener('deviceready', wrap, true);
})();
