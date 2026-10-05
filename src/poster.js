// Store art. `?poster=<name>` draws one staged, deterministic frame with the real renderer and sets
// `document.body.dataset.ready = '1'` when it is on screen: no room, no SDK, no HUD.
//   cover (1280x720, the game's name over a big hole swallowing a bus), action (1280x720, a tower sinking),
//   win (1280x720, the biggest hole in an emptied city at sunset), icon (512x512, a hole with a car going in),
//   badge-<id> (256x256, a symbol on a coloured disc).
// The scene builders only need a Stage, so the tests run them with a stand-in renderer and check where things land.

import { generateCity } from './logic/city.js';
import { T, TYPES } from './logic/objects.js';
import { canEat } from './logic/rules.js';
import { SEAT_COLORS } from './logic/config.js';
import { mulberry32 } from './logic/rng.js';
import { Stage, distanceFor, TAN_HALF } from './view/stage.js';

export const POSTER_SEED = 31337;
export const POSTER_TIME = 41.5; // the clock the walkers and cars stand at
export const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };
const DEG = Math.PI / 180;

const hole = (seat, x, z, R, extra = {}) => ({ id: `poster${seat}`, name: '', x, z, R, Rt: R, scale: 1, alive: true, shown: true, seat, me: false, protect: false, ...extra });

/** Static objects of the given kinds, in city order, skipping ones already used. */
function pick(city, names, n, taken) {
  const want = new Set(names.map((id) => T[id]));
  const out = [];
  for (let i = 0; i < city.n && out.length < n; i++) {
    if (city.isMover[i] || taken.has(i) || !want.has(city.type[i])) continue;
    out.push(i);
    taken.add(i);
  }
  return out;
}

/** Moves a static object to where the picture wants it. */
function teleport(stage, city, id, x, z, yaw = 0) {
  city.bx[id] = x;
  city.bz[id] = z;
  city.x[id] = x;
  city.z[id] = z;
  city.yaw[id] = yaw;
  stage.city.place(id, POSTER_TIME);
}

/** Takes out everything near a point (except what the scene has put there on purpose). */
function clear(stage, city, x, z, radius, keep, smallOnly = true, R = 0) {
  for (let i = 0; i < city.n; i++) {
    if (keep.has(i)) continue;
    const d = Math.hypot(city.x[i] - x, city.z[i] - z);
    if (d > radius) continue;
    if (smallOnly && R > 0 && !canEat(R, city.r[i])) continue;
    stage.city.vanish(i);
  }
}

/** Puts an object partway through its fall into a hole. */
function sink(stage, id, hx, hz, progress) {
  stage.city.freezeFall(id, hx, hz, progress);
}

/** Lets things that overhang the rim tip over (the same smoothing as in play, run until it settles). */
function settle(stage, views) {
  stage.city.city.updateMovers(POSTER_TIME);
  for (let i = 0; i < 40; i++) stage.city.update(0.05, POSTER_TIME, views);
}

function dust(stage, rng, x, z, radius, count, y0, y1, colours, size, alpha) {
  for (let k = 0; k < count; k++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const col = colours[Math.floor(rng() * colours.length)];
    const s = size * (0.5 + rng());
    stage.particles.emit(x + Math.cos(a) * r, y0 + (y1 - y0) * rng(), z + Math.sin(a) * r, 0, 0, 0, 1, s, s, col, 0, 0, alpha);
  }
}

/**
 * Builds the scene for a poster into a stage that already has the city loaded. Returns what the picture needs:
 * { views, mood, x, z, dist, pitch }. `city` is the one the stage was loaded with.
 */
export function buildScene(name, stage, city) {
  const taken = new Set();
  const rng = mulberry32(2026);
  const aspect = stage.aspect;
  const grid = () => {
    city._grid = null; // objects were moved: the grid is rebuilt from where they are now
  };

  if (name === 'cover') {
    const R = 4.9;
    const hx = 14;
    const hz = -14.5;
    const main = hole(0, hx, hz, R);
    const rival = hole(1, hx + 11.6, hz - 2.2, 2.4);
    const views = [main, rival];
    const bus = pick(city, ['bus'], 1, taken)[0] ?? pick(city, ['car1'], 1, taken)[0];
    teleport(stage, city, bus, hx - 0.8, hz + 0.4, 0.35);
    const cars = pick(city, ['car0', 'car1', 'car2', 'car3', 'car4'], 3, taken);
    const carSpots = [
      [hx + 4.6, hz - 1.8, 0.8, 0.3],
      [hx - 4.2, hz - 3.4, 2.0, 0.22],
      [hx + 0.8, hz + 5.4, -0.6, 0.16],
    ];
    const benches = pick(city, ['bench'], 2, taken);
    const benchSpots = [
      [hx + 5.3, hz + 2.6, 0.2, 0.2],
      [hx - 5.0, hz + 2.9, 0.5, 0.28],
    ];
    const bikes = pick(city, ['bike'], 2, taken);
    const bikeSpots = [
      [hx + 3.4, hz + 4.0, 1.0, 0.35],
      [hx - 3.0, hz - 4.4, 2.2, 0.1],
    ];
    const bins = pick(city, ['trash', 'hydrant'], 2, taken);
    const binSpots = [
      [hx - 2.4, hz + 4.4, 0, 0.3],
      [hx + 2.2, hz - 4.6, 0, 0.12],
    ];
    const cones = pick(city, ['cone'], 7, taken);
    const rim = pick(city, ['lamp'], 1, taken);
    grid();
    const staged = [];
    const fall = (ids, spots) =>
      ids.forEach((id, k) => {
        const s = spots[k];
        if (!s) return;
        teleport(stage, city, id, s[0], s[1], s[2]);
        staged.push([id, s[3]]);
      });
    fall(cars, carSpots);
    fall(benches, benchSpots);
    fall(bikes, bikeSpots);
    fall(bins, binSpots);
    cones.forEach((id, k) => {
      const a = 0.4 + k * 0.62;
      teleport(stage, city, id, hx + Math.cos(a) * (R + 0.05), hz + Math.sin(a) * (R + 0.05));
    });
    if (rim[0] !== undefined) teleport(stage, city, rim[0], hx - R - 0.1, hz + 1.2);
    const keep = new Set([bus, ...cars, ...benches, ...bikes, ...bins, ...cones, ...rim]);
    grid();
    clear(stage, city, hx, hz, R * 0.8, keep, true, R);
    clear(stage, city, hx + 11.6, hz - 2.2, 2.4 * 0.9, keep, true, 2.4);
    // a trail behind the rival
    clear(stage, city, hx + 16.5, hz - 3.4, 3.6, keep, true, 2.4);
    for (let i = 0; i < city.n; i++) if (city.isMover[i] && Math.hypot(city.x[i] - hx, city.z[i] - hz) < R + 2) stage.city.vanish(i);
    settle(stage, views);
    sink(stage, bus, hx, hz, 0.5);
    for (const [id, p] of staged) sink(stage, id, hx, hz, p);
    dust(stage, rng, hx, hz, R * 0.9, 16, 0.6, 4.5, [0xe9e5dc, 0xcfd3da], 0.9, 0.42);
    stage.rings.emit(hx, hz, R * 1.4, R * 2.6, SEAT_COLORS[0], 1).t = 0.32;
    const dist = distanceFor(R, aspect) * 0.62;
    return { views, mood: 'day', x: hx, z: hz - dist * 0.14, dist, pitch: 55 * DEG };
  }

  if (name === 'action') {
    const R = 7.6;
    const hx = -14;
    const hz = 14;
    const main = hole(2, hx, hz, R);
    const views = [main];
    const tower = pick(city, ['office1', 'office2', 'office0'], 1, taken)[0];
    teleport(stage, city, tower, hx - 3.4, hz + 0.2, 0);
    const second = pick(city, ['office0', 'office2', 'office1'], 1, taken)[0];
    teleport(stage, city, second, hx + 8.6, hz - 4.6, 0);
    const things = pick(city, ['car0', 'car1', 'car2', 'car3', 'car4'], 4, taken);
    const spots = [
      [hx + 4.2, hz + 5.6, 0.7, 0.34],
      [hx - 2.0, hz - 6.6, 2.1, 0.2],
      [hx + 6.4, hz + 0.8, 1.2, 0.26],
      [hx - 6.8, hz + 5.4, 0.1, 0.14],
    ];
    const extra = [...pick(city, ['bench'], 2, taken), ...pick(city, ['tree'], 1, taken), ...pick(city, ['pine'], 1, taken), ...pick(city, ['kiosk'], 1, taken), ...pick(city, ['bike'], 1, taken)];
    const extraSpots = [
      [hx + 1.4, hz + 7.4, 0, 0.22],
      [hx - 5.2, hz - 3.0, 0.4, 0.3],
      [hx + 5.2, hz - 6.2, 0, 0.12],
      [hx - 7.4, hz + 0.6, 1, 0.18],
      [hx + 0.2, hz - 7.0, 0, 0.25],
      [hx - 3.4, hz + 6.9, 0, 0.1],
    ];
    grid();
    const staged = [];
    things.forEach((id, k) => {
      teleport(stage, city, id, spots[k][0], spots[k][1], spots[k][2]);
      staged.push([id, spots[k][3]]);
    });
    extra.forEach((id, k) => {
      teleport(stage, city, id, extraSpots[k][0], extraSpots[k][1], extraSpots[k][2]);
      staged.push([id, extraSpots[k][3]]);
    });
    const keep = new Set([tower, second, ...things, ...extra]);
    grid();
    clear(stage, city, hx, hz, R * 0.6, keep, true, R);
    for (let i = 0; i < city.n; i++) if (city.isMover[i] && Math.hypot(city.x[i] - hx, city.z[i] - hz) < R + 3) stage.city.vanish(i);
    settle(stage, views);
    sink(stage, tower, hx, hz, 0.5);
    for (const [id, p] of staged) sink(stage, id, hx, hz, p);
    // chunks and dust over the pit
    dust(stage, rng, hx - 1.5, hz, R * 0.9, 34, 0.8, 9, [0xb9bec7, 0xc9ccd3, 0x9fc6e8, 0xe9e5dc], 0.9, 0.9);
    dust(stage, rng, hx - 1.5, hz, R * 1.1, 26, 1.0, 11, [0xe9e5dc, 0xcfd3da], 2.2, 0.32);
    stage.rings.emit(hx, hz, R * 1.2, R * 2.4, SEAT_COLORS[2], 1).t = 0.36;
    const dist = distanceFor(R, aspect) * 0.5;
    return { views, mood: 'day', x: hx + 5, z: hz - 5, dist, pitch: 55 * DEG };
  }

  if (name === 'win') {
    const R = 11.4;
    const hx = 0;
    const hz = 2;
    const main = hole(2, hx, hz, R);
    const views = [main];
    // almost nothing is left: a few buildings out toward the edge and the last bites at the rim
    const last = [...pick(city, ['car2'], 1, taken), ...pick(city, ['car3'], 1, taken), ...pick(city, ['bench'], 1, taken), ...pick(city, ['tree'], 1, taken), ...pick(city, ['bike'], 1, taken)];
    const lastSpots = [
      [hx + 9.6, hz + 4.8, 0.5, 0.45],
      [hx - 8.4, hz + 7.4, 1.8, 0.3],
      [hx + 3.4, hz - 10.4, 0.2, 0.2],
      [hx - 10.2, hz - 3.6, 0, 0.35],
      [hx + 6.0, hz + 9.4, 0.8, 0.12],
    ];
    last.forEach((id, k) => teleport(stage, city, id, lastSpots[k][0], lastSpots[k][1], lastSpots[k][2]));
    grid();
    const keep = new Set(last);
    for (let i = 0; i < city.n; i++) {
      if (keep.has(i)) continue;
      const g = TYPES[city.type[i]].group;
      const d = Math.hypot(city.bx[i] - hx, city.bz[i] - hz);
      const big = g === 'building' || g === 'tower' || g === 'landmark';
      if (big && d > 24 && rng() < 0.6) continue;
      if (!big && d > 46 && rng() < 0.03) continue;
      stage.city.vanish(i);
    }
    settle(stage, views);
    last.forEach((id, k) => sink(stage, id, hx, hz, lastSpots[k][3]));
    stage.rings.emit(hx, hz, R * 1.1, R * 2.3, 0xffc400, 1).t = 0.4;
    const dist = distanceFor(R, aspect) * 0.52;
    return { views, mood: 'sunset', x: hx, z: hz - dist * 0.04, dist, pitch: 52 * DEG };
  }

  // icon
  const R = 3.3;
  const hx = 14;
  const hz = 14;
  const main = hole(0, hx, hz, R);
  const views = [main];
  const car = pick(city, ['car0'], 1, taken)[0] ?? pick(city, ['car1', 'car2', 'car3', 'car4'], 1, taken)[0];
  teleport(stage, city, car, hx + 1.2, hz - 1.9, 0.5);
  grid();
  clear(stage, city, hx, hz, 12, new Set([car]), false, 0);
  settle(stage, views);
  sink(stage, car, hx, hz, 0.36);
  const dist = (R * 2) / 0.6 / (2 * TAN_HALF);
  return { views, mood: 'day', x: hx, z: hz, dist, pitch: 84 * DEG };
}

// ------------------------------------------------------------------------------------------------------------- badges

const BADGES = {
  skyscraper: { a: '#19d3ff', b: '#0a6c9a', draw: drawTower },
  predator: { a: '#ff3b7a', b: '#8c1240', draw: drawPredator },
  'whole-city': { a: '#ff9a1f', b: '#a54a00', draw: drawSkyline },
  'first-win': { a: '#ffc400', b: '#a67c00', draw: drawTrophy },
};

function drawTower(g) {
  g.fillStyle = '#0b1020';
  g.fillRect(100, 76, 56, 120);
  g.fillRect(112, 58, 32, 20);
  g.fillRect(126, 34, 4, 26);
  g.fillStyle = '#ffffff';
  for (let y = 0; y < 6; y++) for (let x = 0; x < 3; x++) g.fillRect(108 + x * 16, 86 + y * 18, 9, 11);
  g.fillStyle = '#0b1020';
  g.fillRect(88, 196, 80, 10);
}

function drawPredator(g) {
  g.fillStyle = '#0b1020';
  g.beginPath();
  g.arc(116, 130, 54, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(168, 118, 26, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(116, 130, 54, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#0b1020';
  g.beginPath();
  g.arc(168, 118, 11, 0, Math.PI * 2);
  g.fill();
}

function drawSkyline(g) {
  g.fillStyle = '#0b1020';
  const bars = [
    [64, 130, 30],
    [98, 96, 34],
    [136, 60, 38],
    [178, 110, 30],
    [212 - 2, 140, 26],
  ];
  for (const [x, y, w] of bars) g.fillRect(x, y, w, 196 - y);
  g.fillRect(52, 196, 150, 9);
  g.fillStyle = '#ffffff';
  for (const [x, y, w] of bars) for (let r = 0; r < 4; r++) g.fillRect(x + 6, y + 10 + r * 20, w - 12, 8);
}

function drawTrophy(g) {
  g.fillStyle = '#0b1020';
  g.beginPath();
  g.moveTo(88, 62);
  g.lineTo(168, 62);
  g.lineTo(162, 112);
  g.quadraticCurveTo(152, 150, 128, 154);
  g.quadraticCurveTo(104, 150, 94, 112);
  g.closePath();
  g.fill();
  g.lineWidth = 11;
  g.strokeStyle = '#0b1020';
  g.beginPath();
  g.arc(84, 92, 22, Math.PI * 0.5, Math.PI * 1.45);
  g.stroke();
  g.beginPath();
  g.arc(172, 92, 22, Math.PI * 1.55, Math.PI * 0.5);
  g.stroke();
  g.fillRect(120, 154, 16, 32);
  g.fillRect(96, 186, 64, 14);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(128, 78);
  g.lineTo(134, 96);
  g.lineTo(153, 96);
  g.lineTo(138, 107);
  g.lineTo(144, 125);
  g.lineTo(128, 114);
  g.lineTo(112, 125);
  g.lineTo(118, 107);
  g.lineTo(103, 96);
  g.lineTo(122, 96);
  g.closePath();
  g.fill();
}

export function drawBadge(canvas, id) {
  const spec = BADGES[id] ?? BADGES['first-win'];
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  const grad = g.createRadialGradient(100, 90, 20, 128, 128, 128);
  grad.addColorStop(0, spec.a);
  grad.addColorStop(1, spec.b);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 122, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(128, 128, 116, 0, Math.PI * 2);
  g.stroke();
  g.save();
  spec.draw(g);
  g.restore();
}

// ------------------------------------------------------------------------------------------------------------- the page

function fit(canvas, w, h) {
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.left = '0';
  canvas.style.top = '0';
}

function drawTitle(canvas) {
  const g = canvas.getContext('2d');
  const w = canvas.width;
  const band = g.createLinearGradient(0, 0, 0, 260);
  band.addColorStop(0, 'rgba(5,8,18,0.62)');
  band.addColorStop(1, 'rgba(5,8,18,0)');
  g.fillStyle = band;
  g.fillRect(0, 0, w, 260);
  g.font = '96px "Archivo Black", "Arial Black", system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const a = 'BLACK HOLE ';
  const b = 'CITY';
  const wa = g.measureText(a).width;
  const wb = g.measureText(b).width;
  const x = (w - wa - wb) / 2;
  const y = 122;
  g.save();
  g.translate(w / 2, y);
  g.transform(1, 0, -0.1, 1, 0, 0);
  g.translate(-w / 2, -y);
  g.lineWidth = 16;
  g.strokeStyle = 'rgba(6,9,18,0.85)';
  g.strokeText(a, x, y);
  g.strokeText(b, x + wa, y);
  g.fillStyle = '#ffffff';
  g.fillText(a, x, y);
  g.fillStyle = '#ffc400';
  g.fillText(b, x + wa, y);
  g.restore();
}

export async function runPoster(name) {
  const ui = document.getElementById('ui');
  if (ui) ui.hidden = true;
  document.body.style.background = '#000';
  const canvas = document.getElementById('game');
  const overlay = document.getElementById('overlay');
  const badge = /^badge-(.+)$/.exec(name);
  const [w, h] = badge ? [256, 256] : (SIZES[name] ?? SIZES.cover);
  fit(canvas, w, h);
  fit(overlay, w, h);
  try {
    await document.fonts.load('96px "Archivo Black"');
    await document.fonts.ready;
  } catch {}
  if (badge) {
    canvas.style.display = 'none';
    drawBadge(overlay, badge[1]);
    document.body.dataset.ready = '1';
    return;
  }
  const stage = new Stage(canvas, { quality: 'high', preserve: true, pixelRatio: 1 });
  stage.resize(w, h, 1);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const city = generateCity(POSTER_SEED);
  stage.loadCity(city);
  const scene = buildScene(name, stage, city);
  stage.setMood(scene.mood);
  stage.pitch = scene.pitch;
  stage.x = scene.x;
  stage.z = scene.z;
  stage.dist = scene.dist;
  stage.holes.update(scene.views, POSTER_TIME);
  stage.update(0, POSTER_TIME);
  stage.render();
  if (name === 'cover') drawTitle(overlay);
  const loop = () => {
    requestAnimationFrame(loop);
    stage.holes.update(scene.views, POSTER_TIME);
    stage.update(0, POSTER_TIME);
    stage.render();
  };
  requestAnimationFrame(() => {
    loop();
    requestAnimationFrame(() => {
      document.body.dataset.ready = '1';
    });
  });
}

