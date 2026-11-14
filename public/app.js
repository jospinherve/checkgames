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
  // Stockage tolérant : certains navigateurs (navigation privée, navigateurs intégrés aux applis)
  // refusent localStorage. On garde alors les valeurs en mémoire pour que le jeu fonctionne quand même.
  const memStore = {};
  const store = {
    get(k) { try { const v = localStorage.getItem(k); if (v !== null) return v; } catch {} return k in memStore ? memStore[k] : null; },
    set(k, v) { memStore[k] = String(v); try { localStorage.setItem(k, v); } catch {} },
    del(k) { delete memStore[k]; try { localStorage.removeItem(k); } catch {} },
  };
  let soundOn = store.get('sound') !== 'off';
  const session = () => { try { return JSON.parse(store.get('session') || 'null'); } catch { return null; } };
  const saveSession = (s) => store.set('session', JSON.stringify(s));
  const clearSession = () => store.del('session');

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
  const BOT_LEVEL = { easy: 'facile', normal: 'normal' };
  // Avatar : 🤖 pour un robot, sinon les initiales
  const avatarText = (m) => (m.bot ? '🤖' : initials(m.name));
  const member = (id) => st && st.members.find((m) => m.id === id);
  const nameOf = (id) => (st && id === st.you ? 'Tu' : (member(id) || {}).name || '?');
  const isHost = () => st && st.hostId === st.you;
  const waitingCount = () => (st && st.game ? st.members.filter((m) => !m.inGame).length : 0);
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
  $('name').value = store.get('name') || '';
  const urlCode = new URLSearchParams(location.search).get('c');
  if (urlCode) $('code').value = urlCode.toUpperCase();

  function getName() {
    const n = $('name').value.trim();
    if (!n) { $('homeErr').textContent = 'Entre ton pseudo.'; $('name').focus(); return null; }
    store.set('name', n);
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

  function resume() {
    const s = session();
    if (!s || !socket.connected) return;
    socket.emit('join', { code: s.code, token: s.token, name: store.get('name') }, (res) => {
      // Refus temporaire (trop de tentatives) : on garde la session et on réessaie
      if (res.error && res.retry) { toast(res.error, 'bad'); setTimeout(resume, 5000); return; }
      if (res.error) { clearSession(); show('home'); return; }
      // Le serveur peut nous avoir recréé comme nouveau joueur (ancienne place expirée) :
      // on garde toujours le jeton renvoyé, sinon chaque actualisation ajouterait un doublon.
      saveSession({ code: res.code, token: res.token });
    });
  }
  socket.on('connect', resume);
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
  const addBot = (level) => socket.emit('addBot', { level }, (r) => r.error && toast(esc(r.error), 'bad'));
  $('btnBotEasy').onclick = () => addBot('easy');
  $('btnBotNormal').onclick = () => addBot('normal');
  $('btnStart').onclick = () => socket.emit('start', {}, (r) => { $('lobbyErr').textContent = r.error || ''; });
  function backHome() {
    clearSession(); st = null; selected = null; lastTopId = null; lastTurnId = null; prevPhase = null;
    ['quitModal', 'endModal', 'suitModal', 'restartModal', 'kickModal', 'reactTray'].forEach((id) => $(id).classList.add('hidden'));
    show('home');
  }
  function quit() {
    socket.emit('leave', {}, () => {});
    backHome();
  }
  // Exclu par l'hôte
  socket.on('kicked', () => {
    backHome();
    $('homeErr').textContent = "L'hôte t'a exclu de la partie.";
  });

  // ---------- Exclure un joueur (hôte) ----------
  let kickTarget = null;
  function openKick(id) {
    const m = member(id);
    if (!m || !isHost() || id === st.you) return;
    kickTarget = id;
    $('kickTitle').textContent = `Exclure ${m.name} ?`;
    $('kickModal').classList.remove('hidden');
  }
  $('kickNo').onclick = () => { $('kickModal').classList.add('hidden'); kickTarget = null; };
  $('kickYes').onclick = () => {
    $('kickModal').classList.add('hidden');
    if (kickTarget) socket.emit('kick', { id: kickTarget }, (r) => r.error && toast(esc(r.error), 'bad'));
    kickTarget = null;
  };
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
      <div class="avatar${m.connected ? '' : ' away'}${m.bot ? ' bot' : ''}">${esc(avatarText(m))}</div>
      <span>${esc(m.name)}${m.id === st.you ? ' <span class="muted">(toi)</span>' : ''}${m.bot ? ` <span class="muted small">robot ${BOT_LEVEL[m.bot] || ''}</span>` : ''}</span>
      ${m.id === st.hostId ? '<span class="host">Hôte</span>' : ''}
      ${isHost() && m.id !== st.you ? `<button class="kick" data-kick="${esc(m.id)}" aria-label="Exclure">✕</button>` : ''}</li>`).join('');
    $('lobbyPlayers').querySelectorAll('[data-kick]').forEach((b) => { b.onclick = () => openKick(b.dataset.kick); });
    $('sHand').textContent = st.settings.handSize;
    $('sMode').value = st.settings.mode;
    $('sTarget').textContent = st.settings.target;
    $('sTargetLabel').textContent = st.settings.mode === 'wins' ? 'Victoires pour gagner' : 'Nombre de manches';
    $('settings').classList.toggle('readonly', !isHost());
    $('btnStart').classList.toggle('hidden', !isHost());
    $('botRow').classList.toggle('hidden', !isHost() || st.members.length >= 5);
    $('lobbyHint').textContent = !isHost()
      ? "En attente de l'hôte pour lancer la partie…"
      : st.members.length < 2 ? 'Il faut au moins 2 joueurs : partage le code ou ajoute un robot !' : '';
    $('btnStart').disabled = st.members.length < 2;
  }

  // ---------- Jeu ----------
  $('backCard').innerHTML = Cards.back();
  $('btnSound').textContent = soundOn ? '🔊' : '🔇';
  $('btnSound').onclick = () => {
    soundOn = !soundOn; store.set('sound', soundOn ? 'on' : 'off');
    $('btnSound').textContent = soundOn ? '🔊' : '🔇';
  };

  const myTurn = () => st && st.game && st.game.turnId === st.you && !st.game.winnerId;

  function doDraw() {
    if (!myTurn()) return toast("Ce n'est pas ton tour.");
    if (st.game.mustPlay) return toast('La banque est vide : tu dois poser une carte.', 'bad');
    selected = null;
    socket.emit('draw', {}, (r) => r.error && toast(r.error, 'bad'));
  }
  $('btnDraw').onclick = doDraw;
  $('drawPile').onclick = doDraw;
  // « Check » : soit annoncé en posant l'avant-dernière carte (bouton armé), soit juste après
  let checkArmed = false;
  $('btnCheck').onclick = () => {
    if (st.game.canCheck) return socket.emit('check', {}, (r) => r.error && toast(r.error, 'bad'));
    checkArmed = !checkArmed;
    renderGame();
  };
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
    socket.emit('play', { cardId, suit, check: checkArmed }, (r) => { if (r.error) toast(r.error, 'bad'); });
    selected = null;
    checkArmed = false;
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
      (s.mode === 'wins' ? `premier à ${s.target}` : `${s.target} manches`) + (st.tiebreak ? ' · décisive' : '') +
      (st.phase === 'playing' && waitingCount() ? ` · ${waitingCount()} attend` : '');

    // Adversaires dans l'ordre de jeu, en partant de moi
    const order = g.players.map((p) => p.id);
    const me = order.indexOf(st.you);
    // Spectateur (arrivé pendant la manche) : il voit tous les joueurs
    const others = me < 0 ? order : order.slice(me + 1).concat(order.slice(0, me));
    $('opponents').innerHTML = others.map((id) => {
      const m = member(id) || { name: '?', wins: 0, connected: false };
      const p = g.players.find((x) => x.id === id);
      const cls = ['avatar', g.turnId === id ? 'turn' : '', p.checked ? 'checked' : '', m.connected ? '' : 'away'].join(' ');
      return `<div class="opp${isHost() ? ' kickable' : ''}" data-id="${esc(id)}">
        <span class="score">★ ${m.wins}</span>
        <div class="${cls}${m.bot ? ' bot' : ''}">${esc(avatarText(m))}</div>
        ${p.checked ? '<span class="ck">CHECK</span>' : ''}
        <span class="name">${esc(m.name)}</span>
        <span class="count"><i></i>${p.count}</span>
      </div>`;
    }).join('');
    if (isHost()) $('opponents').querySelectorAll('.opp').forEach((el) => { el.onclick = () => openKick(el.dataset.id); });

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
    $('drawPile').classList.toggle('can-draw', mine && !g.mustPlay);
    $('status').classList.toggle('mine', mine);

    // Moi
    const meM = member(st.you);
    const meP = g.players.find((p) => p.id === st.you);
    $('meAvatar').textContent = initials(meM.name);
    $('meAvatar').className = ['avatar', mine ? 'turn' : '', meP && meP.checked ? 'checked' : ''].join(' ');
    $('meName').textContent = meM.name;
    $('meScore').textContent = `★ ${meM.wins} victoire${meM.wins > 1 ? 's' : ''}` + (meP && meP.checked ? ' · Check annoncé' : '');
    $('btnDraw').textContent = g.mustPlay ? 'Banque vide' : g.penalty && mine ? `Piocher ${g.penalty}` : 'Piocher';
    $('btnDraw').disabled = !mine || g.mustPlay;
    $('btnPlay').disabled = !mine || !selected || !g.playable.includes(selected);
    // Avec 2 cartes, on peut armer « Check » avant de poser l'avant-dernière
    const canAnnounce = mine && g.hand.length === 2;
    if (!canAnnounce) checkArmed = false;
    $('btnCheck').classList.toggle('hidden', !(g.canCheck || canAnnounce));
    $('btnCheck').classList.toggle('armed', checkArmed);
    $('btnCheck').classList.toggle('announce', canAnnounce && !g.canCheck);
    $('btnCheck').textContent = checkArmed ? '✓ Check' : 'Check !';
    // Arrivé pendant la manche : il regarde, sans main ni boutons
    const watching = !meP && st.phase === 'playing';
    $('waitBanner').classList.toggle('hidden', !watching);
    $('actions').classList.toggle('hidden', !meP);
    $('hand').classList.toggle('hidden', !meP);

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
      const cur = member(g.turnId);
      $('status').textContent = cur && cur.bot ? `${cur.name} réfléchit…` : `Au tour de ${nameOf(g.turnId)} · ${left}s`;
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
      const who = esc(nameOf(e.playerId)); // le nom est choisi par le joueur : jamais de HTML brut
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
        case 'playerKicked': toast(`${esc(e.name)} a été exclu par l'hôte`, 'bad'); break;
        case 'waiting': if (!mine) toast(`${esc(e.name)} est arrivé : il jouera à la prochaine manche`); break;
        case 'react': showReaction(e.playerId, e.emoji, who); break;
        case 'blocked': toast(`Plus personne ne peut jouer : ${mine ? 'tu gagnes' : who + ' gagne'} avec le moins de cartes`, 'good'); break;
        case 'restart': selected = null; toast("L'hôte recommence la manche"); break;
        case 'notEnough': toast('Plus assez de joueurs : retour au salon', 'bad'); break;
        case 'roundStart': lastTopId = null; lastTurnId = null; toast('Nouvelle manche !', 'good'); break;
        default: break;
      }
    }
  });

  // ---------- Réactions ----------
  const REACTIONS = ['😂', '🔥', '😤', '👏', '😱', '🙏'];
  $('reactTray').innerHTML = REACTIONS.map((e) => `<button data-emoji="${e}" aria-label="Réaction ${e}">${e}</button>`).join('');
  $('btnReact').onclick = () => $('reactTray').classList.toggle('hidden');
  $('reactTray').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $('reactTray').classList.add('hidden');
      socket.emit('react', { emoji: b.dataset.emoji }, (r) => r.error && toast(esc(r.error), 'bad'));
    };
  });
  function showReaction(playerId, emoji, who) {
    if (!REACTIONS.includes(emoji)) return;
    const mine = st && playerId === st.you;
    const target = mine ? $('meAvatar') : document.querySelector(`.opp[data-id="${CSS.escape(playerId)}"] .avatar`);
    if (!target || $('game').classList.contains('hidden')) return toast(`${mine ? 'Toi' : who} ${emoji}`);
    const r = target.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = emoji;
    el.style.left = r.left + r.width / 2 + 'px';
    el.style.top = r.top + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  // ---------- Appli installable (PWA) ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('btnInstall').classList.remove('hidden');
  });
  $('btnInstall').onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('btnInstall').classList.add('hidden');
  };
  window.addEventListener('appinstalled', () => $('btnInstall').classList.add('hidden'));
  // iPhone : pas d'invite automatique, on explique comment faire
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('iosHint').classList.remove('hidden');

  window.addEventListener('resize', () => { if (st && st.game && st.phase !== 'lobby') renderGame(); });
})();
