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
  /** A blow from behind: a deep thud. */
  backstab: { strong: 0.62, weak: 0.5, ms: 150 },
  /** The critical on a broken enemy: as big as a parry, and longer. */
  breakCrit: { strong: 0.8, weak: 0.9, ms: 220 },
  /** A parry: the strongest thing you do, so the strongest kick. */
  parry: { strong: 1, weak: 1, ms: 220 },
  /** A blocked hit on your guard. */
  block: { strong: 0.3, weak: 0.15, ms: 80 },
  /** You got hit (or your guard broke). */
  hurt: { strong: 0.75, weak: 0.4, ms: 190 },
  /** A perfect dodge: a light tick, not a hit. */
  perfectDodge: { strong: 0, weak: 0.3, ms: 50 },
  /** Your spell releases: a flick in the light motor. */
  cast: { strong: 0, weak: 0.22, ms: 40 },
  /** Your Blast goes off: a thump. */
  blast: { strong: 0.6, weak: 0.4, ms: 160 },
  /** Your Frost Nova: a short, sharp burst. */
  nova: { strong: 0.35, weak: 0.5, ms: 110 },
  /** Your Chain Zap: a buzz. */
  zap: { strong: 0.1, weak: 0.6, ms: 120 },
} as const;

/** Camera punch-in (degrees of field of view). */
export const CAMERA_KICK = { parry: 6 } as const;

export const TRAUMA = {
  lightHit: 0.1,
  heavyHit: 0.22,
  crit: 0.28,
  backstab: 0.34,
  breakCrit: 0.46,
  hurt: 0.32,
  block: 0.08,
  guardBreak: 0.3,
  parry: 0.42,
  death: 0.5,
  /** Blast at point-blank (scaled down with distance from you). */
  blast: 0.34,
  nova: 0.14,
} as const;

/** How hard a landed blow reads, from a plain light hit up to the critical on a broken enemy. */
export type HitTier = 'light' | 'heavy' | 'crit' | 'backstab' | 'breakCrit';

export const hitTier = (e: { crit: boolean; heavy: boolean; strike?: 'breakCrit' | 'backstab' }): HitTier =>
  e.strike ?? (e.crit ? 'crit' : e.heavy ? 'heavy' : 'light');

/**
 * What each tier does to the player's senses. `kick`: the camera lurches along the blow (m, at a
 * hit-stop of 6). `fov`: it punches in (degrees). `flinch`: how far the victim is thrown, on top of a
 * heavy hit's. `recoil`: how much of the blow comes back up the staff into the attacker.
 */
export const HIT_FEEL: Record<HitTier, { trauma: number; rumble: { strong: number; weak: number; ms: number }; kick: number; fov: number; flinch: number; recoil: number }> = {
  light: { trauma: TRAUMA.lightHit, rumble: RUMBLE.lightHit, kick: 0.03, fov: 0, flinch: 1, recoil: 0.12 },
  heavy: { trauma: TRAUMA.heavyHit, rumble: RUMBLE.heavyHit, kick: 0.07, fov: 0.8, flinch: 1, recoil: 0.25 },
  crit: { trauma: TRAUMA.crit, rumble: RUMBLE.heavyHit, kick: 0.09, fov: 1.2, flinch: 1.25, recoil: 0.3 },
  backstab: { trauma: TRAUMA.backstab, rumble: RUMBLE.backstab, kick: 0.11, fov: 1.6, flinch: 1.5, recoil: 0.35 },
  breakCrit: { trauma: TRAUMA.breakCrit, rumble: RUMBLE.breakCrit, kick: 0.15, fov: 2.6, flinch: 1.9, recoil: 0.5 },
};

/** The camera kick of a blow: bigger the longer the move's hit-stop. */
export const kickScale = (hitstop: number): number => 0.6 + hitstop / 15;
