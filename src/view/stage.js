// The renderer, scene, lights and the camera that follows a hole. Everything about getting the picture onto the canvas.

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  DirectionalLight,
  HemisphereLight,
  Fog,
  Color,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  PCFShadowMap,
  Vector3,
} from 'three';
import { CityView } from './cityview.js';
import { Holes } from './holes.js';
import { Particles, RingPulses } from './particles.js';
import { buildBackdrop } from './backdrop.js';
import { makeHoleUniform } from './ground.js';
import { damp } from '../logic/rules.js';

export const FOV = 38;
export const PITCH = (55 * Math.PI) / 180;
const TAN = Math.tan((FOV * Math.PI) / 360);
export const TAN_HALF = TAN;

const MOODS = {
  day: { bg: 0x9fcbee, sun: 0xfff0d2, sunI: 2.9, dir: [-0.55, 1, 0.45], sky: 0xc4ddff, ground: 0x6f7b5b, hemiI: 1.15, exposure: 1.0 },
  sunset: { bg: 0xf29a68, sun: 0xff9c52, sunI: 2.7, dir: [-1.0, 0.5, 0.3], sky: 0xffb890, ground: 0x5a4a6e, hemiI: 0.95, exposure: 1.0 },
};

/** How far the camera stands from the hole so the hole is about a sixth of the screen's width. */
export function distanceFor(R, aspect) {
  return (6 * R) / (TAN * Math.max(1.15, Math.min(2.2, aspect)));
}

export class Stage {
  constructor(canvas, { quality = 'high', preserve = false, pixelRatio = 1, renderer = null } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    // `renderer` lets the tests hand in a stand-in: nothing here needs a GPU until render()
    this.renderer = renderer ?? new WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: preserve, alpha: false });
    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.shadowMap.type = PCFShadowMap;
    r.setPixelRatio(pixelRatio);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(FOV, 16 / 9, 2, 800);
    this.mood = 'day';

    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.camera.near = 1;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(0xffffff, 0x777777, 1);
    this.scene.add(this.hemi);
    this.scene.fog = new Fog(0x9fcbee, 100, 600);
    this.scene.background = new Color(0x9fcbee);

    this.holeUniform = makeHoleUniform();
    this.city = new CityView(this.scene, this.holeUniform);
    this.holes = new Holes(this.scene, this.holeUniform);
    this.particles = new Particles(this.scene);
    this.rings = new RingPulses(this.scene);
    this.backdrop = null;
    this.backdropHalf = -1;

    // camera state
    this.x = 0;
    this.z = 0;
    this.dist = 14;
    this.trauma = 0;
    this.pitch = PITCH;
    this.width = 1;
    this.height = 1;
    this.aspect = 16 / 9;
    this.shadowExt = 0;
    this.shadowSize = 0;
    this.reduced = false;
    this.time = 0;
    this.setMood('day');
    this.setQuality(quality);
  }

  setMood(name) {
    const m = MOODS[name] ?? MOODS.day;
    this.mood = name;
    this.sun.color.setHex(m.sun);
    this.sun.intensity = m.sunI;
    this.sunDir = new Vector3(...m.dir).normalize();
    this.hemi.color.setHex(m.sky);
    this.hemi.groundColor.setHex(m.ground);
    this.hemi.intensity = m.hemiI;
    this.scene.fog.color.setHex(m.bg);
    this.scene.background.setHex(m.bg);
    this.renderer.toneMappingExposure = m.exposure;
  }

  /** 'low' draws no shadows; 'medium' and 'high' draw them with bigger maps. */
  setQuality(q) {
    this.quality = q;
    const size = q === 'high' ? 2048 : q === 'medium' ? 1024 : 0;
    const was = this.shadowSize;
    this.shadowSize = size;
    this.renderer.shadowMap.enabled = size > 0;
    this.sun.castShadow = size > 0;
    if (size > 0 && was !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    if (was !== size) {
      this.city.material.needsUpdate = true;
      this.city.groundMaterial.needsUpdate = true;
    }
    this.particles.setBudget(q === 'high' ? 900 : q === 'medium' ? 450 : 160);
    this.shadowExt = 0;
  }

  resize(width, height, pixelRatio) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.aspect = this.width / this.height;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Loads a city into the scene (and the backdrop that goes with its size). */
  loadCity(city) {
    this.city.load(city);
    if (this.backdropHalf !== city.half) {
      if (this.backdrop) {
        this.scene.remove(this.backdrop);
        this.backdrop.geometry.dispose();
      }
      this.backdrop = buildBackdrop(city.half, this.city.material);
      this.scene.add(this.backdrop);
      this.backdropHalf = city.half;
    }
    this.particles.clear();
    this.rings.clear();
  }

  addTrauma(amount) {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Puts the camera on a point right now. */
  snap(x, z, R, boost = 1) {
    this.x = x;
    this.z = z;
    this.dist = distanceFor(R, this.aspect) * boost;
  }

  /** Eases the camera toward a point and a hole size. */
  follow(dt, x, z, R, boost = 1) {
    this.x = damp(this.x, x, 6, dt);
    this.z = damp(this.z, z, 6, dt);
    this.dist = damp(this.dist, distanceFor(R, this.aspect) * boost, 2.4, dt);
  }

  /** Per frame: place the camera, the sun's shadow box and the fog; step particles. */
  update(dt, t) {
    this.time = t;
    if (!(dt >= 0)) dt = 0;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const d = this.dist;
    const cam = this.camera;
    let ox = 0;
    let oy = 0;
    let roll = 0;
    if (this.trauma > 0 && !this.reduced) {
      const a = this.trauma * this.trauma;
      ox = (Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.7)) * 0.5 * a * d * 0.014;
      oy = (Math.sin(t * 31.9 + 0.4) + Math.sin(t * 19.3 + 2.9)) * 0.5 * a * d * 0.014;
      roll = Math.sin(t * 27.3 + 0.9) * a * 0.012;
    }
    cam.position.set(this.x + ox, Math.sin(this.pitch) * d + oy, this.z + Math.cos(this.pitch) * d);
    cam.lookAt(this.x + ox, 0, this.z);
    if (roll) cam.rotateZ(roll);
    cam.updateMatrixWorld();
    cam.near = Math.max(1, d * 0.12);
    cam.far = d * 14 + 400;
    cam.updateProjectionMatrix();
    // fog stays light: a haze far away, never over the action
    this.scene.fog.near = d * 2.2;
    this.scene.fog.far = d * 9 + 120;
    // the sun follows the action; its shadow box covers about what the camera sees
    const ext = d * 0.95 + 8;
    if (this.sun.castShadow) {
      const sc = this.sun.shadow.camera;
      if (Math.abs(ext - this.shadowExt) > this.shadowExt * 0.03) {
        this.shadowExt = ext;
        sc.left = -ext;
        sc.right = ext;
        sc.top = ext;
        sc.bottom = -ext;
        sc.far = ext * 5 + 220;
        sc.updateProjectionMatrix();
      }
      const texel = (2 * this.shadowExt) / this.shadowSize;
      const sx = Math.round(this.x / texel) * texel;
      const sz = Math.round(this.z / texel) * texel;
      this.sun.target.position.set(sx, 0, sz);
      this.sun.position.set(sx + this.sunDir.x * (ext * 2.4 + 60), this.sunDir.y * (ext * 2.4 + 60), sz + this.sunDir.z * (ext * 2.4 + 60));
      this.sun.target.updateMatrixWorld();
    } else {
      this.sun.position.set(this.sunDir.x * 100, this.sunDir.y * 100, this.sunDir.z * 100);
    }
    this.particles.uniforms.uScale.value = this.renderer.domElement.height / (2 * TAN);
    this.particles.update(dt);
    this.rings.update(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** The world point under a screen position on the ground plane (for dragging), or null. */
  groundPoint(px, py, out) {
    const nx = (px / this.width) * 2 - 1;
    const ny = -((py / this.height) * 2 - 1);
    out.set(nx, ny, 0.5).unproject(this.camera);
    const dir = out.sub(this.camera.position);
    if (dir.y >= -1e-6) return null;
    const k = -this.camera.position.y / dir.y;
    out.set(this.camera.position.x + dir.x * k, 0, this.camera.position.z + dir.z * k);
    return out;
  }

  /** Projects a world point to screen pixels; false when it is behind the camera. */
  project(x, y, z, out) {
    this._v ??= new Vector3();
    this._v.set(x, y, z).project(this.camera);
    if (this._v.z > 1 || this._v.z < -1) return false;
    out.x = (this._v.x * 0.5 + 0.5) * this.width;
    out.y = (-this._v.y * 0.5 + 0.5) * this.height;
    return true;
  }
}
