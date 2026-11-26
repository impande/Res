/* Office Arcade kit — shared by every game on resume4u.help/games/.
   Sound (WebAudio synth, no files), music, haptics, settings, storage, seeded RNG,
   levels + stars, daily challenge + streak, friend challenge links + rivals board,
   results screen, toasts, confetti, floating text, screen shake, and drawn office characters.
   Load in <head>: <link rel="stylesheet" href="/games/kit.css"><script src="/games/kit.js"></script>
   Then in the game script: OA.init({slug:'commute-dash', name:'Commute Dash'}). */
(function () {
  'use strict';
  var OA = {};
  var SITE = 'https://resume4u.help';
  var G = { slug: 'game', name: 'Game' };

  /* ---------- storage (always safe) ---------- */
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  OA.load = function (key, def) { return lsGet('oa:' + G.slug + ':' + key, def); };
  OA.save = function (key, val) { lsSet('oa:' + G.slug + ':' + key, val); };

  /* ---------- settings ---------- */
  var settings = lsGet('oa:settings', { sound: true, music: true, vibe: true });
  OA.settings = settings;
  function saveSettings() { lsSet('oa:settings', settings); }

  /* ---------- seeded RNG ---------- */
  function hashStr(s) { var h = 1779033703 ^ s.length; for (var i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return (h >>> 0); }
  OA.hash = hashStr;
  OA.rng = function (seed) {
    var a = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 1;
    var f = function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    f.int = function (n) { return Math.floor(f() * n); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length)]; };
    f.range = function (lo, hi) { return lo + f() * (hi - lo); };
    f.shuffle = function (arr) { var b = arr.slice(); for (var i = b.length - 1; i > 0; i--) { var j = Math.floor(f() * (i + 1)); var t = b[i]; b[i] = b[j]; b[j] = t; } return b; };
    f.chance = function (p) { return f() < p; };
    return f;
  };
  OA.newSeed = function () { return Math.floor(Math.random() * 2147483647) + 1; };

  /* ---------- dates / daily ---------- */
  function today(off) { var d = new Date(); if (off) d.setDate(d.getDate() + off); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  OA.today = today;
  OA.daily = {
    key: function () { return today(); },
    seed: function () { return hashStr(G.slug + ':' + today()); },
    best: function () { var d = OA.load('daily', {}); return d.date === today() ? d.best : null; },
    played: function () { return OA.daily.best() != null; },
    streak: function () { var d = OA.load('daily', {}); return (d.date === today() || d.date === today(-1)) ? (d.streak || 0) : 0; },
    /* record a daily score; returns {best, isBest, streak} */
    record: function (score) {
      var d = OA.load('daily', {}); var t = today(); var isBest = false;
      if (d.date === t) { if (score > d.best) { d.best = score; isBest = true; } }
      else { d.streak = (d.date === today(-1) ? (d.streak || 0) : 0) + 1; d.date = t; d.best = score; isBest = true; }
      OA.save('daily', d); return { best: d.best, isBest: isBest, streak: d.streak };
    },
    /* "Resets in 5h 12m" */
    resetsIn: function () { var n = new Date(), m = new Date(n); m.setHours(24, 0, 0, 0); var s = (m - n) / 1000; return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm'; }
  };

  /* ---------- best score ---------- */
  OA.best = function (mode) { return OA.load('best:' + (mode || 'main'), 0); };
  OA.submitBest = function (score, mode, lowerIsBetter) {
    var k = 'best:' + (mode || 'main'); var b = OA.load(k, null);
    var isBest = b == null || (lowerIsBetter ? score < b : score > b);
    if (isBest) OA.save(k, score); return { best: isBest ? score : b, isBest: isBest && b != null, first: b == null };
  };

  /* ---------- levels + stars ---------- */
  OA.levels = {
    data: function () { return OA.load('levels', {}); },
    stars: function (n) { var d = OA.levels.data()[n]; return d ? d.stars : 0; },
    bestOf: function (n) { var d = OA.levels.data()[n]; return d ? d.best : null; },
    isUnlocked: function (n) { return n <= 1 || OA.levels.stars(n - 1) > 0; },
    /* save a level result; keeps the best stars/score; returns {stars, newStars, total} */
    complete: function (n, stars, score) {
      var all = OA.levels.data(); var old = all[n] || { stars: 0, best: null };
      var nw = { stars: Math.max(old.stars, stars), best: old.best == null ? score : Math.max(old.best, score) };
      all[n] = nw; OA.save('levels', all);
      return { stars: nw.stars, newStars: Math.max(0, stars - old.stars), total: OA.levels.total() };
    },
    total: function () { var all = OA.levels.data(), t = 0; for (var k in all) t += all[k].stars || 0; return t; },
    highest: function () { var all = OA.levels.data(), h = 0; for (var k in all) if (all[k].stars > 0) h = Math.max(h, +k); return h; }
  };

  /* ---------- unlockables (cosmetics) ----------
     OA.unlocks.define([{id:'scooter-red', name:'Red scooter', need:0}, {id:'bike', name:'Bullet bike', need:12}], metric)
     metric(): number the "need" is compared against (default total stars). */
  var U = { list: [], metric: null };
  OA.unlocks = {
    define: function (list, metric) { U.list = list; U.metric = metric || function () { return OA.levels.total(); }; },
    all: function () { var m = U.metric ? U.metric() : 0; return U.list.map(function (u) { return Object.assign({}, u, { unlocked: m >= (u.need || 0) }); }); },
    selected: function () { var s = OA.load('skin', null); var a = OA.unlocks.all(); var f = a.filter(function (u) { return u.id === s && u.unlocked; })[0]; return (f || a[0] || {}).id; },
    select: function (id) { OA.save('skin', id); },
    /* call after progress changes: returns newly unlocked items (and remembers them) */
    fresh: function () { var seen = OA.load('seenUnlocks', []); var n = OA.unlocks.all().filter(function (u) { return u.unlocked && seen.indexOf(u.id) < 0; }); if (n.length) OA.save('seenUnlocks', seen.concat(n.map(function (u) { return u.id; }))); return n.filter(function (u) { return (u.need || 0) > 0; }); }
  };

  /* ---------- sound (WebAudio synth) ---------- */
  var AC = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
  function ac() {
    if (AC) return AC;
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    try { AC = new C(); } catch (e) { return null; }
    master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);
    var comp = AC.createDynamicsCompressor(); comp.connect(master);
    sfxBus = AC.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(comp);
    musBus = AC.createGain(); musBus.gain.value = 0.16; musBus.connect(comp);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 1.5, AC.sampleRate);
    var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return AC;
  }
  function unlockAudio() { var c = ac(); if (c && c.state === 'suspended') c.resume(); if (pendingMusic && settings.music) { var s = pendingMusic; pendingMusic = null; OA.music.play(s); } }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, unlockAudio, { passive: true, capture: true }); });
  document.addEventListener('visibilitychange', function () { if (!AC) return; if (document.hidden) AC.suspend(); else AC.resume(); });

  function tone(o) {
    /* o: {f, f2, type, dur, vol, at, attack, bus, q} */
    var c = AC; var t = c.currentTime + (o.at || 0); var dur = o.dur || 0.12;
    var osc = c.createOscillator(); var g = c.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
    var v = o.vol == null ? 0.5 : o.vol;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || sfxBus); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(o) {
    /* o: {dur, vol, at, type:'lowpass'|'bandpass'|'highpass', f, f2, q} */
    var c = AC; var t = c.currentTime + (o.at || 0); var dur = o.dur || 0.2;
    var src = c.createBufferSource(); src.buffer = noiseBuf;
    var fl = c.createBiquadFilter(); fl.type = o.type || 'lowpass'; fl.frequency.setValueAtTime(o.f || 1200, t);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + dur); fl.Q.value = o.q || 1;
    var g = c.createGain(); var v = o.vol == null ? 0.4 : o.vol;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(o.bus || sfxBus); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  var NOTE = function (n) { return 440 * Math.pow(2, (n - 69) / 12); };
  var SFX = {
    tap: function () { tone({ f: 660, f2: 520, type: 'sine', dur: 0.06, vol: 0.35 }); },
    click: function () { noise({ dur: 0.03, vol: 0.25, type: 'highpass', f: 3000 }); tone({ f: 1800, dur: 0.02, vol: 0.12, type: 'square' }); },
    pop: function () { tone({ f: 900, f2: 280, type: 'sine', dur: 0.09, vol: 0.45 }); },
    slide: function () { noise({ dur: 0.09, vol: 0.12, type: 'bandpass', f: 900, f2: 2200, q: 2 }); },
    merge: function (lvl) { var b = 60 + Math.min(24, (lvl || 0) * 2); tone({ f: NOTE(b), type: 'triangle', dur: 0.12, vol: 0.4 }); tone({ f: NOTE(b + 7), type: 'triangle', dur: 0.16, vol: 0.35, at: 0.06 }); tone({ f: NOTE(b + 12), type: 'sine', dur: 0.22, vol: 0.25, at: 0.11 }); },
    coin: function () { tone({ f: 988, type: 'square', dur: 0.07, vol: 0.18 }); tone({ f: 1319, type: 'square', dur: 0.22, vol: 0.18, at: 0.07 }); },
    power: function () { tone({ f: 300, f2: 1200, type: 'sawtooth', dur: 0.35, vol: 0.16 }); tone({ f: 600, f2: 2400, type: 'sine', dur: 0.35, vol: 0.2, at: 0.05 }); },
    whoosh: function () { noise({ dur: 0.28, vol: 0.3, type: 'bandpass', f: 400, f2: 3000, q: 1.5 }); },
    hit: function () { tone({ f: 160, f2: 50, type: 'sine', dur: 0.18, vol: 0.7 }); noise({ dur: 0.12, vol: 0.35, type: 'lowpass', f: 2500 }); },
    bat: function () { tone({ f: 420, f2: 180, type: 'triangle', dur: 0.08, vol: 0.6 }); noise({ dur: 0.06, vol: 0.5, type: 'bandpass', f: 1800, q: 3 }); },
    crash: function () { noise({ dur: 0.6, vol: 0.55, type: 'lowpass', f: 3000, f2: 200 }); tone({ f: 110, f2: 40, type: 'sine', dur: 0.4, vol: 0.6 }); },
    error: function () { tone({ f: 180, type: 'sawtooth', dur: 0.12, vol: 0.2 }); tone({ f: 140, type: 'sawtooth', dur: 0.18, vol: 0.2, at: 0.1 }); },
    tick: function () { tone({ f: 2000, type: 'square', dur: 0.015, vol: 0.08 }); },
    star: function (i) { var b = 84 + (i || 0) * 4; tone({ f: NOTE(b), type: 'sine', dur: 0.25, vol: 0.3 }); tone({ f: NOTE(b + 7), type: 'sine', dur: 0.3, vol: 0.2, at: 0.05 }); },
    win: function () { [72, 76, 79, 84].forEach(function (n, i) { tone({ f: NOTE(n), type: 'triangle', dur: 0.2, vol: 0.38, at: i * 0.1 }); }); tone({ f: NOTE(88), type: 'sine', dur: 0.6, vol: 0.25, at: 0.4 }); },
    lose: function () { [67, 63, 60, 55].forEach(function (n, i) { tone({ f: NOTE(n), type: 'triangle', dur: 0.25, vol: 0.32, at: i * 0.16 }); }); },
    levelup: function () { [60, 64, 67, 72, 76, 79].forEach(function (n, i) { tone({ f: NOTE(n), type: 'square', dur: 0.09, vol: 0.12, at: i * 0.06 }); }); },
    cheer: function () { noise({ dur: 1.1, vol: 0.25, type: 'bandpass', f: 1200, q: 0.7, attack: 0.25 }); },
    beep: function () { tone({ f: 880, type: 'square', dur: 0.08, vol: 0.12 }); },
    horn: function () { tone({ f: 392, type: 'sawtooth', dur: 0.22, vol: 0.18 }); tone({ f: 494, type: 'sawtooth', dur: 0.22, vol: 0.14 }); },
    whistle: function () { tone({ f: 1800, f2: 2600, type: 'sine', dur: 0.5, vol: 0.2 }); },
    type: function () { noise({ dur: 0.025, vol: 0.2, type: 'highpass', f: 2500 }); tone({ f: 120 + Math.random() * 40, dur: 0.03, vol: 0.12, type: 'square' }); },
    ding: function () { tone({ f: NOTE(88), type: 'sine', dur: 0.5, vol: 0.3 }); tone({ f: NOTE(95), type: 'sine', dur: 0.6, vol: 0.15, at: 0.02 }); },
    swipe: function () { noise({ dur: 0.14, vol: 0.2, type: 'bandpass', f: 1500, f2: 600, q: 2 }); }
  };
  /* OA.sfx('merge', 3) — named preset; unknown names are ignored */
  OA.sfx = function (name, arg) { if (!settings.sound) return; if (!ac() || !SFX[name]) return; try { SFX[name](arg); } catch (e) {} };
  OA.sfx.tone = function (o) { if (settings.sound && ac()) try { tone(o); } catch (e) {} };
  OA.sfx.noise = function (o) { if (settings.sound && ac()) try { noise(o); } catch (e) {} };
  OA.note = NOTE;

  /* ---------- music: gentle looping step sequencer ----------
     styles: 'chill' (lo-fi office), 'arcade' (upbeat), 'tense' (stealth / time pressure), 'bazaar' (desi raga-ish) */
  var MUS = {
    chill: { bpm: 84, prog: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]], bass: 'sine', lead: 'triangle', scale: [69, 72, 74, 76, 79, 81], hat: 0.5 },
    arcade: { bpm: 128, prog: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], bass: 'square', lead: 'square', scale: [72, 74, 76, 79, 81, 84], hat: 1 },
    tense: { bpm: 108, prog: [[57, 60, 64], [57, 60, 63], [56, 60, 63], [55, 58, 62]], bass: 'sawtooth', lead: 'sine', scale: [69, 70, 72, 75, 76], hat: 0.8 },
    bazaar: { bpm: 100, prog: [[50, 57, 62], [50, 57, 62], [48, 55, 60], [50, 57, 62]], bass: 'triangle', lead: 'sawtooth', scale: [62, 63, 66, 67, 69, 70, 73, 74], hat: 0.7 }
  };
  var mState = { style: null, timer: null, step: 0, next: 0 }; var pendingMusic = null;
  OA.music = {
    play: function (style) {
      style = MUS[style] ? style : 'chill';
      if (!settings.music) { mState.want = style; return; }
      if (!AC || AC.state !== 'running') { pendingMusic = style; mState.want = style; if (AC) AC.resume(); return; }
      if (mState.style === style && mState.timer) return;
      OA.music.stop(); mState.style = style; mState.want = style; mState.step = 0; mState.next = AC.currentTime + 0.1;
      var S = MUS[style]; var spb = 60 / S.bpm / 2; /* eighth notes */
      var r = OA.rng(hashStr(style + G.slug));
      mState.timer = setInterval(function () {
        while (mState.next < AC.currentTime + 0.25) {
          var st = mState.step, at = mState.next - AC.currentTime; var chord = S.prog[Math.floor(st / 8) % S.prog.length];
          if (st % 8 === 0) chord.forEach(function (n) { tone({ f: NOTE(n), type: 'sine', dur: spb * 7.5, vol: 0.12, at: at, attack: 0.08, bus: musBus }); });
          if (st % 4 === 0) tone({ f: NOTE(chord[0] - 12), type: S.bass, dur: spb * 1.8, vol: 0.32, at: at, bus: musBus });
          if (st % 4 === 2 && S.hat) noise({ dur: 0.04, vol: 0.12 * S.hat, type: 'highpass', f: 6000, at: at, bus: musBus });
          if (st % 8 === 4) noise({ dur: 0.1, vol: 0.14, type: 'bandpass', f: 1800, at: at, bus: musBus });
          if (st % 8 === 0) tone({ f: 70, f2: 40, type: 'sine', dur: 0.15, vol: 0.4, at: at, bus: musBus });
          if (r() < 0.32) tone({ f: NOTE(r.pick(S.scale)), type: S.lead, dur: spb * 0.9, vol: S.lead === 'square' || S.lead === 'sawtooth' ? 0.05 : 0.12, at: at, bus: musBus });
          mState.step++; mState.next += spb;
        }
      }, 60);
    },
    stop: function () { if (mState.timer) clearInterval(mState.timer); mState.timer = null; mState.style = null; },
    /* temporarily duck music (e.g. during results) */
    duck: function (on) { if (musBus && AC) musBus.gain.setTargetAtTime(on ? 0.05 : 0.16, AC.currentTime, 0.2); }
  };

  /* ---------- haptics ---------- */
  OA.buzz = function (p) { if (!settings.vibe) return; try { var ua = navigator.userActivation; if (ua && !ua.hasBeenActive) return; if (navigator.vibrate) navigator.vibrate(p || 12); } catch (e) {} };

  /* ---------- settings toggles: OA.controls() returns an element to put in the game header ---------- */
  OA.controls = function () {
    var w = document.createElement('div'); w.className = 'oa-ctl'; w.setAttribute('role', 'group'); w.setAttribute('aria-label', 'Sound settings');
    var items = [['sound', '🔊', '🔈', 'Sound effects'], ['music', '🎵', '🎵', 'Music'], ['vibe', '📳', '📴', 'Vibration']];
    if (!('vibrate' in navigator)) items.pop();
    items.forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'oa-ctl-b';
      function paint() { b.textContent = settings[it[0]] ? it[1] : it[2]; b.setAttribute('aria-pressed', settings[it[0]] ? 'true' : 'false'); b.title = it[3] + (settings[it[0]] ? ' on' : ' off'); b.setAttribute('aria-label', b.title); b.classList.toggle('off', !settings[it[0]]); }
      b.addEventListener('click', function () {
        settings[it[0]] = !settings[it[0]]; saveSettings(); paint();
        if (it[0] === 'music') { if (settings.music) { unlockAudio(); OA.music.play(mState.want || 'chill'); } else { var w2 = mState.style || mState.want; OA.music.stop(); mState.want = w2; } }
        if (it[0] === 'sound' && settings.sound) OA.sfx('tap');
        if (it[0] === 'vibe' && settings.vibe) OA.buzz(20);
      });
      paint(); w.appendChild(b);
    });
    return w;
  };

  /* ---------- player name ---------- */
  OA.playerName = function () { return lsGet('oa:name', ''); };
  OA.setPlayerName = function (n) { lsSet('oa:name', String(n || '').trim().slice(0, 18)); };

  /* ---------- friend challenge links ----------
     A challenge carries: n (name), sc (score), s (seed), m (mode), l (level), x (score label), t (lower is better).
     The friend opening the link plays the exact same round (same seed) and is shown who wins. */
  function b64e(o) { var s = unescape(encodeURIComponent(JSON.stringify(o))); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { try { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; } }
  var incoming = null;
  (function () {
    try {
      var q = new URLSearchParams(location.search).get('c'); if (!q) return; var c = b64d(q);
      if (c && typeof c.sc === 'number' && isFinite(c.sc)) { c.n = String(c.n || 'A friend').replace(/[<>&"]/g, '').slice(0, 18) || 'A friend'; c.s = (+c.s >>> 0) || 0; incoming = c; }
    } catch (e) {}
  })();
  OA.challenge = {
    /* the challenge this visitor arrived with, or null */
    incoming: function () { return incoming; },
    /* forget the challenge (e.g. after they finish it) and clean the URL */
    clear: function () { incoming = null; try { history.replaceState(null, '', location.pathname); } catch (e) {} },
    url: function (o) { var p = { n: OA.playerName() || 'A friend', sc: o.score, s: o.seed >>> 0 }; if (o.mode) p.m = o.mode; if (o.level) p.l = o.level; if (o.label) p.x = o.label; if (o.lowerIsBetter) p.t = 1; return SITE + '/games/' + G.slug + '/?c=' + b64e(p); },
    /* compare a finished score with the incoming challenge */
    versus: function (score) {
      if (!incoming) return null; var low = !!incoming.t; var diff = low ? incoming.sc - score : score - incoming.sc;
      var r = { name: incoming.n, theirs: incoming.sc, mine: score, won: diff > 0, tie: diff === 0, diff: Math.abs(diff) };
      var b = OA.load('rivals', []); b = b.filter(function (x) { return x.n !== incoming.n; }); b.unshift({ n: incoming.n, theirs: incoming.sc, mine: score, won: r.won, d: today() }); OA.save('rivals', b.slice(0, 20));
      return r;
    },
    rivals: function () { return OA.load('rivals', []); }
  };
  /* WhatsApp share href. o: {text, score, seed, mode, level, label, lowerIsBetter}. Text should not include a URL; the challenge link is appended. */
  OA.shareHref = function (o) { var u = o.seed != null ? OA.challenge.url(o) : SITE + '/games/' + G.slug + '/'; return 'https://wa.me/?text=' + encodeURIComponent(o.text + '\n' + u); };

  /* ---------- DOM helpers ---------- */
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  OA.esc = esc;
  OA.fmt = function (n) { return Math.round(n).toLocaleString('en-IN'); };
  var reduced = false; try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  OA.reducedMotion = reduced;

  /* toast at top of screen */
  var toastWrap;
  OA.toast = function (msg, kind) {
    if (!toastWrap) { toastWrap = el('div', 'oa-toasts'); toastWrap.setAttribute('aria-live', 'polite'); document.body.appendChild(toastWrap); }
    var t = el('div', 'oa-toast' + (kind ? ' ' + kind : ''), msg); toastWrap.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, 2200);
  };
  /* floating "+10" text at a point (client coords) */
  OA.floatText = function (x, y, text, color) {
    var f = el('div', 'oa-float', esc(text)); f.style.left = x + 'px'; f.style.top = y + 'px'; if (color) f.style.color = color;
    document.body.appendChild(f); setTimeout(function () { f.remove(); }, 900);
  };
  /* shake an element */
  OA.shake = function (node, strength) { if (reduced || !node) return; node.classList.remove('oa-shake', 'oa-shake-big'); void node.offsetWidth; node.classList.add(strength === 'big' ? 'oa-shake-big' : 'oa-shake'); };
  /* count a number up inside an element */
  OA.countUp = function (node, to, ms, fmt) { fmt = fmt || OA.fmt; if (reduced) { node.textContent = fmt(to); return; } var t0 = performance.now(); ms = ms || 700; (function f(t) { var p = Math.min(1, (t - t0) / ms); node.textContent = fmt(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); })(t0); };

  /* confetti burst (full-screen canvas, auto-removes) */
  OA.confetti = function (o) {
    if (reduced) return; o = o || {}; var n = o.count || 140;
    var cv = el('canvas', 'oa-confetti'); var dpr = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; document.body.appendChild(cv);
    var c = cv.getContext('2d'); c.scale(dpr, dpr); var cols = o.colors || ['#fbbf24', '#f472b6', '#60a5fa', '#4ade80', '#f87171', '#a78bfa', '#fde68a'];
    var ox = o.x == null ? innerWidth / 2 : o.x, oy = o.y == null ? innerHeight * 0.35 : o.y;
    var P = []; for (var i = 0; i < n; i++) { var a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 9; P.push({ x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, r: Math.random() * 6.28, vr: (Math.random() - .5) * .4, w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, c: cols[i % cols.length] }); }
    var t0 = performance.now();
    (function f(t) { var el2 = t - t0; c.clearRect(0, 0, innerWidth, innerHeight); P.forEach(function (p) { p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.globalAlpha = Math.max(0, 1 - el2 / 2600); c.fillStyle = p.c; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore(); }); if (el2 < 2600) requestAnimationFrame(f); else cv.remove(); })(t0);
  };

  /* ---------- modal ---------- */
  var openModal = null;
  OA.modal = function (html, o) {
    o = o || {}; OA.closeModal();
    var bg = el('div', 'oa-modal-bg'); var m = el('div', 'oa-modal' + (o.cls ? ' ' + o.cls : '')); m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    if (o.label) m.setAttribute('aria-label', o.label);
    m.innerHTML = html; bg.appendChild(m); document.body.appendChild(bg); openModal = bg;
    requestAnimationFrame(function () { bg.classList.add('in'); });
    m.tabIndex = -1; var f = m.querySelector('[autofocus]') || m; setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) {} }, 60);
    if (o.dismiss) bg.addEventListener('click', function (e) { if (e.target === bg) OA.closeModal(); });
    return m;
  };
  OA.closeModal = function () { if (openModal) { var b = openModal; openModal = null; b.classList.remove('in'); setTimeout(function () { b.remove(); }, 200); } };

  /* ask for the player's name (used on challenge links). cb(name) */
  OA.askName = function (cb, o) {
    o = o || {};
    var m = OA.modal('<div class="oa-m-emoji">✍️</div><h2>' + esc(o.title || 'Your name for the challenge') + '</h2><p class="oa-m-sub">' + esc(o.sub || 'Friends will see who sent the challenge.') + '</p>' +
      '<form class="oa-name"><input maxlength="18" autocomplete="given-name" placeholder="e.g. Priya" value="' + esc(OA.playerName()) + '" aria-label="Your name" autofocus><button class="oa-btn" type="submit">Save</button></form>', { label: 'Your name' });
    var f = m.querySelector('form'), i = m.querySelector('input'); setTimeout(function () { i.focus(); }, 80);
    f.addEventListener('submit', function (e) { e.preventDefault(); OA.setPlayerName(i.value || 'A friend'); OA.closeModal(); cb && cb(OA.playerName()); });
  };

  /* ---------- results screen ----------
     OA.result({
       emoji:'🏆', title:'Promoted!', sub:'You reached Director', win:true,
       score: 2340, scoreLabel:'points', fmt: fn,           // big number (optional)
       stars: 0-3 | null, rank: '🦁 Office Legend',
       stats: [['Merges', 34], ['Best tile', 'Director']],
       best: {isBest:true, best:2340},                     // from OA.submitBest (optional)
       share: {text:'I scored 2,340 in Corporate Ladder 🏢 Can you beat me?', score, seed, mode, level, label, lowerIsBetter},
       next: {label:'Next level →', fn}, again: {label:'Play again', fn}, menu: {label:'Levels', fn},
       tip: 'html'                                         // small line under the buttons (e.g. resume CTA)
     }) */
  OA.result = function (r) {
    var vs = r.share && r.share.score != null ? OA.challenge.versus(r.share.score) : null;
    var fmt = r.fmt || OA.fmt;
    var h = '<div class="oa-res-top ' + (r.win === false ? 'lose' : 'win') + '"><div class="oa-m-emoji big">' + (r.emoji || '🏆') + '</div>' +
      '<h2>' + esc(r.title || '') + '</h2>' + (r.sub ? '<p class="oa-m-sub">' + r.sub + '</p>' : '') + '</div>';
    if (r.stars != null) { h += '<div class="oa-stars" aria-label="' + r.stars + ' of 3 stars">'; for (var i = 0; i < 3; i++) h += '<span class="oa-star' + (i < r.stars ? ' on' : '') + '" style="--d:' + (i * 0.18 + 0.2) + 's">★</span>'; h += '</div>'; }
    if (r.score != null) h += '<div class="oa-score"><b class="oa-score-n">0</b><span>' + esc(r.scoreLabel || 'score') + '</span>' + (r.best && r.best.isBest ? '<i class="oa-newbest">New best!</i>' : (r.best && r.best.best != null ? '<i>Best: ' + fmt(r.best.best) + '</i>' : '')) + '</div>';
    if (r.rank) h += '<div class="oa-rank">' + r.rank + '</div>';
    if (vs) h += '<div class="oa-vs ' + (vs.won ? 'won' : vs.tie ? 'tie' : 'lost') + '"><b>' + (vs.won ? '🎉 You beat ' + esc(vs.name) + '!' : vs.tie ? '🤝 Tie with ' + esc(vs.name) + '!' : '😅 ' + esc(vs.name) + ' wins this time') + '</b><span>' + esc(vs.name) + ': ' + fmt(vs.theirs) + ' · You: ' + fmt(vs.mine) + '</span></div>';
    if (r.stats && r.stats.length) h += '<dl class="oa-stats">' + r.stats.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('') + '</dl>';
    h += '<div class="oa-actions">';
    if (r.share) h += '<a class="oa-btn wa" target="_blank" rel="noopener" href="#" data-share>' + (vs && !vs.won ? '🔁 Send ' + esc(vs.name) + ' a rematch' : '💬 Challenge friends on WhatsApp') + '</a>';
    if (r.next) h += '<button class="oa-btn" type="button" data-next>' + esc(r.next.label || 'Next level →') + '</button>';
    h += '<div class="oa-row">';
    if (r.again) h += '<button class="oa-btn ghost" type="button" data-again>' + esc(r.again.label || 'Play again') + '</button>';
    if (r.menu) h += '<button class="oa-btn ghost" type="button" data-menu>' + esc(r.menu.label || 'Menu') + '</button>';
    h += '</div></div>';
    if (r.share) h += '<button class="oa-link" type="button" data-name>' + (OA.playerName() ? 'Sending as ' + esc(OA.playerName()) + ' · change' : 'Add your name to the challenge') + '</button>';
    /* Resume For You promo card: always shown on results (the games exist to introduce the resume builder) */
    h += '<div class="oa-promo"><img src="/logo-mark.svg?v=4" alt="" width="40" height="40"><div class="oa-promo-t"><b>Resume For You</b>' +
      '<span>' + (r.tip || 'Free AI resume builder for India. ATS-friendly resume in minutes.') + '</span></div>' +
      '<a class="oa-promo-b" href="/" data-promo>Build my resume free →</a></div>';
    var m = OA.modal(h, { cls: 'oa-result', label: r.title || 'Result' });
    var n = m.querySelector('.oa-score-n'); if (n) OA.countUp(n, r.score, 800, fmt);
    var a = m.querySelector('[data-share]');
    function setHref() { if (a) a.href = OA.shareHref(r.share); }
    setHref();
    if (a) a.addEventListener('click', function (e) { if (!OA.playerName()) { e.preventDefault(); OA.askName(function () { setHref(); window.open(a.href, '_blank', 'noopener'); OA.result(r); }); } else { OA.sfx('tap'); } });
    var nm = m.querySelector('[data-name]'); if (nm) nm.addEventListener('click', function () { OA.askName(function () { OA.result(r); }); });
    [['[data-next]', r.next], ['[data-again]', r.again], ['[data-menu]', r.menu]].forEach(function (p) { var b = m.querySelector(p[0]); if (b && p[1]) b.addEventListener('click', function () { OA.sfx('tap'); OA.closeModal(); OA.music.duck(false); if (vs) OA.challenge.clear(); p[1].fn && p[1].fn(); }); });
    if (r.stars != null) for (var k = 0; k < r.stars; k++) (function (k) { setTimeout(function () { OA.sfx('star', k); OA.buzz(15); }, 200 + k * 180); })(k);
    if (r.win !== false) { OA.sfx('win'); if (r.confetti !== false) OA.confetti(); OA.buzz([30, 40, 30]); } else { OA.sfx('lose'); OA.buzz(120); }
    OA.music.duck(true);
    return m;
  };

  /* banner shown at the start when someone arrives from a challenge link: returns html string or '' */
  OA.challengeBanner = function () {
    var c = incoming; if (!c) return '';
    return '<div class="oa-chal"><span class="oa-chal-e">⚔️</span><div><b>' + esc(c.n) + ' challenged you!</b><span>Beat ' + OA.fmt(c.sc) + (c.x ? ' ' + esc(c.x) : '') + (c.l ? ' on level ' + (+c.l) : '') + '. Same round, same luck.</span></div></div>';
  };

  /* ---------- drawn office characters ----------
     OA.art.person({skin, hair, hairColor, shirt, pants, tie, lanyard, glasses, beard, bindi, mood, cap, saree, pose})
     returns an SVG string (viewBox 0 0 100 140). Use as innerHTML or OA.art.img(svg) for canvas.
     skin: 0-4 index or hex; hair: 'short'|'side'|'long'|'bun'|'curly'|'bald'|'spiky'|'ponytail'
     mood: 'neutral'|'happy'|'angry'|'shocked'|'sleepy'|'smug'|'sad'; pose: 'stand'|'wave'|'arms-up'|'phone'|'coffee' */
  var SKIN = ['#f1c8a5', '#e0a979', '#c58c5c', '#9c6a43', '#6f4a2f'];
  var INK = '#1b2036';
  function person(o) {
    o = o || {};
    var sk = typeof o.skin === 'number' ? SKIN[o.skin % SKIN.length] : (o.skin || SKIN[1]);
    var hc = o.hairColor || '#1f1712', sh = o.shirt || '#3b82f6', pa = o.pants || '#2b3350', mood = o.mood || 'neutral', pose = o.pose || 'stand';
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" width="' + (o.w || 100) + '" height="' + (o.h || 140) + '" aria-hidden="true">';
    var st = ' stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
    /* legs + shoes */
    s += '<path d="M36 104 L35 128 L47 128 L49 104 Z" fill="' + pa + '"' + st + '/><path d="M51 104 L53 128 L65 128 L64 104 Z" fill="' + pa + '"' + st + '/>';
    s += '<path d="M31 128 h17 v5 h-19 z" fill="#2a1f1a"' + st + '/><path d="M52 128 h17 l2 5 h-19 z" fill="#2a1f1a"' + st + '/>';
    if (o.saree) s += '<path d="M30 70 Q50 64 70 70 L74 130 L26 130 Z" fill="' + sh + '"' + st + '/><path d="M60 64 Q76 84 70 128" fill="none" stroke="' + (o.border || '#fbbf24') + '" stroke-width="5"/>';
    /* arms (behind torso for some poses) */
    var armL, armR;
    if (pose === 'wave') { armL = 'M30 70 Q20 88 24 104'; armR = 'M70 68 Q84 56 82 40'; }
    else if (pose === 'arms-up') { armL = 'M30 68 Q18 52 20 36'; armR = 'M70 68 Q82 52 80 36'; }
    else if (pose === 'phone') { armL = 'M30 70 Q20 88 24 104'; armR = 'M70 70 Q78 72 66 56'; }
    else if (pose === 'coffee') { armL = 'M30 70 Q20 88 24 104'; armR = 'M70 70 Q82 86 70 92'; }
    else { armL = 'M30 70 Q20 88 24 104'; armR = 'M70 70 Q80 88 76 104'; }
    s += '<path d="' + armL + '" fill="none" stroke="' + INK + '" stroke-width="12" stroke-linecap="round"/><path d="' + armL + '" fill="none" stroke="' + sh + '" stroke-width="7.5" stroke-linecap="round"/>';
    s += '<path d="' + armR + '" fill="none" stroke="' + INK + '" stroke-width="12" stroke-linecap="round"/><path d="' + armR + '" fill="none" stroke="' + sh + '" stroke-width="7.5" stroke-linecap="round"/>';
    var hand = function (d) { var p = d.split(' '), e = p[p.length - 1].split(' '); var xy = d.match(/(-?\d+(\.\d+)?)/g); var x = +xy[xy.length - 2], y = +xy[xy.length - 1]; return '<circle cx="' + x + '" cy="' + y + '" r="5" fill="' + sk + '"' + st + '/>'; };
    s += hand(armL) + hand(armR);
    /* torso */
    if (!o.saree) s += '<path d="M30 66 Q50 58 70 66 L68 106 L32 106 Z" fill="' + sh + '"' + st + '/>';
    s += '<path d="M42 62 L50 72 L58 62" fill="#fff" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
    if (o.tie) s += '<path d="M50 72 L46 78 L50 96 L54 78 Z" fill="' + (o.tie === true ? '#dc2626' : o.tie) + '"' + st + '/>';
    if (o.lanyard) s += '<path d="M42 64 L50 86 L58 64" fill="none" stroke="' + (o.lanyard === true ? '#2563eb' : o.lanyard) + '" stroke-width="2.5"/><rect x="45" y="85" width="10" height="13" rx="2" fill="#fff"' + st + '/><rect x="47" y="88" width="6" height="3" fill="#93c5fd"/>';
    if (pose === 'phone') s += '<rect x="60" y="44" width="10" height="16" rx="2" fill="#111827"' + st + '/>';
    if (pose === 'coffee') s += '<path d="M64 84 h12 l-1.5 12 h-9 z" fill="#fff"' + st + '/><path d="M67 80 q2-3 0-6 M71 80 q2-3 0-6" stroke="#cbd5e1" stroke-width="1.6" fill="none"/>';
    /* neck + head */
    s += '<rect x="44" y="52" width="12" height="12" fill="' + sk + '"' + st + '/>';
    var hair = o.hair || 'short';
    if (hair === 'long' || hair === 'ponytail') s += '<path d="M28 34 Q26 66 34 70 L66 70 Q74 66 72 34 Z" fill="' + hc + '"' + st + '/>';
    s += '<ellipse cx="50" cy="36" rx="20" ry="22" fill="' + sk + '"' + st + '/>';
    s += '<ellipse cx="30" cy="38" rx="3.5" ry="5" fill="' + sk + '"' + st + '/><ellipse cx="70" cy="38" rx="3.5" ry="5" fill="' + sk + '"' + st + '/>';
    /* hair top */
    var H = {
      short: '<path d="M30 32 Q30 12 50 12 Q70 12 70 32 Q64 22 50 22 Q38 22 30 32 Z" fill="' + hc + '"' + st + '/>',
      side: '<path d="M30 34 Q28 12 52 12 Q72 13 70 32 Q60 20 44 26 Q36 28 30 34 Z" fill="' + hc + '"' + st + '/>',
      spiky: '<path d="M30 32 L32 16 L38 22 L42 10 L48 20 L54 9 L58 20 L64 12 L66 22 L70 32 Q60 24 50 24 Q40 24 30 32 Z" fill="' + hc + '"' + st + '/>',
      curly: '<path d="M29 34 Q24 26 30 20 Q30 10 40 12 Q46 6 54 10 Q64 6 68 16 Q76 22 71 34 Q66 26 58 26 Q50 22 42 26 Q34 26 29 34 Z" fill="' + hc + '"' + st + '/>',
      long: '<path d="M30 36 Q28 12 50 12 Q72 12 70 36 Q66 22 50 20 Q36 20 30 36 Z" fill="' + hc + '"' + st + '/>',
      ponytail: '<path d="M30 34 Q28 12 50 12 Q72 12 70 34 Q64 22 50 21 Q36 22 30 34 Z" fill="' + hc + '"' + st + '/>',
      bun: '<circle cx="50" cy="10" r="8" fill="' + hc + '"' + st + '/><path d="M30 34 Q28 14 50 14 Q72 14 70 34 Q64 23 50 22 Q36 23 30 34 Z" fill="' + hc + '"' + st + '/>',
      bald: '<path d="M30 34 Q30 30 33 28 M70 34 Q70 30 67 28" stroke="' + hc + '" stroke-width="4" fill="none"/>'
    };
    s += H[hair] || H.short;
    if (o.cap) s += '<path d="M29 26 Q30 10 50 10 Q70 10 71 26 Z" fill="' + o.cap + '"' + st + '/><path d="M60 24 h22 q2 4 -4 5 h-18 z" fill="' + o.cap + '"' + st + '/>';
    /* face */
    var eyes;
    if (mood === 'sleepy') eyes = '<path d="M39 38 q4 3 8 0 M53 38 q4 3 8 0" stroke="' + INK + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    else if (mood === 'shocked') eyes = '<circle cx="43" cy="37" r="4.2" fill="#fff" stroke="' + INK + '" stroke-width="2"/><circle cx="57" cy="37" r="4.2" fill="#fff" stroke="' + INK + '" stroke-width="2"/><circle cx="43" cy="37" r="1.8" fill="' + INK + '"/><circle cx="57" cy="37" r="1.8" fill="' + INK + '"/>';
    else if (mood === 'happy') eyes = '<path d="M39 39 q4 -5 8 0 M53 39 q4 -5 8 0" stroke="' + INK + '" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
    else eyes = '<ellipse cx="43" cy="37" rx="2.4" ry="3" fill="' + INK + '"/><ellipse cx="57" cy="37" rx="2.4" ry="3" fill="' + INK + '"/>';
    s += eyes;
    var brows = { angry: '<path d="M38 30 L47 33 M62 30 L53 33" stroke="' + INK + '" stroke-width="2.8" stroke-linecap="round"/>', sad: '<path d="M38 32 L46 30 M62 32 L54 30" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>', smug: '<path d="M39 31 q4 -2 8 0 M53 29 q4 -2 8 1" stroke="' + INK + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>', shocked: '<path d="M38 28 q5 -3 9 0 M53 28 q5 -3 9 0" stroke="' + INK + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>' };
    s += brows[mood] || '<path d="M39 31 q4 -2 8 0 M53 31 q4 -2 8 0" stroke="' + INK + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    if (o.glasses) s += '<circle cx="43" cy="37" r="6" fill="none" stroke="' + INK + '" stroke-width="2"/><circle cx="57" cy="37" r="6" fill="none" stroke="' + INK + '" stroke-width="2"/><path d="M49 37 h2" stroke="' + INK + '" stroke-width="2"/>';
    if (o.bindi) s += '<circle cx="50" cy="29" r="1.8" fill="#dc2626"/>';
    s += '<path d="M50 40 q-2 5 1 6" stroke="' + INK + '" stroke-width="1.6" fill="none" opacity=".55"/>';
    var mouth = { happy: '<path d="M43 48 q7 7 14 0" fill="#7f1d1d" stroke="' + INK + '" stroke-width="2"/>', angry: '<path d="M44 51 q6 -4 12 0" fill="none" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>', shocked: '<ellipse cx="50" cy="50" rx="4" ry="5" fill="#7f1d1d" stroke="' + INK + '" stroke-width="2"/>', sleepy: '<path d="M46 50 h8" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round"/>', smug: '<path d="M44 49 q8 3 12 -2" fill="none" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>', sad: '<path d="M44 51 q6 -5 12 0" fill="none" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>' };
    s += mouth[mood] || '<path d="M45 49 q5 3 10 0" fill="none" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>';
    if (o.beard) s += '<path d="M33 42 Q36 60 50 60 Q64 60 67 42 Q62 52 50 53 Q38 52 33 42 Z" fill="' + hc + '" opacity=".9"/>' + (mood === 'happy' ? '' : '');
    if (o.mustache) s += '<path d="M43 45 q7 -4 14 0 q-7 2 -14 0 z" fill="' + hc + '"/>';
    if (mood === 'angry') s += '<path d="M66 18 l4 -6 M72 22 l6 -3 M70 14 l2 -7" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round"/>';
    if (mood === 'sleepy') s += '<text x="68" y="16" font-family="Baloo 2,system-ui,sans-serif" font-weight="800" font-size="13" fill="#93c5fd">z</text><text x="76" y="8" font-family="Baloo 2,system-ui,sans-serif" font-weight="800" font-size="9" fill="#93c5fd">z</text>';
    if (mood === 'happy' || mood === 'smug') s += '<circle cx="37" cy="45" r="3" fill="#f87171" opacity=".35"/><circle cx="63" cy="45" r="3" fill="#f87171" opacity=".35"/>';
    s += '</svg>';
    return s;
  }
  /* ready-made cast for consistency across games */
  var CAST = {
    boss: { skin: 1, hair: 'bald', hairColor: '#3a2a20', shirt: '#f8fafc', tie: '#b91c1c', mustache: true, pants: '#1f2937' },
    hr: { skin: 0, hair: 'bun', hairColor: '#2b1b12', shirt: '#db2777', bindi: true, lanyard: '#be185d', pants: '#334155' },
    dev: { skin: 2, hair: 'curly', hairColor: '#1a120d', shirt: '#334155', glasses: true, lanyard: true, pants: '#1e293b' },
    intern: { skin: 1, hair: 'spiky', hairColor: '#21160f', shirt: '#22c55e', lanyard: '#16a34a', pants: '#1e3a8a' },
    manager: { skin: 3, hair: 'side', hairColor: '#120c08', shirt: '#60a5fa', tie: '#1e3a8a', beard: true, pants: '#1f2937' },
    analyst: { skin: 2, hair: 'ponytail', hairColor: '#24170f', shirt: '#a78bfa', glasses: true, lanyard: true, pants: '#312e81' },
    sales: { skin: 4, hair: 'short', hairColor: '#0f0a07', shirt: '#f59e0b', tie: '#7c2d12', pants: '#292524' },
    aunty: { skin: 1, hair: 'bun', hairColor: '#4b3b33', saree: true, shirt: '#16a34a', border: '#fbbf24', bindi: true },
    peon: { skin: 3, hair: 'short', hairColor: '#2a1d15', shirt: '#94a3b8', mustache: true, pants: '#475569' },
    ceo: { skin: 0, hair: 'side', hairColor: '#cbd5e1', shirt: '#111827', tie: '#fbbf24', glasses: true, pants: '#111827' },
    you: { skin: 2, hair: 'side', hairColor: '#1a120d', shirt: '#0ea5e9', lanyard: '#fbbf24', pants: '#1e3a8a' }
  };
  var imgCache = {};
  OA.art = {
    person: function (o) { return person(o); },
    cast: CAST,
    /* OA.art.who('boss', {mood:'angry'}) — a cast member with overrides */
    who: function (role, extra) { return person(Object.assign({}, CAST[role] || CAST.you, extra || {})); },
    skins: SKIN,
    ink: INK,
    /* svg string -> HTMLImageElement (cached) for canvas drawImage */
    img: function (svg) { if (imgCache[svg]) return imgCache[svg]; var i = new Image(); i.decoding = 'async'; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); imgCache[svg] = i; return i; },
    /* hi-dpi canvas helper: sizes canvas to its CSS box, returns ctx with scale applied */
    fit: function (cv) { var r = cv.getBoundingClientRect(); var d = Math.min(2.5, devicePixelRatio || 1); cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); var c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); return { ctx: c, w: r.width, h: r.height, dpr: d }; }
  };

  /* ---------- init ---------- */
  OA.init = function (o) { G.slug = o.slug || G.slug; G.name = o.name || G.name; OA.game = G; return OA; };
  OA.SITE = SITE;
  window.OA = OA;
})();
