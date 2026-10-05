import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShaderLib } from 'three';
import { buildModels } from '../src/view/models.js';
import { Stage, distanceFor, FOV, PITCH } from '../src/view/stage.js';
import { makeGroundMaterial, makeHoleUniform, HOLE_SLOTS, buildGround } from '../src/view/ground.js';
import { RingPulses } from '../src/view/particles.js';
import { generateCity, generateLobby } from '../src/logic/city.js';
import { TYPES, TYPE_COUNT } from '../src/logic/objects.js';
import { buildScene, POSTER_SEED, SIZES } from '../src/poster.js';

const fakeRenderer = () => ({
  shadowMap: { enabled: false, type: 0 },
  setPixelRatio() {},
  setSize() {},
  render() {},
  domElement: { height: 720 },
  outputColorSpace: '',
  toneMapping: 0,
  toneMappingExposure: 1,
});

function makeStage(w = 1280, h = 720) {
  const stage = new Stage(null, { renderer: fakeRenderer(), quality: 'high' });
  stage.resize(w, h, 1);
  return stage;
}

const finite = (arr) => arr.every((v) => Number.isFinite(v));

test('every kind of thing has a model: same attributes, real size, nothing NaN', () => {
  const models = buildModels();
  assert.equal(models.length, TYPE_COUNT);
  let tris = 0;
  for (const m of models) {
    const g = m.geometry;
    for (const name of ['position', 'normal', 'color', 'uv']) assert.ok(g.attributes[name], `${m.id} has ${name}`);
    const n = g.attributes.position.count;
    assert.equal(g.attributes.normal.count, n);
    assert.equal(g.attributes.color.count, n);
    assert.equal(g.attributes.uv.count, n);
    assert.ok(n >= 24 && n % 3 === 0, `${m.id} has ${n} vertices`);
    assert.ok(finite(g.attributes.position.array) && finite(g.attributes.normal.array) && finite(g.attributes.uv.array));
    assert.ok(g.attributes.color.array.every((v) => v >= 0 && v <= 1));
    assert.ok(m.height > 0.5 && m.height < 60, `${m.id} is ${m.height} tall`);
    const bb = g.boundingBox;
    const half = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    const r = TYPES[m.type].r;
    assert.ok(half <= r * 1.25 + 0.2, `${m.id} is wider (${half.toFixed(2)}) than its footprint radius ${r}`);
    tris += m.tris;
  }
  assert.ok(tris < 8000, `${tris} triangles for all the types`);
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.ok(byId.landmark.height > byId.office2.height && byId.office2.height > byId.apt2.height && byId.apt2.height > byId.house0.height, 'taller as they get bigger');
});

test('the ground shader cuts holes: its replacements land on chunks three actually has', () => {
  assert.ok(ShaderLib.physical.vertexShader.includes('#include <begin_vertex>') && ShaderLib.physical.vertexShader.includes('#include <common>'));
  assert.ok(ShaderLib.physical.fragmentShader.includes('#include <clipping_planes_fragment>') && ShaderLib.physical.fragmentShader.includes('#include <common>'));
  const uniform = makeHoleUniform();
  assert.equal(uniform.value.length, HOLE_SLOTS);
  const mat = makeGroundMaterial(uniform);
  const shader = { uniforms: {}, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
  mat.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uHoles, uniform);
  assert.ok(shader.vertexShader.includes('vHoleXZ = (modelMatrix * vec4(transformed, 1.0)).xz;'));
  assert.ok(shader.fragmentShader.includes('discard;') && shader.fragmentShader.includes(`uniform vec3 uHoles[${HOLE_SLOTS}];`));
});

test('the ground is one mesh of coloured boxes covering the whole map', () => {
  const city = generateCity(2);
  const g = buildGround(city.ground);
  const n = g.attributes.position.count;
  assert.ok(n > 10000 && n % 3 === 0 && n < 60000);
  assert.ok(finite(g.attributes.position.array) && finite(g.attributes.color.array));
  assert.equal(g.attributes.normal.count, n);
});

test('the city view puts every object in a mesh and keeps the matrices clean through a hundred frames', () => {
  const stage = makeStage();
  const city = generateCity(5);
  stage.loadCity(city);
  const view = stage.city;
  let instances = 0;
  for (const mesh of view.meshes) if (mesh) instances += mesh.count;
  assert.equal(instances, city.n);
  assert.ok(view.group.children.filter((c) => c.isInstancedMesh).length <= TYPE_COUNT);
  const holes = [
    { x: 0, z: 0, R: 6, alive: true },
    { x: 30, z: -20, R: 2.4, alive: true },
  ];
  for (let f = 0; f < 100; f++) {
    holes[0].x = Math.sin(f / 10) * 30;
    holes[0].z = Math.cos(f / 13) * 25;
    view.update(1 / 60, 10 + f / 60, holes);
  }
  for (const mesh of view.meshes) if (mesh) assert.ok(finite(mesh.instanceMatrix.array), 'no NaN in a matrix');
  assert.ok(view.tilts.size > 0, 'things near a hole tip toward it');
  for (const [id, tl] of view.tilts) {
    assert.ok(tl.a >= 0 && tl.a <= 1.01);
    assert.ok(city.r[id] * 1.1 <= 6.0 + 1e-6 || city.r[id] * 1.1 <= 2.4 + 1e-6, 'only what the hole could swallow tips');
  }
});

test('an object falls, sinks out of sight and is hidden; it can come back and pop in', () => {
  const stage = makeStage();
  const city = generateCity(5);
  stage.loadCity(city);
  const view = stage.city;
  let id = -1;
  for (let i = 0; i < city.n; i++) if (TYPES[city.type[i]].id === 'car2' && !city.isMover[i]) { id = i; break; }
  assert.ok(id >= 0);
  const mesh = view.meshes[city.type[id]];
  const slot = view.slot[id];
  const read = () => {
    const e = mesh.instanceMatrix.array;
    return { y: e[slot * 16 + 13], sx: Math.hypot(e[slot * 16], e[slot * 16 + 1], e[slot * 16 + 2]) };
  };
  assert.ok(Math.abs(read().y) < 0.2 && read().sx > 0.9, 'starts on the ground at full size');
  view.fall(id, city.x[id] + 1, city.z[id], 0);
  assert.ok(view.isGone(id));
  let lowest = 0;
  for (let t = 0; t < 1.2; t += 1 / 60) {
    view.update(1 / 60, 5, []);
    lowest = Math.min(lowest, read().y);
  }
  assert.ok(lowest < -1.2, `it sank to ${lowest.toFixed(2)}`);
  assert.equal(read().sx, 0, 'then it is gone');
  assert.equal(view.falls.length, 0);
  view.restore(id);
  view.update(0.1, 5, []);
  const mid = read().sx;
  assert.ok(mid > 0 && mid < 1.6, 'growing back');
  for (let t = 0; t < 0.6; t += 1 / 60) view.update(1 / 60, 5, []);
  assert.ok(Math.abs(read().sx - 1) < 1e-6 && !view.isGone(id), 'back at full size');
  view.vanish(id);
  assert.equal(read().sx, 0);
  view.fall(id, 0, 0, 0);
  assert.equal(view.falls.length, 0, 'nothing falls twice');
});

test('a hundred things falling at once is fine', () => {
  const stage = makeStage();
  const city = generateCity(8);
  stage.loadCity(city);
  const ids = [];
  for (let i = 0; i < city.n && ids.length < 260; i++) if (!city.isMover[i]) ids.push(i);
  for (const id of ids) stage.city.fall(id, 0, 0, 0);
  assert.ok(stage.city.falls.length <= 180);
  for (let t = 0; t < 4; t += 1 / 60) stage.city.update(1 / 60, 3, []);
  assert.equal(stage.city.falls.length, 0);
  for (const mesh of stage.city.meshes) if (mesh) assert.ok(finite(mesh.instanceMatrix.array));
});

test('loading another city replaces the first', () => {
  const stage = makeStage();
  stage.loadCity(generateCity(1));
  stage.loadCity(generateLobby(3));
  let instances = 0;
  for (const mesh of stage.city.meshes) if (mesh) instances += mesh.count;
  assert.equal(instances, stage.city.city.n);
  assert.equal(stage.city.group.children.filter((c) => c.isInstancedMesh).length, stage.city.meshes.filter(Boolean).length);
  assert.equal(stage.backdropHalf, 23);
  stage.loadCity(generateCity(2));
  assert.equal(stage.backdropHalf, 70);
});

test('the camera keeps a hole about a sixth of the screen wide and zooms out as it grows', () => {
  const stage = makeStage();
  stage.loadCity(generateCity(1));
  const pt = { x: 0, y: 0 };
  const left = { x: 0, y: 0 };
  for (const R of [1, 2, 4, 8, 12]) {
    stage.snap(10, -5, R);
    stage.update(0.016, 1);
    assert.ok(stage.project(10, 0, -5, pt));
    assert.ok(Math.abs(pt.x - 640) < 2 && Math.abs(pt.y - 360) < 2, 'the hole is in the middle');
    stage.project(10 - R, 0, -5, left);
    const width = (pt.x - left.x) * 2;
    assert.ok(width / 1280 > 0.12 && width / 1280 < 0.22, `radius ${R}: ${(100 * width / 1280).toFixed(1)}% of the width`);
  }
  assert.ok(distanceFor(8, 16 / 9) > distanceFor(4, 16 / 9) * 1.9);
  assert.ok(distanceFor(2, 0.5) < distanceFor(2, 0.5) + 1 && Number.isFinite(distanceFor(2, 0)), 'a phone held upright still works');
  assert.equal(FOV, 38);
  assert.ok(Math.abs(PITCH - (55 * Math.PI) / 180) < 1e-9);
});

test('the camera shakes from trauma squared, and not at all with reduced motion', () => {
  const stage = makeStage();
  stage.loadCity(generateCity(1));
  stage.snap(0, 0, 3);
  stage.update(0.016, 1);
  const base = stage.camera.position.clone();
  stage.addTrauma(0.8);
  let moved = 0;
  for (let i = 0; i < 20; i++) {
    stage.update(0.016, 1 + i * 0.016);
    moved = Math.max(moved, stage.camera.position.distanceTo(base));
  }
  assert.ok(moved > 0.05, `shook by ${moved.toFixed(2)}`);
  for (let i = 0; i < 200; i++) stage.update(0.016, 2 + i * 0.016);
  assert.ok(stage.camera.position.distanceTo(base) < 1e-6, 'it comes to rest');
  stage.reduced = true;
  stage.addTrauma(1);
  stage.update(0.016, 9);
  assert.ok(stage.camera.position.distanceTo(base) < 1e-6, 'no shake with reduced motion');
});

test('quality: low draws no shadows, medium and high do', () => {
  const stage = makeStage();
  stage.setQuality('low');
  assert.equal(stage.sun.castShadow, false);
  assert.equal(stage.renderer.shadowMap.enabled, false);
  stage.setQuality('medium');
  assert.equal(stage.sun.shadow.mapSize.x, 1024);
  stage.setQuality('high');
  assert.equal(stage.sun.shadow.mapSize.x, 2048);
  assert.equal(stage.sun.castShadow, true);
  stage.loadCity(generateCity(1));
  stage.snap(0, 0, 3);
  stage.update(0.016, 1);
  assert.ok(Number.isFinite(stage.sun.position.x) && stage.sun.shadow.camera.right > 5);
});

test('particles and rings stay inside their budget', () => {
  const stage = makeStage();
  const p = stage.particles;
  for (let i = 0; i < 3000; i++) p.burst(0, 0.5, 0, 0xffffff, 1, 12);
  assert.ok(p.n <= p.budget);
  for (let t = 0; t < 3; t += 0.016) p.update(0.016);
  assert.equal(p.n, 0, 'they all fade');
  assert.ok(finite(p.pos.subarray(0, 30)));
  p.setBudget(0);
  p.burst(0, 0, 0, 0xffffff, 1, 10);
  assert.equal(p.n, 0);
  const rings = new RingPulses(stage.scene, 3);
  for (let i = 0; i < 8; i++) rings.emit(0, 0, 1, 4, 0xffffff, 0.5);
  rings.update(0.2);
  assert.ok(rings.items.some((r) => r.mesh.visible));
  rings.update(1);
  assert.ok(rings.items.every((r) => !r.mesh.visible));
});

test('holes: placed where they are, and switched off in the shader when they are not shown', () => {
  const stage = makeStage();
  const views = [
    { x: 5, z: -3, R: 2.5, scale: 1, shown: true, seat: 0, me: true, protect: false },
    { x: -9, z: 4, R: 1, scale: 0.5, shown: true, seat: 1, me: false, protect: true },
    { x: 0, z: 0, R: 3, scale: 1, shown: false, seat: 2, me: false, protect: false },
  ];
  stage.holes.update(views, 3);
  const u = stage.holeUniform.value;
  assert.deepEqual([u[0].x, u[0].y, u[0].z], [5, -3, 2.5]);
  assert.deepEqual([u[1].x, u[1].y, u[1].z], [-9, 4, 0.5]);
  assert.equal(u[2].z, 0);
  assert.equal(u[9].z, 0);
  assert.equal(stage.holes.items[2].root.visible, false);
  stage.holes.hideAll();
  assert.ok(u.every((v) => v.z === 0));
});

// ------------------------------------------------------------------------------------------------ store art

function frameOf(name) {
  const [w, h] = SIZES[name];
  const stage = makeStage(w, h);
  const city = generateCity(POSTER_SEED);
  stage.loadCity(city);
  const scene = buildScene(name, stage, city);
  stage.setMood(scene.mood);
  stage.pitch = scene.pitch;
  stage.x = scene.x;
  stage.z = scene.z;
  stage.dist = scene.dist;
  stage.holes.update(scene.views, 41.5);
  stage.update(0, 41.5);
  return { stage, city, scene, w, h };
}

function screen(stage, x, y, z) {
  const out = { x: 0, y: 0 };
  assert.ok(stage.project(x, y, z, out));
  return out;
}

test('cover: a big hole below the title, a bus going in, a smaller rival in the frame', () => {
  const { stage, scene, w, h } = frameOf('cover');
  const [main, rival] = scene.views;
  const c = screen(stage, main.x, 0, main.z);
  const edge = screen(stage, main.x - main.R, 0, main.z);
  const width = (c.x - edge.x) * 2;
  assert.ok(c.y > h * 0.5 && c.y < h * 0.8, `the hole is in the lower half (${c.y.toFixed(0)} of ${h})`);
  assert.ok(width / w > 0.2 && width / w < 0.38, `the hole is ${(100 * width / w).toFixed(0)}% of the width`);
  const top = screen(stage, main.x, 0, main.z - main.R);
  assert.ok(top.y > h * 0.3, `its top edge (${top.y.toFixed(0)}) sits under the title band`);
  const r = screen(stage, rival.x, 0, rival.z);
  assert.ok(r.x > 0.55 * w && r.x < 0.95 * w && r.y > 0.3 * h && r.y < 0.95 * h, `the rival is in view at ${r.x.toFixed(0)}, ${r.y.toFixed(0)}`);
  assert.ok(stage.city.falls.length >= 8, `${stage.city.falls.length} things on their way in`);
  assert.ok(stage.particles.n > 0);
});

test('action: a tower tipping into a giant hole', () => {
  const { stage, scene, w, h } = frameOf('action');
  const main = scene.views[0];
  const c = screen(stage, main.x, 0, main.z);
  const edge = screen(stage, main.x - main.R, 0, main.z);
  const width = (c.x - edge.x) * 2;
  assert.ok(c.x > 0.25 * w && c.x < 0.65 * w && c.y > 0.3 * h && c.y < 0.85 * h, `centre ${c.x.toFixed(0)}, ${c.y.toFixed(0)}`);
  assert.ok(width / w > 0.28 && width / w < 0.55, `${(100 * width / w).toFixed(0)}% of the width`);
  const tower = stage.city.falls.reduce((a, f) => (f.h > a.h ? f : a), { h: 0 });
  assert.ok(tower.h > 17, 'the tallest faller is a tower');
  assert.ok(stage.city.falls.length >= 8);
  assert.ok(stage.particles.n >= 40);
});

test('win: the biggest hole in the middle of a nearly empty city at sunset', () => {
  const { stage, city, scene, w, h } = frameOf('win');
  assert.equal(scene.mood, 'sunset');
  const main = scene.views[0];
  const c = screen(stage, main.x, 0, main.z);
  assert.ok(Math.abs(c.x - w / 2) < 40 && Math.abs(c.y - h / 2) < 70, `centred (${c.x.toFixed(0)}, ${c.y.toFixed(0)})`);
  const edge = screen(stage, main.x - main.R, 0, main.z);
  assert.ok(((c.x - edge.x) * 2) / w > 0.28, 'big');
  let left = 0;
  for (let i = 0; i < city.n; i++) if (!stage.city.isGone(i)) left++;
  assert.ok(left < city.n * 0.12, `${left} of ${city.n} things left`);
  assert.ok(left > 8, 'but not nothing');
});

test('icon: one bold hole in the middle with a car going in, nothing near the edge', () => {
  const { stage, scene, w, h } = frameOf('icon');
  const main = scene.views[0];
  const c = screen(stage, main.x, 0, main.z);
  const edge = screen(stage, main.x - main.R, 0, main.z);
  const width = (c.x - edge.x) * 2;
  assert.ok(Math.abs(c.x - w / 2) < 6 && Math.abs(c.y - h / 2) < 12);
  assert.ok(width / w > 0.5 && width / w < 0.72, `${(100 * width / w).toFixed(0)}% of the width`);
  assert.equal(stage.city.falls.length, 1, 'one car');
  const f = stage.city.falls[0];
  const car = screen(stage, f.x0, 0, f.z0);
  assert.ok(Math.hypot(car.x - w / 2, car.y - h / 2) < w * 0.3, 'the car is near the hole');
  assert.ok(stage.pitch > (80 * Math.PI) / 180, 'seen from almost straight above');
});
