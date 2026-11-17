import type { EntityId } from './entity';
import type { Vec3 } from './math';

/** Things that happened this tick, for presentation (audio, FX, camera, rumble) and for quests. */
export type SimEvent =
  | { type: 'jump'; entity: EntityId }
  | { type: 'land'; entity: EntityId; fallSpeed: number; pos: Vec3 }
  | { type: 'spawn'; entity: EntityId };
