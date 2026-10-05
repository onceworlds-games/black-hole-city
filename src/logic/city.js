// The city: a seeded 140 x 140 grid of blocks, built the same on every page from one number.
// Pure: no three.js, no DOM. It returns plain arrays (objects), rectangles (the ground) and paths (walkers and traffic).
//
// Layout: 5 x 5 blocks of 20 units with 8 unit streets between them and a 4 unit street around the edge.
// Houses and parks at the edges, apartments and towers inside, the stadium on one edge, the landmark in the middle.

import { mulberry32, range, pick, chance, shuffled } from './rng.js';
import { T, TYPE_R, TYPE_VALUE, variant } from './objects.js';
import { HALF, LOBBY_HALF } from './config.js';
import { Grid } from './grid.js';

export const PITCH = 28;
export const BLOCK = 20;
export const LOT = 8.5; // half size of the lot inside a block's sidewalk
export const H_WALK = 0.1;
export const H_LOT = 0.12;
export const H_PATH = 0.14;
export const H_MARK = 0.035;

export const yawOf = (dx, dz) => Math.atan2(-dz, dx);

/** Collects objects, ground rectangles and paths, then freezes them into a City. */
class Builder {
  constructor(kind, seed, half) {
    this.kind = kind;
    this.seed = seed;
    this.half = half;
    this.rng = mulberry32(seed);
    this.types = [];
    this.xs = [];
    this.zs = [];
    this.yaws = [];
    this.movers = []; // [id, pathIndex, speed, phase]
    this.paths = [];
    this.placed = []; // footprints that block other things: x, z, r
    this.ground = [];
    this.spawns = [];
    this.zones = [];
  }

  add(type, x, z, yaw = 0) {
    const id = this.types.length;
    this.types.push(type);
    this.xs.push(x);
    this.zs.push(z);
    this.yaws.push(yaw);
    this.placed.push(x, z, TYPE_R[type]);
    return id;
  }

  /** Where nothing else may be placed (a pond, a driveway), without being an object. */
  block(x, z, r) {
    this.placed.push(x, z, r);
  }

  free(x, z, r, margin = 0.75) {
    const m = this.half - 1.2;
    if (x < -m || x > m || z < -m || z > m) return false;
    const p = this.placed;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - x;
      const dz = p[i + 1] - z;
      const lim = (p[i + 2] + r) * margin;
      if (dx * dx + dz * dz < lim * lim) return false;
    }
    return true;
  }

  tryAdd(type, x, z, yaw = 0, margin = 0.75) {
    if (!this.free(x, z, TYPE_R[type], margin)) return -1;
    return this.add(type, x, z, yaw);
  }

  /** A mover: it follows a path (open paths are walked back and forth, closed ones are driven round and round). */
  mover(type, path, speed, phase) {
    const id = this.types.length;
    this.types.push(type);
    this.xs.push(path.pts[0]);
    this.zs.push(path.pts[1]);
    this.yaws.push(0);
    this.movers.push([id, path.index, speed, phase]);
    return id;
  }

  path(points, closed) {
    const pts = new Float32Array(points.length * 2);
    const count = points.length + (closed ? 1 : 0);
    const cum = new Float32Array(count);
    for (let i = 0; i < points.length; i++) {
      pts[i * 2] = points[i][0];
      pts[i * 2 + 1] = points[i][1];
    }
    for (let i = 1; i < count; i++) {
      const a = points[i - 1];
      const b = points[i % points.length];
      cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const path = { pts, cum, len: cum[count - 1], closed, count: points.length, index: this.paths.length };
    this.paths.push(path);
    return path;
  }

  rect(x0, z0, x1, z1, kind, top, bot = -0.3, flat = false) {
    this.ground.push({ x0, z0, x1, z1, kind, top, bot, flat });
  }

  finish() {
    return new City(this);
  }
}

export class City {
  constructor(b) {
    this.kind = b.kind;
    this.seed = b.seed;
    this.half = b.half;
    const n = b.types.length;
    this.n = n;
    this.type = Uint8Array.from(b.types);
    this.bx = Float32Array.from(b.xs);
    this.bz = Float32Array.from(b.zs);
    this.x = Float32Array.from(b.xs);
    this.z = Float32Array.from(b.zs);
    this.yaw = Float32Array.from(b.yaws);
    this.r = new Float32Array(n);
    this.value = new Float32Array(n);
    this.isMover = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.r[i] = TYPE_R[this.type[i]];
      this.value[i] = TYPE_VALUE[this.type[i]];
    }
    this.paths = b.paths;
    this.moverIds = Int32Array.from(b.movers.map((m) => m[0]));
    this.mvPath = Int16Array.from(b.movers.map((m) => m[1]));
    this.mvSpeed = Float32Array.from(b.movers.map((m) => m[2]));
    this.mvPhase = Float32Array.from(b.movers.map((m) => m[3]));
    for (const id of this.moverIds) this.isMover[id] = 1;
    this.ground = b.ground;
    this.spawns = b.spawns;
    this.totalValue = 0;
    for (let i = 0; i < n; i++) this.totalValue += this.value[i];
    this.updateMovers(0);
  }

  /** Where every walker and driver is at time `t` (seconds of match time): the same everywhere from the same clock. */
  updateMovers(t) {
    const ids = this.moverIds;
    for (let k = 0; k < ids.length; k++) {
      const path = this.paths[this.mvPath[k]];
      const id = ids[k];
      let s = this.mvPhase[k] + this.mvSpeed[k] * t;
      let dir = 1;
      if (path.closed) {
        s %= path.len;
        if (s < 0) s += path.len;
      } else {
        const period = path.len * 2;
        s %= period;
        if (s < 0) s += period;
        if (s > path.len) {
          s = period - s;
          dir = -1;
        }
      }
      const segs = path.closed ? path.count : path.count - 1;
      let i = 0;
      while (i < segs - 1 && s > path.cum[i + 1]) i++;
      const a = i * 2;
      const b = ((i + 1) % path.count) * 2;
      const len = path.cum[i + 1] - path.cum[i];
      const f = len > 0 ? (s - path.cum[i]) / len : 0;
      const ax = path.pts[a];
      const az = path.pts[a + 1];
      const dx = path.pts[b] - ax;
      const dz = path.pts[b + 1] - az;
      this.x[id] = ax + dx * f;
      this.z[id] = az + dz * f;
      this.yaw[id] = yawOf(dx * dir, dz * dir);
    }
  }

  /** The spatial grid over the static objects, built the first time anyone asks. */
  grid() {
    if (!this._grid) this._grid = new Grid(this);
    return this._grid;
  }

  countType(typeIndex) {
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.type[i] === typeIndex) c++;
    return c;
  }
}

// ----------------------------------------------------------------------------------------------------------------- the main city

const blockCentre = (i) => -HALF + 14 + PITCH * i; // -56, -28, 0, 28, 56

/** The 16 spots around the edge where holes begin and come back, clockwise from the north west. */
function edgeSpawns() {
  const r = HALF - 2;
  const roads = [-42, -14, 14, 42];
  const out = [];
  for (const x of roads) out.push({ x, z: -r });
  for (const z of roads) out.push({ x: r, z });
  for (const x of [...roads].reverse()) out.push({ x, z: r });
  for (const z of [...roads].reverse()) out.push({ x: -r, z });
  return out;
}

/** A side of a block: 0 top (north), 1 right (east), 2 bottom (south), 3 left (west). */
function sidePoint(cx, cz, side, along, off) {
  switch (side) {
    case 0:
      return [cx + along, cz - off];
    case 1:
      return [cx + off, cz + along];
    case 2:
      return [cx - along, cz + off];
    default:
      return [cx - off, cz - along];
  }
}
/** The direction cars face on a side while parked (the way traffic runs, clockwise round the block). */
const SIDE_DIR = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export function generateCity(seed) {
  const b = new Builder('city', seed, HALF);
  const { rng } = b;

  // Ground: the dark outskirts, then one big asphalt plate, then the blocks on it, then the street markings.
  b.rect(-260, -260, 260, 260, 'outer', -0.12, -0.5);
  b.rect(-HALF, -HALF, HALF, HALF, 'asphalt', 0, -0.4);
  b.rect(-HALF - 1.6, -HALF - 1.6, HALF + 1.6, -HALF, 'wall', 1.1, -0.4);
  b.rect(-HALF - 1.6, HALF, HALF + 1.6, HALF + 1.6, 'wall', 1.1, -0.4);
  b.rect(-HALF - 1.6, -HALF, -HALF, HALF, 'wall', 1.1, -0.4);
  b.rect(HALF, -HALF, HALF + 1.6, HALF, 'wall', 1.1, -0.4);

  b.spawns = edgeSpawns();
  for (const s of b.spawns) b.block(s.x, s.z, 1.2); // keeps big things off the spots holes begin on

  // What each block is: houses and parks at the edge, apartments and towers inside.
  const kinds = new Array(25).fill('');
  kinds[2 * 5 + 2] = 'landmark';
  const outer = [];
  const inner = [];
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 5; i++) {
      const ring = Math.max(Math.abs(i - 2), Math.abs(j - 2));
      if (ring === 2) outer.push(j * 5 + i);
      else if (ring === 1) inner.push(j * 5 + i);
    }
  }
  const outerKinds = shuffled(rng, ['stadium', 'house', 'house', 'house', 'house', 'house', 'house', 'park', 'park', 'park', 'shop', 'shop', 'shop', 'plaza', 'apt', 'apt']);
  const innerKinds = shuffled(rng, ['office', 'office', 'office', 'office', 'apt', 'apt', 'plaza', 'park']);
  outer.forEach((cell, k) => (kinds[cell] = outerKinds[k]));
  inner.forEach((cell, k) => (kinds[cell] = innerKinds[k]));

  // Big things first so small things can avoid them.
  const blocks = [];
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 5; i++) {
      const cx = blockCentre(i);
      const cz = blockCentre(j);
      const kind = kinds[j * 5 + i];
      blocks.push({ i, j, cx, cz, kind });
      b.rect(cx - BLOCK / 2, cz - BLOCK / 2, cx + BLOCK / 2, cz + BLOCK / 2, 'walk', H_WALK);
    }
  }
  for (const blk of blocks) fillLot(b, rng, blk);
  for (const blk of blocks) furnish(b, rng, blk);
  markStreets(b);
  return b.finish();
}

function lotRect(b, cx, cz, kind, inset = 0) {
  b.rect(cx - LOT + inset, cz - LOT + inset, cx + LOT - inset, cz + LOT - inset, kind, H_LOT);
}

function checker(b, cx, cz, a, c, tile) {
  const n = Math.round((LOT * 2) / tile);
  const size = (LOT * 2) / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = cx - LOT + i * size;
      const z0 = cz - LOT + j * size;
      b.rect(x0, z0, x0 + size, z0 + size, (i + j) % 2 ? a : c, H_LOT);
    }
  }
}

function plots() {
  const p = LOT / 2;
  return [
    [-p, -p],
    [p, -p],
    [-p, p],
    [p, p],
  ];
}

function fillLot(b, rng, blk) {
  const { cx, cz, kind } = blk;
  switch (kind) {
    case 'landmark':
      checker(b, cx, cz, 'paved', 'paved2', 4.25);
      b.add(T.landmark, cx, cz, 0);
      break;
    case 'stadium':
      lotRect(b, cx, cz, 'lot');
      b.rect(cx - 7, cz - 7, cx + 7, cz + 7, 'paved', H_PATH, -0.3, true);
      b.add(T.stadium, cx, cz, rng() < 0.5 ? 0 : Math.PI / 2);
      break;
    case 'house': {
      lotRect(b, cx, cz, 'grass');
      for (const [px, pz] of plots()) {
        const x = cx + px;
        const z = cz + pz;
        // a driveway and path from the street to every house; the door faces the street
        const edge = pz > 0 ? cz + LOT : cz - LOT;
        b.rect(x - 0.9, Math.min(z, edge), x + 0.9, Math.max(z, edge), 'path', H_PATH, -0.3, true);
        if (chance(rng, 0.9)) b.add(variant('house', Math.floor(rng() * 3), 3), x, z, pz > 0 ? 0 : Math.PI);
      }
      break;
    }
    case 'apt': {
      lotRect(b, cx, cz, 'grass');
      const diagonal = rng() < 0.5;
      const spots = diagonal
        ? [
            [-LOT / 2, -LOT / 2],
            [LOT / 2, LOT / 2],
          ]
        : [
            [-LOT / 2, LOT / 2],
            [LOT / 2, -LOT / 2],
          ];
      const free = diagonal
        ? [
            [LOT / 2, -LOT / 2],
            [-LOT / 2, LOT / 2],
          ]
        : [
            [-LOT / 2, -LOT / 2],
            [LOT / 2, LOT / 2],
          ];
      for (const [px, pz] of spots) b.add(variant('apt', Math.floor(rng() * 3), 3), cx + px, cz + pz, rng() < 0.5 ? 0 : Math.PI / 2);
      for (const [px, pz] of free) {
        b.rect(cx + px - 3.9, cz + pz - 3.9, cx + px + 3.9, cz + pz + 3.9, 'lot', H_PATH, -0.3, true);
      }
      break;
    }
    case 'office': {
      lotRect(b, cx, cz, 'paved');
      const list = shuffled(rng, plots());
      const count = rng() < 0.7 ? 4 : 3;
      list.forEach(([px, pz], k) => {
        if (k < count) b.add(variant('office', Math.floor(rng() * 3), 3), cx + px, cz + pz, rng() < 0.5 ? 0 : Math.PI / 2);
        else {
          b.rect(cx + px - 3.6, cz + pz - 3.6, cx + px + 3.6, cz + pz + 3.6, 'grass', H_PATH, -0.3, true);
        }
      });
      break;
    }
    case 'park':
      lotRect(b, cx, cz, 'grass');
      b.rect(cx - 0.9, cz - LOT, cx + 0.9, cz + LOT, 'path', H_PATH, -0.3, true);
      b.rect(cx - LOT, cz - 0.9, cx + LOT, cz + 0.9, 'path', H_PATH, -0.3, true);
      b.rect(cx - 3.4, cz - 3.4, cx + 3.4, cz + 3.4, 'paved', H_PATH, -0.3, true);
      b.add(T.fountain, cx, cz, 0);
      break;
    case 'plaza':
      checker(b, cx, cz, 'paved', 'paved2', 2.125);
      break;
    case 'shop':
      lotRect(b, cx, cz, 'paved');
      b.rect(cx - LOT, cz - 1.6, cx + LOT, cz + 1.6, 'lot', H_PATH, -0.3, true);
      for (const [px, pz] of plots()) {
        if (chance(rng, 0.92)) b.add(variant('shop', Math.floor(rng() * 2), 2), cx + px, cz + pz * 1.04, pz > 0 ? Math.PI : 0);
      }
      break;
    default:
      lotRect(b, cx, cz, 'grass');
  }
}

/** Everything small: the sidewalk's furniture, people, parked cars, and the lot's own props. */
function furnish(b, rng, blk) {
  const { cx, cz, kind, i, j } = blk;
  const o = 9.3; // the middle of the sidewalk, from the block's centre

  // street furniture
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.tryAdd(T.lamp, cx + sx * o, cz + sz * o, 0, 0.5);
  for (let side = 0; side < 4; side++) {
    if (chance(rng, 0.8)) {
      const [x, z] = sidePoint(cx, cz, side, range(rng, -1.5, 1.5), o);
      b.tryAdd(T.lamp, x, z, 0, 0.5);
    }
    const [dx, dz] = SIDE_DIR[side];
    const yaw = side % 2 ? Math.PI / 2 : 0;
    for (let k = 0; k < 2; k++) {
      const [x, z] = sidePoint(cx, cz, side, range(rng, -7, 7), o + range(rng, -0.25, 0.25));
      if (chance(rng, 0.55)) b.tryAdd(k === 0 ? T.hydrant : T.trash, x, z, 0, 0.6);
    }
    if (chance(rng, 0.5)) {
      const [x, z] = sidePoint(cx, cz, side, range(rng, -6, 6), o);
      b.tryAdd(T.bench, x, z, yaw, 0.7);
    }
    if (chance(rng, 0.4)) {
      const [x, z] = sidePoint(cx, cz, side, range(rng, -6, 6), o + 0.2);
      b.tryAdd(T.mailbox, x, z, 0, 0.6);
    }
    // a run of cones at the kerb, now and then
    if (chance(rng, 0.2)) {
      const start = range(rng, -5, 3);
      for (let k = 0; k < 6; k++) {
        const [x, z] = sidePoint(cx, cz, side, start + k * 1.2, 10.55);
        b.tryAdd(T.cone, x, z, 0, 0.5);
      }
    }
    // a rack of bikes on the sidewalk
    if (chance(rng, 0.12)) {
      const start = range(rng, -6, 1);
      for (let k = 0; k < 5; k++) {
        const [x, z] = sidePoint(cx, cz, side, start + k * 1.3, o - 0.25);
        b.tryAdd(T.bike, x, z, side % 2 ? 0 : Math.PI / 2, 0.55);
      }
    }

    // parked cars along the road, one lane from the kerb
    const slots = [-6.2, -2, 2.2, 6.2];
    for (const along of slots) {
      if (!chance(rng, 0.5)) continue;
      const [x, z] = sidePoint(cx, cz, side, along + range(rng, -0.4, 0.4), 11.05);
      b.tryAdd(variant('car', Math.floor(rng() * 5), 5), x, z, yawOf(dx, dz), 0.9);
    }
  }

  // lot specifics
  switch (kind) {
    case 'house':
      for (const [px, pz] of plots()) {
        const x = cx + px;
        const z = cz + pz;
        for (const [ox, oz] of shuffled(rng, [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]).slice(0, 2)) b.tryAdd(chance(rng, 0.5) ? T.tree : T.pine, x + ox, z + oz, 0, 0.7);
        for (let k = 0; k < 4; k++) b.tryAdd(T.bush, x + range(rng, -4, 4), z + range(rng, -4, 4), 0, 0.8);
        if (chance(rng, 0.3)) b.tryAdd(variant('car', Math.floor(rng() * 5), 5), x + (pz > 0 ? 2.6 : -2.6), z + (pz > 0 ? 3.2 : -3.2), Math.PI / 2, 0.7);
        if (chance(rng, 0.25)) b.tryAdd(T.bike, x + range(rng, -3, 3), z + range(rng, -3, 3), range(rng, 0, 3), 0.8);
        if (chance(rng, 0.2)) b.tryAdd(T.crate, x + range(rng, -3, 3), z + range(rng, -3, 3), range(rng, 0, 3), 0.8);
        if (chance(rng, 0.5)) b.tryAdd(T.mailbox, x + 1.6, z + (pz > 0 ? LOT / 2 - 0.6 : -LOT / 2 + 0.6), 0, 0.7);
      }
      for (let k = 0; k < 2; k++) wanderer(b, rng, cx, cz, 8, 'person');
      break;
    case 'apt':
      for (let k = 0; k < 7; k++) {
        const x = cx + range(rng, -LOT + 1.2, LOT - 1.2);
        const z = cz + range(rng, -LOT + 1.2, LOT - 1.2);
        b.tryAdd(variant('car', Math.floor(rng() * 5), 5), x, z, rng() < 0.5 ? 0 : Math.PI / 2, 0.9);
      }
      for (let k = 0; k < 7; k++) b.tryAdd(chance(rng, 0.6) ? T.tree : T.bush, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.8);
      for (let k = 0; k < 2; k++) b.tryAdd(T.bench, cx + range(rng, -6, 6), cz + range(rng, -6, 6), range(rng, 0, 3), 0.8);
      for (let k = 0; k < 4; k++) wanderer(b, rng, cx, cz, 8, 'person');
      break;
    case 'office':
      for (let k = 0; k < 6; k++) b.tryAdd(T.lamp, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.6);
      for (let k = 0; k < 5; k++) b.tryAdd(T.bench, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.7);
      for (let k = 0; k < 5; k++) b.tryAdd(chance(rng, 0.5) ? T.bush : T.tree, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.7);
      b.tryAdd(T.kiosk, cx + range(rng, -5, 5), cz + range(rng, -5, 5), range(rng, 0, 3), 0.7);
      for (let k = 0; k < 9; k++) wanderer(b, rng, cx, cz, 8, 'person');
      for (let k = 0; k < 2; k++) b.tryAdd(T.bike, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.8);
      break;
    case 'park': {
      for (let k = 0; k < 16; k++) b.tryAdd(chance(rng, 0.55) ? T.tree : T.pine, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.7);
      for (let k = 0; k < 12; k++) b.tryAdd(T.bush, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.7);
      for (let k = 0; k < 8; k++) {
        const horizontal = k % 2 === 0;
        const t = range(rng, 4.5, 8);
        const sign = chance(rng, 0.5) ? 1 : -1;
        b.tryAdd(T.bench, horizontal ? cx + sign * t : cx + 1.5, horizontal ? cz + 1.5 : cz + sign * t, horizontal ? 0 : Math.PI / 2, 0.7);
      }
      for (let k = 0; k < 4; k++) b.tryAdd(T.bike, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.8);
      b.tryAdd(T.kiosk, cx + range(rng, -6, 6), cz + 6.2, 0, 0.7);
      for (let k = 0; k < 4; k++) b.tryAdd(T.trash, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.7);
      for (let k = 0; k < 7; k++) wanderer(b, rng, cx, cz, 8, 'person');
      break;
    }
    case 'plaza': {
      for (let k = 0; k < 4; k++) b.tryAdd(T.kiosk, cx + range(rng, -6, 6), cz + range(rng, -6, 6), range(rng, 0, 3), 0.9);
      for (let k = 0; k < 10; k++) b.tryAdd(T.bench, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.8);
      for (let k = 0; k < 8; k++) b.tryAdd(T.lamp, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.6);
      for (let k = 0; k < 6; k++) b.tryAdd(chance(rng, 0.5) ? T.tree : T.bush, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.7);
      for (let k = 0; k < 5; k++) b.tryAdd(T.bike, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.8);
      for (let k = 0; k < 4; k++) b.tryAdd(T.crate, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.8);
      if (chance(rng, 0.5)) b.tryAdd(T.fountain, cx, cz, 0, 0.5);
      for (let k = 0; k < 14; k++) wanderer(b, rng, cx, cz, 8, 'person');
      break;
    }
    case 'shop':
      for (let k = 0; k < 7; k++) b.tryAdd(variant('car', Math.floor(rng() * 5), 5), cx + range(rng, -LOT, LOT), cz + range(rng, -1.2, 1.2), 0, 0.9);
      for (let k = 0; k < 4; k++) b.tryAdd(chance(rng, 0.5) ? T.tree : T.bush, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.7);
      for (let k = 0; k < 3; k++) b.tryAdd(T.bench, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.8);
      b.tryAdd(T.kiosk, cx + range(rng, -6, 6), cz + range(rng, -2.5, 2.5), 0, 0.7);
      for (let k = 0; k < 3; k++) b.tryAdd(T.crate, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.8);
      for (let k = 0; k < 7; k++) wanderer(b, rng, cx, cz, 8, 'person');
      // a bus at the kerb of the busiest side
      b.tryAdd(T.bus, cx + range(rng, -3, 3), cz + 11.4, Math.PI, 0.9);
      break;
    case 'stadium':
      for (let k = 0; k < 9; k++) b.tryAdd(variant('car', Math.floor(rng() * 5), 5), cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), rng() < 0.5 ? 0 : Math.PI / 2, 0.9);
      for (let k = 0; k < 6; k++) b.tryAdd(T.lamp, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.6);
      for (let k = 0; k < 2; k++) b.tryAdd(T.kiosk, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.8);
      for (let k = 0; k < 4; k++) b.tryAdd(chance(rng, 0.5) ? T.tree : T.bush, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), 0, 0.7);
      for (let k = 0; k < 12; k++) wanderer(b, rng, cx, cz, 8, 'person');
      break;
    case 'landmark':
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          b.tryAdd(chance(rng, 0.5) ? T.tree : T.pine, cx + sx * 7.6, cz + sz * 7.6, 0, 0.7);
          b.tryAdd(T.bench, cx + sx * 6.2, cz + sz * 8.1, 0, 0.7);
          b.tryAdd(T.lamp, cx + sx * 8.2, cz + sz * 5.4, 0, 0.5);
        }
      }
      for (let k = 0; k < 4; k++) b.tryAdd(T.bike, cx + range(rng, -LOT, LOT), cz + range(rng, -LOT, LOT), range(rng, 0, 3), 0.8);
      for (let k = 0; k < 14; k++) wanderer(b, rng, cx, cz, 8, 'person');
      break;
    default:
      break;
  }

  // a hedge along the lot's edge, once everything bigger has its place
  if (kind === 'house' || kind === 'apt' || kind === 'park') {
    for (let side = 0; side < 4; side++) {
      for (let k = -4; k <= 4; k++) {
        const [x, z] = sidePoint(cx, cz, side, k * 1.9, LOT - 0.35);
        if (chance(rng, 0.55)) b.tryAdd(T.bush, x, z, 0, 0.55);
      }
    }
  }

  // people on the sidewalk, going back and forth along one side
  const walkers = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < walkers; k++) {
    const side = Math.floor(rng() * 4);
    const len = range(rng, 6, 8);
    const centre = range(rng, -1.5, 1.5);
    const a = sidePoint(cx, cz, side, centre - len, o + range(rng, -0.3, 0.3));
    const c = sidePoint(cx, cz, side, centre + len, o + range(rng, -0.3, 0.3));
    const path = b.path([a, c], false);
    b.mover(variant('person', Math.floor(rng() * 4), 4), path, range(rng, 1.0, 1.7), rng() * path.len * 2);
  }

  // traffic: a loop round every other block, two cars on it, so the loops never cross
  if ((i + j) % 2 === 0) {
    const h = BLOCK / 2 + 3;
    const c = 2.4;
    const pts = [
      [cx - h + c, cz - h],
      [cx + h - c, cz - h],
      [cx + h, cz - h + c],
      [cx + h, cz + h - c],
      [cx + h - c, cz + h],
      [cx - h + c, cz + h],
      [cx - h, cz + h - c],
      [cx - h, cz - h + c],
    ];
    const path = b.path(pts, true);
    const speed = range(rng, 3.6, 4.6);
    const first = rng() * path.len;
    const cars = chance(rng, 0.8) ? 2 : 1;
    for (let k = 0; k < cars; k++) b.mover(variant('car', Math.floor(rng() * 5), 5), path, speed, first + (k * path.len) / cars);
  }
}

/** A person who strolls back and forth between two spots inside a lot. */
function wanderer(b, rng, cx, cz, spread, base) {
  const ax = cx + range(rng, -spread, spread);
  const az = cz + range(rng, -spread, spread);
  const ang = rng() * Math.PI * 2;
  const len = range(rng, 3, 8);
  const bx = Math.max(cx - spread - 0.5, Math.min(cx + spread + 0.5, ax + Math.cos(ang) * len));
  const bz = Math.max(cz - spread - 0.5, Math.min(cz + spread + 0.5, az + Math.sin(ang) * len));
  if (Math.hypot(bx - ax, bz - az) < 1.5) return;
  const path = b.path(
    [
      [ax, az],
      [bx, bz],
    ],
    false,
  );
  b.mover(variant(base, Math.floor(rng() * 4), 4), path, range(rng, 0.9, 1.6), rng() * path.len * 2);
}

/** Lane lines and zebra crossings, flat on the asphalt. */
function markStreets(b) {
  const roads = [-42, -14, 14, 42];
  const y0 = 0;
  const flat = (x0, z0, x1, z1, kind) => b.rect(x0, z0, x1, z1, kind, y0 + H_MARK, y0, true);
  const clear = (v) => roads.every((r) => Math.abs(v - r) > 4.2);
  for (const road of roads) {
    // dashed centre line and solid lines between the parking strip and the lane, both directions
    for (let t = -HALF + 2; t < HALF - 3; t += 4) {
      if (clear(t) && clear(t + 2)) {
        flat(road - 0.12, t, road + 0.12, t + 2, 'mark_y');
        flat(t, road - 0.12, t + 2, road + 0.12, 'mark_y');
      }
    }
    for (const side of [-2, 2]) {
      let start = -HALF + 1;
      for (const r of [...roads, HALF + 8]) {
        const end = Math.min(HALF - 1, r - 4.2);
        if (end - start > 1) {
          flat(road + side - 0.07, start, road + side + 0.07, end, 'mark_w');
          flat(start, road + side - 0.07, end, road + side + 0.07, 'mark_w');
        }
        start = r + 4.2;
      }
    }
  }
  // zebra crossings on every arm of every crossroads
  for (const ix of roads) {
    for (const iz of roads) {
      for (let k = -3; k <= 3; k++) {
        const s = k * 1.1;
        for (const d of [-1, 1]) {
          const a = d > 0 ? 4.6 : -6.6;
          flat(ix + a, iz + s - 0.3, ix + a + 2, iz + s + 0.3, 'mark_w'); // east and west arms
          flat(ix + s - 0.3, iz + a, ix + s + 0.3, iz + a + 2, 'mark_w'); // south and north arms
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- the lobby

/** A small park corner to practise in: cones, benches, bikes and a couple of cars to grow into. */
export function generateLobby(seed) {
  const b = new Builder('lobby', seed, LOBBY_HALF);
  const { rng } = b;
  const H = LOBBY_HALF;
  b.rect(-200, -200, 200, 200, 'outer', -0.12, -0.5);
  b.rect(-H, -H, H, H, 'asphalt', 0, -0.4);
  b.rect(-H - 1.6, -H - 1.6, H + 1.6, -H, 'wall', 1.1, -0.4);
  b.rect(-H - 1.6, H, H + 1.6, H + 1.6, 'wall', 1.1, -0.4);
  b.rect(-H - 1.6, -H, -H, H, 'wall', 1.1, -0.4);
  b.rect(H, -H, H + 1.6, H, 'wall', 1.1, -0.4);
  b.rect(-H, -H, H, H - 7, 'walk', H_WALK);
  b.rect(-H + 1.5, -H + 1.5, H - 1.5, H - 8.5, 'grass', H_LOT);
  b.rect(-1, -H + 1.5, 1, H - 8.5, 'path', H_PATH, -0.3, true);
  b.rect(-H + 1.5, -9.5, H - 1.5, -7.5, 'path', H_PATH, -0.3, true);
  b.rect(-H, H - 6.6, H, H - 6.45, 'mark_w', H_MARK, 0, true);
  for (let x = -H + 1; x < H - 2; x += 4) b.rect(x, H - 3.6, x + 2, H - 3.4, 'mark_y', H_MARK, 0, true);

  b.spawns = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    b.spawns.push({ x: Math.cos(a) * 8.5, z: Math.sin(a) * 6.5 - 3 });
  }
  for (const s of b.spawns) b.block(s.x, s.z, 1.6);

  b.add(T.fountain, -13.5, -10.5, 0);
  b.add(T.kiosk, 14, -13, 0.6);
  // a cone slalom across the middle
  for (let k = 0; k < 9; k++) b.tryAdd(T.cone, -16 + k * 4, -8.5 + (k % 2 ? 1.6 : -1.6) - 1.8, 0, 0.5);
  const scatter = (type, count, margin = 0.8) => {
    let placed = 0;
    for (let tries = 0; tries < count * 12 && placed < count; tries++) {
      const id = b.tryAdd(type, range(rng, -H + 2.5, H - 2.5), range(rng, -H + 2.5, H - 9.5), range(rng, 0, 3.1), margin);
      if (id >= 0) placed++;
    }
  };
  scatter(T.tree, 8);
  scatter(T.pine, 6);
  scatter(T.bush, 12, 0.6);
  scatter(T.bench, 8);
  scatter(T.hydrant, 6, 0.6);
  scatter(T.trash, 6, 0.6);
  scatter(T.bike, 7, 0.6);
  scatter(T.crate, 5, 0.6);
  scatter(T.mailbox, 4, 0.6);
  scatter(T.cone, 8, 0.5);
  for (let k = 0; k < 5; k++) b.tryAdd(T.lamp, -H + 2 + k * 10.5, H - 8.6, 0, 0.5);
  // two parked cars and a bus to grow into
  b.tryAdd(T.car1, -9, H - 5.6, 0, 0.9);
  b.tryAdd(T.car3, 4, H - 5.6, Math.PI, 0.9);
  b.tryAdd(T.bus, 15, H - 5.6, 0, 0.9);
  for (let k = 0; k < 6; k++) {
    const ax = range(rng, -H + 5, H - 5);
    const az = range(rng, -H + 4, H - 10);
    const path = b.path(
      [
        [ax, az],
        [ax + range(rng, -6, 6), az + range(rng, -4, 4)],
      ],
      false,
    );
    b.mover(variant('person', k, 4), path, range(rng, 0.9, 1.5), rng() * path.len * 2);
  }
  const loop = b.path(
    [
      [-H + 3, H - 1.9],
      [H - 3, H - 1.9],
    ],
    false,
  );
  b.mover(T.car2, loop, 3.4, 4);
  return b.finish();
}
