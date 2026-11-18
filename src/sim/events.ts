import type { DamageKind } from '../content/combat';
import type { Affinity } from '../content/enemies';
import type { EntityId } from './entity';
import type { Vec3 } from './math';

/** Things that happened this tick, for presentation (audio, FX, camera, rumble) and for quests. */
export type SimEvent =
  | { type: 'jump'; entity: EntityId }
  | { type: 'land'; entity: EntityId; fallSpeed: number; pos: Vec3 }
  | { type: 'spawn'; entity: EntityId }
  /** An attack's first active tick (staff whoosh, enemy swing). */
  | { type: 'swing'; entity: EntityId; move: string; heavy: boolean }
  | {
      type: 'hit';
      attacker: EntityId;
      target: EntityId;
      move: string;
      damage: number;
      kind: DamageKind;
      affinity: Affinity;
      crit: boolean;
      heavy: boolean;
      pos: Vec3;
      hitstop: number;
    }
  | { type: 'block'; attacker: EntityId; target: EntityId; damage: number; guardBreak: boolean; pos: Vec3 }
  | { type: 'parry'; attacker: EntityId; target: EntityId; projectile: boolean; pos: Vec3 }
  | { type: 'dodgePerfect'; entity: EntityId; attacker: EntityId }
  | { type: 'dodge'; entity: EntityId }
  | { type: 'noStamina'; entity: EntityId }
  | { type: 'stagger'; entity: EntityId; ticks: number }
  | { type: 'telegraph'; entity: EntityId; move: string; ticks: number; unblockable: boolean; decal?: 'circle' | 'jagged' }
  | { type: 'fire'; entity: EntityId; projectile: EntityId }
  | { type: 'death'; entity: EntityId; killer: EntityId | null }
  | { type: 'respawn'; entity: EntityId }
  | { type: 'lock'; entity: EntityId; target: EntityId | null };
