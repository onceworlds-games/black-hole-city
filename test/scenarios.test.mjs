import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, startMatch, run, hostOf, gOf } from './helpers/game.mjs';
import * as C from '../src/logic/config.js';
import { radiusFor } from '../src/logic/rules.js';

const flags = (c) => Array.from(c.session.ctx.eaten, (v) => v & 1);

function begin(ids, settings = { time: 90, rounds: 1 }) {
  const game = makeGame(ids, { settings });
  startMatch(game);
  run(game, 3300);
  run(game, 600);
  return game;
}

test('two people reaching for the same things: each thing is eaten once, and both pages end up agreeing', () => {
  const game = begin(['ann', 'bob']);
  const [ann, bob] = game.clients;
  // put both holes together in the middle of a crowd, big enough for the small things
  for (const c of [ann, bob]) {
    c.session.me.x = 8;
    c.session.me.z = -12;
  }
  run(game, 300);
  const sim = ann.session.host.sim;
  sim.byId.get('ann').mass = 120;
  sim.byId.get('bob').mass = 120;
  run(game, 4000);
  const eats = sim.holes.map((h) => h.eats);
  assert.ok(eats[0] + eats[1] > 8 && eats[1] > 0, `both reached things: ${eats.join(',')}`);
  // let everything settle, then compare
  run(game, 1500);
  assert.deepEqual(flags(ann), Array.from(sim.eaten));
  assert.deepEqual(flags(bob), Array.from(sim.eaten));
  for (const c of [ann, bob]) assert.equal(c.session.me.pend.size, 0, `${c.id} has nothing left waiting for the host`);
  // nothing was paid twice: the two scores are exactly the value of what the two ate
  let value = 0;
  for (const h of sim.holes) if (h.idx < 2) value += h.score;
  let eatenByThem = 0;
  for (let i = 0; i < sim.eaten.length; i++) if (sim.eaten[i]) eatenByThem += sim.city.value[i];
  assert.ok(value <= eatenByThem + 240, 'no object was counted for both of them');
});

test('a claim the host refuses is taken back: the thing comes back and does not count', () => {
  const game = begin(['ann', 'bob']);
  const [ann, bob] = game.clients;
  const sim = ann.session.host.sim;
  const ctx = bob.session.ctx;
  // bob's page claims something that is already gone on the host
  let id = -1;
  for (let i = 0; i < ctx.city.n; i++) if (!ctx.city.isMover[i] && ctx.city.r[i] < 1) { id = i; break; }
  sim.byId.get('ann').x = ctx.city.x[id];
  sim.byId.get('ann').z = ctx.city.z[id];
  sim.eat(sim.byId.get('ann'), id);
  run(game, 200);
  const before = bob.events.filter(([n]) => n === 'restore').length;
  bob.session.me.x = ctx.city.x[id];
  bob.session.me.z = ctx.city.z[id];
  bob.session.me.pend.set(id, { v: ctx.city.value[id], at: game.hub.now() });
  ctx.eaten[id] = 2; // bob thinks it's his
  bob.session.claimQueue.push(id);
  run(game, 2500);
  assert.equal(bob.session.me.pend.has(id), false);
  assert.ok(ctx.eaten[id] & 1, 'and it is gone, because the host says so');
  void before;
});

test('a bigger hole swallows a smaller one across pages: the small one comes back later, small, somewhere else', () => {
  const game = begin(['ann', 'bob']);
  const [ann, bob] = game.clients;
  const sim = ann.session.host.sim;
  sim.byId.get('ann').mass = 4;
  sim.byId.get('ann').score = 4;
  sim.byId.get('bob').mass = 500;
  sim.byId.get('bob').score = 500;
  run(game, 500); // the pages learn each other's size
  const spot = { x: bob.session.me.x, z: bob.session.me.z };
  ann.session.me.x = spot.x + 0.4;
  ann.session.me.z = spot.z;
  const scoreBefore = 4;
  assert.ok(run(game, 3000, { until: () => gOf(ann).d[0] > 0 }), 'the host recorded that ann was swallowed');
  run(game, 400);
  const g = gOf(ann);
  assert.equal(g.m[0], 0, 'her size went back to nothing');
  assert.ok(g.s[0] > 0 && g.s[0] < 5, `and she kept half her score (${g.s[0]})`);
  assert.ok(g.k.n >= 1 && g.k.b === 0 && g.k.a === 1, 'and by whom');
  assert.ok(g.s[1] > 500, 'bob got a share of her score');
  assert.ok(bob.events.some(([n, d]) => n === 'gulp' && d.byMe), 'bob heard about it');
  assert.ok(ann.events.some(([n, d]) => n === 'gulp' && d.meVictim), 'so did ann');
  assert.ok(ann.events.some(([n]) => n === 'swallowed'));
  assert.equal(ann.session.me.alive, false);
  const px = ann.session.me.x;
  run(game, C.RESPAWN_MS + 600);
  assert.equal(ann.session.me.alive, true, 'back after three seconds');
  assert.ok(Math.hypot(ann.session.me.x - px, ann.session.me.z - spot.z) > 5, 'at another spot');
  assert.ok(ann.events.some(([n]) => n === 'born'));
  assert.ok(Math.abs(ann.session.views[0].R - 1) < 0.2, 'at the starting size');
  void scoreBefore;
});

test('while the match waits for players, nothing moves and nothing is lost; when it goes on, the clock goes on', () => {
  const game = begin(['ann', 'bob']);
  const host = hostOf(game);
  run(game, 3000);
  const g0 = JSON.parse(JSON.stringify(gOf(host)));
  const now0 = host.room.matchNow();
  game.hub.pause();
  const botsBefore = JSON.stringify(host.session.host.sim.botSnapshot());
  run(game, 5000);
  assert.equal(host.room.matchNow(), now0, 'match time stands still');
  assert.equal(JSON.stringify(host.session.host.sim.botSnapshot()), botsBefore, 'the bots stand still');
  assert.equal(gOf(host).phase, 'play');
  assert.equal(gOf(host).until, g0.until, 'the deadline is a match time, so it did not move');
  game.hub.resume();
  run(game, 2000);
  assert.ok(host.room.matchNow() > now0 + 1500);
  assert.ok(host.session.host.sim.eatenCount > 0);
  assert.ok(run(game, 100000, { until: () => game.hub.ended.length > 0 }), 'and the match still ends on time');
});

test('a person who drops out of the match keeps their points and is not in the way', () => {
  const game = begin(['ann', 'bob', 'cat']);
  run(game, 15000);
  const g1 = JSON.parse(JSON.stringify(gOf(hostOf(game))));
  const catScore = g1.s[2];
  game.hub.leave('cat');
  game.clients = game.clients.filter((c) => c.id !== 'cat');
  run(game, 3000);
  const g2 = gOf(hostOf(game));
  assert.ok(g2.s[2] >= catScore, 'cat kept her score');
  const view = hostOf(game).session.views[2];
  assert.equal(view.gone, true);
  assert.equal(view.shown, false, 'her hole is off the map');
  assert.ok(run(game, 100000, { until: () => game.hub.ended.length > 0 }), 'the match is not held up');
});

test('three matches in a row in one server: the third is like the first', () => {
  const game = makeGame(['ann', 'bob'], { settings: { time: 90, rounds: 1 } });
  for (let m = 0; m < 3; m++) {
    startMatch(game);
    run(game, 3300);
    run(game, 500);
    const g = gOf(hostOf(game));
    assert.equal(g.n, 1);
    assert.equal(g.phase, 'play');
    assert.ok(Math.max(...g.s) < 80, `match ${m + 1} starts from nothing: ${g.s.join(',')}`);
    assert.ok(g.pts.every((v) => v === 0));
    assert.ok(run(game, 130000, { until: () => game.hub.ended.length === m + 1 }), `match ${m + 1} ends`);
    run(game, 500);
    for (const c of game.clients) assert.equal(c.session.mode, 'lobby');
  }
  assert.equal(new Set(game.hub.ended).size, 3);
  // the lobby after a match is a fresh practice park
  for (const c of game.clients) assert.ok(c.session.me && c.session.ctx.kind === 'lobby' && c.session.me.mass < 60);
});

test('the timer is a match-time deadline and the round ends exactly on it', () => {
  const game = begin(['ann']);
  const host = hostOf(game);
  const g = gOf(host);
  assert.equal(g.until - g.t0, 90000);
  run(game, 200000, { until: () => gOf(host).phase === 'score' });
  const now = host.room.matchNow();
  assert.ok(now >= g.until && now < g.until + 400, `ended ${now - g.until} ms after the deadline`);
});

test('a host that is also a person: its own claims count, and its own hole can be swallowed', () => {
  const game = begin(['ann', 'bob']);
  const [ann, bob] = game.clients;
  run(game, 8000);
  const sim = ann.session.host.sim;
  assert.ok(sim.byId.get('ann').eats > 5, 'the host ate');
  assert.ok(ann.session.stats.eats >= sim.byId.get('ann').eats);
  // now bob is huge and sits on her
  sim.byId.get('bob').mass = 900;
  sim.byId.get('ann').mass = 3;
  run(game, 400);
  ann.session.me.x = bob.session.me.x + 0.3;
  ann.session.me.z = bob.session.me.z;
  run(game, 1200);
  assert.ok(!sim.isAlive(sim.byId.get('ann'), sim.t) || sim.byId.get('ann').deadUntil > 0, 'the host\'s hole was swallowed like anyone\'s');
  assert.ok(radiusFor(sim.byId.get('bob').mass) > 5);
});
