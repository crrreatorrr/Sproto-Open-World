/**
 * Dialogue graphs (plan §5). The sim owns the cursor: the UI shows `player.dialogue.node` and sends
 * `dialogueChoose`; the sim checks conditions and applies effects. Strings live here, keyed, for
 * later localization.
 */
import { C4_DIALOGUE, C4_DIALOGUE_PATCHES } from './packs/c4';
import { registerC5Dialogue } from './packs/c5';
import { registerDrakeDialogue } from './packs/c6';
import { registerScrapjawDialogue } from './packs/m5';
import { WEAPON_BOX_SHOPS } from './packs/overworldMix';
import { registerRootdeepDialogue } from './packs/rootdeep';
import type { Condition, Effect } from './quests';

export interface DialogueChoice {
  text: string;
  next?: string;
  if?: Condition[];
  do?: Effect[];
}

export interface DialogueNode {
  speaker: string;
  text: string;
  /** Effects applied when the node is reached. */
  do?: Effect[];
  choices?: DialogueChoice[];
  /** Continue to this node (no choices). No `next` and no choices ends the talk. */
  next?: string;
}

export interface DialogueGraph {
  id: string;
  /** The first rule whose conditions all pass picks the entry node. */
  entry: { if?: Condition[]; node: string }[];
  nodes: Record<string, DialogueNode>;
}

/**
 * Text-box limit. A line past this is two nodes (plan default; pending owner decision).
 * One constant, so the split can move if the box changes.
 */
export const DIALOGUE_LINE_LIMIT = 150;

/** Optional boss barks from the plan. Nothing speaks these yet; workstream C hooks them. */
export const QUEST_BOSS_BARKS = {
  gatekeeper: 'NO KEY. NO EXIT.',
  big_coin: 'YOU WILL NOT MOVE ME.',
} as const;

export const DIALOGUE: Record<string, DialogueGraph> = {
  elder_pepe: {
    id: 'elder_pepe',
    entry: [
      // TODO(workstream-b): after_tower_myth stays hidden until the player owns relic_drowned_coins.
      { if: [{ quest: 'q_watchtower', status: 'complete' }, { hasItem: 'relic_drowned_coins' }], node: 'after_tower_myth' },
      { if: [{ quest: 'q_watchtower', status: 'complete' }], node: 'after_tower' },
      { if: [{ quest: 'q_pest_control', status: 'complete' }], node: 'after' },
      { if: [{ quest: 'q_pest_control', status: 'active' }], node: 'pest_busy' },
      // Said once, then the Pest Control offer. Later jobs above this still answer first.
      { if: [{ quest: 'q_wake_up', status: 'complete' }, { not: { flag: 'dialogue.q_wake_up.after' } }], node: 'wake_after' },
      { if: [{ quest: 'q_wake_up', status: 'complete' }], node: 'pest_offer' },
      { if: [{ quest: 'q_wake_up', status: 'active', step: 3 }], node: 'seed_return' },
      { if: [{ quest: 'q_wake_up', status: 'active', step: 4 }], node: 'seed_thanks' },
      { if: [{ quest: 'q_wake_up', status: 'active' }], node: 'busy' },
      { node: 'intro' },
    ],
    nodes: {
      intro: { speaker: 'Elder Pepe', text: "Ah, Sproto. You slept through the whole harvest. Scrap's been rumbling up at the quarry, and I need you sharp.", next: 'intro2' },
      intro2: {
        speaker: 'Elder Pepe',
        text: 'The training yard is just north. Break three straw dummies, then see what is in the old chest beside them.',
        choices: [
          { text: "I'm on it.", do: [{ startQuest: 'q_wake_up' }] },
          { text: 'Maybe later.' },
        ],
      },
      busy: { speaker: 'Elder Pepe', text: 'The yard is just north of here. Go on, the dummies will not break themselves.' },
      seed_return: { speaker: 'Elder Pepe', text: 'A Sprout Seed! The old chest still had one. Good. Plant it in your heart, as my mother said.', next: 'seed_thanks' },
      seed_thanks: { speaker: 'Elder Pepe', text: 'Now rest at the Shrine of First Light. Shrines heal you, refill your tonics and let you grow stronger.' },
      pest_offer: {
        speaker: 'Elder Pepe',
        text: "Grunts are trampling the Orchard to the west. Farmer Broccoli can't harvest a thing. Clear them out for her?",
        choices: [
          { text: 'Leave it to me.', do: [{ startQuest: 'q_pest_control' }] },
          { text: 'Not yet.' },
        ],
      },
      pest_busy: { speaker: 'Elder Pepe', text: 'The Orchard is west, along the path past the barn. Lock on, keep your combos short, and mind your mana.' },
      after: { speaker: 'Elder Pepe', text: 'Captain Agent at the training yard needs a hand at the Watchtower. And mind the Thornwood.' },
      wake_after: {
        speaker: 'Elder Pepe',
        text: 'You look awake at last. They say the first Sproto slept through a harvest too.',
        do: [{ setFlag: 'dialogue.q_wake_up.after' }],
        next: 'pest_offer',
      },
      after_tower: { speaker: 'Elder Pepe', text: 'The beacon burns again. I can see it from my porch. Captain Agent will know where the road goes from here.' },
      after_tower_myth: { speaker: 'Elder Pepe', text: 'The beacon burns again. Those coins you caught — minted before the mud came. They still know the way home.' },
    },
  },
  captain_agent: {
    id: 'captain_agent',
    entry: [
      { if: [{ quest: 'q_scrapjaw', status: 'complete' }], node: 'after_quarry' },
      { if: [{ quest: 'q_scrapjaw', status: 'active' }], node: 'scrapjaw_busy' },
      // Pending owner decision: offer Scrapjaw here, instead of starting it when Thornwood ends.
      { if: [{ quest: 'q_scrapjaw', status: 'available' }, { not: { flag: 'dialogue.q_thornwood.done' } }], node: 'after' },
      { if: [{ quest: 'q_scrapjaw', status: 'available' }], node: 'scrapjaw_offer' },
      { if: [{ quest: 'q_thornwood', status: 'active' }], node: 'thorn_busy' },
      { if: [{ quest: 'q_watchtower', status: 'complete' }, { not: { flag: 'dialogue.q_watchtower.done' } }], node: 'tower_done' },
      { if: [{ quest: 'q_watchtower', status: 'complete' }], node: 'thorn_offer' },
      { if: [{ quest: 'q_watchtower', status: 'active', step: 0 }], node: 'parry_tip' },
      { if: [{ quest: 'q_watchtower', status: 'active' }], node: 'tower_busy' },
      { if: [{ quest: 'q_pest_control', status: 'complete' }], node: 'tower_offer' },
      { node: 'early' },
    ],
    nodes: {
      early: { speaker: 'Captain Agent', text: 'Elder Pepe has work for you first, recruit. Come back when the Orchard is quiet.' },
      tower_offer: {
        speaker: 'Captain Agent',
        text: "Coin Slingers took Watchtower Hill and the beacon's gone dark. Their coins fly straight, so learn to parry before you climb.",
        choices: [
          { text: 'Teach me.', do: [{ startQuest: 'q_watchtower' }] },
          { text: 'Later.' },
        ],
      },
      parry_tip: { speaker: 'Captain Agent', text: 'Block just as the dummy swings, not before. A parry throws a coin back where it came from, too.' },
      tower_busy: { speaker: 'Captain Agent', text: 'Up the hill, north of the village. Slingers hate it when you close in. Light the beacon, then rest at the shrine.' },
      tower_done: {
        speaker: 'Captain Agent',
        text: 'The beacon shows from here. That was a proper climb, recruit. Keep those coins close.',
        do: [{ setFlag: 'dialogue.q_watchtower.done' }],
        next: 'tower_after',
      },
      tower_after: { speaker: 'Captain Agent', text: 'Still catching what they throw? Good. That habit will feed you.', next: 'thorn_offer' },
      thorn_offer: {
        speaker: 'Captain Agent',
        text: 'The beacon shows tracks into the Thornwood. Something big guards a clearing there, and it has the Quarry Key.',
        next: 'thorn_offer_2',
      },
      thorn_offer_2: {
        speaker: 'Captain Agent',
        text: 'Spells for the Wisps, your staff for the Brutes.',
        choices: [
          { text: "I'll follow them.", do: [{ startQuest: 'q_thornwood' }] },
          { text: 'Not yet.' },
        ],
      },
      thorn_busy: { speaker: 'Captain Agent', text: 'The clearing is past the hill, deep in the Thornwood. Burn works on the big one, I hear.' },
      after: {
        speaker: 'Captain Agent',
        text: 'With that key, the Quarry Gate is yours to open. Rest at the gate shrine first.',
        do: [{ setFlag: 'dialogue.q_thornwood.done' }],
        next: 'thorn_after',
      },
      thorn_after: { speaker: 'Captain Agent', text: 'Hands still steady? Good. The gate does not forgive a flinch.', next: 'scrapjaw_offer' },
      scrapjaw_offer: {
        speaker: 'Captain Agent',
        text: 'Scrapjaw waits in the Old Quarry. A beast of rust and teeth. Parry the bite, then make him pay. Rest at the gate shrine first.',
        choices: [
          { text: "I'll face him.", do: [{ startQuest: 'q_scrapjaw' }] },
          { text: 'Not yet.' },
        ],
      },
      scrapjaw_busy: { speaker: 'Captain Agent', text: "Down through the ravine, past the gate. Don't let him rush you." },
      after_quarry: { speaker: 'Captain Agent', text: 'Scrapjaw, down. I will be telling recruits about that one for years. Keep your guard up, all the same.' },
    },
  },
  farmer_broccoli: {
    id: 'farmer_broccoli',
    entry: [
      { if: [{ quest: 'q_pest_control', status: 'active', step: 2 }], node: 'pest_done' },
      { if: [{ quest: 'q_pumpkins', status: 'active', step: 1 }], node: 'pumpkins_done' },
      { if: [{ quest: 'q_pumpkins', status: 'active' }], node: 'pumpkins_busy' },
      { if: [{ quest: 'q_pumpkins', status: 'complete' }], node: 'after' },
      { node: 'pumpkins_offer' },
    ],
    nodes: {
      pest_done: {
        speaker: 'Farmer Broccoli',
        text: 'The fields are quiet! Bless you. The Elder said you would want this: a spell my grandmother kept for foxes.',
        // Her pumpkins come up only if you haven't already taken that job.
        choices: [
          { text: 'Glad to help.' },
          { text: 'Anything else?', if: [{ quest: 'q_pumpkins', status: 'available' }], next: 'pumpkins_offer' },
        ],
      },
      pumpkins_offer: {
        speaker: 'Farmer Broccoli',
        text: 'Those Grunts ran off with my pumpkins. Five of them, my best. If you see any on a Grunt, take them back?',
        choices: [
          { text: "I'll get them.", do: [{ startQuest: 'q_pumpkins' }] },
          { text: 'Another time.' },
        ],
      },
      pumpkins_busy: { speaker: 'Farmer Broccoli', text: 'Five pumpkins. The Grunts in the Orchard carry them about like trophies.' },
      pumpkins_done: { speaker: 'Farmer Broccoli', text: "All five! Here, take Grandpa's Gourd Staff. It hits like a harvest." },
      after: { speaker: 'Farmer Broccoli', text: 'Pie on Sunday, Sproto. You have earned a slice.' },
    },
  },
  miller_pepe: {
    id: 'miller_pepe',
    entry: [
      { if: [{ quest: 'q_mill', status: 'complete' }, { not: { flag: 'dialogue.q_mill.done' } }], node: 'mill_done' },
      { if: [{ quest: 'q_mill', status: 'complete' }], node: 'after' },
      { if: [{ quest: 'q_mill', status: 'active' }], node: 'busy' },
      { node: 'offer' },
    ],
    nodes: {
      offer: {
        speaker: 'Miller Pepe',
        text: "A great big Coin Slinger moved into my mill and jammed the wheel. Clear him out and pull the lever, and I'll teach you a trick with lightning.",
        choices: [
          { text: "I'll handle it.", do: [{ startQuest: 'q_mill' }] },
          { text: 'Not now.' },
        ],
      },
      busy: { speaker: 'Miller Pepe', text: 'Across the bridge and up the east bank. Big Coin hides behind his friends.' },
      mill_done: {
        speaker: 'Miller Pepe',
        text: "Hear that wheel? Music. That grim seal was stuck in the works. The old folk say it was the tyrant Tinubu's. It will serve you now, and never him.",
        do: [{ setFlag: 'dialogue.q_mill.done' }],
        next: 'after',
      },
      after: { speaker: 'Miller Pepe', text: 'Lightning jumps from one to the next, remember that.' },
    },
  },
  collector_pepe: {
    id: 'collector_pepe',
    entry: [
      { if: [{ quest: 'q_relics', status: 'complete' }], node: 'after' },
      { if: [{ quest: 'q_relics', status: 'active', step: 1 }], node: 'relics_done' },
      { if: [{ quest: 'q_relics', status: 'active' }], node: 'busy' },
      { node: 'offer' },
    ],
    nodes: {
      offer: {
        speaker: 'Collector Pepe',
        text: 'Three relic chests, lost in the valley: one by the mill waterfall, one under the Thornwood root arch, one at the foot of the Beanstalk.',
        next: 'offer_ask',
      },
      offer_ask: {
        speaker: 'Collector Pepe',
        text: 'Find them for me?',
        choices: [
          { text: 'A treasure hunt? Yes.', do: [{ startQuest: 'q_relics' }] },
          { text: 'Maybe later.' },
        ],
      },
      busy: { speaker: 'Collector Pepe', text: 'The mill waterfall, the root arch, the Beanstalk. Three chests, three relics.' },
      relics_done: { speaker: 'Collector Pepe', text: 'All three! As promised: the Moonward staff, and a knot that makes woven spells sing.', next: 'relics_lantern' },
      // TODO(workstream-b): grant totem_seekers_lantern with the staff and the knot. The line names it; the item is not in the game yet.
      relics_lantern: { speaker: 'Collector Pepe', text: 'And this lantern, for the next thing the valley hid in plain sight.' },
      after: { speaker: 'Collector Pepe', text: 'My collection is complete. Well. For now.' },
    },
  },
  merchant_village: {
    id: 'merchant_village',
    entry: [{ node: 'hello' }],
    nodes: {
      hello: {
        speaker: 'Trader Pepe',
        text: 'Sprouts for steel, friend. Or wood. Mostly wood.',
        choices: [{ text: 'Show me your wares.', do: [{ openShop: 'merchant_village' }] }, { text: 'Not today.' }],
      },
    },
  },
};

Object.assign(DIALOGUE, C4_DIALOGUE);
// A pack's additions to an existing graph: the first passing entry rule wins, so where they go matters.
for (const patch of C4_DIALOGUE_PATCHES) {
  const graph = DIALOGUE[patch.graph];
  graph.entry.splice(graph.entry.findIndex((r) => r.node === patch.before), 0, ...patch.entry);
  Object.assign(graph.nodes, patch.nodes);
}
registerScrapjawDialogue(DIALOGUE);
registerC5Dialogue(DIALOGUE);
registerDrakeDialogue(DIALOGUE);
registerRootdeepDialogue(DIALOGUE);
for (const b of WEAPON_BOX_SHOPS) {
  DIALOGUE[b.id] = {
    id: b.id,
    entry: [{ node: 'open' }],
    nodes: {
      open: {
        speaker: b.name,
        text: 'Fixed-price firearms stocked for Sprouts.',
        choices: [{ text: 'Browse Weapon Box.', do: [{ openShop: b.id }] }, { text: 'Leave.' }],
      },
    },
  };
}
