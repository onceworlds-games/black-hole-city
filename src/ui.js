// The screens made of HTML: title, the top HUD, the lobby's settings, the countdown, banners and callouts, the scoreboard
// between rounds and the podium at the end. Every piece of text from another player goes in with textContent.

import { SEAT_COLORS, TIME_OPTIONS, ROUND_OPTIONS } from './logic/config.js';
import { placeLabel } from './logic/match.js';
import { hexCss, initial } from './avatars.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const setText = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};
const show = (node, on) => {
  if (node.hidden === on) node.hidden = !on;
};
const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtScore = (n) => Math.round(n).toLocaleString('en-US');
const short = (name, n = 14) => {
  const chars = Array.from(name || '');
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : name || '…';
};

const SETTINGS = [
  { id: 'time', label: 'TIME', options: TIME_OPTIONS.map((v) => ({ value: v, label: fmtTime(v * 1000) })) },
  { id: 'rounds', label: 'ROUNDS', options: ROUND_OPTIONS.map((v) => ({ value: v, label: String(v) })) },
];

export class UI {
  /**
   * deps: { session, room, ow, avatars, sound, onPlay }
   */
  constructor(root, deps) {
    Object.assign(this, deps);
    this.root = root;
    this.reduced = false;
    this.lastCount = -99;
    this.goFor = null;
    this.bannerRid = null;
    this.cardKey = '';
    this.resultsKey = '';
    this.lastSecond = -1;
    this.lastBlink = 0;
    this.feedItems = [];
    this.build();
  }

  build() {
    const root = this.root;
    // title
    this.title = el('div', 'title');
    const logo = el('div', 'logo');
    const l1 = el('div', 'l1 ink');
    const hole = el('span', 'hole');
    l1.append('BLACK H', hole, 'LE');
    logo.append(l1, el('div', 'l2 ink', 'CITY'));
    this.playBtn = el('button', 'play hit');
    this.playBtn.type = 'button';
    this.playBtn.setAttribute('aria-label', 'Play');
    this.playBtn.append(el('span', '', 'PLAY'), el('kbd', '', 'SPACE'));
    this.playBtn.addEventListener('click', () => this.onPlay());
    this.title.append(logo, this.playBtn);

    // HUD
    this.clock = el('div', 'clock');
    this.clockT = el('span', 't ink', '0:00');
    this.clockR = el('span', 'r', '');
    this.clock.append(this.clockT, this.clockR);
    this.side = el('div', 'side');
    this.me = el('div', 'me');
    this.mePlace = el('span', 'place ink', '');
    this.meScore = el('span', 'score ink', '');
    this.me.append(this.mePlace, this.meScore);
    this.rowsEl = el('div', 'rows');
    this.rows = [];
    for (let i = 0; i < 5; i++) {
      const row = { id: '', root: el('div', 'row'), n: el('span', 'n'), av: el('span', 'av'), nm: el('span', 'nm'), sc: el('span', 'sc') };
      row.root.append(row.n, row.av, row.nm, row.sc);
      this.rowsEl.append(row.root);
      this.rows.push(row);
    }
    this.side.append(this.me, this.rowsEl);
    this.feedEl = el('div', 'feed');
    this.watch = el('div', 'watch');
    this.watchName = el('span', '', '');
    this.watch.append(el('span', '', 'WATCHING '), this.watchName, el('small', '', 'TAP: NEXT'));

    // callouts
    this.stage = el('div', 'stage');
    this.banner = el('div', 'banner');
    this.bannerL1 = el('div', 'l1 ink', '');
    this.bannerL2 = el('div', 'l2 ink', '');
    this.banner.append(this.bannerL1, this.bannerL2);
    this.callEl = el('div', 'callout ink', '');
    this.stage.append(this.banner, this.callEl);
    this.dead = el('div', 'dead');
    this.deadL1 = el('div', 'l1 ink', 'SWALLOWED');
    this.deadL2 = el('div', 'l2 ink', '');
    this.dead.append(this.deadL1, this.deadL2);
    this.count = el('div', 'count ink');
    this.countN = el('span', '', '');
    this.count.append(this.countN);

    // lobby
    this.lobby = el('div', 'lobbytop');
    this.lobbyBar = el('div', 'lobbybar');
    this.settingUI = SETTINGS.map((def) => {
      const group = el('div', 'group');
      const lab = el('span', 'lab ink', def.label);
      const val = el('span', 'val ink', '');
      const opts = el('div', 'opts');
      const buttons = def.options.map((o) => {
        const b = el('button', 'opt hit');
        b.type = 'button';
        b.append(el('span', '', o.label));
        b.setAttribute('aria-label', `${def.label} ${o.label}`);
        b.addEventListener('click', () => {
          if (this.room.isHost) {
            this.room.setSetting(def.id, o.value);
            this.sound.select();
          }
        });
        opts.append(b);
        return { b, value: o.value };
      });
      group.append(lab, val, opts);
      this.lobbyBar.append(group);
      return { def, group, val, opts, buttons, shown: '' };
    });
    this.hint = el('div', 'hint ink', 'SWALLOW THINGS SMALLER THAN YOU');
    this.lobby.append(this.lobbyBar, this.hint);

    // between rounds and the end
    this.card = el('div', 'card');
    this.cardTitle = el('h2', 'ink', '');
    this.cardRows = el('div', '');
    this.card.append(this.cardTitle, this.cardRows);
    this.results = el('div', 'results');
    this.resultsH = el('h1', 'ink', '');
    this.podium = el('div', 'podium');
    this.youEl = el('div', 'you ink', '');
    this.results.append(this.resultsH, this.podium, this.youEl);

    this.msg = el('div', 'msg');
    this.msgText = el('div', 'ink', '');
    this.msgBtn = el('button', 'play hit');
    this.msgBtn.type = 'button';
    this.msg.append(this.msgText, this.msgBtn);

    root.append(this.title, this.clock, this.side, this.feedEl, this.stage, this.dead, this.count, this.lobby, this.card, this.results, this.watch, this.msg);
    for (const n of [this.title, this.clock, this.side, this.dead, this.count, this.lobby, this.card, this.results, this.watch, this.msg]) n.hidden = true;
    this.banner.hidden = true;
    this.callEl.hidden = true;
  }

  /** True when a pointer landed on something of ours that takes taps. */
  isUi(target) {
    return !!target?.closest?.('.hit');
  }

  // ---------------------------------------------------------------------------------------------------- one-off messages

  /** Big words at the start of a round. */
  showBanner(l1, l2 = '') {
    setText(this.bannerL1, l1);
    setText(this.bannerL2, l2);
    this.bannerL2.hidden = !l2;
    this.banner.hidden = false;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  /** One word or two in the middle, gone in a second and a half. kind: 'good' | 'bad' | ''. */
  callout(text, kind = '') {
    setText(this.callEl, text);
    this.callEl.className = `callout ink ${kind}`;
    this.callEl.hidden = false;
    this.callEl.classList.remove('show');
    void this.callEl.offsetWidth;
    this.callEl.classList.add('show');
  }

  /** "BLAZE > NOVA" under the clock for a few seconds. */
  feed(a, b, mine) {
    const row = el('div', mine ? 'mine' : '');
    row.append(short(a, 12), el('b', '', '▸'), short(b, 12));
    this.feedEl.append(row);
    while (this.feedEl.children.length > 3) this.feedEl.firstChild.remove();
    setTimeout(() => row.remove(), 3700);
  }

  showClosed(reason, retry) {
    const text = reason === 'kicked' ? 'YOU WERE REMOVED' : reason === 'replaced' ? 'PLAYING IN ANOTHER TAB' : 'DISCONNECTED';
    const label = reason === 'replaced' ? 'PLAY HERE' : reason === 'kicked' ? 'PLAY' : 'REJOIN';
    setText(this.msgText, text);
    this.msgBtn.textContent = '';
    this.msgBtn.append(el('span', '', label));
    this.msgBtn.onclick = () => retry();
    this.msg.hidden = false;
  }

  // ---------------------------------------------------------------------------------------------------- faces

  avatarInto(node, id, bot, name, seat) {
    if (node.dataset.id === id && node.dataset.name === name) return;
    node.dataset.id = id;
    node.dataset.name = name;
    node.textContent = initial(name);
    node.style.background = hexCss(SEAT_COLORS[seat % SEAT_COLORS.length]);
    if (bot) return;
    this.avatars.whenUrl(id, bot, (url) => {
      if (node.dataset.id !== id) return;
      const img = document.createElement('img');
      img.alt = '';
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (node.dataset.id !== id) return;
        node.textContent = '';
        node.append(img);
      };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------------------------------------------- every frame

  update() {
    const s = this.session;
    const room = this.room;
    const mode = s.mode;
    const sub = s.sub;
    const title = mode === 'title';
    const lobby = mode === 'lobby';
    const countdown = mode === 'countdown';
    const round = mode === 'round';
    const spectating = (round || countdown) && room.spectating;
    this.root.classList.toggle('watching', spectating);
    this.root.classList.toggle('coarse', !!this.ow.controls?.touch);
    this.root.classList.toggle('reduced', !!this.reduced);

    show(this.title, title);
    show(this.lobby, lobby);
    if (lobby) this.updateLobby();

    this.updateCount(countdown, round, sub);

    const playPhase = round && sub === 'play';
    const hudOn = playPhase || (round && sub === 'score');
    show(this.clock, playPhase);
    show(this.side, hudOn && sub === 'play');
    if (playPhase) this.updateHud();

    // swallowed: a countdown to coming back
    const mine = s.views[s.seat];
    const dead = playPhase && s.me && !s.me.alive && mine;
    show(this.dead, !!dead);
    if (dead) setText(this.deadL2, `BACK IN ${Math.max(1, Math.ceil((mine.dead - room.matchNow()) / 1000))}`);

    // a new round's words
    const g = s.g;
    if (playPhase && g && g.rid && this.bannerRid !== g.rid) {
      this.bannerRid = g.rid;
      if (room.matchNow() - g.t0 < 3000) {
        if (g.rounds > 1) this.showBanner(`ROUND ${g.n}`, 'BIGGEST HOLE WINS');
        else this.showBanner('SWALLOW THE CITY', 'BIGGEST HOLE WINS');
      }
    }
    if (!round && this.bannerRid) this.bannerRid = null;
    if (!round && !countdown && !this.banner.hidden) this.banner.hidden = true;

    // watching
    const watching = spectating && round && (sub === 'play' || sub === 'score');
    show(this.watch, watching);
    if (watching) setText(this.watchName, short(s.spectateView()?.name ?? '', 14));

    // between rounds, and the end
    show(this.card, round && sub === 'score' && !!g);
    if (round && sub === 'score' && g) this.updateCard(g);
    else this.cardKey = '';
    const finalNow = round && sub === 'final' && g;
    const card = lobby && s.results;
    show(this.results, !!(finalNow || card));
    if (finalNow || card) {
      const data = finalNow ? { g, names: s.namesNow() } : s.results;
      this.updateResults(data, !!card);
    } else this.resultsKey = '';
  }

  updateLobby() {
    const room = this.room;
    const isHost = room.isHost;
    const cur = room.settings ?? {};
    for (const u of this.settingUI) {
      show(u.opts, isHost);
      show(u.val, !isHost);
      const now = cur[u.def.id];
      const opt = u.def.options.find((o) => o.value === now) ?? u.def.options[0];
      setText(u.val, opt.label);
      for (const b of u.buttons) b.b.classList.toggle('on', b.value === opt.value);
    }
  }

  updateCount(countdown, round, sub) {
    const room = this.room;
    let text = '';
    let go = false;
    if (countdown) {
      const left = room.match.startsAt - this.ow.now();
      const n = Math.ceil(left / 1000);
      if (left > 0 && n >= 1 && n <= 3) text = String(n);
    } else if (round && sub === 'play' && this.session.ctx?.n === 1) {
      const t = room.matchNow();
      if (t >= 0 && t < 800) {
        text = 'GO';
        go = true;
      }
    }
    const key = text;
    if (key !== this.lastCount) {
      this.lastCount = key;
      if (text) {
        setText(this.countN, text);
        this.count.classList.toggle('go', go);
        this.count.hidden = false;
        const clone = this.countN.cloneNode(true);
        this.countN.replaceWith(clone);
        this.countN = clone;
        this.sound.count(go ? 0 : Number(text));
      } else this.count.hidden = true;
    }
  }

  updateHud() {
    const s = this.session;
    const g = s.g;
    const left = s.timeLeft;
    setText(this.clockT, fmtTime(left));
    const low = left > 0 && left <= 10000;
    this.clock.classList.toggle('low', low);
    if (low) {
      const sec = Math.ceil(left / 1000);
      if (sec !== this.lastSecond) {
        this.lastSecond = sec;
        if (sec <= 5) this.sound.lowTime();
      }
    } else this.lastSecond = -1;
    const rounds = g?.rounds ?? 1;
    setText(this.clockR, rounds > 1 ? `ROUND ${g?.n ?? 1}/${rounds}` : '');
    show(this.clockR, rounds > 1);

    // me
    const playing = s.playing && s.seat >= 0;
    show(this.me, playing);
    if (playing) {
      const place = s.myPlace;
      setText(this.mePlace, place >= 0 ? placeLabel(place) : '');
      this.mePlace.classList.toggle('first', place === 0);
      setText(this.meScore, fmtScore(s.myScore));
    }
    // the leaderboard: the top five, with me in the last row if I'm lower
    const order = s.order;
    const list = order.slice(0, 5);
    if (playing && s.myPlace >= 5) list[4] = s.seat;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const seat = list[i];
      const v = seat === undefined ? null : s.views[seat];
      show(row.root, !!v);
      if (!v) continue;
      const rank = order.indexOf(seat);
      setText(row.n, String(rank + 1));
      setText(row.nm, short(v.name, 11));
      setText(row.sc, fmtScore(v.me ? s.myScore : v.score));
      row.root.classList.toggle('mine', !!v.me);
      this.avatarInto(row.av, v.id, v.bot, v.name, v.seat);
    }
  }

  updateCard(g) {
    const key = `${g.rid}|${g.phase}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    setText(this.cardTitle, g.rounds > 1 ? `ROUND ${g.n} OF ${g.rounds}` : 'TIME UP');
    this.cardRows.textContent = '';
    const names = this.session.namesNow();
    const mySeat = g.roster.findIndex((r) => r.i === this.room.me.id);
    const res = Array.isArray(g.res) ? g.res : [];
    res.slice(0, 7).forEach((r, place) => {
      const [seat, score, points] = r;
      const entry = g.roster[seat];
      if (!entry) return;
      const row = el('div', `standing${seat === mySeat ? ' mine' : ''}`);
      const av = el('span', 'av');
      this.avatarInto(av, entry.i, !!entry.b, names[entry.i] ?? entry.n ?? '', seat);
      row.append(el('span', 'n', String(place + 1)), av, el('span', 'nm', short(names[entry.i] ?? entry.n ?? '', 16)), el('span', 'sc', fmtScore(score)));
      if (g.rounds > 1) row.append(el('span', 'pt', `+${points}`));
      this.cardRows.append(row);
    });
  }

  /** The podium: top three with their faces, then "YOU: 5TH" if I'm lower. */
  updateResults({ g, names }, over) {
    const key = `${g.mid}|${over ? 'over' : 'full'}`;
    this.results.classList.toggle('card-over', over);
    if (key === this.resultsKey) return;
    this.resultsKey = key;
    const order = Array.isArray(g.fin) ? g.fin : g.s.map((_, i) => i);
    const multi = g.rounds > 1;
    setText(this.resultsH, multi ? 'FINAL' : 'RESULT');
    this.podium.textContent = '';
    const make = (seat, cls, place) => {
      const entry = g.roster[seat];
      if (!entry) return null;
      const name = names[entry.i] ?? entry.n ?? '';
      const col = el('div', `pl ${cls}`);
      col.style.setProperty('--c', hexCss(SEAT_COLORS[seat % SEAT_COLORS.length]));
      if (place === 0) col.append(this.crown());
      const big = el('div', 'big');
      this.avatarInto(big, entry.i, !!entry.b, name, seat);
      col.append(big, el('div', 'name ink', short(name, 12)), el('div', 'val ink', multi ? `${g.pts[seat] ?? 0} PTS` : fmtScore(g.s[seat] ?? 0)), el('div', 'plinth ink', String(place + 1)));
      return col;
    };
    const cols = [make(order[1], 'second', 1), make(order[0], 'first', 0), make(order[2], 'third', 2)];
    for (const c of cols) if (c) this.podium.append(c);
    const mySeat = g.roster.findIndex((r) => r.i === this.room.me.id);
    const myPlace = mySeat >= 0 ? order.indexOf(mySeat) : -1;
    if (myPlace >= 3) {
      setText(this.youEl, `YOU: ${placeLabel(myPlace)}`);
      this.youEl.hidden = false;
    } else this.youEl.hidden = true;
  }

  crown() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 34 24');
    svg.setAttribute('class', 'crown');
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', '2,22 2,5 10,13 17,1 24,13 32,5 32,22');
    poly.setAttribute('fill', '#ffc400');
    poly.setAttribute('stroke', '#0b1020');
    poly.setAttribute('stroke-width', '2.5');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.append(poly);
    return svg;
  }
}
