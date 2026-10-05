import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, generateLobby } from '../src/logic/city.js';
import { TYPES, T, TYPE_R } from '../src/logic/objects.js';
import { HALF, LOBBY_HALF } from '../src/logic/config.js';

const SEEDS = [1, 2, 3, 17, 99, 2026];

test('the same seed builds the same city, a different seed another', () => {
  const a = generateCity(5);
  const b = generateCity(5);
  const c = generateCity(6);
  assert.equal(a.n, b.n);
  assert.deepEqual(a.type, b.type);
  assert.deepEqual(a.bx, b.bx);
  assert.deepEqual(a.bz, b.bz);
  assert.deepEqual(a.yaw, b.yaw);
  assert.equal(a.ground.length, b.ground.length);
  assert.ok(a.n !== c.n || !a.bx.every((v, i) => v === c.bx[i]));
  a.updateMovers(123.4);
  b.updateMovers(123.4);
  assert.deepEqual(a.x, b.x);
  assert.deepEqual(a.z, b.z);
});

test('a city has about fifteen hundred things, in every size', () => {
  for (const seed of SEEDS) {
    const city = generateCity(seed);
    assert.ok(city.n >= 1300 && city.n <= 1900, `seed ${seed}: ${city.n} objects`);
    assert.ok(city.moverIds.length >= 150 && city.moverIds.length <= 400, `${city.moverIds.length} movers`);
    assert.equal(city.countType(T.landmark), 1);
    assert.equal(city.countType(T.stadium), 1);
    const sum = (prefix, from, to) => {
      let c = 0;
      for (let i = from; i <= to; i++) c += city.countType(T[prefix + i]);
      return c;
    };
    assert.ok(sum('house', 0, 2) >= 12, 'houses');
    assert.ok(sum('shop', 0, 1) >= 4, 'shops');
    assert.ok(sum('apt', 0, 2) >= 5, 'apartments');
    assert.ok(sum('office', 0, 2) >= 8, 'towers');
    assert.ok(sum('car', 0, 4) >= 80, 'cars');
    assert.ok(sum('person', 0, 3) >= 150, 'people');
    for (const id of ['cone', 'hydrant', 'trash', 'mailbox', 'lamp', 'bench', 'bike', 'bush', 'tree', 'pine', 'kiosk', 'fountain']) assert.ok(city.countType(T[id]) > 0, `${id} appears`);
    assert.ok(city.totalValue > 6000 && city.totalValue < 14000, `total value ${city.totalValue}`);
  }
});

test('every object has a size and a value from its type, and every ground piece is sane', () => {
  const city = generateCity(7);
  for (let i = 0; i < city.n; i++) {
    assert.equal(city.r[i], TYPE_R[city.type[i]]);
    assert.ok(city.value[i] >= 1);
    assert.ok(Number.isFinite(city.x[i]) && Number.isFinite(city.z[i]) && Number.isFinite(city.yaw[i]));
  }
  for (const r of city.ground) {
    assert.ok(r.x1 > r.x0 && r.z1 > r.z0, 'a rectangle with area');
    assert.ok(r.top > r.bot);
  }
});

test('everything stands inside the walls, and movers stay there as the clock runs', () => {
  for (const seed of SEEDS) {
    const city = generateCity(seed);
    for (let i = 0; i < city.n; i++) {
      if (city.isMover[i]) continue;
      assert.ok(Math.abs(city.bx[i]) <= HALF - 1 && Math.abs(city.bz[i]) <= HALF - 1, `object ${i} at ${city.bx[i]}, ${city.bz[i]}`);
    }
    for (let t = 0; t < 900; t += 7.7) {
      city.updateMovers(t);
      for (const id of city.moverIds) {
        assert.ok(Number.isFinite(city.x[id]) && Number.isFinite(city.z[id]) && Number.isFinite(city.yaw[id]), `mover ${id} at ${t}`);
        assert.ok(Math.abs(city.x[id]) <= HALF && Math.abs(city.z[id]) <= HALF, `mover ${id} left the city at ${t}`);
      }
    }
  }
});

test('big buildings stand clear of each other and of small things', () => {
  for (const seed of SEEDS) {
    const city = generateCity(seed);
    const big = [];
    for (let i = 0; i < city.n; i++) if (['building', 'tower', 'landmark'].includes(TYPES[city.type[i]].group)) big.push(i);
    assert.ok(big.length >= 30);
    for (let a = 0; a < big.length; a++) {
      for (let b = a + 1; b < big.length; b++) {
        const i = big[a];
        const j = big[b];
        const d = Math.hypot(city.bx[i] - city.bx[j], city.bz[i] - city.bz[j]);
        assert.ok(d > 7.9, `buildings ${i} and ${j} are ${d.toFixed(1)} apart`);
      }
    }
    for (let i = 0; i < city.n; i++) {
      if (city.isMover[i] || big.includes(i)) continue;
      for (const j of big) {
        const d = Math.hypot(city.bx[i] - city.bx[j], city.bz[i] - city.bz[j]);
        assert.ok(d >= (city.r[i] + city.r[j]) * 0.5, `object ${i} (${TYPES[city.type[i]].id}) sits in building ${j} (${d.toFixed(1)})`);
      }
    }
  }
});

test('there are sixteen places to begin, round the edge and clear of big things', () => {
  for (const seed of SEEDS) {
    const city = generateCity(seed);
    assert.equal(city.spawns.length, 16);
    for (const s of city.spawns) {
      assert.ok(Math.abs(s.x) <= HALF && Math.abs(s.z) <= HALF);
      assert.ok(Math.max(Math.abs(s.x), Math.abs(s.z)) >= HALF - 3, 'on the edge');
      for (let i = 0; i < city.n; i++) {
        if (city.r[i] < 2 || city.isMover[i]) continue;
        assert.ok(Math.hypot(city.bx[i] - s.x, city.bz[i] - s.z) > city.r[i], `a ${TYPES[city.type[i]].id} on a spawn`);
      }
    }
  }
});

test('the lobby is a small park with things to practise on', () => {
  const lobby = generateLobby(24601);
  assert.equal(lobby.half, LOBBY_HALF);
  assert.ok(lobby.n >= 60 && lobby.n < 400);
  assert.ok(lobby.countType(T.cone) >= 6);
  assert.ok(lobby.countType(T.bench) >= 4);
  assert.ok(lobby.spawns.length >= 10);
  for (let i = 0; i < lobby.n; i++) assert.ok(Math.abs(lobby.bx[i]) <= LOBBY_HALF && Math.abs(lobby.bz[i]) <= LOBBY_HALF);
  lobby.updateMovers(50);
  for (const id of lobby.moverIds) assert.ok(Number.isFinite(lobby.x[id]));
});

test('the grid finds what is near a point and nothing is lost', () => {
  const city = generateCity(3);
  const grid = city.grid();
  let seen = 0;
  const found = new Set();
  grid.query(0, 0, 200, (id) => {
    found.add(id);
    seen++;
  });
  const statics = city.n - city.moverIds.length;
  assert.equal(found.size, statics);
  assert.equal(seen, statics);
  const near = new Set();
  grid.query(10, -20, 6, (id) => near.add(id));
  for (let i = 0; i < city.n; i++) {
    if (city.isMover[i]) continue;
    if (Math.hypot(city.bx[i] - 10, city.bz[i] + 20) <= 6) assert.ok(near.has(i), `object ${i} within 6 of the point was missed`);
  }
});
