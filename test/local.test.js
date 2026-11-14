'use strict';
// Mode hors-ligne : la partie contre les robots qui tourne dans le téléphone (public/local.js)
const assert = require('assert');
globalThis.self = globalThis;
self.CheckRules = require('../game');
self.CheckBot = require('../bot');
require('../public/local.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tests = [];
const t = (name, fn) => tests.push({ name, fn });

function local() {
  const c = { states: [], events: [] };
  c.game = self.LocalGame.create((ev, d) => {
    if (ev === 'state') { c.state = d; c.states.push(d); } else c.events.push(...d);
  }, { botMs: 5, turnMs: 200 });
  c.ask = (ev, d = {}) => new Promise((r) => c.game.emit(ev, d, r));
  return c;
}

t('un match complet contre 3 robots (facile, normal, difficile)', async () => {
  const c = local();
  assert.strictEqual((await c.ask('create', { name: 'Amina' })).code, 'SOLO');
  assert.match((await c.ask('start')).error, /robot/);
  for (const level of ['easy', 'normal', 'hard']) assert.ok((await c.ask('addBot', { level })).ok);
  assert.ok((await c.ask('settings', { handSize: 4, mode: 'wins', target: 2 })).ok);
  assert.ok((await c.ask('start')).ok);
  const end = Date.now() + 20000;
  while (Date.now() < end && c.state.phase !== 'matchEnd') {
    const s = c.state;
    if (s.phase === 'roundEnd') await c.ask('start');
    else if (s.phase === 'playing' && s.game.turnId === 'me') {
      const g = s.game;
      const r = g.playable.length
        ? await c.ask('play', { cardId: g.playable[0], suit: 'C', check: g.hand.length === 2 })
        : await c.ask('draw');
      assert.ok(r.ok, r.error);
    }
    await wait(5);
  }
  assert.strictEqual(c.state.phase, 'matchEnd');
  assert.ok(c.state.matchWinnerId);
  assert.strictEqual(Math.max(...c.state.members.map((m) => m.wins)), 2);
  // Ma vue ne contient jamais les cartes des robots
  assert.ok(c.states.every((s) => !s.game || s.game.players.every((p) => !('hand' in p))));
  assert.ok(c.events.some((e) => e.type === 'roundWin'));
  await c.ask('leave');
});

t('chrono écoulé : on pioche automatiquement', async () => {
  const c = local();
  await c.ask('create', { name: 'A' });
  await c.ask('addBot', { level: 'normal' });
  await c.ask('start');
  const end = Date.now() + 3000;
  while (Date.now() < end && !c.events.some((e) => e.type === 'timeout' && e.playerId === 'me')) await wait(20);
  assert.ok(c.events.some((e) => e.type === 'timeout' && e.playerId === 'me'));
  await c.ask('leave');
});

t('retirer le dernier robot en pleine manche : retour au salon', async () => {
  const c = local();
  await c.ask('create', { name: 'A' });
  await c.ask('addBot', { level: 'easy' });
  await c.ask('start');
  const bot = c.state.members.find((m) => m.bot);
  assert.ok((await c.ask('kick', { id: bot.id })).ok);
  assert.strictEqual(c.state.phase, 'lobby');
  assert.ok((await c.ask('kick', { id: 'me' })).error, 'on ne peut pas s\'exclure soi-même');
  await c.ask('leave');
});

t('après « quitter », plus rien ne bouge (robots arrêtés)', async () => {
  const c = local();
  await c.ask('create', { name: 'A' });
  await c.ask('addBot', { level: 'easy' });
  await c.ask('addBot', { level: 'easy' });
  await c.ask('start');
  await c.ask('leave');
  const n = c.states.length;
  await wait(300);
  assert.strictEqual(c.states.length, n);
  assert.ok((await c.ask('draw')).error);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log('ok -', name); }
    catch (e) { failed++; console.log('ÉCHEC -', name, '\n   ', e.message); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} tests hors-ligne réussis`);
  process.exit(failed ? 1 : 0);
})();
