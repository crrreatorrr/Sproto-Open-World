import { WAYSTONE } from '../../content/items';
import type { Entity } from '../entity';
import type { SimEvent } from '../events';
import { inCombat } from './loadout';

/**
 * Fast travel (from the Map tab). With the Waystone you can go to any shrine you have used
 * (touched or rested at), out of combat. God mode (systems/god.ts) goes to any shrine at any time,
 * and to any named area. The sim moves the body (SimWorld, on the `travel` event). Pure.
 */
export interface TravelCtx {
  now: number;
  entities: readonly Entity[];
  events: SimEvent[];
}

/** Where a shrine's traveller stands: beside the stone, where a respawn puts you. */
export const SHRINE_ARRIVE_OFFSET = 1.5;

const refuse = (ctx: TravelCtx, e: Entity, reason: string, action = 'fastTravel'): void => {
  ctx.events.push({ type: 'refused', entity: e.id, action, reason });
};

/** Why this player can't fast travel to that shrine right now, or null if they can. */
export function travelRefusal(e: Readonly<Entity>, shrine: string, now: number): string | null {
  const p = e.progress;
  if (!p) return 'You cannot travel.';
  if (e.combat?.action?.kind === 'dead') return "You can't travel now.";
  if (p.god) return null;
  if (!p.inventory[WAYSTONE]) return 'You need a Waystone to fast travel.';
  if (!p.discoveredShrines.includes(shrine)) return "You haven't used that shrine yet.";
  if (inCombat(e, now)) return "You can't travel in combat.";
  return null;
}

export function fastTravel(ctx: TravelCtx, e: Entity, shrine: string): void {
  const stone = ctx.entities.find((x) => x.interactable?.kind === 'shrine' && x.interactable.id === shrine);
  if (!stone) return refuse(ctx, e, 'There is no such shrine.');
  const why = travelRefusal(e, shrine, ctx.now);
  if (why) return refuse(ctx, e, why);
  const p = e.progress!;
  p.atShrine = null;
  const { x, z } = stone.tf.pos;
  ctx.events.push({ type: 'travel', entity: e.id, x: x + SHRINE_ARRIVE_OFFSET, z: z + SHRINE_ARRIVE_OFFSET, shrine });
}

/** God mode only: straight to world (x, z). */
export function godWarp(ctx: TravelCtx, e: Entity, x: number, z: number): void {
  if (!e.progress?.god) return refuse(ctx, e, 'Only in god mode.', 'godWarp');
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  ctx.events.push({ type: 'travel', entity: e.id, x, z });
}
