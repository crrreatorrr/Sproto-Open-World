/**
 * Quests (plan §5). The quest runtime (src/sim/systems/quests.ts) matches each tick's events
 * against the active step's objectives and applies effects in the sim. Pure data.
 */
import type { SpellId } from './spells';

export type Objective =
  /** Kill `count` enemies whose def id (or tag) is `tag`. */
  | { kind: 'kill'; tag: string; count: number }
  /** Hold `count` of `item`; `consume` takes them when the step completes. */
  | { kind: 'collect'; item: string; count: number; consume?: boolean }
  /** Talk to `npc` (reaching dialogue node `node`, if given). */
  | { kind: 'talk'; npc: string; node?: string }
  /** Stand in trigger volume `trigger`. */
  | { kind: 'reach'; trigger: string }
  /** Interact with object `object` (a chest, a shrine, a lever). */
  | { kind: 'interact'; object: string };

export type Effect =
  | { give: string; count?: number }
  | { xp: number }
  | { learnSpell: SpellId }
  | { setFlag: string; value?: number }
  | { startQuest: string }
  | { currency: number }
  /** Open a merchant's shop (dialogue). */
  | { openShop: string }
  /** For M4/M5: spawn a unique enemy, open a gate. Recorded as flags until then. */
  | { spawnUnique: string }
  | { openGate: string }
  /** Skill points (each boss gives one, expansion plan §7.1). */
  | { skillPoints: number };

export type Condition =
  | { quest: string; status: QuestStatus; step?: number }
  | { flag: string; value?: number }
  | { hasItem: string; count?: number }
  | { not: Condition };

export type QuestStatus = 'locked' | 'available' | 'active' | 'complete';

export interface QuestStep {
  id: string;
  text: string;
  objectives: Objective[];
  /** Where the compass marker points (a trigger, npc or object id), if anywhere. */
  marker?: string;
  onComplete?: Effect[];
}

export interface QuestDef {
  id: string;
  title: string;
  giver: string;
  kind: 'main' | 'side';
  prereq?: Condition[];
  steps: QuestStep[];
  rewards: Effect[];
}

/** Progress per objective of the current step; `step` = steps.length when complete. */
export interface QuestState {
  status: QuestStatus;
  step: number;
  progress: number[];
}

export const QUESTS: Record<string, QuestDef> = {
  // M3's test quest in the village: all five objective kinds (plan M3 acceptance 1). It becomes
  // M1 "Wake Up, Sproto" in M4.
  q_wake_up: {
    id: 'q_wake_up',
    title: 'Wake Up, Sproto',
    giver: 'elder_pepe',
    kind: 'main',
    steps: [
      { id: 'yard', text: 'Head to the training yard north of the Elder.', objectives: [{ kind: 'reach', trigger: 'training_yard' }], marker: 'training_yard' },
      { id: 'dummies', text: 'Break three straw dummies.', objectives: [{ kind: 'kill', tag: 'dummy_straw', count: 3 }], marker: 'training_yard' },
      { id: 'chest', text: 'Open the old chest by the yard.', objectives: [{ kind: 'interact', object: 'chest_training' }], marker: 'chest_training' },
      {
        id: 'seed', text: 'Bring the Sprout Seed to Elder Pepe.', marker: 'elder_pepe',
        objectives: [{ kind: 'collect', item: 'sprout_seed', count: 1, consume: true }, { kind: 'talk', npc: 'elder_pepe', node: 'seed_return' }],
      },
      { id: 'shrine', text: 'Rest at the Shrine of First Light.', objectives: [{ kind: 'interact', object: 'shrine_first_light' }], marker: 'shrine_first_light' },
    ],
    rewards: [{ xp: 60 }, { currency: 20 }],
  },
};
