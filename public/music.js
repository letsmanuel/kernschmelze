/* Eigene Instrumental-Musik, live per Web Audio erzeugt.
   "Nachglühen" (Menü) und "Kritische Masse" (Spiel, mit Ruhe- und Boss-Phase). */
window.KSMusic = function (ctx, out, noise) {
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  const vol = ctx.createGain();
  const master = ctx.createBiquadFilter();
  master.type = 'lowpass';
  master.frequency.value = 20000;
  master.connect(vol);
  vol.connect(out);

  // Hall aus abklingendem Rauschen
  const hall = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.8);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
  }
  hall.buffer = ir;
  const hallOut = ctx.createGain();
  hallOut.gain.value = .55;
  hall.connect(hallOut);
  hallOut.connect(master);

  const echo = ctx.createDelay(1.5);
  const echoFb = ctx.createGain();
  echoFb.gain.value = .36;
  echo.connect(echoFb);
  echoFb.connect(echo);
  echo.connect(master);

  function makeBus() {
    const input = ctx.createBiquadFilter();
    input.type = 'lowpass';
    input.frequency.value = 18000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    input.connect(gain);
    gain.connect(master);
    return { input, gain };
  }
  const buses = { menu: makeBus(), game: makeBus() };
  let dest = buses.menu.input;

  function note(o) {
    const { f, t, dur, type = 'triangle', g = .1, attack = .01, release = .1, detune = 0, cut = 0, send = 0, delay = 0, glide = 0 } = o;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
    let head = osc;
    if (cut) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cut;
      osc.connect(lp);
      head = lp;
    }
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(g, t + attack);
    amp.gain.setValueAtTime(g, t + Math.max(attack, dur));
    amp.gain.linearRampToValueAtTime(0, t + Math.max(attack, dur) + release);
    head.connect(amp);
    amp.connect(dest);
    if (send) { const s = ctx.createGain(); s.gain.value = send; amp.connect(s); s.connect(hall); }
    if (delay) { const s = ctx.createGain(); s.gain.value = delay; amp.connect(s); s.connect(echo); }
    osc.start(t);
    osc.stop(t + Math.max(attack, dur) + release + .03);
  }
  function hit(t, dur, g, type, fc) {
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const a = ctx.createGain();
    s.buffer = noise;
    s.loop = true;
    f.type = type;
    f.frequency.value = fc;
    a.gain.setValueAtTime(g, t);
    a.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(f); f.connect(a); a.connect(dest);
    s.start(t, Math.random() * .8);
    s.stop(t + dur + .02);
  }
  const pad = (ns, t, dur, g = .03, cut = 1000) => ns.forEach(n => {
    note({ f: midi(n), t, dur, type: 'sawtooth', g, attack: .7, release: 1.2, detune: -7, cut, send: .5 });
    note({ f: midi(n), t, dur, type: 'sawtooth', g, attack: .7, release: 1.2, detune: 7, cut, send: .5 });
  });
  const kick = (t, g = .75) => note({ f: 155, glide: 42, t, dur: .17, type: 'sine', g, attack: .002, release: .05 });
  const snare = (t, g = .3) => { hit(t, .16, g, 'bandpass', 1900); note({ f: 195, glide: 130, t, dur: .08, type: 'triangle', g: g * .7, attack: .002, release: .04 }); };
  const hat = (t, g = .06, dur = .04) => hit(t, dur, g, 'highpass', 7800);

  /* ---------- Menü: Nachglühen ---------- */
  const MENU = [
    { r: 45, n: [57, 60, 64, 71] }, { r: 41, n: [53, 57, 60, 64] },
    { r: 48, n: [55, 60, 62, 64] }, { r: 40, n: [55, 59, 62, 64] },
    { r: 38, n: [53, 57, 60, 64] }, { r: 43, n: [55, 60, 64, 69] },
    { r: 41, n: [57, 60, 64, 71] }, { r: 40, n: [57, 59, 62, 64] },
  ];
  const MENU_MEL = [
    [[0, 76, 8], [8, 72, 4], [12, 71, 4]], [[0, 69, 12]],
    [[0, 72, 6], [6, 74, 2], [8, 76, 8]], [[0, 71, 16]],
    [[0, 69, 6], [6, 72, 2], [8, 77, 8]], [[0, 76, 8], [8, 72, 8]],
    [[0, 71, 6], [6, 72, 2], [8, 74, 8]], [[0, 71, 16]],
  ];
  const ARP = [0, 2, 1, 3, 2, 1, 3, 2];
  function menuStep(s, b, t, sd) {
    const c = MENU[b % 8];
    if (s === 0) {
      note({ f: midi(c.r), t, dur: sd * 15, type: 'sine', g: .17, attack: .3, release: .9 });
      pad(c.n, t, sd * 15);
    }
    if (s % 2 === 0) {
      const n = c.n[ARP[s / 2]] + (b % 4 === 3 && s > 8 ? 24 : 12);
      note({ f: midi(n), t, dur: sd, type: 'triangle', g: .05, attack: .004, release: .5, send: .4, delay: .3 });
    }
    if (b % 16 >= 8) {
      for (const [st, n, l] of MENU_MEL[b % 8]) {
        if (st === s) note({ f: midi(n), t, dur: sd * l * .9, type: 'sine', g: .1, attack: .06, release: .6, send: .7, delay: .25 });
      }
    }
    if (b >= 16 && (s === 0 || s === 10)) kick(t, .22);
    if (b >= 16 && s % 4 === 2) hat(t, .018, .06);
  }

  /* ---------- Spiel: Kritische Masse ---------- */
  const Dm = { r: 38, n: [62, 65, 69] };
  const GAME = [Dm, Dm, { r: 34, n: [58, 62, 65] }, { r: 36, n: [60, 64, 67] }, Dm, Dm, { r: 31, n: [55, 58, 62] }, { r: 33, n: [57, 61, 64] }];
  const BOSS = [Dm, { r: 39, n: [63, 67, 70] }, Dm, { r: 36, n: [60, 63, 67] }];
  const LEAD = [
    [[0, 74, 3], [3, 77, 3], [6, 81, 2], [8, 79, 4], [12, 77, 4]],
    [[0, 74, 6], [6, 72, 2], [8, 74, 8]],
    [[0, 70, 3], [3, 74, 3], [6, 77, 2], [8, 77, 4], [12, 74, 4]],
    [[0, 72, 3], [3, 76, 3], [6, 79, 2], [8, 76, 8]],
    [[0, 74, 3], [3, 77, 3], [6, 81, 2], [8, 79, 4], [12, 77, 4]],
    [[0, 81, 6], [6, 79, 2], [8, 77, 4], [12, 79, 4]],
    [[0, 79, 3], [3, 82, 3], [6, 86, 2], [8, 82, 4], [12, 79, 4]],
    [[0, 81, 4], [4, 76, 4], [8, 73, 4], [12, 76, 4]],
  ];
  const BOSS_LEAD = [[0, 74, 2], [2, 75, 2], [4, 74, 2], [6, 77, 2], [8, 75, 4], [12, 74, 4]];
  const BASS_STEPS = [0, 3, 6, 8, 10, 11, 14];

  let intensity = 0;
  function bass(n, t, dur, g, cut) {
    note({ f: midi(n), t, dur, type: 'sawtooth', g, attack: .004, release: .05, cut });
    note({ f: midi(n - 12), t, dur, type: 'sine', g: g * 1.2, attack: .004, release: .05 });
  }
  function lead(n, t, dur, g) {
    note({ f: midi(n), t, dur, type: 'square', g, attack: .01, release: .12, cut: 2800, detune: -5, send: .25, delay: .28 });
    note({ f: midi(n), t, dur, type: 'sawtooth', g, attack: .01, release: .12, cut: 3400, detune: 6, send: .25 });
  }
  function gameStep(s, b, t, sd) {
    const boss = intensity === 2, calm = intensity === 0;
    const prog = boss ? BOSS : GAME;
    const c = prog[b % prog.length];
    const sec = b % 32;
    const breakdown = !boss && sec >= 16 && sec < 24;
    if (s === 0 && (calm || breakdown)) pad(c.n, t, sd * 15, .026, calm ? 800 : 1500);
    if (s % 2 === 0 && (calm || breakdown)) {
      note({ f: midi(c.n[ARP[s / 2] % 3] + 12), t, dur: sd, type: 'triangle', g: .05, attack: .004, release: .3, send: .3, delay: .3 });
    }
    if (calm) {
      if (s === 0) note({ f: midi(c.r), t, dur: sd * 14, type: 'sine', g: .16, attack: .1, release: .4 });
      if (s % 4 === 2) hat(t, .03);
      return;
    }
    if (breakdown) {
      if (s === 0 || s === 8) bass(c.r, t, sd * 6, .08, 500);
      if (s % 2 === 1 && sec >= 20) hat(t, .04);
      if (sec === 23 && s >= 8) snare(t, .08 + (s - 8) * .03);
      return;
    }
    if (s % 4 === 0) kick(t);
    if (boss && (s === 14 || s === 7)) kick(t, .55);
    if (s === 4 || s === 12) snare(t);
    hat(t, s % 4 === 2 ? .085 : .03, s % 4 === 2 ? .1 : .035);
    if (BASS_STEPS.includes(s) || (boss && s % 2 === 0)) {
      const up = s === 6 || s === 14;
      bass(c.r + (up ? 12 : 0), t, sd * .85, boss ? .12 : .1, boss ? 1500 : 850);
    }
    if (s === 3 || s === 6 || s === 11) {
      c.n.forEach(n => note({ f: midi(n), t, dur: sd * 1.2, type: 'sawtooth', g: .026, attack: .004, release: .14, cut: 2400, send: .3, delay: .2 }));
    }
    if (boss) {
      if (s % 2 === 0) note({ f: midi(c.n[(s / 2) % 3] + 12), t, dur: sd, type: 'square', g: .024, attack: .002, release: .05, cut: 3000 });
      const tr = c.r - 38;
      for (const [st, n, l] of BOSS_LEAD) if (st === s) lead(n + tr, t, sd * l * .9, .036);
    } else if ((sec >= 8 && sec < 16) || sec >= 24) {
      for (const [st, n, l] of LEAD[b % 8]) if (st === s) lead(n, t, sd * l * .9, sec >= 24 ? .04 : .032);
    }
  }

  const SONGS = {
    menu: { bpm: () => 72, step: menuStep },
    game: { bpm: () => (intensity === 2 ? 150 : 138), step: gameStep },
  };

  let song = null, step = 0, bar = 0, next = 0;
  setInterval(() => {
    if (!song || ctx.state !== 'running') return;
    const s = SONGS[song];
    const ahead = document.hidden ? 1.4 : .2;
    if (next < ctx.currentTime) next = ctx.currentTime + .05;
    while (next < ctx.currentTime + ahead) {
      const sd = 60 / s.bpm() / 4;
      echo.delayTime.value = sd * 3;
      s.step(step, bar, next, sd);
      next += sd;
      if (++step === 16) { step = 0; bar++; }
    }
  }, 30);

  function setIntensity(v) {
    intensity = v;
    buses.game.input.frequency.setTargetAtTime(v === 0 ? 2200 : 18000, ctx.currentTime, .4);
  }
  return {
    setSong(name) {
      if (name === song) return;
      const now = ctx.currentTime;
      if (song) {
        const g = buses[song].gain.gain;
        g.cancelScheduledValues(now);
        g.setTargetAtTime(0, now, .35);
      }
      song = name;
      dest = buses[name].input;
      const g = buses[name].gain.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(1, now, .3);
      step = 0; bar = 0; next = now + .08;
    },
    setIntensity,
    setPaused(p) { master.frequency.setTargetAtTime(p ? 420 : 20000, ctx.currentTime, .12); },
    setVolume(v) { vol.gain.setTargetAtTime(v, ctx.currentTime, .05); },
  };
};
