// The host's page runs the match: it builds the roster, runs the round clock, keeps the eaten set and everyone's score
// (the Sim), plays the bots, and writes it all into room state for the others to draw. It follows the party template:
// everything a new host needs is in room state (`g`, `e`, `h`), `adopt()` is safe to call as often as you like, and every
// deadline is a match-time value in `g`.
//
// Room state it writes (all small):
//   g  { v, mid, by, n, rounds, time, rid, phase: 'play'|'score'|'final', t0, until, seed, roster, s, m, d, pts, tot, res, fin, k }
//   e  { rid, n, bits }               the eaten set of the round, as a base64 bitset (about 300 characters)
//   h  { rid, t, p: [[x, z, alive]] } where the bots are, for the others to interpolate

import { Sim } from '../logic/sim.js';
import { buildRoster, citySeed, roundId, roundResult, finalOrder, roundKey } from '../logic/match.js';
import * as C from '../logic/config.js';
import { getCity } from './cities.js';

const r1 = (v) => Math.round(v * 10) / 10;

export const pickSetting = (value, options, fallback) => (options.includes(Number(value)) ? Number(value) : fallback);

export class HostController {
  constructor(room) {
    this.room = room;
    this.sim = null;
    this.simRid = null;
    this.pts = [];
    this.tot = [];
    this.lastFlush = 0;
    this.lastBots = 0;
    this.endedFor = null;
    this.myPos = null;
  }

  G() {
    return this.room.state.g ?? null;
  }

  write(patch) {
    this.room.setState('g', { ...this.G(), ...patch });
  }

  /** The record is this match's and this page wrote it last. */
  isMine(g) {
    return !!g && g.mid === this.room.match.id && g.by === this.room.me.id;
  }

  /** The host's own hole, so the rules see it where the page has it (a little fresher than its presence). */
  setMyPos(x, z) {
    this.myPos = { x, z };
  }

  // ---------------------------------------------------------------------------------------------------- starting things

  beginMatch() {
    const { room } = this;
    const m = room.match;
    const humans = (m.participants ?? []).slice(0, C.MAX_PLAYERS);
    const roster = buildRoster(humans, m.seed);
    const zeros = roster.map(() => 0);
    this.pts = zeros.slice();
    this.tot = zeros.slice();
    this.endedFor = null;
    this.sim = null;
    this.simRid = null;
    room.setState('g', {
      v: C.DATA_VERSION,
      mid: m.id,
      by: room.me.id,
      n: 0,
      rounds: pickSetting(room.settings?.rounds, C.ROUND_OPTIONS, C.DEFAULT_ROUNDS),
      time: pickSetting(room.settings?.time, C.TIME_OPTIONS, C.DEFAULT_TIME),
      rid: null,
      phase: 'idle',
      t0: 0,
      until: 0,
      seed: 0,
      roster: roster.map((e) => (e.bot ? { i: e.id, b: 1, n: e.name } : { i: e.id })),
      s: zeros.slice(),
      m: zeros.slice(),
      d: zeros.slice(),
      pts: zeros.slice(),
      tot: zeros.slice(),
      res: null,
      fin: null,
      k: { n: 0 },
    });
    room.setState('e', null);
    room.setState('h', null);
    this.beginRound(1);
  }

  rosterOf(g) {
    return g.roster.map((r) => ({ id: r.i, bot: !!r.b, name: r.n }));
  }

  beginRound(n) {
    const { room } = this;
    const g = this.G();
    const now = room.matchNow();
    const seed = citySeed(room.match.seed, n);
    const city = getCity(seed);
    const rid = roundId(room.match.id, n);
    this.sim = new Sim(city, this.rosterOf(g), { seed, startMs: now });
    this.simRid = rid;
    const st = this.sim.exportState();
    room.setState('e', { rid, n: city.n, bits: '' });
    room.setState('h', null);
    this.write({ by: room.me.id, n, rid, phase: 'play', t0: now, until: now + g.time * 1000, seed, s: st.s, m: st.m, d: st.d, res: null });
    this.sim.dirty = false;
    this.lastFlush = now;
    this.lastBots = 0;
    this.feedHumans();
  }

  endRound() {
    const { room } = this;
    const g = this.G();
    const sim = this.sim;
    const now = room.matchNow();
    sim.advanceTo(g.until);
    this.flush(now, true);
    const st = sim.exportState();
    const res = roundResult(st.s, st.m);
    for (const r of res) {
      this.pts[r.idx] = (this.pts[r.idx] ?? 0) + r.points;
      this.tot[r.idx] = (this.tot[r.idx] ?? 0) + r.score;
    }
    room.setState('e', { rid: g.rid, n: sim.city.n, bits: sim.eatenText() });
    this.write({ phase: 'score', until: now + C.SCORE_MS, s: st.s, m: st.m, d: st.d, pts: this.pts.slice(), tot: this.tot.slice(), res: res.map((r) => [r.idx, r.score, r.points]) });
    sim.dirty = false;
  }

  finish() {
    const now = this.room.matchNow();
    this.write({ phase: 'final', until: now + C.FINAL_MS, fin: finalOrder(this.pts, this.tot) });
  }

  // ---------------------------------------------------------------------------------------------------- taking over

  /** Carries on as the host: starts the match if there's no record of it, otherwise picks up the record and the round. */
  adopt() {
    const { room } = this;
    if (!room.isHost || !room.running) return;
    const g = this.G();
    if (!validRecord(g, room.match.id)) return this.beginMatch();
    if (g.phase === 'idle') return this.beginRound(Math.max(1, g.n + 1));
    this.restoreTotals(g);
    this.ensureSim(g);
    if (g.by !== room.me.id) this.write({ by: room.me.id });
  }

  restoreTotals(g) {
    const n = g.roster.length;
    if (this.pts.length !== n || g.by !== this.room.me.id) {
      this.pts = Array.isArray(g.pts) && g.pts.length === n ? g.pts.map((v) => (Number.isFinite(v) ? v : 0)) : new Array(n).fill(0);
      this.tot = Array.isArray(g.tot) && g.tot.length === n ? g.tot.map((v) => (Number.isFinite(v) ? v : 0)) : new Array(n).fill(0);
    }
  }

  /** The Sim for the round in `g`, built from room state when this page doesn't have it (a new host, or a reload). */
  ensureSim(g) {
    if (g.phase !== 'play' || (this.sim && this.simRid === g.rid)) return;
    const { room } = this;
    const city = getCity(g.seed);
    const sim = new Sim(city, this.rosterOf(g), { seed: g.seed, startMs: g.t0 });
    sim.importState(g);
    const e = room.state.e;
    if (e && e.rid === g.rid && e.n === city.n && typeof e.bits === 'string') sim.loadEaten(e.bits);
    const h = room.state.h;
    if (h && h.rid === g.rid) sim.loadBots(h.p);
    sim.last = Math.max(g.t0, room.matchNow());
    sim.t = sim.last;
    sim.dirty = true;
    this.sim = sim;
    this.simRid = g.rid;
    this.restoreTotals(g);
    this.feedHumans();
  }

  // ---------------------------------------------------------------------------------------------------- every tick

  /** The 100 ms ticker: phases, the round clock, and writing state out. Acts only when this page is the host of the record. */
  tick() {
    const { room } = this;
    if (!room.isHost || !room.running) return;
    const g = this.G();
    if (!this.isMine(g)) return;
    const now = room.matchNow();
    if (g.phase === 'play') {
      this.ensureSim(g);
      this.step(now);
      if (now >= g.until) return this.endRound();
      this.flush(now);
    } else if (g.phase === 'score') {
      if (now >= g.until) {
        if (g.n < g.rounds) this.beginRound(g.n + 1);
        else this.finish();
      }
    } else if (g.phase === 'final') {
      if (now >= g.until && this.endedFor !== g.mid) {
        this.endedFor = g.mid;
        room.endMatch();
      }
    }
  }

  /** Runs the bots and the rules up to match time `now`, feeding in where the humans are. Cheap to call every frame. */
  step(now) {
    const g = this.G();
    if (!this.sim || !g || g.phase !== 'play' || this.simRid !== g.rid) return;
    this.feedHumans();
    this.sim.advanceTo(Math.min(now, g.until));
    this.maybeBots(now);
  }

  maybeBots(now) {
    const g = this.G();
    if (!this.sim || !g || now - this.lastBots < C.BOT_EVERY) return;
    this.lastBots = now;
    this.room.setState('h', { rid: g.rid, t: Math.round(this.sim.last), p: this.sim.botSnapshot() });
  }

  /** Where each human's hole is, from their presence (only if it belongs to this round); leavers are marked gone. */
  feedHumans() {
    const { room, sim } = this;
    const g = this.G();
    if (!sim || !g) return;
    const key = roundKey(g.rid);
    for (const h of sim.holes) {
      if (h.bot) continue;
      const here = room.players.get(h.id);
      sim.setGone(h.id, !here);
      if (!here) continue;
      if (h.id === room.me.id) {
        if (this.myPos) sim.setPos(h.id, this.myPos.x, this.myPos.z, sim.last);
        continue;
      }
      const p = here.presence;
      if (p && typeof p === 'object' && p.k === key) sim.setPos(h.id, p.x, p.z, sim.last);
    }
  }

  flush(now, force = false) {
    const { room, sim } = this;
    if (!sim) return;
    if (!force && (!sim.dirty || now - this.lastFlush < C.STATE_EVERY)) return;
    const g = this.G();
    const st = sim.exportState();
    const patch = { s: st.s, m: st.m, d: st.d };
    const kills = sim.drainKills();
    if (kills.length) {
      const last = kills[kills.length - 1];
      patch.k = { n: (g.k?.n ?? 0) + kills.length, a: last.a, b: last.b, x: r1(last.x), z: r1(last.z) };
    }
    room.setState('e', { rid: g.rid, n: sim.city.n, bits: sim.eatenText() });
    this.write(patch);
    sim.dirty = false;
    this.lastFlush = now;
  }

  // ---------------------------------------------------------------------------------------------------- what pages ask

  /** A message from another page. */
  onMessage(d, from) {
    const { room } = this;
    if (!d || typeof d !== 'object' || !from || typeof from.id !== 'string') return;
    if (!room.isHost || !room.running) return;
    const g = this.G();
    if (!this.isMine(g) || g.phase !== 'play' || d.rid !== g.rid) return;
    this.ensureSim(g);
    if (!this.sim) return;
    const now = room.matchNow();
    this.step(now);
    if (d.t === 'eat' && Array.isArray(d.ids)) this.sim.claim(from.id, d.ids, now);
    else if (d.t === 'gulp' && typeof d.v === 'string') this.sim.gulp(from.id, d.v, now);
  }

  /** The host's own hole eats (no message to itself). */
  claimFor(ids) {
    const { room } = this;
    const g = this.G();
    if (!this.sim || !g || g.phase !== 'play') return { accepted: 0, refused: ids.length, refusedIds: ids.slice() };
    return this.sim.claim(room.me.id, ids, room.matchNow());
  }

  gulpFor(victimId) {
    const { room } = this;
    const g = this.G();
    if (!this.sim || !g || g.phase !== 'play') return false;
    return this.sim.gulp(room.me.id, victimId, room.matchNow());
  }

  reset() {
    this.sim = null;
    this.simRid = null;
    this.endedFor = null;
  }
}

/** A `g` that belongs to this match and has the shape the pages rely on. */
export function validRecord(g, matchId) {
  return (
    !!g &&
    typeof g === 'object' &&
    g.mid === matchId &&
    Array.isArray(g.roster) &&
    g.roster.length > 0 &&
    g.roster.length <= C.MAX_PLAYERS &&
    g.roster.every((r) => r && typeof r.i === 'string') &&
    Array.isArray(g.s) &&
    Array.isArray(g.m) &&
    Array.isArray(g.d) &&
    typeof g.phase === 'string' &&
    Number.isFinite(g.until)
  );
}
