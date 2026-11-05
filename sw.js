/* Tezzie offline support. Version 945a801c2c; rebuilt automatically by tools/build-site.js. */
const CACHE = 'tezzie-945a801c2c';
const PRECACHE = ["./","play/","fonts/press-start-2p.woff2","fonts/vt323.woff2","img/icon-180.png","img/icon-192.png","img/icon-512.png","img/icon-64.png","img/icon.png","manifest.webmanifest","play/fonts/press-start-2p.woff2","play/fonts/vt323.woff2","play/game.js","play/index.html","play/levelkit.js","play/levels.js","site.css"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('tezzie-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // pages: network first so updates show up; everything else: cache first
  if (req.mode === 'navigate') { e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; }).catch(() => caches.match(req).then(r => r || caches.match('play/')))); return; }
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; })));
});
