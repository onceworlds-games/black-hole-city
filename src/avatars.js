// Player faces: the platform's head avatar for people (loaded once, cached), a coloured initial while it loads or for bots.

export class Avatars {
  constructor(ow) {
    this.ow = ow;
    this.map = new Map();
  }

  /** { url, img, ok } for a person; never asks the platform about a bot. */
  get(id, bot = false) {
    let a = this.map.get(id);
    if (a) return a;
    a = { url: null, img: null, ok: false, waiting: [] };
    this.map.set(id, a);
    if (!bot) {
      let p;
      try {
        p = this.ow.player.avatarUrl(id, 'head');
      } catch {
        p = null;
      }
      Promise.resolve(p)
        .then((url) => {
          if (!url || typeof url !== 'string') return;
          a.url = url;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            a.ok = true;
          };
          img.onerror = () => {
            a.img = null;
            a.url = null;
          };
          img.src = url;
          a.img = img;
          for (const fn of a.waiting) fn(url);
          a.waiting.length = 0;
        })
        .catch(() => {});
    }
    return a;
  }

  /** Calls fn with the avatar's URL as soon as there is one. */
  whenUrl(id, bot, fn) {
    const a = this.get(id, bot);
    if (a.url) fn(a.url);
    else if (!bot) a.waiting.push(fn);
  }

  /** Draws the face in a circle; false when there isn't one yet. */
  draw(g, id, bot, x, y, r) {
    const a = this.get(id, bot);
    if (!a.ok || !a.img) return false;
    try {
      g.save();
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.clip();
      g.drawImage(a.img, x - r, y - r, r * 2, r * 2);
      g.restore();
      return true;
    } catch {
      g.restore();
      a.ok = false;
      return false;
    }
  }
}

export const hexCss = (hex, alpha = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${alpha})`;
export const initial = (name) => (name ? Array.from(name.trim())[0]?.toUpperCase() ?? '?' : '?');
