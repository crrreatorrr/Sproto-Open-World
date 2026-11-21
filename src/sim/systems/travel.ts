import { DUNGEON_OF_SHRINE } from '../../content/dungeons/catalog';
import { TRAVEL_DEVICE } from '../../content/items';
import type { Entity } from '../entity';
import type { SimEvent } from '../events';
import { inCombat } from './loadout';

/**
 * Fast travel. Wield the Brick Phone and Light attack opens it (`progress.phone`): it calls any
 * shrine you have used (touched or rested at), out of combat. God mode (systems/god.ts) goes to any
 * shrine at any time, phone or not, and to any named area from the Map tab. The sim moves the body
 * (SimWorld, on the `travel` event). A shrine inside another Campaign Dungeon is god mode's alone:
 * that is a `portalTravel` into the dungeon, and the app loads it. Pure.
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
  if (p.equipment.staff !== TRAVEL_DEVICE) return 'Wield the Brick Phone to fast travel.';
  if (!p.discoveredShrines.includes(shrine)) return "You haven't used that shrine yet.";
  if (inCombat(e, now)) return "You can't travel in combat.";
  return null;
}

export function fastTravel(ctx: TravelCtx, e: Entity, shrine: string): void {
  const stone = ctx.entities.find(
    (x) => (x.interactable?.kind === 'shrine' || x.interactable?.kind === 'portal') && x.interactable.id === shrine,
  );
  if (!stone) {
    // A shrine in a Campaign Dungeon that is not this session's: only a god goes, by loading that dungeon.
    const dungeon = DUNGEON_OF_SHRINE[shrine];
    if (!dungeon || !e.progress?.god || e.combat?.action?.kind === 'dead') return refuse(ctx, e, 'There is no such shrine.');
    e.progress.atShrine = null;
    delete e.progress.phone;
    ctx.events.push({ type: 'portalTravel', entity: e.id, portal: shrine, to: `dungeon:${dungeon}`, shrine });
    return;
  }
  const why = travelRefusal(e, shrine, ctx.now);
  if (why) return refuse(ctx, e, why);
  const p = e.progress!;
  p.atShrine = null;
  delete p.phone;
  const { x, z } = stone.tf.pos;
  ctx.events.push({ type: 'travel', entity: e.id, x: x + SHRINE_ARRIVE_OFFSET, z: z + SHRINE_ARRIVE_OFFSET, shrine });
}

/** God mode only: straight to world (x, z). */
export function godWarp(ctx: TravelCtx, e: Entity, x: number, z: number): void {
  if (!e.progress?.god) return refuse(ctx, e, 'Only in god mode.', 'godWarp');
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  ctx.events.push({ type: 'travel', entity: e.id, x, z });
}

/** The Brick Phone is in this player's hand: Light attack opens it and never swings (SimWorld strips it). */
export const wieldsPhone = (e: Readonly<Entity>): boolean => e.progress?.equipment.staff === TRAVEL_DEVICE;

/**
 * Light attack with the phone in hand: the phone opens (a menu, so the tick goes idle). Mid-roll or
 * mid-swing too: whatever you were doing plays out on its own under the menu, as at a shrine.
 */
export function openPhone(ctx: TravelCtx, e: Entity): boolean {
  const p = e.progress;
  if (!p || !wieldsPhone(e) || e.combat?.action?.kind === 'dead') return false;
  p.phone = true;
  ctx.events.push({ type: 'phoneOpen', entity: e.id });
  return true;
}
