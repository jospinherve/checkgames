// Moteur de règles — jeu de cartes camerounais
// Utilisé par le serveur (Node) et par le navigateur pour le mode hors-ligne.
(function () {
'use strict';

const SUITS = ['H', 'D', 'C', 'S'];
const SUIT_NAMES = { H: 'Macabo rouge', D: 'Biscuit carré', C: 'Arachide', S: 'Macabo noir' };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const PENALTY = { '7': 2, JOKER: 4 };
const MAX_PLAYERS = 5;
const MIN_HAND = 3;
const MAX_HAND = 8;
const CHECK_PENALTY = 1;

function colorOfSuit(s) { return s === 'H' || s === 'D' ? 'red' : 'black'; }
function colorOf(card) { return card.rank === 'JOKER' ? card.color : colorOfSuit(card.suit); }

function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ id: r + s, rank: r, suit: s });
  deck.push({ id: 'JKR', rank: 'JOKER', suit: null, color: 'red' });
  deck.push({ id: 'JKB', rank: 'JOKER', suit: null, color: 'black' });
  return deck;
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const isPenaltyCard = (c) => c.rank === '7' || c.rank === 'JOKER';
const isForbiddenStart = (c) => ['7', 'JOKER', 'A', 'J'].includes(c.rank);

class Game {
  constructor(players, settings, opts = {}) {
    // players: [{id, name}]
    this.rng = opts.rng || Math.random;
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], checked: false, checkPending: false }));
    this.settings = settings;
    this.deck = shuffle(newDeck(), this.rng);
    this.discard = [];
    this.penalty = 0;
    this.commanded = null;
    this.winnerId = null;
    this.events = [];
    this.emptyPasses = 0; // tours passés sans pouvoir jouer ni piocher

    for (let i = 0; i < settings.handSize; i++) for (const p of this.players) p.hand.push(this.deck.pop());

    // Carte de départ : ni 7, ni joker, ni as, ni J
    let start = this.deck.pop();
    while (isForbiddenStart(start)) {
      this.deck.unshift(start);
      shuffle(this.deck, this.rng);
      start = this.deck.pop();
    }
    this.discard.push(start);

    const si = players.findIndex((p) => p.id === opts.starterId);
    this.turn = si >= 0 ? si : Math.floor(this.rng() * this.players.length);
  }

  get top() { return this.discard[this.discard.length - 1]; }
  get current() { return this.players[this.turn]; }
  player(id) { return this.players.find((p) => p.id === id); }

  activeColor() { return this.commanded ? colorOfSuit(this.commanded) : colorOf(this.top); }

  canPlay(card, player) {
    if (this.winnerId) return false;
    // À 2 joueurs, on ne peut pas finir sur un as
    if (player.hand.length === 1 && card.rank === 'A' && this.players.length === 2) return false;
    // Sous pénalité : seulement un 7 (n'importe lequel) ou un joker
    if (this.penalty > 0) return isPenaltyCard(card);
    if (card.rank === 'J') return true;
    // Joker : sur sa couleur (rouge/noir), ou sur n'importe quel autre joker
    if (card.rank === 'JOKER') return (!this.commanded && this.top.rank === 'JOKER') || card.color === this.activeColor();
    const top = this.top;
    if (this.commanded) return card.suit === this.commanded;
    if (top.rank === 'JOKER') return colorOf(card) === top.color;
    return card.suit === top.suit || card.rank === top.rank;
  }

  playableIds(playerId) {
    const p = this.player(playerId);
    if (!p || this.current.id !== playerId) return [];
    return p.hand.filter((c) => this.canPlay(c, p)).map((c) => c.id);
  }

  emit(e) { this.events.push(e); }

  // Banque vide et rien à remélanger (la défausse ne contient que la carte du dessus)
  nothingToDraw() { return this.deck.length === 0 && this.discard.length <= 1; }

  // Banque vide, pas de pénalité et une carte jouable : on doit jouer (piocher ne ferait que passer)
  mustPlay(playerId) {
    return this.penalty === 0 && this.nothingToDraw() && this.playableIds(playerId).length > 0;
  }

  // Celui qui a oublié de dire « check » pioche quand le joueur suivant agit
  resolveForgottenChecks(actorId) {
    for (const p of this.players) {
      if (p.id !== actorId && p.checkPending) {
        p.checkPending = false;
        const got = this.drawCards(p, CHECK_PENALTY);
        this.emit({ type: 'forgotCheck', playerId: p.id, count: got });
      }
    }
  }

  drawCards(player, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (this.deck.length === 0) {
        if (this.discard.length <= 1) break; // plus rien : le reste de la pénalité est annulé
        const top = this.discard.pop();
        this.deck = shuffle(this.discard, this.rng);
        this.discard = [top];
        this.emit({ type: 'reshuffle', count: this.deck.length });
      }
      player.hand.push(this.deck.pop());
      got++;
    }
    if (player.hand.length !== 1) { player.checked = false; player.checkPending = false; }
    return got;
  }

  nextIndex(step = 1) { return (this.turn + step) % this.players.length; }

  // announce : le joueur dit « Check ! » en posant son avant-dernière carte
  play(playerId, cardId, chosenSuit, announce = false) {
    if (this.winnerId) return { error: 'La manche est terminée.' };
    const p = this.current;
    if (p.id !== playerId) return { error: "Ce n'est pas ton tour." };
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { error: "Tu n'as pas cette carte." };
    const card = p.hand[idx];
    if (!this.canPlay(card, p)) return { error: 'Cette carte ne peut pas être jouée maintenant.' };
    if (card.rank === 'J' && !SUITS.includes(chosenSuit)) return { error: 'Choisis une couleur.' };

    this.resolveForgottenChecks(p.id);
    p.hand.splice(idx, 1);
    this.discard.push(card);
    this.commanded = card.rank === 'J' ? chosenSuit : null;
    if (PENALTY[card.rank]) this.penalty += PENALTY[card.rank];
    this.emptyPasses = 0;
    this.emit({ type: 'play', playerId: p.id, card, commanded: this.commanded, penalty: this.penalty });

    if (p.hand.length === 0) {
      this.winnerId = p.id;
      this.penalty = 0;
      this.emit({ type: 'roundWin', playerId: p.id });
      return { ok: true };
    }
    if (p.hand.length === 1) {
      if (announce) { p.checked = true; p.checkPending = false; this.emit({ type: 'check', playerId: p.id }); }
      else p.checkPending = true;
    }

    let step = 1;
    if (card.rank === 'A') {
      step = 2;
      this.emit({ type: 'skip', playerId: this.players[this.nextIndex(1)].id });
    }
    this.turn = this.nextIndex(step);
    return { ok: true };
  }

  draw(playerId) {
    if (this.winnerId) return { error: 'La manche est terminée.' };
    const p = this.current;
    if (p.id !== playerId) return { error: "Ce n'est pas ton tour." };
    if (this.mustPlay(playerId)) return { error: 'La banque est vide : tu dois poser une carte.' };
    this.resolveForgottenChecks(p.id);
    const n = this.penalty > 0 ? this.penalty : 1;
    const wasPenalty = this.penalty > 0;
    // Couleur demandée sur la table au moment de piocher (information visible de tous)
    const need = wasPenalty ? null : this.commanded || this.top.suit || null;
    this.penalty = 0;
    const got = this.drawCards(p, n);
    this.emit({ type: 'draw', playerId: p.id, count: got, penalty: wasPenalty, need });
    this.emptyPasses = got === 0 ? this.emptyPasses + 1 : 0;
    if (this.emptyPasses >= this.players.length) {
      // Manche bloquée (plus de cartes à piocher, personne ne peut jouer) : le moins de cartes gagne
      const best = this.players.reduce((a, b) => (b.hand.length < a.hand.length ? b : a));
      this.winnerId = best.id;
      this.emit({ type: 'blocked', playerId: best.id });
      this.emit({ type: 'roundWin', playerId: best.id });
      return { ok: true };
    }
    this.turn = this.nextIndex(1);
    return { ok: true };
  }

  // Chrono écoulé (ou joueur absent) : on pioche, sauf si la banque est vide et qu'une carte passe
  autoMove(playerId) {
    if (!this.mustPlay(playerId)) return this.draw(playerId);
    const p = this.player(playerId);
    const card = p.hand.find((c) => this.playableIds(playerId).includes(c.id));
    let suit = null;
    if (card.rank === 'J') {
      // Le valet demande la couleur la plus présente dans le reste de la main
      const count = {};
      for (const c of p.hand) if (c !== card && c.suit) count[c.suit] = (count[c.suit] || 0) + 1;
      suit = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || card.suit;
    }
    return this.play(playerId, card.id, suit);
  }

  check(playerId) {
    const p = this.player(playerId);
    if (!p || this.winnerId) return { error: 'Impossible.' };
    // On ne dit « Check » que quand il ne reste qu'une carte à jouer
    if (p.hand.length === 1 && p.checkPending) {
      p.checkPending = false; p.checked = true;
    } else if (p.hand.length === 1 && p.checked) {
      return { ok: true };
    } else {
      return { error: 'Tu ne peux dire « Check » que quand il te reste une carte.' };
    }
    this.emit({ type: 'check', playerId: p.id });
    return { ok: true };
  }

  // Un joueur quitte en pleine manche : ses cartes retournent dans la banque
  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const [p] = this.players.splice(idx, 1);
    this.deck.unshift(...p.hand);
    shuffle(this.deck, this.rng);
    if (idx < this.turn) this.turn--;
    else if (idx === this.turn) { this.penalty = 0; this.turn = this.turn % this.players.length; }
    if (this.turn >= this.players.length) this.turn = 0;
    this.emit({ type: 'playerLeft', playerId: id, name: p.name });
  }

  publicState(forId) {
    const me = this.player(forId);
    return {
      players: this.players.map((p) => ({ id: p.id, count: p.hand.length, checked: p.checked })),
      top: this.top,
      commanded: this.commanded,
      penalty: this.penalty,
      turnId: this.current.id,
      deckCount: this.deck.length,
      hand: me ? me.hand : [],
      playable: me ? this.playableIds(forId) : [],
      canCheck: !!me && me.hand.length === 1 && me.checkPending,
      mustPlay: !!me && this.current.id === forId && !this.winnerId && this.mustPlay(forId),
      winnerId: this.winnerId,
    };
  }
}

const api = { Game, SUITS, SUIT_NAMES, MAX_PLAYERS, MIN_HAND, MAX_HAND, colorOf, newDeck };
if (typeof module === 'object' && module.exports) module.exports = api;
else self.CheckRules = api;
})();
