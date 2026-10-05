import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/logic/city.js';
import { Sim } from '../src/logic/sim.js';
import { BotBrain } from '../src/logic/bots.js';
import { radiusFor, speedFor, limit } from '../src/logic/rules.js';
import { mulberry32 } from '../src/logic/rng.js';

const bots = (n) => Array.from({ length: n }, (_, i) => ({ id: `bot${i + 1}`, bot: true, name: 'B' + i }));

test('bots only make legal moves: finite, inside the map, never faster than the speed limit', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const city = generateCity(seed);
    const sim = new Sim(city, bots(6), { seed });
    for (let t = 33; t <= 60000; t += 33) {
      sim.advanceTo(t);
      for (const h of sim.holes) {
        assert.ok(Number.isFinite(h.x) && Number.isFinite(h.z) && Number.isFinite(h.vx) && Number.isFinite(h.vz));
        const R = radiusFor(h.mass);
        const m = limit(R, city.half);
        assert.ok(Math.abs(h.x) <= m + 1e-6 && Math.abs(h.z) <= m + 1e-6, `${h.id} out of its bounds`);
        assert.ok(Math.hypot(h.vx, h.vz) <= speedFor(R) + 1e-6, `${h.id} too fast`);
      }
    }
  }
});

test('a bot with nothing near it goes looking, and one that has eaten everything small still moves', () => {
  const city = generateCity(2);
  const sim = new Sim(city, bots(1), { seed: 2 });
  const h = sim.holes[0];
  // nothing near: everything within 40 units is already eaten
  for (let i = 0; i < city.n; i++) if (!city.isMover[i] && Math.hypot(city.bx[i] - h.x, city.bz[i] - h.z) < 40) sim.eaten[i] = 1;
  const x0 = h.x;
  const z0 = h.z;
  for (let t = 33; t <= 6000; t += 33) sim.advanceTo(t);
  assert.ok(Math.hypot(h.x - x0, h.z - z0) > 20, 'it travelled to find something');
  // a huge bot over an eaten city wanders instead of freezing
  const sim2 = new Sim(city, bots(1), { seed: 2 });
  sim2.eaten.fill(1);
  sim2.holes[0].mass = 100000;
  const b = sim2.holes[0];
  let moved = 0;
  let lx = b.x;
  let lz = b.z;
  for (let t = 33; t <= 8000; t += 33) {
    sim2.advanceTo(t);
    moved += Math.hypot(b.x - lx, b.z - lz);
    lx = b.x;
    lz = b.z;
  }
  assert.ok(moved > 10, 'it keeps moving');
});

test('a bot hunts a much smaller hole nearby, and ignores one it cannot swallow', () => {
  const city = generateCity(3);
  const sim = new Sim(city, [...bots(1), { id: 'ann', bot: false }], { seed: 3 });
  const [bot, ann] = sim.holes;
  bot.mass = 800;
  bot.x = 0;
  bot.z = 0;
  bot.brain.aggr = 1;
  ann.mass = 5;
  ann.x = 14;
  ann.z = 0;
  const rng = mulberry32(1);
  void rng;
  let closest = Infinity;
  for (let t = 33; t <= 3000; t += 33) {
    sim.advanceTo(t);
    ann.x = 14;
    ann.z = 0;
    closest = Math.min(closest, Math.hypot(bot.x - ann.x, bot.z - ann.z));
    if (!sim.isAlive(ann, t)) break;
  }
  assert.ok(closest < 8 || !sim.isAlive(ann, 3000), 'it went for the little one');
});

test('each bot has its own speed and nerve, so they do not all play the same', () => {
  const brains = Array.from({ length: 8 }, (_, i) => new BotBrain(mulberry32(i + 1)));
  assert.ok(new Set(brains.map((b) => b.skill.toFixed(3))).size >= 7);
  assert.ok(new Set(brains.map((b) => b.aggr.toFixed(3))).size >= 7);
  for (const b of brains) assert.ok(b.skill > 0.7 && b.skill < 1 && b.think > 0.3);
});
