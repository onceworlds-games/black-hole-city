// The game as one page lives it: which world is on screen (title, lobby, a round), where every hole is, my own hole's
// movement and swallowing, what the host says, and the events the picture and sound react to.
// No DOM and no three.js in here: the tests drive a whole match through it with a fake room.
//
// Authority (see host.js): my page moves my hole and decides what it swallows, claims the objects with the host, and shows
// them falling at once. Score, size and who has what come from the host's record `g`; the eaten set from `e`.

import { Sim, spawnPlan } from '../logic/sim.js';
import { collectSwallows, radiusFor, speedFor, clampToWorld, canGulp, canEat, damp } from '../logic/rules.js';
import { buildRoster, citySeed, roundKey, roundId, seatCount } from '../logic/match.js';
import { decodeEaten } from '../logic/bits.js';
import { isSkyscraper } from '../logic/objects.js';
import { hashSeed } from '../logic/rng.js';
import * as C from '../logic/config.js';
import { HostController, validRecord } from './host.js';
import { getCity, getLobby } from './cities.js';

const num = (v) => (Number.isFinite(v) ? v : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
const STEP = 1 / 60;
const PRACTICE_CAP = 200;
const PRACTICE_BACK_MS = 7000;
const PENDING_MS = 1600;

function makeView(idx) {
  return {
    idx,
    id: '',
    name: '',
    bot: false,
    seat: idx,
    x: 0,
    z: 0,
    R: C.R0,
    Rt: C.R0,
    scale: 1,
    alive: true,
    shown: true,
    protect: false,
    me: false,
    away: false,
    gone: false,
    ready: false,
    leader: false,
    score: 0,
    mass: 0,
    dead: 0,
    born: 0,
    dying: 0,
    vx: 0,
    vz: 0,
    seen: false,
  };
}

export class Session {
  /**
   * @param room   the Onceworlds room (or a stand-in with the same shape)
   * @param now    the platform clock in ms (ow.now)
   */
  constructor({ room, now, autoTick = true }) {
    this.room = room;
    this.nowMs = now;
    this.listeners = new Map();
    this.host = new HostController(room);
    this.started = false;
    this.mode = 'title';
    this.ctx = null;
    this.g = null;
    this.sub = null;
    this.roster = [];
    this.views = [];
    this.order = [];
    this.me = null;
    this.seat = -1;
    this.playing = false;
    this.input = { x: 0, z: 0 };
    this.acc = 0;
    this.clock = 0;
    this.cam = { x: 0, z: 0, R: C.R0, boost: 1 };
    this.scratch = [];
    this.claimQueue = [];
    this.lastClaim = 0;
    this.sentX = 1e9;
    this.sentZ = 1e9;
    this.sentKey = -1;
    this.sentAt = 0;
    this.lastKill = 0;
    this.lastHintScan = 0;
    this.lastHint = -1e9;
    this.hintCount = 0;
    this.results = null;
    this.resultsUntil = 0;
    this.finalFor = null;
    this.stats = { eats: 0, skyscraper: false, gulps: 0 };
    this.spectate = -1;
    this.lastKey = '';

    room.on('matchstart', () => {
      this.stats = { eats: 0, skyscraper: false, gulps: 0 };
      this.finalFor = null;
      this.host.adopt();
    });
    room.on('starting', () => {
      // a private match closes the door when it starts; friends may still drop in and watch
      try {
        if (room.isHost && room.kind === 'private') room.setOpen(true);
      } catch {}
    });
    room.on('host', () => this.host.adopt());
    room.on('reconnect', () => this.host.adopt());
    room.on('message', (d, from) => this.host.onMessage(d, from));
    room.on('matchend', () => {
      const g = room.state.g;
      if (g && Array.isArray(g.roster) && g.phase === 'final') {
        this.results = { g: JSON.parse(JSON.stringify(g)), names: this.namesNow() };
        this.resultsUntil = this.nowMs() + C.RESULTS_CARD_MS;
      }
      this.host.reset();
    });
    // the host's 100 ms ticker (the tests drive it by hand)
    this.tickTimer = autoTick ? setInterval(() => this.host.tick(), C.HOST_TICK_MS) : null;
    this.host.adopt();
  }

  destroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  // ------------------------------------------------------------------------------------------------ events

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name).delete(fn);
  }

  emit(name, data) {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(data);
      } catch (err) {
        console.error(err);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ small helpers

  get myId() {
    return this.room.me.id;
  }

  playerName(id) {
    return this.room.players.get(id)?.name ?? '';
  }

  namesNow() {
    const out = {};
    for (const e of this.roster) out[e.id] = e.bot ? e.name : this.playerName(e.id);
    return out;
  }

  /** Called by the title's Play button (or the first tap of a page that loaded mid-match). */
  start() {
    this.started = true;
  }

  /** The time left in the round in ms (0 outside play). */
  get timeLeft() {
    const g = this.g;
    if (!g || g.phase !== 'play') return 0;
    return Math.max(0, g.until - this.room.matchNow());
  }

  /** Where I place right now (0 is first), or -1 when I'm not a player in a round. */
  get myPlace() {
    return this.seat >= 0 ? this.order.indexOf(this.seat) : -1;
  }

  // ------------------------------------------------------------------------------------------------ modes and worlds

  setCtx(ctx) {
    this.ctx = ctx;
    this.views.length = 0;
    this.me = null;
    this.claimQueue.length = 0;
    this.emit('world', ctx);
  }

  makeTitle() {
    const seed = hashSeed('title', Math.floor(this.nowMs() / 1000), Math.floor(Math.random() * 1e6));
    const city = getCity(seed);
    const roster = buildRoster([], seed);
    const sim = new Sim(city, roster, { seed, startMs: 0 });
    return { kind: 'title', city, grid: city.grid(), sim, roster, t0: this.nowMs(), eaten: sim.eaten, key: 0, rid: `title${seed}` };
  }

  makeLobby() {
    const city = getLobby();
    return { kind: 'lobby', city, grid: city.grid(), eaten: new Uint8Array(city.n), back: [], key: 0, rid: 'lobby' };
  }

  makeRound(rid, n, seed, g) {
    const m = this.room.match;
    const city = getCity(seed);
    const roster = g ? this.host.rosterOf(g) : buildRoster(m.participants ?? [], m.seed);
    const ctx = {
      kind: 'round',
      mid: m.id,
      rid,
      n,
      seed,
      city,
      grid: city.grid(),
      eaten: new Uint8Array(city.n),
      plan: spawnPlan(city, seed, seatCount(roster.length)),
      key: roundKey(rid),
      hbuf: [],
      lastH: -1,
      lastBits: null,
      firstBits: !!g && this.room.matchNow() - num(g.t0) > 2000,
      myEats: 0,
    };
    this.roster = roster;
    return ctx;
  }

  /** Works out which world should be on screen and switches to it. */
  syncMode() {
    const room = this.room;
    const m = room.match;
    let mode = 'title';
    if (this.started) mode = m.phase === 'playing' ? 'round' : m.phase === 'starting' ? 'countdown' : 'lobby';
    const changed = mode !== this.mode;
    this.mode = mode;
    if (mode === 'title' || mode === 'lobby') {
      this.g = null;
      this.sub = null;
      this.seat = -1;
      this.playing = false;
    }
    if (mode === 'title') {
      if (!this.ctx || this.ctx.kind !== 'title' || this.nowMs() - this.ctx.t0 > 80000) this.setCtx(this.makeTitle());
    } else if (mode === 'lobby') {
      if (!this.ctx || this.ctx.kind !== 'lobby') {
        this.setCtx(this.makeLobby());
        this.me = this.newLobbyMe();
        this.roster = [];
      } else if (changed) {
        this.me = this.me ?? this.newLobbyMe();
      }
    } else {
      // countdown and round: the round's world (round 1 is built at the countdown, from the match's seed)
      const g = this.readG();
      this.g = g;
      let rid;
      let n;
      let seed;
      if (g && g.rid) {
        rid = g.rid;
        n = g.n;
        seed = g.seed;
      } else {
        rid = roundId(m.id, 1);
        n = 1;
        seed = citySeed(m.seed, 1);
      }
      if (!this.ctx || this.ctx.kind !== 'round' || this.ctx.rid !== rid) {
        this.setCtx(this.makeRound(rid, n, seed, g && g.rid === rid ? g : null));
        this.enterRound(g);
      } else if (g && g.rid === rid) {
        this.syncRoster(g);
      }
    }
  }

  readG() {
    const g = this.room.state.g;
    return validRecord(g, this.room.match.id) ? g : null;
  }

  syncRoster(g) {
    const same = this.roster.length === g.roster.length && this.roster.every((e, i) => e.id === g.roster[i].i);
    if (!same) this.roster = this.host.rosterOf(g);
  }

  newLobbyMe() {
    const city = getLobby();
    const slot = city.spawns[hashSeed(this.myId) % city.spawns.length];
    return { x: slot.x, z: slot.z, vx: 0, vz: 0, R: 1.3, mass: 0, alive: true, hostMass: 0, pend: new Map(), gulpAsked: new Map(), pulseR: 1.3, deadAt: 0 };
  }

  /** A new round's world is up: put my hole where it begins. */
  enterRound(g) {
    const ctx = this.ctx;
    const room = this.room;
    this.seat = this.roster.findIndex((e) => e.id === this.myId);
    this.playing = this.seat >= 0 && room.isParticipant(this.myId);
    this.lastKill = g?.k?.n ?? 0;
    this.claimQueue.length = 0;
    this.me = null;
    this.views.length = 0;
    if (this.playing) {
      const spot = ctx.plan[this.seat] ?? ctx.plan[0];
      this.me = { x: spot.x, z: spot.z, vx: 0, vz: 0, R: C.R0, mass: 0, alive: true, hostMass: 0, pend: new Map(), gulpAsked: new Map(), pulseR: C.R0, deadAt: 0 };
    }
    this.emit('round', { n: ctx.n, rid: ctx.rid, g });
  }

  // ------------------------------------------------------------------------------------------------ every frame

  /** dt: seconds since the last frame. input is set by the input layer before this (this.input.x / z, -1..1). */
  update(dt) {
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    this.syncMode();
    switch (this.mode) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'lobby':
        this.updateLobby(dt);
        break;
      case 'countdown':
        this.updateCountdown(dt);
        break;
      default:
        this.updateRound(dt);
    }
    this.updateOrder();
    if (this.results && this.nowMs() > this.resultsUntil) this.results = null;
    this.announce();
  }

  /** Tells the screens when the mode, the round or its phase changes, and when a match's final standings are in. */
  announce() {
    const g = this.g;
    const key = `${this.mode}|${this.sub}|${this.ctx ? this.ctx.rid : ''}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.emit('phase', { mode: this.mode, sub: this.sub, n: this.ctx?.n ?? 0, rounds: g?.rounds ?? this.room.settings?.rounds ?? 1, g });
    }
    if (this.mode === 'round' && g && g.phase === 'final' && this.finalFor !== g.mid) {
      this.finalFor = g.mid;
      this.emit('final', { g, names: this.namesNow(), seat: this.seat, playing: this.playing, eats: this.stats.eats, gulps: this.stats.gulps, skyscraper: this.stats.skyscraper });
    }
  }

  // ---- title: bots playing in a whole city while the logo shows
  updateTitle(dt) {
    const ctx = this.ctx;
    const ms = this.nowMs() - ctx.t0;
    ctx.sim.advanceTo(ms);
    this.clock = ms / 1000;
    const sim = ctx.sim;
    this.roster = ctx.roster;
    let best = 0;
    for (const h of sim.holes) {
      const v = this.viewFor(h.idx);
      v.id = h.id;
      v.name = ctx.roster[h.idx].name;
      v.bot = true;
      v.me = false;
      v.x = h.x;
      v.z = h.z;
      v.vx = h.vx;
      v.vz = h.vz;
      v.mass = h.mass;
      v.score = h.score;
      v.Rt = radiusFor(h.mass);
      this.settleView(v, dt, sim.isAlive(h, ms), false, ms);
      if (h.score >= best && sim.isAlive(h, ms)) {
        best = h.score;
        this.followTarget(v, 1);
      }
    }
    this.views.length = sim.holes.length;
    this.drainDemo(sim);
  }

  drainDemo(sim) {
    const ctx = this.ctx;
    const { ids, by } = sim.drainAte();
    for (let k = 0; k < ids.length; k++) {
      const v = this.views[by[k]];
      if (v) this.emit('fall', { id: ids[k], hx: v.x, hz: v.z });
    }
    sim.drainKills();
    void ctx;
  }

  /** The camera follows a view, with a little lead in the direction it's going. */
  followTarget(v, boost) {
    const cam = this.cam;
    cam.x = v.x + v.vx * 0.22;
    cam.z = v.z + v.vz * 0.22;
    cam.R = v.R;
    cam.boost = boost;
  }

  viewFor(idx) {
    let v = this.views[idx];
    if (!v) {
      v = makeView(idx);
      this.views[idx] = v;
    }
    return v;
  }

  /** Smooths a view's radius and runs its appear and disappear animations. */
  settleView(v, dt, alive, hasSeen, nowMs) {
    void nowMs;
    if (!v.seen) {
      v.seen = true;
      v.R = v.Rt;
      v.alive = alive;
      v.scale = alive ? 1 : 0;
      v.shown = alive;
      v.dying = 0;
      v.born = 0;
    }
    if (v.alive && !alive) {
      v.dying = 0.32;
      this.emit('swallowed', { seat: v.idx, x: v.x, z: v.z, R: v.R, me: v.me });
    } else if (!v.alive && alive) {
      v.born = 0.5;
      this.emit('born', { seat: v.idx, x: v.x, z: v.z, me: v.me });
    }
    v.alive = alive;
    v.R = damp(v.R, v.Rt, 7, dt);
    if (alive) {
      if (v.born > 0) {
        v.born = Math.max(0, v.born - dt);
        v.scale = Math.max(0.02, easeOutBack(Math.min(1, (0.5 - v.born) / 0.5)));
      } else v.scale = 1;
      v.shown = true;
    } else {
      v.dying = Math.max(0, v.dying - dt);
      v.scale = v.dying / 0.32;
      v.shown = v.dying > 0;
    }
    void hasSeen;
  }

  // ---- lobby: the practice park
  updateLobby(dt) {
    const ctx = this.ctx;
    const room = this.room;
    const nowOw = this.nowMs();
    this.clock = nowOw / 1000;
    const me = this.me;
    this.roster = [];
    this.g = null;
    this.sub = null;
    // practice objects come back after a while
    for (let i = ctx.back.length - 1; i >= 0; i--) {
      if (nowOw - ctx.back[i].at > PRACTICE_BACK_MS) {
        const id = ctx.back[i].id;
        ctx.back[i] = ctx.back[ctx.back.length - 1];
        ctx.back.pop();
        ctx.eaten[id] = 0;
        this.emit('restore', { id });
      }
    }
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      this.acc -= STEP;
      steps++;
      this.moveMe(STEP, true);
      const ids = collectSwallows(ctx.city, ctx.grid, ctx.eaten, me.x, me.z, me.R, this.scratch);
      for (let k = 0; k < ids.length; k++) this.practiceEat(ids[k], nowOw);
    }
    if (steps === 6) this.acc = 0;
    me.R = damp(me.R, Math.max(1.3, radiusFor(me.mass)), 8, dt);
    this.scanHint(nowOw, ctx);
    this.growPulse();
    // everyone who is here: me and the others by their presence in the lobby
    const players = [...room.players.values()];
    let k = 0;
    for (const p of players) {
      if (p.connected === false && p.id !== this.myId) continue;
      const v = this.viewFor(k);
      v.seat = k;
      v.id = p.id;
      v.name = p.name ?? '';
      v.bot = false;
      v.me = p.id === this.myId;
      v.ready = !!p.ready;
      v.away = false;
      if (v.me) {
        v.x = me.x;
        v.z = me.z;
        v.vx = me.vx;
        v.vz = me.vz;
        v.Rt = Math.max(1.3, radiusFor(me.mass));
        v.score = 0;
      } else {
        const a = room.presenceAt(p.id, { snap: 6 });
        if (a && a.k === 0 && Number.isFinite(a.x) && Number.isFinite(a.z)) {
          v.x = a.x;
          v.z = a.z;
          v.Rt = Math.max(1.3, radiusFor(Math.min(PRACTICE_CAP, Math.max(0, num(a.m)))));
        } else {
          const slot = ctx.city.spawns[hashSeed(p.id) % ctx.city.spawns.length];
          v.x = slot.x;
          v.z = slot.z;
          v.Rt = 1.3;
        }
        v.vx = 0;
        v.vz = 0;
      }
      this.settleView(v, dt, true, false, 0);
      k++;
      if (k >= C.MAX_PLAYERS) break;
    }
    this.views.length = k;
    const mine = this.views.find((v) => v.me);
    if (mine) this.followTarget(mine, 1);
    this.publish(nowOw, 0, Math.round(me.mass));
  }

  practiceEat(id, nowOw) {
    const ctx = this.ctx;
    const city = ctx.city;
    const me = this.me;
    ctx.eaten[id] = 3;
    ctx.back.push({ id, at: nowOw });
    const v = city.value[id];
    me.mass = Math.min(PRACTICE_CAP, me.mass + v);
    this.emit('eat', { id, type: city.type[id], value: v, x: city.x[id], z: city.z[id], hx: me.x, hz: me.z, R: me.R, mine: true, practice: true });
  }

  // ---- countdown: the round's city is up, everyone waits at their spot
  updateCountdown(dt) {
    const ctx = this.ctx;
    const room = this.room;
    const m = room.match;
    this.clock = 0;
    this.sub = 'countdown';
    this.seat = this.roster.findIndex((e) => e.id === this.myId);
    this.playing = this.seat >= 0 && room.isParticipant(this.myId);
    const left = Math.max(0, num(m.startsAt) - this.nowMs());
    this.buildViews(dt, 0, null);
    const mine = this.views.find((v) => v.me);
    const boost = 1 + Math.min(1, left / 3000) * 0.9;
    const target = mine ?? this.views[0];
    if (target) this.followTarget(target, boost);
    if (this.me) this.publish(this.nowMs(), ctx.key, 0);
    this.claimQueue.length = 0;
  }

  // ---- the round itself
  updateRound(dt) {
    const ctx = this.ctx;
    const room = this.room;
    const g = this.g;
    const nowMs = room.matchNow();
    const nowOw = this.nowMs();
    this.clock = nowMs / 1000;
    this.sub = g ? (g.phase === 'idle' ? 'play' : g.phase) : 'play';
    this.seat = this.roster.findIndex((e) => e.id === this.myId);
    this.playing = this.seat >= 0 && room.isParticipant(this.myId);
    const host = room.isHost && this.host.sim && g && this.host.simRid === ctx.rid && g.by === this.myId ? this.host.sim : null;

    if (host) {
      if (this.me) this.host.setMyPos(this.me.x, this.me.z);
      this.host.step(nowMs);
      this.drainHost(host);
    } else {
      this.readEaten(ctx);
      this.readBots(ctx);
    }

    this.buildViews(dt, nowMs, host);
    this.updateKills(g);

    const me = this.me;
    if (me) {
      this.updateMyLife(nowMs, nowOw);
      const canPlay = this.sub === 'play' && me.alive && room.running && this.playing;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) {
        this.acc -= STEP;
        steps++;
        this.moveMe(STEP, canPlay);
        if (canPlay) this.stepRound(nowOw, host);
      }
      if (steps === 6) this.acc = 0;
      const mine = this.views[this.seat];
      if (mine) {
        mine.x = me.x;
        mine.z = me.z;
        mine.vx = me.vx;
        mine.vz = me.vz;
        me.R = mine.R;
      }
      if (canPlay) {
        this.flushClaims(nowOw, host);
        this.checkPending(nowOw);
        this.scanHint(nowOw, ctx);
        this.growPulse();
      } else if (this.sub !== 'play') {
        this.claimQueue.length = 0;
        me.pend.clear();
      }
      this.publish(nowOw, ctx.key, 0);
    }

    // the camera: my hole, or the leader's when I'm only watching
    const mineView = this.me ? this.views[this.seat] : null;
    if (mineView && mineView.shown) this.followTarget(mineView, 1);
    else if (mineView && this.me) {
      // I was just swallowed: stay put
      this.cam.R = mineView.R;
      this.cam.boost = 1;
    } else {
      const lead = this.spectateView();
      if (lead) this.followTarget(lead, 1);
    }
  }

  spectateView() {
    const list = this.views.filter((v) => v.shown && !v.gone);
    if (list.length === 0) return null;
    if (this.spectate >= 0 && this.spectate < this.views.length && this.views[this.spectate].shown) return this.views[this.spectate];
    let best = list[0];
    for (const v of list) if (v.score > best.score) best = v;
    return best;
  }

  /** Tap while watching: the next hole. */
  nextSpectate() {
    const n = this.views.length;
    if (n === 0) return;
    let i = this.spectate;
    for (let k = 0; k < n; k++) {
      i = (i + 1) % n;
      if (this.views[i].shown) {
        this.spectate = i;
        return;
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ views

  /** Everyone in the round, in seat order: where they are, how big, whether they're in play. */
  buildViews(dt, nowMs, hostSim) {
    const room = this.room;
    const ctx = this.ctx;
    const g = this.g;
    const roster = this.roster;
    const key = ctx.key;
    const rt = nowMs - 160;
    let botK = 0;
    let lead = -1;
    let leadScore = 0;
    for (let idx = 0; idx < roster.length; idx++) {
      const e = roster[idx];
      const v = this.viewFor(idx);
      const isMe = e.id === this.myId && this.playing;
      v.id = e.id;
      v.bot = e.bot;
      v.seat = idx;
      v.me = isMe;
      const p = e.bot ? null : room.players.get(e.id);
      v.name = e.bot ? e.name : (p?.name ?? '');
      v.gone = !e.bot && !p;
      v.away = !!p && p.connected === false;
      v.ready = false;
      // size and score: the host's own numbers, or its record
      let mass;
      let score;
      let dead;
      if (hostSim) {
        const h = hostSim.holes[idx];
        mass = h.mass;
        score = h.score;
        dead = h.deadUntil;
      } else if (g && g.rid === ctx.rid) {
        mass = num(g.m[idx]);
        score = num(g.s[idx]);
        dead = num(g.d[idx]);
      } else {
        mass = 0;
        score = 0;
        dead = 0;
      }
      v.score = score;
      v.dead = dead;
      v.mass = mass;
      if (isMe && this.me) {
        let pend = 0;
        for (const q of this.me.pend.values()) pend += q.v;
        this.me.hostMass = mass;
        mass += pend;
        // the local hole is mine: its position is the page's
        v.x = this.me.x;
        v.z = this.me.z;
        v.vx = this.me.vx;
        v.vz = this.me.vz;
      } else if (!e.bot) {
        const a = room.presenceAt(e.id, { snap: 6 });
        if (a && a.k === key && Number.isFinite(a.x) && Number.isFinite(a.z)) {
          v.vx = (a.x - v.x) * 8;
          v.vz = (a.z - v.z) * 8;
          v.x = a.x;
          v.z = a.z;
        } else if (!v.seen || (a && a.k !== key)) {
          const spot = ctx.plan[idx] ?? ctx.plan[0];
          v.x = spot.x;
          v.z = spot.z;
        }
      } else if (hostSim) {
        const h = hostSim.holes[idx];
        v.x = h.x;
        v.z = h.z;
        v.vx = h.vx;
        v.vz = h.vz;
      } else {
        this.botPosition(ctx, botK, rt, v, idx);
      }
      if (e.bot) botK++;
      v.Rt = radiusFor(mass);
      const alive = !v.gone && nowMs >= dead;
      this.settleView(v, dt, alive, false, nowMs);
      v.protect = alive && dead > 0 && nowMs < dead + C.PROTECT_MS;
      if (v.shown && !v.gone && this.sub === 'play' && score > leadScore) {
        leadScore = score;
        lead = idx;
      }
    }
    this.views.length = roster.length;
    for (const v of this.views) v.leader = v.idx === lead;
  }

  /** Bots for pages that aren't the host: between the two host snapshots around a moment a little in the past. */
  botPosition(ctx, k, rt, v, idx) {
    const buf = ctx.hbuf;
    if (buf.length === 0) {
      const spot = ctx.plan[idx] ?? ctx.plan[0];
      if (!v.seen) {
        v.x = spot.x;
        v.z = spot.z;
      }
      return;
    }
    let a = buf[0];
    let b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= rt && buf[i + 1].t >= rt) {
        a = buf[i];
        b = buf[i + 1];
        break;
      }
    }
    const pa = a.p[k];
    const pb = b.p[k];
    if (!pa || !pb) return;
    let f = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const x = pa[0] + (pb[0] - pa[0]) * f;
    const z = pa[1] + (pb[1] - pa[1]) * f;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const jump = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    v.vx = jump > 8 ? 0 : (pb[0] - pa[0]) / Math.max(0.05, (b.t - a.t) / 1000);
    v.vz = jump > 8 ? 0 : (pb[1] - pa[1]) / Math.max(0.05, (b.t - a.t) / 1000);
    v.x = x;
    v.z = z;
  }

  readBots(ctx) {
    const h = this.room.state.h;
    if (!h || h.rid !== ctx.rid || !Array.isArray(h.p) || !Number.isFinite(h.t) || h.t === ctx.lastH) return;
    ctx.lastH = h.t;
    ctx.hbuf.push({ t: h.t, p: h.p });
    while (ctx.hbuf.length > 8) ctx.hbuf.shift();
  }

  updateOrder() {
    const views = this.views;
    const order = [];
    if (this.mode === 'round' || this.mode === 'countdown') for (let i = 0; i < views.length; i++) order.push(i);
    order.sort((a, b) => views[b].score - views[a].score || views[b].mass - views[a].mass || a - b);
    this.order = order;
  }

  // ------------------------------------------------------------------------------------------------ the eaten set

  /** Non-host pages: the host's eaten set, decoded and compared with what this page knows. */
  readEaten(ctx) {
    const e = this.room.state.e;
    if (!e || e.rid !== ctx.rid || e.n !== ctx.city.n || typeof e.bits !== 'string' || e.bits === ctx.lastBits) return;
    const flags = decodeEaten(e.bits, ctx.city.n);
    if (!flags) return;
    ctx.lastBits = e.bits;
    const instant = ctx.firstBits;
    ctx.firstBits = false;
    for (let id = 0; id < flags.length; id++) {
      if (flags[id] && !(ctx.eaten[id] & 1)) this.serverEaten(id, instant, -1);
    }
  }

  /** The host's own Sim: what bots and other players took since the last frame. */
  drainHost(sim) {
    const ctx = this.ctx;
    const { ids, by } = sim.drainAte();
    for (let k = 0; k < ids.length; k++) {
      if (!(ctx.eaten[ids[k]] & 1)) this.serverEaten(ids[k], false, by[k]);
    }
  }

  serverEaten(id, instant, byIdx) {
    const ctx = this.ctx;
    const had = ctx.eaten[id];
    ctx.eaten[id] = had | 1;
    if (this.me) this.me.pend.delete(id);
    if (had & 2) return; // I took it: it's already on its way down on this page
    if (instant) return this.emit('vanish', { id });
    const city = ctx.city;
    let target = byIdx >= 0 ? this.views[byIdx] : null;
    if (!target || !target.shown) {
      target = null;
      let best = Infinity;
      const x = city.x[id];
      const z = city.z[id];
      for (const v of this.views) {
        if (!v.shown) continue;
        const d = Math.hypot(v.x - x, v.z - z);
        if (d < v.R + city.r[id] + 3 && d < best) {
          best = d;
          target = v;
        }
      }
    }
    if (target) this.emit('fall', { id, hx: target.x, hz: target.z });
    else this.emit('vanish', { id });
  }

  // ------------------------------------------------------------------------------------------------ my hole

  moveMe(dt, active) {
    const me = this.me;
    const city = this.ctx.city;
    if (active) {
      let ix = this.input.x;
      let iz = this.input.z;
      const mag = Math.hypot(ix, iz);
      if (mag > 1) {
        ix /= mag;
        iz /= mag;
      } else if (mag < 0.06) {
        ix = 0;
        iz = 0;
      }
      const sp = speedFor(me.R);
      const k = 1 - Math.exp(-9 * dt);
      me.vx += (ix * sp - me.vx) * k;
      me.vz += (iz * sp - me.vz) * k;
    } else {
      const k = Math.exp(-10 * dt);
      me.vx *= k;
      me.vz *= k;
    }
    me.x += me.vx * dt;
    me.z += me.vz * dt;
    clampToWorld(me, me.R, city.half);
  }

  /** Per fixed step in a round: swallow what's in the hole, and swallow smaller holes. */
  stepRound(nowOw, hostSim) {
    const ctx = this.ctx;
    const me = this.me;
    const ids = collectSwallows(ctx.city, ctx.grid, ctx.eaten, me.x, me.z, me.R, this.scratch);
    for (let k = 0; k < ids.length; k++) this.localEat(ids[k], nowOw);
    // holes: the bigger one swallows the smaller one
    for (const v of this.views) {
      if (v.me || !v.alive || !v.shown || v.protect || v.gone) continue;
      if (!canGulp(me.R, v.Rt, Math.hypot(me.x - v.x, me.z - v.z))) continue;
      const last = me.gulpAsked.get(v.id) ?? -1e9;
      if (nowOw - last < 900) continue;
      me.gulpAsked.set(v.id, nowOw);
      if (hostSim) this.host.gulpFor(v.id);
      else this.room.send({ t: 'gulp', rid: ctx.rid, v: v.id }, { to: this.room.host });
    }
  }

  localEat(id, nowOw) {
    const ctx = this.ctx;
    const city = ctx.city;
    const me = this.me;
    ctx.eaten[id] |= 2;
    const value = city.value[id];
    me.pend.set(id, { v: value, at: nowOw });
    this.claimQueue.push(id);
    ctx.myEats++;
    this.stats.eats++;
    const type = city.type[id];
    if (isSkyscraper(type)) this.stats.skyscraper = true;
    this.emit('eat', { id, type, value, x: city.x[id], z: city.z[id], hx: me.x, hz: me.z, R: me.R, mine: true, count: ctx.myEats, skyscraper: isSkyscraper(type) });
  }

  flushClaims(nowOw, hostSim) {
    if (this.claimQueue.length === 0 || nowOw - this.lastClaim < C.CLAIM_EVERY) return;
    const ctx = this.ctx;
    const g = this.g;
    if (!g || g.rid !== ctx.rid || g.phase !== 'play') return; // wait for the host's record
    this.lastClaim = nowOw;
    const ids = this.claimQueue.splice(0, C.CLAIM_MAX_IDS);
    if (hostSim) {
      const res = this.host.claimFor(ids);
      for (const id of res.refusedIds) this.refuse(id);
    } else this.room.send({ t: 'eat', rid: ctx.rid, ids }, { to: this.room.host });
  }

  /** A claim nobody confirmed: the object wasn't mine after all. */
  refuse(id) {
    const ctx = this.ctx;
    const me = this.me;
    if (!me || !me.pend.has(id)) return;
    me.pend.delete(id);
    if (ctx.eaten[id] & 1) return;
    ctx.eaten[id] &= ~2;
    ctx.myEats = Math.max(0, ctx.myEats - 1);
    this.emit('restore', { id });
  }

  checkPending(nowOw) {
    const me = this.me;
    if (!me || me.pend.size === 0) return;
    const ctx = this.ctx;
    for (const [id, p] of me.pend) {
      if (ctx.eaten[id] & 1) {
        me.pend.delete(id);
        continue;
      }
      if (nowOw - p.at > PENDING_MS) this.refuse(id);
    }
  }

  /** I was swallowed, or I'm back: the host's record says when. */
  updateMyLife(nowMs, nowOw) {
    const me = this.me;
    const view = this.views[this.seat];
    if (!view) return;
    const alive = view.alive;
    if (me.alive && !alive) {
      me.alive = false;
      me.deadAt = nowMs;
      me.vx = 0;
      me.vz = 0;
      // what I'd claimed in my last moments is not coming back to me
      for (const id of [...me.pend.keys()]) this.refuse(id);
      this.claimQueue.length = 0;
    } else if (!me.alive && alive) {
      const spot = this.pickSpawn();
      me.alive = true;
      me.x = spot.x;
      me.z = spot.z;
      me.vx = 0;
      me.vz = 0;
      me.R = C.R0;
      me.pulseR = C.R0;
      me.gulpAsked.clear();
      view.R = C.R0;
      view.x = spot.x;
      view.z = spot.z;
    }
    void nowOw;
  }

  /** The edge spot farthest from the other holes. */
  pickSpawn() {
    const spawns = this.ctx.city.spawns;
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let near = Infinity;
      for (const v of this.views) {
        if (v.me || !v.alive) continue;
        near = Math.min(near, Math.hypot(v.x - s.x, v.z - s.z));
      }
      const score = Math.min(near, 80) + Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  growPulse() {
    const me = this.me;
    if (!me) return;
    if (me.R >= me.pulseR * 1.06) {
      me.pulseR = me.R;
      this.emit('grow', { x: me.x, z: me.z, R: me.R });
    } else if (me.R < me.pulseR * 0.6) me.pulseR = me.R;
  }

  /** A hint when my hole is pressed against something too big: now and then, never more than a few times. */
  scanHint(nowOw, ctx) {
    const me = this.me;
    if (!me || nowOw - this.lastHintScan < 160) return;
    this.lastHintScan = nowOw;
    if (this.hintCount >= 4 || nowOw - this.lastHint < 7000) return;
    const city = ctx.city;
    let found = false;
    ctx.grid.query(me.x, me.z, me.R + 3, (id) => {
      if (found || ctx.eaten[id]) return;
      const r = city.r[id];
      if (canEat(me.R, r)) return;
      if (Math.hypot(city.x[id] - me.x, city.z[id] - me.z) < me.R + r * 0.35) found = true;
    });
    const movers = city.moverIds;
    for (let k = 0; k < movers.length && !found; k++) {
      const id = movers[k];
      if (ctx.eaten[id] || canEat(me.R, city.r[id])) continue;
      if (Math.hypot(city.x[id] - me.x, city.z[id] - me.z) < me.R + city.r[id] * 0.35) found = true;
    }
    if (found) {
      this.lastHint = nowOw;
      this.hintCount++;
      this.emit('hint', { kind: 'toobig', x: me.x, z: me.z });
    }
  }

  /** The host says someone was swallowed: a callout for everyone. */
  updateKills(g) {
    if (!g || !g.k || !Number.isFinite(g.k.n)) return;
    if (g.k.n <= this.lastKill) return;
    this.lastKill = g.k.n;
    const a = g.k.a;
    const b = g.k.b;
    if (this.roster[a] === undefined || this.roster[b] === undefined) return;
    if (a === this.seat) this.stats.gulps++;
    this.emit('gulp', { a, b, x: num(g.k.x), z: num(g.k.z), byMe: a === this.seat, meVictim: b === this.seat, count: g.k.n });
  }

  /** My position into presence, only when it changed (or now and then, so others know I'm here). */
  publish(nowOw, key, mass) {
    const me = this.me;
    if (!me) return;
    const x = r2(me.x);
    const z = r2(me.z);
    if (Math.abs(x - this.sentX) < 0.005 && Math.abs(z - this.sentZ) < 0.005 && key === this.sentKey && nowOw - this.sentAt < 1000) return;
    this.sentX = x;
    this.sentZ = z;
    this.sentKey = key;
    this.sentAt = nowOw;
    this.room.setPresence({ x, z, k: key, m: mass });
  }
}
