// The city on screen: the ground, one InstancedMesh per kind of object, and everything that happens to the objects:
// walkers and traffic moving, things tipping over a hole's edge, falling in, popping back.
// It reads the city (pure data) and never decides anything; the session tells it what was eaten.

import { Group, Mesh, InstancedMesh, Matrix4, Quaternion, Vector3, Color, MeshStandardMaterial, DynamicDrawUsage } from 'three';
import { buildModels } from './models.js';
import { facadeTexture } from './textures.js';
import { buildGround, makeGroundMaterial } from './ground.js';
import { TYPES, TYPE_COUNT } from '../logic/objects.js';
import { overhang, canEat } from '../logic/rules.js';

const NORMAL = 0;
const HIDDEN = 1;
const FALLING = 2;
const POPPING = 3;
const MAX_FALLS = 180;

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _ax = new Vector3();
const _qy = new Quaternion();
const _qt = new Quaternion();
const _q = new Quaternion();
const Y = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);
const _c = new Color();

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOutBack = (t) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export class CityView {
  constructor(scene, holeUniform) {
    this.scene = scene;
    this.group = new Group();
    scene.add(this.group);
    this.models = buildModels();
    this.material = new MeshStandardMaterial({ vertexColors: true, map: facadeTexture(), roughness: 0.82, metalness: 0 });
    this.groundMaterial = makeGroundMaterial(holeUniform);
    this.city = null;
    this.ground = null;
    this.meshes = [];
    this.slot = new Int32Array(0);
    this.state = new Uint8Array(0);
    this.dirty = new Uint8Array(TYPE_COUNT);
    this.tintDirty = new Uint8Array(TYPE_COUNT);
    this.falls = [];
    this.pops = new Map();
    this.tilts = new Map();
    this.stamp = 0;
    this.time = 0;
    this._hole = null;
    this._visit = (id) => this.consider(id);
  }

  /** Builds the meshes for a city, replacing the last one. */
  load(city) {
    this.clear();
    this.city = city;
    const n = city.n;
    const counts = new Int32Array(TYPE_COUNT);
    this.slot = new Int32Array(n);
    for (let i = 0; i < n; i++) this.slot[i] = counts[city.type[i]]++;
    this.state = new Uint8Array(n);
    this.meshes = new Array(TYPE_COUNT).fill(null);
    for (let t = 0; t < TYPE_COUNT; t++) {
      if (counts[t] === 0) continue;
      const mesh = new InstancedMesh(this.models[t].geometry, this.material, counts[t]);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < counts[t]; i++) mesh.setColorAt(i, WHITE); // per-object tint: things darken as they sink into the pit
      this.group.add(mesh);
      this.meshes[t] = mesh;
    }
    this.ground = new Mesh(buildGround(city.ground), this.groundMaterial);
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.group.add(this.ground);
    for (let i = 0; i < n; i++) this.place(i, 0);
    this.dirty.fill(1);
    this.tintDirty.fill(1);
    this.flush();
  }

  clear() {
    for (const mesh of this.meshes) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose();
    }
    if (this.ground) {
      this.group.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground = null;
    }
    this.meshes = [];
    this.falls.length = 0;
    this.pops.clear();
    this.tilts.clear();
    this.city = null;
  }

  // ------------------------------------------------------------------------------------------------ matrices

  compose(x, y, z, yaw, tilt, tx, tz, scale) {
    _qy.setFromAxisAngle(Y, yaw);
    if (tilt > 0.0005) {
      _qt.setFromAxisAngle(_ax.set(tz, 0, -tx), tilt);
      _q.copy(_qt).multiply(_qy);
    } else _q.copy(_qy);
    _p.set(x, y, z);
    _s.set(scale, scale, scale);
    _m.compose(_p, _q, _s);
  }

  put(id) {
    const type = this.city.type[id];
    this.meshes[type].setMatrixAt(this.slot[id], _m);
    this.dirty[type] = 1;
  }

  /** Writes an object's resting matrix, with the tip toward a hole and the pop-in if it has them. */
  place(id, t) {
    const city = this.city;
    const r = city.r[id];
    let x = city.x[id];
    let z = city.z[id];
    let y = 0;
    let tilt = 0;
    let tx = 0;
    let tz = 0;
    let scale = 1;
    const tl = this.tilts.size > 0 ? this.tilts.get(id) : undefined;
    if (tl && tl.a > 0.001) {
      tilt = tl.a * 0.5 + Math.sin(t * 13 + id) * 0.045 * tl.a;
      tx = tl.dx;
      tz = tl.dz;
      const s = Math.sin(tilt);
      y -= s * r * 0.55;
      x += tx * s * r * 0.4;
      z += tz * s * r * 0.4;
    }
    if (this.state[id] === POPPING) {
      const age = this.pops.get(id) ?? 1;
      scale = Math.max(0.001, easeOutBack(Math.min(1, age / 0.45)));
    }
    const group = TYPES[city.type[id]].group;
    if (group === 'person') y += Math.abs(Math.sin(t * 7 + id * 1.9)) * 0.07;
    this.compose(x, y, z, city.yaw[id], tilt, tx, tz, scale);
    this.put(id);
  }

  hide(id) {
    this.state[id] = HIDDEN;
    this.tilts.delete(id);
    this.pops.delete(id);
    _m.makeScale(0, 0, 0);
    this.put(id);
  }

  /** How bright an object is drawn: 1 normally, darker as it sinks. */
  tint(id, k) {
    const type = this.city.type[id];
    _c.setScalar(k);
    this.meshes[type].setColorAt(this.slot[id], _c);
    this.tintDirty[type] = 1;
  }

  flush() {
    for (let t = 0; t < TYPE_COUNT; t++) {
      const mesh = this.meshes[t];
      if (this.dirty[t]) {
        this.dirty[t] = 0;
        if (mesh) mesh.instanceMatrix.needsUpdate = true;
      }
      if (this.tintDirty[t]) {
        this.tintDirty[t] = 0;
        if (mesh && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ what happens to objects

  isGone(id) {
    return this.state[id] === HIDDEN || this.state[id] === FALLING;
  }

  /** Takes an object out at once (it was eaten before this page looked, or far from any hole). */
  vanish(id) {
    if (!this.city || id < 0 || id >= this.city.n || this.state[id] === HIDDEN) return;
    if (this.state[id] === FALLING) this.removeFall(id);
    this.hide(id);
  }

  /**
   * An object falls into the hole at (hx, hz): it slides to the middle, tips and sinks out of sight. `seat` is the hole's
   * place in the `holes` list given to update(): the object follows that hole while it moves on.
   */
  fall(id, hx, hz, seat = -1) {
    const city = this.city;
    if (!city || id < 0 || id >= city.n) return;
    if (this.state[id] === HIDDEN || this.state[id] === FALLING) return;
    const h = this.models[city.type[id]].height;
    const x0 = city.x[id];
    const z0 = city.z[id];
    let dx = hx - x0;
    let dz = hz - z0;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      dx /= d;
      dz /= d;
    } else {
      dx = 0;
      dz = 1;
    }
    const tl = this.tilts.get(id);
    this.tilts.delete(id);
    this.pops.delete(id);
    this.state[id] = FALLING;
    if (this.falls.length >= MAX_FALLS) this.finishFall(0);
    const spin = (((id * 2654435761) >>> 0) / 4294967296 - 0.5) * 2.2;
    this.falls.push({
      id,
      t: 0,
      dur: 0.5 + 0.036 * h,
      x0,
      z0,
      hx,
      hz,
      dx,
      dz,
      yaw: city.yaw[id],
      h,
      r: city.r[id],
      tilt0: tl ? tl.a * 0.5 : 0,
      spin,
      seat,
    });
  }

  removeFall(id) {
    const i = this.falls.findIndex((f) => f.id === id);
    if (i >= 0) {
      this.falls[i] = this.falls[this.falls.length - 1];
      this.falls.pop();
    }
  }

  finishFall(i) {
    const f = this.falls[i];
    this.falls[i] = this.falls[this.falls.length - 1];
    this.falls.pop();
    this.hide(f.id);
  }

  /** Brings an object back (a practice object in the lobby, or a claim the host refused), growing in. */
  restore(id) {
    const city = this.city;
    if (!city || id < 0 || id >= city.n) return;
    if (this.state[id] === NORMAL || this.state[id] === POPPING) return;
    if (this.state[id] === FALLING) this.removeFall(id);
    this.state[id] = POPPING;
    this.pops.set(id, 0);
    this.tint(id, 1);
    this.place(id, this.time);
  }

  /** Puts an object partway through its fall and leaves it there (store art). */
  freezeFall(id, hx, hz, progress) {
    this.fall(id, hx, hz);
    const f = this.falls.find((e) => e.id === id);
    if (!f) return;
    f.t = f.dur * progress;
    this.writeFall(f);
    f.t = -1e9;
  }

  writeFall(f, holes) {
    const p = f.t / f.dur;
    const s = smooth(0, 0.42, p);
    let hx = f.hx;
    let hz = f.hz;
    const h = f.seat >= 0 && holes ? holes[f.seat] : null;
    if (h && h.shown !== false && Number.isFinite(h.x) && Number.isFinite(h.z)) {
      hx = h.x;
      hz = h.z;
    }
    const x = f.x0 + (hx - f.x0) * s;
    const z = f.z0 + (hz - f.z0) * s;
    const sink = p < 0.12 ? 0 : Math.pow((p - 0.12) / 0.88, 1.8);
    const y = -sink * (f.h + 1.6);
    const tilt = Math.max(f.tilt0, 0.95 * smooth(0, 0.6, p));
    const sc = 1 - 0.1 * smooth(0.3, 1, p);
    this.compose(x, y, z, f.yaw + f.spin * p, tilt, f.dx, f.dz, sc);
    this.put(f.id);
    this.tint(f.id, 1 - 0.88 * smooth(0.1, 0.85, p));
  }

  // ------------------------------------------------------------------------------------------------ every frame

  /**
   * dt: seconds (already scaled for hit-stop); t: the clock the movers follow; holes: [{ x, z, R, alive }] for the tipping.
   */
  update(dt, t, holes) {
    const city = this.city;
    if (!city) return;
    this.time = t;
    city.updateMovers(t);
    const movers = city.moverIds;
    for (let k = 0; k < movers.length; k++) {
      const id = movers[k];
      const st = this.state[id];
      if (st === NORMAL || st === POPPING) this.place(id, t);
    }
    // falls
    for (let i = this.falls.length - 1; i >= 0; i--) {
      const f = this.falls[i];
      if (f.t < -1e8) continue;
      f.t += dt;
      if (f.t >= f.dur) this.finishFall(i);
      else this.writeFall(f, holes);
    }
    // pop-ins
    if (this.pops.size > 0) {
      for (const [id, age] of this.pops) {
        const next = age + dt;
        if (next >= 0.45) {
          this.pops.delete(id);
          this.state[id] = NORMAL;
          this.place(id, t);
        } else {
          this.pops.set(id, next);
          this.place(id, t);
        }
      }
    }
    this.updateTilts(dt, t, holes);
    this.flush();
  }

  consider(id) {
    if (this.state[id] !== NORMAL) return;
    const city = this.city;
    const h = this._hole;
    const r = city.r[id];
    if (!canEat(h.R, r)) return;
    const dx = h.x - city.x[id];
    const dz = h.z - city.z[id];
    const d = Math.hypot(dx, dz);
    const f = overhang(h.R, d, r);
    if (f <= 0) return;
    let tl = this.tilts.get(id);
    if (!tl) {
      tl = { a: 0, target: 0, dx: 0, dz: 1, stamp: -1 };
      this.tilts.set(id, tl);
    }
    if (tl.stamp !== this.stamp || f > tl.target) {
      tl.target = f;
      if (d > 1e-3) {
        tl.dx = dx / d;
        tl.dz = dz / d;
      }
    }
    tl.stamp = this.stamp;
  }

  updateTilts(dt, t, holes) {
    const city = this.city;
    this.stamp++;
    if (holes && holes.length) {
      const grid = city.grid();
      const movers = city.moverIds;
      for (const h of holes) {
        if (!h.alive || !(h.R > 0.3)) continue;
        this._hole = h;
        grid.query(h.x, h.z, h.R * 1.5 + 0.6, this._visit);
        for (let k = 0; k < movers.length; k++) {
          const id = movers[k];
          const dx = city.x[id] - h.x;
          const dz = city.z[id] - h.z;
          if (dx * dx + dz * dz < (h.R * 1.5 + 0.6) ** 2) this.consider(id);
        }
      }
    }
    if (this.tilts.size === 0) return;
    const k = 1 - Math.exp(-12 * dt);
    for (const [id, tl] of this.tilts) {
      if (tl.stamp !== this.stamp) tl.target = 0;
      tl.a += (tl.target - tl.a) * k;
      if (tl.target === 0 && tl.a < 0.004) {
        this.tilts.delete(id);
        if (this.state[id] === NORMAL || this.state[id] === POPPING) this.place(id, t);
      } else if (this.state[id] === NORMAL || this.state[id] === POPPING) this.place(id, t);
    }
  }
}
