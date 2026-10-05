// Black Hole City: entry point. Joins the room first, then builds the scene, the screens and the sound, and runs the loop.
// `?poster=<name>` skips the room and the SDK and draws one staged frame for the store pictures.

import './style.css';
import { getSdk } from './sdk.js';
import * as C from './logic/config.js';

const params = new URLSearchParams(location.search);

if (params.has('poster')) {
  import('./poster.js').then((m) => m.runPoster(params.get('poster'))).catch((err) => console.error(err));
} else {
  boot().catch((err) => {
    console.error(err);
    fatal('SOMETHING WENT WRONG');
  });
}

function fatal(text) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#0b1020;color:#fff;font:700 28px system-ui,sans-serif;text-align:center;padding:24px;z-index:9';
  d.textContent = text;
  document.body.append(d);
}

async function boot() {
  const ow = getSdk();
  try {
    ow.ui?.setOrientation?.('landscape');
  } catch {}

  // 1. join at once, before anything heavy is loaded or built
  const JOIN = {
    maxPlayers: C.MAX_PLAYERS,
    minPlayers: 1,
    lobby: 'bar',
    settings: [
      { id: 'time', label: 'Time', options: C.TIME_OPTIONS.map((v) => ({ value: v, label: `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` })), default: C.DEFAULT_TIME },
      { id: 'rounds', label: 'Rounds', options: C.ROUND_OPTIONS, default: C.DEFAULT_ROUNDS },
    ],
  };
  const joining = ow.rooms.join(JOIN);
  joining.catch(() => {}); // handled where it is awaited
  const [{ Session }, { Stage }, { Overlay }, { Avatars }, { Sound }, { Input }, { UI }, { Profile }, { TYPES }] = await Promise.all([
    import('./game/session.js'),
    import('./view/stage.js'),
    import('./overlay.js'),
    import('./avatars.js'),
    import('./audio.js'),
    import('./input.js'),
    import('./ui.js'),
    import('./profile.js'),
    import('./logic/objects.js'),
  ]);
  const room = await joining;
  try {
    document.fonts?.load('16px "Archivo Black"').catch(() => {});
  } catch {}

  // 2. the picture
  const canvas = document.getElementById('game');
  const overlayCanvas = document.getElementById('overlay');
  const uiRoot = document.getElementById('ui');
  const avatars = new Avatars(ow);
  const sound = new Sound();
  const profile = new Profile(ow);
  profile.load();
  let stage;
  try {
    stage = new Stage(canvas, { quality: ow.settings?.quality ?? 'high', pixelRatio: ow.settings?.pixelRatio?.(2) ?? Math.min(devicePixelRatio || 1, 2) });
  } catch (err) {
    console.error(err);
    fatal('THIS DEVICE CANNOT RUN THE GAME');
    return;
  }
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  const overlay = new Overlay(overlayCanvas, avatars);

  const state = { session: null, room: null, hitstop: 0, needSnap: true, biggest: 1, controls: undefined, lobbyHidden: false, lastHide: 0 };

  const applySettings = () => {
    const pr = ow.settings?.pixelRatio?.(2) ?? Math.min(devicePixelRatio || 1, 2);
    stage.setQuality(ow.settings?.quality ?? 'high');
    stage.reduced = !!ow.settings?.reducedMotion;
    if (stage.reduced) stage.particles.setBudget(Math.min(stage.particles.budget, 160)); // gentler
    overlay.reduced = stage.reduced;
    if (ui) ui.reduced = stage.reduced;
    stage.resize(innerWidth, innerHeight, pr);
    overlay.resize(innerWidth, innerHeight, Math.min(pr, 2));
  };
  const input = new Input(ow, (t) => ui.isUi(t));
  input.onTap = () => {
    if (state.room?.spectating && state.session.mode === 'round') state.session.nextSpectate();
  };
  const ui = new UI(uiRoot, { session: null, room, ow, avatars, sound, onPlay: () => play() });
  applySettings();
  addEventListener('resize', applySettings);
  ow.settings?.on?.('change', applySettings);

  const chip = (type) => {
    const id = TYPES[type].id;
    if (id.startsWith('car')) return [0xe0323f, 0x2f6fe0, 0xf2c01d, 0xe9edf2, 0x1fb59b][Number(id.slice(3))] ?? 0xcccccc;
    if (id === 'tree' || id === 'pine' || id === 'bush') return 0x5cb552;
    if (id === 'cone') return 0xff7a1a;
    if (id === 'hydrant') return 0xe03a2f;
    if (id.startsWith('person')) return 0xf1c7a2;
    if (id === 'bus') return 0x2d9cdb;
    if (id === 'fountain') return 0x6fc4f0;
    return 0xd8d3c6;
  };
  const colorOf = (seat) => C.SEAT_COLORS[seat % C.SEAT_COLORS.length];

  // 3. the game, bound to a room (again after a rejoin)
  function mount(r, started) {
    state.room = r;
    const session = new Session({ room: r, now: () => ow.now() });
    state.session = session;
    ui.session = session;
    ui.room = r;
    if (started) session.start();
    wire(session, r);
    r.on('close', (reason) => {
      if (reason === 'moved' || reason === 'left') return;
      ui.showClosed(reason, async () => {
        ui.msg.hidden = true;
        try {
          session.destroy();
          const next = await ow.rooms.join(JOIN);
          mount(next, true);
        } catch (err) {
          console.error(err);
          ui.showClosed('disconnected', () => location.reload());
        }
      });
    });
    return session;
  }

  function wire(session, r) {
    session.on('world', (ctx) => {
      stage.loadCity(ctx.city);
      stage.holes.hideAll();
      overlay.clearAll();
      state.needSnap = true;
    });
    session.on('eat', (e) => {
      const city = session.ctx.city;
      const r2 = city.r[e.id];
      stage.city.fall(e.id, e.hx, e.hz, session.views.findIndex((v) => v.me));
      sound.plop(r2);
      overlay.gain(e.value, e.hx, e.hz, e.value >= 40);
      const power = Math.min(2.6, 0.5 + r2 * 0.35);
      stage.particles.burst(e.x, 0.5, e.z, chip(e.type), power, r2 >= 1.7 ? 14 : 5);
      if (r2 >= 1.7) stage.particles.puff(e.x, 0.4, e.z, 0xcfd3da, power, 4);
      if (r2 >= 5) stage.addTrauma(0.38);
      else if (r2 >= 3) stage.addTrauma(0.2);
      else if (r2 >= 1.7) stage.addTrauma(0.07);
      if (e.skyscraper) {
        if (!e.practice) profile.award('skyscraper');
        if (!stage.reduced) state.hitstop = 0.07;
      }
      if (!e.practice && e.count >= 500) profile.award('whole-city');
    });
    session.on('fall', (e) => {
      stage.city.fall(e.id, e.hx, e.hz, e.seat);
      const city = session.ctx?.city;
      const me = session.views[session.seat];
      if (!city || !me) return;
      const d = Math.hypot(e.hx - me.x, e.hz - me.z);
      const r2 = city.r[e.id];
      if (d < 26) {
        sound.plop(r2, Math.max(0.12, 0.42 - d / 80));
        if (stage.particles.n < stage.particles.budget * 0.7) stage.particles.puff(city.x[e.id], 0.4, city.z[e.id], 0xcfd3da, 0.5 + r2 * 0.2, 2);
        if (r2 >= 5 && d < 22) stage.addTrauma(0.08);
      }
    });
    session.on('vanish', (e) => stage.city.vanish(e.id));
    session.on('restore', (e) => stage.city.restore(e.id));
    session.on('grow', (e) => {
      const me = session.views[session.seat] ?? session.views.find((v) => v.me);
      const col = colorOf(me ? me.seat : 0);
      stage.rings.emit(e.x, e.z, e.R * 1.05, e.R * 2.2 + 1.5, col, 0.6);
      sound.grow();
    });
    session.on('gulp', (e) => {
      const a = session.views[e.a];
      const b = session.views[e.b];
      const mine = e.byMe || e.meVictim;
      sound.gulp(e.byMe);
      const col = colorOf(e.a);
      const R = b ? Math.max(1.5, b.R) : 2;
      stage.rings.emit(e.x, e.z, R, R * 3 + 3, col, 0.7);
      stage.particles.burst(e.x, 0.6, e.z, col, 2.2, 22);
      stage.addTrauma(mine ? 0.55 : 0.12);
      if (mine && !stage.reduced) state.hitstop = 0.08;
      ui.feed(a?.name ?? '', b?.name ?? '', mine);
      if (e.byMe) {
        ui.callout(`SWALLOWED ${(b?.name ?? '').toUpperCase().slice(0, 12)}`, 'good');
        profile.award('predator');
      }
    });
    session.on('swallowed', (e) => {
      stage.particles.burst(e.x, 0.6, e.z, 0x111827, 1.6, 14);
      if (e.me) {
        sound.died();
        stage.addTrauma(0.4);
      }
    });
    session.on('born', (e) => {
      stage.rings.emit(e.x, e.z, 1, 5, colorOf(e.seat), 0.5);
      if (e.me) {
        sound.back();
        overlay.showYou(2.5);
      }
    });
    session.on('hint', (e) => {
      overlay.word('TOO BIG', e.x, e.z);
      sound.hint();
    });
    session.on('phase', (e) => {
      if (e.mode === 'countdown') {
        state.biggest = 1;
      } else if (e.mode === 'round' && e.sub === 'play') {
        overlay.showYou(4);
        if (e.n > 1) sound.roundStart();
      } else if (e.mode === 'round' && e.sub === 'score') {
        sound.hint();
      }
    });
    session.on('final', (e) => {
      const order = Array.isArray(e.g.fin) ? e.g.fin : [];
      const won = e.playing && order[0] === e.seat;
      if (e.playing) {
        profile.finish({ won, eaten: e.eats, gulps: e.gulps, biggest: state.biggest });
        if (won) {
          sound.win();
          overlay.burstConfetti(5);
        } else sound.lose();
      } else sound.lose();
    });
    r.on('matchend', () => {
      state.hitstop = 0;
    });
  }

  // 4. play
  function play() {
    const session = state.session;
    if (session.started) return;
    sound.start();
    session.start();
    try {
      state.room.hideLobby(false);
    } catch {}
    state.lobbyHidden = false;
  }
  addEventListener('keydown', (e) => {
    if (state.session.mode === 'title' && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault();
      play();
    } else if (state.session.started) sound.start();
  });
  addEventListener(
    'pointerdown',
    (e) => {
      const s = state.session;
      if (s.mode === 'title' && state.room.match.phase !== 'lobby' && !ui.isUi(e.target)) play(); // a page that loads mid-match: the first tap
      else if (s.started) sound.start(); // a tap in the game is what lets iPhones play sound
    },
    { passive: true },
  );
  try {
    room.hideLobby(true);
    state.lobbyHidden = true;
  } catch {}
  mount(room, false);

  const controlsFor = () => {
    const s = state.session;
    if (s.mode === 'lobby') return 'stick';
    if (s.mode === 'countdown' && s.playing) return 'stick';
    if (s.mode === 'round' && s.playing && (s.sub === 'play' || s.sub === 'score')) return 'stick';
    return null;
  };

  let last = performance.now();
  let errors = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    try {
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0)) dt = 0.016;
      dt = Math.min(dt, 0.1);
      const session = state.session;
      const room = state.room;

      input.enabled = session.mode === 'lobby' || session.mode === 'round' || session.mode === 'countdown';
      input.read();
      session.input.x = input.x;
      session.input.z = input.z;
      session.update(dt);

      // the platform's touch controls follow the screen
      const want = controlsFor();
      if (want !== state.controls) {
        state.controls = want;
        try {
          ow.controls?.set?.(want ? { stick: 'analog' } : null);
        } catch {}
      }
      // the Ready strip stays away while the title shows
      if (session.mode === 'title' && now - state.lastHide > 1000) {
        state.lastHide = now;
        try {
          room.hideLobby(true);
        } catch {}
      }
      // music: softer in menus, full while a round plays
      sound.setLevel(session.started ? (session.mode === 'round' && session.sub === 'play' ? 'play' : 'menu') : 'off');

      const cam = session.cam;
      if (state.needSnap && session.ctx) {
        stage.snap(cam.x, cam.z, cam.R, cam.boost);
        state.needSnap = false;
      }
      if (session.me && session.views[session.seat]) state.biggest = Math.max(state.biggest, session.views[session.seat].R);

      // everything that moves in the picture
      const slow = state.hitstop > 0 ? 0.12 : 1;
      state.hitstop = Math.max(0, state.hitstop - dt);
      stage.follow(dt, cam.x, cam.z, cam.R, cam.boost);
      stage.city.update(dt * slow, session.clock, session.views);
      stage.holes.update(session.views, now / 1000);
      stage.update(dt * slow, now / 1000);
      overlay.draw(session, stage, dt, session.mode !== 'title');
      ui.update();
      stage.render();
    } catch (err) {
      if (errors++ < 5) console.error(err);
    }
  }
  requestAnimationFrame(frame);
}
