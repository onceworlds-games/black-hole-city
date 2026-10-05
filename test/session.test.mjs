import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, startMatch, run, hostOf, gOf, frame } from './helpers/game.mjs';

test('a solo player plays a whole match: title, lobby, countdown, round, scores, final, back to the lobby', () => {
  const game = makeGame(['ann'], { settings: { time: 90, rounds: 1 } });
  const [ann] = game.clients;
  assert.equal(ann.session.mode, 'title');
  frame(game);
  assert.equal(ann.session.mode, 'title');
  ann.session.start();
  frame(game);
  assert.equal(ann.session.mode, 'lobby');
  assert.ok(ann.session.me, 'my hole is in the lobby');
  run(game, 2000);
  startMatch(game);
  frame(game);
  assert.equal(ann.session.mode, 'countdown');
  run(game, 3100);
  assert.equal(ann.room.match.phase, 'playing');
  frame(game);
  assert.equal(ann.session.mode, 'round');
  assert.ok(gOf(ann), 'the host wrote a record');
  assert.equal(gOf(ann).phase, 'play');
  assert.equal(gOf(ann).roster.length, 6, 'bots fill the table to six');
  let sawScore = false;
  let sawFinal = false;
  const done = run(game, 130000, {
    until: (g) => {
      const rec = gOf(ann);
      if (rec?.phase === 'score') sawScore = true;
      if (rec?.phase === 'final') sawFinal = true;
      return g.hub.ended.length > 0;
    },
  });
  assert.ok(done, 'the match ends');
  assert.ok(sawScore && sawFinal);
  assert.ok(ann.events.some(([n]) => n === 'final'));
  frame(game);
  assert.equal(ann.session.mode, 'lobby');
  assert.ok(ann.session.results, 'the results card stays up over the lobby');
});

import { addClient } from './helpers/game.mjs';

function playUntil(game, predicate, ms = 400000) {
  return run(game, ms, { until: predicate });
}

function eatenFlags(c) {
  return Array.from(c.session.ctx.eaten, (v) => v & 1);
}

test('three players and bots: everyone ends a round with the same eaten set and the host\'s scores', () => {
  const game = makeGame(['ann', 'bob', 'cat'], { settings: { time: 90, rounds: 1 } });
  startMatch(game);
  run(game, 3200);
  assert.equal(game.clients[0].room.match.phase, 'playing');
  const host = hostOf(game);
  assert.ok(playUntil(game, () => gOf(host)?.phase === 'score'), 'the round ends');
  run(game, 700);
  const sim = host.session.host.sim;
  assert.ok(sim, 'the host still has the round');
  const truth = Array.from(sim.eaten);
  assert.ok(sim.eatenCount > 100, 'a lot was eaten');
  for (const c of game.clients) {
    assert.deepEqual(eatenFlags(c), truth, `${c.id} agrees on what was eaten`);
    const g = gOf(c);
    assert.equal(g.phase, 'score');
    assert.deepEqual(g.s, sim.exportState().s, `${c.id} reads the host's scores`);
  }
  // with nobody swallowed, the scores add up to exactly what was eaten
  if (sim.holes.every((h) => h.gulps === 0)) {
    let total = 0;
    for (let i = 0; i < truth.length; i++) if (truth[i]) total += sim.city.value[i];
    assert.equal(sim.holes.reduce((a, h) => a + h.score, 0), total);
  }
  // each person's page counted at least what the host gave them (refused claims are taken back)
  for (const c of game.clients) {
    const seat = c.session.seat;
    assert.ok(seat >= 0);
    assert.ok(c.session.stats.eats >= sim.holes[seat].eats - 2, `${c.id}: page ${c.session.stats.eats} vs host ${sim.holes[seat].eats}`);
  }
});

test('the host leaves in the middle of a round and the match carries on', () => {
  const game = makeGame(['ann', 'bob', 'cat'], { settings: { time: 90, rounds: 1 } });
  startMatch(game);
  run(game, 3200);
  run(game, 30000);
  const before = hostOf(game);
  assert.equal(before.id, 'ann');
  const g0 = JSON.parse(JSON.stringify(gOf(before)));
  assert.ok(g0.s.some((v) => v > 0));
  game.hub.leave('ann');
  game.clients = game.clients.filter((c) => c.id !== 'ann');
  assert.ok(hostOf(game), 'someone else is the host');
  run(game, 300);
  const next = hostOf(game);
  assert.equal(gOf(next).by, next.id, 'the new host took the record');
  assert.ok(next.session.host.sim, 'and has the round');
  assert.ok(playUntil(game, () => game.hub.ended.length > 0), 'the match still ends');
  // scores never went backwards across the change (a leaver keeps their points)
  const fin = next.session.results?.g ?? gOf(next);
  assert.ok(fin.s[0] >= g0.s[0], 'the leaver kept their score');
});

test('a player who comes in late watches, and sees what is going on', () => {
  const game = makeGame(['ann', 'bob'], { settings: { time: 90, rounds: 1 } });
  startMatch(game);
  run(game, 3200);
  run(game, 20000);
  const cat = addClient(game.hub, 'cat');
  game.clients.push(cat);
  cat.session.start();
  run(game, 1500);
  assert.ok(cat.room.spectating);
  assert.equal(cat.session.mode, 'round');
  assert.equal(cat.session.me, null, 'a watcher has no hole of their own');
  assert.equal(cat.session.views.length, 6);
  assert.ok(cat.session.views.some((v) => v.shown));
  // what was eaten before they came is gone for them too, and at the round's end they agree with everyone
  const host = hostOf(game);
  const mine = eatenFlags(cat).reduce((a, b) => a + b, 0);
  const theirs = eatenFlags(host).reduce((a, b) => a + b, 0);
  assert.ok(mine > 0 && mine >= theirs * 0.8, `the watcher sees most of what is gone (${mine} of ${theirs})`);
  assert.ok(playUntil(game, () => gOf(host)?.phase === 'score'));
  run(game, 700);
  assert.deepEqual(eatenFlags(cat), eatenFlags(host));
});

test('three rounds: a new city each round, then the final standings', () => {
  const game = makeGame(['ann', 'bob'], { settings: { time: 90, rounds: 3 } });
  startMatch(game);
  run(game, 3200);
  const seeds = new Set();
  const phases = [];
  assert.ok(
    playUntil(game, () => {
      const g = gOf(hostOf(game));
      if (g) {
        seeds.add(g.seed);
        const tag = `${g.n}${g.phase}`;
        if (phases[phases.length - 1] !== tag) phases.push(tag);
      }
      return game.hub.ended.length > 0;
    }),
  );
  assert.deepEqual(phases, ['1play', '1score', '2play', '2score', '3play', '3score', '3final']);
  assert.equal(seeds.size, 3 + 0, 'three different cities');
});
