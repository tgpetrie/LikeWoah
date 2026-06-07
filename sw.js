// VideoEdit service worker — minimal app-shell cache so the app loads offline.
const CACHE = 'videoedit-v3';
const SHELL = [
  './',
  'index.html',
  'editor.html',
  'mobile.html',
  'mobile.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for editor.html so updates take effect; cache for everything else
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Don't cache CDN scripts (jsPDF) — let the browser cache them normally
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('editor.html') || url.pathname.endsWith('mobile.html') || url.pathname.endsWith('mobile.js') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
