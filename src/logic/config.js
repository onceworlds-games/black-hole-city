// Numbers shared by the rules, the host and the screens. Change them here, not in copies.

export const GAME = 'black-hole-city';

/** The playfield is a square from -HALF to +HALF in x and z (world units, 1 unit is about a metre). */
export const HALF = 70;
export const LOBBY_HALF = 23;

/** Hole growth: radius = R0 * sqrt(1 + mass / K). Area follows what was eaten. */
export const R0 = 1.0;
export const K = 34;
export const SPEED_FAST = 8;
export const SPEED_SLOW = 6;
export const SPEED_R_FULL = 10; // the radius at which the hole is at its slowest

/** An object falls when R >= r * EAT_RATIO and its centre is within R - r * EDGE_PULL of the hole's centre. */
export const EAT_RATIO = 1.1;
export const EDGE_PULL = 0.5;
export const TILT_REACH = 0.5;

/** A hole swallows another when R_big >= R_small * GULP_RATIO and its centre is within R_big - R_small * GULP_DEPTH. */
export const GULP_RATIO = 1.25;
export const GULP_DEPTH = 0.6;
export const GULP_SCORE = 0.3; // the big one gets this share of the small one's score and mass
export const KEEP_SCORE = 0.5; // the small one keeps this share of its score
export const RESPAWN_MS = 3000;
export const PROTECT_MS = 2000;

/** Host checks of what another page claims (tolerances for lag, never for cheating). */
export const CLAIM_SIZE_SLACK = 1.15;
export const CLAIM_DIST_SLACK = 4;
export const CLAIM_BURST = 160;
export const CLAIM_PER_SECOND = 90;
export const CLAIM_MAX_IDS = 48;
export const GULP_SIZE_SLACK = 0.96;
export const GULP_DIST_SLACK = 3;

/** The match. */
export const TABLE = 6; // bots fill the table up to this many holes
export const MAX_PLAYERS = 10;
export const TIME_OPTIONS = [90, 120, 180];
export const ROUND_OPTIONS = [1, 3];
export const DEFAULT_TIME = 120;
export const DEFAULT_ROUNDS = 1;
export const SCORE_MS = 4000;
export const FINAL_MS = 9000;
export const RESULTS_CARD_MS = 7000;
/** Match points by place in a round (1st, 2nd, ...): the points decide a 3 round match, then total mass swallowed. */
export const PLACE_POINTS = [10, 7, 5, 4, 3, 2, 1, 1, 0, 0];

/** Network cadences, in milliseconds. */
export const CLAIM_EVERY = 100;
export const STATE_EVERY = 200;
export const BOT_EVERY = 83;
export const SIM_STEP_MS = 33;
export const HOST_TICK_MS = 100;

export const BOT_NAMES = ['Nova', 'Echo', 'Blaze', 'Pixel', 'Rook', 'Vex', 'Kai', 'Juno', 'Orbit', 'Zed', 'Mika', 'Rio', 'Ace', 'Sol'];

/** One rim colour per seat, strong and distinct on grey streets and green parks. */
export const SEAT_COLORS = [
  0x19d3ff, // cyan
  0xff3b7a, // magenta
  0xffc400, // yellow
  0x8cff2e, // lime
  0xa66bff, // violet
  0xff7a1a, // orange
  0x2effb4, // mint
  0xffffff, // white
  0xff4040, // red
  0x4d7bff, // blue
];
/** A mark beside each colour for players who can't tell them apart: shapes drawn on name tags. */
export const SEAT_MARKS = ['circle', 'diamond', 'triangle', 'square', 'plus', 'bar', 'ring', 'star', 'cross', 'drop'];

export const LOBBY_SEED = 24601;
export const DATA_VERSION = 1;
