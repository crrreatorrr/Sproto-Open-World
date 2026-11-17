/**
 * The three statuses (plan §4.7). A target's status affinity scales duration and potency: weak
 * ×1.5, resist ×0.5, and Frost Nova adds 3 Chill stacks to a chill-weak target instead of 2.
 * Nothing is immune in area 1. Ticks at 60 Hz.
 */
export type StatusId = 'burn' | 'chill' | 'shock';

export const STATUS = {
  burn: {
    /** Fraction of max HP per second. */
    dps: 0.03,
    ticks: 240,
  },
  chill: {
    /** Move and attack speed lost per stack. */
    slowPerStack: 0.3,
    maxStacks: 3,
    ticks: 300,
    /** At max stacks the target freezes: no action, +25% damage taken. */
    frozenTicks: 90,
    frozenDamage: 1.25,
    /** A melee hit on a chilled target consumes the chill for ×1.3. */
    meleeBonus: 1.3,
  },
  shock: {
    ticks: 180,
    /** Interrupts a wind-up that is less than this far done. */
    interruptBefore: 0.5,
    /** Poise regen is slowed by this much while shocked. */
    poiseRegenPenalty: 0.5,
  },
} as const;
