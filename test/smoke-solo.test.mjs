// The page opened on its own, with no platform: the stand-in SDK and its solo room carry a match from the lobby into play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { installDom } from './helpers/fakedom.mjs';
import { FakeAudioContext } from './helpers/fakeaudio.mjs';

register('./helpers/loader.mjs', import.meta.url);

test('without the platform: the title, a Ready button, a countdown and a round, all from the stand-in SDK', async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  const dom = installDom();
  globalThis.AudioContext = FakeAudioContext;
  delete globalThis.onceworlds;
  // time we control: Date.now and the timers the stand-in uses
  let clock = 1_000_000;
  const realNow = Date.now;
  Date.now = () => clock;
  const timeouts = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    timeouts.push({ fn, at: clock + ms });
    return timeouts.length;
  };
  globalThis.clearTimeout = () => {};
  const intervals = [];
  globalThis.setInterval = (fn, ms) => {
    intervals.push({ fn, ms, last: clock });
    return intervals.length;
  };
  await import('../src/main.js');
  for (let i = 0; i < 400 && dom.frames.length === 0; i++) await new Promise((r) => realSetTimeout(r, 5));
  assert.ok(dom.frames.length > 0, 'the loop runs');
  const ui = dom.ids.ui;
  const visible = (cls) => ui.find(cls).some((n) => !n.hidden);
  const frame = (ms = 16) => {
    clock += ms;
    for (const t of [...timeouts]) if (t.at <= clock) {
      timeouts.splice(timeouts.indexOf(t), 1);
      t.fn();
    }
    for (const iv of intervals) if (clock - iv.last >= iv.ms) {
      iv.last = clock;
      iv.fn();
    }
    if (FakeAudioContext.last) FakeAudioContext.last.currentTime = clock / 1000;
    dom.step(clock);
  };
  const run = (ms, until) => {
    for (let i = 0; i < Math.ceil(ms / 16); i++) {
      frame();
      if (until?.()) return true;
    }
    return false;
  };
  run(300);
  assert.ok(visible('title'));
  ui.find('play')[0].dispatch('click');
  run(300);
  assert.ok(visible('lobbytop'));
  const ready = ui.find('standalone')[0];
  assert.ok(ready && !ready.hidden, 'a Ready button where there is no platform strip');
  ready.dispatch('click');
  run(100);
  assert.ok(run(3500, () => ui.find('count')[0].textContent === 'GO'), 'a countdown, then GO');
  run(800);
  assert.ok(visible('clock'), 'the round is on');
  run(15000);
  assert.ok(ui.find('row').some((r) => !r.hidden));
  assert.deepEqual(errors, [], errors.join('\n'));
  Date.now = realNow;
  globalThis.setTimeout = realSetTimeout;
  console.error = origError;
});
