'use strict';
// Service worker : rend l'appli installable et la fait marcher sans réseau (mode contre les robots).
// Réseau d'abord : les joueurs ont la dernière version. Mais si le serveur dort (Render gratuit met
// jusqu'à une minute à se réveiller), on affiche la copie gardée au bout de 3 s au lieu d'une page blanche.
const CACHE = 'checkgames-v2';
const SHELL = ['/', '/style.css', '/cards.js', '/app.js', '/local.js', '/lib/game.js', '/lib/bot.js',
  '/socket.io/socket.io.js', '/manifest.webmanifest', '/icons/icon-192.png'];
const SLOW_MS = 3000;

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

  const network = fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  });
  e.waitUntil(network.catch(() => {})); // la copie se met à jour même si on a servi le cache
  e.respondWith((async () => {
    const cached = (await caches.match(req, { ignoreSearch: req.mode === 'navigate' }))
      || (req.mode === 'navigate' ? await caches.match('/') : undefined);
    if (!cached) return network.catch(() => Response.error());
    return Promise.race([
      network.catch(() => cached),
      new Promise((r) => setTimeout(() => r(cached), SLOW_MS)),
    ]);
  })());
});

// Notification « À toi de jouer » touchée : on revient sur le jeu
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => 'focus' in c);
    return win ? win.focus() : self.clients.openWindow('/');
  }));
});
