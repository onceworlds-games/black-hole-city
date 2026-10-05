// Seeded randomness shared by every page and the tests. Pure: no window, no document.

/** A fast 32-bit generator: the same seed gives the same sequence on every page. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Folds numbers and strings into one 32-bit seed (FNV-1a over their text). */
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const range = (rng, a, b) => a + (b - a) * rng();
export const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
export const chance = (rng, p) => rng() < p;

/** Fisher-Yates on a copy. */
export function shuffled(rng, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}
