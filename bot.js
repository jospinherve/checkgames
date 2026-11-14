// Robot joueur — il ne reçoit que ce qu'un humain voit (sa main, la table, le nombre de cartes des autres,
// et ce qui s'est passé sur la table). Utilisé par le serveur et par le navigateur (mode hors-ligne).
(function () {
'use strict';

const LEVELS = ['easy', 'normal', 'hard'];
const BOT_NAMES = ['Ngono', 'Mbarga', 'Atangana', 'Fouda', 'Essomba', 'Manga', 'Ekani', 'Nkolo', 'Abena', 'Tchinda'];
// Probabilité d'oublier de dire « Check » (pour qu'on puisse le piéger)
const FORGET_CHECK = { easy: 0.3, normal: 0.1, hard: 0 };

const isAttack = (c) => c.rank === '7' || c.rank === 'JOKER' || c.rank === 'A';

// ---------- Mémoire du robot difficile ----------
// Il retient les couleurs qu'un joueur n'avait pas : celui qui pioche alors que ♥ est demandé n'a sans doute pas de ♥.
function newMemory() { return { lacks: {} }; }
function observe(memo, events) {
  if (!memo) return;
  for (const e of events) {
    if (e.type === 'roundStart') memo.lacks = {};
    else if (e.type === 'draw' && !e.penalty && e.need) {
      if (!memo.lacks[e.playerId]) memo.lacks[e.playerId] = {};
      memo.lacks[e.playerId][e.need] = true;
    } else if (e.type === 'play' && memo.lacks[e.playerId]) {
      // Il vient de montrer qu'il a cette couleur (ou il la demande avec un valet)
      if (e.card && e.card.suit) delete memo.lacks[e.playerId][e.card.suit];
      if (e.commanded) delete memo.lacks[e.playerId][e.commanded];
    }
  }
}

// Couleur la plus présente dans les cartes données (null si aucune). bonus : points en plus par couleur.
function bestSuit(cards, rng, bonus = {}) {
  const count = {};
  for (const c of cards) if (c.suit) count[c.suit] = (count[c.suit] || 0) + 2;
  for (const s of Object.keys(bonus)) if (count[s]) count[s] += bonus[s];
  const suits = Object.keys(count);
  if (!suits.length) return null;
  const max = Math.max(...suits.map((s) => count[s]));
  const best = suits.filter((s) => count[s] === max);
  return best[Math.floor(rng() * best.length)];
}

// Joueur qui jouera après moi
function nextPlayer(view, meId) {
  const ps = view.players;
  const i = ps.findIndex((p) => p.id === meId);
  return ps[(i + 1) % ps.length];
}

/**
 * Choisit le coup du robot.
 * view  : game.publicState(robotId)
 * memo  : mémoire de la table (niveau difficile), voir observe()
 * Renvoie { action: 'play', cardId, suit, check } ou { action: 'draw' }.
 */
function decide(view, meId, level = 'normal', rng = Math.random, memo = null) {
  const hand = view.hand;
  const playable = hand.filter((c) => view.playable.includes(c.id));
  if (!playable.length) return { action: 'draw' };

  const next = nextPlayer(view, meId);
  const lacks = (level === 'hard' && memo && memo.lacks[next.id]) || {};
  let card;
  if (level === 'easy') {
    // Facile : parfois il pioche alors qu'il pourrait jouer (sauf si la règle l'oblige à jouer)
    if (!view.mustPlay && rng() < 0.2) return { action: 'draw' };
    card = playable[Math.floor(rng() * playable.length)];
  } else {
    card = pickCard(view, hand, playable, rng, next, level === 'hard' ? lacks : null);
  }

  const rest = hand.filter((c) => c !== card);
  // Le valet demande sa meilleure couleur ; le robot difficile préfère une couleur que le suivant n'a pas
  const bonus = {};
  for (const s of Object.keys(lacks)) bonus[s] = 3;
  const suit = card.rank === 'J' ? (bestSuit(rest, rng, bonus) || Object.keys(lacks)[0] || 'HDCS'[Math.floor(rng() * 4)]) : null;
  // Il lui restera une carte : il annonce « Check », sauf oubli
  const check = rest.length === 1 && rng() >= FORGET_CHECK[level];
  return { action: 'play', cardId: card.id, suit, check };
}

// lacks : couleurs que le suivant n'a pas (robot difficile), sinon null
function pickCard(view, hand, playable, rng, next, lacks) {
  const danger = next.count <= 2; // le suivant est près de gagner

  // Sous pénalité : contrer. Joker si le suivant est dangereux (+4), sinon le 7 (on garde le joker)
  if (view.penalty > 0) {
    const jok = playable.find((c) => c.rank === 'JOKER');
    const seven = playable.find((c) => c.rank === '7');
    return (danger ? jok || seven : seven || jok);
  }

  const counts = {};
  for (const c of hand) if (c.suit) counts[c.suit] = (counts[c.suit] || 0) + 1;
  const knowsLack = lacks && Object.keys(lacks).length > 0;

  let best = null, bestScore = -Infinity;
  for (const c of playable) {
    let score = 0;
    if (c.rank === 'J') score -= hand.length > 2 ? 50 : 0;        // le valet se garde pour la fin
    // Attaque si le suivant va gagner, sinon on garde (le difficile garde ses 7 et jokers pour se défendre)
    if (isAttack(c)) score += danger ? 40 : lacks && c.rank !== 'A' ? -15 : -5;
    if (c.suit) score += counts[c.suit] * 3;                       // reste dans la couleur où on a le plus de cartes
    if (lacks) {
      if (c.suit && lacks[c.suit]) score += 12;                    // impose une couleur que le suivant n'a pas
      if (c.rank === 'J' && danger && knowsLack) score += 45;      // le valet bloque le suivant qui allait gagner
      if (c.rank === 'A' && view.players.length === 2 && hand.length > 2) score += 8; // à 2, l'as fait rejouer
    }
    score += rng(); // départage au hasard
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Temps de réflexion. Le robot difficile joue vite quand un adversaire a oublié de dire « Check » :
// il ne lui laisse pas le temps de se rattraper (une carte en main et pas de Check annoncé).
function thinkMs(view, meId, level, base, rng = Math.random) {
  const trap = level === 'hard' && view.players.some((p) => p.id !== meId && p.count === 1 && !p.checked);
  return Math.round(base * (trap ? 0.3 + rng() * 0.15 : 0.7 + rng() * 0.6));
}

const api = { decide, observe, newMemory, thinkMs, LEVELS, BOT_NAMES, FORGET_CHECK };
if (typeof module === 'object' && module.exports) module.exports = api;
else self.CheckBot = api;
})();
