// On Onceworlds the platform injects `window.onceworlds` before the game's scripts. Opened on its own (a static server,
// a build preview) the game gets this stand-in instead: saves in localStorage and a solo room whose one player is the
// host, with the same match cycle as a public server (ready, a 3 second countdown, play, end), so the same code runs.

function emitter() {
  const listeners = new Map();
  return {
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
    emit(ev, ...args) {
      for (const fn of listeners.get(ev) ?? []) fn(...args);
    },
  };
}

function soloRoom(player, join) {
  const bus = emitter();
  const settingsSchema = join?.settings ?? [];
  const chosen = {};
  for (const s of settingsSchema) chosen[s.id] = s.default ?? (typeof s.options[0] === 'object' ? s.options[0].value : s.options[0]);
  let frozen = null;
  let startedAt = 0;
  let countdownTimer = null;
  let n = 0;
  const me = { id: player.id, name: player.name, presence: null, team: 0, ready: false, connected: true };
  const room = {
    id: 'solo',
    kind: 'solo',
    invite: null,
    teams: 0,
    open: true,
    me,
    players: new Map([[me.id, me]]),
    state: {},
    host: me.id,
    connected: true,
    match: { phase: 'lobby', n: 0, id: '', min: 1, participants: [], seed: 1, startsAt: 0 },
    get isHost() {
      return true;
    },
    get online() {
      return [me];
    },
    get participants() {
      return room.match.phase === 'lobby' ? [] : [me];
    },
    get spectating() {
      return false;
    },
    get running() {
      return room.match.phase === 'playing';
    },
    get settings() {
      return frozen ?? { ...chosen };
    },
    get canStart() {
      return true;
    },
    get allReady() {
      return true;
    },
    get notReady() {
      return [];
    },
    isParticipant: () => room.match.phase !== 'lobby',
    matchNow: () => (room.match.phase === 'playing' ? Date.now() - startedAt : 0),
    on: bus.on,
    send() {},
    setPresence(p) {
      me.presence = p;
    },
    presenceAt: () => me.presence,
    setState(k, v) {
      if (v === null || v === undefined) delete room.state[k];
      else room.state[k] = v;
    },
    setTeam() {},
    setOpen() {},
    kick() {},
    voteKick() {},
    setSetting(id, value) {
      chosen[id] = value;
      bus.emit('settings', { ...chosen });
    },
    hideLobby() {},
    clearReady() {
      me.ready = false;
    },
    setReady(ready) {
      me.ready = !!ready;
      if (ready && room.match.phase === 'lobby') room.startMatch();
    },
    startMatch() {
      if (room.match.phase !== 'lobby') return;
      frozen = { ...chosen };
      n++;
      const startsAt = Date.now() + 3000;
      room.match = { phase: 'starting', n, id: `solo${n}`, min: 1, participants: [me.id], seed: (Math.random() * 1e9) | 0, startsAt, startedAt: 0 };
      bus.emit('starting', room.match);
      bus.emit('match', room.match);
      countdownTimer = setTimeout(() => {
        startedAt = Date.now();
        room.match = { ...room.match, phase: 'playing', startedAt };
        bus.emit('match', room.match);
        bus.emit('matchstart', room.match);
      }, 3000);
    },
    endMatch() {
      if (room.match.phase === 'lobby') return;
      clearTimeout(countdownTimer);
      const previous = room.match;
      frozen = null;
      me.ready = false;
      room.match = { phase: 'lobby', n, id: previous.id, min: 1, participants: [], seed: 1, startsAt: 0 };
      bus.emit('match', room.match, previous);
      bus.emit('matchend', room.match, previous);
    },
    pauseMatch() {},
    admit() {},
    leave() {},
  };
  return room;
}

export function standaloneSdk() {
  const bus = emitter();
  const key = (k) => `black-hole-city:${k}`;
  const store = {
    get(k) {
      try {
        const v = localStorage.getItem(key(k));
        return v ? JSON.parse(v) : null;
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(key(k), JSON.stringify(v));
      } catch {}
    },
  };
  let id = store.get('guest');
  if (!id) {
    id = `local-${Math.random().toString(36).slice(2, 10)}`;
    store.set('guest', id);
  }
  const player = { id, name: 'You', guest: true };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const settingsBus = emitter();
  const settings = {
    quality: 'high',
    scale: 1,
    choice: 'auto',
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    pixelRatio: (max = 2) => Math.min(window.devicePixelRatio || 1, max),
    on: settingsBus.on,
  };
  return {
    mode: 'standalone',
    env: {},
    player: { get: async () => player, rename: async () => null, avatarUrl: async () => null },
    save: {
      get: async (k) => store.get(k),
      set: async (k, v) => store.set(k, v),
      delete: async () => {},
      list: async () => [],
    },
    badges: { award: async () => false, list: async () => [], has: async () => false },
    leaderboards: { submit: async () => null, top: async () => ({ entries: [], me: null }) },
    rooms: { join: async (options) => soloRoom(player, options), on: () => () => {}, current: null },
    ratings: { get: async () => null, top: async () => [] },
    ui: { setMenuPosition() {}, requestFullscreen() {}, showInvite() {}, setOrientation() {} },
    controls: { set() {}, stick: { x: 0, y: 0 }, pressed: () => false, touch: coarse },
    settings,
    now: () => Date.now(),
    on: bus.on,
    fetch: (...args) => fetch(...args),
  };
}

export const getSdk = () => window.onceworlds ?? standaloneSdk();
