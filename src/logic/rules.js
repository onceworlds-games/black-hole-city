// The rules of a hole, in plain functions. Pure: the page, the host and the tests all use these.

import { R0, K, SPEED_FAST, SPEED_SLOW, SPEED_R_FULL, EAT_RATIO, EDGE_PULL, TILT_REACH, GULP_RATIO, GULP_DEPTH } from './config.js';

/** Radius from mass (what the hole has swallowed): area grows with what went in. */
export function radiusFor(mass) {
  return R0 * Math.sqrt(1 + Math.max(0, mass) / K);
}

/** The mass a hole of radius R has. */
export function massFor(R) {
  return Math.max(0, (R / R0) ** 2 - 1) * K;
}

/** Speed falls a little as the hole grows: 8 at the start, 6 at radius 10 and beyond. */
export function speedFor(R) {
  const t = Math.min(1, Math.max(0, (R - R0) / (SPEED_R_FULL - R0)));
  return SPEED_FAST + (SPEED_SLOW - SPEED_FAST) * t;
}

/** A hole of radius R is big enough for an object of footprint r. */
export const canEat = (R, r) => R >= r * EAT_RATIO;

/** The object's centre must be this close to the hole's centre for it to fall in. */
export const swallowDistance = (R, r) => R - r * EDGE_PULL;

/** An object hanging over the edge starts to tip when its centre is within this distance. */
export const tiltDistance = (R, r) => R + r * TILT_REACH;

/** 0 when the object is clear of the hole, 1 when it is about to fall: how far it tips. */
export function overhang(R, d, r) {
  const span = r * (EDGE_PULL + TILT_REACH);
  if (span <= 0) return 0;
  const f = (tiltDistance(R, r) - d) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** The bigger hole swallows the smaller one. */
export function canGulp(bigR, smallR, d, ratio = GULP_RATIO, slack = 0) {
  return bigR >= smallR * ratio && d <= bigR - smallR * GULP_DEPTH + slack;
}

/** Where a hole's centre may be: the whole hole nearly stays on the map. */
export function limit(R, half) {
  return Math.max(2, half - Math.min(R * 0.8, half - 2));
}

export function clampToWorld(h, R, half) {
  const m = limit(R, half);
  if (h.x > m) h.x = m;
  else if (h.x < -m) h.x = -m;
  if (h.z > m) h.z = m;
  else if (h.z < -m) h.z = -m;
}

/** Smooth step toward a target, independent of the frame rate. */
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** The ids of every object this hole swallows right now (written into `out`). */
export function collectSwallows(city, grid, eaten, x, z, R, out) {
  out.length = 0;
  const { r } = city;
  grid.query(x, z, R, (id) => {
    if (eaten[id]) return;
    const ro = r[id];
    if (R < ro * EAT_RATIO) return;
    const dx = city.x[id] - x;
    const dz = city.z[id] - z;
    const lim = R - ro * EDGE_PULL;
    if (dx * dx + dz * dz <= lim * lim) out.push(id);
  });
  const movers = city.moverIds;
  for (let k = 0; k < movers.length; k++) {
    const id = movers[k];
    if (eaten[id]) continue;
    const ro = r[id];
    if (R < ro * EAT_RATIO) continue;
    const dx = city.x[id] - x;
    const dz = city.z[id] - z;
    const lim = R - ro * EDGE_PULL;
    if (dx * dx + dz * dz <= lim * lim) out.push(id);
  }
  return out;
}
