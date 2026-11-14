'use strict';
// Tests du robot : coups toujours légaux, stratégie du niveau normal, oubli du « Check »
const assert = require('assert');
const { Game } = require('../game');
const { decide } = require('../bot');

const C = (id) => {
  if (id === 'JKR') return { id, rank: 'JOKER', suit: null, color: 'red' };
  if (id === 'JKB') return { id, rank: 'JOKER', suit: null, color: 'black' };
  return { id, rank: id.slice(0, -1), suit: id.slice(-1) };
};
function setup(hands, top, opts = {}) {
  const g = new Game(hands.map((_, i) => ({ id: 'p' + i, name: 'P' + i })), { handSize: 3 }, { starterId: 'p0' });
  g.players.forEach((p, i) => { p.hand = hands[i].map(C); });
  g.discard = [C(top)];
  g.deck = (opts.deck || ['2C', '3C', '4C', '5C', '6C', '8C', '9C', '10C']).map(C);
  g.penalty = opts.penalty || 0;
  g.commanded = null;
  return g;
}
const view = (g, id = 'p0') => g.publicState(id);
const fixed = (v) => () => v; // hasard « truqué » pour des tests reproductibles

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('1000 parties entre robots : toujours des coups légaux, et elles se terminent', () => {
  for (let k = 0; k < 1000; k++) {
    const np = 2 + (k % 4);
    const g = new Game(Array.from({ length: np }, (_, i) => ({ id: 'p' + i })), { handSize: 3 + (k % 6) });
    const level = (i) => ((i + k) % 2 ? 'easy' : 'normal');
    let guard = 0;
    while (!g.winnerId) {
      assert(guard++ < 5000, 'partie sans fin');
      const p = g.current;
      const d = decide(g.publicState(p.id), p.id, level(g.players.indexOf(p)));
      const res = d.action === 'play' ? g.play(p.id, d.cardId, d.suit, d.check) : g.draw(p.id);
      assert(res.ok, `coup refusé : ${res.error} (${JSON.stringify(d)})`);
      const all = [...g.deck, ...g.discard, ...g.players.flatMap((x) => x.hand)].map((c) => c.id);
      assert.strictEqual(new Set(all).size, 54);
    }
  }
});

t('le robot ne reçoit jamais les cartes des autres', () => {
  const g = setup([['5H', '9C'], ['KS', 'QD', '2S']], '3H');
  const v = JSON.stringify(view(g));
  for (const id of ['KS', 'QD', '2S']) assert(!v.includes(`"${id}"`));
});

t('sous pénalité : contre avec un 7, garde le joker si le suivant est loin de gagner', () => {
  const g = setup([['7S', 'JKR', '4C'], ['2D', '3D', '4D', '5D']], '7H', { penalty: 2 });
  assert.strictEqual(decide(view(g), 'p0', 'normal', fixed(0.5)).cardId, '7S');
});

t('sous pénalité : joker (+4) si le suivant est près de gagner', () => {
  const g = setup([['7S', 'JKR', '4C'], ['2D']], '7H', { penalty: 2 });
  assert.strictEqual(decide(view(g), 'p0', 'normal', fixed(0.5)).cardId, 'JKR');
});

t('garde son valet pour la fin', () => {
  const g = setup([['JH', '5H', '9C', 'KS'], ['2D', '3D', '4D', '5D']], '3H');
  assert.notStrictEqual(decide(view(g), 'p0', 'normal', fixed(0.5)).cardId, 'JH');
});

t('valet : demande la couleur la plus présente dans sa main', () => {
  const g = setup([['JD', '2C', '4C', '9S'], ['2D', '3D', '4D', '5D']], '3H');
  const d = decide(view(g), 'p0', 'normal', fixed(0.5));
  assert.strictEqual(d.cardId, 'JD');
  assert.strictEqual(d.suit, 'C');
});

t('attaque (7, joker, as) quand le suivant n\'a plus qu\'une carte', () => {
  const g = setup([['7H', '5H', '6H', '9H'], ['2D']], '3H');
  assert.strictEqual(decide(view(g), 'p0', 'normal', fixed(0.5)).cardId, '7H');
});

t('garde ses 7 quand le suivant est loin de gagner', () => {
  const g = setup([['7H', '5H', '6H', '9H'], ['2D', '3D', '4D', '5D']], '3H');
  assert.notStrictEqual(decide(view(g), 'p0', 'normal', fixed(0.5)).cardId, '7H');
});

t('reste dans la couleur où il a le plus de cartes', () => {
  const g = setup([['5H', '5C', '8C', '9C'], ['2D', '3D', '4D', '5D']], '5S');
  assert.strictEqual(decide(view(g), 'p0', 'normal', fixed(0.5)).cardId, '5C');
});

t('« Check » annoncé avec l\'avant-dernière carte… sauf oubli', () => {
  const g = setup([['5H', '9C'], ['2D', '3D', '4D']], '3H');
  assert.strictEqual(decide(view(g), 'p0', 'normal', fixed(0.5)).check, true);
  assert.strictEqual(decide(view(g), 'p0', 'normal', fixed(0.05)).check, false, 'normal : oublie 1 fois sur 10');
  assert.strictEqual(decide(view(g), 'p0', 'easy', fixed(0.25)).check, false, 'facile : oublie 3 fois sur 10');
});

t('taux d\'oubli réel : environ 10 % (normal) et 30 % (facile)', () => {
  const g = setup([['5H', '9C'], ['2D', '3D', '4D']], '3H');
  for (const [level, rate] of [['normal', 0.1], ['easy', 0.3]]) {
    let forgot = 0, plays = 0;
    for (let i = 0; i < 4000; i++) {
      const d = decide(view(g), 'p0', level);
      if (d.action !== 'play') continue;
      plays++;
      if (!d.check) forgot++;
    }
    assert(Math.abs(forgot / plays - rate) < 0.04, `${level} : ${(forgot / plays * 100).toFixed(1)} %`);
  }
});

t('facile : pioche parfois alors qu\'il pourrait jouer, jamais quand la banque est vide', () => {
  let g = setup([['5H', '9C', 'KS'], ['2D']], '3H');
  assert.strictEqual(decide(view(g), 'p0', 'easy', fixed(0.1)).action, 'draw');
  g = setup([['5H', '9C', 'KS'], ['2D']], '3H', { deck: [] });
  assert.strictEqual(decide(view(g), 'p0', 'easy', fixed(0.1)).action, 'play');
});

t('le robot normal bat le robot facile la plupart du temps', () => {
  let wins = 0;
  const N = 600;
  for (let k = 0; k < N; k++) {
    const g = new Game([{ id: 'n' }, { id: 'e' }], { handSize: 5 }, { starterId: k % 2 ? 'n' : 'e' });
    while (!g.winnerId) {
      const p = g.current;
      const d = decide(g.publicState(p.id), p.id, p.id === 'n' ? 'normal' : 'easy');
      if (d.action === 'play') g.play(p.id, d.cardId, d.suit, d.check); else g.draw(p.id);
    }
    if (g.winnerId === 'n') wins++;
  }
  console.log(`   (normal gagne ${(wins / N * 100).toFixed(0)} % contre facile)`);
  assert(wins / N > 0.55);
});

console.log(`\n${n} tests robot réussis`);
