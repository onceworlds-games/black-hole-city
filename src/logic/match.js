// Match bookkeeping shared by the host and the tests: the roster, round ids and seeds, who placed where.
// Pure.

import { mulberry32, hashSeed, shuffled } from './rng.js';
import { TABLE, MAX_PLAYERS, BOT_NAMES, PLACE_POINTS } from './config.js';

export const roundId = (matchId, n) => `${matchId}.${n}`;

/** The seed a round's city is built from: the match's seed and the round number, the same on every page. */
export const citySeed = (matchSeed, n) => hashSeed(matchSeed ?? 1, 'city', n);

/** A short number for presence: tells a page which round another page's position belongs to. */
export const roundKey = (rid) => (rid ? (hashSeed(rid) % 65535) + 1 : 0);

/** How many seats a match has: bots fill the table up to TABLE, a bigger crowd of people keeps its size. */
export const seatCount = (humans) => Math.min(MAX_PLAYERS, Math.max(TABLE, humans));

/** Humans first, in the order the room gave them, then bots with short names. */
export function buildRoster(humanIds, seed) {
  const seats = seatCount(humanIds.length);
  const rng = mulberry32(hashSeed(seed, 'roster'));
  const names = shuffled(rng, BOT_NAMES);
  const roster = humanIds.slice(0, MAX_PLAYERS).map((id) => ({ id, bot: false }));
  let k = 0;
  while (roster.length < seats) {
    k++;
    roster.push({ id: `bot${k}`, bot: true, name: names[(k - 1) % names.length] });
  }
  return roster;
}

/** Round result: seats ordered by score (ties by mass, then seat) with the match points each earns. */
export function roundResult(scores, masses) {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || (masses?.[b] ?? 0) - (masses?.[a] ?? 0) || a - b);
  return order.map((idx, place) => ({ idx, place, score: scores[idx], points: PLACE_POINTS[place] ?? 0 }));
}

/** Final order: match points, then total swallowed, then seat. */
export function finalOrder(points, totals) {
  return points.map((_, i) => i).sort((a, b) => points[b] - points[a] || totals[b] - totals[a] || a - b);
}

export const placeLabel = (place) => {
  const n = place + 1;
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
