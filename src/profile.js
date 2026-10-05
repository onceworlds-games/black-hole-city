// What the game keeps for a player: a few stats in the platform's save, the four badges, the wins board.

const DEFAULTS = { matches: 0, wins: 0, best: 1, eaten: 0, gulps: 0 };

export class Profile {
  constructor(ow) {
    this.ow = ow;
    this.stats = { ...DEFAULTS };
    this.awarded = new Set();
  }

  async load() {
    try {
      const saved = await this.ow.save.get('stats');
      if (saved && typeof saved === 'object') {
        for (const k of Object.keys(DEFAULTS)) if (Number.isFinite(saved[k])) this.stats[k] = saved[k];
      }
    } catch {}
  }

  /** A badge, once per visit (the platform says whether it's new). */
  award(id) {
    if (this.awarded.has(id)) return;
    this.awarded.add(id);
    try {
      Promise.resolve(this.ow.badges.award(id)).catch(() => {});
    } catch {}
  }

  /** The match is over: bank it (one save), and post the wins. */
  finish({ won, eaten, gulps, biggest }) {
    const s = this.stats;
    s.matches += 1;
    if (won) s.wins += 1;
    s.eaten += eaten;
    s.gulps += gulps;
    s.best = Math.max(s.best, Math.round(biggest * 10) / 10);
    try {
      Promise.resolve(this.ow.save.set('stats', s)).catch(() => {});
    } catch {}
    if (won) {
      this.award('first-win');
      try {
        Promise.resolve(this.ow.leaderboards.submit('wins', s.wins)).catch(() => {});
      } catch {}
    }
  }
}
