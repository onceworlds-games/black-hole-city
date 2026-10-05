// Sound, all made with Web Audio: effects (a plop pitched by size, a low whoomp for big things, a chomp when a hole
// swallows a hole) and a small music sequencer (124 BPM, A minor): bass, kick, hats and an arpeggio that fill in as the
// round starts. The platform sets the volume and mute on everything connected to the output.
// Nothing here may throw into the game: every call is guarded, and it stays silent until start() runs from a tap.

const BPM = 124;
const STEP = 60 / BPM / 4; // a sixteenth, in seconds
const ROOTS = [57, 53, 48, 55]; // A, F, C, G (midi, an octave and a bit below the arpeggio)
const MINOR_ARP = [0, 7, 12, 15, 19, 15, 12, 7];
const MAJOR_ARP = [0, 7, 12, 16, 19, 16, 12, 7];
const BASS = [0, 0, 12, 0, 0, 7, 0, 10, 0, 0, 12, 0, 7, 0, 10, 12];

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.musicGain = null;
    this.noiseBuf = null;
    this.level = 'off'; // 'off' | 'menu' | 'play'
    this.timer = null;
    this.nextTime = 0;
    this.step = 0;
    this.failed = false;
    this.lastPlop = 0;
  }

  get ready() {
    return !!this.ctx && !this.failed;
  }

  /** From a tap or key: creates the context (once) and resumes it. */
  start() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return;
        }
        const ctx = new AC();
        this.ctx = ctx;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 18;
        comp.ratio.value = 5;
        comp.attack.value = 0.004;
        comp.release.value = 0.2;
        const master = ctx.createGain();
        master.gain.value = 0.9;
        comp.connect(master);
        master.connect(ctx.destination);
        this.master = comp;
        this.sfx = ctx.createGain();
        this.sfx.gain.value = 0.9;
        this.sfx.connect(comp);
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = 0;
        this.musicGain.connect(comp);
        const len = ctx.sampleRate;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        this.nextTime = ctx.currentTime + 0.1;
        this.timer = setInterval(() => this.schedule(), 25);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      this.failed = true;
    }
  }

  // ---------------------------------------------------------------------------------------------------- building blocks

  tone(freq0, freq1, dur, type = 'sine', gain = 0.2, when = 0, dest = this.sfx) {
    if (!this.ready) return;
    try {
      const ctx = this.ctx;
      const t = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq0), t);
      if (freq1 !== freq0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch {}
  }

  noise(dur, freq, q = 1, gain = 0.2, when = 0, kind = 'lowpass', dest = this.sfx) {
    if (!this.ready) return;
    try {
      const ctx = this.ctx;
      const t = ctx.currentTime + when;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = kind;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.0002, gain), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(dest);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.05);
    } catch {}
  }

  // ---------------------------------------------------------------------------------------------------- effects

  /** Something small drops in: higher for small things, lower and rounder for big ones. r is the object's footprint radius. */
  plop(r, volume = 1) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPlop < 0.028) return; // a swarm of cones is a patter, not a wall
    this.lastPlop = now;
    const f = 760 / (1 + r * 0.8);
    this.tone(f * 1.7, f * 0.62, 0.11 + r * 0.012, 'sine', 0.2 * volume);
    this.noise(0.03, 2400, 1, 0.05 * volume, 0, 'highpass');
    if (r >= 1.6) this.whoomp(r, volume * 0.9);
  }

  /** A low thump for big things. */
  whoomp(r, volume = 1) {
    const dur = 0.28 + Math.min(0.6, r * 0.06);
    this.tone(110 - Math.min(40, r * 4), 38, dur, 'sine', 0.42 * volume);
    this.noise(dur * 0.8, 380, 0.8, 0.26 * volume, 0, 'lowpass');
    if (r >= 4) this.noise(dur * 1.4, 160, 0.7, 0.3 * volume, 0.04, 'lowpass');
  }

  /** The hole got bigger. */
  grow() {
    [0, 4, 7, 12].forEach((s, i) => this.tone(hz(64 + s), hz(64 + s) * 1.01, 0.16, 'triangle', 0.15, i * 0.05));
    this.tone(220, 660, 0.3, 'sine', 0.08);
  }

  /** A hole swallowed a hole. */
  gulp(mine = true) {
    this.tone(260, 55, 0.4, 'sawtooth', mine ? 0.26 : 0.16);
    this.noise(0.4, 600, 0.9, mine ? 0.3 : 0.18, 0, 'lowpass');
    this.tone(90, 35, 0.6, 'sine', mine ? 0.4 : 0.22, 0.05);
  }

  /** I was swallowed. */
  died() {
    this.tone(420, 70, 0.7, 'sawtooth', 0.2);
    this.noise(0.5, 300, 1, 0.25, 0, 'lowpass');
  }

  back() {
    this.tone(220, 660, 0.25, 'triangle', 0.16);
    this.tone(330, 990, 0.25, 'sine', 0.1, 0.08);
  }

  tick() {
    this.tone(1200, 900, 0.04, 'square', 0.05);
  }

  select() {
    this.tone(520, 780, 0.07, 'triangle', 0.14);
  }

  hint() {
    this.tone(180, 120, 0.12, 'square', 0.08);
  }

  count(n) {
    if (n > 0) {
      this.tone(520, 520, 0.14, 'square', 0.13);
      this.tone(260, 260, 0.14, 'sine', 0.2);
    } else {
      this.tone(784, 784, 0.4, 'square', 0.14);
      this.tone(1175, 1175, 0.4, 'triangle', 0.14);
      this.tone(392, 392, 0.4, 'sine', 0.22);
      this.noise(0.5, 3000, 1, 0.06, 0, 'highpass');
    }
  }

  roundStart() {
    this.tone(330, 660, 0.3, 'sawtooth', 0.1);
    this.noise(0.4, 1800, 1, 0.06, 0, 'highpass');
  }

  lowTime() {
    this.tone(880, 880, 0.08, 'square', 0.08);
  }

  /** Fanfare for a win. */
  win() {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => {
      this.tone(hz(60 + s), hz(60 + s), 0.5, 'triangle', 0.17, i * 0.09);
      this.tone(hz(72 + s), hz(72 + s), 0.3, 'sine', 0.06, i * 0.09 + 0.02);
    });
    this.noise(0.9, 5000, 1, 0.05, 0.5, 'highpass');
  }

  /** Not a win. */
  lose() {
    [0, -3, -5, -8].forEach((s, i) => this.tone(hz(64 + s), hz(64 + s) * 0.98, 0.4, 'triangle', 0.14, i * 0.14));
  }

  // ---------------------------------------------------------------------------------------------------- music

  /** 'off', 'menu' (soft) or 'play' (everything). */
  setLevel(level) {
    if (level === this.level) return;
    this.level = level;
    if (!this.ready) return;
    const target = level === 'play' ? 0.5 : level === 'menu' ? 0.2 : 0;
    this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
  }

  schedule() {
    if (!this.ready || this.level === 'off') {
      if (this.ready) this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.05);
      return;
    }
    const ctx = this.ctx;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05; // the tab slept: don't replay a backlog
    while (this.nextTime < ctx.currentTime + 0.14) {
      this.playStep(this.step, this.nextTime - ctx.currentTime);
      this.step = (this.step + 1) % 64;
      this.nextTime += STEP;
    }
  }

  playStep(step, when) {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const root = ROOTS[bar];
    const play = this.level === 'play';
    const dest = this.musicGain;
    // kick: four on the floor in play, just a soft pulse on the bar in the menu
    if (s % 4 === 0 && (play || s === 0)) {
      this.tone(play ? 140 : 100, 42, 0.18, 'sine', play ? 0.5 : 0.2, when, dest);
      if (play) this.noise(0.02, 3000, 1, 0.05, when, 'highpass', dest);
    }
    if (play && s % 4 === 2) this.noise(0.05, 7500, 1, 0.07, when, 'highpass', dest);
    if (play && (s === 4 || s === 12)) this.noise(0.12, 2200, 1.2, 0.07, when, 'bandpass', dest);
    // bass: off the beat in play, held notes in the menu
    if (play) {
      const n = BASS[s];
      if (s % 2 === 0 || s === 15) this.tone(hz(root - 12 + (n % 12)), hz(root - 12 + (n % 12)) * 0.98, STEP * 1.6, 'sawtooth', 0.12, when, dest);
    } else if (s === 0) {
      this.tone(hz(root - 12), hz(root - 12), STEP * 14, 'sine', 0.2, when, dest);
      this.tone(hz(root), hz(root), STEP * 14, 'triangle', 0.06, when, dest);
    }
    // arpeggio on the eighths
    if (s % 2 === 0) {
      const notes = bar === 0 || bar === 3 ? MINOR_ARP : MAJOR_ARP;
      const n = notes[(s / 2) % notes.length];
      const gain = play ? 0.07 : 0.035;
      this.tone(hz(root + 12 + n), hz(root + 12 + n), STEP * 1.8, play ? 'square' : 'triangle', gain, when, dest);
    }
  }
}
