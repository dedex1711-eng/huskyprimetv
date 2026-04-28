const CACHE = 'huskyplay-v1';
const ASSETS = ['/', '/index.html', '/app.html', '/player.html', '/style.css', '/app.js', '/player.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('fetch', e => e.respondWith(
  caches.match(e.request).then(r => r || fetch(e.request))
));
