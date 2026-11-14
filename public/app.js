(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const socket = io({ transports: ['websocket', 'polling'] });

  let st = null;          // dernier état reçu
  let skew = 0;           // décalage d'horloge client/serveur
  let selected = null;    // carte sélectionnée dans la main
  let lastTopId = null;
  let lastTurnId = null;
  let prevPhase = null;
  let soundOn = localStorage.getItem('sound') !== 'off';
  const session = () => { try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; } };
  const saveSession = (s) => localStorage.setItem('session', JSON.stringify(s));
  const clearSession = () => localStorage.removeItem('session');

  // ---------- Sons ----------
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur = 0.08, type = 'sine', vol = 0.15, delay = 0) {
    if (!soundOn) return;
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    const t = a.currentTime + delay;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    play: () => beep(520, 0.07, 'triangle'),
    draw: () => beep(300, 0.09, 'sine'),
    penalty: () => { beep(220, 0.12, 'sawtooth', 0.1); beep(180, 0.16, 'sawtooth', 0.1, 0.12); },
    turn: () => { beep(660, 0.08); beep(880, 0.1, 'sine', 0.15, 0.09); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.16, 'triangle', 0.15, i * 0.12)),
    check: () => {
      if (!soundOn) return;
      beep(880, 0.1, 'square', 0.08); beep(1175, 0.14, 'square', 0.08, 0.1);
      try {
        const u = new SpeechSynthesisUtterance('Check !');
        u.lang = 'fr-FR'; u.rate = 1.1; u.pitch = 1.2; u.volume = 1;
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      } catch { /* pas de synthèse vocale */ }
    },
  };
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* */ } };
  document.addEventListener('pointerdown', () => audio(), { once: true });

  // ---------- Utilitaires ----------
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const member = (id) => st && st.members.find((m) => m.id === id);
  const nameOf = (id) => (st && id === st.you ? 'Tu' : (member(id) || {}).name || '?');
  const isHost = () => st && st.hostId === st.you;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function show(screen) {
    for (const id of ['home', 'lobby', 'game']) $(id).classList.toggle('hidden', id !== screen);
  }
  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind; el.innerHTML = text;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 2) $('toasts').firstChild.remove();
    setTimeout(() => el.remove(), 2600);
  }

  // ---------- Accueil ----------
  $('logo').innerHTML = ['KH', 'JKB', 'QD'].map((id) => {
    const c = id === 'JKB' ? { id, rank: 'JOKER', color: 'black' } : { id, rank: id[0], suit: id[1] };
    return `<div class="card">${Cards.svg(c)}</div>`;
  }).join('');
  $('name').value = localStorage.getItem('name') || '';
  const urlCode = new URLSearchParams(location.search).get('c');
  if (urlCode) $('code').value = urlCode.toUpperCase();

  function getName() {
    const n = $('name').value.trim();
    if (!n) { $('homeErr').textContent = 'Entre ton pseudo.'; $('name').focus(); return null; }
    localStorage.setItem('name', n);
    return n;
  }
  $('name').addEventListener('input', () => { $('homeErr').textContent = ''; });
  $('code').addEventListener('input', () => { $('homeErr').textContent = ''; });

  $('btnCreate').onclick = () => {
    const name = getName(); if (!name) return;
    socket.emit('create', { name }, (res) => {
      if (res.error) return ($('homeErr').textContent = res.error);
      saveSession({ code: res.code, token: res.token });
    });
  };
  $('btnJoin').onclick = () => {
    const name = getName(); if (!name) return;
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 4) { $('homeErr').textContent = 'Le code fait 4 lettres.'; return; }
    socket.emit('join', { code, name }, (res) => {
      if (res.error) return ($('homeErr').textContent = res.error);
      saveSession({ code: res.code, token: res.token });
      history.replaceState(null, '', '/');
    });
  };

  socket.on('connect', () => {
    const s = session();
    if (s) {
      socket.emit('join', { code: s.code, token: s.token, name: localStorage.getItem('name') }, (res) => {
        if (res.error) { clearSession(); show('home'); }
      });
    }
  });
  socket.on('disconnect', () => toast('Connexion perdue… reconnexion en cours', 'bad'));

  // ---------- Salon ----------
  $('btnShare').onclick = () => {
    const link = `${location.origin}/?c=${st.code}`;
    const msg = `Viens jouer à CheckGames avec moi ! Code : ${st.code}\n${link}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  };
  $('btnCopy').onclick = async () => {
    const link = `${location.origin}/?c=${st.code}`;
    try { await navigator.clipboard.writeText(link); toast('Lien copié', 'good'); } catch { toast(link); }
  };
  document.querySelectorAll('[data-step]').forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.step, d = +b.dataset.d;
      socket.emit('settings', { ...st.settings, [key]: st.settings[key] + d }, (r) => r.error && toast(r.error, 'bad'));
    };
  });
  $('sMode').onchange = () => socket.emit('settings', { ...st.settings, mode: $('sMode').value }, () => {});
  $('btnStart').onclick = () => socket.emit('start', {}, (r) => { $('lobbyErr').textContent = r.error || ''; });
  function quit() {
    socket.emit('leave', {}, () => {});
    clearSession(); st = null; selected = null; lastTopId = null; lastTurnId = null; prevPhase = null;
    ['quitModal', 'endModal', 'suitModal', 'restartModal'].forEach((id) => $(id).classList.add('hidden'));
    show('home');
  }
  $('btnLeave').onclick = quit;
  $('btnQuit').onclick = () => $('quitModal').classList.remove('hidden');
  $('quitNo').onclick = () => $('quitModal').classList.add('hidden');
  $('quitYes').onclick = quit;
  $('btnEndQuit').onclick = quit;
  $('btnRestart').onclick = () => $('restartModal').classList.remove('hidden');
  $('restartNo').onclick = () => $('restartModal').classList.add('hidden');
  $('restartYes').onclick = () => {
    $('restartModal').classList.add('hidden');
    socket.emit('restartRound', {}, (r) => r.error && toast(r.error, 'bad'));
  };

  function renderLobby() {
    show('lobby');
    $('lobbyCode').textContent = st.code;
    $('playerCount').textContent = `(${st.members.length}/5)`;
    $('lobbyPlayers').innerHTML = st.members.map((m) => `<li>
      <div class="avatar${m.connected ? '' : ' away'}">${esc(initials(m.name))}</div>
      <span>${esc(m.name)}${m.id === st.you ? ' <span class="muted">(toi)</span>' : ''}</span>
      ${m.id === st.hostId ? '<span class="host">Hôte</span>' : ''}</li>`).join('');
    $('sHand').textContent = st.settings.handSize;
    $('sMode').value = st.settings.mode;
    $('sTarget').textContent = st.settings.target;
    $('sTargetLabel').textContent = st.settings.mode === 'wins' ? 'Victoires pour gagner' : 'Nombre de manches';
    $('settings').classList.toggle('readonly', !isHost());
    $('btnStart').classList.toggle('hidden', !isHost());
    $('lobbyHint').textContent = !isHost()
      ? "En attente de l'hôte pour lancer la partie…"
      : st.members.length < 2 ? 'Il faut au moins 2 joueurs. Partage le code !' : '';
    $('btnStart').disabled = st.members.length < 2;
  }

  // ---------- Jeu ----------
  $('backCard').innerHTML = Cards.back();
  $('btnSound').textContent = soundOn ? '🔊' : '🔇';
  $('btnSound').onclick = () => {
    soundOn = !soundOn; localStorage.setItem('sound', soundOn ? 'on' : 'off');
    $('btnSound').textContent = soundOn ? '🔊' : '🔇';
  };

  const myTurn = () => st && st.game && st.game.turnId === st.you && !st.game.winnerId;

  function doDraw() {
    if (!myTurn()) return toast("Ce n'est pas ton tour.");
    selected = null;
    socket.emit('draw', {}, (r) => r.error && toast(r.error, 'bad'));
  }
  $('btnDraw').onclick = doDraw;
  $('drawPile').onclick = doDraw;
  $('btnCheck').onclick = () => socket.emit('check', {}, (r) => r.error && toast(r.error, 'bad'));
  $('btnPlay').onclick = () => playSelected();

  function playSelected() {
    if (!myTurn()) return toast("Ce n'est pas ton tour.");
    if (!selected) return toast('Choisis une carte dans ta main.');
    const card = st.game.hand.find((c) => c.id === selected);
    if (!card) return;
    if (!st.game.playable.includes(card.id)) return toast('Cette carte ne passe pas ici.', 'bad');
    if (card.rank === 'J') return openSuitModal(card.id);
    send(card.id);
  }
  function send(cardId, suit) {
    socket.emit('play', { cardId, suit }, (r) => { if (r.error) toast(r.error, 'bad'); });
    selected = null;
  }

  // Choix de couleur pour le J
  let pendingJack = null;
  $('suitButtons').innerHTML = ['H', 'C', 'D', 'S'].map((s) =>
    `<button data-suit="${s}">${Cards.suitIcon(s, 34)}<span>${Cards.SUIT_NAMES[s]}</span></button>`).join('');
  $('suitButtons').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { $('suitModal').classList.add('hidden'); if (pendingJack) send(pendingJack, b.dataset.suit); pendingJack = null; };
  });
  $('suitCancel').onclick = () => { $('suitModal').classList.add('hidden'); pendingJack = null; };
  function openSuitModal(id) { pendingJack = id; $('suitModal').classList.remove('hidden'); }

  function renderGame() {
    show('game');
    const g = st.game;
    const s = st.settings;
    $('gCode').textContent = st.code;
    $('btnRestart').classList.toggle('hidden', !(isHost() && st.phase === 'playing'));
    $('gRound').textContent = `Manche ${st.roundsPlayed + (st.phase === 'playing' ? 1 : 0)} · ` +
      (s.mode === 'wins' ? `premier à ${s.target}` : `${s.target} manches`) + (st.tiebreak ? ' · décisive' : '');

    // Adversaires dans l'ordre de jeu, en partant de moi
    const order = g.players.map((p) => p.id);
    const me = order.indexOf(st.you);
    const others = order.slice(me + 1).concat(order.slice(0, me));
    $('opponents').innerHTML = others.map((id) => {
      const m = member(id) || { name: '?', wins: 0, connected: false };
      const p = g.players.find((x) => x.id === id);
      const cls = ['avatar', g.turnId === id ? 'turn' : '', p.checked ? 'checked' : '', m.connected ? '' : 'away'].join(' ');
      return `<div class="opp">
        <span class="score">★ ${m.wins}</span>
        <div class="${cls}">${esc(initials(m.name))}</div>
        ${p.checked ? '<span class="ck">CHECK</span>' : ''}
        <span class="name">${esc(m.name)}</span>
        <span class="count"><i></i>${p.count}</span>
      </div>`;
    }).join('');

    // Table
    if (g.top.id !== lastTopId) {
      $('topCard').innerHTML = Cards.svg(g.top);
      $('topCard').classList.remove('flash'); void $('topCard').offsetWidth; $('topCard').classList.add('flash');
      lastTopId = g.top.id;
    }
    $('deckCount').textContent = g.deckCount;
    $('bPenalty').classList.toggle('hidden', !g.penalty);
    $('bPenalty').textContent = `Pioche +${g.penalty}`;
    $('bCommand').classList.toggle('hidden', !g.commanded);
    if (g.commanded) $('bCommand').innerHTML = `${Cards.suitIcon(g.commanded)} ${Cards.SUIT_NAMES[g.commanded]} demandé`;

    const mine = myTurn();
    $('drawPile').classList.toggle('can-draw', mine);
    $('status').classList.toggle('mine', mine);

    // Moi
    const meM = member(st.you);
    const meP = g.players.find((p) => p.id === st.you);
    $('meAvatar').textContent = initials(meM.name);
    $('meAvatar').className = ['avatar', mine ? 'turn' : '', meP && meP.checked ? 'checked' : ''].join(' ');
    $('meName').textContent = meM.name;
    $('meScore').textContent = `★ ${meM.wins} victoire${meM.wins > 1 ? 's' : ''}` + (meP && meP.checked ? ' · Check annoncé' : '');
    $('btnDraw').textContent = g.penalty && mine ? `Piocher ${g.penalty}` : 'Piocher';
    $('btnDraw').disabled = !mine;
    $('btnPlay').disabled = !mine || !selected || !g.playable.includes(selected);
    $('btnCheck').classList.toggle('hidden', !g.canCheck);

    // Main
    if (selected && !g.hand.some((c) => c.id === selected)) selected = null;
    const n = g.hand.length;
    const avail = Math.min(window.innerWidth, 520) - 40;
    const overlap = n > 1 ? Math.max(-56, Math.min(-12, (avail - 72 * n) / (n - 1))) : 0;
    $('hand').style.setProperty('--overlap', overlap + 'px');
    $('hand').innerHTML = g.hand.map((c) => {
      const ok = g.playable.includes(c.id);
      return `<div class="card${mine && !ok ? ' dim' : ''}${selected === c.id ? ' sel' : ''}" data-id="${c.id}">${Cards.svg(c)}</div>`;
    }).join('');
    $('hand').querySelectorAll('.card').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.id;
        if (!myTurn()) { toast("Ce n'est pas ton tour."); return; }
        if (selected === id) return playSelected();
        selected = id;
        renderGame();
      };
    });

    if (g.turnId !== lastTurnId) {
      if (mine) { sfx.turn(); vibrate(60); }
      lastTurnId = g.turnId;
    }
    tick();
  }

  function tick() {
    if (!st || !st.game || st.phase !== 'playing') { $('meTimer').textContent = ''; $('status').textContent = ''; return; }
    const left = Math.max(0, Math.ceil((st.turnDeadline - (Date.now() + skew)) / 1000));
    const g = st.game;
    if (myTurn()) {
      $('status').textContent = g.penalty ? `Contre avec un 7 ou un joker, ou pioche ${g.penalty}` : 'À toi de jouer';
      $('meTimer').textContent = left + 's';
      $('meTimer').classList.toggle('low', left <= 10);
    } else {
      $('status').textContent = `Au tour de ${nameOf(g.turnId)} · ${left}s`;
      $('meTimer').textContent = '';
    }
  }
  setInterval(tick, 500);

  // ---------- Fin de manche / match ----------
  $('btnNext').onclick = () => socket.emit('start', {}, (r) => r.error && toast(r.error, 'bad'));
  $('btnLobby').onclick = () => socket.emit('toLobby', {}, () => {});

  function renderEnd() {
    const over = st.phase === 'matchEnd';
    const wId = over ? st.matchWinnerId : st.game && st.game.winnerId;
    const w = member(wId);
    const who = wId === st.you ? 'Tu' : w ? w.name : '?';
    $('endTitle').textContent = over
      ? (wId === st.you ? 'Tu remportes le match !' : `${who} remporte le match !`)
      : (wId === st.you ? 'Tu gagnes la manche !' : `${who} gagne la manche !`);
    $('endSub').textContent = over ? `Après ${st.roundsPlayed} manches` : st.tiebreak ? 'Égalité : on joue une manche décisive !' : `Manche ${st.roundsPlayed} terminée`;
    const sorted = [...st.members].sort((a, b) => b.wins - a.wins);
    $('endScores').innerHTML = sorted.map((m, i) => `<li class="${i === 0 ? 'first' : ''}"><span>${esc(m.name)}${m.id === st.you ? ' (toi)' : ''}</span><b>★ ${m.wins}</b></li>`).join('');
    $('btnNext').textContent = over ? 'Revanche' : 'Manche suivante';
    $('btnNext').classList.toggle('hidden', !isHost());
    $('btnLobby').classList.toggle('hidden', !(over && isHost()));
    $('endWait').textContent = isHost() ? '' : "En attente de l'hôte…";
    $('endModal').classList.remove('hidden');
  }

  // ---------- Réception ----------
  socket.on('state', (s) => {
    st = s;
    skew = s.now - Date.now();
    if (s.phase === 'lobby') {
      $('endModal').classList.add('hidden');
      renderLobby();
    } else {
      if (s.game) renderGame();
      if (s.phase === 'roundEnd' || s.phase === 'matchEnd') {
        if (prevPhase === 'playing') sfx.win();
        renderEnd();
      } else {
        $('endModal').classList.add('hidden');
      }
    }
    prevPhase = s.phase;
  });

  socket.on('events', (evs) => {
    for (const e of evs) {
      const who = nameOf(e.playerId);
      const mine = e.playerId === (st && st.you);
      switch (e.type) {
        case 'play': {
          sfx.play();
          let t = `${who} pose ${Cards.label(e.card)}`;
          if (e.commanded) t += ` et commande ${Cards.suitIcon(e.commanded)} ${Cards.SUIT_NAMES[e.commanded]}`;
          if (e.card.rank === '7' || e.card.rank === 'JOKER') t += ` · pénalité ${e.penalty}`;
          if (!mine) toast(t);
          break;
        }
        case 'draw':
          sfx.draw();
          if (e.penalty) { toast(`${mine ? 'Tu pioches' : who + ' pioche'} ${e.count} carte${e.count > 1 ? 's' : ''}`, 'bad'); if (mine) { sfx.penalty(); vibrate([90, 50, 90]); } }
          else if (!mine) toast(`${who} pioche`);
          break;
        case 'timeout': toast(`Temps écoulé pour ${mine ? 'toi' : who}`, 'bad'); break;
        case 'check': sfx.check(); toast(mine ? '« Check ! » annoncé' : `${who} : « Check ! »`, 'good'); break;
        case 'forgotCheck': toast(`${mine ? 'Tu as' : who + ' a'} oublié de dire Check : +${e.count} carte`, 'bad'); if (mine) vibrate(150); break;
        case 'skip': toast(mine ? 'Tu sautes ton tour' : `${who} saute son tour`); break;
        case 'reshuffle': toast('La banque est remélangée'); break;
        case 'playerLeft': toast(`${esc(e.name)} a quitté la partie`, 'bad'); break;
        case 'blocked': toast(`Plus personne ne peut jouer : ${mine ? 'tu gagnes' : esc(who) + ' gagne'} avec le moins de cartes`, 'good'); break;
        case 'restart': selected = null; toast("L'hôte recommence la manche"); break;
        case 'notEnough': toast('Plus assez de joueurs : retour au salon', 'bad'); break;
        case 'roundStart': lastTopId = null; lastTurnId = null; toast('Nouvelle manche !', 'good'); break;
        default: break;
      }
    }
  });

  window.addEventListener('resize', () => { if (st && st.game && st.phase !== 'lobby') renderGame(); });
})();
