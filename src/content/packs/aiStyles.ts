/**
 * How each enemy type fights between its attacks: its footwork, its timing, what it reacts to and how
 * it closes a gap. Pure data, keyed by enemy id; the brain is `sim/ai/brain.ts`. Distances are metres,
 * times are ticks (60 a second) and speeds are fractions of the enemy's own move speed.
 */

export interface AiStyle {
  /** Melee: the gap it hovers in between attacks, measured from its shortest reach. */
  band: readonly [number, number];
  /** Sideways speed while circling. */
  strafe: number;
  /** Length of one footwork beat, and how often each kind of beat comes up. */
  beat: readonly [number, number];
  feet: { strafe: number; in: number; out: number; hold: number };
  /** The rest after an attack before the next may start. */
  pause: readonly [number, number];
  /** How firmly it takes its place in the ring around the player (0: ignores the group). */
  flank: number;
  /** Delayed swings: how often a melee wind-up is held at its peak, and for how long. */
  delay: { chance: number; ticks: readonly [number, number] };
  /** How often a melee wind-up breaks off as a feint. */
  feint: number;
  /** Chance it punishes a tonic or a whiffed swing, from up to `range` away. */
  punish: { heal: number; whiff: number; range: number };
  /** After `hits` hits close together it gets out: `back` is the chance of a backstep over a sidestep. */
  evade: { hits: number; back: number; speed: number; ticks: number; cooldown: number } | null;
  /** How much of its pause it skips against a tired or retreating player (0..1). */
  press: number;
  /** Melee gap closer on a retreating player, usable from `from` to `to` beyond its shortest reach. */
  lunge: { from: number; to: number; speed: number; ticks: number; cooldown: number } | null;
  /** Ranged: starts walking backward this far inside the near edge of its `keepRange`. */
  kite: number;
  /** Ranged: how far it sways in and out while drifting (m/s). */
  sway: number;
}

const NO_DELAY = { chance: 0, ticks: [0, 0] } as const;

const MELEE = {
  kite: 0,
  sway: 0,
} as const;

const RANGED = {
  band: [0, 0],
  delay: NO_DELAY,
  feint: 0,
  press: 0,
  lunge: null,
} as const;

/** Grunts come in fast, circle eagerly and jump on any mistake. */
const GRUNT: AiStyle = {
  ...MELEE,
  band: [0.5, 1.9],
  strafe: 0.42,
  beat: [24, 55],
  feet: { strafe: 5, in: 2, out: 1, hold: 1 },
  pause: [14, 40],
  flank: 1,
  delay: { chance: 0.15, ticks: [6, 12] },
  feint: 0,
  punish: { heal: 0.9, whiff: 0.7, range: 6 },
  evade: { hits: 3, back: 0.5, speed: 1.5, ticks: 16, cooldown: 200 },
  press: 1,
  lunge: { from: 1.5, to: 6, speed: 1.7, ticks: 22, cooldown: 200 },
};

/** Veterans have seen a few fights: shorter rests, later swings, and the odd feint. */
const VETERAN: AiStyle = {
  ...GRUNT,
  pause: [10, 32],
  delay: { chance: 0.3, ticks: [8, 18] },
  feint: 0.12,
};

/** Brutes never back up: they walk you down and charge when you run. */
const BRUTE: AiStyle = {
  ...MELEE,
  band: [-1.5, 0.6],
  strafe: 0.2,
  beat: [30, 70],
  feet: { strafe: 1, in: 5, out: 0, hold: 2 },
  pause: [6, 22],
  flank: 0.5,
  delay: { chance: 0.25, ticks: [8, 16] },
  feint: 0.08,
  punish: { heal: 0.8, whiff: 0.5, range: 5 },
  evade: null,
  press: 0.5,
  lunge: { from: 1, to: 8, speed: 1.6, ticks: 30, cooldown: 260 },
};

/** Slingers keep moving, keep their distance and hop away when caught. */
const SLINGER: AiStyle = {
  ...RANGED,
  strafe: 0.45,
  beat: [30, 70],
  feet: { strafe: 5, in: 0, out: 1, hold: 1 },
  pause: [10, 30],
  flank: 0.8,
  punish: { heal: 1, whiff: 0, range: 18 },
  evade: { hits: 2, back: 0.7, speed: 1.6, ticks: 16, cooldown: 180 },
  kite: 1.5,
  sway: 0.4,
};

/** The fallback for an enemy with no style of its own. */
export const DEFAULT_AI_STYLE: AiStyle = GRUNT;

export const AI_STYLES: Record<string, AiStyle> = {
  grunt: GRUNT,
  grunt_orchard: GRUNT,
  grunt_vet: VETERAN,
  bramble_thrall: VETERAN,
  brute: BRUTE,
  // A slow, patient exam: it holds its ground, reads you and hides its timing.
  gatekeeper: {
    ...BRUTE,
    band: [0, 1.2],
    strafe: 0.3,
    feet: { strafe: 3, in: 3, out: 1, hold: 2 },
    pause: [8, 26],
    flank: 0,
    delay: { chance: 0.35, ticks: [10, 22] },
    feint: 0.15,
    punish: { heal: 0.9, whiff: 0.7, range: 6 },
    press: 1,
    lunge: { from: 1, to: 7, speed: 1.7, ticks: 26, cooldown: 240 },
  },
  // Too big to dance: it looms forward and takes its time.
  hollow_giant: {
    ...BRUTE,
    band: [-2, 0.8],
    strafe: 0.18,
    feet: { strafe: 1, in: 4, out: 0, hold: 3 },
    pause: [18, 44],
    delay: { chance: 0.25, ticks: [12, 24] },
    feint: 0.1,
    punish: { heal: 0.5, whiff: 0.3, range: 6 },
    lunge: null,
  },
  bramble_colossus: {
    ...BRUTE,
    band: [-1.5, 0.8],
    strafe: 0.22,
    pause: [10, 30],
    delay: { chance: 0.3, ticks: [10, 20] },
    feint: 0.12,
    lunge: { from: 1, to: 8, speed: 1.5, ticks: 30, cooldown: 280 },
  },
  slinger: SLINGER,
  // Heavier on its feet than a Slinger, and it takes more to make it flinch.
  big_coin: {
    ...SLINGER,
    strafe: 0.3,
    pause: [16, 36],
    evade: { hits: 3, back: 0.7, speed: 1.4, ticks: 18, cooldown: 240 },
    kite: 2,
  },
  // Wisps drift in long, slow arcs and rely on their blink instead of a step.
  wisp: {
    ...RANGED,
    strafe: 0.3,
    beat: [50, 110],
    feet: { strafe: 6, in: 0, out: 0, hold: 1 },
    pause: [20, 45],
    flank: 0.6,
    punish: { heal: 0.8, whiff: 0, range: 18 },
    evade: null,
    kite: 3,
    sway: 1,
  },
  // Methodical: it picks a firing line and sidesteps out of trouble.
  rivet_gunner: {
    ...RANGED,
    strafe: 0.35,
    beat: [40, 90],
    feet: { strafe: 3, in: 0, out: 1, hold: 2 },
    pause: [18, 40],
    flank: 0.8,
    punish: { heal: 0.9, whiff: 0, range: 22 },
    evade: { hits: 3, back: 0.3, speed: 1.5, ticks: 18, cooldown: 240 },
    kite: 2.5,
    sway: 0.3,
  },
  // Slow and planted: it turns the field with its beam rather than its feet.
  lens_warden: {
    ...RANGED,
    strafe: 0.15,
    beat: [50, 110],
    feet: { strafe: 2, in: 0, out: 0, hold: 3 },
    pause: [24, 50],
    flank: 0.4,
    punish: { heal: 0.4, whiff: 0, range: 18 },
    evade: null,
    kite: 3,
    sway: 0,
  },
};

/** The style of an enemy type. */
export const aiStyle = (id: string): AiStyle => AI_STYLES[id] ?? DEFAULT_AI_STYLE;
