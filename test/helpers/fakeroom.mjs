// A stand-in for the Onceworlds platform: one hub, a room per client, delayed delivery of state, presence and messages,
// the lobby -> countdown -> match cycle, host changes. Just enough of the SDK's room for Session and HostController.

export class Hub {
  constructor({ latency = 90, settings = { time: 90, rounds: 1 }, seed = 4242, kind = 'public' } = {}) {
    this.t = 0; // platform clock, ms
    this.latency = latency;
    this.queue = [];
    this.clients = new Map();
    this.hostId = null;
    this.settings = settings;
    this.kind = kind;
    this.matchSeed = seed;
    this.n = 0;
    this.match = { phase: 'lobby', n: 0, min: 1, id: '', seed: 0, participants: [], startsAt: 0, startedAt: 0, paused: false };
    this.pausedMs = 0;
    this.pausedAt = 0;
    this.ended = [];
    this.frozen = null;
  }

  now() {
    return this.t;
  }

  join(id, name = id) {
    const c = new FakeRoom(this, id, name);
    // everyone already here learns of the newcomer, and the newcomer of everyone
    for (const other of this.clients.values()) {
      const p = { id, name, presence: null, ready: false, connected: true };
      other.players.set(id, p);
      other.emit('join', p);
      c.players.set(other.me.id, { ...other.players.get(other.me.id) });
    }
    this.clients.set(id, c);
    c.players.set(id, c.me);
    if (!this.hostId) this.hostId = id;
    // a newcomer reads the room's state as it is
    const first = this.clients.values().next().value;
    if (first && first !== c) c.state = JSON.parse(JSON.stringify(first.state));
    return c;
  }

  setHost(id) {
    this.hostId = id;
    for (const c of this.clients.values()) c.emit('host', id);
  }

  leave(id) {
    this.clients.delete(id);
    for (const c of this.clients.values()) {
      const p = c.players.get(id);
      c.players.delete(id);
      c.emit('leave', p);
    }
    if (this.hostId === id) this.setHost([...this.clients.keys()][0] ?? null);
  }

  schedule(fn, delay = this.latency) {
    this.queue.push({ at: this.t + delay, fn });
  }

  /** Moves the platform clock forward, delivering what is due and running the match timers. */
  advance(ms) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + 10);
      this.queue.sort((a, b) => a.at - b.at);
      while (this.queue.length && this.queue[0].at <= this.t) this.queue.shift().fn();
      if (this.match.phase === 'starting' && this.t >= this.match.startsAt) this.beginPlaying();
    }
  }

  matchNow() {
    if (this.match.phase !== 'playing') return 0;
    if (this.match.paused) return this.pausedAt - this.match.startedAt - this.pausedMs;
    return this.t - this.match.startedAt - this.pausedMs;
  }

  startCountdown() {
    const ready = [...this.clients.values()].filter((c) => c.me.ready || c.me.id === this.hostId).map((c) => c.me.id);
    this.n++;
    this.match = { phase: 'starting', n: this.n, min: 1, id: `m${this.n}`, seed: this.matchSeed + this.n, participants: ready, startsAt: this.t + 3000, startedAt: 0, paused: false };
    this.pausedMs = 0;
    this.frozen = { ...this.settings };
    this.sync();
    for (const c of this.clients.values()) c.emit('starting', this.match);
  }

  beginPlaying() {
    this.match = { ...this.match, phase: 'playing', startedAt: this.t };
    this.sync();
    for (const c of this.clients.values()) c.emit('matchstart', this.match);
  }

  endMatch() {
    this.ended.push(this.match.id);
    const previous = this.match;
    this.match = { phase: 'lobby', n: this.n, min: 1, id: this.match.id, seed: 0, participants: [], startsAt: 0, startedAt: 0, paused: false };
    this.frozen = null;
    this.sync();
    for (const c of this.clients.values()) {
      c.me.ready = false;
      c.emit('matchend', this.match, previous);
    }
  }

  /** Too few players are connected: the match waits and its clock stands still. */
  pause() {
    if (this.match.phase !== 'playing' || this.match.paused) return;
    this.pausedAt = this.t;
    this.match = { ...this.match, paused: true };
    this.sync();
    for (const c of this.clients.values()) c.emit('matchpause', this.match);
  }

  resume() {
    if (!this.match.paused) return;
    this.pausedMs += this.t - this.pausedAt;
    this.match = { ...this.match, paused: false };
    this.sync();
    for (const c of this.clients.values()) c.emit('matchresume', this.match);
  }

  sync() {
    for (const c of this.clients.values()) c.match = this.match;
  }
}

export class FakeRoom {
  constructor(hub, id, name) {
    this.hub = hub;
    this.me = { id, name, presence: null, ready: false, connected: true };
    this.players = new Map();
    this.state = {};
    this.listeners = new Map();
    this.kind = hub.kind;
    this.connected = true;
    this.sent = 0;
    this.match = hub.match;
  }

  on(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev).add(fn);
    return () => this.listeners.get(ev).delete(fn);
  }

  emit(ev, ...args) {
    for (const fn of this.listeners.get(ev) ?? []) fn(...args);
  }

  get host() {
    return this.hub.hostId;
  }
  get isHost() {
    return this.connected && this.hub.hostId === this.me.id;
  }
  get settings() {
    return this.hub.frozen ?? this.hub.settings;
  }
  get online() {
    return [...this.players.values()].filter((p) => p.connected !== false);
  }
  get participants() {
    const ids = this.match.participants;
    if (this.match.phase === 'lobby') return [];
    return ids.map((id) => this.players.get(id)).filter(Boolean);
  }
  isParticipant(id = this.me.id) {
    return this.match.phase !== 'lobby' && this.match.participants.includes(id);
  }
  get spectating() {
    return this.match.phase !== 'lobby' && !this.isParticipant();
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  matchNow() {
    return this.hub.matchNow();
  }
  get canStart() {
    return true;
  }

  setReady(v) {
    this.me.ready = !!v;
  }
  setSetting(id, value) {
    if (this.isHost && this.match.phase === 'lobby') this.hub.settings = { ...this.hub.settings, [id]: value };
  }
  startMatch() {
    if (this.isHost && this.match.phase === 'lobby') this.hub.startCountdown();
  }
  endMatch() {
    if (this.isHost && this.match.phase === 'playing') this.hub.endMatch();
  }
  setOpen() {}
  hideLobby() {}
  clearReady() {}

  setState(key, value) {
    if (value === null || value === undefined) delete this.state[key];
    else this.state[key] = value;
    const copy = value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
    for (const other of this.hub.clients.values()) {
      if (other === this) continue;
      this.hub.schedule(() => {
        if (copy === null) delete other.state[key];
        else other.state[key] = copy;
        other.emit('state', key, copy, this.me.id);
      });
    }
  }

  setPresence(p) {
    const copy = JSON.parse(JSON.stringify(p));
    this.me.presence = copy;
    for (const other of this.hub.clients.values()) {
      if (other === this) continue;
      this.hub.schedule(() => {
        const pl = other.players.get(this.me.id);
        if (pl) pl.presence = copy;
      }, 50);
    }
  }

  presenceAt(id) {
    if (id === this.me.id) return this.me.presence;
    return this.players.get(id)?.presence ?? null;
  }

  send(data, { to } = {}) {
    this.sent++;
    const copy = JSON.parse(JSON.stringify(data));
    const targets = to ? [this.hub.clients.get(to)] : [...this.hub.clients.values()].filter((c) => c !== this);
    for (const other of targets) {
      if (!other) continue;
      this.hub.schedule(() => other.emit('message', copy, { id: this.me.id, name: this.me.name }, this.hub.t, other.matchNow()));
    }
  }
}
