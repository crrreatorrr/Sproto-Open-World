import type { DamageKind } from '../content/combat';
import type { Affinity } from '../content/enemies';
import type { SpellId } from '../content/spells';
import type { StatusId } from '../content/statuses';
import type { EntityId } from './entity';
import type { Vec3 } from './math';

/** A melee hit that earned something extra. */
export type MeleeStrike = 'breakCrit' | 'backstab';

/** A C3 power's moment, for its visuals and sound. */
export type PowerFxId =
  | 'ward' | 'wardReflect' | 'wardBlock' | 'snareRoot' | 'swarm' | 'wall' | 'wallStun' | 'wallEnd' | 'vine' | 'bloom'
  | 'emberStart' | 'emberPulse' | 'surgeReady' | 'surge';

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
      /** A shot the player parried back. `source` is the enemy move that fired it. */
      reflected?: boolean;
      source?: string;
      /** It landed on a weak spot (expansion plan §3.3). */
      weakSpot?: boolean;
      /** The first melee hit on a broken enemy, or a melee hit from behind. */
      strike?: MeleeStrike;
    }
  | { type: 'block'; attacker: EntityId; target: EntityId; damage: number; guardBreak: boolean; pos: Vec3 }
  /** `stun`: ticks the attacker is stunned for (absent when nothing was: a projectile, a far-off blast). */
  | { type: 'parry'; attacker: EntityId; target: EntityId; projectile: boolean; pos: Vec3; stun?: number }
  | { type: 'dodgePerfect'; entity: EntityId; attacker: EntityId }
  | { type: 'dodge'; entity: EntityId }
  | { type: 'noStamina'; entity: EntityId }
  | { type: 'stagger'; entity: EntityId; ticks: number; reason?: 'parried' }
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
  /** `to` / `target`: where a vine goes. `radius`: a patch's or a wave's reach. */
  | { type: 'power'; fx: PowerFxId; entity: EntityId; pos: Vec3; to?: Vec3; target?: EntityId; radius?: number }
  | { type: 'status'; entity: EntityId; status: StatusId; stacks: number; affinity: Affinity }
  | { type: 'statusEnd'; entity: EntityId; status: StatusId }
  | { type: 'frozen'; entity: EntityId; ticks: number }
  | { type: 'interrupt'; entity: EntityId; by: EntityId }
  | { type: 'blink'; entity: EntityId; from: Vec3; to: Vec3 }
  /** Charged Bolt: a pulse while the charge grows; `frac` is how full it is (0..1). */
  | { type: 'boltCharge'; entity: EntityId; frac: number }
  /** A plunge attack hit the ground at `pos`; `hits` is how many enemies it caught. */
  | { type: 'plunge'; entity: EntityId; pos: Vec3; radius: number; hits: number }
  | { type: 'wave'; wave: number; loop: number; enemies: number }
  | { type: 'waveClear'; wave: number }
  // RPG systems (M3).
  | { type: 'xp'; entity: EntityId; amount: number; total: number }
  /** `points`: skill points this level-up gave. */
  | { type: 'levelUp'; entity: EntityId; level: number; points: number }
  | { type: 'itemGained'; entity: EntityId; item: string; count: number; keepsake?: { kind: 'relic' | 'totem'; first: boolean; text: string } }
  | { type: 'relicEquipped'; entity: EntityId; item: string | null; socket: number }
  | { type: 'totemEquipped'; entity: EntityId; item: string | null; swapped: boolean }
  | { type: 'totemPlaced'; entity: EntityId; item: string; pos: Vec3 }
  | { type: 'currency'; entity: EntityId; amount: number; total: number }
  | { type: 'equip'; entity: EntityId; item: string; slot: 'staff' | 'robe' | 'charm' }
  | { type: 'bought'; entity: EntityId; merchant: string; item: string; price: number }
  | { type: 'refused'; entity: EntityId; action: string; reason: string }
  | { type: 'drink'; entity: EntityId; charges: number }
  | { type: 'pickup'; entity: EntityId; kind: 'sprouts' | 'heart' | 'item'; item?: string; amount: number }
  | { type: 'mount'; entity: EntityId; mount: EntityId; phase: 'start' | 'seated' | 'dismount' | 'off' }
  /** A called bull: `entity` is the player who called it. */
  | { type: 'mountCall'; entity: EntityId; mount: EntityId; phase: 'coming' | 'appeared' | 'arrived' | 'failed' }
  | { type: 'interact'; entity: EntityId; object: string; kind: 'shrine' | 'chest' | 'npc' | 'object' | 'portal' }
  /** Travel through a hidden entrance. `portal` is the mouth used; `to` is the mouth arrived at. */
  | { type: 'portalTravel'; entity: EntityId; portal: string; to: string }
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
  | { type: 'cleanse'; entity: EntityId; status: StatusId }
  // Boss fights (M5).
  | { type: 'bossIntro'; boss: EntityId }
  | { type: 'bossPhase'; boss: EntityId; phase: number }
  | { type: 'bossSummon'; boss: EntityId; count: number }
  /** A charge ended in a pillar or the arena wall. */
  | { type: 'bossImpact'; boss: EntityId; pos: Vec3; pillar: boolean }
  | { type: 'bossDefeated'; boss: EntityId }
  | { type: 'rockLand'; pos: Vec3; radius: number }
  | { type: 'gateOpened'; gate: string }
  /**
   * A beat the presentation plays, and that another workstream can hook.
   * `hook` names the thing (the mill seal, a villager's reaction) without putting words in the sim.
   */
  | { type: 'cue'; cue: 'horn' | 'bell' | 'whine' | 'roar' | 'crack' | 'sizzle' | 'coinRing' | 'sealDrop' | 'beanstalkReveal' | 'distantRoar' | 'hum' | 'chord' | 'tremor' | 'react'; entity?: EntityId; pos?: Vec3; frac?: number; hook?: string };
