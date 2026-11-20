/**
 * Quests (plan §5). The quest runtime (src/sim/systems/quests.ts) matches each tick's events
 * against the active step's objectives and applies effects in the sim. Pure data.
 */
import { C4_QUESTS } from './packs/c4';
import { C5_QUESTS } from './packs/c5';
import { C6_QUESTS } from './packs/c6';
import { registerScrapjawQuest } from './packs/m5';
import { ROOTDEEP_QUESTS } from './packs/rootdeep';
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
  | { kind: 'interact'; object: string }
  /**
   * Do a combat feat `count` times: land a heavy, perfect-dodge an attack, parry one (M4 drills),
   * or fell something with a reflected shot (`reflectKill`). `against` limits it to that enemy.
   * `sourceMove` is the enemy move the shot came from. `fatal` counts only the shot that kills.
   * `perFight` resets the count when that fight ends short of `count`.
   */
  | { kind: 'feat'; feat: 'heavyHit' | 'perfectDodge' | 'parry' | 'reflectKill'; count: number; against?: string; sourceMove?: string; fatal?: boolean; perFight?: boolean };

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
  /** The player has reached this level. */
  | { level: number }
  /** The player has finished this quest. */
  | { questDone: string }
  | { not: Condition };

export type QuestStatus = 'locked' | 'available' | 'active' | 'complete';

export interface QuestStep {
  id: string;
  text: string;
  objectives: Objective[];
  /** Where the compass marker points (a trigger, npc or object id), if anywhere. */
  marker?: string;
  /**
   * A side-quest search found in the world, so the compass stays dark: footprints, a chest shimmer,
   * a scorch trail, or a pumpkin on a Grunt's head.
   */
  clue?: 'footprints' | 'shimmer' | 'scorch' | 'carriers';
  onComplete?: Effect[];
  /**
   * A side goal that does not gate the step. Meeting it once sets `flag` (workstream B grants the item).
   * Only on enemies that come back, so a miss can be retried.
   */
  bonus?: { flag: string; objective: Objective };
}

export interface QuestDef {
  id: string;
  title: string;
  giver: string;
  kind: 'main' | 'side';
  /**
   * Subtle quest-log hint for the relic or totem this quest awards.
   * Absent when the quest awards nothing new. The silhouette UI is workstream B.
   */
  clue?: string;
  prereq?: Condition[];
  steps: QuestStep[];
  rewards: Effect[];
}

/** A quest the player can take right now, and who gives it. */
export interface QuestOffer {
  quest: string;
  npc: string;
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
      { id: 'shrine', text: 'Rest at the Shrine of First Light.', objectives: [{ kind: 'interact', object: 'shrine_first_light' }], marker: 'shrine_first_light', onComplete: [{ give: 'totem_elders_hearth' }] },
    ],
    rewards: [{ xp: 60 }, { currency: 20 }],
  },

  // ---- M4: the main chain "The Scrap Rumble" (plan §6.2) ----
  q_pest_control: {
    id: 'q_pest_control',
    title: 'Pest Control',
    giver: 'elder_pepe',
    kind: 'main',
    prereq: [{ quest: 'q_wake_up', status: 'complete' }],
    steps: [
      { id: 'orchard', text: 'Go west to the Orchard Fields.', objectives: [{ kind: 'reach', trigger: 'orchard_fields' }], marker: 'orchard_fields' },
      { id: 'grunts', text: 'Drive off the Grunts in the Orchard.', objectives: [{ kind: 'kill', tag: 'grunt', count: 8 }], marker: 'orchard_fields', onComplete: [{ give: 'totem_field_warden' }] },
      { id: 'farmer', text: 'Tell Farmer Broccoli the fields are clear.', objectives: [{ kind: 'talk', npc: 'farmer_broccoli', node: 'pest_done' }], marker: 'farmer_broccoli' },
    ],
    rewards: [{ learnSpell: 'blast' }, { xp: 180 }, { currency: 40 }],
  },
  q_watchtower: {
    id: 'q_watchtower',
    title: 'Light the Watchtower',
    giver: 'captain_agent',
    kind: 'main',
    prereq: [{ quest: 'q_pest_control', status: 'complete' }],
    steps: [
      { id: 'parry', text: 'Parry the swinging dummy in the training yard (block just as it hits).', objectives: [{ kind: 'feat', feat: 'parry', count: 1 }], marker: 'training_yard' },
      { id: 'hill', text: 'Climb Watchtower Hill.', objectives: [{ kind: 'reach', trigger: 'watchtower_hill' }], marker: 'watchtower_hill' },
      {
        id: 'slingers', text: 'Defeat the Coin Slingers on the hill.', objectives: [{ kind: 'kill', tag: 'slinger', count: 5 }], marker: 'watchtower_hill',
        bonus: { flag: 'bonus.q_watchtower.reflect', objective: { kind: 'feat', feat: 'reflectKill', count: 3, against: 'slinger', sourceMove: 'coinBurst' } },
      },
      { id: 'beacon', text: 'Light the beacon.', objectives: [{ kind: 'interact', object: 'watchtower_beacon' }], marker: 'watchtower_beacon' },
      { id: 'rest', text: 'Rest at the Watchtower Shrine.', objectives: [{ kind: 'interact', object: 'shrine_watchtower' }], marker: 'shrine_watchtower' },
    ],
    rewards: [{ give: 'robe_warden' }, { xp: 300 }, { currency: 60 }],
  },
  q_thornwood: {
    id: 'q_thornwood',
    title: 'Thornwood Tracks',
    giver: 'captain_agent',
    kind: 'main',
    prereq: [{ quest: 'q_watchtower', status: 'complete' }],
    steps: [
      { id: 'clearing', text: 'Follow the tracks to the clearing in the Thornwood.', objectives: [{ kind: 'reach', trigger: 'thornwood_clearing' }], marker: 'thornwood_clearing' },
      {
        id: 'gatekeeper', text: 'Defeat the Gatekeeper.', objectives: [{ kind: 'kill', tag: 'gatekeeper', count: 1 }], marker: 'thornwood_clearing',
        // The key and the robe are given, not dropped: a drop could fade before you pick it up, and
        // the Gatekeeper never comes back.
        onComplete: [{ give: 'quarry_key' }, { give: 'robe_quarryproof' }, { give: 'relic_gatekeepers_grip' }],
      },
      { id: 'key', text: 'Take the Quarry Key.', objectives: [{ kind: 'collect', item: 'quarry_key', count: 1 }], marker: 'thornwood_clearing' },
    ],
    rewards: [{ xp: 450 }, { setFlag: 'gate.quarry.key' }, { give: 'relic_drowned_coins' }],
  },

  // ---- M4: side quests (plan §6.3) ----
  q_pumpkins: {
    id: 'q_pumpkins',
    title: 'Pumpkin Thieves',
    giver: 'farmer_broccoli',
    kind: 'side',
    steps: [
      { id: 'pumpkins', text: 'Take back 5 Stolen Pumpkins from the Orchard Grunts.', clue: 'carriers', objectives: [{ kind: 'collect', item: 'stolen_pumpkin', count: 5, consume: true }] },
      { id: 'return', text: 'Bring the pumpkins to Farmer Broccoli.', objectives: [{ kind: 'talk', npc: 'farmer_broccoli', node: 'pumpkins_done' }], marker: 'farmer_broccoli' },
    ],
    rewards: [{ give: 'staff_gourd' }, { currency: 120 }, { xp: 80 }],
  },
  q_mill: {
    id: 'q_mill',
    title: "The Mill's Racket",
    giver: 'miller_pepe',
    kind: 'side',
    steps: [
      { id: 'mill', text: 'Go to the Old Mill across the river.', objectives: [{ kind: 'reach', trigger: 'mill' }], marker: 'mill' },
      { id: 'coin', text: 'Defeat Big Coin.', objectives: [{ kind: 'kill', tag: 'big_coin', count: 1 }], marker: 'mill' },
      // Pulling it shakes Tinubu's Broken Seal out of the wheel: the `hook.tinubu_seal` flag grants it (sim/systems/relics.ts).
      { id: 'lever', text: 'Pull the mill lever.', objectives: [{ kind: 'interact', object: 'mill_lever' }], marker: 'mill_lever' },
    ],
    rewards: [{ learnSpell: 'chainZap' }, { xp: 200 }, { currency: 50 }],
  },
  q_relics: {
    id: 'q_relics',
    title: 'Lost Relics',
    giver: 'collector_pepe',
    kind: 'side',
    steps: [
      {
        id: 'relics', text: 'Find the three relic chests: by the mill waterfall, under the Thornwood root arch, at the Beanstalk.',
        clue: 'shimmer',
        objectives: [{ kind: 'interact', object: 'relic_mill' }, { kind: 'interact', object: 'relic_rootarch' }, { kind: 'interact', object: 'relic_beanstalk' }],
      },
      { id: 'return', text: 'Tell Collector Pepe what you found.', objectives: [{ kind: 'talk', npc: 'collector_pepe', node: 'relics_done' }], marker: 'collector_pepe', onComplete: [{ give: 'totem_seekers_lantern' }] },
    ],
    rewards: [{ give: 'staff_moonward' }, { give: 'charm_scholars_knot' }, { xp: 300 }],
  },
};

Object.assign(QUESTS, C4_QUESTS);
Object.assign(QUESTS, C5_QUESTS);
Object.assign(QUESTS, C6_QUESTS);
Object.assign(QUESTS, ROOTDEEP_QUESTS);
registerScrapjawQuest(QUESTS);

/**
 * Quest-log clue lines. Each one is the relic or totem card's clue, so the log and the card agree.
 * The three bonus closings (elder_pepe.after_tower_myth, ranger_moss.after_myth, watch_captain.a3_rivet)
 * ask hasItem; a keepsake in relics.owned counts.
 */
export const QUEST_CLUES: Record<string, string> = {
  q_wake_up: 'The first fire you rest beside keeps a seat.',
  q_pest_control: "Something in the orchard holds the small ones' gaze.",
  q_watchtower: 'A watchman once kept something under the bell.',
  q_thornwood: 'The hand that held the wood shut left something behind.',
  q_mill: "The mill wheel once held a tyrant's mark.",
  q_relics: 'The valley hid a light for what sits in plain sight.',
  q_rivet_volley: 'A stone in the salvage yard turns a shot around.',
  q_lens_flare: 'The ridge glass still looks a moment ahead.',
  q_iron_gallery: 'Struck iron from the old camps answers back.',
  q_hollow_giant: 'The giant prints remember a lighter step.',
  q_weavers_thorns: "The weaver's hedge keeps a living cuff.",
  q_elders_garden: 'The garden stones remember a seed for the road.',
  q_tremors: 'The quarry crew left a stake that hears the ground.',
  q_deep_seam: 'The deep earth breathes for those who listen.',
  q_scrapjaw: 'Something green slept in the beast under the quarry.',
  q_smoke_hills: 'Smoke on the hills left a pail that puts fire out.',
  q_bait: 'An ugly little post still brings flyers down to look.',
  q_skyfire: 'What fell out of the sky still softens a landing.',
};

for (const [id, clue] of Object.entries(QUEST_CLUES)) if (QUESTS[id]) QUESTS[id].clue = clue;
