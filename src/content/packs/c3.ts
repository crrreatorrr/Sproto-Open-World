/**
 * The eight powers of milestone C3 (expansion plan §1.2). Pure data: the spell definitions the
 * selector and the cast path read, and the first-pass numbers their mechanics use
 * (src/sim/combat/powers). Ticks are 60 Hz.
 */
import type { SpellDef } from '../spells';

export type C3SpellId = 'mirrorWard' | 'staticSnare' | 'seekerSwarm' | 'brambleWall' | 'vinePull' | 'healingBloom' | 'emberBreath' | 'sproutSurge';

export const C3_SPELLS: Record<C3SpellId, SpellDef> = {
  mirrorWard: { id: 'mirrorWard', name: 'Mirror Ward', slot: 1, cost: 12, release: 4, wovenRelease: 2, cooldown: 300, mv: 0, clip: 'cast', recovery: 8, poise: 0 },
  staticSnare: {
    id: 'staticSnare', name: 'Static Snare', slot: 2, cost: 15, release: 12, wovenRelease: 6, cooldown: 540, mv: 0.4, clip: 'cast', recovery: 10,
    projectile: { speed: 34, radius: 0.26, range: 28 }, interruptsRanged: true, poise: 8,
  },
  seekerSwarm: { id: 'seekerSwarm', name: 'Seeker Swarm', slot: 3, cost: 20, release: 10, wovenRelease: 5, cooldown: 1200, mv: 0, clip: 'cast', recovery: 10, poise: 0 },
  brambleWall: { id: 'brambleWall', name: 'Bramble Wall', slot: 4, cost: 30, release: 20, wovenRelease: 10, cooldown: 900, mv: 0.3, clip: 'cast_big', recovery: 14, poise: 6 },
  vinePull: { id: 'vinePull', name: 'Vine Pull', slot: 1, cost: 15, release: 10, wovenRelease: 5, cooldown: 360, mv: 0.4, clip: 'cast', recovery: 12, poise: 10 },
  healingBloom: { id: 'healingBloom', name: 'Healing Bloom', slot: 2, cost: 30, release: 14, wovenRelease: 7, cooldown: 1320, mv: 0, clip: 'cast', recovery: 10, poise: 0 },
  emberBreath: {
    id: 'emberBreath', name: 'Ember Breath', slot: 3, cost: 30, release: 10, wovenRelease: 5, cooldown: 1080, mv: 0.4, clip: 'cast', recovery: 6,
    status: { id: 'burn', stacks: 1 }, poise: 4,
  },
  sproutSurge: { id: 'sproutSurge', name: 'Sprout Surge', slot: 4, cost: 0, release: 22, wovenRelease: 11, cooldown: 0, mv: 4, clip: 'cast_big', recovery: 18, knockdown: true, poise: 60, meter: true },
};

export const POWER = {
  ward: {
    /** The whole bubble (× Protection), and its first ticks, which reflect instead of block. */
    ticks: 48,
    reflectTicks: 12,
    radius: 1.25,
  },
  snare: {
    rootTicks: 90,
    bossRootTicks: 18,
    /** A rooted target takes this much more damage. */
    damageTaken: 1.3,
  },
  swarm: {
    ticks: 360,
    /** How fast a seeking Bolt turns (rad/s). */
    homing: 9,
  },
  wall: {
    /** Lifetime (× Protection). */
    ticks: 360,
    length: 5,
    height: 2.6,
    thickness: 0.7,
    /** The collider reaches this far below the ground, so slopes leave no gap under it. */
    sink: 1,
    /** How far ahead of the caster it grows, and the closest it may grow against a cliff (m). */
    distance: 3,
    minDistance: 1.6,
    /** Enemies this close to the surface are touching it (m). */
    touch: 0.14,
    pulseTicks: 30,
    /** An attacking enemy moving at least this fast (m/s) is charging. */
    chargeSpeed: 6.5,
    stunTicks: 150,
    /** A charge into the wall takes this many thorn pulses of damage at once. */
    impactPulses: 3,
  },
  vine: {
    range: 18,
    /** Bodies at least this wide can't be pulled: the vine pulls you to them instead (m). */
    heavyRadius: 0.6,
    /** Stop this far short of touching (m). */
    stopGap: 0.9,
    /** Pull speed (m per tick). */
    speed: 0.42,
  },
  bloom: {
    ticks: 360,
    radius: 2.5,
    /** Fraction of max HP per second (× Protection). */
    healPerSecond: 0.03,
    castPause: 60,
  },
  ember: {
    ticks: 120,
    /** A tap still breathes this long. */
    minTicks: 20,
    range: 6,
    halfAngle: Math.PI / 6,
    pulseTicks: 10,
    walkScale: 0.35,
  },
  surge: {
    max: 100,
    perDamageDealt: 0.2,
    perDamageTaken: 0.5,
    /** A perfect Mirror Ward adds this much. */
    perfectWard: 10,
    /** The wave's reach (m), and how fast it spreads (m per tick). */
    radius: 14,
    speed: 0.3,
    pushback: 3,
  },
} as const;
