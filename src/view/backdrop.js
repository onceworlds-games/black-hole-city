// A ring of far-off buildings beyond the walls, so the playfield sits in a bigger city. One merged mesh, never eaten.

import { Mesh } from 'three';
import { Parts } from './models.js';
import { mulberry32 } from '../logic/rng.js';

const TINTS = [0x8393ab, 0x9aa7bd, 0x7c8aa3, 0xa5b0c2, 0x6f7f9a];

export function buildBackdrop(half, material) {
  const rng = mulberry32(777 + Math.round(half));
  const p = new Parts();
  const inner = half + 8;
  const outer = half + 95;
  const count = Math.round(70 + half * 1.6);
  for (let k = 0; k < count; k++) {
    const x = (rng() * 2 - 1) * outer;
    const z = (rng() * 2 - 1) * outer;
    if (Math.abs(x) < inner && Math.abs(z) < inner) continue;
    const w = 6 + rng() * 9;
    const d = 6 + rng() * 9;
    const h = 8 + Math.pow(rng(), 1.6) * 44;
    const tint = TINTS[Math.floor(rng() * TINTS.length)];
    p.box(x, -0.1, z, w, h, d, tint, { win: { cw: 1.5, ch: 1.8 }, skipBottom: true });
  }
  const mesh = new Mesh(p.geometry(), material);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
