// Bot players. A bot looks for the richest bunch of things it can swallow nearby, runs from bigger holes and hunts smaller ones.
// Pure: it reads the sim and writes the hole's velocity, so the host, the title screen and the tests all play bots the same way.

import { radiusFor, speedFor, clampToWorld, limit } from './rules.js';
import { EAT_RATIO } from './config.js';

const TAU = Math.PI * 2;

export class BotBrain {
  constructor(rng) {
    this.rng = rng;
    this.skill = 0.76 + rng() * 0.15; // top speed share
    this.aggr = 0.15 + rng() * 0.75; // how readily it hunts smaller holes
    this.nerve = 0.8 + rng() * 0.5; // how early it runs from bigger ones
    this.think = 0.45 + rng() * 0.3; // seconds between decisions
    this.timer = rng() * this.think;
    this.tx = 0;
    this.tz = 0;
    this.has = false;
    this.mode = 'eat';
    this.dx = 0;
    this.dz = 0;
  }

  reset() {
    this.has = false;
    this.timer = 0.2 + this.rng() * 0.3;
  }

  /** Moves the hole for one step: decides now and then, steers every step. */
  update(sim, h, dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.decide(sim, h);
      this.timer = this.think * (0.8 + this.rng() * 0.4);
    }
    const R = radiusFor(h.mass);
    const sp = speedFor(R) * this.skill;
    let wx = 0;
    let wz = 0;
    if (this.mode === 'flee') {
      wx = this.dx;
      wz = this.dz;
    } else if (this.has) {
      const dx = this.tx - h.x;
      const dz = this.tz - h.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.35) {
        wx = dx / d;
        wz = dz / d;
        if (d < 1.2) {
          // arrived: ease off, and pick the next place sooner
          wx *= d / 1.2;
          wz *= d / 1.2;
          if (this.timer > 0.12) this.timer = 0.12;
        }
      } else if (this.timer > 0.1) this.timer = 0.1;
    }
    const k = 1 - Math.exp(-6.5 * dt);
    h.vx += (wx * sp - h.vx) * k;
    h.vz += (wz * sp - h.vz) * k;
    h.x += h.vx * dt;
    h.z += h.vz * dt;
    clampToWorld(h, R, sim.city.half);
  }

  decide(sim, h) {
    const { rng } = this;
    const R = radiusFor(h.mass);
    const t = sim.t;
    // 1. run from anything that can swallow me
    let danger = false;
    let nearest = Infinity;
    for (const o of sim.holes) {
      if (o === h || !sim.isAlive(o, t)) continue;
      const Ro = radiusFor(o.mass);
      if (Ro < R * 1.25) continue;
      const d = Math.hypot(o.x - h.x, o.z - h.z);
      const reach = Math.max(2.5 * R, Ro - R * 0.6 + 2.5) * this.nerve;
      if (d < reach && d < nearest) {
        nearest = d;
        danger = true;
      }
    }
    if (danger) {
      let best = null;
      let bestScore = -Infinity;
      const m = limit(R, sim.city.half);
      const steps = 16;
      const off = rng() * TAU;
      for (let i = 0; i < steps; i++) {
        const a = off + (i / steps) * TAU;
        const ux = Math.cos(a);
        const uz = Math.sin(a);
        const px = h.x + ux * 9;
        const pz = h.z + uz * 9;
        let score = 0;
        if (Math.abs(px) > m + 2 || Math.abs(pz) > m + 2) score -= 6;
        let closest = Infinity;
        for (const o of sim.holes) {
          if (o === h || !sim.isAlive(o, t)) continue;
          if (radiusFor(o.mass) < R * 1.25) continue;
          closest = Math.min(closest, Math.hypot(o.x - px, o.z - pz));
        }
        score += Math.min(closest, 40) + rng() * 2;
        if (score > bestScore) {
          bestScore = score;
          best = [ux, uz];
        }
      }
      this.mode = 'flee';
      this.dx = best[0];
      this.dz = best[1];
      this.has = false;
      return;
    }
    this.mode = 'eat';

    // 2. hunt a smaller hole that is close
    if (rng() < this.aggr * 0.6) {
      let prey = null;
      let preyD = 18 + this.aggr * 14;
      for (const o of sim.holes) {
        if (o === h || !sim.isAlive(o, t) || sim.isProtected(o, t)) continue;
        const Ro = radiusFor(o.mass);
        if (R < Ro * 1.4) continue;
        const d = Math.hypot(o.x - h.x, o.z - h.z);
        if (d < preyD) {
          preyD = d;
          prey = o;
        }
      }
      if (prey) {
        this.tx = prey.x + prey.vx * 0.35;
        this.tz = prey.z + prey.vz * 0.35;
        this.has = true;
        return;
      }
    }

    // 3. the richest bunch of things within reach, a little noisy
    const rho = Math.max(2.8, R * 1.15);
    let bestScore = 0;
    let bx = 0;
    let bz = 0;
    let found = false;
    const samples = 12;
    const reach = 14 + R * 3.5;
    for (let i = 0; i < samples; i++) {
      const a = rng() * TAU;
      const dist = 2 + rng() * reach;
      const px = clampAxis(h.x + Math.cos(a) * dist, sim.city.half);
      const pz = clampAxis(h.z + Math.sin(a) * dist, sim.city.half);
      const value = bunch(sim, px, pz, rho, R, h.x, h.z, NEAR);
      if (value <= 0) continue;
      const gx = NEAR.x;
      const gz = NEAR.z;
      let score = value / (Math.hypot(gx - h.x, gz - h.z) + 5);
      score *= 0.6 + rng() * 0.8;
      for (const o of sim.holes) {
        if (o === h || !o.bot || o.brain === null || !o.brain.has) continue;
        if (Math.hypot(o.brain.tx - gx, o.brain.tz - gz) < 7) score *= 0.65;
      }
      if (score > bestScore) {
        bestScore = score;
        bx = gx;
        bz = gz;
        found = true;
      }
    }
    // keep the old target if it is still about as good
    if (this.has && found) {
      const old = bunch(sim, this.tx, this.tz, 0.9, R, h.x, h.z, null);
      if (old > 0) {
        const oldScore = (old / (Math.hypot(this.tx - h.x, this.tz - h.z) + 5)) * 1.2;
        if (oldScore > bestScore) found = false;
      }
    }
    if (found) {
      this.tx = bx;
      this.tz = bz;
      this.has = true;
      return;
    }
    if (this.has && bunch(sim, this.tx, this.tz, 0.9, R, h.x, h.z, null) > 0) return;
    // nothing near: look across the whole city
    let farScore = 0;
    for (let i = 0; i < samples; i++) {
      const px = (rng() * 2 - 1) * (sim.city.half - 3);
      const pz = (rng() * 2 - 1) * (sim.city.half - 3);
      const value = bunch(sim, px, pz, rho + 1, R, h.x, h.z, NEAR);
      if (value <= 0) continue;
      const score = value / (Math.hypot(NEAR.x - h.x, NEAR.z - h.z) * 0.25 + 10);
      if (score > farScore) {
        farScore = score;
        bx = NEAR.x;
        bz = NEAR.z;
        found = true;
      }
    }
    if (farScore > 0) {
      this.tx = bx;
      this.tz = bz;
      this.has = true;
      return;
    }
    // everything left is too big: wander toward the middle
    this.tx = (rng() - 0.5) * 30;
    this.tz = (rng() - 0.5) * 30;
    this.has = true;
  }
}

function clampAxis(v, half) {
  const m = half - 2;
  return v < -m ? -m : v > m ? m : v;
}

/**
 * The value of what a hole of radius R could swallow around a point, and (in `near`) the eatable object in that bunch closest
 * to where the hole is now: the place to steer for, since the sample point itself may have nothing on it.
 */
function bunch(sim, x, z, rho, R, fromX, fromZ, near) {
  const { city, eaten } = sim;
  let total = 0;
  let best = Infinity;
  const take = (id) => {
    total += city.value[id];
    if (near) {
      const fx = city.x[id] - fromX;
      const fz = city.z[id] - fromZ;
      const d = fx * fx + fz * fz;
      if (d < best) {
        best = d;
        near.x = city.x[id];
        near.z = city.z[id];
      }
    }
  };
  sim.grid.query(x, z, rho, (id) => {
    if (eaten[id]) return;
    if (R < city.r[id] * EAT_RATIO) return;
    const dx = city.x[id] - x;
    const dz = city.z[id] - z;
    if (dx * dx + dz * dz <= rho * rho) take(id);
  });
  const movers = city.moverIds;
  for (let k = 0; k < movers.length; k++) {
    const id = movers[k];
    if (eaten[id] || R < city.r[id] * EAT_RATIO) continue;
    const dx = city.x[id] - x;
    const dz = city.z[id] - z;
    if (dx * dx + dz * dz <= rho * rho) take(id);
  }
  return total;
}

const NEAR = { x: 0, z: 0 };
