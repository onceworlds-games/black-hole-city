import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radiusFor, massFor, speedFor, canEat, swallowDistance, overhang, canGulp, limit, clampToWorld, collectSwallows } from '../src/logic/rules.js';
import { encodeEaten, decodeEaten, toBase64, fromBase64 } from '../src/logic/bits.js';
import { TYPES, T, TYPE_R, radiusNeeded, isSkyscraper } from '../src/logic/objects.js';
import { generateCity } from '../src/logic/city.js';
import { R0, HALF, K } from '../src/logic/config.js';
import { mulberry32, hashSeed } from '../src/logic/rng.js';

test('a hole starts at radius 1 and grows with what it swallows', () => {
  assert.equal(radiusFor(0), R0);
  assert.ok(radiusFor(10) > radiusFor(5));
  assert.ok(Math.abs(radiusFor(K * 3) - 2) < 1e-9, 'area adds up: four times the mass-plus-one is twice the radius');
  for (let m = 0; m < 5000; m += 37) assert.ok(Math.abs(massFor(radiusFor(m)) - m) < 1e-6);
  assert.equal(radiusFor(-5), R0, 'never smaller than the start');
  assert.ok(Number.isFinite(radiusFor(1e9)));
});

test('size tiers: cones first, cars about radius 2, houses about 3.5, towers about 6, the landmark about 9', () => {
  assert.ok(canEat(R0, TYPE_R[T.cone]) && canEat(R0, TYPE_R[T.hydrant]) && canEat(R0, TYPE_R[T.person0]));
  assert.ok(!canEat(R0, TYPE_R[T.car0]));
  assert.ok(canEat(2.0, TYPE_R[T.car0]) && !canEat(1.9, TYPE_R[T.car0]));
  assert.ok(Math.abs(radiusNeeded(T.house0) - 3.5) < 0.1);
  assert.ok(Math.abs(radiusNeeded(T.office0) - 6) < 0.1);
  assert.ok(Math.abs(radiusNeeded(T.landmark) - 9) < 0.1);
  assert.ok(radiusNeeded(T.stadium) < radiusNeeded(T.landmark));
  for (const t of TYPES) assert.ok(t.r > 0 && t.value >= 1);
  assert.ok(isSkyscraper(T.office1) && isSkyscraper(T.landmark) && !isSkyscraper(T.house0));
});

test('speed falls a little as the hole grows: 8 at the start, 6 at radius 10', () => {
  assert.equal(speedFor(R0), 8);
  assert.equal(speedFor(10), 6);
  assert.equal(speedFor(25), 6);
  assert.ok(speedFor(5) < 8 && speedFor(5) > 6);
});

test('an object falls when its centre is well inside: R - r / 2', () => {
  const R = 3;
  const r = TYPE_R[T.bench];
  assert.equal(swallowDistance(R, r), R - r * 0.5);
  assert.equal(overhang(R, R + r * 0.5 + 0.01, r), 0, 'clear of the hole');
  assert.ok(Math.abs(overhang(R, R - r * 0.5, r) - 1) < 1e-9, 'about to fall');
  const mid = overhang(R, R, r);
  assert.ok(mid > 0.3 && mid < 0.7, 'on the edge it tips about half way');
});

test('a bigger hole swallows a smaller one it covers', () => {
  assert.ok(canGulp(5, 3, 1));
  assert.ok(!canGulp(5, 4.5, 0), 'not 1.25 times bigger');
  assert.ok(!canGulp(5, 3, 4), 'not covering its centre well enough');
  assert.ok(canGulp(5, 3, 4, 1.25, 3), 'slack makes it kinder (the host uses it for lag)');
  assert.ok(canGulp(5, 4, 0, 1.2) === true && canGulp(5, 4.3, 0, 1.2) === false);
});

test('a hole stays on the map', () => {
  const h = { x: 500, z: -500 };
  clampToWorld(h, 5, HALF);
  assert.ok(Math.abs(h.x) <= HALF && Math.abs(h.z) <= HALF);
  assert.ok(limit(1, HALF) > 60 && limit(50, HALF) >= 2);
  const g = { x: -3, z: 4 };
  clampToWorld(g, 1, HALF);
  assert.deepEqual(g, { x: -3, z: 4 });
});

test('swallowing finds exactly the objects in range and no others', () => {
  const city = generateCity(11);
  const grid = city.grid();
  const eaten = new Uint8Array(city.n);
  const rng = mulberry32(5);
  for (let k = 0; k < 200; k++) {
    const x = (rng() * 2 - 1) * 60;
    const z = (rng() * 2 - 1) * 60;
    const R = 1 + rng() * 9;
    const got = new Set(collectSwallows(city, grid, eaten, x, z, R, []));
    const want = new Set();
    for (let i = 0; i < city.n; i++) {
      if (R >= city.r[i] * 1.1 && Math.hypot(city.x[i] - x, city.z[i] - z) <= R - city.r[i] * 0.5) want.add(i);
    }
    assert.deepEqual([...got].sort((a, b) => a - b), [...want].sort((a, b) => a - b));
  }
  // an object already eaten is not found again
  const first = collectSwallows(city, grid, eaten, 0, 0, 12, []);
  assert.ok(first.length > 0);
  for (const id of first) eaten[id] = 1;
  assert.equal(collectSwallows(city, grid, eaten, 0, 0, 12, []).length, 0);
});

test('the eaten set packs into a short string and comes back the same', () => {
  const rng = mulberry32(9);
  for (const n of [1, 7, 8, 9, 63, 64, 1000, 1511, 2047]) {
    for (const density of [0, 0.01, 0.5, 1]) {
      const flags = new Uint8Array(n);
      for (let i = 0; i < n; i++) flags[i] = rng() < density ? 1 : 0;
      const text = encodeEaten(flags);
      assert.ok(/^[A-Za-z0-9+/=]*$/.test(text));
      assert.ok(text.length <= Math.ceil(n / 8 / 3) * 4);
      assert.deepEqual(decodeEaten(text, n), flags, `n ${n} density ${density}`);
    }
  }
  assert.equal(encodeEaten(new Uint8Array(1500)), '', 'an untouched city is an empty string');
  assert.ok(encodeEaten(new Uint8Array(1500).fill(1)).length < 300, 'a fully eaten city is still under 300 characters');
  assert.deepEqual(decodeEaten('', 40), new Uint8Array(40));
});

test('a bad eaten set is refused, never thrown', () => {
  assert.equal(decodeEaten('!!!!', 100), null);
  assert.equal(decodeEaten('AAA', 100), null);
  assert.equal(decodeEaten(42, 100), null);
  assert.equal(decodeEaten(null, 100), null);
  assert.equal(decodeEaten('A'.repeat(5000), 100), null, 'too long for the city');
  assert.equal(decodeEaten('AA=A', 100), null, 'padding in the middle');
  assert.equal(fromBase64('é' + 'AAA'), null);
});

test('base64 round trips arbitrary bytes', () => {
  const rng = mulberry32(3);
  for (let len = 0; len < 40; len++) {
    const bytes = Uint8Array.from({ length: len }, () => Math.floor(rng() * 256));
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
    if (typeof Buffer !== 'undefined') assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
  }
});

test('seeded randomness: same seed same numbers, hashes spread', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.notEqual(hashSeed('a', 1), hashSeed('a', 2));
  assert.notEqual(hashSeed('ab', 'c'), hashSeed('a', 'bc'));
  const v = mulberry32(7)();
  assert.ok(v >= 0 && v < 1);
});
