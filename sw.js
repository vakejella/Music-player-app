/* Winamp Mobile service worker — cache-first offline shell. */
const CACHE = 'winamp-mobile-v1';
const ASSETS = [
  './',
  './index.html',
  './css/winamp.css',
  './js/app.js',
  './js/player.js',
  './js/visualizer.js',
  './js/equalizer.js',
  './js/playlist.js',
  './js/demo.js',
  './js/wsz.js',
  './js/skin.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // Never cache blob: / object URLs (the user's audio).
  if (request.url.startsWith('blob:')) return;
  e.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      const copy = res.clone();
      if (res.ok && request.url.startsWith(self.location.origin)) {
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    }).catch(() => cached))
  );
});
