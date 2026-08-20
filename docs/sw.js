'use strict';
const CACHE = 'chm-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './browse.html',
  './upload.html',
  './mine.html',
  './terms.html',
  './privacy.html',
  './disclaimer.html',
  './report.html',
  './admin.html',
  './site-index.json',
  './manifest.webmanifest'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/p/')) return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
