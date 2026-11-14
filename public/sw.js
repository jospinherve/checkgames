'use strict';
// Service worker : rend l'appli installable et affiche l'écran du jeu même hors connexion.
// Réseau d'abord : les joueurs ont toujours la dernière version ; le cache ne sert que sans réseau.
const CACHE = 'checkgames-v1';
const SHELL = ['/', '/style.css', '/cards.js', '/app.js', '/socket.io/socket.io.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Le temps réel et les statistiques ne passent jamais par le cache
  if (url.pathname.startsWith('/socket.io/') && url.search) return;
  if (url.pathname.startsWith('/stats') || url.pathname === '/health') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});
