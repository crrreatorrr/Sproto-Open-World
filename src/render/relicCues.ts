/**
 * What the view reads off a player to draw relic cues. Render may not import sim/systems, so this
 * stays next to the views and only looks at plain entity fields.
 */
import { relicMods, totemMods } from '../content/relics';
import type { Entity } from '../sim/entity';

const coop = (entities: readonly Entity[]): boolean => entities.filter((e) => e.kind === 'player').length > 1;

export const oracleEquipped = (entities: readonly Entity[]): boolean =>
  entities.some((e) => e.kind === 'player' && relicMods(e.progress?.relics?.sockets ?? [], false).oracle);

export function decalLead(entities: readonly Entity[], at: { x: number; z: number }): number {
  let lead = 0;
  for (const e of entities) {
    const placed = e.placedTotem;
    if (!placed || placed.id !== 'totem_earthspeaker_stake') continue;
    if (Math.hypot(at.x - placed.x, at.z - placed.z) <= 12) lead = Math.max(lead, totemMods(placed.id, coop(entities)).decalLead);
  }
  return lead;
}

export const lanternShimmer = (e: Entity, now: number, at: { x: number; z: number }, range = 40): boolean => {
  const run = e.relicRun;
  if (!run?.lanternAt || now >= run.lanternUntil) return false;
  return Math.hypot(at.x - run.lanternAt.x, at.z - run.lanternAt.z) <= range;
};
