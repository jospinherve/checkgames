// Robot joueur — il ne reçoit que ce qu'un humain voit (sa main, la table, le nombre de cartes des autres)
'use strict';

const LEVELS = ['easy', 'normal'];
const BOT_NAMES = ['Ngono', 'Mbarga', 'Atangana', 'Fouda', 'Essomba', 'Manga', 'Ekani', 'Nkolo', 'Abena', 'Tchinda'];
// Probabilité d'oublier de dire « Check » (pour qu'on puisse le piéger)
const FORGET_CHECK = { easy: 0.3, normal: 0.1 };

const isAttack = (c) => c.rank === '7' || c.rank === 'JOKER' || c.rank === 'A';

// Couleur la plus présente dans les cartes données (null si aucune)
function bestSuit(cards, rng) {
  const count = {};
  for (const c of cards) if (c.suit) count[c.suit] = (count[c.suit] || 0) + 1;
  const suits = Object.keys(count);
  if (!suits.length) return null;
  const max = Math.max(...suits.map((s) => count[s]));
  const best = suits.filter((s) => count[s] === max);
  return best[Math.floor(rng() * best.length)];
}

// Nombre de cartes du joueur qui jouera après moi
function nextCount(view, meId) {
  const ps = view.players;
  const i = ps.findIndex((p) => p.id === meId);
  return ps[(i + 1) % ps.length].count;
}

/**
 * Choisit le coup du robot.
 * view  : game.publicState(robotId)
 * Renvoie { action: 'play', cardId, suit, check } ou { action: 'draw' }.
 */
function decide(view, meId, level = 'normal', rng = Math.random) {
  const hand = view.hand;
  const playable = hand.filter((c) => view.playable.includes(c.id));
  if (!playable.length) return { action: 'draw' };

  let card;
  if (level === 'easy') {
    // Facile : parfois il pioche alors qu'il pourrait jouer (sauf si la règle l'oblige à jouer)
    if (!view.mustPlay && rng() < 0.2) return { action: 'draw' };
    card = playable[Math.floor(rng() * playable.length)];
  } else {
    card = pickNormal(view, meId, hand, playable, rng);
  }

  const rest = hand.filter((c) => c !== card);
  const suit = card.rank === 'J' ? (bestSuit(rest, rng) || 'HDCS'[Math.floor(rng() * 4)]) : null;
  // Il lui restera une carte : il annonce « Check », sauf oubli
  const check = rest.length === 1 && rng() >= FORGET_CHECK[level];
  return { action: 'play', cardId: card.id, suit, check };
}

function pickNormal(view, meId, hand, playable, rng) {
  const danger = nextCount(view, meId) <= 2; // le suivant est près de gagner

  // Sous pénalité : contrer. Joker si le suivant est dangereux (+4), sinon le 7 (on garde le joker)
  if (view.penalty > 0) {
    const jok = playable.find((c) => c.rank === 'JOKER');
    const seven = playable.find((c) => c.rank === '7');
    return (danger ? jok || seven : seven || jok);
  }

  const counts = {};
  for (const c of hand) if (c.suit) counts[c.suit] = (counts[c.suit] || 0) + 1;

  let best = null, bestScore = -Infinity;
  for (const c of playable) {
    let score = 0;
    if (c.rank === 'J') score -= hand.length > 2 ? 50 : 0;        // le valet se garde pour la fin
    if (isAttack(c)) score += danger ? 40 : -5;                   // attaque si le suivant va gagner, sinon on garde
    if (c.suit) score += counts[c.suit] * 3;                       // reste dans la couleur où on a le plus de cartes
    score += rng(); // départage au hasard
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

module.exports = { decide, LEVELS, BOT_NAMES, FORGET_CHECK };
