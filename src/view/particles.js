// Dust, debris and sparks (one Points object with a tiny shader) and ring pulses (a few flat rings).
// Nothing allocates per frame: particles live in typed arrays and are reused.

import { BufferGeometry, Float32BufferAttribute, DynamicDrawUsage, ShaderMaterial, Points, Color, Mesh, RingGeometry, MeshBasicMaterial, DoubleSide } from 'three';

const VERT = `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = (1.0 - smoothstep(0.28, 0.5, d)) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const tmp = new Color();

export class Particles {
  constructor(parent, capacity = 900) {
    this.cap = capacity;
    this.budget = capacity;
    this.n = 0;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.c0 = new Float32Array(capacity * 3);
    const g = new BufferGeometry();
    this.attrPos = new Float32BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.attrCol = new Float32BufferAttribute(this.col, 4).setUsage(DynamicDrawUsage);
    this.attrSize = new Float32BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.attrPos);
    g.setAttribute('aColor', this.attrCol);
    g.setAttribute('aSize', this.attrSize);
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 600 } };
    this.material = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    parent.add(this.points);
  }

  /** How many particles at once: scaled by graphics quality. */
  setBudget(n) {
    this.budget = Math.max(0, Math.min(this.cap, n | 0));
    if (this.n > this.budget) this.n = this.budget;
  }

  clear() {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  emit(x, y, z, vx, vy, vz, life, size0, size1, hex, gravity = 9, drag = 1.2, alpha = 1) {
    if (this.budget === 0) return;
    let i = this.n;
    if (i >= this.budget) i = Math.floor(Math.random() * this.budget); // full: overwrite one at random
    else this.n++;
    tmp.setHex(hex);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.a0[i] = alpha;
    this.size[i] = size0;
    this.c0[i * 3] = tmp.r;
    this.c0[i * 3 + 1] = tmp.g;
    this.c0[i * 3 + 2] = tmp.b;
    this.col[i * 4] = tmp.r;
    this.col[i * 4 + 1] = tmp.g;
    this.col[i * 4 + 2] = tmp.b;
    this.col[i * 4 + 3] = alpha;
  }

  /** A burst of chips thrown up and out: `power` scales how far, `count` how many (the quality budget scales it down). */
  burst(x, y, z, hex, power = 1, count = 12, up = 4) {
    const n = Math.max(2, Math.round(count * Math.min(1, this.budget / 500 + 0.3)));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 3.5) * power;
      this.emit(x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2, Math.cos(a) * sp, up * (0.4 + Math.random()) * Math.sqrt(power), Math.sin(a) * sp, 0.5 + Math.random() * 0.5, 0.22 * power + 0.12, 0.02, hex, 11, 1.4);
    }
  }

  /** Soft dust drifting up. */
  puff(x, y, z, hex, power = 1, count = 6) {
    const n = Math.max(1, Math.round(count * Math.min(1, this.budget / 500 + 0.3)));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 1.2) * power;
      this.emit(x, y, z, Math.cos(a) * sp, 1.2 + Math.random() * 1.6, Math.sin(a) * sp, 0.7 + Math.random() * 0.5, 0.35 * power + 0.15, 0.9 * power + 0.3, hex, -0.4, 1.8, 0.55);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = this.n - 1;
        if (i !== last) this.copy(last, i);
        this.n--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const left = this.life[i] / this.max[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - left);
      this.col[i * 4] = this.c0[i * 3];
      this.col[i * 4 + 1] = this.c0[i * 3 + 1];
      this.col[i * 4 + 2] = this.c0[i * 3 + 2];
      this.col[i * 4 + 3] = Math.min(1, left * 2.2) * this.a0[i];
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.attrPos.needsUpdate = true;
    this.attrCol.needsUpdate = true;
    this.attrSize.needsUpdate = true;
  }

  copy(from, to) {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
      this.c0[to * 3 + k] = this.c0[from * 3 + k];
    }
    this.life[to] = this.life[from];
    this.max[to] = this.max[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.size[to] = this.size[from];
  }
}

/** A few flat rings that grow and fade: the pulse when a hole grows, a shockwave when one is swallowed. */
export class RingPulses {
  constructor(parent, count = 8) {
    const geo = new RingGeometry(0.94, 1, 56);
    geo.rotateX(-Math.PI / 2);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, fog: false, toneMapped: false });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      parent.add(mesh);
      this.items.push({ mesh, mat, t: 0, life: 0, r0: 1, r1: 2 });
    }
    this.next = 0;
  }

  emit(x, z, r0, r1, hex, life = 0.6) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.t = 0;
    it.life = life;
    it.r0 = r0;
    it.r1 = r1;
    it.mat.color.setHex(hex);
    it.mesh.position.set(x, 0.22, z);
    it.mesh.scale.set(r0, 1, r0);
    it.mesh.visible = true;
    return it;
  }

  clear() {
    for (const it of this.items) {
      it.life = 0;
      it.mesh.visible = false;
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt;
      const p = it.t / it.life;
      if (p >= 1) {
        it.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - p) * (1 - p);
      const r = it.r0 + (it.r1 - it.r0) * e;
      it.mesh.scale.set(r, 1, r);
      it.mat.opacity = 0.9 * (1 - p);
    }
  }
}
