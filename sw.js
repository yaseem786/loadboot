const CACHE='lb-v5';
const CORE=['/','/index.html','/styles.css','/app.js','/dashboard.html','/load-score.html','/tools.html','/services.html','/pricing.html','/contact.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(CORE).catch(function(){});}));});
self.addEventListener('message',function(e){if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){if(k!==CACHE)return caches.delete(k);}));}));self.clients.claim();});
self.addEventListener('fetch',function(e){var r=e.request;var u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin)return;e.respondWith(fetch(r).then(function(res){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(r,cp);});return res;}).catch(function(){return caches.match(r).then(function(m){return m||caches.match('/index.html');});}));});
