/* Walt Viviers — minimal service worker for PWA installability + basic offline */
const CACHE = 'wv-cache-v2';
const PRECACHE = ['/', '/offline.html', '/logo.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // let the browser handle cross-origin

  // Network-first, fall back to cache (so the app still opens offline after a visit).
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(req).then((cached) => {
        if (cached) return cached;
        // A page navigation with nothing cached → show the branded offline page.
        if (req.mode === 'navigate') return caches.match('/offline.html');
        return caches.match('/');
      })
    )
  );
});
