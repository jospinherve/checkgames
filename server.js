'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, SUITS, MAX_PLAYERS, MIN_HAND, MAX_HAND } = require('./game');

const TURN_MS = Number(process.env.TURN_MS || 30000);
const RECONNECT_MS = Number(process.env.RECONNECT_MS || 60000);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 2000);
const EVENTS_PER_SEC = Number(process.env.EVENTS_PER_SEC || 20); // limite par connexion

const app = express();
app.disable('x-powered-by');

// ---------- En-têtes de sécurité ----------
app.use((req, res, next) => {
  const host = String(req.headers.host || '').replace(/[^a-zA-Z0-9.:-]/g, '');
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",              // aucun script en ligne ni externe
      "style-src 'self' 'unsafe-inline'", // une icône SVG utilise un attribut style
      "img-src 'self' data:",
      `connect-src 'self' wss://${host} ws://${host}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

// ---------- Statistiques en direct ----------
// Uniquement des chiffres : ni noms, ni codes de partie.
function stats() {
  let players = 0, connected = 0, playing = 0;
  for (const r of rooms.values()) {
    players += r.members.length;
    connected += r.members.filter((m) => m.connected).length;
    if (r.phase === 'playing') playing++;
  }
  return { rooms: rooms.size, playing, players, connected, uptime: Math.round(process.uptime()) };
}
app.get('/stats.json', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(stats()); });
app.get('/stats', (_req, res) => res.sendFile(path.join(__dirname, 'stats.html')));
const server = http.createServer(app);
// Les messages du jeu font quelques centaines d'octets : 10 Ko suffisent largement
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000, maxHttpBufferSize: 10_000 });

// ---------- Limites de fréquence ----------
// Compteurs sur une fenêtre fixe : hit() renvoie false quand la limite est dépassée.
const counters = new Map();
function hit(key, limit, windowMs) {
  const now = Date.now();
  let c = counters.get(key);
  if (!c || now >= c.reset) { c = { n: 0, reset: now + windowMs }; counters.set(key, c); }
  return ++c.n <= limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, c] of counters) if (now >= c.reset) counters.delete(k);
}, 60 * 1000).unref();

// Derrière Render, la vraie adresse du joueur est dans X-Forwarded-For
function clientIp(socket) {
  const xff = String(socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || socket.handshake.address;
}
const TOO_FAST = 'Trop de tentatives. Attends une minute et réessaie.';

const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  // Nombre d'essais borné : jamais de boucle infinie, même si les codes viennent à manquer
  for (let i = 0; i < 100; i++) {
    const code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
    if (!rooms.has(code)) return code;
  }
  return null;
}

// Retire les caractères de contrôle (retours à la ligne…) : un nom ne peut pas fabriquer de fausses lignes de log
function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim().slice(0, 14) || 'Joueur'; }

function log(msg) { console.log(msg); }

function sanitizeSettings(s, prev) {
  const out = { ...prev };
  if (s && Number.isInteger(+s.handSize)) out.handSize = Math.min(MAX_HAND, Math.max(MIN_HAND, +s.handSize));
  if (s && (s.mode === 'wins' || s.mode === 'rounds')) out.mode = s.mode;
  if (s && Number.isInteger(+s.target)) out.target = Math.min(20, Math.max(1, +s.target));
  return out;
}

function createRoom() {
  if (rooms.size >= MAX_ROOMS) return null;
  const code = makeCode();
  if (!code) return null;
  const room = {
    code,
    hostId: null,
    members: [], // {id, token, name, socketId, connected, disconnectedAt, wins}
    phase: 'lobby',
    settings: { handSize: 5, mode: 'wins', target: 3 },
    roundsPlayed: 0,
    tiebreak: false,
    lastWinnerId: null,
    game: null,
    turnDeadline: 0,
    timer: null,
    matchWinnerId: null,
    lastSeen: Date.now(),
  };
  rooms.set(room.code, room);
  log(`partie ${room.code} créée`);
  return room;
}

function ensureHost(room) {
  const host = room.members.find((m) => m.id === room.hostId);
  if (host && host.connected) return;
  const next = room.members.find((m) => m.connected) || room.members[0];
  if (next) room.hostId = next.id;
}

function viewFor(room, member) {
  const g = room.game;
  const gs = g ? g.publicState(member.id) : null;
  return {
    code: room.code,
    you: member.id,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    roundsPlayed: room.roundsPlayed,
    tiebreak: room.tiebreak,
    matchWinnerId: room.matchWinnerId,
    turnDeadline: room.turnDeadline,
    now: Date.now(),
    members: room.members.map((m) => {
      const gp = gs && gs.players.find((p) => p.id === m.id);
      return {
        id: m.id, name: m.name, wins: m.wins, connected: m.connected,
        inGame: !!gp, count: gp ? gp.count : 0, checked: gp ? gp.checked : false,
      };
    }),
    game: gs,
  };
}

function broadcast(room) {
  room.lastSeen = Date.now();
  for (const m of room.members) if (m.socketId) io.to(m.socketId).emit('state', viewFor(room, m));
}

function flushEvents(room) {
  if (!room.game) return;
  const evts = room.game.events.splice(0);
  if (evts.length) io.to('room:' + room.code).emit('events', evts);
}

function scheduleTurn(room) {
  clearTimeout(room.timer);
  const g = room.game;
  if (!g || room.phase !== 'playing' || g.winnerId) { room.turnDeadline = 0; return; }
  const cur = room.members.find((m) => m.id === g.current.id);
  const away = cur && !cur.connected && Date.now() - cur.disconnectedAt >= RECONNECT_MS;
  const ms = away ? 2500 : TURN_MS;
  room.turnDeadline = Date.now() + ms;
  const turnId = g.current.id;
  const evCount = g.events.length;
  room.timer = setTimeout(() => {
    if (room.game !== g || g.winnerId || g.current.id !== turnId) return;
    g.draw(turnId);
    g.events.splice(evCount, 0, { type: 'timeout', playerId: turnId });
    afterAction(room);
  }, ms);
}

function afterAction(room) {
  const g = room.game;
  flushEvents(room);
  if (g.winnerId) {
    clearTimeout(room.timer);
    room.turnDeadline = 0;
    const w = room.members.find((m) => m.id === g.winnerId);
    if (w) { w.wins++; log(`${room.code} : manche gagnée par ${w.name}`); }
    room.roundsPlayed++;
    room.lastWinnerId = g.winnerId;
    room.phase = isMatchOver(room) ? 'matchEnd' : 'roundEnd';
    if (room.phase === 'matchEnd') {
      const mw = room.members.find((m) => m.id === room.matchWinnerId);
      if (mw) log(`${room.code} : match gagné par ${mw.name}`);
    }
  } else {
    scheduleTurn(room);
  }
  broadcast(room);
}

function isMatchOver(room) {
  const s = room.settings;
  const sorted = [...room.members].sort((a, b) => b.wins - a.wins);
  const best = sorted[0];
  const tie = sorted[1] && sorted[1].wins === best.wins;
  let over = false;
  if (s.mode === 'wins') over = best.wins >= s.target;
  else over = room.roundsPlayed >= s.target;
  if (over && tie) { room.tiebreak = true; return false; }
  if (over) { room.matchWinnerId = best.id; room.tiebreak = false; }
  return over;
}

function startRound(room) {
  // Les absents depuis trop longtemps sont retirés entre deux manches
  room.members = room.members.filter((m) => {
    const keep = m.connected || Date.now() - m.disconnectedAt < RECONNECT_MS;
    if (!keep) log(`${m.name} a quitté ${room.code} (absent trop longtemps)`);
    return keep;
  });
  ensureHost(room);
  if (room.members.length < 2) return 'Il faut au moins 2 joueurs.';
  const starterId = room.members.some((m) => m.id === room.lastWinnerId) ? room.lastWinnerId : null;
  room.game = new Game(room.members.map((m) => ({ id: m.id, name: m.name })), room.settings, { starterId });
  room.phase = 'playing';
  room.game.emit({ type: 'roundStart' });
  flushEvents(room);
  scheduleTurn(room);
  broadcast(room);
  return null;
}

io.on('connection', (socket) => {
  let room = null;
  let member = null;

  const ip = clientIp(socket);
  const reply = (cb, payload) => { if (typeof cb === 'function') cb(payload); };
  const fail = (cb, error) => reply(cb, { error });
  // accepte socket.emit('x', cb) comme socket.emit('x', data, cb)
  // Au-delà de EVENTS_PER_SEC messages par seconde sur une connexion, les messages sont refusés
  const on = (ev, fn) => socket.on(ev, (d, cb) => {
    if (typeof d === 'function') { cb = d; d = {}; }
    if (!hit('sock:' + socket.id, EVENTS_PER_SEC, 1000)) return tooFast(cb, 'Doucement !');
    fn(d && typeof d === 'object' ? d : {}, cb);
  });
  // Refus temporaire : le client garde sa session et réessaie
  const tooFast = (cb, error = TOO_FAST) => reply(cb, { error, retry: true });
  // Créer / rejoindre : 10 fois par minute et par connexion
  const joinAllowed = () => hit('join:' + socket.id, 10, 60 * 1000);

  function attach(r, m) {
    room = r; member = m;
    m.socketId = socket.id; m.connected = true; m.disconnectedAt = 0;
    socket.join('room:' + r.code);
    ensureHost(r);
  }

  // Quitte proprement la partie actuelle de ce socket (aucun joueur fantôme laissé derrière)
  function leaveCurrent() {
    if (!room || !member) return;
    const r = room, m = member;
    r.members = r.members.filter((x) => x !== m);
    socket.leave('room:' + r.code);
    room = null; member = null;
    log(`${m.name} a quitté ${r.code}`);
    ensureHost(r);
    if (r.members.length === 0) { clearTimeout(r.timer); rooms.delete(r.code); log(`partie ${r.code} fermée (vide)`); return; }
    if (r.phase === 'playing' && r.game) {
      r.game.removePlayer(m.id);
      if (r.game.players.length < 2) {
        // Plus assez de joueurs : retour au salon
        flushEvents(r);
        clearTimeout(r.timer);
        r.phase = 'lobby'; r.game = null; r.turnDeadline = 0;
        r.members.forEach((x) => { x.wins = 0; });
        r.roundsPlayed = 0; r.matchWinnerId = null; r.tiebreak = false;
        io.to('room:' + r.code).emit('events', [{ type: 'notEnough' }]);
        broadcast(r);
      } else {
        afterAction(r);
      }
    } else {
      io.to('room:' + r.code).emit('events', [{ type: 'playerLeft', playerId: m.id, name: m.name }]);
      broadcast(r);
    }
  }

  on('create', ({ name }, cb) => {
    if (!joinAllowed() || !hit('create:' + ip, 20, 60 * 1000)) return tooFast(cb);
    leaveCurrent();
    const r = createRoom();
    if (!r) return fail(cb, 'Le serveur est plein pour le moment. Réessaie dans quelques minutes.');
    const m = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(name), wins: 0 };
    r.members.push(m);
    r.hostId = m.id;
    attach(r, m);
    reply(cb, { ok: true, code: r.code, token: m.token });
    broadcast(r);
  });

  on('join', ({ code, name, token }, cb) => {
    if (!joinAllowed()) return tooFast(cb);
    // Essais de codes au hasard : au plus 20 codes inexistants par minute et par adresse IP
    const failKey = 'badcode:' + ip;
    const f = counters.get(failKey);
    if (f && Date.now() < f.reset && f.n >= 20) return tooFast(cb);
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) { hit(failKey, 20, 60 * 1000); return fail(cb, 'Partie introuvable. Vérifie le code.'); }
    const existing = token && r.members.find((m) => m.token === token);
    if (existing) {
      if (member !== existing) leaveCurrent();
      attach(r, existing);
      log(`${existing.name} est revenu dans ${r.code}`);
      reply(cb, { ok: true, code: r.code, token: existing.token, rejoined: true });
      if (r.phase === 'playing') scheduleTurnIfAway(r);
      return broadcast(r);
    }
    if (r.phase === 'playing') return fail(cb, 'Une manche est en cours. Réessaie à la fin de la manche.');
    if (r.members.length >= MAX_PLAYERS) return fail(cb, 'La partie est complète (5 joueurs).');
    leaveCurrent();
    if (!rooms.has(r.code)) return fail(cb, 'Partie introuvable. Vérifie le code.');
    // Jeton expiré (place libérée après une longue absence) : on le réutilise pour le nouveau joueur,
    // ainsi le navigateur qui le renvoie à chaque actualisation retombe toujours sur le même joueur.
    const reuse = typeof token === 'string' && UUID_RE.test(token) && ![...rooms.values()].some((x) => x.members.some((mm) => mm.token === token));
    const m = { id: crypto.randomUUID(), token: reuse ? token : crypto.randomUUID(), name: cleanName(name), wins: 0 };
    r.members.push(m);
    attach(r, m);
    log(`${m.name} a rejoint ${r.code}`);
    reply(cb, { ok: true, code: r.code, token: m.token });
    broadcast(r);
  });

  function scheduleTurnIfAway(r) {
    // le joueur revient : on remet un chrono normal si c'était son tour
    if (r.game && r.game.current.id === member.id) scheduleTurn(r);
  }

  on('settings', (s, cb) => {
    if (!room || room.hostId !== member.id) return fail(cb, "Seul l'hôte peut modifier les réglages.");
    if (room.phase === 'playing' || (room.phase === 'roundEnd' && room.roundsPlayed > 0)) return fail(cb, 'Réglages modifiables seulement avant le match.');
    room.settings = sanitizeSettings(s, room.settings);
    reply(cb, { ok: true });
    broadcast(room);
  });

  on('start', (_d, cb) => {
    if (!room || room.hostId !== member.id) return fail(cb, "Seul l'hôte peut lancer.");
    if (room.phase === 'playing') return fail(cb, 'Déjà en cours.');
    if (room.phase === 'matchEnd' || room.phase === 'lobby') {
      room.members.forEach((m) => { m.wins = 0; });
      room.roundsPlayed = 0; room.tiebreak = false; room.matchWinnerId = null; room.lastWinnerId = null;
    }
    const err = startRound(room);
    reply(cb, err ? { error: err } : { ok: true });
  });

  // L'hôte recommence la manche en cours (nouvelle distribution, scores inchangés)
  on('restartRound', (_d, cb) => {
    if (!room || room.hostId !== member.id) return fail(cb, "Seul l'hôte peut recommencer la manche.");
    if (room.phase !== 'playing') return fail(cb, 'Pas de manche en cours.');
    io.to('room:' + room.code).emit('events', [{ type: 'restart' }]);
    const err = startRound(room);
    reply(cb, err ? { error: err } : { ok: true });
  });

  on('toLobby', (_d, cb) => {
    if (!room || room.hostId !== member.id || room.phase !== 'matchEnd') return fail(cb, 'Impossible.');
    room.phase = 'lobby'; room.game = null;
    room.members.forEach((m) => { m.wins = 0; });
    room.roundsPlayed = 0; room.matchWinnerId = null;
    reply(cb, { ok: true });
    broadcast(room);
  });

  on('play', ({ cardId, suit }, cb) => {
    if (!room || !room.game || room.phase !== 'playing') return fail(cb, 'Pas de manche en cours.');
    const res = room.game.play(member.id, cardId, SUITS.includes(suit) ? suit : null);
    reply(cb, res);
    if (res.ok) afterAction(room);
  });

  on('draw', (_d, cb) => {
    if (!room || !room.game || room.phase !== 'playing') return fail(cb, 'Pas de manche en cours.');
    const res = room.game.draw(member.id);
    reply(cb, res);
    if (res.ok) afterAction(room);
  });

  on('check', (_d, cb) => {
    if (!room || !room.game || room.phase !== 'playing') return fail(cb, 'Pas de manche en cours.');
    const res = room.game.check(member.id);
    reply(cb, res);
    if (res.ok) { flushEvents(room); broadcast(room); }
  });

  // Quitter la partie (dans le salon comme en pleine manche)
  on('leave', (_d, cb) => {
    leaveCurrent();
    reply(cb, { ok: true });
  });

  socket.on('disconnect', () => {
    if (!room || !member || member.socketId !== socket.id) return;
    member.connected = false;
    member.socketId = null;
    member.disconnectedAt = Date.now();
    ensureHost(room);
    broadcast(room);
    const r = room, m = member;
    // Après 60 s d'absence, ses tours sont joués automatiquement
    setTimeout(() => {
      if (!m.connected && r.phase === 'playing' && r.game && r.game.current.id === m.id) scheduleTurn(r);
      if (!m.connected && r.phase !== 'playing' && r.members.includes(m)) {
        log(`${m.name} a quitté ${r.code} (absent trop longtemps)`);
        r.members = r.members.filter((x) => x !== m);
        ensureHost(r);
        broadcast(r);
      }
    }, RECONNECT_MS + 50);
  });
});

// Nettoyage des salles abandonnées
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = r.members.some((m) => m.connected);
    if (!anyone && now - r.lastSeen > 30 * 60 * 1000) { clearTimeout(r.timer); rooms.delete(code); log(`partie ${code} fermée (abandonnée)`); }
  }
}, 5 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log('Serveur sur http://localhost:' + PORT));
module.exports = { server, rooms };
