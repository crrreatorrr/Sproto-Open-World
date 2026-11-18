import { ENEMIES } from '../../../content/enemies';
import { SPELLS, type SpellId } from '../../../content/spells';
import type { Entity } from '../../entity';
import type { Vec3 } from '../../math';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { HitInfo } from '../hits';
import type { PowerState } from './state';

export const powersOf = (e: Entity): PowerState => (e.powers ??= {});

export const alive = (e: Entity): boolean => e.combat?.action?.kind !== 'dead';

/** A living body on the other team. */
export const hostile = (p: Entity, e: Entity): boolean => !!e.combat && !!e.body && e.combat.team !== p.combat?.team && alive(e);

export const chestOf = (e: Entity): Vec3 => ({ x: e.tf.pos.x, y: e.tf.pos.y + (e.body?.height ?? 1.8) * 0.55, z: e.tf.pos.z });

/** Bosses are the fighters that don't queue for attack tokens (EnemyDef.usesTokens). */
export function isBoss(e: Entity): boolean {
  if (e.kind === 'boss') return true;
  const def = e.brain ? ENEMIES[e.brain.def] : undefined;
  return !!def && !def.dummy && !def.usesTokens;
}

/** Nothing solid between two points. */
export function clearLine(physics: PhysicsWorld, a: Vec3, b: Vec3): boolean {
  const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const dist = Math.hypot(dir.x, dir.y, dir.z);
  if (dist < 0.3) return true;
  const hit = physics.raycast(a, dir, dist);
  return !hit || hit.distance >= dist - 0.3;
}

/** One power landing: arcane, unblockable and without hit-stop, like the other spells. */
export function powerHit(id: SpellId, base: number, from: Vec3, over: Partial<HitInfo> = {}): HitInfo {
  const def = SPELLS[id];
  return {
    move: id, base, kind: 'arcane', poise: def.poise, hitstun: def.knockdown ? 45 : 14, knockdown: !!def.knockdown, pushback: def.knockdown ? 1.5 : 0.2,
    hitstop: 0, unblockable: true, heavy: false, crit: false, mana: 0, from, projectile: true, ...over,
  };
}
