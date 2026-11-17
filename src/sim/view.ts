import type { Entity, EntityId, PlayerId } from './entity';
import type { SimEvent } from './events';
import type { Vec3 } from './math';
import type { RayHit } from './physics/PhysicsWorld';

/**
 * What render, camera and UI may see of the sim (plan §2.1): state and read-only queries. They
 * change gameplay only by sending commands. tests/architecture.test.ts checks they never import
 * SimWorld itself.
 */
export interface ReadonlySimView {
  /** Ticks simulated so far. */
  readonly now: number;
  readonly entities: readonly Readonly<Entity>[];
  /** Events from the most recent tick. */
  readonly events: readonly SimEvent[];
  get(id: EntityId): Readonly<Entity> | undefined;
  /** The entity a player controls, if spawned. */
  playerEntity(player: PlayerId): Readonly<Entity> | undefined;
  raycast(origin: Readonly<Vec3>, dir: Readonly<Vec3>, maxDist: number): RayHit | null;
  /** Sweep a sphere along `dir` (its length is the distance). */
  sphereCast(origin: Readonly<Vec3>, dir: Readonly<Vec3>, radius: number): { distance: number } | null;
  hash(): number;
}
