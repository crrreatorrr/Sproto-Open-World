import { tokensInUse } from '../../src/sim/ai/brain';
import { enemyMove } from '../../src/sim/combat/hits';
import type { CombatCtx } from '../../src/sim/combat/playerCombat';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import type { TickEvents } from './combatHelpers';

/** M1b test helpers (spells, statuses, tokens, waves). */

/** A combat context over the world as it is between ticks (for calling sim functions directly). */
export function ctxOf(w: SimWorld, events: SimEvent[] = []): CombatCtx {
  return { now: w.now, entities: w.entities, get: (id) => w.get(id), events, motion: new Map(), frozen: new Set() };
}

/** Melee or ranged tokens in use against `target` right now. */
export function tokens(w: SimWorld, target: Entity, pool: 'melee' | 'ranged'): number {
  return tokensInUse(ctxOf(w), target, pool);
}

/** Is this enemy in one of its attacks' wind-up (before the first active tick)? */
export function inWindup(e: Entity): boolean {
  const a = e.combat?.action;
  if (a?.kind !== 'attack') return false;
  const m = enemyMove(e, a.move);
  return !!m && a.t < m.windup;
}

export const isAttacking = (e: Entity) => e.combat?.action?.kind === 'attack';

/** Keep everybody alive (refill HP): long AI runs must not be cut short by deaths and respawns. */
export function keepAlive(w: SimWorld): void {
  for (const e of w.entities) if (e.vitals && e.combat?.action?.kind !== 'dead') e.vitals.hp = e.vitals.hpMax;
}

/** Events of one type on one entity (the `entity` field). */
export const evOf = <T extends SimEvent['type']>(events: readonly TickEvents[], type: T, entity?: number) =>
  events.filter(
    (x): x is TickEvents & { ev: Extract<SimEvent, { type: T }> } => x.ev.type === type && (entity === undefined || (x.ev as { entity?: number }).entity === entity),
  );

/** Planar yaw of a velocity (0 = +Z, +π/2 = +X). */
export const velYaw = (e: Entity) => Math.atan2(e.tf.vel.x, e.tf.vel.z);
