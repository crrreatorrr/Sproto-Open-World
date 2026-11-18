import type { Entity } from '../../sim/entity';

/** An enemy gets a view inside this flat distance of the local player (m). */
export const VIEW_MAKE_RANGE = 120;
/** An enemy's view goes beyond this one: the gap keeps a view from flickering at the edge. */
export const VIEW_DROP_RANGE = 150;
/** A dead camp enemy's view goes after this many ticks (its corpse has sunk and faded by then). */
export const CORPSE_TICKS = 180;

/**
 * Should this entity be drawn this frame? About 60 camp enemies exist across the map from the first
 * tick, so enemies are drawn only near the local player. Anything not yet set down on the ground
 * (`settle`) waits. Villagers, interactables and projectiles are always drawn once settled.
 */
export function wantsView(e: Readonly<Entity>, player: Readonly<Entity> | undefined, hasView: boolean): boolean {
  if (e.settle) return false;
  // Gate barriers and a boss's pillars are drawn only near the player too.
  if (!e.brain && !e.obstacle) return true;
  const a = e.combat?.action;
  if (e.brain?.camp && a?.kind === 'dead' && a.t > CORPSE_TICKS) return false;
  if (!player) return true;
  const range = hasView ? VIEW_DROP_RANGE : VIEW_MAKE_RANGE;
  const dx = e.tf.pos.x - player.tf.pos.x, dz = e.tf.pos.z - player.tf.pos.z;
  return dx * dx + dz * dz <= range * range;
}
