// The holes themselves: a dark pit under the ground (its walls fade to black), a bright rim in the player's colour,
// and a soft glow round the rim. The ground is cut open by the shader; these fill what you see through the opening.

import { Group, Mesh, CylinderGeometry, RingGeometry, PlaneGeometry, MeshBasicMaterial, BackSide, AdditiveBlending, Float32BufferAttribute, DoubleSide } from 'three';
import { haloTexture } from './textures.js';
import { HOLE_SLOTS } from './ground.js';
import { SEAT_COLORS } from '../logic/config.js';

const SEGS = 44;

function wallGeometry() {
  // unit radius, unit height hanging from y = 0 down to y = -1 (each hole scales it); vertex colour fades from dim grey to black
  const g = new CylinderGeometry(1, 1, 1, SEGS, 10, false);
  g.translate(0, -0.5, 0);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const depth = Math.min(1, Math.max(0, -pos.getY(i)));
    const v = Math.pow(1 - depth, 3.2) * 0.6;
    col[i * 3] = v;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

export class Holes {
  constructor(scene, uniform) {
    this.uniform = uniform;
    this.group = new Group();
    scene.add(this.group);
    const wallGeo = wallGeometry();
    const rimGeo = new RingGeometry(0.98, 1.1, SEGS);
    rimGeo.rotateX(-Math.PI / 2);
    const meGeo = new RingGeometry(1.22, 1.3, SEGS);
    meGeo.rotateX(-Math.PI / 2);
    const haloGeo = new PlaneGeometry(4, 4);
    haloGeo.rotateX(-Math.PI / 2);
    const halo = haloTexture();
    this.items = [];
    for (let i = 0; i < HOLE_SLOTS; i++) {
      const root = new Group();
      const wallMat = new MeshBasicMaterial({ vertexColors: true, color: 0xffffff, side: BackSide, fog: false });
      const wall = new Mesh(wallGeo, wallMat);
      wall.position.y = 0.2;
      wall.renderOrder = 1;
      const rimMat = new MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, side: DoubleSide });
      const rim = new Mesh(rimGeo, rimMat);
      rim.position.y = 0.2;
      rim.renderOrder = 3;
      const meMat = new MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, side: DoubleSide, transparent: true, opacity: 0.9, depthWrite: false });
      const me = new Mesh(meGeo, meMat);
      me.position.y = 0.21;
      me.visible = false;
      me.renderOrder = 3;
      const haloMat = new MeshBasicMaterial({ map: halo, color: 0xffffff, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, toneMapped: false });
      const glow = new Mesh(haloGeo, haloMat);
      glow.position.y = 0.19;
      glow.renderOrder = 2;
      root.add(wall, rim, me, glow);
      root.visible = false;
      this.group.add(root);
      this.items.push({ root, wall, rim, me, glow, wallMat, rimMat, meMat, haloMat, hex: -1 });
    }
  }

  /**
   * views: [{ x, z, R, scale, alive, seat, me, protect }] in seat order. A hole that isn't alive is hidden and its slot
   * in the ground shader is switched off.
   */
  update(views, t) {
    const u = this.uniform.value;
    for (let i = 0; i < HOLE_SLOTS; i++) {
      const it = this.items[i];
      const v = views[i];
      if (!v || !v.alive || !(v.R > 0.05) || !(v.scale > 0.02)) {
        it.root.visible = false;
        u[i].set(0, 0, 0);
        continue;
      }
      const R = v.R * v.scale;
      const hex = SEAT_COLORS[v.seat % SEAT_COLORS.length];
      if (it.hex !== hex) {
        it.hex = hex;
        it.rimMat.color.setHex(hex);
        it.meMat.color.setHex(0xffffff);
        it.haloMat.color.setHex(hex);
        it.wallMat.color.setHex(hex).lerp(it.wallMat.color.clone().setHex(0xffffff), 0.35);
      }
      const depth = 14 + R * 4.2;
      it.root.visible = true;
      it.root.position.set(v.x, 0, v.z);
      it.root.scale.set(R, 1, R);
      it.wall.scale.set(1.025, depth, 1.025);
      it.me.visible = !!v.me;
      if (v.me) it.me.scale.set(1 + Math.sin(t * 4) * 0.02, 1, 1 + Math.sin(t * 4) * 0.02);
      it.rim.visible = !v.protect || Math.floor(t * 10) % 2 === 0;
      u[i].set(v.x, v.z, R);
    }
  }

  hideAll() {
    for (let i = 0; i < HOLE_SLOTS; i++) {
      this.items[i].root.visible = false;
      this.uniform.value[i].set(0, 0, 0);
    }
  }
}
