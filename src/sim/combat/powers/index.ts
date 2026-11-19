import { POWER } from '../../../content/packs/c3';
import type { SpellId } from '../../../content/spells';
import type { Entity } from '../../entity';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { CombatCtx } from '../playerCombat';
import type { SpawnSpellProjectile } from '../spells';
import { plantBloom, stepBloom } from './bloom';
import { growWall, stepWall } from './bramble';
import { powersOf } from './common';
import { startChannel } from './ember';
import { raiseWard } from './mirrorWard';
import { stepRoot } from './snare';
import { releaseSurge, stepWave, surgeFromEvents } from './surge';
import { throwVine, vineTarget } from './vine';

/**
 * The eight C3 powers (expansion plan §1.2). Each mechanic has its own file here; the combat code
 * calls in through small hooks. Everything lives on entities as plain data, so the state hash,
 * snapshots and a restore all carry it.
 */

/** A power that can't be cast right now says why, before any mana is spent. */
export function powerRefused(ctx: CombatCtx, p: Entity, id: SpellId): boolean {
  let reason: string | null = null;
  if (id === 'sproutSurge' && (p.powers?.surge ?? 0) < POWER.surge.max) reason = 'The Surge meter is not full yet.';
  else if (id === 'vinePull' && !vineTarget(ctx, p)) reason = 'Vine Pull needs a target in range.';
  if (reason) ctx.events.push({ type: 'refused', entity: p.id, action: 'cast', reason });
  return reason !== null;
}

/** Release a power. False for a spell the normal cast path handles (Static Snare is a projectile). */
export function firePower(ctx: CombatCtx, p: Entity, id: SpellId, power: number, physics: PhysicsWorld, spawn: SpawnSpellProjectile): boolean {
  switch (id) {
    case 'mirrorWard':
      raiseWard(ctx, p);
      return true;
    case 'seekerSwarm':
      powersOf(p).swarm = POWER.swarm.ticks;
      ctx.events.push({ type: 'power', fx: 'swarm', entity: p.id, pos: { ...p.tf.pos } });
      return true;
    case 'brambleWall':
      growWall(ctx, p, power, physics, spawn);
      return true;
    case 'vinePull':
      throwVine(ctx, p, power, physics);
      return true;
    case 'healingBloom':
      plantBloom(ctx, p, spawn);
      return true;
    case 'emberBreath':
      startChannel(ctx, p);
      return true;
    case 'sproutSurge':
      releaseSurge(ctx, p, power, spawn);
      return true;
    default:
      return false;
  }
}

/** Seeker Swarm: while it runs, a Bolt homes on the spell's target. */
export function seekerMods(p: Entity, id: SpellId, target: Entity | null): { homing?: number; target?: number } {
  return id === 'bolt' && p.powers?.swarm && target ? { homing: POWER.swarm.homing, target: target.id } : {};
}

function tickTimers(ctx: CombatCtx, e: Entity): void {
  const pw = e.powers;
  if (!pw || ctx.frozen.has(e.id)) return;
  if (pw.ward && ++pw.ward.t >= pw.ward.dur) delete pw.ward;
  if (pw.swarm !== undefined && --pw.swarm <= 0) delete pw.swarm;
  stepRoot(e);
  if (Object.keys(pw).length === 0) delete e.powers;
}

/** Advance every running power once per tick. Returns the ground effects to remove. */
export function stepPowers(ctx: CombatCtx): number[] {
  const gone: number[] = [];
  for (const e of ctx.entities) {
    if (ctx.frozen.has(e.id)) continue;
    const a = e.powerArea;
    if (!a) {
      tickTimers(ctx, e);
      continue;
    }
    const over = a.kind === 'wall' ? stepWall(ctx, e) : a.kind === 'bloom' ? stepBloom(ctx, e) : stepWave(ctx, e);
    if (over) gone.push(e.id);
  }
  surgeFromEvents(ctx);
  return gone;
}
