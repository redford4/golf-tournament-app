/* Simple offline cache. Only active when the app is served over http(s). */
var CACHE = 'golf-scoring-v1';
var ASSETS = [
  'index.html', 'css/styles.css',
  'js/config.js', 'js/golf.js', 'js/db.js', 'js/core.js', 'js/cloud.js', 'js/chrome.js',
  'js/views-auth.js', 'js/views-player.js', 'js/views-score.js',
  'js/views-admin.js', 'js/views-leaderboard.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Network-first: always try the network so updates appear immediately when
// online; fall back to the cached copy only when offline.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (resp) {
      var copy = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return resp;
    }).catch(function () {
      return caches.match(e.request).then(function (cached) {
        return cached || caches.match('index.html');
      });
    })
  );
});
