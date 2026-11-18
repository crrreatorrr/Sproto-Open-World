/**
 * Combat feedback tuning (plan §1, Feedback: hit sounds, whooshes and pad rumble ship in M1).
 * Rumble is dual-motor { strong, weak, ms } (input/Gamepad.ts, scaled by GAMEPAD.rumble.intensity);
 * trauma feeds the camera shake (shake = trauma², off with Settings → shake).
 */
export const RUMBLE = {
  /** Your light hit lands: a short buzz in the light motor. */
  lightHit: { strong: 0.12, weak: 0.38, ms: 60 },
  /** Your heavy, finisher or crit lands. */
  heavyHit: { strong: 0.5, weak: 0.55, ms: 120 },
  /** A parry: the strongest thing you do, so the strongest kick. */
  parry: { strong: 0.7, weak: 0.9, ms: 160 },
  /** A blocked hit on your guard. */
  block: { strong: 0.3, weak: 0.15, ms: 80 },
  /** You got hit (or your guard broke). */
  hurt: { strong: 0.75, weak: 0.4, ms: 190 },
  /** A perfect dodge: a light tick, not a hit. */
  perfectDodge: { strong: 0, weak: 0.3, ms: 50 },
} as const;

export const TRAUMA = {
  lightHit: 0.1,
  heavyHit: 0.22,
  crit: 0.28,
  hurt: 0.32,
  block: 0.08,
  guardBreak: 0.3,
  parry: 0.3,
  death: 0.5,
} as const;
