'use strict';
const $ = (id) => document.getElementById(id);
function dur(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
async function refresh() {
  try {
    const r = await fetch('/stats.json', { cache: 'no-store' });
    const d = await r.json();
    for (const k of ['connected', 'rooms', 'playing', 'players', 'bots']) $(k).textContent = d[k];
    $('uptime').textContent = `Serveur démarré il y a ${dur(d.uptime)}`;
    $('status').textContent = 'En direct · mis à jour à ' + new Date().toLocaleTimeString('fr-FR');
    $('dot').className = 'dot';
  } catch {
    $('status').textContent = 'Serveur injoignable, nouvel essai…';
    $('dot').className = 'dot off';
  }
}
refresh();
setInterval(refresh, 3000);
