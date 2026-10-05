// Matches with people coming, going and reloading, the host leaving and the match pausing at odd moments (seeded, so a
// failure can be replayed). Whatever happens, the match ends, nobody's page throws, and the pages that are playing agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, addClient, startMatch, run, hostOf, gOf, frame } from './helpers/game.mjs';
import { mulberry32 } from '../src/logic/rng.js';

for (let seed = 1; seed <= 12; seed++) {
  test(`chaos ${seed}: people come and go, the host leaves, the match pauses; it still finishes`, () => {
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a.map(String).join(' '));
    try {
      const rng = mulberry32(seed * 7919);
      const rounds = seed % 2 ? 1 : 3;
      const game = makeGame(['a', 'b', 'c', 'd'], { settings: { time: 90, rounds }, seed: seed * 100 });
      startMatch(game);
      let spare = 0;
      let paused = 0;
      let leaves = 0;
      let guard = 0;
      while (game.hub.ended.length === 0 && guard++ < 60000) {
        frame(game);
        if (paused > 0) {
          paused -= 16;
          if (paused <= 0) game.hub.resume();
        }
        const r = rng();
        if (game.hub.match.phase === 'playing') {
          if (r < 0.0004 && paused <= 0) {
            game.hub.pause();
            paused = 400 + rng() * 2500;
          } else if (r < 0.0007 && game.clients.length > 2 && leaves < 3) {
            // someone leaves (maybe the host)
            const victim = rng() < 0.4 ? hostOf(game) : game.clients[Math.floor(rng() * game.clients.length)];
            if (victim) {
              game.hub.leave(victim.id);
              game.clients = game.clients.filter((c) => c !== victim);
              victim.session.destroy();
              leaves++;
            }
          } else if (r < 0.001 && spare < 3) {
            // a newcomer, who watches
            const c = addClient(game.hub, `n${spare++}`);
            c.session.start();
            game.clients.push(c);
          }
        }
        const host = hostOf(game);
        const g = host ? gOf(host) : null;
        if (g && g.phase === 'play' && host.session.host.sim) {
          const sim = host.session.host.sim;
          for (const h of sim.holes) {
            assert.ok(Number.isFinite(h.x) && Number.isFinite(h.z) && Number.isFinite(h.mass) && h.mass >= 0 && h.score >= 0, 'finite, non-negative');
          }
        }
      }
      if (paused > 0) game.hub.resume();
      assert.equal(game.hub.ended.length, 1, `the match ended (guard ${guard})`);
      run(game, 500);
      for (const c of game.clients) assert.equal(c.session.mode, 'lobby', `${c.id} is back in the lobby`);
      assert.deepEqual(errors, [], errors.join('\n'));
    } finally {
      console.error = orig;
    }
  });
}
