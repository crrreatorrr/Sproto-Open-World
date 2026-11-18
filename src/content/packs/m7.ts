/**
 * Milestone M7's combat numbers: the plunge attack and the backstep (ticks at 60 Hz, metres). The
 * rules live in sim/combat/plunge.ts and sim/combat/playerCombat.ts. Pure data.
 */
import { ROLL } from '../combat';

/** A heavy pressed while falling from a height: dive, slam the ground around the landing. */
export const PLUNGE = {
  /** Clear air needed under the feet (m). A standing jump (1.15 m) never reaches it. */
  minHeight: 1.8,
  /** Still rising faster than this (m/s), the press is a normal heavy. */
  maxRise: 1,
  /** The dive starts at least this fast (m/s). */
  diveSpeed: 16,
  /** Steering in the air at full stick (m/s). */
  drift: 2.5,
  stamina: 18,
  /** The slam's reach from the landing (m, past the target's body), and how far above and below it a target may stand. */
  radius: 2.6,
  above: 2.4,
  below: 1.2,
  /** Motion value: more for a longer fall, up to `mvMax`. */
  mv: 2.6,
  mvPerMetre: 0.12,
  mvMax: 4,
  poise: 60,
  hitstun: 45,
  pushback: 2,
  hitstop: 8,
  mana: 8,
  /** Ticks to recover after landing, and from which a dodge or an attack may cut them short. */
  recovery: 34,
  cancelFrom: 22,
} as const;

/** Dodge with no stick direction: a short hop back, cheaper and with fewer i-frames than a roll. */
export const BACKSTEP = {
  ticks: 20,
  distance: 2.4,
  /** I-frames: move ticks [start, end]. */
  iframeStart: 2,
  iframeEnd: 8,
  /** A hit during these i-frame ticks is a perfect dodge. */
  perfectEnd: 5,
  stamina: 12,
  /** An attack press from this tick cuts the recovery short. */
  attackFrom: 14,
} as const;

/** The frame data of a dodge in progress: the backstep's, or the roll's. */
export const dodgeFrames = (a: { back?: boolean }): typeof BACKSTEP | typeof ROLL => (a.back ? BACKSTEP : ROLL);
