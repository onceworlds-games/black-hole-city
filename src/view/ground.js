// The ground of a city as one merged mesh: flat colours on boxes, no textures. Every fragment inside a hole is discarded,
// so a hole is a real opening onto the dark pit under the city.

import { BufferGeometry, Float32BufferAttribute, Color, MeshStandardMaterial, Vector3 } from 'three';

export const HOLE_SLOTS = 10;

const KIND_COLOURS = {
  outer: 0x2b3340,
  asphalt: 0x4d5461,
  walk: 0xc4c8cf,
  grass: 0x5db34b,
  paved: 0xd8d3c6,
  paved2: 0xc9c3b5,
  path: 0xe3d8bd,
  lot: 0x383e4a,
  water: 0x3aa7e0,
  mark_w: 0xf3f3f3,
  mark_y: 0xffc83a,
  wall: 0x8b92a1,
};
const SPLIT = { grass: 4.25, lot: 4.25, paved: 4.25, outer: 0 };
const c = new Color();

function hash(x, z) {
  let h = Math.imul(Math.round(x * 4) | 0, 374761393) ^ Math.imul(Math.round(z * 4) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A BufferGeometry from the city's ground rectangles. */
export function buildGround(rects) {
  const p = [];
  const n = [];
  const col = [];
  const face = (a, b, d, e, nx, ny, nz, r, g, bl) => {
    p.push(...a, ...b, ...d, ...a, ...d, ...e);
    for (let i = 0; i < 6; i++) {
      n.push(nx, ny, nz);
      col.push(r, g, bl);
    }
  };
  const box = (x0, z0, x1, z1, top, bot, flat, rgb, k) => {
    const [r, g, b] = rgb;
    const tr = r * k;
    const tg = g * k;
    const tb = b * k;
    face([x0, top, z1], [x1, top, z1], [x1, top, z0], [x0, top, z0], 0, 1, 0, tr, tg, tb);
    if (flat) return;
    const sr = r * 0.78;
    const sg = g * 0.78;
    const sb = b * 0.78;
    face([x0, bot, z1], [x1, bot, z1], [x1, top, z1], [x0, top, z1], 0, 0, 1, sr, sg, sb);
    face([x1, bot, z0], [x0, bot, z0], [x0, top, z0], [x1, top, z0], 0, 0, -1, sr, sg, sb);
    face([x1, bot, z1], [x1, bot, z0], [x1, top, z0], [x1, top, z1], 1, 0, 0, sr, sg, sb);
    face([x0, bot, z0], [x0, bot, z1], [x0, top, z1], [x0, top, z0], -1, 0, 0, sr, sg, sb);
  };
  for (const r of rects) {
    c.setHex(KIND_COLOURS[r.kind] ?? 0xff00ff);
    const rgb = [c.r, c.g, c.b];
    const split = SPLIT[r.kind] ?? 0;
    if (split > 0 && r.x1 - r.x0 > split * 1.5) {
      const nx = Math.max(1, Math.round((r.x1 - r.x0) / split));
      const nz = Math.max(1, Math.round((r.z1 - r.z0) / split));
      const dx = (r.x1 - r.x0) / nx;
      const dz = (r.z1 - r.z0) / nz;
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x0 = r.x0 + i * dx;
          const z0 = r.z0 + j * dz;
          box(x0, z0, x0 + dx, z0 + dz, r.top, r.bot, r.flat, rgb, 0.93 + hash(x0, z0) * 0.12);
        }
      }
    } else box(r.x0, r.z0, r.x1, r.z1, r.top, r.bot, r.flat, rgb, 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new Float32BufferAttribute(n, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** The uniform every ground-like material shares: up to ten holes as (x, z, radius). */
export function makeHoleUniform() {
  return { value: Array.from({ length: HOLE_SLOTS }, () => new Vector3(0, 0, 0)) };
}

/** Standard material that throws away whatever lies inside a hole. */
export function makeGroundMaterial(holeUniform) {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHoles = holeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHoleXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoleXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uHoles[${HOLE_SLOTS}];\nvarying vec2 vHoleXZ;`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        for (int i = 0; i < ${HOLE_SLOTS}; i++) {
          vec3 hole = uHoles[i];
          vec2 hd = vHoleXZ - hole.xy;
          if (hole.z > 0.0 && dot(hd, hd) < hole.z * hole.z) discard;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'bhc-ground';
  return m;
}
