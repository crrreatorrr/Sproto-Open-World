import type { Entity, EntityId, PlayerId, WorldState } from './entity';
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
  /** Cells whose colliders must stay loaded (players' 3 × 3, fighting or leashing enemies' own cell). */
  cellAnchors(): [number, number][];
  /** That cell's colliders are built (always true on a level with a ground plane). */
  cellReady(cx: number, cz: number): boolean;
  /** The player stands over a cell without colliders and is held still: show the loading veil. */
  readonly waitingForGround: boolean;
  /** World flags, opened chests, killed uniques (M3). */
  readonly world: Readonly<WorldState>;
  /**
   * What the player would interact with if they pressed Interact now (nearest in reach and in
   * front): an NPC to talk to, a shrine to rest at, a chest to open. Null when nothing is in reach.
   */
  interactTarget(player: PlayerId): { entity: EntityId; id: string; kind: 'npc' | 'shrine' | 'chest' | 'object'; name: string } | null;
  /** The choices on the player's current dialogue node that pass their conditions (index = what to send). */
  dialogueChoices(player: PlayerId): { index: number; text: string }[];
  /** Where a content id is (an NPC, shrine, chest or trigger), for quest markers and the compass. */
  locate(id: string): Vec3 | null;
  /** The wave runner's state (`?sandbox=1`), or null. */
  readonly wave: Readonly<{ index: number; loop: number; enemiesLeft: number; nextIn: number }> | null;
}
