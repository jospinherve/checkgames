'use strict';
// Tests du serveur avec de vrais clients Socket.io :
// bugs corrigés (doublons, fuite de salles), protections de sécurité et fonctions de jeu.
process.env.TURN_MS = '5000';
process.env.RECONNECT_MS = '300';
const assert = require('assert');
const { io: Client } = require('socket.io-client');
const { server, rooms } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let url;
let ipCounter = 1;

// Chaque test a sa propre « adresse IP » pour que les limites par IP ne se mélangent pas
function newIp() { return `10.0.0.${ipCounter++}`; }
async function client(ip = newIp()) {
  const s = Client(url, { forceNew: true, transports: ['websocket'], extraHeaders: { 'x-forwarded-for': ip } });
  s.states = [];
  s.events = [];
  s.on('state', (st) => { s.state = st; s.states.push(st); });
  s.on('events', (evs) => s.events.push(...evs));
  await new Promise((r) => s.on('connect', r));
  return s;
}
const ask = (s, ev, d = {}) => s.emitWithAck(ev, d);
const names = (code) => rooms.get(code).members.map((m) => m.name);

const tests = [];
const t = (name, fn) => tests.push({ name, fn });

// ---------- Bugs corrigés ----------

t("actualiser la page ne dédouble pas l'hôte, même après une longue absence", async () => {
  let s = await client();
  const { code, token } = await ask(s, 'create', { name: 'Hote' });
  s.close();
  await wait(500); // plus long que RECONNECT_MS : la place est libérée
  for (let i = 0; i < 3; i++) {
    s = await client();
    const r = await ask(s, 'join', { code, token, name: 'Hote' });
    assert.ok(r.ok);
    assert.strictEqual(r.token, token, 'le serveur garde le même jeton');
    await wait(50);
    s.close();
    await wait(50);
  }
  assert.deepStrictEqual(names(code), ['Hote']);
});

t('créer des parties en boucle ne laisse pas de salles fantômes', async () => {
  const s = await client();
  const before = rooms.size;
  for (let i = 0; i < 5; i++) assert.ok((await ask(s, 'create', { name: 'x' })).ok);
  assert.strictEqual(rooms.size, before + 1);
  s.close();
});

t('un nom ne peut pas contenir de retour à la ligne (fausses lignes de log)', async () => {
  const s = await client();
  const { code } = await ask(s, 'create', { name: 'Paul\npartie ZZZZ' });
  assert.ok(!/[\n\r]/.test(names(code)[0]));
  s.close();
});

// ---------- Sécurité ----------

t('codes au hasard : bloqué après 20 codes inexistants par IP', async () => {
  const ip = newIp();
  let blocked = 0;
  for (let c = 0; c < 3; c++) {
    const s = await client(ip);
    for (let i = 0; i < 10; i++) if ((await ask(s, 'join', { code: 'QQ' + c + i, name: 'x' })).retry) blocked++;
    s.close();
  }
  assert.strictEqual(blocked, 10);
});

t('rafale de messages : refusés au-delà de 20 par seconde', async () => {
  const s = await client();
  const res = await Promise.all(Array.from({ length: 40 }, () => ask(s, 'draw')));
  assert.strictEqual(res.filter((r) => r.retry).length, 20);
  s.close();
});

t('un message de plus de 10 Ko coupe la connexion', async () => {
  const s = await client();
  const closed = new Promise((r) => s.on('disconnect', r));
  s.emit('create', { name: 'x'.repeat(50000) });
  await Promise.race([closed, wait(2000).then(() => assert.fail('connexion pas coupée'))]);
  s.close();
});

t('en-têtes de sécurité présents', async () => {
  const res = await fetch(url + '/');
  assert.strictEqual(res.headers.get('x-powered-by'), null);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
});

t("/stats.json ne contient que des chiffres (ni noms, ni codes)", async () => {
  const s = await client();
  const { code } = await ask(s, 'create', { name: 'Secret' });
  const body = await (await fetch(url + '/stats.json')).text();
  assert.ok(!body.includes('Secret') && !body.includes(code));
  for (const v of Object.values(JSON.parse(body))) assert.strictEqual(typeof v, 'number');
  s.close();
});

// ---------- Liste d'attente ----------

async function startedRoom(n) {
  const host = await client();
  const { code } = await ask(host, 'create', { name: 'H' });
  const others = [];
  for (let i = 1; i < n; i++) {
    const c = await client();
    const r = await ask(c, 'join', { code, name: 'P' + i });
    c.token = r.token;
    others.push(c);
  }
  assert.ok((await ask(host, 'start')).ok);
  await wait(50);
  return { host, others, code };
}

t('arriver pendant une manche : on regarde, puis on joue la manche suivante', async () => {
  const { host, others, code } = await startedRoom(2);
  const late = await client();
  const r = await ask(late, 'join', { code, name: 'Tard' });
  assert.ok(r.ok, r.error);
  await wait(50);
  const me = late.state.members.find((m) => m.id === late.state.you);
  assert.strictEqual(me.inGame, false);
  assert.strictEqual(late.state.game.hand.length, 0, 'le spectateur ne voit aucune carte');
  assert.ok(host.events.some((e) => e.type === 'waiting' && e.name === 'Tard'));
  assert.strictEqual(rooms.get(code).game.players.length, 2, 'la manche en cours continue sans lui');
  // Manche suivante : l'hôte recommence, le retardataire est distribué
  assert.ok((await ask(host, 'restartRound')).ok);
  await wait(50);
  assert.strictEqual(rooms.get(code).game.players.length, 3);
  assert.ok(late.state.game.hand.length > 0);
  [host, late, ...others].forEach((c) => c.close());
});

t("un spectateur qui part ne dérange pas la manche", async () => {
  const { host, others, code } = await startedRoom(2);
  const late = await client();
  await ask(late, 'join', { code, name: 'Tard' });
  const g = rooms.get(code).game;
  const turn = g.current.id, deadline = rooms.get(code).turnDeadline;
  await ask(late, 'leave');
  assert.strictEqual(rooms.get(code).game, g);
  assert.strictEqual(g.current.id, turn);
  assert.strictEqual(rooms.get(code).turnDeadline, deadline, 'le chrono du joueur en cours ne repart pas');
  [host, late, ...others].forEach((c) => c.close());
});

// ---------- Exclure un joueur ----------

t("l'hôte exclut un joueur pendant la manche : la partie continue, il ne peut pas revenir", async () => {
  const { host, others, code } = await startedRoom(3);
  const [p1, p2] = others;
  const kicked = new Promise((r) => p1.on('kicked', r));
  const target = p1.state.you;
  assert.ok((await ask(host, 'kick', { id: target })).ok);
  await kicked;
  await wait(50);
  assert.deepStrictEqual(names(code), ['H', 'P2']);
  assert.strictEqual(rooms.get(code).game.players.length, 2);
  assert.ok(host.events.some((e) => e.type === 'playerKicked' && e.name === 'P1'));
  // Ses actions ne comptent plus, et il ne revient pas avec sa session
  assert.ok((await ask(p1, 'draw')).error);
  const back = await client();
  const r = await ask(back, 'join', { code, token: p1.token, name: 'P1' });
  assert.match(r.error, /exclu/);
  assert.deepStrictEqual(names(code), ['H', 'P2']);
  [host, p1, p2, back].forEach((c) => c.close());
});

t("seul l'hôte peut exclure, et pas lui-même", async () => {
  const { host, others } = await startedRoom(2);
  const [p1] = others;
  assert.ok((await ask(p1, 'kick', { id: host.state.you })).error);
  assert.ok((await ask(host, 'kick', { id: host.state.you })).error);
  [host, p1].forEach((c) => c.close());
});

t("exclure à 2 joueurs renvoie l'hôte au salon", async () => {
  const { host, others, code } = await startedRoom(2);
  assert.ok((await ask(host, 'kick', { id: others[0].state.you })).ok);
  await wait(50);
  assert.strictEqual(rooms.get(code).phase, 'lobby');
  [host, ...others].forEach((c) => c.close());
});

// ---------- Réactions ----------

t('réactions : seulement les emojis prévus, et pas trop vite', async () => {
  const { host, others } = await startedRoom(2);
  const [p1] = others;
  assert.ok((await ask(p1, 'react', { emoji: '🔥' })).ok);
  await wait(50);
  assert.ok(host.events.some((e) => e.type === 'react' && e.emoji === '🔥' && e.playerId === p1.state.you));
  assert.ok((await ask(p1, 'react', { emoji: '<img src=x>' })).error);
  await ask(p1, 'react', { emoji: '😂' });
  await ask(p1, 'react', { emoji: '😂' });
  assert.ok((await ask(p1, 'react', { emoji: '😂' })).retry, '4e réaction en 3 s refusée');
  [host, p1].forEach((c) => c.close());
});

// ---------- Appli installable ----------

t('manifest et service worker servis', async () => {
  const m = await fetch(url + '/manifest.webmanifest');
  assert.strictEqual(m.status, 200);
  const manifest = await m.json();
  assert.strictEqual(manifest.display, 'standalone');
  for (const icon of manifest.icons) assert.strictEqual((await fetch(url + icon.src)).status, 200);
  const sw = await fetch(url + '/sw.js');
  assert.strictEqual(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  url = 'http://localhost:' + server.address().port;
  const log = console.log;
  let failed = 0;
  for (const { name, fn } of tests) {
    console.log = () => {}; // masque les logs du serveur pendant le test
    try { await fn(); console.log = log; console.log('ok -', name); }
    catch (e) { console.log = log; failed++; console.log('ÉCHEC -', name, '\n   ', e.message); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} tests serveur réussis`);
  server.close();
  process.exit(failed ? 1 : 0);
})();
