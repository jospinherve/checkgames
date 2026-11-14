// Mode hors-ligne : une partie contre les robots qui tourne entièrement dans le téléphone.
// Même règles (game.js) et mêmes robots (bot.js) que le serveur ; même format de messages, pour que
// l'écran de jeu fonctionne à l'identique, avec ou sans internet.
(function () {
  'use strict';
  const { Game, SUITS, MIN_HAND, MAX_HAND, MAX_PLAYERS } = self.CheckRules;
  const Bot = self.CheckBot;
  const REACTIONS = ['😂', '🔥', '😤', '👏', '😱', '🙏'];
  const PHRASES = ['Joue vite !', 'Bien joué !', "C'est chaud !", 'Tu vas voir…', 'On dit quoi ?', 'Revanche ?'];

  // deliver(event, data) : remet un message à l'appli, comme le ferait le serveur
  // opts.turnMs / opts.botMs : durées (raccourcies dans les tests)
  function create(deliver, opts = {}) {
    const TURN_MS = opts.turnMs || 30000;
    const BOT_DELAY_MS = opts.botMs || 1200;
    let room = null;
    let seq = 0;

    function view() {
      const g = room.game;
      const gs = g ? g.publicState('me') : null;
      return {
        code: 'SOLO', offline: true, public: false,
        you: 'me', hostId: 'me',
        phase: room.phase, settings: room.settings, roundsPlayed: room.roundsPlayed,
        tiebreak: room.tiebreak, matchWinnerId: room.matchWinnerId,
        turnDeadline: room.turnDeadline, now: Date.now(),
        members: room.members.map((m) => {
          const gp = gs && gs.players.find((p) => p.id === m.id);
          return {
            id: m.id, name: m.name, wins: m.wins, connected: true, bot: m.bot || null,
            inGame: !!gp, count: gp ? gp.count : 0, checked: gp ? gp.checked : false,
          };
        }),
        game: gs,
      };
    }
    const broadcast = () => deliver('state', view());
    const events = (evs) => deliver('events', evs);
    function flush() {
      const evts = room.game.events.splice(0);
      Bot.observe(room.memo, evts);
      if (evts.length) events(evts);
    }

    function scheduleTurn() {
      clearTimeout(room.timer);
      const g = room.game;
      if (!g || room.phase !== 'playing' || g.winnerId) { room.turnDeadline = 0; return; }
      const cur = room.members.find((m) => m.id === g.current.id);
      const turnId = cur.id;
      const ms = cur.bot ? Bot.thinkMs(g.publicState(cur.id), cur.id, cur.bot, BOT_DELAY_MS) : TURN_MS;
      room.turnDeadline = Date.now() + ms;
      const evCount = g.events.length;
      room.timer = setTimeout(() => {
        if (!room || room.game !== g || g.winnerId || g.current.id !== turnId) return;
        if (cur.bot) {
          const d = Bot.decide(g.publicState(cur.id), cur.id, cur.bot, Math.random, room.memo);
          const res = d.action === 'play' ? g.play(cur.id, d.cardId, d.suit, d.check) : g.draw(cur.id);
          if (res.error) g.autoMove(cur.id);
        } else {
          g.autoMove(turnId);
          g.events.splice(evCount, 0, { type: 'timeout', playerId: turnId });
        }
        afterAction();
      }, ms);
    }

    function isMatchOver() {
      const s = room.settings;
      const sorted = [...room.members].sort((a, b) => b.wins - a.wins);
      const best = sorted[0];
      const tie = sorted[1] && sorted[1].wins === best.wins;
      const over = s.mode === 'wins' ? best.wins >= s.target : room.roundsPlayed >= s.target;
      if (over && tie) { room.tiebreak = true; return false; }
      if (over) { room.matchWinnerId = best.id; room.tiebreak = false; }
      return over;
    }

    function afterAction() {
      const g = room.game;
      flush();
      if (g.winnerId) {
        clearTimeout(room.timer);
        room.turnDeadline = 0;
        const w = room.members.find((m) => m.id === g.winnerId);
        if (w) w.wins++;
        room.roundsPlayed++;
        room.lastWinnerId = g.winnerId;
        room.phase = isMatchOver() ? 'matchEnd' : 'roundEnd';
      } else {
        scheduleTurn();
      }
      broadcast();
    }

    function startRound() {
      if (room.members.length < 2) return 'Ajoute au moins un robot.';
      // À chaque manche, places tirées au hasard
      const m = room.members;
      for (let i = m.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [m[i], m[j]] = [m[j], m[i]]; }
      const starterId = room.members.some((x) => x.id === room.lastWinnerId) ? room.lastWinnerId : null;
      room.game = new Game(room.members.map((x) => ({ id: x.id, name: x.name })), room.settings, { starterId });
      room.phase = 'playing';
      room.game.emit({ type: 'roundStart', shuffled: m.length > 2 });
      flush();
      scheduleTurn();
      broadcast();
      return null;
    }

    function resetScores() {
      room.members.forEach((m) => { m.wins = 0; });
      room.roundsPlayed = 0; room.tiebreak = false; room.matchWinnerId = null; room.lastWinnerId = null;
    }

    const handlers = {
      create({ name }) {
        room = {
          phase: 'lobby', settings: { handSize: 5, mode: 'wins', target: 3 },
          members: [{ id: 'me', name: String(name || 'Joueur').slice(0, 14), wins: 0, bot: null }],
          roundsPlayed: 0, tiebreak: false, matchWinnerId: null, lastWinnerId: null,
          game: null, timer: null, turnDeadline: 0, memo: Bot.newMemory(),
        };
        broadcast();
        return { ok: true, code: 'SOLO' };
      },
      settings(s) {
        if (room.phase === 'playing' || (room.phase === 'roundEnd' && room.roundsPlayed > 0)) return { error: 'Réglages modifiables seulement avant le match.' };
        const out = room.settings;
        if (Number.isInteger(+s.handSize)) out.handSize = Math.min(MAX_HAND, Math.max(MIN_HAND, +s.handSize));
        if (s.mode === 'wins' || s.mode === 'rounds') out.mode = s.mode;
        if (Number.isInteger(+s.target)) out.target = Math.min(20, Math.max(1, +s.target));
        broadcast();
        return { ok: true };
      },
      addBot({ level }) {
        if (!Bot.LEVELS.includes(level)) return { error: 'Niveau inconnu.' };
        if (room.members.length >= MAX_PLAYERS) return { error: 'La partie est complète (5 joueurs).' };
        const used = new Set(room.members.map((m) => m.name));
        const free = Bot.BOT_NAMES.filter((n) => !used.has(n));
        const name = free.length ? free[Math.floor(Math.random() * free.length)] : 'Robot ' + (++seq);
        const bot = { id: 'bot' + (++seq), name, wins: 0, bot: level };
        room.members.push(bot);
        if (room.phase === 'playing') events([{ type: 'waiting', playerId: bot.id, name: bot.name }]);
        broadcast();
        return { ok: true };
      },
      kick({ id }) {
        const m = room.members.find((x) => x.id === id && x.bot);
        if (!m) return { error: 'Joueur introuvable.' };
        room.members = room.members.filter((x) => x !== m);
        if (room.phase === 'playing' && room.game && room.game.player(id)) {
          room.game.removePlayer(id);
          const ev = room.game.events.find((e) => e.type === 'playerLeft' && e.playerId === id);
          if (ev) ev.type = 'playerKicked';
          if (room.game.players.length < 2) { flush(); backToLobby(); } else afterAction();
        } else {
          events([{ type: 'playerKicked', playerId: id, name: m.name }]);
          if (room.phase !== 'lobby' && room.members.length < 2) backToLobby(); else broadcast();
        }
        return { ok: true };
      },
      start() {
        if (room.phase === 'playing') return { error: 'Déjà en cours.' };
        if (room.phase === 'matchEnd' || room.phase === 'lobby') resetScores();
        const err = startRound();
        return err ? { error: err } : { ok: true };
      },
      restartRound() {
        if (room.phase !== 'playing') return { error: 'Pas de manche en cours.' };
        events([{ type: 'restart' }]);
        const err = startRound();
        return err ? { error: err } : { ok: true };
      },
      toLobby() {
        if (room.phase !== 'matchEnd') return { error: 'Impossible.' };
        room.phase = 'lobby'; room.game = null;
        resetScores();
        broadcast();
        return { ok: true };
      },
      play(d) {
        if (!room.game || room.phase !== 'playing') return { error: 'Pas de manche en cours.' };
        const res = room.game.play('me', d.cardId, SUITS.includes(d.suit) ? d.suit : null, d.check === true);
        if (res.ok) afterAction();
        return res;
      },
      draw() {
        if (!room.game || room.phase !== 'playing') return { error: 'Pas de manche en cours.' };
        const res = room.game.draw('me');
        if (res.ok) afterAction();
        return res;
      },
      check() {
        if (!room.game || room.phase !== 'playing') return { error: 'Pas de manche en cours.' };
        const res = room.game.check('me');
        if (res.ok) { flush(); broadcast(); }
        return res;
      },
      react({ emoji }) {
        if (!REACTIONS.includes(emoji) && !PHRASES.includes(emoji)) return { error: 'Impossible.' };
        events([{ type: 'react', playerId: 'me', emoji }]);
        return { ok: true };
      },
      leave() {
        if (room) clearTimeout(room.timer);
        room = null;
        return { ok: true };
      },
    };

    function backToLobby() {
      clearTimeout(room.timer);
      room.phase = 'lobby'; room.game = null; room.turnDeadline = 0;
      resetScores();
      events([{ type: 'notEnough' }]);
      broadcast();
    }

    // Comme avec le serveur, les réponses arrivent un instant plus tard (jamais pendant le clic)
    return {
      emit(ev, data, cb) {
        setTimeout(() => {
          const fn = handlers[ev];
          const res = !fn ? { error: 'Impossible.' } : (ev !== 'create' && !room) ? { error: 'Pas de partie.' } : fn(data || {});
          if (typeof cb === 'function') cb(res);
        }, 0);
      },
    };
  }

  self.LocalGame = { create };
})();
