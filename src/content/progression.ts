/**
 * Levels and attributes (plan §5). Fixed growth each level plus one attribute point to spend at a
 * shrine. XP curve round(60·L^1.45): the XP to go from level L to L + 1. Level cap 10.
 */
export type Attr = 'might' | 'arcana' | 'vitality' | 'endurance';
export const ATTRS: readonly Attr[] = ['might', 'arcana', 'vitality', 'endurance'];

export const LEVEL_CAP = 10;

/** XP needed to go from level `level` to the next. */
export const xpToNext = (level: number): number => Math.round(60 * Math.pow(level, 1.45));

/** Total XP needed to reach `level` from level 1. */
export function xpForLevel(level: number): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += xpToNext(l);
  return t;
}

export const GROWTH = {
  /** Per level above 1. */
  hpPerLevel: 12,
  staminaPerLevel: 4,
  manaPerLevel: 4,
  /** Per attribute point. */
  hpPerVitality: 15,
  staminaPerEndurance: 5,
  manaPerArcana: 5,
  /** Melee power ×(1 + 0.04·Might); spell power ×(1 + 0.04·Arcana) (plan §4.6). */
  mightPower: 0.04,
  arcanaPower: 0.04,
  /** Defense from Vitality: +1 per 2 points (both kinds). */
  vitalityDefense: 0.5,
} as const;
