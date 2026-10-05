// The page loaded in the middle of someone else's match: the first tap skips the title, the player watches, and a closed
// room gives one message and one button that joins again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { installDom } from './helpers/fakedom.mjs';
import { Hub } from './helpers/fakeroom.mjs';
import { addClient, steer } from './helpers/game.mjs';
import { FakeAudioContext } from './helpers/fakeaudio.mjs';

register('./helpers/loader.mjs', import.meta.url);

test('a page that loads mid-match skips the title on the first tap and watches; a closed room offers a way back', async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  const dom = installDom({ width: 900, height: 420 });
  globalThis.AudioContext = FakeAudioContext;
  const hub = new Hub({ settings: { time: 90, rounds: 1 } });
  const intervals = [];
  globalThis.setInterval = (fn, ms) => {
    intervals.push({ fn, ms, last: 0 });
    return intervals.length;
  };
  const bob = addClient(hub, 'bob');
  const cat = addClient(hub, 'cat');
  for (const c of [bob, cat]) c.session.start();
  bob.room.setReady(true);
  cat.room.setReady(true);
  hub.startCountdown();
  hub.advance(3100);
  // the third player arrives now
  const room = hub.join('ann', 'Ann');
  assert.ok(room.spectating);
  let joins = 0;
  const controlsLog = [];
  globalThis.onceworlds = {
    mode: 'platform',
    env: {},
    player: { get: async () => ({ id: 'ann', name: 'Ann', guest: true }), avatarUrl: async () => null },
    save: { get: async () => null, set: async () => {}, delete: async () => {}, list: async () => [] },
    badges: { award: async () => false, list: async () => [], has: async () => false },
    leaderboards: { submit: async () => null },
    rooms: {
      join: async () => {
        joins++;
        return joins === 1 ? room : hub.join('ann2', 'Ann');
      },
      on() {},
    },
    ui: { setOrientation() {}, setMenuPosition() {}, requestFullscreen() {}, showInvite() {} },
    controls: { set: (c) => controlsLog.push(c), stick: { x: 0, y: 0 }, pressed: () => false, touch: true },
    settings: { quality: 'low', scale: 0.8, reducedMotion: true, pixelRatio: () => 0.8, on() {} },
    now: () => hub.now(),
    on() {},
  };
  await import('../src/main.js');
  for (let i = 0; i < 200 && dom.frames.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  let t = 0;
  const frame = (ms = 16) => {
    hub.advance(ms);
    t += ms;
    if (FakeAudioContext.last) FakeAudioContext.last.currentTime = t / 1000;
    for (const iv of intervals) if (t - iv.last >= iv.ms) {
      iv.last = t;
      iv.fn();
    }
    for (const c of [bob, cat]) {
      c.session.host.tick();
      steer(c.session);
      c.session.update(ms / 1000);
    }
    dom.step(t);
  };
  const run = (ms, until) => {
    for (let i = 0; i < Math.ceil(ms / 16); i++) {
      frame();
      if (until?.()) return true;
    }
    return false;
  };
  const ui = dom.ids.ui;
  const visible = (cls) => ui.find(cls).some((n) => !n.hidden);
  run(400);
  assert.ok(visible('title'), 'the title shows');
  assert.ok(!visible('watch'));
  // the first tap anywhere starts it
  dom.fire('pointerdown', { target: dom.ids.game, button: 0, pointerType: 'touch', clientX: 450, clientY: 200, pointerId: 1 });
  run(600);
  assert.ok(!visible('title'), 'the title is gone');
  assert.ok(visible('watch'), 'a Watching label');
  assert.ok(visible('clock'), 'the clock still runs for a watcher');
  assert.ok(!ui.find('me')[0] || ui.find('me')[0].hidden, 'no score of my own');
  assert.equal(controlsLog[controlsLog.length - 1] ?? null, null, 'no touch controls for a watcher');
  assert.ok(ui.classList.contains('watching'), 'the HUD makes room for the platform note');
  // a tap switches to the next hole (a quick press and release)
  dom.fire('pointerdown', { target: dom.ids.game, button: 0, pointerType: 'touch', clientX: 450, clientY: 200, pointerId: 2 });
  dom.fire('pointerup', { target: dom.ids.game, pointerType: 'touch', clientX: 451, clientY: 200, pointerId: 2 });
  run(200);
  // the room closes
  room.emit('close', 'disconnected');
  run(100);
  assert.ok(visible('msg'), 'one message');
  assert.equal(ui.find('msg')[0].find('play').length, 1, 'and one button');
  ui.find('msg')[0].find('play')[0].onclick();
  await new Promise((r) => setTimeout(r, 20));
  run(300);
  assert.equal(joins, 2, 'the button joined again');
  assert.ok(!visible('msg'), 'the message is gone');
  run(3000);
  assert.deepEqual(errors, [], `nothing threw: ${errors.join('\n')}`);
  console.error = origError;
});
