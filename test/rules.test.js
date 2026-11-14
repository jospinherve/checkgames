'use strict';
const assert = require('assert');
const { Game } = require('../game');

const C = (id) => {
  if (id === 'JKR') return { id, rank: 'JOKER', suit: null, color: 'red' };
  if (id === 'JKB') return { id, rank: 'JOKER', suit: null, color: 'black' };
  return { id, rank: id.slice(0, -1), suit: id.slice(-1) };
};

function setup(hands, top, opts = {}) {
  const players = hands.map((_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const g = new Game(players, { handSize: 3 }, { starterId: 'p0' });
  g.players.forEach((p, i) => { p.hand = hands[i].map(C); });
  g.discard = [C(top)];
  g.deck = (opts.deck || ['2C', '3C', '4C', '5C', '6C', '8C', '9C', '10C']).map(C);
  g.penalty = opts.penalty || 0;
  g.commanded = opts.commanded || null;
  return g;
}
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('carte de départ jamais spéciale', () => {
  for (let i = 0; i < 300; i++) {
    const g = new Game([{ id: 'a' }, { id: 'b' }], { handSize: 8 });
    assert(!['7', 'JOKER', 'A', 'J'].includes(g.top.rank));
    assert.strictEqual(g.players[0].hand.length, 8);
  }
});

t('même couleur ou même valeur', () => {
  const g = setup([['5H', '9S', '9C'], ['2D']], '9H');
  assert.deepStrictEqual(g.playableIds('p0').sort(), ['5H', '9C', '9S']);
});

t('7 cumulé, joker contre n importe quel 7, 7 contre joker', () => {
  const g = setup([['7H', 'KH', 'QH'], ['JKB', 'KD', 'QD'], ['7C', 'KS', 'QS']], '4H');
  g.play('p0', '7H');
  assert.strictEqual(g.penalty, 2);
  assert.deepStrictEqual(g.playableIds('p1'), ['JKB']); // joker noir contre 7 rouge
  g.play('p1', 'JKB');
  assert.strictEqual(g.penalty, 6);
  assert.deepStrictEqual(g.playableIds('p2'), ['7C']);
  g.play('p2', '7C');
  assert.strictEqual(g.penalty, 8);
  g.draw('p0');
  assert.strictEqual(g.players[0].hand.length, 2 + 8);
  assert.strictEqual(g.penalty, 0);
  assert.strictEqual(g.current.id, 'p1');
});

t('valet interdit sous pénalité, permis sinon, valet sur valet', () => {
  const g = setup([['7S', 'KH', 'QH'], ['JD', 'KD', 'QD']], '4S');
  g.play('p0', '7S');
  assert.deepStrictEqual(g.playableIds('p1'), []);
  const g2 = setup([['JD', 'KH', 'QH'], ['JC', 'KD', 'QD']], '4S');
  g2.play('p0', 'JD', 'C');
  assert.strictEqual(g2.commanded, 'C');
  assert.deepStrictEqual(g2.playableIds('p1'), ['JC']);
});

t('joker rouge sur rouge seulement (hors pénalité)', () => {
  const g = setup([['JKR', 'JKB', '2S']], '4H');
  assert.deepStrictEqual(g.playableIds('p0'), ['JKR']);
  const g2 = setup([['JKR', 'JKB', '2S']], '4H', { commanded: 'C' });
  assert.deepStrictEqual(g2.playableIds('p0'), ['JKB']);
});

t('joker rouge sur joker noir (et inversement)', () => {
  const g = setup([['JKR', '2S', '3S'], ['4D']], 'JKB');
  assert.deepStrictEqual(g.playableIds('p0').sort(), ['2S', '3S', 'JKR']);
});

t('as saute le suivant ; à 2 joueurs on rejoue', () => {
  const g = setup([['AH', 'KH'], ['2D'], ['3D']], '4H');
  g.play('p0', 'AH');
  assert.strictEqual(g.current.id, 'p2');
  const g2 = setup([['AH', 'KH', 'QH'], ['2D']], '4H');
  g2.play('p0', 'AH');
  assert.strictEqual(g2.current.id, 'p0');
});

t('à 2 joueurs, pas de fin sur un as', () => {
  const g = setup([['AH'], ['2D']], '4H');
  assert.deepStrictEqual(g.playableIds('p0'), []);
  const g3 = setup([['AH'], ['2D'], ['3D']], '4H');
  assert.deepStrictEqual(g3.playableIds('p0'), ['AH']);
});

t('pioche termine le tour', () => {
  const g = setup([['5H', 'KS'], ['2D']], '9H');
  g.draw('p0');
  assert.strictEqual(g.current.id, 'p1');
  assert.strictEqual(g.players[0].hand.length, 3);
});

t('oubli du check = 1 carte quand le suivant agit', () => {
  const g = setup([['5H', 'KS'], ['2D', '3S']], '9H');
  g.play('p0', '5H');
  assert(g.players[0].checkPending);
  g.draw('p1');
  assert.strictEqual(g.players[0].hand.length, 2);
  assert(g.events.some((e) => e.type === 'forgotCheck'));
});

t('check annoncé à temps, seulement avec une carte', () => {
  const g = setup([['5H', 'KS'], ['2D', '3S']], '9H');
  assert(g.check('p0').error); // 2 cartes : trop tôt
  g.play('p0', '5H');
  assert(g.check('p0').ok);
  g.draw('p1');
  assert.strictEqual(g.players[0].hand.length, 1);
  assert(g.players[0].checked);
});

t('un joueur quitte : ses cartes vont dans la banque, le tour passe', () => {
  const g = setup([['5H', 'KS'], ['2D', '3S'], ['4C']], '9H', { penalty: 2 });
  g.turn = 1;
  g.removePlayer('p1');
  assert.strictEqual(g.players.length, 2);
  assert.strictEqual(g.current.id, 'p2');
  assert.strictEqual(g.penalty, 0);
  assert.strictEqual(g.deck.length, 10);
  const g2 = setup([['5H'], ['2D'], ['4C']], '9H');
  g2.turn = 2;
  g2.removePlayer('p0');
  assert.strictEqual(g2.current.id, 'p2');
});

t('banque vide : on remélange sauf la carte du dessus', () => {
  const g = setup([['KS', 'QS'], ['2D']], '9H', { deck: [] });
  g.discard = ['3H', '4H', '5H', '9H'].map(C);
  g.draw('p0');
  assert.strictEqual(g.top.id, '9H');
  assert.strictEqual(g.discard.length, 1);
  assert.strictEqual(g.deck.length, 2);
});

t('pénalité trop grosse : le reste est annulé', () => {
  const g = setup([['KS'], ['2D']], '9H', { deck: ['3C'], penalty: 6 });
  g.discard = ['3H', '7H'].map(C);
  g.draw('p0');
  assert.strictEqual(g.players[0].hand.length, 1 + 2);
});

t('manche bloquée : le moins de cartes gagne', () => {
  const g = setup([['2S', '3S'], ['4S', '5S', '6S'], ['8C']], 'AH', { deck: [] });
  g.draw('p0'); g.draw('p1');
  assert(!g.winnerId);
  g.draw('p2');
  assert.strictEqual(g.winnerId, 'p2');
});

t('gagner sur une carte spéciale à 3 joueurs', () => {
  const g = setup([['7H'], ['2D'], ['3D']], '4H');
  g.play('p0', '7H');
  assert.strictEqual(g.winnerId, 'p0');
});

t('2000 manches aléatoires : 54 cartes toujours présentes, aucune carte en double', () => {
  for (let k = 0; k < 2000; k++) {
    const np = 2 + (k % 4);
    const g = new Game(Array.from({ length: np }, (_, i) => ({ id: 'p' + i })), { handSize: 3 + (k % 6) });
    let guard = 0;
    while (!g.winnerId && guard++ < 3000) {
      const p = g.current;
      const ids = g.playableIds(p.id);
      if (Math.random() < 0.5) g.check(p.id);
      if (ids.length && Math.random() < 0.8) g.play(p.id, ids[0], 'HDCS'[k % 4]);
      else g.draw(p.id);
      const all = [...g.deck, ...g.discard, ...g.players.flatMap((x) => x.hand)].map((c) => c.id);
      assert.strictEqual(all.length, 54);
      assert.strictEqual(new Set(all).size, 54);
    }
  }
});

console.log(`\n${n} tests réussis`);
