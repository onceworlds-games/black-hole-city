// Drives Sessions through a fake platform: frames, the host ticker, and an autopilot standing in for a person.

import { Hub } from './fakeroom.mjs';
import { Session } from '../../src/game/session.js';
import { canEat } from '../../src/logic/rules.js';

export function makeGame(ids, opts = {}) {
  const hub = new Hub(opts);
  const clients = ids.map((id) => addClient(hub, id));
  return { hub, clients, sinceTick: 0 };
}

export function addClient(hub, id) {
  const room = hub.join(id);
  const session = new Session({ room, now: () => hub.now(), autoTick: false });
  const events = [];
  for (const name of ['eat', 'fall', 'vanish', 'restore', 'gulp', 'swallowed', 'born', 'phase', 'final', 'grow', 'hint', 'world', 'round']) session.on(name, (d) => events.push([name, d]));
  return { id, room, session, events };
}

/** Everyone presses Play and readies; the host starts the countdown (the room would, in a public server). */
export function startMatch(game) {
  for (const c of game.clients) c.session.start();
  for (const c of game.clients) c.room.setReady(true);
  game.hub.startCountdown();
}

/** Steers toward the nearest thing the hole can swallow; wanders toward the middle when nothing is near. */
export function steer(session) {
  const me = session.me;
  const ctx = session.ctx;
  if (!me || !ctx || !ctx.city) return;
  let bx = 0;
  let bz = 0;
  let best = Infinity;
  const { city, grid, eaten } = ctx;
  grid.query(me.x, me.z, 22 + me.R * 2, (id) => {
    if (eaten[id] || !canEat(me.R, city.r[id])) return;
    const d = Math.hypot(city.x[id] - me.x, city.z[id] - me.z);
    if (d < best) {
      best = d;
      bx = city.x[id];
      bz = city.z[id];
    }
  });
  if (best === Infinity) {
    bx = -me.x * 0.3;
    bz = -me.z * 0.3;
    best = Math.hypot(bx - me.x, bz - me.z);
  }
  const dx = bx - me.x;
  const dz = bz - me.z;
  const d = Math.hypot(dx, dz) || 1;
  session.input.x = dx / d;
  session.input.z = dz / d;
}

/** One frame of everything: the clock, every page, and the host's ticker every 100 ms. */
export function frame(game, { autopilot = true, ms = 16 } = {}) {
  game.hub.advance(ms);
  game.sinceTick += ms;
  for (const c of game.clients) {
    if (autopilot) steer(c.session);
    c.session.update(ms / 1000);
  }
  if (game.sinceTick >= 100) {
    game.sinceTick = 0;
    for (const c of game.clients) c.session.host.tick();
  }
}

export function run(game, ms, opts = {}) {
  const frames = Math.ceil(ms / (opts.ms ?? 16));
  for (let i = 0; i < frames; i++) {
    frame(game, opts);
    if (opts.until && opts.until(game)) return true;
  }
  return false;
}

export const hostOf = (game) => game.clients.find((c) => c.room.isHost);
export const gOf = (c) => c.room.state.g;
