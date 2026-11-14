'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, SUITS, MAX_PLAYERS, MIN_HAND, MAX_HAND } = require('./game');

const TURN_MS = Number(process.env.TURN_MS || 30000);
const RECONNECT_MS = Number(process.env.RECONNECT_MS || 60000);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function cleanName(n) { return String(n || '').trim().slice(0, 14) || 'Joueur'; }

function sanitizeSettings(s, prev) {
  const out = { ...prev };
  if (s && Number.isInteger(+s.handSize)) out.handSize = Math.min(MAX_HAND, Math.max(MIN_HAND, +s.handSize));
  if (s && (s.mode === 'wins' || s.mode === 'rounds')) out.mode = s.mode;
  if (s && Number.isInteger(+s.target)) out.target = Math.min(20, Math.max(1, +s.target));
  return out;
}

function createRoom() {
  const room = {
    code: makeCode(),
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
    if (w) w.wins++;
    room.roundsPlayed++;
    room.lastWinnerId = g.winnerId;
    room.phase = isMatchOver(room) ? 'matchEnd' : 'roundEnd';
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
  room.members = room.members.filter((m) => m.connected || Date.now() - m.disconnectedAt < RECONNECT_MS);
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

  const reply = (cb, payload) => { if (typeof cb === 'function') cb(payload); };
  // accepte socket.emit('x', cb) comme socket.emit('x', data, cb)
  const on = (ev, fn) => socket.on(ev, (d, cb) => (typeof d === 'function' ? fn({}, d) : fn(d || {}, cb)));
  const fail = (cb, error) => reply(cb, { error });

  function attach(r, m) {
    room = r; member = m;
    m.socketId = socket.id; m.connected = true; m.disconnectedAt = 0;
    socket.join('room:' + r.code);
    ensureHost(r);
  }

  on('create', ({ name }, cb) => {
    const r = createRoom();
    const m = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(name), wins: 0 };
    r.members.push(m);
    r.hostId = m.id;
    attach(r, m);
    reply(cb, { ok: true, code: r.code, token: m.token });
    broadcast(r);
  });

  on('join', ({ code, name, token }, cb) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return fail(cb, 'Partie introuvable. Vérifie le code.');
    const existing = token && r.members.find((m) => m.token === token);
    if (existing) {
      attach(r, existing);
      reply(cb, { ok: true, code: r.code, token: existing.token, rejoined: true });
      if (r.phase === 'playing') scheduleTurnIfAway(r);
      return broadcast(r);
    }
    if (r.phase === 'playing') return fail(cb, 'Une manche est en cours. Réessaie à la fin de la manche.');
    if (r.members.length >= MAX_PLAYERS) return fail(cb, 'La partie est complète (5 joueurs).');
    const m = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(name), wins: 0 };
    r.members.push(m);
    attach(r, m);
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
    if (!room || !member) return reply(cb, { ok: true });
    const r = room, m = member;
    r.members = r.members.filter((x) => x !== m);
    socket.leave('room:' + r.code);
    room = null; member = null;
    ensureHost(r);
    if (r.members.length === 0) { clearTimeout(r.timer); rooms.delete(r.code); return reply(cb, { ok: true }); }
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
      if (!m.connected && r.phase !== 'playing') {
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
    if (!anyone && now - r.lastSeen > 30 * 60 * 1000) { clearTimeout(r.timer); rooms.delete(code); }
  }
}, 5 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log('Serveur sur http://localhost:' + PORT));
module.exports = { server, rooms };
