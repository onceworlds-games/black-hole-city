import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/logic/city.js';
import { Sim, spawnPlan } from '../src/logic/sim.js';
import { BotBrain } from '../src/logic/bots.js';
import { radiusFor, collectSwallows } from '../src/logic/rules.js';
import { buildRoster, citySeed, roundResult, finalOrder, roundId, roundKey, placeLabel, seatCount } from '../src/logic/match.js';
import { mulberry32, hashSeed } from '../src/logic/rng.js';
import { T } from '../src/logic/objects.js';
import { decodeEaten } from '../src/logic/bits.js';
import * as C from '../src/logic/config.js';

const humans = (...ids) => ids.map((id) => ({ id, bot: false }));

function simWith(roster, seed = 3) {
  const city = generateCity(seed);
  return new Sim(city, roster, { seed });
}

/** A person's hole put right on an object, big enough for it. */
function stand(sim, id, x, z, mass) {
  const h = sim.byId.get(id);
  h.x = x;
  h.z = z;
  h.mass = mass;
  h.posAt = sim.t;
}

function firstOf(city, type) {
  for (let i = 0; i < city.n; i++) if (city.type[i] === type && !city.isMover[i]) return i;
  return -1;
}

test('seats begin spread round the edge, the same everywhere from the same seed', () => {
  const city = generateCity(4);
  const a = spawnPlan(city, 77, 6);
  const b = spawnPlan(city, 77, 6);
  assert.deepEqual(a, b);
  assert.equal(a.length, 6);
  assert.equal(new Set(a.map((s) => `${s.x},${s.z}`)).size, 6, 'six different spots');
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) >= 25, 'far apart');
  assert.equal(spawnPlan(city, 5, 10).length, 10);
  assert.equal(new Set(spawnPlan(city, 5, 10).map((s) => `${s.x},${s.z}`)).size, 10);
});

test('a claim for something in the hole is accepted once, and the first claim wins', () => {
  const sim = simWith(humans('ann', 'bob'));
  const id = firstOf(sim.city, T.bench);
  const x = sim.city.x[id];
  const z = sim.city.z[id];
  stand(sim, 'ann', x, z, 5);
  stand(sim, 'bob', x + 0.5, z, 5);
  const first = sim.claim('ann', [id], 1000);
  assert.deepEqual([first.accepted, first.refused], [1, 0]);
  const second = sim.claim('bob', [id], 1010);
  assert.deepEqual([second.accepted, second.refused], [0, 1]);
  assert.deepEqual(second.refusedIds, [id]);
  assert.equal(sim.byId.get('ann').score, sim.city.value[id]);
  assert.equal(sim.byId.get('bob').score, 0);
  assert.equal(sim.eaten[id], 1);
  assert.equal(sim.claim('ann', [id], 1020).accepted, 0, 'not twice');
  assert.equal(sim.byId.get('ann').score, sim.city.value[id], 'and not paid twice');
});

test('claims are checked: too big, too far, dead, junk', () => {
  const sim = simWith(humans('ann'));
  const house = firstOf(sim.city, T.house0);
  const bench = firstOf(sim.city, T.bench);
  const hx = sim.city.x[house];
  const hz = sim.city.z[house];
  stand(sim, 'ann', hx, hz, 0); // radius 1 over a house
  assert.equal(sim.claim('ann', [house], 100).accepted, 0, 'a house is too big for radius 1');
  stand(sim, 'ann', sim.city.x[bench] + 30, sim.city.z[bench], 5);
  assert.equal(sim.claim('ann', [bench], 100).accepted, 0, 'thirty units away');
  stand(sim, 'ann', sim.city.x[bench], sim.city.z[bench], 5);
  const junk = [-1, 1.5, 'x', null, NaN, sim.city.n, sim.city.n + 5, {}, [], undefined];
  const r = sim.claim('ann', junk, 100);
  assert.equal(r.accepted, 0);
  assert.equal(sim.claim('ann', 'not a list', 100).accepted, 0);
  assert.equal(sim.claim('nobody', [bench], 100).accepted, 0);
  sim.byId.get('ann').deadUntil = 5000;
  assert.equal(sim.claim('ann', [bench], 100).accepted, 0, 'a dead hole eats nothing');
  sim.byId.get('ann').deadUntil = 0;
  assert.equal(sim.claim('ann', [bench], 6000).accepted, 1, 'and once back, it does');
});

test('a hole that claims too fast is held to a rate', () => {
  const sim = simWith(humans('ann'));
  const h = sim.byId.get('ann');
  h.mass = 1e6; // huge: everything is eatable and in reach
  h.x = 0;
  h.z = 0;
  const ids = [];
  sim.grid.query(0, 0, 100, (id) => ids.push(id));
  assert.ok(ids.length > 1000, `${ids.length} objects`);
  let taken = 0;
  for (let k = 0; k < ids.length; k += 40) taken += sim.claim('ann', ids.slice(k, k + 40), 1000).accepted;
  assert.ok(taken <= C.CLAIM_BURST + 2, `took ${taken} in one instant`);
  assert.ok(taken >= C.CLAIM_BURST - 5);
});

test('a bigger hole swallows a smaller one: it grows 30 percent of theirs, they keep half the score and come back later', () => {
  const sim = simWith(humans('ann', 'bob'));
  const ann = sim.byId.get('ann');
  const bob = sim.byId.get('bob');
  ann.mass = 300;
  ann.score = 300;
  bob.mass = 40;
  bob.score = 40;
  ann.x = 0;
  ann.z = 0;
  bob.x = 0.5;
  bob.z = 0;
  assert.ok(radiusFor(ann.mass) > radiusFor(bob.mass) * 1.25);
  assert.equal(sim.gulp('ann', 'bob', 5000), true);
  assert.equal(ann.score, 312);
  assert.equal(ann.mass, 312);
  assert.equal(bob.score, 20);
  assert.equal(bob.mass, 0);
  assert.equal(bob.deadUntil, 5000 + C.RESPAWN_MS);
  assert.ok(!sim.isAlive(bob, 6000));
  assert.ok(sim.isAlive(bob, 8000));
  assert.ok(sim.isProtected(bob, 9000) && !sim.isProtected(bob, 11000), 'two protected seconds after coming back');
  assert.equal(sim.gulp('ann', 'bob', 6000), false, 'a dead hole can not be swallowed again');
  assert.equal(sim.gulp('bob', 'ann', 9000), false, 'the small one can not swallow the big one');
  const kills = sim.drainKills();
  assert.equal(kills.length, 1);
  assert.deepEqual([kills[0].a, kills[0].b], [0, 1]);
  assert.ok(sim.spawnPick(bob, 5000), 'a spot to come back at');
  // too far apart, or not big enough: refused
  bob.deadUntil = 0;
  bob.x = 30;
  assert.equal(sim.gulp('ann', 'bob', 20000), false, 'far away');
  bob.x = 0.5;
  bob.mass = 250;
  assert.equal(sim.gulp('ann', 'bob', 20000), false, 'nearly as big');
});

test('bots swallow holes too, and run from bigger ones', () => {
  const sim = simWith([{ id: 'bot1', bot: true, name: 'A' }, { id: 'bot2', bot: true, name: 'B' }, ...humans('ann')]);
  const [a, b, ann] = sim.holes;
  a.mass = 600;
  a.x = 0;
  a.z = 0;
  ann.x = 0.3;
  ann.z = 0;
  ann.mass = 20;
  ann.score = 20;
  b.x = 60;
  b.z = 60;
  sim.advanceTo(100);
  assert.ok(!sim.isAlive(ann, sim.t), 'the human under the big bot was swallowed');
  assert.ok(a.gulps >= 1 && a.mass > 600);
  // a small bot beside a huge hole turns and runs
  const sim2 = simWith([{ id: 'bot1', bot: true, name: 'A' }, { id: 'bot2', bot: true, name: 'B' }], 8);
  const [big, small] = sim2.holes;
  big.mass = 1500;
  big.x = 0;
  big.z = 0;
  big.brain.timer = 99;
  small.x = 8;
  small.z = 0;
  small.vx = small.vz = 0;
  small.brain.timer = 0;
  small.brain.nerve = 1.3;
  const d0 = Math.hypot(small.x - big.x, small.z - big.z);
  for (let t = 33; t <= 1500; t += 33) {
    sim2.advanceTo(t);
    big.x = 0;
    big.z = 0;
    big.vx = big.vz = 0;
  }
  assert.ok(sim2.isAlive(small, sim2.t), 'it was not caught');
  assert.ok(Math.hypot(small.x - big.x, small.z - big.z) > d0 + 3, 'it ran away');
});

test('what the host publishes can be loaded by a new host', () => {
  const sim = simWith([{ id: 'bot1', bot: true, name: 'A' }, ...humans('ann')], 5);
  sim.byId.get('ann').x = 0;
  sim.byId.get('ann').z = 0;
  for (let t = 33; t <= 20000; t += 33) sim.advanceTo(t);
  const state = JSON.parse(JSON.stringify(sim.exportState()));
  const bits = sim.eatenText();
  const bots = JSON.parse(JSON.stringify(sim.botSnapshot()));
  assert.ok(sim.eatenCount > 10);
  const next = new Sim(sim.city, [{ id: 'bot1', bot: true, name: 'A' }, ...humans('ann')], { seed: 5, startMs: 20000 });
  next.importState(state);
  assert.ok(next.loadEaten(bits));
  next.loadBots(bots);
  assert.deepEqual(next.eaten, sim.eaten);
  assert.equal(next.eatenCount, sim.eatenCount);
  assert.deepEqual(next.exportState(), sim.exportState());
  assert.ok(Math.abs(next.holes[0].x - sim.holes[0].x) < 0.01);
  assert.equal(next.loadEaten('!!'), false);
  next.importState({ s: 'junk' });
  next.importState(null);
});

test('ranking orders by score, then mass, then seat', () => {
  const res = roundResult([10, 50, 50, 5], [10, 40, 60, 5]);
  assert.deepEqual(res.map((r) => r.idx), [2, 1, 0, 3]);
  assert.deepEqual(res.map((r) => r.points), C.PLACE_POINTS.slice(0, 4));
  assert.deepEqual(finalOrder([10, 20, 20], [5, 9, 100]), [2, 1, 0]);
  assert.deepEqual(roundResult([0, 0, 0], [0, 0, 0]).map((r) => r.idx), [0, 1, 2]);
  assert.equal(placeLabel(0), '1ST');
  assert.equal(placeLabel(4), '5TH');
  assert.equal(placeLabel(1), '2ND');
});

test('a roster is people first, then bots with their own names, up to the table size', () => {
  const r = buildRoster(['a', 'b'], 12);
  assert.equal(r.length, C.TABLE);
  assert.deepEqual(r.slice(0, 2).map((e) => e.bot), [false, false]);
  assert.ok(r.slice(2).every((e) => e.bot && /^bot\d$/.test(e.id) && e.name));
  assert.equal(new Set(r.slice(2).map((e) => e.name)).size, 4, 'names differ');
  assert.deepEqual(buildRoster(['a', 'b'], 12), r, 'the same on every page');
  assert.equal(buildRoster(Array.from({ length: 10 }, (_, i) => 'p' + i), 1).length, 10, 'a full room has no bots');
  assert.equal(buildRoster(Array.from({ length: 12 }, (_, i) => 'p' + i), 1).length, 10, 'and never more than ten');
  assert.equal(seatCount(3), C.TABLE);
  assert.notEqual(citySeed(5, 1), citySeed(5, 2));
  assert.equal(citySeed(5, 1), citySeed(5, 1));
  assert.equal(roundId('m1', 2), 'm1.2');
  assert.notEqual(roundKey('m1.1'), roundKey('m1.2'));
  assert.equal(roundKey(null), 0);
});

// ------------------------------------------------------------------------------------------------ a whole match with nobody but bots

function playRound(seed, roster, timeMs, wrapHuman) {
  const city = generateCity(seed);
  const sim = new Sim(city, roster, { seed, startMs: 0 });
  const human = sim.holes.find((h) => !h.bot);
  const brain = human ? new BotBrain(mulberry32(hashSeed(seed, 'human'))) : null;
  const scratch = [];
  for (let t = 33; t <= timeMs; t += 33) {
    if (human && sim.isAlive(human, t)) {
      // a person's page: it moves its hole and claims what it swallows; the host only ever hears the claims
      const dt = 0.033;
      brain.update(sim, human, dt);
      const ids = collectSwallows(city, sim.grid, sim.eaten, human.x, human.z, radiusFor(human.mass), scratch).slice();
      if (ids.length) sim.claim(human.id, ids, t);
    }
    sim.advanceTo(t);
    if (wrapHuman) wrapHuman(sim, t);
  }
  return sim;
}

test('a whole match with only bots: every round ends, everyone is ranked, nothing is NaN or out of bounds (20 seeds)', () => {
  const rounds = 3;
  for (let seed = 1; seed <= 20; seed++) {
    const matchSeed = hashSeed('match', seed);
    const roster = buildRoster([], matchSeed);
    const pts = roster.map(() => 0);
    const tot = roster.map(() => 0);
    for (let n = 1; n <= rounds; n++) {
      const sim = playRound(citySeed(matchSeed, n), roster, C.TIME_OPTIONS[0] * 1000);
      const st = sim.exportState();
      for (const h of sim.holes) {
        assert.ok(Number.isFinite(h.x) && Number.isFinite(h.z) && Number.isFinite(h.vx) && Number.isFinite(h.vz), `seed ${seed} round ${n}: ${h.id} is finite`);
        assert.ok(Number.isFinite(h.mass) && Number.isFinite(h.score) && h.mass >= 0 && h.score >= 0);
        const lim = sim.city.half + 0.01;
        assert.ok(Math.abs(h.x) <= lim && Math.abs(h.z) <= lim, `seed ${seed}: ${h.id} out of bounds at ${h.x}, ${h.z}`);
      }
      assert.ok(sim.eatenCount > 100, 'the bots ate');
      assert.ok(sim.eatenCount <= sim.city.n);
      assert.deepEqual(decodeEaten(sim.eatenText(), sim.city.n), sim.eaten, 'the eaten set survives packing');
      const res = roundResult(st.s, st.m);
      assert.equal(res.length, roster.length, 'everyone is ranked');
      assert.deepEqual(res.map((r) => r.idx).sort(), roster.map((_, i) => i), 'each seat once');
      for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].score >= res[i].score);
      for (const r of res) {
        pts[r.idx] += r.points;
        tot[r.idx] += r.score;
      }
    }
    const order = finalOrder(pts, tot);
    assert.equal(order.length, roster.length);
    assert.equal(new Set(order).size, roster.length);
    assert.ok(pts[order[0]] >= pts[order[order.length - 1]]);
  }
});

test('growth feels right: quick at first, a leader near radius 8 or so after two minutes, most of the city eaten, the landmark late', () => {
  const stats = [];
  for (let seed = 1; seed <= 8; seed++) {
    const roster = buildRoster([], seed);
    const marks = {};
    const sim = playRound(seed, roster, 120000, (s, t) => {
      for (const m of [15000, 30000, 60000]) if (t === Math.round(m / 33) * 33) marks[m] = Math.max(...s.holes.map((h) => radiusFor(h.mass)));
    });
    const top = Math.max(...sim.holes.map((h) => radiusFor(h.mass)));
    stats.push({ seed, top, m15: marks[15000], m30: marks[30000], m60: marks[60000], eaten: sim.eatenCount / sim.city.n });
  }
  for (const s of stats) {
    assert.ok(s.m15 >= 1.7, `radius ${s.m15?.toFixed(1)} after 15 s: cars soon`);
    assert.ok(s.m30 >= 2.4 && s.m30 <= 5, `radius ${s.m30?.toFixed(1)} after 30 s`);
    assert.ok(s.m60 >= 4 && s.m60 <= 8.5, `radius ${s.m60?.toFixed(1)} after a minute`);
    assert.ok(s.top >= 6.5 && s.top <= 12.5, `the leader ends at radius ${s.top.toFixed(1)}`);
    assert.ok(s.eaten >= 0.55 && s.eaten <= 0.99, `${Math.round(s.eaten * 100)}% eaten`);
  }
});

test('one person among bots (claims through the host): the round plays out like an all bot one', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const roster = buildRoster(['ann'], seed);
    const sim = playRound(seed, roster, 90000);
    const ann = sim.byId.get('ann');
    assert.ok(ann.eats > 40 || ann.gulps > 0 || !sim.isAlive(ann, 90000) || ann.score > 100, `ann got going (${ann.eats} eaten, score ${ann.score})`);
    for (const h of sim.holes) assert.ok(Number.isFinite(h.x) && Number.isFinite(h.mass));
  }
});
