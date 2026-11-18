import { flatDist, yawTo } from '../../src/sim/combat/geometry';
import type { Entity } from '../../src/sim/entity';
import { wrapAngle, type Vec3 } from '../../src/sim/math';
import type { SimWorld } from '../../src/sim/SimWorld';
import { combatWorld, idle, step } from './combatHelpers';

/** Open ground in the sandbox, well clear of its pillars, steps and ramps. */
export const OPEN = { x: 0, y: 0, z: -50 };

/** A player standing on open ground and one enemy `dist` metres away from them, along `deg` degrees of bearing. */
export async function duel(def: string, dist: number, deg = 0, seed = 1): Promise<{ w: SimWorld; p: Entity; e: Entity }> {
  const { w, p } = await combatWorld({ pos: OPEN, seed });
  const r = (deg * Math.PI) / 180;
  const e = w.spawnEnemy(def, { x: OPEN.x + Math.sin(r) * dist, y: 0, z: OPEN.z + Math.cos(r) * dist }, r + Math.PI);
  return { w, p, e };
}

/** The player can't die: long AI runs must not be cut short by a respawn. */
export function immortal(p: Entity): void {
  p.vitals!.hp = p.vitals!.hpMax;
}

export const isFree = (e: Entity) => e.combat!.action === null;

/** Distance from the enemy to the player's body. */
export const gapOf = (e: Entity, p: Entity) => flatDist(e.tf.pos, p.tf.pos) - p.body!.radius;

/** Where the enemy stands around the player (radians). */
export const bearing = (e: Entity, p: Entity) => yawTo(p.tf.pos, e.tf.pos);

export const planarSpeed = (e: Entity) => Math.hypot(e.tf.vel.x, e.tf.vel.z);

export interface Trace {
  /** Total angle walked around the player (radians, in either direction). */
  orbit: number;
  /** Closest and furthest gap while free to move. */
  minGap: number;
  maxGap: number;
  meanGap: number;
  /** Ticks free to move, and how many of them it was on the move. */
  free: number;
  moving: number;
  /** Times its velocity turned back on itself. */
  reversals: number;
  maxFromHome: number;
}

/** Runs `ticks` of a fight against a player who stands still, recording how the enemy moves. */
export function trace(w: SimWorld, p: Entity, e: Entity, ticks: number, home: Vec3 = e.brain!.home): Trace {
  const t: Trace = { orbit: 0, minGap: Infinity, maxGap: 0, meanGap: 0, free: 0, moving: 0, reversals: 0, maxFromHome: 0 };
  let last = bearing(e, p);
  let vx = 0, vz = 0;
  for (let i = 0; i < ticks; i++) {
    immortal(p);
    step(w, idle());
    const now = bearing(e, p);
    t.orbit += Math.abs(wrapAngle(now - last));
    last = now;
    t.maxFromHome = Math.max(t.maxFromHome, flatDist(e.tf.pos, home));
    const v = e.tf.vel;
    if (planarSpeed(e) > 0.3 && Math.hypot(vx, vz) > 0.3 && v.x * vx + v.z * vz < 0) t.reversals++;
    vx = v.x;
    vz = v.z;
    if (!isFree(e)) continue;
    const gap = gapOf(e, p);
    t.free++;
    t.meanGap += gap;
    t.minGap = Math.min(t.minGap, gap);
    t.maxGap = Math.max(t.maxGap, gap);
    if (planarSpeed(e) > 0.3) t.moving++;
  }
  t.meanGap /= Math.max(1, t.free);
  return t;
}
