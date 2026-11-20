/**
 * Sproto Shooter enemy & boss definitions, multi-zone hitboxes, and Sprouts/ammo/gun drop tables
 * for SOW's unified Lv 1–30 combat loop (unification plan §4.4).
 *
 * Pure content module: no three.js, DOM, Math.random, timers, storage, or Rapier.
 * Models reference keys already registered in `src/assets/manifest.ts` (verified by tests).
 */
import type { EnemyDef, EnemyMoveDef, WeakSpotDef } from './enemies';
import type { AmmoType, GunItemId } from './guns';
import type { DropTable } from './loot';

export type ShooterEnemyId =
  | 'midget_swarmer'
  | 'flying_midget'
  | 'bitcoin_obama'
  | 'big_bitcoin_obama'
  | 'laser_bot'
  | 'shooter_bot'
  | 'mega_tinubu'
  | 'hex_sahil';

export const SHOOTER_ENEMY_IDS: readonly ShooterEnemyId[] = [
  'midget_swarmer',
  'flying_midget',
  'bitcoin_obama',
  'big_bitcoin_obama',
  'laser_bot',
  'shooter_bot',
  'mega_tinubu',
  'hex_sahil',
];

/** Model keys present in `MODELS` (`src/assets/manifest.ts`) used by Shooter enemies and bosses. */
export type ShooterEnemyModel =
  | EnemyDef['model']
  | 'midget_stage3'
  | 'obama_stage3'
  | 'sahil_stage2'
  | 'sahil_stage3'
  | 'tinubu_stage1'
  | 'tinubu_stage2'
  | 'tinubu_stage3';

export interface FlyingBehaviorDef {
  /** Preferred altitude above ground in metres. */
  cruiseHeight: number;
  /** Vertical bob amplitude in metres. */
  bobAmplitude: number;
  /** Bob oscillation speed in rad/s. */
  bobSpeed: number;
}

/**
 * SOW-compatible EnemyDef for Sproto Shooter's roster.
 * Mirrors `EnemyDef` from `src/content/enemies.ts` with widened Shooter model keys and optional
 * stage/flying metadata.
 */
export interface ShooterEnemyDef extends Omit<EnemyDef, 'model'> {
  id: ShooterEnemyId;
  model: ShooterEnemyModel;
  /** Optional stage-progression models (all valid keys in `MODELS`). */
  stageModels?: readonly ShooterEnemyModel[];
  /** Present on aerial Shooter enemies (e.g. `flying_midget`). */
  flying?: FlyingBehaviorDef;
}

export type HitZoneKind = 'weak' | 'shield' | 'body';

/**
 * Analytic multi-zone sphere hitbox in the enemy's facing frame (plan §3.4).
 * Priority order: `weak` (3) > `shield` (2) > `body` (1) with a 0.05 m tie-breaker.
 */
export interface HitZoneDef {
  id: string;
  kind: HitZoneKind;
  /** Metres along the enemy's facing vector (+forward, -back). */
  forward: number;
  /** Metres above the enemy's feet. */
  up: number;
  /** Metres to the enemy's right (default 0). */
  right?: number;
  radius: number;
  /** Damage multiplier applied when hitscan/projectile strikes this zone. */
  mult: number;
  /** Optional state gate (e.g. exposed only while `'stunned'`). */
  onlyWhen?: 'stunned';
  /** Tie-breaker priority: higher wins within 0.05 m (`weak`: 3, `shield`: 2, `body`: 1). */
  priority: number;
}

export interface AmmoDropDef {
  ammoType: AmmoType;
  amount: readonly [number, number];
  chance: number;
}

export interface GunDropDef {
  item: GunItemId;
  chance: number;
  when?: 'spell' | 'stagger';
}

export interface ShooterDropTable extends DropTable {
  ammo: readonly AmmoDropDef[];
  guns: readonly GunDropDef[];
}

const bossPhaseRoar = (id: string, clip = 'cast_big'): EnemyMoveDef => ({
  id,
  chainOnly: true,
  windup: 24,
  active: 26,
  recovery: 32,
  damage: 0,
  kind: 'arcane',
  poise: 0,
  hitbox: { forward: 0, up: 2.2, radius: 0.1 },
  range: 0,
  weight: 0,
  cooldown: 0,
  hyperArmor: true,
  trackUntil: 1,
  hitstop: 0,
  clip,
  noHit: true,
  shove: { radius: 12, distance: 3.5 },
});

const BACK_BATTERY_WEAKSPOT: WeakSpotDef = {
  forward: -0.55,
  up: 1.55,
  radius: 0.45,
  mult: 2.2,
};

/**
 * Sproto Shooter's enemy & boss roster adapted to SOW's 60 Hz combat model and Lv 1–30 progression.
 */
export const SHOOTER_ENEMIES: Record<ShooterEnemyId, ShooterEnemyDef> = {
  /** Fast melee swarmer: closes rapidly and overwhelms with quick slashes and lunges. */
  midget_swarmer: {
    id: 'midget_swarmer',
    name: 'Midget Swarmer',
    model: 'midget_stage3',
    stageModels: ['grunt', 'grunt_vet', 'midget_stage3'],
    tags: ['grunt', 'shooter_enemy'],
    xp: 18,
    hp: 65,
    poise: 18,
    elite: false,
    body: { radius: 0.34, height: 1.3 },
    defense: { physical: 0, arcane: 0 },
    profile: {
      damage: { physical: 'normal', arcane: 'normal' },
      status: { burn: 'weak', chill: 'normal', shock: 'normal' },
    },
    level: 2,
    moveSpeed: 5.4,
    turnRate: Math.PI * 1.9,
    staggerTicks: 42,
    aggroRange: 20,
    leashRange: 38,
    respawnTicks: 260,
    usesTokens: true,
    moves: [
      {
        id: 'frenzy_slash',
        windup: 15,
        active: 5,
        recovery: 18,
        damage: 11,
        kind: 'physical',
        poise: 10,
        hitbox: { forward: 0.85, up: 0.7, radius: 0.65 },
        range: 1.6,
        weight: 3,
        cooldown: 0,
        trackUntil: 0.65,
        hitstop: 3,
        clip: 'cast',
        token: { pool: 'melee', cost: 1 },
      },
      {
        id: 'swarm_lunge',
        windup: 24,
        active: 12,
        recovery: 22,
        damage: 15,
        kind: 'physical',
        poise: 14,
        hitbox: { forward: 0.7, up: 0.65, radius: 0.75 },
        range: 6.5,
        minRange: 2.8,
        weight: 1.5,
        cooldown: 180,
        trackUntil: 0.8,
        hitstop: 4,
        clip: 'cast_big',
        decal: 'circle',
        leap: { distance: 6.0 },
        token: { pool: 'melee', cost: 1 },
      },
    ],
  },

  /** Aerial pellet shooter: hovers above melee reach and peppers targets with spread volleys. */
  flying_midget: {
    id: 'flying_midget',
    name: 'Flying Midget',
    model: 'midget_stage3',
    tags: ['grunt', 'flying', 'shooter_enemy'],
    xp: 32,
    hp: 95,
    poise: 24,
    elite: false,
    body: { radius: 0.38, height: 1.3 },
    defense: { physical: 0, arcane: 1 },
    profile: {
      damage: { physical: 'weak', arcane: 'normal' },
      status: { burn: 'normal', chill: 'weak', shock: 'weak' },
    },
    level: 6,
    moveSpeed: 4.6,
    turnRate: Math.PI * 1.7,
    staggerTicks: 48,
    aggroRange: 24,
    leashRange: 44,
    respawnTicks: 300,
    usesTokens: true,
    keepRange: [9, 16],
    hover: 2.8,
    flying: { cruiseHeight: 2.8, bobAmplitude: 0.45, bobSpeed: 2.6 },
    moves: [
      {
        id: 'air_pellet_burst',
        windup: 22,
        active: 10,
        recovery: 28,
        damage: 8,
        kind: 'physical',
        poise: 8,
        hitbox: { forward: 0.6, up: 0.9, radius: 0.2 },
        range: 20,
        weight: 3,
        cooldown: 75,
        trackUntil: 1,
        hitstop: 2,
        clip: 'cast',
        projectile: {
          speed: 19,
          radius: 0.22,
          range: 26,
          count: 3,
          interval: 4,
          spread: 0.14,
          reflectBonus: { hpFrac: 0.25, stagger: 50, homing: 3.2 },
        },
        token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'dive_bomb',
        windup: 32,
        active: 6,
        recovery: 32,
        damage: 18,
        kind: 'physical',
        poise: 16,
        hitbox: { forward: 0, up: 0.5, radius: 0 },
        range: 16,
        minRange: 4,
        weight: 1.2,
        cooldown: 210,
        trackUntil: 0,
        hitstop: 4,
        clip: 'cast_big',
        area: { radius: 2.4 },
        decal: 'circle',
        token: { pool: 'ranged', cost: 1 },
      },
    ],
  },

  /** Ranged 3-burst kiter: maintains mid-range pressure with rapid coin volleys and coin bombs. */
  bitcoin_obama: {
    id: 'bitcoin_obama',
    name: 'Bitcoin Obama',
    model: 'obama_stage3',
    stageModels: ['slinger', 'slinger_vet', 'obama_stage3'],
    tags: ['slinger', 'shooter_enemy'],
    xp: 48,
    hp: 165,
    poise: 36,
    elite: false,
    body: { radius: 0.38, height: 1.85 },
    defense: { physical: 2, arcane: 2 },
    profile: {
      damage: { physical: 'normal', arcane: 'resist' },
      status: { burn: 'normal', chill: 'normal', shock: 'weak' },
    },
    level: 9,
    moveSpeed: 3.9,
    turnRate: Math.PI * 1.45,
    staggerTicks: 50,
    aggroRange: 24,
    leashRange: 42,
    respawnTicks: 320,
    usesTokens: true,
    keepRange: [11, 18],
    moves: [
      {
        id: 'triple_coin_burst',
        windup: 22,
        active: 12,
        recovery: 28,
        damage: 11,
        kind: 'physical',
        poise: 10,
        hitbox: { forward: 0.65, up: 1.4, radius: 0.2 },
        range: 22,
        weight: 3.5,
        cooldown: 65,
        trackUntil: 1,
        hitstop: 3,
        clip: 'cast',
        projectile: {
          speed: 22,
          radius: 0.24,
          range: 28,
          count: 3,
          interval: 4,
          spread: 0.08,
        },
        token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'volatile_airdrop',
        windup: 36,
        active: 6,
        recovery: 34,
        damage: 24,
        kind: 'physical',
        poise: 18,
        hitbox: { forward: 0, up: 0.5, radius: 0 },
        range: 18,
        minRange: 5,
        weight: 1.4,
        cooldown: 210,
        trackUntil: 0,
        hitstop: 4,
        clip: 'cast_big',
        area: { radius: 2.8 },
        decal: 'circle',
        token: { pool: 'ranged', cost: 1 },
      },
    ],
  },

  /** Shielded heavy elite: front riot-coin shield absorbs frontal fire; flank the back battery weakspot. */
  big_bitcoin_obama: {
    id: 'big_bitcoin_obama',
    name: 'Big Bitcoin Obama',
    model: 'big_coin',
    stageModels: ['big_coin', 'obama_stage3'],
    tags: ['slinger', 'big_coin', 'shooter_enemy'],
    xp: 175,
    hp: 620,
    poise: 105,
    elite: true,
    body: { radius: 0.58, height: 2.3 },
    defense: { physical: 6, arcane: 3 },
    profile: {
      damage: { physical: 'resist', arcane: 'normal' },
      status: { burn: 'normal', chill: 'normal', shock: 'weak' },
    },
    level: 14,
    moveSpeed: 2.8,
    turnRate: Math.PI * 0.9,
    staggerTicks: 75,
    brokenDamage: 1.35,
    aggroRange: 24,
    leashRange: 44,
    respawnTicks: 480,
    usesTokens: true,
    keepRange: [8, 14],
    weakSpots: [BACK_BATTERY_WEAKSPOT],
    lockPoint: { up: 1.55 },
    moves: [
      {
        id: 'heavy_coin_barrage',
        windup: 28,
        active: 16,
        recovery: 32,
        damage: 14,
        kind: 'physical',
        poise: 14,
        hitbox: { forward: 0.8, up: 1.6, radius: 0.24 },
        range: 22,
        weight: 3,
        cooldown: 95,
        hyperArmor: true,
        trackUntil: 0.9,
        hitstop: 4,
        clip: 'cast',
        projectile: {
          speed: 21,
          radius: 0.3,
          range: 28,
          count: 4,
          interval: 4,
          spread: 0.12,
        },
        token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'shield_bash',
        windup: 28,
        active: 6,
        recovery: 30,
        damage: 32,
        kind: 'physical',
        poise: 32,
        hitbox: { forward: 1.4, up: 1.2, radius: 1.1 },
        range: 3.0,
        weight: 2.5,
        cooldown: 90,
        knockback: 3.5,
        hyperArmor: true,
        trackUntil: 0.6,
        hitstop: 6,
        clip: 'cast_big',
        token: { pool: 'melee', cost: 2 },
      },
      {
        id: 'bullion_slam',
        windup: 42,
        active: 6,
        recovery: 42,
        damage: 42,
        kind: 'physical',
        poise: 36,
        hitbox: { forward: 0, up: 0.5, radius: 0 },
        range: 14,
        minRange: 3.5,
        weight: 1.5,
        cooldown: 240,
        unblockable: true,
        hyperArmor: true,
        trackUntil: 0,
        hitstop: 6,
        clip: 'cast_big',
        area: { radius: 3.4 },
        decal: 'jagged',
        token: { pool: 'ranged', cost: 1 },
      },
    ],
  },

  /** Precision beam automaton: sweeps high-velocity arcane beams and optic flare bursts. */
  laser_bot: {
    id: 'laser_bot',
    name: 'Laser Bot',
    model: 'robot_laser',
    tags: ['robot', 'shooter_enemy'],
    xp: 220,
    hp: 740,
    poise: 110,
    elite: true,
    body: { radius: 0.5, height: 2.1 },
    defense: { physical: 4, arcane: 8 },
    profile: {
      damage: { physical: 'weak', arcane: 'resist' },
      status: { burn: 'normal', chill: 'normal', shock: 'weak' },
    },
    level: 18,
    moveSpeed: 2.5,
    turnRate: Math.PI * 0.85,
    staggerTicks: 80,
    aggroRange: 26,
    leashRange: 44,
    respawnTicks: 480,
    usesTokens: true,
    keepRange: [11, 18],
    moves: [
      {
        id: 'laser_sweep',
        windup: 36,
        active: 44,
        recovery: 36,
        damage: 12,
        kind: 'arcane',
        poise: 10,
        hitbox: { forward: 0.7, up: 1.6, radius: 0.22 },
        range: 24,
        weight: 3,
        cooldown: 135,
        hyperArmor: true,
        trackUntil: 1,
        hitstop: 2,
        clip: 'cast',
        projectile: {
          speed: 34,
          radius: 0.28,
          range: 28,
          count: 11,
          interval: 4,
          spread: 0.04,
          status: { id: 'shock', stacks: 1 },
        },
        token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'thermal_focus',
        windup: 44,
        active: 6,
        recovery: 36,
        damage: 36,
        kind: 'arcane',
        poise: 26,
        hitbox: { forward: 0, up: 0.5, radius: 0 },
        range: 18,
        minRange: 4,
        weight: 1.6,
        cooldown: 240,
        trackUntil: 0,
        hitstop: 5,
        clip: 'cast',
        area: { radius: 3.2 },
        decal: 'circle',
        token: { pool: 'ranged', cost: 1 },
      },
    ],
  },

  /** Suppression fire automaton: rapid ballistic bursts plus a telegraphed rail slug. */
  shooter_bot: {
    id: 'shooter_bot',
    name: 'Shooter Bot',
    model: 'robot_shooter',
    tags: ['robot', 'shooter_enemy'],
    xp: 165,
    hp: 520,
    poise: 85,
    elite: true,
    body: { radius: 0.45, height: 2.0 },
    defense: { physical: 5, arcane: 2 },
    profile: {
      damage: { physical: 'normal', arcane: 'normal' },
      status: { burn: 'normal', chill: 'weak', shock: 'weak' },
    },
    level: 16,
    moveSpeed: 3.6,
    turnRate: Math.PI * 1.25,
    staggerTicks: 65,
    aggroRange: 26,
    leashRange: 44,
    respawnTicks: 420,
    usesTokens: true,
    keepRange: [12, 20],
    moves: [
      {
        id: 'suppressing_burst',
        windup: 24,
        active: 20,
        recovery: 28,
        damage: 12,
        kind: 'physical',
        poise: 10,
        hitbox: { forward: 0.7, up: 1.5, radius: 0.2 },
        range: 24,
        weight: 3.2,
        cooldown: 65,
        trackUntil: 1,
        hitstop: 3,
        clip: 'cast',
        projectile: {
          speed: 28,
          radius: 0.22,
          range: 32,
          count: 4,
          interval: 5,
          spread: 0.06,
        },
        token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'overcharge_slug',
        windup: 48,
        active: 1,
        recovery: 36,
        damage: 42,
        kind: 'physical',
        poise: 28,
        hitbox: { forward: 0.75, up: 1.5, radius: 0.24 },
        range: 26,
        minRange: 6,
        weight: 1.6,
        cooldown: 210,
        hyperArmor: true,
        trackUntil: 0.9,
        hitstop: 6,
        clip: 'cast_big',
        cue: 'whine',
        projectile: {
          speed: 38,
          radius: 0.36,
          range: 36,
          reflectBonus: { hpFrac: 0.12, stagger: 90 },
        },
        token: { pool: 'ranged', cost: 1 },
      },
    ],
  },

  /** High-tier Shooter world & dungeon boss: 3-stage armored titan with missile salvos and bull-rush slams. */
  mega_tinubu: {
    id: 'mega_tinubu',
    name: 'Mega Tinubu',
    model: 'tinubu_stage3',
    stageModels: ['tinubu_stage1', 'tinubu_stage2', 'tinubu_stage3'],
    tags: ['boss', 'tinubu', 'shooter_boss'],
    xp: 2400,
    hp: 6800,
    poise: 360,
    elite: true,
    body: { radius: 1.15, height: 3.3 },
    size: 1.5,
    defense: { physical: 18, arcane: 12 },
    profile: {
      damage: { physical: 'normal', arcane: 'normal' },
      status: { burn: 'resist', chill: 'normal', shock: 'weak' },
    },
    level: 28,
    moveSpeed: 4.1,
    turnRate: Math.PI * 1.0,
    staggerTicks: 160,
    brokenDamage: 1.35,
    aggroRange: 30,
    leashRange: 65,
    respawnTicks: 900,
    weakSpots: [{ forward: -0.75, up: 1.9, radius: 0.6, mult: 2.2, when: 'stunned' }],
    lockPoint: { up: 2.2 },
    cameraScale: 1.45,
    boss: {
      title: 'Overlord of the Caldera',
      arenaRadius: 34,
      introTicks: 90,
      phase2: 0.68,
      phase3: 0.34,
      enrage: 1.25,
      summon: { def: 'midget_swarmer', count: 4, below: 0.5 },
      roar: 'tinubu_roar',
      stunTicks: 150,
      gapTicks: 34,
      rocks: { ticks: 180, fuse: 54, radius: 2.8, damage: 46 },
      burnPatch: { radius: 5.5, ticks: 360 },
    },
    moves: [
      {
        id: 'sovereign_cleave',
        phases: [1, 2, 3],
        windup: 28,
        active: 6,
        recovery: 34,
        damage: 52,
        kind: 'physical',
        poise: 40,
        hitbox: { forward: 2.2, up: 1.5, radius: 1.5 },
        sweep: { forward: 2.6, up: 0.8 },
        range: 4.0,
        weight: 3,
        cooldown: 70,
        knockback: 2.5,
        trackUntil: 0.6,
        hitstop: 7,
        clip: 'cast',
      },
      {
        id: 'missile_salvo',
        phases: [1, 2, 3],
        windup: 34,
        active: 18,
        recovery: 36,
        damage: 34,
        kind: 'physical',
        poise: 26,
        hitbox: { forward: 0.9, up: 2.3, radius: 0.3 },
        range: 28,
        minRange: 6,
        weight: 2.6,
        cooldown: 160,
        hyperArmor: true,
        trackUntil: 0.95,
        hitstop: 5,
        clip: 'cast_big',
        projectile: {
          speed: 24,
          radius: 0.42,
          range: 38,
          count: 3,
          interval: 6,
          spread: 0.16,
          model: 'proj_missile',
          status: { id: 'burn', stacks: 2 },
        },
      },
      {
        id: 'caldera_rush',
        phases: [2, 3],
        windup: 34,
        active: 64,
        recovery: 42,
        damage: 66,
        kind: 'physical',
        poise: 55,
        hitbox: { forward: 1.8, up: 1.3, radius: 1.6 },
        range: 22,
        minRange: 7,
        weight: 2.2,
        cooldown: 320,
        knockback: 4.0,
        hyperArmor: true,
        trackUntil: 0.85,
        hitstop: 8,
        clip: 'run',
        charge: { speed: 15.5 },
      },
      {
        id: 'inferno_stomp',
        phases: [2, 3],
        windup: 42,
        active: 6,
        recovery: 48,
        damage: 72,
        kind: 'physical',
        poise: 50,
        hitbox: { forward: 0, up: 0.6, radius: 5.5 },
        range: 6.0,
        weight: 2,
        cooldown: 260,
        unblockable: true,
        knockback: 3.0,
        hyperArmor: true,
        trackUntil: 0,
        decal: 'jagged',
        hitstop: 9,
        clip: 'cast_big',
        burnPatch: true,
      },
      bossPhaseRoar('tinubu_roar'),
    ],
  },

  /** Floating magic boss: blinks out of melee pressure and casts homing hexes & arcane sigil storms. */
  hex_sahil: {
    id: 'hex_sahil',
    name: 'Hex Sahil',
    model: 'sahil_stage3',
    stageModels: ['sahil_stage2', 'sahil_stage3'],
    tags: ['boss', 'wisp', 'sahil', 'shooter_boss'],
    xp: 2100,
    hp: 5400,
    poise: 240,
    elite: true,
    body: { radius: 0.72, height: 2.5 },
    size: 1.3,
    defense: { physical: 10, arcane: 22 },
    profile: {
      damage: { physical: 'weak', arcane: 'resist' },
      status: { burn: 'normal', chill: 'resist', shock: 'weak' },
    },
    level: 26,
    moveSpeed: 4.4,
    turnRate: Math.PI * 1.4,
    staggerTicks: 140,
    brokenDamage: 1.4,
    aggroRange: 30,
    leashRange: 60,
    respawnTicks: 900,
    keepRange: [10, 18],
    blink: { hits: 3, distance: 9 },
    hover: 1.1,
    flying: { cruiseHeight: 1.1, bobAmplitude: 0.35, bobSpeed: 2.0 },
    lockPoint: { up: 1.55 },
    cameraScale: 1.35,
    boss: {
      title: 'Arch-Hexer of the Moonlit Veil',
      arenaRadius: 32,
      introTicks: 80,
      phase2: 0.66,
      phase3: 0.33,
      enrage: 1.2,
      summon: { def: 'flying_midget', count: 3, below: 0.55 },
      roar: 'sahil_roar',
      stunTicks: 130,
      gapTicks: 30,
      rocks: { ticks: 150, fuse: 50, radius: 2.6, damage: 42 },
      burnPatch: { radius: 4.5, ticks: 300 },
    },
    moves: [
      {
        id: 'hex_volley',
        phases: [1, 2, 3],
        windup: 24,
        active: 14,
        recovery: 28,
        damage: 28,
        kind: 'arcane',
        poise: 18,
        hitbox: { forward: 0.7, up: 1.8, radius: 0.25 },
        range: 26,
        weight: 3.5,
        cooldown: 80,
        trackUntil: 1,
        hitstop: 4,
        clip: 'cast',
        projectile: {
          speed: 15,
          radius: 0.34,
          range: 34,
          count: 3,
          interval: 5,
          spread: 0.22,
          homing: 1.9,
          reflectBonus: { hpFrac: 0.08, stagger: 80, poiseFrac: 0.25, homing: 3.0 },
        },
      },
      {
        id: 'void_sigil_storm',
        phases: [1, 2, 3],
        windup: 46,
        active: 8,
        recovery: 36,
        damage: 54,
        kind: 'arcane',
        poise: 32,
        hitbox: { forward: 0, up: 0.5, radius: 0 },
        range: 22,
        minRange: 3,
        weight: 2.2,
        cooldown: 190,
        unblockable: true,
        trackUntil: 0,
        hitstop: 6,
        clip: 'cast_big',
        area: { radius: 3.4 },
        decal: 'circle',
      },
      {
        id: 'arcane_nova',
        phases: [2, 3],
        windup: 36,
        active: 6,
        recovery: 42,
        damage: 62,
        kind: 'arcane',
        poise: 42,
        hitbox: { forward: 0, up: 1.1, radius: 5.2 },
        range: 5.5,
        weight: 2,
        cooldown: 220,
        unblockable: true,
        knockback: 4.0,
        hyperArmor: true,
        trackUntil: 0,
        decal: 'jagged',
        hitstop: 8,
        clip: 'cast_big',
      },
      bossPhaseRoar('sahil_roar'),
    ],
  },
};

/**
 * Multi-zone analytic hitboxes for every Shooter enemy (plan §3.4).
 * Priority: `weak` (3) > `shield` (2) > `body` (1).
 */
export const SHOOTER_HITZONES: Record<ShooterEnemyId, readonly HitZoneDef[]> = {
  midget_swarmer: [
    { id: 'head', kind: 'weak', forward: 0.05, up: 1.12, radius: 0.26, mult: 2.0, priority: 3 },
    { id: 'body', kind: 'body', forward: 0, up: 0.62, radius: 0.36, mult: 1.0, priority: 1 },
  ],
  flying_midget: [
    { id: 'head', kind: 'weak', forward: 0.05, up: 1.12, radius: 0.28, mult: 2.0, priority: 3 },
    { id: 'body', kind: 'body', forward: 0, up: 0.65, radius: 0.38, mult: 1.0, priority: 1 },
  ],
  bitcoin_obama: [
    { id: 'head', kind: 'weak', forward: 0.05, up: 1.62, radius: 0.28, mult: 2.0, priority: 3 },
    { id: 'body', kind: 'body', forward: 0, up: 0.95, radius: 0.42, mult: 1.0, priority: 1 },
  ],
  big_bitcoin_obama: [
    { id: 'back_battery', kind: 'weak', forward: -0.55, up: 1.55, radius: 0.42, mult: 2.2, priority: 3 },
    { id: 'head', kind: 'weak', forward: 0.05, up: 2.08, radius: 0.34, mult: 1.8, priority: 3 },
    { id: 'front_shield', kind: 'shield', forward: 0.58, up: 1.25, radius: 0.72, mult: 0.2, priority: 2 },
    { id: 'body', kind: 'body', forward: 0, up: 1.15, radius: 0.58, mult: 1.0, priority: 1 },
  ],
  laser_bot: [
    { id: 'optic_lens', kind: 'weak', forward: 0.12, up: 1.78, radius: 0.3, mult: 2.2, priority: 3 },
    { id: 'chassis', kind: 'body', forward: 0, up: 1.05, radius: 0.52, mult: 1.0, priority: 1 },
  ],
  shooter_bot: [
    { id: 'sensor_head', kind: 'weak', forward: 0.08, up: 1.72, radius: 0.28, mult: 2.0, priority: 3 },
    { id: 'chassis', kind: 'body', forward: 0, up: 1.0, radius: 0.48, mult: 1.0, priority: 1 },
  ],
  mega_tinubu: [
    { id: 'crown_head', kind: 'weak', forward: 0.1, up: 2.95, radius: 0.46, mult: 2.0, priority: 3 },
    { id: 'back_core', kind: 'weak', forward: -0.75, up: 1.9, radius: 0.58, mult: 2.5, onlyWhen: 'stunned', priority: 3 },
    { id: 'chest_aegis', kind: 'shield', forward: 0.68, up: 1.75, radius: 0.78, mult: 0.35, priority: 2 },
    { id: 'body', kind: 'body', forward: 0, up: 1.65, radius: 1.15, mult: 1.0, priority: 1 },
  ],
  hex_sahil: [
    { id: 'crown_sigil', kind: 'weak', forward: 0.06, up: 2.25, radius: 0.38, mult: 2.0, priority: 3 },
    { id: 'ward_barrier', kind: 'shield', forward: 0.5, up: 1.45, radius: 0.62, mult: 0.3, priority: 2 },
    { id: 'body', kind: 'body', forward: 0, up: 1.25, radius: 0.72, mult: 1.0, priority: 1 },
  ],
};

/**
 * Shooter enemy loot tables: Sprouts, hearts, ammo refills, and drops across all 9 fixed guns.
 * Mirrors gun entries into `items` so SOW's standard `DropTable` roller can consume them directly.
 */
function shooterDrop(
  sprouts: [number, number],
  heartChance: number,
  ammo: readonly AmmoDropDef[],
  guns: readonly GunDropDef[],
): ShooterDropTable {
  return {
    sprouts,
    heartChance,
    ammo,
    guns,
    items: guns.map((g) => ({ item: g.item, chance: g.chance, ...(g.when ? { when: g.when } : {}) })),
  };
}

export const SHOOTER_LOOT: Record<ShooterEnemyId, ShooterDropTable> = {
  midget_swarmer: shooterDrop(
    [5, 10],
    0.15,
    [{ ammoType: 'light', amount: [18, 36], chance: 0.45 }],
    [
      { item: 'gun_handgun', chance: 0.06 },
      { item: 'gun_machinepistol', chance: 0.04 },
    ],
  ),
  flying_midget: shooterDrop(
    [9, 16],
    0.18,
    [
      { ammoType: 'light', amount: [24, 48], chance: 0.5 },
      { ammoType: 'shells', amount: [4, 8], chance: 0.2 },
    ],
    [
      { item: 'gun_machinepistol', chance: 0.08 },
      { item: 'gun_mg', chance: 0.06 },
    ],
  ),
  bitcoin_obama: shooterDrop(
    [14, 24],
    0.2,
    [
      { ammoType: 'light', amount: [30, 54], chance: 0.5 },
      { ammoType: 'shells', amount: [6, 12], chance: 0.3 },
    ],
    [
      { item: 'gun_mg', chance: 0.08 },
      { item: 'gun_shotgun', chance: 0.08 },
    ],
  ),
  big_bitcoin_obama: shooterDrop(
    [45, 75],
    0.45,
    [
      { ammoType: 'shells', amount: [10, 18], chance: 0.65 },
      { ammoType: 'rockets', amount: [2, 4], chance: 0.45 },
    ],
    [
      { item: 'gun_shotgun', chance: 0.16 },
      { item: 'gun_bazooka', chance: 0.12 },
    ],
  ),
  shooter_bot: shooterDrop(
    [35, 60],
    0.35,
    [
      { ammoType: 'light', amount: [36, 72], chance: 0.6 },
      { ammoType: 'sniper', amount: [4, 8], chance: 0.45 },
    ],
    [
      { item: 'gun_sniper', chance: 0.14 },
      { item: 'gun_mg', chance: 0.1 },
    ],
  ),
  laser_bot: shooterDrop(
    [55, 90],
    0.4,
    [
      { ammoType: 'sniper', amount: [6, 12], chance: 0.55 },
      { ammoType: 'light', amount: [40, 80], chance: 0.5 },
    ],
    [
      { item: 'gun_raygun', chance: 0.12 },
      { item: 'gun_sniper', chance: 0.16 },
    ],
  ),
  mega_tinubu: shooterDrop(
    [280, 420],
    1.0,
    [
      { ammoType: 'rockets', amount: [6, 10], chance: 1.0 },
      { ammoType: 'sniper', amount: [10, 16], chance: 1.0 },
    ],
    [
      { item: 'gun_bigbullets', chance: 0.65 },
      { item: 'gun_bazooka', chance: 0.5 },
    ],
  ),
  hex_sahil: shooterDrop(
    [240, 360],
    1.0,
    [
      { ammoType: 'light', amount: [60, 120], chance: 1.0 },
      { ammoType: 'shells', amount: [12, 24], chance: 1.0 },
    ],
    [
      { item: 'gun_duckgun', chance: 0.65 },
      { item: 'gun_raygun', chance: 0.5 },
    ],
  ),
};
