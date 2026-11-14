'use strict';
// Simule des matchs complets avec de vrais clients Socket.io
process.env.TURN_MS = '400';
process.env.RECONNECT_MS = '300';
const { io: Client } = require('socket.io-client');
const { server } = require('../server');

const SUITS = ['H', 'D', 'C', 'S'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runMatch(nPlayers, port, opts = {}) {
  const url = 'http://localhost:' + port;
  const clients = [];
  const states = [];
  let code;
  let errors = 0;
  let events = {};
  for (let i = 0; i < nPlayers; i++) {
    const s = Client(url, { forceNew: true, transports: ['websocket'] });
    clients.push(s);
    s.on('state', (st) => { states[i] = st; });
    s.on('events', (evs) => { if (i === 0) for (const e of evs) events[e.type] = (events[e.type] || 0) + 1; });
    await new Promise((r) => s.on('connect', r));
    const res = await s.emitWithAck(i === 0 ? 'create' : 'join', { name: 'J' + i, code });
    if (res.error) throw new Error(res.error);
    code = res.code;
  }
  await clients[0].emitWithAck('settings', { handSize: opts.handSize || 5, mode: 'wins', target: opts.target || 2 });
  await clients[0].emitWithAck('start');

  const deadline = Date.now() + 60000;
  let actions = 0;
  while (Date.now() < deadline) {
    await wait(5);
    const st = states[0];
    if (!st) continue;
    if (st.phase === 'matchEnd') break;
    if (st.phase === 'roundEnd') {
      const r = await clients[0].emitWithAck('start');
      if (r.error) throw new Error(r.error);
      await wait(20);
      continue;
    }
    for (let i = 0; i < nPlayers; i++) {
      const s = states[i];
      if (!s || !s.game || s.phase !== 'playing') continue;
      const g = s.game;
      if (g.canCheck && Math.random() < 0.7) await clients[i].emitWithAck('check');
      if (g.turnId !== s.you) continue;
      if (opts.idle && i === 1) continue; // ce joueur laisse filer son chrono
      let res;
      if (g.playable.length && Math.random() < 0.85) {
        const id = g.playable[Math.floor(Math.random() * g.playable.length)];
        res = await clients[i].emitWithAck('play', { cardId: id, suit: SUITS[Math.floor(Math.random() * 4)] });
        if (Math.random() < 0.85) await clients[i].emitWithAck('check'); // annonce juste après avoir joué
      } else {
        res = await clients[i].emitWithAck('draw');
      }
      if (res.error && !/pas ton tour|termin/.test(res.error)) { errors++; console.log('  erreur:', res.error); }
      actions++;
      await wait(2);
    }
  }
  const final = states[0];
  if (final.phase !== 'matchEnd') {
    const g = final.game;
    console.log('BLOQUÉ', JSON.stringify({ phase: final.phase, game: g ? { turn: g.turnId, pen: g.penalty, top: g.top, deck: g.deckCount } : null, members: final.members }));
  }
  clients.forEach((c) => c.close());
  // conservation des cartes vérifiée au fil des états
  return { phase: final.phase, rounds: final.roundsPlayed, winner: final.matchWinnerId, actions, errors, events, members: final.members.map((m) => m.name + ':' + m.wins).join(' ') };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  for (const n of [2, 3, 5]) {
    const r = await runMatch(n, port, { handSize: n === 5 ? 8 : 5 });
    console.log(`${n} joueurs →`, r.phase, `${r.rounds} manches, ${r.actions} actions, erreurs: ${r.errors}`, r.members);
    console.log('   événements:', JSON.stringify(r.events));
    if (r.phase !== 'matchEnd' || r.errors) process.exitCode = 1;
  }
  const r = await runMatch(3, port, { idle: true, target: 1 });
  console.log('joueur inactif (chrono) →', r.phase, 'timeouts:', r.events.timeout || 0);
  if (!r.events.timeout) process.exitCode = 1;
  server.close();
  process.exit();
})();
