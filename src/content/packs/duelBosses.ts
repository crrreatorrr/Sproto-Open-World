/**
 * The Sproto Duel and Sproto Shooter bosses the open world did not have yet, with every stage:
 *
 * - Sproto Duel's ladder: Bitcoin Obama & The Midget (the double fight), Broccoli Head and Glowie.
 *   (Sahil and Tinubu are `hex_sahil` and `mega_tinubu` in shooterEnemies.ts.) Each evolves through
 *   its three Duel models as the fight's phases turn, growing as it does.
 * - Sproto Shooter's wave bosses that were only elites here: the Blue Monster (the Gatekeeper's
 *   model) and the Sproto Beast (the Brute's). One model each, bigger every phase, as in the Shooter.
 * - Two of the Shooter's campaign enemies on the new avatars: the Floret Sprout and the Glowie Agent.
 *
 * Their attacks are the clips the rigs carry (`cast` and `cast_big`; `smash`; `punch` and `kick`),
 * and the moves keep the names of the Duel fights. Numbers are for the 60 Hz combat here.
 *
 * Pure data: no three.js, DOM, Math.random, timers, storage or Rapier.
 */
import type { BossDef, EnemyDef, EnemyMoveDef } from '../enemies';
import type { DropTable } from '../loot';

/** The move a boss plays at each phase change: no hit, everyone near is pushed back. */
const roar = (id: string, up: number): EnemyMoveDef => ({
  id, chainOnly: true, windup: 24, active: 26, recovery: 32, damage: 0, kind: 'arcane', poise: 0, hitbox: { forward: 0, up, radius: 0.1 },
  range: 0, weight: 0, cooldown: 0, hyperArmor: true, trackUntil: 1, hitstop: 0, noHit: true, shove: { radius: 11, distance: 3.2 },
});
/** The roar of a rig with cast clips. */
const castRoar = (id: string, up: number): EnemyMoveDef => ({ ...roar(id, up), clip: 'cast_big' });

/** What every one of these fights shares. */
const fight = (o: Pick<BossDef, 'title' | 'summon' | 'roar'> & Partial<BossDef>): BossDef => ({
  arenaRadius: 30,
  introTicks: 80,
  phase2: 0.66,
  phase3: 0.33,
  enrage: 1.2,
  stunTicks: 130,
  gapTicks: 32,
  rocks: { ticks: 150, fuse: 52, radius: 2.5, damage: 36 },
  burnPatch: { radius: 4.5, ticks: 300 },
  ...o,
});

const SHOT = { kind: 'physical', poise: 16, trackUntil: 1, hitstop: 4, clip: 'cast' } as const;
const BLOW = { kind: 'physical', trackUntil: 0.6, hitstop: 6 } as const;

export const DUEL_BOSS_ENEMIES: Record<string, EnemyDef> = {
  /**
   * Duel's double fight. Bitcoin Obama (Pump, Hype Cycle, Dump) throws coins from range; The Midget
   * comes in with him the moment the fight starts and falls with him.
   */
  duel_obama: {
    id: 'duel_obama',
    name: 'Bitcoin Obama',
    model: 'slinger',
    stageModels: ['slinger', 'slinger_vet', 'obama_stage3'],
    stageScale: [0.82, 0.9, 1],
    tags: ['boss', 'slinger', 'duel_boss'],
    xp: 1500,
    hp: 7800,
    poise: 240,
    elite: true,
    body: { radius: 0.5, height: 2.3 },
    defense: { physical: 8, arcane: 6 },
    profile: { damage: { physical: 'weak', arcane: 'resist' }, status: { burn: 'normal', chill: 'normal', shock: 'normal' } },
    level: 14,
    moveSpeed: 3.8,
    turnRate: Math.PI * 1.2,
    staggerTicks: 130,
    brokenDamage: 1.35,
    aggroRange: 28,
    leashRange: 55,
    respawnTicks: 900,
    boss: fight({ title: 'Pump & Dump, with The Midget', summon: { def: 'duel_midget', count: 1, below: 1 }, roar: 'obama_roar' }),
    moves: [
      { ...SHOT, id: 'coin_burst', windup: 24, active: 12, recovery: 28, damage: 20, hitbox: { forward: 0.6, up: 1.6, radius: 0.2 }, range: 24, minRange: 3, weight: 3, cooldown: 70, projectile: { speed: 17, radius: 0.28, range: 30, count: 3, interval: 5, spread: 0.1 } },
      { ...BLOW, id: 'phone_swat', windup: 22, active: 5, recovery: 26, damage: 26, poise: 22, hitbox: { forward: 1.2, up: 1.3, radius: 0.9 }, range: 2.2, weight: 3, cooldown: 50, knockback: 2.5, clip: 'cast' },
      // Green Candles: the pillars march to where you stand.
      { id: 'green_candles', kind: 'arcane', windup: 44, active: 8, recovery: 34, damage: 34, poise: 28, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 22, minRange: 3, weight: 2, cooldown: 200, unblockable: true, trackUntil: 0, hitstop: 6, clip: 'cast_big', area: { radius: 2.6 }, decal: 'circle' },
      // Shill Calls: three phones that follow you. Parried, they ring him instead.
      { id: 'shill_calls', kind: 'arcane', phases: [2, 3], windup: 30, active: 18, recovery: 30, damage: 18, poise: 14, hitbox: { forward: 0.6, up: 1.7, radius: 0.2 }, range: 24, minRange: 4, weight: 2.4, cooldown: 220, trackUntil: 1, hitstop: 4, clip: 'cast', projectile: { speed: 9, radius: 0.32, range: 32, count: 3, interval: 8, spread: 0.3, homing: 2.0, reflectBonus: { hpFrac: 0.05, stagger: 70 } } },
      // Pump & Dump: a fan of four.
      { ...SHOT, id: 'pump_and_dump', phases: [2, 3], windup: 30, active: 6, recovery: 34, damage: 22, hitbox: { forward: 0.6, up: 1.6, radius: 0.2 }, range: 20, minRange: 3, weight: 2.4, cooldown: 150, clip: 'cast_big', projectile: { speed: 19, radius: 0.28, range: 28, count: 4, interval: 1, spread: 0.5 } },
      // Liquidation: the ring goes out from his feet.
      { id: 'liquidation', kind: 'arcane', phases: [3], windup: 38, active: 6, recovery: 42, damage: 44, poise: 40, hitbox: { forward: 0, up: 1, radius: 4.4 }, range: 4.6, weight: 2, cooldown: 240, unblockable: true, knockback: 4, hyperArmor: true, trackUntil: 0, decal: 'jagged', hitstop: 8, clip: 'cast_big' },
      castRoar('obama_roar', 1.8),
    ],
  },

  /** The Midget (Small Cap, To the Moon, Short Squeeze): Obama's partner. No boss of his own; his stage follows his health. */
  duel_midget: {
    id: 'duel_midget',
    name: 'The Midget',
    model: 'grunt',
    stageModels: ['grunt', 'grunt_vet', 'midget_stage3'],
    stageScale: [0.78, 0.875, 1],
    tags: ['grunt', 'duel_boss'],
    xp: 400,
    hp: 1400,
    poise: 90,
    elite: false,
    body: { radius: 0.4, height: 1.5 },
    defense: { physical: 4, arcane: 4 },
    profile: { damage: { physical: 'normal', arcane: 'weak' }, status: { burn: 'normal', chill: 'weak', shock: 'normal' } },
    level: 14,
    moveSpeed: 5.2,
    turnRate: Math.PI * 1.8,
    staggerTicks: 60,
    aggroRange: 28,
    leashRange: 55,
    respawnTicks: 900,
    usesTokens: true,
    moves: [
      { ...BLOW, id: 'tantrum_swipe', windup: 18, active: 5, recovery: 22, damage: 20, poise: 14, hitbox: { forward: 0.9, up: 0.8, radius: 0.7 }, range: 1.7, weight: 3, cooldown: 30, hitstop: 4, clip: 'cast', token: { pool: 'melee', cost: 1 } },
      // Moon Shot: three in a tight line.
      { ...SHOT, id: 'moon_shot', windup: 26, active: 14, recovery: 28, damage: 14, poise: 10, hitbox: { forward: 0.5, up: 1.0, radius: 0.2 }, range: 18, minRange: 5, weight: 2, cooldown: 140, projectile: { speed: 20, radius: 0.24, range: 26, count: 3, interval: 6, spread: 0.07 }, token: { pool: 'ranged', cost: 1 } },
      // Tantrum Stomp.
      { id: 'tantrum_stomp', kind: 'physical', windup: 38, active: 6, recovery: 36, damage: 30, poise: 26, hitbox: { forward: 0, up: 0.5, radius: 2.8 }, range: 3, weight: 1.5, cooldown: 260, unblockable: true, knockback: 3, hyperArmor: true, trackUntil: 0, decal: 'jagged', hitstop: 6, clip: 'cast_big', token: { pool: 'melee', cost: 2 } },
    ],
  },

  /** Broccoli Head (Sprout, Overgrown, Floret Colossus): vape bolts, floret mortars and a cloud you can't stand in. */
  broccoli_head: {
    id: 'broccoli_head',
    name: 'Broccoli Head',
    model: 'broccoli_stage1',
    stageModels: ['broccoli_stage1', 'broccoli_stage2', 'broccoli_stage3'],
    stageScale: [0.71, 0.84, 1],
    tags: ['boss', 'broccoli', 'duel_boss'],
    xp: 1800,
    hp: 7400,
    poise: 280,
    elite: true,
    body: { radius: 0.7, height: 2.6 },
    defense: { physical: 12, arcane: 14 },
    profile: { damage: { physical: 'normal', arcane: 'resist' }, status: { burn: 'normal', chill: 'normal', shock: 'resist' } },
    level: 18,
    moveSpeed: 3.6,
    turnRate: Math.PI * 1.1,
    staggerTicks: 140,
    brokenDamage: 1.35,
    aggroRange: 28,
    leashRange: 55,
    respawnTicks: 900,
    boss: fight({ title: 'Floret Colossus of the Grove', summon: { def: 'floret_sprout', count: 3, below: 0.5 }, roar: 'broccoli_roar' }),
    moves: [
      { ...SHOT, id: 'vape_bolt', kind: 'arcane', windup: 24, active: 4, recovery: 28, damage: 26, hitbox: { forward: 0.7, up: 1.8, radius: 0.25 }, range: 24, minRange: 3, weight: 3, cooldown: 60, projectile: { speed: 16, radius: 0.36, range: 30 } },
      { ...BLOW, id: 'stalk_whip', windup: 24, active: 6, recovery: 28, damage: 30, poise: 26, hitbox: { forward: 1.5, up: 1.3, radius: 1.1 }, sweep: { forward: 1.9, up: 0.9 }, range: 2.7, weight: 3, cooldown: 50, knockback: 2, clip: 'cast' },
      // Floret Mortar: it lands where you were.
      { id: 'floret_mortar', kind: 'physical', windup: 42, active: 8, recovery: 34, damage: 40, poise: 30, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 24, minRange: 3, weight: 2.2, cooldown: 170, unblockable: true, trackUntil: 0, hitstop: 6, clip: 'cast_big', area: { radius: 2.8 }, decal: 'circle' },
      // Floret Spray: a fan of five.
      { ...SHOT, id: 'floret_spray', phases: [2, 3], windup: 30, active: 8, recovery: 34, damage: 20, hitbox: { forward: 0.7, up: 1.8, radius: 0.25 }, range: 20, minRange: 3, weight: 2.4, cooldown: 150, clip: 'cast_big', projectile: { speed: 18, radius: 0.28, range: 28, count: 5, interval: 1, spread: 0.63 } },
      // Hotbox: a wide cloud.
      { id: 'hotbox', kind: 'arcane', phases: [2, 3], windup: 52, active: 10, recovery: 36, damage: 36, poise: 26, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 20, minRange: 3, weight: 1.8, cooldown: 280, unblockable: true, trackUntil: 0, hitstop: 5, clip: 'cast_big', area: { radius: 4.2 }, decal: 'circle' },
      // Big Exhale: a long breath straight ahead that throws you back.
      { id: 'big_exhale', kind: 'arcane', phases: [3], windup: 36, active: 10, recovery: 44, damage: 50, poise: 44, hitbox: { forward: 1.8, up: 1.4, radius: 1.5 }, sweep: { forward: 5, up: 1.4 }, range: 5.5, weight: 2, cooldown: 220, knockback: 5, hyperArmor: true, trackUntil: 0.7, hitstop: 8, clip: 'cast_big' },
      castRoar('broccoli_roar', 2),
    ],
  },

  /** The Shooter's Floret Sprout on Broccoli Head's first stage: a small lobber that keeps its distance. */
  floret_sprout: {
    id: 'floret_sprout',
    name: 'Floret Sprout',
    model: 'broccoli_stage1',
    tags: ['broccoli'],
    xp: 70,
    hp: 260,
    poise: 32,
    elite: false,
    body: { radius: 0.35, height: 1.4 },
    defense: { physical: 2, arcane: 4 },
    profile: { damage: { physical: 'normal', arcane: 'resist' }, status: { burn: 'weak', chill: 'normal', shock: 'normal' } },
    level: 14,
    moveSpeed: 4.2,
    turnRate: Math.PI * 1.5,
    staggerTicks: 50,
    aggroRange: 22,
    leashRange: 38,
    respawnTicks: 300,
    usesTokens: true,
    keepRange: [7, 12],
    moves: [
      { ...SHOT, id: 'sprout_spit', kind: 'arcane', windup: 24, active: 4, recovery: 30, damage: 18, poise: 10, hitbox: { forward: 0.5, up: 1.0, radius: 0.2 }, range: 16, weight: 3, cooldown: 70, projectile: { speed: 14, radius: 0.26, range: 22 }, token: { pool: 'ranged', cost: 1 } },
      { id: 'sprout_mortar', kind: 'physical', windup: 38, active: 6, recovery: 34, damage: 28, poise: 18, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 15, minRange: 4, weight: 1.5, cooldown: 210, trackUntil: 0, hitstop: 4, clip: 'cast_big', area: { radius: 2.4 }, decal: 'circle', token: { pool: 'ranged', cost: 1 } },
    ],
  },

  /** Glowie (Routine Inquiry, Armed Response, Black Ops): a sidearm that turns into full auto, drone strikes and flashbangs. */
  glowie: {
    id: 'glowie',
    name: 'Glowie',
    model: 'agent_stage1',
    stageModels: ['agent_stage1', 'agent_stage2', 'agent_stage3'],
    stageScale: [0.8, 0.88, 1],
    tags: ['boss', 'agent', 'duel_boss'],
    xp: 2000,
    hp: 5600,
    poise: 260,
    elite: true,
    body: { radius: 0.55, height: 2.3 },
    defense: { physical: 14, arcane: 10 },
    profile: { damage: { physical: 'resist', arcane: 'normal' }, status: { burn: 'normal', chill: 'normal', shock: 'weak' } },
    level: 22,
    moveSpeed: 4.2,
    turnRate: Math.PI * 1.3,
    staggerTicks: 130,
    brokenDamage: 1.35,
    aggroRange: 30,
    leashRange: 58,
    respawnTicks: 900,
    boss: fight({ title: 'Black Ops Section Chief', summon: { def: 'glowie_agent', count: 2, below: 0.55 }, roar: 'glowie_roar' }),
    moves: [
      { ...SHOT, id: 'sidearm', windup: 22, active: 10, recovery: 26, damage: 22, hitbox: { forward: 0.7, up: 1.5, radius: 0.2 }, range: 26, minRange: 3, weight: 3, cooldown: 50, projectile: { speed: 30, radius: 0.22, range: 34, count: 2, interval: 8, spread: 0.03, model: 'bullet' } },
      { ...BLOW, id: 'baton', windup: 22, active: 6, recovery: 26, damage: 30, poise: 26, hitbox: { forward: 1.3, up: 1.3, radius: 1.0 }, sweep: { forward: 1.7, up: 1.0 }, range: 2.4, weight: 3, cooldown: 50, knockback: 3, clip: 'cast' },
      // Drone Strike.
      { id: 'drone_strike', kind: 'physical', windup: 40, active: 8, recovery: 32, damage: 46, poise: 34, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 28, minRange: 3, weight: 2.2, cooldown: 180, unblockable: true, trackUntil: 0, hitstop: 7, clip: 'cast_big', area: { radius: 2.6 }, decal: 'circle' },
      // Burst Fire.
      { ...SHOT, id: 'burst_fire', phases: [2, 3], windup: 26, active: 14, recovery: 28, damage: 18, hitbox: { forward: 0.7, up: 1.5, radius: 0.2 }, range: 26, minRange: 3, weight: 2.6, cooldown: 110, projectile: { speed: 32, radius: 0.22, range: 34, count: 3, interval: 5, spread: 0.05, model: 'bullet' } },
      // Flashbang: wide, and quick to go off.
      { id: 'flashbang', kind: 'arcane', phases: [2, 3], windup: 50, active: 6, recovery: 34, damage: 24, poise: 40, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 20, minRange: 3, weight: 1.8, cooldown: 280, unblockable: true, trackUntil: 0, hitstop: 6, clip: 'cast_big', area: { radius: 4 }, decal: 'circle' },
      // Full Auto: seven, walking across you.
      { ...SHOT, id: 'full_auto', phases: [3], windup: 34, active: 30, recovery: 40, damage: 14, hitbox: { forward: 0.7, up: 1.5, radius: 0.2 }, range: 24, minRange: 4, weight: 2.4, cooldown: 240, hyperArmor: true, trackUntil: 0.9, clip: 'cast_big', cue: 'whine', projectile: { speed: 30, radius: 0.22, range: 34, count: 7, interval: 4, spread: 0.12, model: 'bullet' } },
      castRoar('glowie_roar', 1.8),
    ],
  },

  /** The Shooter's Glowie Agent on Glowie's first stage: a suit with a sidearm. */
  glowie_agent: {
    id: 'glowie_agent',
    name: 'Glowie Agent',
    model: 'agent_stage1',
    tags: ['agent'],
    xp: 90,
    hp: 300,
    poise: 36,
    elite: false,
    body: { radius: 0.35, height: 1.85 },
    defense: { physical: 4, arcane: 2 },
    profile: { damage: { physical: 'resist', arcane: 'normal' }, status: { burn: 'normal', chill: 'normal', shock: 'weak' } },
    level: 18,
    moveSpeed: 3.8,
    turnRate: Math.PI * 1.4,
    staggerTicks: 50,
    aggroRange: 24,
    leashRange: 40,
    respawnTicks: 300,
    usesTokens: true,
    keepRange: [9, 15],
    moves: [
      { ...SHOT, id: 'agent_sidearm', windup: 22, active: 10, recovery: 30, damage: 16, poise: 10, hitbox: { forward: 0.6, up: 1.3, radius: 0.2 }, range: 20, weight: 3, cooldown: 70, projectile: { speed: 28, radius: 0.22, range: 28, count: 2, interval: 8, spread: 0.04, model: 'bullet' }, token: { pool: 'ranged', cost: 1 } },
      { id: 'agent_flash', kind: 'arcane', windup: 40, active: 6, recovery: 34, damage: 22, poise: 24, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 16, minRange: 4, weight: 1.4, cooldown: 240, trackUntil: 0, hitstop: 4, clip: 'cast_big', area: { radius: 2.8 }, decal: 'circle', token: { pool: 'ranged', cost: 1 } },
    ],
  },

  /**
   * Sproto Shooter's BLUE MONSTER (its second wave's boss), on the model the Gatekeeper wears. Its one
   * attack clip is the overhead smash, so every blow is that arm coming down; it spits, too.
   */
  blue_monster: {
    id: 'blue_monster',
    name: 'Blue Monster',
    model: 'gatekeeper',
    // The Shooter's 7.0, 7.6 and 8.2 m.
    stageScale: [1, 1.08, 1.17],
    tags: ['boss', 'shooter_boss'],
    xp: 2200,
    hp: 4400,
    poise: 380,
    elite: true,
    body: { radius: 1.0, height: 3.2 },
    defense: { physical: 16, arcane: 8 },
    profile: { damage: { physical: 'resist', arcane: 'normal' }, status: { burn: 'normal', chill: 'resist', shock: 'normal' } },
    level: 24,
    moveSpeed: 3.6,
    turnRate: Math.PI * 0.9,
    staggerTicks: 150,
    brokenDamage: 1.35,
    aggroRange: 30,
    leashRange: 60,
    respawnTicks: 900,
    weakSpots: [{ forward: -0.8, up: 1.9, radius: 0.6, mult: 2.2, when: 'stunned' }],
    boss: fight({ title: 'Terror of the Second Wave', arenaRadius: 34, summon: { def: 'grunt_vet', count: 4, below: 0.5 }, roar: 'monster_roar', stunTicks: 150, rocks: { ticks: 180, fuse: 54, radius: 2.8, damage: 44 } }),
    moves: [
      { ...BLOW, id: 'monster_smash', windup: 34, active: 6, recovery: 34, damage: 48, poise: 40, hitbox: { forward: 2.0, up: 1.0, radius: 1.3 }, range: 3.4, weight: 3, cooldown: 50, hyperArmor: true, hitstop: 7, clip: 'smash' },
      // Three quick chops: dodge each one.
      { ...BLOW, id: 'monster_string', phases: [2, 3], windup: 28, active: 5, recovery: 8, damage: 30, poise: 22, hitbox: { forward: 1.8, up: 1.2, radius: 1.1 }, range: 3.0, weight: 2.4, cooldown: 140, trackUntil: 0.7, hitstop: 4, clip: 'smash', followUp: 'monster_string2' },
      { ...BLOW, id: 'monster_string2', chainOnly: true, windup: 20, active: 5, recovery: 8, damage: 30, poise: 22, hitbox: { forward: 1.8, up: 1.2, radius: 1.1 }, range: 3.0, weight: 0, cooldown: 0, trackUntil: 0.7, hitstop: 4, clip: 'smash', followUp: 'monster_string3' },
      { ...BLOW, id: 'monster_string3', chainOnly: true, windup: 22, active: 5, recovery: 34, damage: 34, poise: 28, hitbox: { forward: 1.9, up: 1.0, radius: 1.2 }, range: 3.0, weight: 0, cooldown: 0, trackUntil: 0.5, hitstop: 5, clip: 'smash', knockback: 3 },
      // The ground wave: under your feet.
      { id: 'monster_wave', kind: 'physical', windup: 42, active: 6, recovery: 40, damage: 56, poise: 44, hitbox: { forward: 0, up: 0.4, radius: 0 }, range: 12, minRange: 3, weight: 2, cooldown: 260, unblockable: true, hyperArmor: true, trackUntil: 0, hitstop: 8, clip: 'smash', area: { radius: 3.4 }, decal: 'jagged' },
      // Monster bullets: a fan of five from its mouth.
      { ...SHOT, id: 'monster_spit', windup: 30, active: 8, recovery: 36, damage: 24, hitbox: { forward: 1.1, up: 2.7, radius: 0.3 }, range: 26, minRange: 6, weight: 2.4, cooldown: 170, clip: 'smash', projectile: { speed: 22, radius: 0.36, range: 34, count: 5, interval: 1, spread: 0.7 } },
      { ...BLOW, id: 'monster_rush', phases: [2, 3], windup: 34, active: 60, recovery: 42, damage: 60, poise: 55, hitbox: { forward: 1.7, up: 1.3, radius: 1.5 }, range: 22, minRange: 7, weight: 2, cooldown: 320, knockback: 4, hyperArmor: true, trackUntil: 0.85, hitstop: 8, clip: 'run', charge: { speed: 14 } },
      roar('monster_roar', 2.2),
    ],
  },

  /**
   * Sproto Shooter's SPROTO BEAST (its last wave's boss), on the model the Thornwood Brute wears: it
   * fights with punches and kicks, and fires homing missiles between them.
   */
  sproto_beast: {
    id: 'sproto_beast',
    name: 'Sproto Beast',
    model: 'brute',
    // The Shooter's 7.5, 8.0 and 8.6 m.
    stageScale: [1, 1.07, 1.15],
    tags: ['boss', 'shooter_boss'],
    xp: 3000,
    hp: 7600,
    poise: 400,
    elite: true,
    body: { radius: 0.75, height: 2.4 },
    defense: { physical: 18, arcane: 16 },
    profile: { damage: { physical: 'normal', arcane: 'resist' }, status: { burn: 'resist', chill: 'weak', shock: 'normal' } },
    level: 30,
    moveSpeed: 4.4,
    turnRate: Math.PI * 1.1,
    staggerTicks: 150,
    brokenDamage: 1.35,
    aggroRange: 30,
    leashRange: 62,
    respawnTicks: 900,
    weakSpots: [{ forward: -0.6, up: 1.5, radius: 0.5, mult: 2.2, when: 'stunned' }],
    boss: fight({ title: 'The Last Wave', arenaRadius: 34, enrage: 1.25, summon: { def: 'midget_swarmer', count: 5, below: 0.5 }, roar: 'beast_roar', stunTicks: 150, gapTicks: 28, rocks: { ticks: 180, fuse: 52, radius: 2.8, damage: 48 }, burnPatch: { radius: 3.2, ticks: 360 } }),
    moves: [
      // The Shooter's combo: punch, kick, punch.
      { ...BLOW, id: 'beast_punch', windup: 24, active: 6, recovery: 10, damage: 40, poise: 30, hitbox: { forward: 1.6, up: 1.3, radius: 0.85 }, range: 2.7, weight: 3.2, cooldown: 40, trackUntil: 0.65, hitstop: 5, clip: 'punch', followUp: 'beast_kick' },
      { ...BLOW, id: 'beast_kick', chainOnly: true, windup: 20, active: 6, recovery: 10, damage: 46, poise: 34, hitbox: { forward: 1.5, up: 0.7, radius: 0.95 }, range: 2.5, weight: 0, cooldown: 0, knockback: 3, hyperArmor: true, hitstop: 6, clip: 'kick', followUp: 'beast_punch2' },
      { ...BLOW, id: 'beast_punch2', chainOnly: true, windup: 20, active: 6, recovery: 36, damage: 44, poise: 34, hitbox: { forward: 1.6, up: 1.3, radius: 0.9 }, range: 2.7, weight: 0, cooldown: 0, knockback: 2, hitstop: 6, clip: 'punch' },
      { ...BLOW, id: 'beast_boot', windup: 30, active: 6, recovery: 32, damage: 50, poise: 40, hitbox: { forward: 1.5, up: 0.7, radius: 0.95 }, range: 2.5, weight: 2, cooldown: 90, knockback: 4.5, hyperArmor: true, clip: 'kick' },
      // The slam: around its feet; in the last phase it leaves the floor burning.
      { ...BLOW, id: 'beast_slam', windup: 42, active: 6, recovery: 46, damage: 68, poise: 50, hitbox: { forward: 0.8, up: 0.3, radius: 2.3 }, range: 3.0, weight: 2, cooldown: 240, unblockable: true, knockback: 3, hyperArmor: true, trackUntil: 0.4, decal: 'jagged', hitstop: 9, clip: 'punch', burnPatch: true },
      // Missiles: four that home in.
      { ...SHOT, id: 'beast_missiles', windup: 34, active: 26, recovery: 36, damage: 34, poise: 26, hitbox: { forward: 0.5, up: 2.1, radius: 0.3 }, range: 28, minRange: 7, weight: 2.4, cooldown: 200, hyperArmor: true, trackUntil: 0.95, hitstop: 5, clip: 'punch', projectile: { speed: 15, radius: 0.42, range: 38, count: 4, interval: 7, spread: 0.3, homing: 1.3, model: 'proj_missile', status: { id: 'burn', stacks: 2 } } },
      { ...BLOW, id: 'beast_rush', phases: [2, 3], windup: 32, active: 60, recovery: 40, damage: 66, poise: 55, hitbox: { forward: 1.4, up: 1.2, radius: 1.2 }, range: 22, minRange: 7, weight: 2.2, cooldown: 300, knockback: 4, hyperArmor: true, trackUntil: 0.85, hitstop: 8, clip: 'run', charge: { speed: 16 } },
      roar('beast_roar', 1.6),
    ],
  },
};

/** The bosses here, in the order the Duel ladder and the Shooter's waves meet them. */
export const DUEL_BOSS_IDS = ['duel_obama', 'broccoli_head', 'glowie', 'blue_monster', 'sproto_beast'] as const;

/** How many times its authored size each elite and boss here stands (merged into enemyScale.ts's table). */
export const DUEL_BOSS_SIZES: Readonly<Record<string, number>> = {
  duel_obama: 1.6,
  broccoli_head: 1.6,
  glowie: 1.6,
  blue_monster: 1.8,
  sproto_beast: 2,
};

const gun = (item: string, chance: number) => ({ item, chance });

/** What they drop (merged into loot.ts's DROPS). */
export const DUEL_BOSS_LOOT: Record<string, DropTable> = {
  duel_obama: { sprouts: [180, 260], heartChance: 1, items: [gun('gun_shotgun', 0.6), gun('gun_mg', 0.45)] },
  duel_midget: { sprouts: [40, 70], heartChance: 0.5, items: [gun('gun_machinepistol', 0.25)] },
  broccoli_head: { sprouts: [210, 310], heartChance: 1, items: [gun('gun_duckgun', 0.6), gun('gun_bazooka', 0.4)] },
  floret_sprout: { sprouts: [16, 28], heartChance: 0.2, items: [gun('gun_handgun', 0.06)] },
  glowie: { sprouts: [240, 350], heartChance: 1, items: [gun('gun_sniper', 0.6), gun('gun_machinepistol', 0.5)] },
  glowie_agent: { sprouts: [20, 34], heartChance: 0.2, items: [gun('gun_handgun', 0.08), gun('gun_machinepistol', 0.05)] },
  blue_monster: { sprouts: [260, 380], heartChance: 1, items: [gun('gun_bigbullets', 0.55), gun('gun_bazooka', 0.5)] },
  sproto_beast: { sprouts: [320, 460], heartChance: 1, items: [gun('gun_raygun', 0.65), gun('gun_bigbullets', 0.55)] },
};
