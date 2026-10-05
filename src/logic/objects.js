// The things in the city: each type has a footprint radius, a value (what it adds to a hole) and the model it is drawn with.
// Order matters: city generation and every page index types by position here.

import { EAT_RATIO } from './config.js';

// [id, footprint radius, value, group]
const TABLE = [
  ['cone', 0.35, 2, 'prop'],
  ['hydrant', 0.4, 2, 'prop'],
  ['trash', 0.45, 2, 'prop'],
  ['mailbox', 0.45, 3, 'prop'],
  ['lamp', 0.5, 3, 'prop'],
  ['person0', 0.4, 3, 'person'],
  ['person1', 0.4, 3, 'person'],
  ['person2', 0.4, 3, 'person'],
  ['person3', 0.4, 3, 'person'],
  ['bench', 0.85, 4, 'prop'],
  ['bike', 0.9, 4, 'prop'],
  ['bush', 0.7, 3, 'plant'],
  ['crate', 0.8, 4, 'prop'],
  ['tree', 1.35, 8, 'plant'],
  ['pine', 1.3, 8, 'plant'],
  ['car0', 1.8, 14, 'car'],
  ['car1', 1.8, 14, 'car'],
  ['car2', 1.8, 14, 'car'],
  ['car3', 1.8, 14, 'car'],
  ['car4', 1.8, 14, 'car'],
  ['kiosk', 2.0, 18, 'prop'],
  ['fountain', 2.8, 26, 'prop'],
  ['bus', 3.4, 38, 'car'],
  ['house0', 3.2, 40, 'building'],
  ['house1', 3.2, 40, 'building'],
  ['house2', 3.2, 40, 'building'],
  ['shop0', 3.8, 54, 'building'],
  ['shop1', 3.8, 54, 'building'],
  ['apt0', 4.5, 76, 'building'],
  ['apt1', 4.5, 76, 'building'],
  ['apt2', 4.5, 76, 'building'],
  ['office0', 5.4, 115, 'tower'],
  ['office1', 5.4, 115, 'tower'],
  ['office2', 5.4, 115, 'tower'],
  ['stadium', 7.2, 215, 'landmark'],
  ['landmark', 8.2, 300, 'landmark'],
];

export const TYPES = TABLE.map(([id, r, value, group], index) => ({ index, id, r, value, group }));
export const TYPE_COUNT = TYPES.length;
export const TYPE_R = new Float32Array(TYPES.map((t) => t.r));
export const TYPE_VALUE = new Float32Array(TYPES.map((t) => t.value));
export const T = Object.fromEntries(TYPES.map((t) => [t.id, t.index]));

export const MAX_R = Math.max(...TYPE_R);

/** The hole radius an object needs before it can fall in. */
export const radiusNeeded = (type) => TYPE_R[type] * EAT_RATIO;

/** Tall towers: the "skyscraper" badge. */
export const isSkyscraper = (type) => TYPES[type].group === 'tower' || TYPES[type].id === 'landmark';

export const isMoverType = (type) => TYPES[type].group === 'person' || TYPES[type].group === 'car';

/** Variant pickers keep generation tidy: 'person' with a number gives person0..3. */
export const variant = (base, n, count) => T[base + (Math.abs(n) % count)];
