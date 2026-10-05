// Low-poly models for every kind of thing in the city, built from boxes, cylinders and spheres into one flat-shaded,
// vertex-coloured geometry per type (so every type is one InstancedMesh). No DOM: node can build them for the tests.
//
// Walls of buildings carry texture coordinates that tile a window cell; everything else (roofs, cars, props) points at a
// plain corner of the same texture, so all models share one material.

import { BufferGeometry, Float32BufferAttribute, Color } from 'three';
import { TYPES } from '../logic/objects.js';

const PLAIN = [0.03, 0.03];
const c = new Color();
const rgb = (hex) => {
  c.setHex(hex);
  return [c.r, c.g, c.b];
};
const shade = (hex, k) => {
  c.setHex(hex);
  return [Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k)];
};
const colour = (col) => (typeof col === 'number' ? rgb(col) : col);

class Parts {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.u = [];
  }

  /** One triangle. The normal is flat, flipped to agree with `hint` (the direction that is outside) when given. */
  tri(a, b, d, col, ua = PLAIN, ub = PLAIN, ud = PLAIN, hint = null) {
    let ex = b[0] - a[0];
    let ey = b[1] - a[1];
    let ez = b[2] - a[2];
    let fx = d[0] - a[0];
    let fy = d[1] - a[1];
    let fz = d[2] - a[2];
    let nx = ey * fz - ez * fy;
    let ny = ez * fx - ex * fz;
    let nz = ex * fy - ey * fx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len;
    ny /= len;
    nz /= len;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      this.tri(a, d, b, col, ua, ud, ub, null);
      return;
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
    for (let i = 0; i < 3; i++) {
      this.n.push(nx, ny, nz);
      this.c.push(col[0], col[1], col[2]);
    }
    this.u.push(ua[0], ua[1], ub[0], ub[1], ud[0], ud[1]);
  }

  quad(a, b, d, e, col, uv = null, hint = null) {
    const u = uv ?? [PLAIN, PLAIN, PLAIN, PLAIN];
    this.tri(a, b, d, col, u[0], u[1], u[2], hint);
    this.tri(a, d, e, col, u[0], u[2], u[3], hint);
  }

  /**
   * A box from its footprint centre and bottom. `win` tiles a window cell over the four walls ({ cw, ch }).
   * `top` and `bottom` colours default to `col`; `skipBottom` leaves the underside out.
   */
  box(cx, y0, cz, sx, sy, sz, col, { win = null, top = null, bottom = null, skipBottom = false, wall = null } = {}) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const y1 = y0 + sy;
    const cw = colour(wall ?? col);
    const ct = colour(top ?? col);
    const cb = colour(bottom ?? col);
    const uvFor = (w) => (win ? [[0, 0], [w / win.cw, 0], [w / win.cw, sy / win.ch], [0, sy / win.ch]] : null);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], cw, uvFor(sz), [1, 0, 0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], cw, uvFor(sz), [-1, 0, 0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], cw, uvFor(sx), [0, 0, 1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], cw, uvFor(sx), [0, 0, -1]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], ct, null, [0, 1, 0]);
    if (!skipBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], cb, null, [0, -1, 0]);
  }

  /**
   * A tapered cylinder; `rTop` 0 makes a cone. It stands from y0 up by h, or with `axis` 'x' / 'z' it lies down,
   * centred on (cx, y0, cz) and h long.
   */
  cyl(cx, y0, cz, rBottom, rTop, h, segs, col, { axis = 'y', cap = true } = {}) {
    const cc = colour(col);
    const P = (a, r, t) => {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (axis === 'z') return [cx + x, y0 + z, cz + (t - h / 2)];
      if (axis === 'x') return [cx + (t - h / 2), y0 + x, cz + z];
      return [cx + x, y0 + t, cz + z];
    };
    const mid = (t) => (axis === 'z' ? [cx, y0, cz + (t - h / 2)] : axis === 'x' ? [cx + (t - h / 2), y0, cz] : [cx, y0 + t, cz]);
    const up = centreDir(axis, 1);
    const down = centreDir(axis, -1);
    const centre = mid(h / 2);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const m = P((a0 + a1) / 2, 1, h / 2);
      const hint = [m[0] - centre[0], m[1] - centre[1], m[2] - centre[2]];
      const b0 = P(a0, rBottom, 0);
      const b1 = P(a1, rBottom, 0);
      const t0 = P(a0, rTop, h);
      const t1 = P(a1, rTop, h);
      if (rTop > 1e-6) this.quad(b0, b1, t1, t0, cc, null, hint);
      else this.tri(b0, b1, t0, cc, PLAIN, PLAIN, PLAIN, hint);
      if (cap) {
        if (rTop > 1e-6) this.tri(mid(h), t0, t1, cc, PLAIN, PLAIN, PLAIN, up);
        if (rBottom > 1e-6) this.tri(mid(0), b1, b0, cc, PLAIN, PLAIN, PLAIN, down);
      }
    }
  }

  /** A low-poly ball (optionally squashed in y). */
  sphere(cx, cy, cz, r, segsW, segsH, col, squash = 1) {
    const cc = colour(col);
    const at = (lat, lon) => {
      const phi = (lat / segsH) * Math.PI;
      const th = (lon / segsW) * Math.PI * 2;
      return [cx + Math.sin(phi) * Math.cos(th) * r, cy + Math.cos(phi) * r * squash, cz + Math.sin(phi) * Math.sin(th) * r];
    };
    for (let lat = 0; lat < segsH; lat++) {
      for (let lon = 0; lon < segsW; lon++) {
        const a = at(lat, lon);
        const b = at(lat, lon + 1);
        const d = at(lat + 1, lon + 1);
        const e = at(lat + 1, lon);
        const mx = (a[0] + b[0] + d[0] + e[0]) / 4 - cx;
        const my = (a[1] + b[1] + d[1] + e[1]) / 4 - cy;
        const mz = (a[2] + b[2] + d[2] + e[2]) / 4 - cz;
        const hint = [mx, my, mz];
        if (lat === 0) this.tri(a, d, e, cc, PLAIN, PLAIN, PLAIN, hint);
        else if (lat === segsH - 1) this.tri(a, b, d, cc, PLAIN, PLAIN, PLAIN, hint);
        else this.quad(a, b, d, e, cc, null, hint);
      }
    }
  }

  /** A flat ring (a stadium wall, a fountain rim): outer and inner walls and a top. */
  ring(cx, y0, cz, rOuter, rInner, h, segs, col, { top = null, inner = null } = {}) {
    const co = colour(col);
    const ct = colour(top ?? col);
    const ci = colour(inner ?? col);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const pt = (a, r, y) => [cx + Math.cos(a) * r, y0 + y, cz + Math.sin(a) * r];
      const out = [Math.cos(am), 0, Math.sin(am)];
      this.quad(pt(a0, rOuter, 0), pt(a1, rOuter, 0), pt(a1, rOuter, h), pt(a0, rOuter, h), co, null, out);
      this.quad(pt(a0, rInner, 0), pt(a1, rInner, 0), pt(a1, rInner, h), pt(a0, rInner, h), ci, null, [-out[0], 0, -out[2]]);
      this.quad(pt(a0, rInner, h), pt(a1, rInner, h), pt(a1, rOuter, h), pt(a0, rOuter, h), ct, null, [0, 1, 0]);
    }
  }

  /** A triangular prism roof: ridge along x (or z with alongZ), `w` wide at the eaves, `rise` tall. */
  roof(cx, y0, cz, length, w, rise, col, { alongZ = false, overhang = 0.25 } = {}) {
    const cc = colour(col);
    const hl = length / 2 + overhang;
    const hw = w / 2 + overhang;
    const peak = y0 + rise;
    const P = (x, y, z) => (alongZ ? [cx + z, y, cz + x] : [cx + x, y, cz + z]);
    const len = Math.hypot(hw, rise);
    const slopeA = alongZ ? [rise / len, hw / len, 0] : [0, hw / len, rise / len];
    const slopeB = alongZ ? [-rise / len, hw / len, 0] : [0, hw / len, -rise / len];
    this.quad(P(-hl, y0, hw), P(hl, y0, hw), P(hl, peak, 0), P(-hl, peak, 0), cc, null, slopeA);
    this.quad(P(hl, y0, -hw), P(-hl, y0, -hw), P(-hl, peak, 0), P(hl, peak, 0), cc, null, slopeB);
    this.tri(P(hl, y0, hw), P(hl, y0, -hw), P(hl, peak, 0), cc, PLAIN, PLAIN, PLAIN, alongZ ? [0, 0, 1] : [1, 0, 0]);
    this.tri(P(-hl, y0, -hw), P(-hl, y0, hw), P(-hl, peak, 0), cc, PLAIN, PLAIN, PLAIN, alongZ ? [0, 0, -1] : [-1, 0, 0]);
  }

  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.u, 2));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function centreDir(axis, sign) {
  if (axis === 'z') return [0, 0, sign];
  if (axis === 'x') return [sign, 0, 0];
  return [0, sign, 0];
}

// ----------------------------------------------------------------------------------------------------------- the models

const DARK = 0x262b36;
const GLASS = 0x1d2b3d;
const WOOD = 0x9a6b3f;

const CAR_COLOURS = [0xe0323f, 0x2f6fe0, 0xf2c01d, 0xe9edf2, 0x1fb59b];
const SHIRTS = [0xff5a36, 0x2f9bff, 0xf2d12e, 0x9a5cff];
const SKINS = [0xf1c7a2, 0xc68e63, 0x8d5a3b, 0xf3d6bd];
const HAIR = [0x2b2118, 0x4a2f1c, 0x15151a, 0xc9a24a];

const BUILDERS = {
  cone() {
    const p = new Parts();
    p.box(0, 0, 0, 0.66, 0.05, 0.66, 0xdd5a10);
    p.cyl(0, 0.05, 0, 0.27, 0.06, 0.78, 8, 0xff7a1a);
    p.cyl(0, 0.34, 0, 0.19, 0.155, 0.17, 8, 0xf4f4f4);
    return p;
  },
  hydrant() {
    const p = new Parts();
    p.cyl(0, 0, 0, 0.22, 0.2, 0.1, 8, 0xb02a22);
    p.cyl(0, 0.1, 0, 0.17, 0.16, 0.5, 8, 0xe03a2f);
    p.sphere(0, 0.6, 0, 0.17, 6, 4, 0xe03a2f);
    p.box(0, 0.36, 0, 0.56, 0.1, 0.1, 0xc22f26);
    p.cyl(0, 0.36, 0.2, 0.06, 0.06, 0.12, 6, 0xffd23f, { axis: 'z' });
    return p;
  },
  trash() {
    const p = new Parts();
    p.cyl(0, 0, 0, 0.28, 0.32, 0.82, 8, 0x4c6a58);
    p.cyl(0, 0.82, 0, 0.34, 0.34, 0.08, 8, 0x2f4439);
    return p;
  },
  mailbox() {
    const p = new Parts();
    p.box(0, 0, 0, 0.12, 0.7, 0.12, DARK);
    p.box(0, 0.7, 0, 0.6, 0.42, 0.4, 0x2d6bd1);
    p.box(0, 1.12, 0, 0.64, 0.08, 0.44, 0x1f4f9e);
    return p;
  },
  lamp() {
    const p = new Parts();
    p.cyl(0, 0, 0, 0.17, 0.12, 0.3, 8, 0x3b4252);
    p.cyl(0, 0.3, 0, 0.07, 0.06, 3.4, 6, 0x3b4252);
    p.box(0.42, 3.62, 0, 0.9, 0.07, 0.09, 0x3b4252);
    p.box(0.85, 3.52, 0, 0.42, 0.12, 0.26, 0xfff0a8);
    return p;
  },
  person(i) {
    const p = new Parts();
    const shirt = SHIRTS[i % 4];
    const skin = SKINS[(i + 1) % 4];
    p.box(-0.1, 0, 0, 0.17, 0.72, 0.19, 0x2a2f45);
    p.box(0.1, 0, 0, 0.17, 0.72, 0.19, 0x232840);
    p.box(0, 0.7, 0, 0.46, 0.66, 0.28, shirt);
    p.box(-0.3, 0.76, 0, 0.11, 0.56, 0.14, shade(shirt, 0.8));
    p.box(0.3, 0.76, 0, 0.11, 0.56, 0.14, shade(shirt, 0.8));
    p.sphere(0, 1.55, 0, 0.21, 6, 4, skin);
    p.box(0, 1.62, -0.03, 0.4, 0.13, 0.4, HAIR[i % 4], { skipBottom: true });
    return p;
  },
  bench() {
    const p = new Parts();
    p.box(0, 0.42, 0, 1.7, 0.1, 0.52, WOOD);
    p.box(0, 0.62, -0.24, 1.7, 0.5, 0.08, 0x84582f);
    p.box(-0.68, 0, 0, 0.1, 0.44, 0.5, 0x333a46);
    p.box(0.68, 0, 0, 0.1, 0.44, 0.5, 0x333a46);
    return p;
  },
  bike() {
    const p = new Parts();
    p.cyl(-0.52, 0.38, 0, 0.38, 0.38, 0.07, 10, 0x1b1e26, { axis: 'z' });
    p.cyl(0.52, 0.38, 0, 0.38, 0.38, 0.07, 10, 0x1b1e26, { axis: 'z' });
    p.box(0, 0.66, 0, 1.0, 0.07, 0.07, 0x19d3ff);
    p.box(-0.16, 0.5, 0, 0.07, 0.4, 0.07, 0x19d3ff);
    p.box(0.46, 0.7, 0, 0.07, 0.42, 0.07, 0x19d3ff);
    p.box(-0.3, 0.88, 0, 0.3, 0.07, 0.16, DARK);
    p.box(0.46, 0.96, 0, 0.1, 0.07, 0.5, DARK);
    return p;
  },
  bush() {
    const p = new Parts();
    p.sphere(0, 0.46, 0, 0.62, 6, 4, 0x3f9a4a, 0.85);
    p.sphere(0.28, 0.62, 0.1, 0.4, 5, 3, 0x58b45b, 0.9);
    return p;
  },
  crate() {
    const p = new Parts();
    p.box(0, 0, 0, 1.15, 0.95, 1.15, 0xb07a45);
    p.box(0.1, 0.95, 0, 0.7, 0.6, 0.7, 0xc78d53);
    p.box(0, 0.4, 0, 1.2, 0.1, 1.2, 0x8c5e32);
    return p;
  },
  tree() {
    const p = new Parts();
    p.cyl(0, 0, 0, 0.26, 0.2, 1.8, 6, 0x6b4a2f);
    p.sphere(0, 2.9, 0, 1.3, 7, 5, 0x49a84f, 0.9);
    p.sphere(0.35, 3.8, -0.2, 0.9, 6, 4, 0x6bc35a, 0.9);
    return p;
  },
  pine() {
    const p = new Parts();
    p.cyl(0, 0, 0, 0.22, 0.18, 1.1, 6, 0x5d4129);
    p.cyl(0, 0.9, 0, 1.3, 0.05, 1.9, 8, 0x2f7d4a, { cap: false });
    p.cyl(0, 2.2, 0, 1.0, 0.05, 1.7, 8, 0x37894f, { cap: false });
    p.cyl(0, 3.4, 0, 0.7, 0.04, 1.5, 8, 0x429a5a, { cap: false });
    return p;
  },
  car(i) {
    const p = new Parts();
    const body = CAR_COLOURS[i % CAR_COLOURS.length];
    for (const x of [-1.05, 1.05]) for (const z of [-0.84, 0.84]) p.cyl(x, 0.36, z, 0.36, 0.36, 0.26, 8, 0x16181f, { axis: 'z' });
    p.box(0, 0.28, 0, 3.5, 0.62, 1.78, body);
    p.box(-0.1, 0.9, 0, 1.95, 0.56, 1.52, GLASS);
    p.box(-0.1, 1.46, 0, 1.75, 0.09, 1.46, shade(body, 0.9), { skipBottom: true });
    p.box(1.77, 0.5, 0.55, 0.06, 0.14, 0.3, 0xfff2b0);
    p.box(1.77, 0.5, -0.55, 0.06, 0.14, 0.3, 0xfff2b0);
    p.box(-1.77, 0.5, 0.55, 0.06, 0.14, 0.3, 0xd7263d);
    p.box(-1.77, 0.5, -0.55, 0.06, 0.14, 0.3, 0xd7263d);
    return p;
  },
  kiosk() {
    const p = new Parts();
    p.box(0, 0, 0, 2.6, 2.1, 2.2, 0xf0b429);
    p.box(0, 0.9, 1.1, 2.0, 0.85, 0.06, GLASS);
    p.box(0, 1.8, 1.55, 3.1, 0.1, 1.1, 0xe03a2f);
    p.box(0, 2.1, 0, 3.0, 0.14, 2.6, 0xf4f4f4);
    p.box(0, 0.8, 1.45, 2.2, 0.08, 0.5, 0xb88a1f);
    return p;
  },
  fountain() {
    const p = new Parts();
    p.ring(0, 0, 0, 2.5, 2.1, 0.62, 16, 0xcfd3d8, { top: 0xe6e9ec, inner: 0xaeb4bb });
    p.cyl(0, 0, 0, 2.1, 2.1, 0.42, 16, 0x39a7e8);
    p.cyl(0, 0, 0, 0.4, 0.34, 1.5, 8, 0xcfd3d8);
    p.cyl(0, 1.3, 0, 0.95, 0.85, 0.28, 10, 0xe6e9ec);
    p.cyl(0, 1.58, 0, 0.8, 0.8, 0.06, 10, 0x59b8f0);
    p.sphere(0, 1.9, 0, 0.3, 6, 4, 0x9bd8ff);
    return p;
  },
  bus() {
    const p = new Parts();
    for (const x of [-1.9, 1.9]) for (const z of [-1.1, 1.1]) p.cyl(x, 0.5, z, 0.5, 0.5, 0.34, 10, 0x16181f, { axis: 'z' });
    p.box(0, 0.35, 0, 6.3, 2.3, 2.5, 0x2d9cdb);
    p.box(0, 1.5, 0, 6.34, 0.9, 2.54, GLASS);
    p.box(0, 0.9, 0, 6.34, 0.16, 2.54, 0xf4f4f4);
    p.box(0, 2.62, 0, 6.3, 0.14, 2.5, 0xf4f4f4, { skipBottom: true });
    p.box(3.16, 0.7, 0, 0.06, 0.4, 2.1, 0xfff2b0);
    p.box(-3.16, 0.7, 0, 0.06, 0.3, 2.1, 0xd7263d);
    return p;
  },
  house(i) {
    const p = new Parts();
    const walls = [0xf3e6c8, 0xc9dcec, 0xd9c3a5][i % 3];
    const roofs = [0xb5412e, 0x3b4a66, 0x6b3b2a][i % 3];
    const win = { cw: 1.45, ch: 1.35 };
    p.box(0, 0, 0, 4.2, 2.7, 4.2, walls, { win, top: walls, skipBottom: true });
    p.roof(0, 2.7, 0, 4.2, 4.2, 1.7, roofs, { alongZ: i % 2 === 1 });
    p.box(0.9, 0, 2.12, 0.85, 1.55, 0.1, DARK);
    p.box(-1.1, 2.9, -0.6, 0.5, 1.7, 0.5, 0x7a4b3a);
    p.box(0, 0, 2.55, 2.6, 0.12, 0.8, 0xbfb6a6);
    return p;
  },
  shop(i) {
    const p = new Parts();
    const walls = [0xe9824a, 0x4aa5a0][i % 2];
    const awning = [0xf4f4f4, 0xe03a2f][i % 2];
    const win = { cw: 1.5, ch: 1.55 };
    p.box(0, 0, 0, 5.4, 3.7, 4.6, walls, { win, skipBottom: true });
    p.box(0, 0.25, 2.32, 4.6, 1.35, 0.08, GLASS);
    for (let k = 0; k < 6; k++) p.box(-2.1 + k * 0.84, 1.75, 2.75, 0.42, 0.1, 1.0, k % 2 ? awning : shade(awning, 0.7));
    p.box(0, 3.7, 0, 5.6, 0.25, 4.8, 0x3a4150, { skipBottom: true });
    p.box(0, 3.95, 2.3, 3.2, 0.7, 0.14, awning === 0xf4f4f4 ? 0x2d6bd1 : 0xf4f4f4);
    return p;
  },
  apt(i) {
    const p = new Parts();
    const walls = [0xd8d2c4, 0xb8c4d6, 0xe3b79b][i % 3];
    const h = [9.5, 11.5, 13][i % 3];
    const win = { cw: 1.4, ch: 1.55 };
    p.box(0, 0, 0, 6.2, h, 6.2, walls, { win, skipBottom: true });
    p.box(0, h, 0, 6.5, 0.35, 6.5, 0x4a5262, { skipBottom: true });
    p.box(-1.2, h + 0.35, 0.8, 1.9, 1.0, 1.9, 0x8892a2);
    p.box(1.6, h + 0.35, -1.5, 1.0, 0.7, 1.0, 0x6d7686);
    p.box(0, 0, 3.14, 1.4, 1.9, 0.1, DARK);
    return p;
  },
  office(i) {
    const p = new Parts();
    const walls = [0x9fb8cc, 0xcfd6dd, 0x6f8fb0][i % 3];
    const h = [17, 21, 25][i % 3];
    const win = { cw: 1.3, ch: 1.7 };
    p.box(0, 0, 0, 7.6, 2.0, 7.6, shade(walls, 0.7), { skipBottom: true });
    p.box(0, 2.0, 0, 7.0, h - 2.0, 7.0, walls, { win, skipBottom: true });
    p.box(0, h, 0, 5.2, 3.2, 5.2, shade(walls, 0.92), { win: { cw: 1.3, ch: 1.6 }, skipBottom: true });
    p.box(0, h + 3.2, 0, 5.4, 0.25, 5.4, 0x3a4150, { skipBottom: true });
    p.cyl(0.8, h + 3.45, -0.6, 0.09, 0.05, 3.4, 5, 0xd7263d);
    p.box(-1.2, h + 3.45, 1.0, 1.4, 0.8, 1.4, 0x8892a2);
    return p;
  },
  stadium() {
    const p = new Parts();
    p.ring(0, 0, 0, 6.9, 5.1, 3.6, 16, 0xe8e3d6, { top: 0xf7f3ea, inner: 0x2f5fa0 });
    p.ring(0, 0, 0, 5.6, 4.8, 2.3, 16, 0x2f5fa0, { top: 0x3d73bd, inner: 0x2a528c });
    p.cyl(0, 0, 0, 4.85, 4.85, 0.35, 16, 0x3f9d4e);
    p.box(0, 0.35, 0, 0.12, 0.02, 7.0, 0xf4f4f4, { skipBottom: true });
    p.box(0, 0.35, 0, 4.6, 0.02, 0.12, 0xf4f4f4, { skipBottom: true });
    p.ring(0, 3.6, 0, 7.1, 5.4, 0.3, 16, 0xff3b5c, { top: 0xff6b82, inner: 0xd7263d });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const x = Math.cos(a) * 6.5;
      const z = Math.sin(a) * 6.5;
      p.cyl(x, 0, z, 0.2, 0.14, 8.6, 6, 0x59606e);
      p.box(x, 8.4, z, 1.1, 0.5, 0.6, 0xfff0a8);
    }
    return p;
  },
  landmark() {
    const p = new Parts();
    p.cyl(0, 0, 0, 7.4, 6.6, 1.1, 16, 0xd9d7d0);
    p.cyl(0, 1.1, 0, 5.2, 4.8, 1.0, 16, 0xece9e1);
    p.cyl(0, 2.1, 0, 2.8, 1.15, 26, 6, 0xf3f1ea, { cap: false });
    p.cyl(0, 11.5, 0, 2.15, 2.1, 0.8, 6, 0x19d3ff);
    p.cyl(0, 5.5, 0, 2.55, 2.5, 0.6, 6, 0xd7263d);
    p.cyl(0, 24.4, 0, 3.6, 4.6, 1.6, 12, GLASS);
    p.cyl(0, 26.0, 0, 4.9, 4.9, 0.4, 12, 0xf4f4f4);
    p.cyl(0, 24.0, 0, 3.4, 3.6, 0.4, 12, 0x19d3ff);
    p.cyl(0, 26.4, 0, 2.2, 1.6, 1.4, 10, GLASS);
    p.cyl(0, 27.8, 0, 2.4, 2.4, 0.25, 10, 0xf4f4f4);
    p.cyl(0, 28.0, 0, 0.55, 0.06, 11, 6, 0xf3f1ea);
    p.cyl(0, 33.0, 0, 0.3, 0.2, 1.2, 6, 0xd7263d);
    return p;
  },
};

/** The builder for a type's id ('car3' is the car builder with variant 3). */
function builderFor(id) {
  const m = /^([a-z]+?)(\d*)$/.exec(id);
  const base = m[1];
  const n = m[2] === '' ? 0 : Number(m[2]);
  const fn = BUILDERS[base];
  if (!fn) throw new Error(`no model for ${id}`);
  return () => fn(n);
}

/** One geometry per type, plus how tall it stands. Cached: a geometry is shared by every city. */
let cache = null;
export function buildModels() {
  if (cache) return cache;
  cache = TYPES.map((t) => {
    const geometry = builderFor(t.id)().geometry();
    return { type: t.index, id: t.id, geometry, height: geometry.boundingBox.max.y, tris: geometry.attributes.position.count / 3 };
  });
  return cache;
}

export { Parts };
