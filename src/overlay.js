// The 2D layer over the 3D scene: name tags (with a face and the current size), the crown on the leader, "+N" pop-ups,
// the arrow that says "this is you", hints, and confetti. Everything is drawn with fillText and arcs: names come from
// other people and never touch the DOM.

import { SEAT_COLORS } from './logic/config.js';
import { hexCss, initial } from './avatars.js';

const FONT = '"Archivo Black", "Arial Black", system-ui, sans-serif';

const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`.replace('.0K', 'K') : String(Math.round(n)));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => 1 - (1 - t) * (1 - t);

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

export class Overlay {
  constructor(canvas, avatars) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.avatars = avatars;
    this.w = 1;
    this.h = 1;
    this.pr = 1;
    this.pops = [];
    this.combo = null;
    this.confetti = [];
    this.confettiUntil = 0;
    this.youUntil = 0;
    this.time = 0;
    this.reduced = false;
    this.pt = { x: 0, y: 0 };
    this.tmp = { x: 0, y: 0 };
  }

  resize(w, h, pr) {
    this.w = w;
    this.h = h;
    this.pr = pr;
    this.canvas.width = Math.max(1, Math.floor(w * pr));
    this.canvas.height = Math.max(1, Math.floor(h * pr));
  }

  clearAll() {
    this.pops.length = 0;
    this.combo = null;
    this.confetti.length = 0;
    this.youUntil = 0;
  }

  // ---------------------------------------------------------------------------------------------------- things that happen

  /** "+N" over my hole. Quick pickups add up into one number instead of a pile of them. */
  gain(value, x, z, big = false) {
    const c = this.combo;
    if (c && this.time - c.at < 0.4 && !big && !c.big) {
      c.value += value;
      c.at = this.time;
      c.t = Math.min(c.t, 0.12);
      c.x = x;
      c.z = z;
      c.text = `+${c.value}`;
      c.scale = Math.min(1.9, 1 + Math.log10(1 + c.value) * 0.45);
      return;
    }
    const pop = { x, z, text: `+${value}`, value, t: 0, life: big ? 1.2 : 0.9, color: big ? '#ffd23f' : '#ffffff', scale: big ? 1.7 : 1, at: this.time, big, rise: big ? 3.4 : 2.4 };
    this.pops.push(pop);
    if (!big) this.combo = pop;
    if (this.pops.length > 24) this.pops.shift();
  }

  /** A short word over a spot: "TOO BIG". */
  word(text, x, z, color = '#ff7a59') {
    this.pops.push({ x, z, text, value: 0, t: 0, life: 1.1, color, scale: 1.15, at: this.time, big: true, rise: 2.0 });
  }

  /** The arrow over my hole at the start of a round. */
  showYou(seconds) {
    this.youUntil = this.time + seconds;
  }

  burstConfetti(seconds = 4) {
    if (this.reduced) return;
    this.confettiUntil = this.time + seconds;
    const cols = ['#ffc400', '#19d3ff', '#ff3b7a', '#8cff2e', '#ffffff', '#a66bff'];
    for (let i = 0; i < 150; i++) {
      this.confetti.push({
        x: Math.random() * this.w,
        y: -20 - Math.random() * this.h * 0.5,
        vx: (Math.random() - 0.5) * 90,
        vy: 140 + Math.random() * 260,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 12,
        c: cols[i % cols.length],
        s: 5 + Math.random() * 6,
      });
    }
  }

  // ---------------------------------------------------------------------------------------------------- every frame

  /**
   * session: the game's view of itself; stage: for projecting world points; dt in seconds.
   * `tags` false hides name tags (the title).
   */
  draw(session, stage, dt, tags = true) {
    const g = this.g;
    this.time += dt;
    g.setTransform(this.pr, 0, 0, this.pr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineJoin = 'round';
    g.textBaseline = 'middle';
    const scale = clamp(Math.min(this.w, this.h * 1.6) / 900, 0.78, 1.25);
    if (tags) {
      // far holes first so the near ones sit on top
      const list = session.views.filter((v) => v.shown);
      list.sort((a, b) => a.z - b.z);
      for (const v of list) this.drawTag(session, stage, v, scale);
    }
    this.drawPops(stage, dt, scale, session);
    this.drawConfetti(dt);
  }

  drawTag(session, stage, v, scale) {
    const g = this.g;
    const pt = this.pt;
    const R = v.R * v.scale;
    if (!stage.project(v.x, 0.4, v.z - R * 0.98, pt)) return;
    const lobby = session.mode === 'lobby';
    const color = SEAT_COLORS[v.seat % SEAT_COLORS.length];
    const name = (v.name || '').length > 13 ? `${Array.from(v.name).slice(0, 12).join('')}…` : v.name || '…';
    const size = 14 * scale;
    const av = 22 * scale;
    g.font = `${size}px ${FONT}`;
    const nameW = g.measureText(name).width;
    const scoreText = lobby ? '' : fmt(v.score);
    g.font = `${size * 1.05}px ${FONT}`;
    const scoreW = scoreText ? g.measureText(scoreText).width : 0;
    let readyW = 0;
    if (lobby && v.ready) {
      g.font = `${size * 0.8}px ${FONT}`;
      readyW = g.measureText('READY').width + 22 * scale;
    }
    const pad = 8 * scale;
    const gap = 7 * scale;
    const w = pad + av + gap + nameW + (scoreW ? gap + scoreW : 0) + (readyW ? gap + readyW : 0) + pad;
    const h = av + 8 * scale;
    let x = pt.x - w / 2;
    let y = pt.y - h - 8 * scale;
    x = clamp(x, 6, this.w - w - 6);
    y = clamp(y, 70, this.h - h - 100);
    const away = v.away || v.gone;
    g.globalAlpha = away ? 0.5 : 1;
    // the panel: flat, dark, a bar of the hole's colour at the left
    g.fillStyle = 'rgba(8,12,22,0.8)';
    roundRect(g, x, y, w, h, 5 * scale);
    g.fill();
    g.fillStyle = hexCss(color);
    g.fillRect(x, y + 3, 3.5 * scale, h - 6);
    if (v.me) {
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 2;
      roundRect(g, x, y, w, h, 5 * scale);
      g.stroke();
    }
    // face
    const ax = x + pad + av / 2 + 2;
    const ay = y + h / 2;
    if (!this.avatars.draw(g, v.id, v.bot, ax, ay, av / 2)) {
      g.fillStyle = hexCss(color);
      g.beginPath();
      g.arc(ax, ay, av / 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0b1020';
      g.font = `${av * 0.62}px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(initial(v.name), ax, ay + 1);
    }
    g.textAlign = 'left';
    g.font = `${size}px ${FONT}`;
    let tx = x + pad + av + gap + 2;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.strokeText(name, tx, y + h / 2 + 1);
    g.fillStyle = '#fff';
    g.fillText(name, tx, y + h / 2 + 1);
    tx += nameW + gap;
    if (scoreText) {
      g.font = `${size * 1.05}px ${FONT}`;
      g.fillStyle = '#ffc400';
      g.fillText(scoreText, tx, y + h / 2 + 1);
      tx += scoreW + gap;
    }
    if (readyW) {
      // a green check and READY
      g.fillStyle = '#2ee66b';
      const cx = tx + 6 * scale;
      g.beginPath();
      g.moveTo(cx - 5 * scale, y + h / 2);
      g.lineTo(cx - 1.5 * scale, y + h / 2 + 4 * scale);
      g.lineTo(cx + 6 * scale, y + h / 2 - 5 * scale);
      g.lineTo(cx + 4.4 * scale, y + h / 2 - 6.6 * scale);
      g.lineTo(cx - 1.5 * scale, y + h / 2 + 1 * scale);
      g.lineTo(cx - 3.4 * scale, y + h / 2 - 1.6 * scale);
      g.closePath();
      g.fill();
      g.font = `${size * 0.8}px ${FONT}`;
      g.fillText('READY', tx + 16 * scale, y + h / 2 + 1);
    }
    if (v.away && !v.gone) {
      g.font = `${size * 0.7}px ${FONT}`;
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.fillText('AWAY', x + w / 2, y - 7 * scale);
      g.textAlign = 'left';
    }
    g.globalAlpha = 1;
    // the crown on whoever is biggest
    if (v.leader && session.sub === 'play') this.crown(x + w / 2, y - 13 * scale, 15 * scale);
    // "you" while the round is young
    if (v.me && this.time < this.youUntil && session.mode !== 'lobby') this.arrow(x + w / 2, y - 6 * scale, scale);
  }

  crown(cx, cy, s) {
    const g = this.g;
    g.fillStyle = '#ffc400';
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx - s, cy + s * 0.6);
    g.lineTo(cx - s, cy - s * 0.5);
    g.lineTo(cx - s * 0.5, cy + s * 0.05);
    g.lineTo(cx, cy - s * 0.8);
    g.lineTo(cx + s * 0.5, cy + s * 0.05);
    g.lineTo(cx + s, cy - s * 0.5);
    g.lineTo(cx + s, cy + s * 0.6);
    g.closePath();
    g.stroke();
    g.fill();
  }

  arrow(cx, cy, scale) {
    const g = this.g;
    const bob = Math.sin(this.time * 6) * 4 * scale;
    const y = cy - 26 * scale + bob;
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - 11 * scale, y - 12 * scale);
    g.lineTo(cx + 11 * scale, y - 12 * scale);
    g.lineTo(cx, y + 6 * scale);
    g.closePath();
    g.stroke();
    g.fill();
    g.font = `${13 * scale}px ${FONT}`;
    g.textAlign = 'center';
    g.lineWidth = 3.5;
    g.strokeText('YOU', cx, y - 24 * scale);
    g.fillText('YOU', cx, y - 24 * scale);
    g.textAlign = 'left';
  }

  drawPops(stage, dt, scale, session) {
    const g = this.g;
    const pt = this.pt;
    const reduced = this.reduced;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t >= p.life) {
        if (this.combo === p) this.combo = null;
        this.pops.splice(i, 1);
        continue;
      }
      const k = p.t / p.life;
      if (!stage.project(p.x, 1.2 + p.rise * ease(k) * (reduced ? 0.4 : 1), p.z, pt)) continue;
      const pop = reduced ? 1 : 1 + 0.35 * Math.max(0, 1 - p.t * 7);
      const size = 25 * scale * p.scale * pop;
      g.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      g.font = `${size}px ${FONT}`;
      g.textAlign = 'center';
      g.lineWidth = Math.max(4, size * 0.2);
      g.strokeStyle = 'rgba(8,12,22,0.9)';
      g.strokeText(p.text, pt.x, pt.y);
      g.fillStyle = p.color;
      g.fillText(p.text, pt.x, pt.y);
    }
    g.globalAlpha = 1;
    g.textAlign = 'left';
    void session;
  }

  drawConfetti(dt) {
    if (this.confetti.length === 0) return;
    const g = this.g;
    const live = this.time < this.confettiUntil;
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vx += Math.sin(this.time * 3 + i) * 30 * dt;
      c.rot += c.vr * dt;
      if (c.y > this.h + 30) {
        if (live) {
          c.y = -20;
          c.x = Math.random() * this.w;
        } else {
          this.confetti.splice(i, 1);
          continue;
        }
      }
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.rot);
      g.fillStyle = c.c;
      g.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2);
      g.restore();
    }
  }
}
