// The small pieces of the screens that a whole-match run might not touch: feed lines, callouts, banners, faces, the closed-room message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { installDom } from './helpers/fakedom.mjs';

register('./helpers/loader.mjs', import.meta.url);

test('feed lines, callouts, banners and the closed-room message', async () => {
  const dom = installDom();
  const { UI } = await import('../src/ui.js');
  const { Avatars } = await import('../src/avatars.js');
  const ow = { controls: { touch: false }, player: { avatarUrl: async (id) => (id === 'ann' ? 'data:ann' : null) } };
  const avatars = new Avatars(ow);
  const room = { isHost: false, settings: {}, setSetting() {}, me: { id: 'ann' }, match: { startsAt: 0 }, matchNow: () => 0 };
  const ui = new UI(dom.ids.ui, { session: null, room, ow, avatars, sound: { count() {}, select() {}, lowTime() {} }, onPlay() {} });

  ui.feed('Nova', 'Echo', false);
  ui.feed('Blaze', 'Kai', true);
  ui.feed('A', 'B', false);
  ui.feed('C', 'D', false);
  const feed = dom.ids.ui.find('feed')[0];
  assert.equal(feed.children.length, 3, 'only the last three lines');
  assert.equal(feed.children[0].textContent, 'Blaze▸Kai');

  ui.callout('SWALLOWED NOVA', 'good');
  assert.equal(ui.callEl.textContent, 'SWALLOWED NOVA');
  assert.ok(ui.callEl.classList.contains('good') && ui.callEl.classList.contains('show') && !ui.callEl.hidden);

  ui.showBanner('ROUND 2', 'BIGGEST HOLE WINS');
  assert.equal(ui.bannerL1.textContent, 'ROUND 2');
  assert.ok(ui.banner.classList.contains('show') && !ui.banner.hidden);
  ui.showBanner('SWALLOW THE CITY');
  assert.ok(ui.bannerL2.hidden);

  const face = new (await import('./helpers/fakedom.mjs')).FakeNode('span');
  ui.avatarInto(face, 'bot1', true, 'Nova', 0);
  assert.equal(face.textContent, 'N', 'a bot gets its initial');
  const person = new (await import('./helpers/fakedom.mjs')).FakeNode('span');
  ui.avatarInto(person, 'ann', false, 'Ann', 2);
  assert.equal(person.textContent, 'A');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(person.children.length, 1, 'then her face replaces the letter');
  ui.avatarInto(person, 'bob', false, 'Bob', 3);
  assert.equal(person.textContent, 'B', 'a re-used face shows the new player');

  let again = 0;
  ui.showClosed('kicked', () => again++);
  assert.ok(!ui.msg.hidden);
  assert.equal(ui.msgText.textContent, 'YOU WERE REMOVED');
  ui.msgBtn.onclick();
  assert.equal(again, 1);
  ui.showClosed('replaced', () => {});
  assert.equal(ui.msgText.textContent, 'PLAYING IN ANOTHER TAB');
  ui.showClosed('disconnected', () => {});
  assert.equal(ui.msgText.textContent, 'DISCONNECTED');
  assert.ok(ui.isUi({ closest: (s) => (s === '.hit' ? {} : null) }));
  assert.ok(!ui.isUi(null));
});
