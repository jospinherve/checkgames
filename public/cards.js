// Cartes dessinées en SVG — figures inspirées des cours royales camerounaises
(function () {
  'use strict';
  const RED = '#C8312F';
  const BLACK = '#1E1E24';
  const SKIN = '#6B3E26';
  const SKIN_DARK = '#4A2918';

  const circ = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const SUIT_PATHS = {
    H: 'M50 90C22 68 5 51 5 31C5 16 16 6 30 6C40 6 47 12 50 20C53 12 60 6 70 6C84 6 95 16 95 31C95 51 78 68 50 90Z',
    D: 'M50 3L86 50L50 97L14 50Z',
    C: circ(50, 27, 19) + circ(27, 56, 19) + circ(73, 56, 19) + circ(50, 47, 11) + 'M45 52L55 52L57 80Q59 91 68 96L32 96Q41 91 43 80Z',
    S: 'M50 4C40 24 6 40 6 62C6 78 19 86 31 86C39 86 44 83 47 78Q45 89 35 96L65 96Q55 89 53 78C56 83 61 86 69 86C81 86 94 78 94 62C94 40 60 24 50 4Z',
  };
  const suitColor = (s) => (s === 'H' || s === 'D' ? RED : BLACK);

  function pip(suit, cx, cy, size, flip) {
    const r = flip ? ` rotate(180)` : '';
    return `<path d="${SUIT_PATHS[suit]}" fill="${suitColor(suit)}" transform="translate(${cx} ${cy})${r} translate(${-size / 2} ${-size / 2}) scale(${size / 100})"/>`;
  }

  // Positions des symboles (carte 200 x 290)
  const L = 62, M = 100, R = 138;
  const T = 62, B = 228, MID = 145, Q1 = 117, Q3 = 173;
  const LAYOUT = {
    2: [[M, T], [M, B]],
    3: [[M, T], [M, MID], [M, B]],
    4: [[L, T], [R, T], [L, B], [R, B]],
    5: [[L, T], [R, T], [M, MID], [L, B], [R, B]],
    6: [[L, T], [R, T], [L, MID], [R, MID], [L, B], [R, B]],
    7: [[L, T], [R, T], [M, 103], [L, MID], [R, MID], [L, B], [R, B]],
    8: [[L, T], [R, T], [M, 103], [L, MID], [R, MID], [M, 187], [L, B], [R, B]],
    9: [[L, T], [R, T], [L, Q1], [R, Q1], [M, MID], [L, Q3], [R, Q3], [L, B], [R, B]],
    10: [[L, T], [R, T], [M, 90], [L, Q1], [R, Q1], [L, Q3], [R, Q3], [M, 200], [L, B], [R, B]],
  };

  function corners(label, suit, color) {
    const fs = label === '10' ? 27 : 31;
    const ls = label === '10' ? ' letter-spacing="-3"' : '';
    const one = `<text x="21" y="38" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fs}"${ls} fill="${color}">${label}</text>` +
      (suit ? pip(suit, 21, 56, 20, false) : '');
    return `<g>${one}</g><g transform="rotate(180 100 145)">${one}</g>`;
  }

  // Palette des figures par couleur
  const ROBES = {
    H: { robe: '#8E1F2F', accent: '#E0A526', light: '#F7E9E4' },
    D: { robe: '#B9541B', accent: '#F2C14E', light: '#FBEEDD' },
    C: { robe: '#1F5E3B', accent: '#E0A526', light: '#E6F1E8' },
    S: { robe: '#23306B', accent: '#D7CFC0', light: '#E7E9F4' },
  };

  function face(rank, suit, uid) {
    const p = ROBES[suit];
    const sc = suitColor(suit);
    const pat = `ndop-${uid}`;
    const motif = rank === 'K'
      ? `<path d="M0 6L6 0L12 6L6 12Z" fill="none" stroke="#fff" stroke-width="1.3" opacity=".85"/><circle cx="6" cy="6" r="1.4" fill="#fff"/>`
      : rank === 'Q'
        ? `<circle cx="6" cy="6" r="3.2" fill="none" stroke="${p.accent}" stroke-width="1.4"/><circle cx="0" cy="0" r="1.5" fill="#fff"/><circle cx="12" cy="12" r="1.5" fill="#fff"/>`
        : `<path d="M0 3H12M0 9H12" stroke="#fff" stroke-width="1.2" opacity=".8"/><path d="M3 0V12" stroke="${p.accent}" stroke-width="1.6"/>`;

    // Figure dessinée dans une demi-boîte 132 x 101
    const eyes = `<ellipse cx="60" cy="41" rx="2.8" ry="1.9" fill="#fff"/><ellipse cx="72" cy="41" rx="2.8" ry="1.9" fill="#fff"/><circle cx="60.5" cy="41.2" r="1.3" fill="#1a0d06"/><circle cx="72.5" cy="41.2" r="1.3" fill="#1a0d06"/>` +
      `<path d="M56 37Q60 35 64 37M68 37Q72 35 76 37" stroke="#1a0d06" stroke-width="1.2" fill="none"/>` +
      `<path d="M66 43Q64 47 63 48Q66 49.5 69 48" stroke="${SKIN_DARK}" stroke-width="1.1" fill="none"/>` +
      `<path d="M61 52.5Q66 55.5 71 52.5" stroke="#3a1d10" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    const body = `<path d="M20 101Q22 76 44 68L88 68Q110 76 112 101Z" fill="url(#${pat})" stroke="${SKIN_DARK}" stroke-width=".8"/>` +
      `<rect x="59" y="52" width="14" height="14" fill="${SKIN}"/>`;
    const head = `<ellipse cx="66" cy="42" rx="14" ry="16.5" fill="${SKIN}"/>` +
      `<ellipse cx="52" cy="43" rx="2.5" ry="4" fill="${SKIN}"/><ellipse cx="80" cy="43" rx="2.5" ry="4" fill="${SKIN}"/>`;
    let beads = '';
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = 47 + 38 * t;
      const y = 64 + 11 * Math.sin(Math.PI * t);
      beads += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${i % 2 ? p.accent : '#C8312F'}" stroke="#2a1408" stroke-width=".5"/>`;
    }

    let extra = '', props = '';
    if (rank === 'K') {
      // Chapeau perlé, barbiche et chasse-mouches
      let dots = '';
      for (let y = 12; y <= 26; y += 5) for (let x = 54; x <= 78; x += 5) {
        if ((x - 66) ** 2 / 15 ** 2 + (y - 28) ** 2 / 22 ** 2 < 1) dots += `<circle cx="${x + ((y / 5) % 2 ? 2.5 : 0)}" cy="${y}" r="1.3" fill="#fff"/>`;
      }
      extra = `<path d="M50 32Q49 5 66 5Q83 5 82 32Z" fill="${p.robe}" stroke="${SKIN_DARK}" stroke-width=".8"/>${dots}` +
        `<rect x="49" y="27" width="34" height="6" rx="2" fill="${p.accent}"/>` +
        `<path d="M61 56Q66 63 71 56Q66 58 61 56Z" fill="#1a0d06"/>`;
      props = `<path d="M98 101L109 52" stroke="#C9A227" stroke-width="3.2" stroke-linecap="round"/>` +
        `<path d="M109 52Q100 34 104 18M109 52Q108 32 114 16M109 52Q116 36 124 26M109 52Q103 40 94 30" stroke="#F1EAD8" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
        `<circle cx="101" cy="88" r="5" fill="${SKIN}"/>`;
    } else if (rank === 'Q') {
      // Foulard noué, boucles d'oreilles, éventail
      extra = `<path d="M47 38Q40 12 62 7Q92 2 87 32Q84 38 79 33Q70 25 54 33Q50 36 47 38Z" fill="${p.robe}" stroke="${SKIN_DARK}" stroke-width=".8"/>` +
        `<path d="M52 26Q66 18 84 24" stroke="${p.accent}" stroke-width="2.2" fill="none"/>` +
        `<path d="M50 32Q66 24 84 30" stroke="#fff" stroke-width="1.2" fill="none" opacity=".8"/>` +
        `<ellipse cx="82" cy="9" rx="9" ry="6" fill="${p.robe}" stroke="${p.accent}" stroke-width="1.4" transform="rotate(25 82 9)"/>` +
        `<circle cx="52" cy="50" r="2.8" fill="${p.accent}"/><circle cx="80" cy="50" r="2.8" fill="${p.accent}"/>` +
        `<path d="M43 70Q66 88 89 70" stroke="${p.accent}" stroke-width="2" fill="none"/>`;
      props = `<path d="M22 101L30 74" stroke="#7a5a2e" stroke-width="2.6"/>` +
        `<path d="M30 74Q14 64 20 50Q32 52 40 60Q42 70 30 74Z" fill="${p.accent}" stroke="${SKIN_DARK}" stroke-width=".8"/>` +
        `<path d="M30 74L22 56M30 74L28 52M30 74L34 56" stroke="${p.robe}" stroke-width="1" opacity=".7"/>` +
        `<circle cx="27" cy="88" r="5" fill="${SKIN}"/>`;
    } else {
      // Bonnet rouge de notable avec plume, lance
      extra = `<path d="M51 33Q51 17 66 17Q81 17 81 33Z" fill="#B3261E" stroke="${SKIN_DARK}" stroke-width=".8"/>` +
        `<path d="M54 27H78" stroke="${p.accent}" stroke-width="1.6"/>` +
        `<path d="M78 22Q90 6 102 2Q96 14 82 26Z" fill="#F1EAD8" stroke="${SKIN_DARK}" stroke-width=".6"/>`;
      props = `<path d="M24 101L33 12" stroke="#8a6a3a" stroke-width="3"/>` +
        `<path d="M33 2L38.5 16L33 21L27.5 16Z" fill="#CFCFD4" stroke="#55555c" stroke-width=".8"/>` +
        `<circle cx="27" cy="82" r="5" fill="${SKIN}"/>`;
    }

    const half = `<g transform="translate(34 44)">${body}${props}<g transform="translate(66 71) scale(1.24) translate(-66 -58)">${head}${eyes}${extra}${beads}</g>` +
      `${pip(suit, 112, 14, 16, false)}</g>`;
    return `<defs><pattern id="${pat}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="${p.robe}"/>${motif}</pattern>` +
      `<clipPath id="clip-${uid}"><rect x="34" y="44" width="132" height="202" rx="4"/></clipPath></defs>` +
      `<rect x="34" y="44" width="132" height="202" rx="4" fill="${p.light}"/>` +
      `<g clip-path="url(#clip-${uid})">${half}<g transform="rotate(180 100 145)">${half}</g></g>` +
      `<path d="M34 145H166" stroke="${sc}" stroke-width="1.2"/>` +
      `<rect x="34" y="44" width="132" height="202" rx="4" fill="none" stroke="${sc}" stroke-width="1.6"/>`;
  }

  function joker(card, uid) {
    const c = card.color === 'red' ? RED : BLACK;
    const light = card.color === 'red' ? '#F7E9E4' : '#E9E8EE';
    let raffia = '';
    for (let i = 0; i <= 16; i++) {
      const x0 = 76 + i * 3, x1 = 52 + i * 6;
      raffia += `<path d="M${x0} 168Q${(x0 + x1) / 2} 200 ${x1} 236" stroke="${i % 3 ? '#C9A45C' : '#A9843E'}" stroke-width="2.2" fill="none"/>`;
    }
    const letters = 'JOKER'.split('').map((ch, i) => `<text x="20" y="${30 + i * 17}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="16" fill="${c}">${ch}</text>`).join('');
    return `<defs><clipPath id="clip-${uid}"><rect x="34" y="20" width="132" height="250" rx="4"/></clipPath></defs>` +
      `<rect x="34" y="20" width="132" height="250" rx="4" fill="${light}"/>` +
      `<g clip-path="url(#clip-${uid})">` +
      `<path d="M66 52L74 30L82 50L90 24L100 48L110 24L118 50L126 30L134 52Z" fill="${c}"/>` +
      `<path d="M72 50Q70 20 100 18Q130 20 128 50L126 120Q120 168 100 172Q80 168 74 120Z" fill="${c}" stroke="#2a1408" stroke-width="1.2"/>` +
      `<path d="M80 74Q90 66 98 76M102 76Q110 66 120 74" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>` +
      `<path d="M100 82V120" stroke="#fff" stroke-width="3"/>` +
      `<path d="M86 136Q100 146 114 136" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>` +
      `<path d="M78 98L86 104M78 106L86 112M122 98L114 104M122 106L114 112" stroke="#E0A526" stroke-width="2.4"/>` +
      `<path d="M100 26V50" stroke="#E0A526" stroke-width="2"/><circle cx="100" cy="56" r="3" fill="#E0A526"/>` +
      raffia + `</g>` +
      `<rect x="34" y="20" width="132" height="250" rx="4" fill="none" stroke="${c}" stroke-width="1.6"/>` +
      `<g>${letters}</g><g transform="rotate(180 100 145)">${letters}</g>`;
  }

  let uidCounter = 0;
  function svg(card) {
    const uid = card.id + '-' + (uidCounter++);
    let inner;
    if (card.rank === 'JOKER') {
      inner = joker(card, uid);
    } else {
      const color = suitColor(card.suit);
      inner = corners(card.rank, card.suit, color);
      if (card.rank === 'A') {
        inner += `<circle cx="100" cy="145" r="56" fill="none" stroke="${color}" stroke-width="1.2" opacity=".35"/>` + pip(card.suit, 100, 145, 84, false);
      } else if (['J', 'Q', 'K'].includes(card.rank)) {
        inner += face(card.rank, card.suit, uid);
      } else {
        inner += LAYOUT[card.rank].map(([x, y]) => pip(card.suit, x, y, 34, y > MID)).join('');
      }
    }
    return `<svg class="card-svg" viewBox="0 0 200 290" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label(card)}">` +
      `<rect x="1.5" y="1.5" width="197" height="287" rx="14" fill="#FBF8F1" stroke="#B4B2A9" stroke-width="1.5"/>${inner}</svg>`;
  }

  function back() {
    const suits = ['H', 'C', 'D', 'S'];
    const ring = suits.map((s, i) => {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 4;
      return pip(s, 100 + Math.cos(a) * 26, 145 + Math.sin(a) * 26, 20, false).replace(/fill="#[0-9A-F]+"/i, 'fill="#EEEDFE"');
    }).join('');
    return `<svg class="card-svg" viewBox="0 0 200 290" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      `<defs><pattern id="bk" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#3C3489"/><path d="M0 10L10 0L20 10L10 20Z" fill="none" stroke="#7F77DD" stroke-width="1.4"/><circle cx="10" cy="10" r="2" fill="#AFA9EC"/></pattern></defs>` +
      `<rect x="1.5" y="1.5" width="197" height="287" rx="14" fill="#F1EFE8" stroke="#888780" stroke-width="1.5"/>` +
      `<rect x="12" y="12" width="176" height="266" rx="8" fill="url(#bk)"/>` +
      `<circle cx="100" cy="145" r="46" fill="#26215C" stroke="#AFA9EC" stroke-width="2"/>${ring}</svg>`;
  }

  const SUIT_NAMES = { H: 'Macabo rouge', D: 'Biscuit carré', C: 'Arachide', S: 'Macabo noir' };
  const RANK_NAMES = { A: 'As' };
  function label(card) {
    if (card.rank === 'JOKER') return 'Joker ' + (card.color === 'red' ? 'rouge' : 'noir');
    const s = SUIT_NAMES[card.suit];
    return (RANK_NAMES[card.rank] || card.rank) + (/^[AEIOU]/.test(s) ? " d'" : ' de ') + s;
  }
  function suitIcon(suit, size = 18) {
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" style="vertical-align:-3px"><path d="${SUIT_PATHS[suit]}" fill="${suit === 'H' || suit === 'D' ? '#E24B4A' : 'currentColor'}"/></svg>`;
  }

  window.Cards = { svg, back, label, suitIcon, SUIT_NAMES };
})();
