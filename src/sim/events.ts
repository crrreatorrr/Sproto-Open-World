import type { DamageKind } from '../content/combat';
import type { Affinity } from '../content/enemies';
import type { SpellId } from '../content/spells';
import type { StatusId } from '../content/statuses';
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
  /** `at`/`radius`: an area attack's circle on the ground (else the decal sits under the enemy). */
  | { type: 'telegraph'; entity: EntityId; move: string; ticks: number; unblockable: boolean; decal?: 'circle' | 'jagged'; at?: Vec3; radius?: number }
  | { type: 'fire'; entity: EntityId; projectile: EntityId }
  | { type: 'death'; entity: EntityId; killer: EntityId | null }
  | { type: 'respawn'; entity: EntityId }
  | { type: 'lock'; entity: EntityId; target: EntityId | null }
  /** A spell cast started (wind-up), and when it releases. */
  | { type: 'castStart'; entity: EntityId; spell: SpellId; release: number; woven: boolean }
  | { type: 'cast'; entity: EntityId; spell: SpellId; woven: boolean }
  | { type: 'noMana'; entity: EntityId; spell: SpellId }
  | { type: 'cooldown'; entity: EntityId; spell: SpellId }
  | { type: 'explode'; entity: EntityId; spell: SpellId | null; pos: Vec3; radius: number }
  | { type: 'nova'; entity: EntityId; pos: Vec3; radius: number }
  /** Chain Zap: the points the bolt jumps through (caster's hand first) and who it hit. */
  | { type: 'zap'; entity: EntityId; points: Vec3[]; targets: EntityId[] }
  | { type: 'status'; entity: EntityId; status: StatusId; stacks: number; affinity: Affinity }
  | { type: 'statusEnd'; entity: EntityId; status: StatusId }
  | { type: 'frozen'; entity: EntityId; ticks: number }
  | { type: 'interrupt'; entity: EntityId; by: EntityId }
  | { type: 'blink'; entity: EntityId; from: Vec3; to: Vec3 }
  | { type: 'wave'; wave: number; loop: number; enemies: number }
  | { type: 'waveClear'; wave: number }
  // RPG systems (M3).
  | { type: 'xp'; entity: EntityId; amount: number; total: number }
  /** `points`: skill points this level-up gave. */
  | { type: 'levelUp'; entity: EntityId; level: number; points: number }
  | { type: 'itemGained'; entity: EntityId; item: string; count: number }
  | { type: 'currency'; entity: EntityId; amount: number; total: number }
  | { type: 'equip'; entity: EntityId; item: string; slot: 'staff' | 'robe' | 'charm' }
  | { type: 'bought'; entity: EntityId; merchant: string; item: string; price: number }
  | { type: 'refused'; entity: EntityId; action: string; reason: string }
  | { type: 'drink'; entity: EntityId; charges: number }
  | { type: 'pickup'; entity: EntityId; kind: 'sprouts' | 'heart' | 'item'; item?: string; amount: number }
  | { type: 'mount'; entity: EntityId; mount: EntityId; phase: 'start' | 'seated' | 'dismount' | 'off' }
  | { type: 'interact'; entity: EntityId; object: string; kind: 'shrine' | 'chest' | 'npc' | 'object' }
  | { type: 'trigger'; entity: EntityId; trigger: string }
  | { type: 'talk'; entity: EntityId; npc: string; node: string }
  | { type: 'dialogueEnd'; entity: EntityId; npc: string }
  | { type: 'shrineRest'; entity: EntityId; shrine: string }
  | { type: 'questStarted'; entity: EntityId; quest: string }
  | { type: 'questProgress'; entity: EntityId; quest: string; step: number; progress: number[] }
  | { type: 'questStep'; entity: EntityId; quest: string; step: number }
  | { type: 'questComplete'; entity: EntityId; quest: string }
  | { type: 'spellLearned'; entity: EntityId; spell: string }
  // The loadout and the skill tree (C1).
  | { type: 'spellEquipped'; entity: EntityId; slot: number; spell: string | null; cooldown: number; free: boolean }
  | { type: 'skillSpent'; entity: EntityId; skill: string; rank: number }
  | { type: 'skillPoints'; entity: EntityId; amount: number; total: number }
  | { type: 'skillsReset'; entity: EntityId; refunded: number; cost: number }
  | { type: 'perk'; entity: EntityId; perk: string }
  | { type: 'cleanse'; entity: EntityId; status: StatusId };
