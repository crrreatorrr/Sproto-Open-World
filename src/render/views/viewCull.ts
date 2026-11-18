import type { Entity } from '../../sim/entity';

/** An enemy gets a view inside this flat distance of the local player (m). */
export const VIEW_MAKE_RANGE = 120;
/** An enemy's view goes beyond this one: the gap keeps a view from flickering at the edge. */
export const VIEW_DROP_RANGE = 150;
/** A dead camp enemy's view goes after this many ticks (its corpse has sunk and faded by then). */
export const CORPSE_TICKS = 180;
/** An enemy casts a shadow inside this flat distance of the local player (m); farther, nobody can tell. */
export const SHADOW_ON_RANGE = 35;
/** It stops beyond this one: the gap keeps a shadow from flickering at the edge. */
export const SHADOW_OFF_RANGE = 42;
/** Bodies taller than this (m) stay drawn and shadowed further out: a giant is seen from further away. */
const TALL_FROM = 3;
/** ...up to this many times the usual distance. */
const TALL_REACH = 1.25;

/** How much further than usual this body is worth drawing. */
const reachFor = (e: Readonly<Entity>): number => Math.min(TALL_REACH, Math.max(1, (e.body?.height ?? 0) / TALL_FROM));

/**
 * Should this entity be drawn this frame? About 60 camp enemies exist across the map from the first
 * tick, so enemies are drawn only near the local player. Anything not yet set down on the ground
 * (`settle`) waits. Villagers, interactables and projectiles are always drawn once settled.
 */
export function wantsView(e: Readonly<Entity>, player: Readonly<Entity> | undefined, hasView: boolean): boolean {
  if (e.settle) return false;
  // The Skyfire Drake isn't in the world until the bait brings it down (and its model stays unloaded).
  if (e.view.model === 'drake' && e.boss?.state === 'idle') return false;
  // Gate barriers and a boss's pillars are drawn only near the player too.
  if (!e.brain && !e.obstacle) return true;
  const a = e.combat?.action;
  if (e.brain?.camp && a?.kind === 'dead' && a.t > CORPSE_TICKS) return false;
  if (!player) return true;
  const range = (hasView ? VIEW_DROP_RANGE : VIEW_MAKE_RANGE) * reachFor(e);
  const dx = e.tf.pos.x - player.tf.pos.x, dz = e.tf.pos.z - player.tf.pos.z;
  return dx * dx + dz * dz <= range * range;
}

/**
 * Should this enemy cast a shadow? A skinned body is drawn again for the shadow map, which made up
 * most of the shadow pass with a camp in view. Bosses always do: they're the size of the arena.
 */
export function castsShadow(e: Readonly<Entity>, player: Readonly<Entity> | undefined, was: boolean): boolean {
  if (e.boss || !player) return true;
  const range = (was ? SHADOW_OFF_RANGE : SHADOW_ON_RANGE) * reachFor(e);
  const dx = e.tf.pos.x - player.tf.pos.x, dz = e.tf.pos.z - player.tf.pos.z;
  return dx * dx + dz * dz <= range * range;
}
