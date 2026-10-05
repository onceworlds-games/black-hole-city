// The host's side of a round: who has eaten what, every hole's mass and score, bots, holes eating holes.
// Pure: it never touches the room, so the host page, the title screen and the tests run the same rules.
//
// Human holes are moved by their own pages (their position comes in through setPos); bots are moved here.
// Times are match milliseconds. Dead holes come back at `deadUntil`.

import { BotBrain } from './bots.js';
import { mulberry32, hashSeed, shuffled } from './rng.js';
import { radiusFor, canGulp, collectSwallows, clampToWorld } from './rules.js';
import { encodeEaten, decodeEaten } from './bits.js';
import * as C from './config.js';

/** Where each seat begins a round: evenly spread round the edge, the same on every page from the same seed. */
export function spawnPlan(city, seed, count) {
  const slots = city.spawns;
  const n = slots.length;
  const rng = mulberry32(hashSeed(seed, 'spawn'));
  const c = Math.max(1, Math.min(count, n));
  const off = rng() * (n / c);
  const picks = [];
  for (let k = 0; k < c; k++) {
    let i = Math.floor((k * n) / c + off) % n;
    while (picks.includes(i)) i = (i + 1) % n;
    picks.push(i);
  }
  const order = shuffled(rng, picks);
  const out = [];
  for (let k = 0; k < Math.max(count, 1); k++) out.push(slots[order[k % order.length]]);
  return out;
}

export class Sim {
  /**
   * @param city      the round's city
   * @param roster    [{ id, bot, name }] in seat order (humans first, then bots)
   * @param options   seed: the round's seed; startMs: match time the round began
   */
  constructor(city, roster, { seed = 1, startMs = 0 } = {}) {
    this.city = city;
    this.grid = city.grid();
    this.seed = seed;
    this.eaten = new Uint8Array(city.n);
    this.eatenCount = 0;
    this.rng = mulberry32(hashSeed(seed, 'sim'));
    this.t = startMs;
    this.last = startMs;
    this.dirty = true;
    this.ateIds = [];
    this.ateBy = [];
    this.kills = [];
    this.scratch = [];
    const plan = spawnPlan(city, seed, Math.max(C.TABLE, roster.length));
    this.holes = roster.map((entry, idx) => ({
      id: entry.id,
      idx,
      bot: !!entry.bot,
      x: plan[idx].x,
      z: plan[idx].z,
      vx: 0,
      vz: 0,
      mass: 0,
      score: 0,
      deadUntil: 0,
      gone: false,
      brain: entry.bot ? new BotBrain(mulberry32(hashSeed(seed, 'bot', idx))) : null,
      bucket: C.CLAIM_BURST,
      bucketAt: startMs,
      posAt: startMs,
      eats: 0,
      gulps: 0,
    }));
    this.byId = new Map(this.holes.map((h) => [h.id, h]));
  }

  radius(h) {
    return radiusFor(h.mass);
  }

  isAlive(h, t = this.t) {
    return !h.gone && t >= h.deadUntil;
  }

  /** Just back from being swallowed: can't be swallowed again for a moment. */
  isProtected(h, t = this.t) {
    return h.deadUntil > 0 && t < h.deadUntil + C.PROTECT_MS;
  }

  /** Steps the round forward to match time `now`, in fixed slices (a long stall is cut short, not replayed). */
  advanceTo(now) {
    if (now - this.last > 400) this.last = now - 400;
    while (this.last + C.SIM_STEP_MS <= now) {
      this.last += C.SIM_STEP_MS;
      this.step(C.SIM_STEP_MS / 1000, this.last);
    }
  }

  step(dt, t) {
    this.t = t;
    const { city } = this;
    city.updateMovers(t / 1000);
    for (const h of this.holes) {
      if (h.gone || !h.bot) continue;
      if (t < h.deadUntil) continue;
      h.brain.update(this, h, dt);
      const R = radiusFor(h.mass);
      const ids = collectSwallows(city, this.grid, this.eaten, h.x, h.z, R, this.scratch);
      for (let k = 0; k < ids.length; k++) this.eat(h, ids[k]);
      if (ids.length) clampToWorld(h, radiusFor(h.mass), city.half); // it just grew: keep the whole hole on the map
    }
    // a bot swallows any smaller hole it covers, human or bot
    for (const a of this.holes) {
      if (!a.bot || !this.isAlive(a, t)) continue;
      const Ra = radiusFor(a.mass);
      for (const b of this.holes) {
        if (b === a || !this.isAlive(b, t) || this.isProtected(b, t)) continue;
        const Rb = radiusFor(b.mass);
        if (Ra < Rb * C.GULP_RATIO) continue;
        if (canGulp(Ra, Rb, Math.hypot(a.x - b.x, a.z - b.z))) this.applyGulp(a, b, t);
      }
    }
  }

  eat(h, id) {
    if (this.eaten[id]) return false;
    this.eaten[id] = 1;
    this.eatenCount++;
    const v = this.city.value[id];
    h.mass += v;
    h.score += v;
    h.eats++;
    this.ateIds.push(id);
    this.ateBy.push(h.idx);
    this.dirty = true;
    return true;
  }

  /** A page says its hole swallowed these objects. Each is checked; the first claim on an object wins. */
  claim(playerId, ids, t = this.t) {
    const out = { accepted: 0, refused: 0, refusedIds: [] };
    const h = this.byId.get(playerId);
    if (!h || h.bot || !Array.isArray(ids)) return out;
    if (!this.isAlive(h, t)) {
      out.refused = ids.length;
      for (const id of ids) if (Number.isInteger(id)) out.refusedIds.push(id);
      return out;
    }
    h.bucket = Math.min(C.CLAIM_BURST, h.bucket + (Math.max(0, t - h.bucketAt) / 1000) * C.CLAIM_PER_SECOND);
    h.bucketAt = t;
    const { city } = this;
    const count = Math.min(ids.length, C.CLAIM_MAX_IDS);
    for (let k = 0; k < count; k++) {
      const id = ids[k];
      if (!Number.isInteger(id) || id < 0 || id >= city.n) {
        out.refused++;
        continue;
      }
      if (this.eaten[id] || h.bucket < 1) {
        out.refused++;
        out.refusedIds.push(id);
        continue;
      }
      const r = city.r[id];
      const R = radiusFor(h.mass);
      const d = Math.hypot(city.x[id] - h.x, city.z[id] - h.z);
      if (R * C.CLAIM_SIZE_SLACK < r * C.EAT_RATIO || d > R + r + C.CLAIM_DIST_SLACK) {
        out.refused++;
        out.refusedIds.push(id);
        continue;
      }
      h.bucket -= 1;
      this.eat(h, id);
      out.accepted++;
    }
    return out;
  }

  /** A page says its hole swallowed another hole. Checked against sizes and positions. */
  gulp(aId, bId, t = this.t) {
    const a = this.byId.get(aId);
    const b = this.byId.get(bId);
    if (!a || !b || a === b || !this.isAlive(a, t) || !this.isAlive(b, t) || this.isProtected(b, t)) return false;
    const Ra = radiusFor(a.mass);
    const Rb = radiusFor(b.mass);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (!canGulp(Ra, Rb, d, C.GULP_RATIO * C.GULP_SIZE_SLACK, C.GULP_DIST_SLACK)) return false;
    this.applyGulp(a, b, t);
    return true;
  }

  applyGulp(a, b, t) {
    const gainScore = Math.round(b.score * C.GULP_SCORE);
    const gainMass = b.mass * C.GULP_SCORE;
    this.kills.push({ a: a.idx, b: b.idx, t, x: b.x, z: b.z });
    a.score += gainScore;
    a.mass += gainMass;
    a.gulps++;
    b.score = Math.floor(b.score * C.KEEP_SCORE);
    b.mass = 0;
    b.deadUntil = t + C.RESPAWN_MS;
    b.vx = 0;
    b.vz = 0;
    const spot = this.spawnPick(b, t);
    b.x = spot.x;
    b.z = spot.z;
    if (b.brain) b.brain.reset();
    this.dirty = true;
  }

  /** The edge spot farthest from every live hole (a little noise so it isn't always the same one). */
  spawnPick(self, t) {
    let best = null;
    let bestScore = -Infinity;
    for (const s of this.city.spawns) {
      let near = Infinity;
      for (const o of this.holes) {
        if (o === self || !this.isAlive(o, t)) continue;
        near = Math.min(near, Math.hypot(o.x - s.x, o.z - s.z));
      }
      const score = Math.min(near, 80) + this.rng() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best ?? this.city.spawns[0];
  }

  /** A human's page tells where its hole is (presence): it becomes the hole's position, with a velocity guess for bots hunting it. */
  setPos(id, x, z, t = this.t) {
    const h = this.byId.get(id);
    if (!h || h.bot || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const half = this.city.half;
    x = Math.max(-half, Math.min(half, x));
    z = Math.max(-half, Math.min(half, z));
    const dt = (t - h.posAt) / 1000;
    if (dt > 0.02 && dt < 1) {
      h.vx = (x - h.x) / dt;
      h.vz = (z - h.z) / dt;
    } else if (dt >= 1) {
      h.vx = 0;
      h.vz = 0;
    }
    h.x = x;
    h.z = z;
    h.posAt = t;
  }

  setGone(id, gone) {
    const h = this.byId.get(id);
    if (h) h.gone = !!gone;
  }

  /** Seats ordered by score, then mass, then seat. */
  ranking() {
    return this.holes
      .map((h) => h.idx)
      .sort((a, b) => this.holes[b].score - this.holes[a].score || this.holes[b].mass - this.holes[a].mass || a - b);
  }

  /** What the host publishes in `g`: scores, masses and the time each seat returns, in seat order. */
  exportState() {
    return {
      s: this.holes.map((h) => Math.round(h.score)),
      m: this.holes.map((h) => Math.round(h.mass * 10) / 10),
      d: this.holes.map((h) => Math.round(h.deadUntil)),
    };
  }

  /** A new host picks up where the last one left off. */
  importState(state) {
    if (!state || !Array.isArray(state.s) || !Array.isArray(state.m) || !Array.isArray(state.d)) return;
    for (const h of this.holes) {
      const s = state.s[h.idx];
      const m = state.m[h.idx];
      const d = state.d[h.idx];
      if (Number.isFinite(s) && s >= 0) h.score = s;
      if (Number.isFinite(m) && m >= 0) h.mass = m;
      if (Number.isFinite(d) && d >= 0) h.deadUntil = d;
    }
    this.dirty = true;
  }

  eatenText() {
    return encodeEaten(this.eaten, this.city.n);
  }

  loadEaten(text) {
    const flags = decodeEaten(text, this.city.n);
    if (!flags) return false;
    this.eaten.set(flags);
    this.eatenCount = 0;
    for (let i = 0; i < flags.length; i++) if (flags[i]) this.eatenCount++;
    return true;
  }

  /** Bot positions for the others to interpolate: [x, z, alive] per bot in seat order. */
  botSnapshot(t = this.t) {
    const out = [];
    for (const h of this.holes) {
      if (!h.bot) continue;
      out.push([Math.round(h.x * 100) / 100, Math.round(h.z * 100) / 100, this.isAlive(h, t) ? 1 : 0]);
    }
    return out;
  }

  loadBots(snapshot) {
    if (!Array.isArray(snapshot)) return;
    let k = 0;
    for (const h of this.holes) {
      if (!h.bot) continue;
      const p = snapshot[k++];
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        h.x = p[0];
        h.z = p[1];
      }
    }
  }

  drainAte() {
    const out = { ids: this.ateIds, by: this.ateBy };
    this.ateIds = [];
    this.ateBy = [];
    return out;
  }

  drainKills() {
    const out = this.kills;
    this.kills = [];
    return out;
  }
}
