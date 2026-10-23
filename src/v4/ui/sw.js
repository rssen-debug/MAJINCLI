/**
 * MAJIN V4 service worker.
 *
 * Caches the app shell only. API responses, conversation content, pairing
 * state and session cookies are never cached — a shared or public cache must
 * not hold private conversation data.
 */
// Bump this whenever the shell changes: an installed PWA otherwise keeps the
// old HTML/CSS/JS until every cache entry expires independently.
const VERSION = 'majin-v4-shell-9';
const SHELL = [
  '/',
  '/index.html',
  '/app.css?v=9',
  '/app.js?v=9',
  '/spirit.js?v=9',
  '/voice.js?v=9',
  '/recorder.js?v=9',
  '/strings.js?v=9',
  '/session.js?v=9',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API traffic: it carries private data and must be live.
  // That includes uploads and their previews — caching them would leave the
  // owner's photos in a shared cache after logout.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.open(VERSION).then((cache) => cache.match('/index.html')).then((r) => r || Response.error())),
    );
    return;
  }

  if (!SHELL.includes(url.pathname + url.search)) return;
  // Mutable shell code must be fresh online. Read only this worker's cache:
  // an old in-flight worker can recreate an obsolete cache after activation.
  event.respondWith(caches.open(VERSION).then(async (cache) => {
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      return await cache.match(request) || Response.error();
    }
  }));
});
