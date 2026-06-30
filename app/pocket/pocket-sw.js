// pocket-sw.js — minimal PWA service worker for the Carrier Pocket app.
// Network-first so data is always fresh; caches the shell for offline launch.
const CACHE = 'lb-pocket-v1';
const SHELL = ['./', './index.html', './pocket.js', './pocket.css', './manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never cache writes (RPC POSTs)
  if (new URL(req.url).origin !== self.location.origin) return; // skip Supabase / CDN
  e.respondWith(
    fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
