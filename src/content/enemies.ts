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
  /**
   * Fires projectiles from the end of the wind-up instead of a melee hitbox: `count` shots
   * `interval` ticks apart, fanned by `spread` radians; `homing` turns them toward the target
   * (rad/s); `reflectable` is false only for spells that can't be parried.
   */
  projectile?: { speed: number; radius: number; range: number; count?: number; interval?: number; spread?: number; homing?: number };
  /**
   * An area attack: a circle of `radius` m placed on the target's feet when the wind-up starts
   * (the decal shows it), which hits whoever stands in it during the active ticks.
   */
  area?: { radius: number };
  /** A gap closer: the enemy jumps `distance` m toward its target during the active ticks. */
  leap?: { distance: number };
  /** Don't use this move closer than this (m). */
  minRange?: number;
  /** Telegraph decal shape on the ground (area attacks). */
  decal?: 'circle' | 'jagged';
  /** Hit-stop when it connects (ticks). */
  hitstop: number;
  /** Clip the view plays (falls back to procedural motion). */
  clip?: string;
  /** Attack tokens it takes from its target (plan §4.8): melee or ranged pool, and how many. */
  token?: { pool: 'melee' | 'ranged'; cost: number };
}

export interface EnemyDef {
  id: string;
  name: string;
  model: 'brute' | 'dummy' | 'grunt' | 'slinger' | 'wisp';
  hp: number;
  poise: number;
  /** Elites take no hitstun until their poise breaks. */
  elite: boolean;
  /** Training dummies refill their HP instead of dying (unless `breakable`). */
  dummy?: 'passive' | 'swing' | 'shooter';
  /** A dummy that breaks (dies) and comes back after `respawnTicks` (quest training). */
  breakable?: boolean;
  /** XP for the kill (plan §5). */
  xp: number;
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
  /** Ranged enemies keep to this band of distance (m), backstepping when you close in. */
  keepRange?: [number, number];
  /** Blinks this far away after taking this many melee hits in a row (Hex Wisp). */
  blink?: { hits: number; distance: number };
  /** Floats this high above the ground (m; presentation and hitbox height). */
  hover?: number;
  /** Uses attack tokens (bosses and dummies don't). */
  usesTokens?: boolean;
}

const NORMAL_PROFILE = { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'normal', chill: 'normal', shock: 'normal' } } as const;

const dummyBase = {
  model: 'dummy',
  xp: 0,
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
  dummy_straw: { ...dummyBase, id: 'dummy_straw', name: 'Straw Dummy', dummy: 'passive', breakable: true, hp: 40, xp: 5, respawnTicks: 600, moves: [] },
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
    xp: 60,
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
      { id: 'punch', windup: 24, active: 6, recovery: 26, damage: 22, kind: 'physical', poise: 20, hitbox: { forward: 1.6, up: 1.3, radius: 0.85 }, range: 2.7, weight: 3, cooldown: 0, trackUntil: 0.65, hitstop: 4, clip: 'punch', token: { pool: 'melee', cost: 1 } },
      { id: 'kick', windup: 30, active: 6, recovery: 30, damage: 26, kind: 'physical', poise: 25, hitbox: { forward: 1.5, up: 0.7, radius: 0.95 }, range: 2.5, weight: 2, cooldown: 60, knockback: 3, hyperArmor: true, trackUntil: 0.6, hitstop: 6, clip: 'kick', token: { pool: 'melee', cost: 2 } },
      { id: 'slam', windup: 42, active: 6, recovery: 44, damage: 45, kind: 'physical', poise: 40, hitbox: { forward: 2.0, up: 0.3, radius: 1.9 }, range: 3.2, weight: 1.5, cooldown: 150, unblockable: true, knockback: 2, hyperArmor: true, trackUntil: 0.5, decal: 'jagged', hitstop: 8, clip: 'punch', token: { pool: 'melee', cost: 2 } },
    ],
    usesTokens: true,
  },
  // M1b: the three standard archetypes (plan §4.9). Each has a clear profile so a mixed camp
  // forces switching between the staff and spells.
  grunt: {
    id: 'grunt',
    name: 'Sprout Grunt',
    model: 'grunt',
    xp: 12,
    hp: 55,
    poise: 20,
    elite: false,
    body: { radius: 0.35, height: 1.3 },
    defense: { physical: 0, arcane: 0 },
    profile: { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'weak', chill: 'normal', shock: 'normal' } },
    level: 1,
    moveSpeed: 4.4,
    turnRate: Math.PI * 1.6,
    staggerTicks: 50,
    aggroRange: 18,
    leashRange: 35,
    respawnTicks: 300,
    usesTokens: true,
    moves: [
      { id: 'swipe', windup: 20, active: 5, recovery: 22, damage: 10, kind: 'physical', poise: 10, hitbox: { forward: 0.9, up: 0.7, radius: 0.65 }, range: 1.5, weight: 3, cooldown: 0, trackUntil: 0.6, hitstop: 3, clip: 'cast', token: { pool: 'melee', cost: 1 } },
      { id: 'leap', windup: 30, active: 14, recovery: 26, damage: 14, kind: 'physical', poise: 14, hitbox: { forward: 0.6, up: 0.6, radius: 0.8 }, range: 6, minRange: 3, weight: 1, cooldown: 240, trackUntil: 0.8, hitstop: 4, clip: 'cast_big', decal: 'circle', leap: { distance: 5.5 }, token: { pool: 'melee', cost: 1 } },
    ],
  },
  slinger: {
    id: 'slinger',
    name: 'Coin Slinger',
    model: 'slinger',
    xp: 18,
    hp: 70,
    poise: 25,
    elite: false,
    body: { radius: 0.35, height: 1.85 },
    defense: { physical: 0, arcane: 0 },
    profile: { damage: { physical: 'weak', arcane: 'resist' }, status: { burn: 'normal', chill: 'normal', shock: 'weak' } },
    level: 1,
    moveSpeed: 3.6,
    turnRate: Math.PI * 1.4,
    staggerTicks: 50,
    aggroRange: 20,
    leashRange: 35,
    respawnTicks: 300,
    usesTokens: true,
    keepRange: [10, 16],
    moves: [
      {
        id: 'coinBurst', windup: 24, active: 11, recovery: 30, damage: 6, kind: 'physical', poise: 8, hitbox: { forward: 0.6, up: 1.4, radius: 0.2 }, range: 18, weight: 3, cooldown: 60,
        trackUntil: 1, hitstop: 3, clip: 'cast', projectile: { speed: 15, radius: 0.25, range: 24, count: 3, interval: 5, spread: 0.1 }, token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'coinBomb', windup: 36, active: 6, recovery: 34, damage: 18, kind: 'physical', poise: 16, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 16, minRange: 4, weight: 1.5, cooldown: 200,
        trackUntil: 0, hitstop: 4, clip: 'cast_big', area: { radius: 2.6 }, decal: 'circle', token: { pool: 'ranged', cost: 1 },
      },
    ],
  },
  wisp: {
    id: 'wisp',
    name: 'Hex Wisp',
    model: 'wisp',
    xp: 18,
    hp: 80,
    poise: 30,
    elite: false,
    body: { radius: 0.4, height: 1.9 },
    defense: { physical: 0, arcane: 0 },
    profile: { damage: { physical: 'resist', arcane: 'weak' }, status: { burn: 'normal', chill: 'resist', shock: 'weak' } },
    level: 1,
    moveSpeed: 3.2,
    turnRate: Math.PI * 1.4,
    staggerTicks: 50,
    aggroRange: 20,
    leashRange: 35,
    respawnTicks: 300,
    usesTokens: true,
    keepRange: [8, 12],
    blink: { hits: 2, distance: 6 },
    hover: 0.6,
    moves: [
      {
        id: 'homingHex', windup: 26, active: 1, recovery: 34, damage: 12, kind: 'arcane', poise: 10, hitbox: { forward: 0.6, up: 1.5, radius: 0.2 }, range: 18, weight: 3, cooldown: 70,
        trackUntil: 1, hitstop: 3, clip: 'cast', projectile: { speed: 9, radius: 0.3, range: 26, homing: 1.6 }, token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'curseCircle', windup: 40, active: 6, recovery: 36, damage: 20, kind: 'arcane', poise: 16, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 14, minRange: 3, weight: 1.5, cooldown: 220,
        trackUntil: 0, hitstop: 4, clip: 'cast_big', area: { radius: 3 }, decal: 'circle', token: { pool: 'ranged', cost: 1 },
      },
    ],
  },
};

export type EnemyId = keyof typeof ENEMIES;
