/**
 * Enemy definitions (plan §4.8–4.9). M1a: three training dummies and the Thornwood Brute. Pure data.
 * Enemy hitboxes are defined by hand: a sphere at `forward` / `up` metres from the feet.
 */
import type { DamageKind } from './combat';

export type Affinity = 'weak' | 'normal' | 'resist';
export const AFFINITY_MULT: Record<Affinity, number> = { weak: 1.5, normal: 1, resist: 0.5 };

export interface EnemyMoveDef {
  id: string;
  /** Wind-up, active and recovery (ticks). */
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  kind: DamageKind;
  poise: number;
  /** Hitbox: a sphere at (forward, up) m from the feet, in the enemy's facing frame. */
  hitbox: { forward: number; up: number; radius: number };
  /** Range (m, centre to centre) the AI uses this move from. */
  range: number;
  /** Relative pick weight. */
  weight: number;
  cooldown: number;
  unblockable?: boolean;
  /** Knocks the player back this far (m). */
  knockback?: number;
  /** Hyper armor from wind-up start: hits don't interrupt it (poise still breaks). */
  hyperArmor?: boolean;
  /** Fraction of the wind-up during which the enemy still turns to track the player. */
  trackUntil: number;
  /** Fires a projectile at the end of the wind-up instead of a melee hitbox. */
  projectile?: { speed: number; radius: number; range: number };
  /** Telegraph decal shape on the ground (area attacks). */
  decal?: 'circle' | 'jagged';
  /** Hit-stop when it connects (ticks). */
  hitstop: number;
  /** Clip the view plays (falls back to procedural motion). */
  clip?: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  model: 'brute' | 'dummy';
  hp: number;
  poise: number;
  /** Elites take no hitstun until their poise breaks. */
  elite: boolean;
  /** Training dummies refill their HP instead of dying. */
  dummy?: 'passive' | 'swing' | 'shooter';
  body: { radius: number; height: number };
  defense: { physical: number; arcane: number };
  profile: { damage: Record<DamageKind, Affinity>; status: { burn: Affinity; chill: Affinity; shock: Affinity } };
  level: number;
  moveSpeed: number;
  turnRate: number;
  /** Ticks staggered when the poise breaks. */
  staggerTicks: number;
  /** Sight range and leash radius from home (m). */
  aggroRange: number;
  leashRange: number;
  /** Ticks dead before it respawns at home (sandbox). */
  respawnTicks: number;
  moves: EnemyMoveDef[];
}

const NORMAL_PROFILE = { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'normal', chill: 'normal', shock: 'normal' } } as const;

const dummyBase = {
  model: 'dummy',
  hp: 400,
  poise: 30,
  elite: false,
  body: { radius: 0.4, height: 1.8 },
  defense: { physical: 0, arcane: 0 },
  profile: NORMAL_PROFILE,
  level: 1,
  moveSpeed: 0,
  turnRate: Math.PI / 2,
  staggerTicks: 50,
  aggroRange: 14,
  leashRange: 999,
  respawnTicks: 60,
} as const;

export const ENEMIES: Record<string, EnemyDef> = {
  dummy_passive: { ...dummyBase, id: 'dummy_passive', name: 'Training Dummy', dummy: 'passive', moves: [] },
  dummy_swing: {
    ...dummyBase,
    id: 'dummy_swing',
    name: 'Swinging Dummy',
    dummy: 'swing',
    moves: [
      { id: 'swing', windup: 24, active: 6, recovery: 30, damage: 8, kind: 'physical', poise: 10, hitbox: { forward: 1.0, up: 1.1, radius: 0.9 }, range: 2.6, weight: 1, cooldown: 90, trackUntil: 0.5, hitstop: 3 },
    ],
  },
  dummy_shooter: {
    ...dummyBase,
    id: 'dummy_shooter',
    name: 'Coin Dummy',
    dummy: 'shooter',
    moves: [
      { id: 'coin', windup: 24, active: 1, recovery: 40, damage: 6, kind: 'physical', poise: 8, hitbox: { forward: 0.6, up: 1.3, radius: 0.2 }, range: 18, weight: 1, cooldown: 100, trackUntil: 1, hitstop: 3, projectile: { speed: 14, radius: 0.25, range: 22 } },
    ],
  },
  brute: {
    id: 'brute',
    name: 'Thornwood Brute',
    model: 'brute',
    hp: 220,
    poise: 70,
    elite: true,
    body: { radius: 0.75, height: 2.4 },
    defense: { physical: 0, arcane: 0 },
    profile: { damage: { physical: 'normal', arcane: 'resist' }, status: { burn: 'resist', chill: 'weak', shock: 'normal' } },
    level: 2,
    moveSpeed: 3.4,
    turnRate: Math.PI * 1.1,
    staggerTicks: 70,
    aggroRange: 18,
    leashRange: 35,
    respawnTicks: 240,
    moves: [
      { id: 'punch', windup: 24, active: 6, recovery: 26, damage: 22, kind: 'physical', poise: 20, hitbox: { forward: 1.6, up: 1.3, radius: 0.85 }, range: 2.7, weight: 3, cooldown: 0, trackUntil: 0.65, hitstop: 4, clip: 'punch' },
      { id: 'kick', windup: 30, active: 6, recovery: 30, damage: 26, kind: 'physical', poise: 25, hitbox: { forward: 1.5, up: 0.7, radius: 0.95 }, range: 2.5, weight: 2, cooldown: 60, knockback: 3, hyperArmor: true, trackUntil: 0.6, hitstop: 6, clip: 'kick' },
      { id: 'slam', windup: 42, active: 6, recovery: 44, damage: 45, kind: 'physical', poise: 40, hitbox: { forward: 2.0, up: 0.3, radius: 1.9 }, range: 3.2, weight: 1.5, cooldown: 150, unblockable: true, knockback: 2, hyperArmor: true, trackUntil: 0.5, decal: 'jagged', hitstop: 8, clip: 'punch' },
    ],
  },
};

export type EnemyId = keyof typeof ENEMIES;
