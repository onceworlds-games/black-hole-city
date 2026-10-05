// Runs the real page code (main.js, the screens, the overlay, the stage) in node with a stand-in for the browser and for
// the platform, through a whole match. It checks what is on screen at each step and that nothing threw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { installDom } from './helpers/fakedom.mjs';
import { Hub } from './helpers/fakeroom.mjs';
import { addClient, steer } from './helpers/game.mjs';
import { FakeAudioContext } from './helpers/fakeaudio.mjs';

register('./helpers/loader.mjs', import.meta.url);

test('the whole page: title, play, lobby, countdown, a round, the podium, back to the lobby', async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  const dom = installDom();
  globalThis.AudioContext = FakeAudioContext;
  const hub = new Hub({ settings: { time: 90, rounds: 1 } });
  const intervals = [];
  globalThis.setInterval = (fn, ms) => {
    intervals.push({ fn, ms, last: 0 });
    return intervals.length;
  };
  const room = hub.join('ann', 'Ann');
  const bob = addClient(hub, 'bob');
  bob.session.start();
  const saved = {};
  const awarded = [];
  const boards = [];
  const controlsLog = [];
  const stick = { x: 0, y: 0 };
  globalThis.onceworlds = {
    mode: 'platform',
    env: {},
    player: { get: async () => ({ id: 'ann', name: 'Ann', guest: false }), avatarUrl: async (id) => (id.startsWith('bot') ? null : `data:image/svg+xml,${id}`) },
    save: { get: async () => ({ matches: 2, wins: 1 }), set: async (k, v) => (saved[k] = v), delete: async () => {}, list: async () => [] },
    badges: { award: async (id) => (awarded.push(id), true), list: async () => [], has: async () => false },
    leaderboards: { submit: async (...a) => (boards.push(a), null) },
    rooms: { join: async () => room, on() {} },
    ui: { setOrientation() {}, setMenuPosition() {}, requestFullscreen() {}, showInvite() {} },
    controls: { set: (c) => controlsLog.push(c), stick, pressed: () => false, touch: false },
    settings: { quality: 'high', scale: 1, reducedMotion: false, pixelRatio: () => 1, on() {} },
    now: () => hub.now(),
    on() {},
  };
  await import('../src/main.js');
  for (let i = 0; i < 200 && dom.frames.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(dom.frames.length > 0, 'the page started its frame loop');

  let t = 0;
  let angle = 0;
  const frame = (ms = 16) => {
    hub.advance(ms);
    t += ms;
    if (FakeAudioContext.last) FakeAudioContext.last.currentTime = t / 1000;
    for (const iv of intervals) if (t - iv.last >= iv.ms) {
      iv.last = t;
      iv.fn();
    }
    bob.session.host.tick();
    steer(bob.session);
    bob.session.update(ms / 1000);
    angle += 0.02;
    stick.x = Math.cos(angle) * 0.9;
    stick.y = Math.sin(angle * 0.7) * 0.9;
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
  const text = (cls) => ui.find(cls)[0]?.textContent ?? '';

  // title
  run(500);
  assert.ok(visible('title'), 'the title shows first');
  assert.ok(!visible('lobbytop') && !visible('clock'));
  assert.ok(ui.find('play').length >= 1, 'a Play button');
  // Play (a click on the button)
  ui.find('play')[0].dispatch('click');
  run(300);
  assert.ok(!visible('title'));
  assert.ok(visible('lobbytop'), 'the lobby shows its settings');
  assert.equal(controlsLog[controlsLog.length - 1]?.stick, 'analog', 'touch controls are asked for in the lobby');
  assert.ok(ui.find('opt').length === 5, 'time and rounds options');
  // the host taps a setting
  const opts = ui.find('opt');
  opts[0].dispatch('click');
  assert.equal(hub.settings.time, 90);
  run(2000);
  assert.ok(dom.ids.overlay.getContext().calls.fillText > 0, 'name tags are drawn in the lobby');

  // everyone readies, the host starts
  room.setReady(true);
  bob.room.setReady(true);
  hub.startCountdown();
  run(200);
  assert.equal(text('count'), '3', 'a big 3');
  run(1000);
  assert.equal(text('count'), '2');
  run(1000);
  assert.equal(text('count'), '1');
  run(1000);
  run(100);
  assert.equal(room.match.phase, 'playing');
  assert.equal(text('count'), 'GO');
  assert.equal(controlsLog[controlsLog.length - 1]?.stick, 'analog');
  run(600);
  assert.ok(visible('clock') && visible('side'), 'the HUD is up');
  assert.match(text('t'), /^1:2\d$|^1:30$/, `the clock reads ${text('t')}`);
  assert.ok(visible('banner'), 'the goal banner');
  assert.equal(ui.find('banner')[0].find('l1')[0].textContent, 'SWALLOW THE CITY');
  assert.ok(ui.find('row').filter((n) => !n.hidden).length === 5, 'a leaderboard of five');
  assert.match(text('place'), /^\d(ST|ND|RD|TH)$/);

  // play until the score card
  run(95000, () => visible('card'));
  assert.ok(visible('card'), 'the scoreboard appears when the time is up');
  assert.equal(ui.find('card')[0].children[0].textContent, 'TIME UP');
  assert.ok(ui.find('standing').length >= 6);
  run(4600, () => visible('results'));
  assert.ok(visible('results'), 'then the podium');
  assert.equal(ui.find('pl').length, 3);
  assert.equal(ui.find('pl')[1].find('name')[0].textContent.length > 0, true);
  assert.ok(ui.find('crown').length >= 0);
  // the match ends and the card stays over the lobby
  run(10000, () => hub.ended.length > 0);
  assert.equal(hub.ended.length, 1, 'the host ended the match');
  run(300);
  assert.ok(visible('lobbytop'), 'the lobby is back');
  assert.ok(visible('results'), 'with the results still on it');
  run(8000);
  assert.ok(!visible('results'), 'which go away after a while');
  assert.ok(saved.stats && saved.stats.matches === 3, `stats were saved: ${JSON.stringify(saved.stats)}`);
  const audio = FakeAudioContext.last;
  assert.ok(audio && audio.started > 300, `the sound code ran (${audio?.started} sounds started)`);
  assert.equal(audio.state, 'running');
  assert.deepEqual(errors, [], `nothing threw: ${errors.join('\n')}`);
  console.error = origError;
});
