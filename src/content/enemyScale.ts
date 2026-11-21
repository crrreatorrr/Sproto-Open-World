/**
 * How big the very strong enemies stand. One table of multipliers and one function that grows a whole
 * definition by it, so a body, its reach, its telegraphs and its fight's geometry can't drift apart.
 *
 * Damage, HP, poise and speeds never change here. Pure data and arithmetic; type-only imports from the
 * registry keep this file out of its import cycle.
 */
import type { EnemyDef, EnemyMoveDef, WeakSpotDef } from './enemies';
import { DUEL_BOSS_SIZES } from './packs/duelBosses';
import { MOVE, PLAYER_BODY, TICK_HZ } from './tuning';

/** Every elite and boss, by how many times its authored size it is drawn and fought at. */
export const ENEMY_SIZES: Readonly<Record<string, number>> = {
  brute: 1.5,
  /** The Rootdeep's Brute. Same authored body as `brute`, so the same scale. */
  rd_brute: 1.5,
  gatekeeper: 1.5,
  rivet_gunner: 1.5,
  lens_warden: 1.5,
  bramble_colossus: 1.5,
  hollow_giant: 1.5,
  /** The Deep Warden. Same authored body as `hollow_giant`, so the same scale. */
  deep_warden: 1.5,
  scrapjaw: 1.6,
  burrowmother: 1.6,
  skyfire_drake: 1.8,
  big_bitcoin_obama: 1.5,
  laser_bot: 1.5,
  shooter_bot: 1.5,
  mega_tinubu: 1.6,
  hex_sahil: 1.6,
  ...DUEL_BOSS_SIZES,
};

/** An area circle must stay outrunnable: this much slack (m) on a sprint out of it during the wind-up. */
const AREA_SLACK = 0.2;
/** The follow camera pulls back this much per metre of body height, once a body is taller than `CAMERA_FROM`. */
const CAMERA_FROM = 4;

/**
 * The largest circle centred on the player that a sprint started on the first tick still clears. The
 * sprint starts from a standstill, so it loses the distance it takes to build up to speed.
 */
const outrunnable = (windup: number): number =>
  (MOVE.sprintSpeed * windup) / TICK_HZ - (MOVE.sprintSpeed * MOVE.sprintSpeed) / (2 * MOVE.accel) - PLAYER_BODY.radius - AREA_SLACK;

const scaleSpot = (s: WeakSpotDef, k: number): WeakSpotDef => ({ ...s, forward: s.forward * k, up: s.up * k, radius: s.radius * k });

/**
 * Moves thrown across the field: how far they reach is about the arena, not the arm. They only move out
 * by what the body grew, so the distance from its skin to the player stays what it was tuned to be.
 */
const thrown = (m: EnemyMoveDef): boolean => !!(m.projectile || m.area || m.charge || m.dive || m.leap || m.burrow);

function scaleMove(m: EnemyMoveDef, k: number, grew: number): EnemyMoveDef {
  const out: EnemyMoveDef = {
    ...m,
    hitbox: { forward: m.hitbox.forward * k, up: m.hitbox.up * k, radius: m.hitbox.radius * k },
    range: thrown(m) ? (m.range > 0 ? m.range + grew : 0) : m.range * k,
  };
  if (m.minRange !== undefined) out.minRange = m.minRange + grew;
  if (m.sweep) out.sweep = { forward: m.sweep.forward * k, up: m.sweep.up * k };
  if (m.area) out.area = { radius: Math.max(m.area.radius, Math.min(m.area.radius * k, outrunnable(m.windup))) };
  if (m.shove) out.shove = { radius: m.shove.radius * k, distance: m.shove.distance * k };
  if (m.weakSpots) out.weakSpots = m.weakSpots.map((s) => scaleSpot(s, k));
  if (m.dive) out.dive = { length: m.dive.length, low: m.dive.low * k };
  return out;
}

/** `def` at `k` times its size: everything measured in metres on its body, and what its fight builds on that. */
export function scaleEnemy(def: EnemyDef, k: number): EnemyDef {
  const grew = def.body.radius * (k - 1);
  const height = def.body.height * k;
  const out: EnemyDef = {
    ...def,
    size: k,
    body: { radius: def.body.radius * k, height },
    moves: def.moves.map((m) => scaleMove(m, k, grew)),
    cameraScale: Math.max(def.cameraScale ?? 1, height / CAMERA_FROM),
  };
  if (def.keepRange) out.keepRange = [def.keepRange[0] + grew, def.keepRange[1] + grew];
  if (def.hover) out.hover = def.hover * k;
  if (def.weakSpots) out.weakSpots = def.weakSpots.map((s) => scaleSpot(s, k));
  if (def.lockPoint) out.lockPoint = { ...def.lockPoint, up: def.lockPoint.up * k, ...(def.lockPoint.forward ? { forward: def.lockPoint.forward * k } : {}) };
  // The arena itself is the terrain's, so it stays; what the boss leaves on its floor grows with it.
  if (def.boss) out.boss = { ...def.boss, burnPatch: { ...def.boss.burnPatch, radius: def.boss.burnPatch.radius * k } };
  if (def.drake) {
    // Its chest keeps to the same heights, so spells and fireballs still cross the same distances.
    const drop = def.body.height * (k - 1) * 0.55;
    const [lo, hi] = def.drake.altitude;
    out.drake = {
      ...def.drake,
      altitude: [lo - drop, hi - drop],
      arenaMargin: def.drake.arenaMargin + grew,
      glide: { ...def.drake.glide, height: def.drake.glide.height * k },
    };
  }
  return out;
}

const affixMoves = new WeakMap<EnemyMoveDef, Map<number, EnemyMoveDef>>();

/**
 * A move on a body an affix made `k` times bigger (Colossal): its blow and its muzzle grow with the body.
 * Circles on the ground keep their size, since they land on the target rather than around the attacker.
 */
export function affixedMove(m: EnemyMoveDef, k: number): EnemyMoveDef {
  if (k === 1) return m;
  let sizes = affixMoves.get(m);
  if (!sizes) affixMoves.set(m, (sizes = new Map()));
  let out = sizes.get(k);
  if (!out) {
    out = { ...m, hitbox: { forward: m.hitbox.forward * k, up: m.hitbox.up * k, radius: m.hitbox.radius * k } };
    if (m.sweep) out.sweep = { forward: m.sweep.forward * k, up: m.sweep.up * k };
    sizes.set(k, out);
  }
  return out;
}
