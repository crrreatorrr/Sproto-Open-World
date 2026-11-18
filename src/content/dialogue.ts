/**
 * Dialogue graphs (plan §5). The sim owns the cursor: the UI shows `player.dialogue.node` and sends
 * `dialogueChoose`; the sim checks conditions and applies effects. Strings live here, keyed, for
 * later localization.
 */
import { C4_DIALOGUE, C4_DIALOGUE_PATCHES } from './packs/c4';
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

export const DIALOGUE: Record<string, DialogueGraph> = {
  elder_pepe: {
    id: 'elder_pepe',
    entry: [
      { if: [{ quest: 'q_pest_control', status: 'complete' }], node: 'after' },
      { if: [{ quest: 'q_pest_control', status: 'active' }], node: 'pest_busy' },
      { if: [{ quest: 'q_wake_up', status: 'complete' }], node: 'pest_offer' },
      { if: [{ quest: 'q_wake_up', status: 'active', step: 3 }], node: 'seed_return' },
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
    },
  },
  captain_agent: {
    id: 'captain_agent',
    entry: [
      { if: [{ quest: 'q_thornwood', status: 'complete' }], node: 'after' },
      { if: [{ quest: 'q_thornwood', status: 'active' }], node: 'thorn_busy' },
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
      thorn_offer: {
        speaker: 'Captain Agent',
        text: "The beacon shows tracks into the Thornwood. Something big guards a clearing there, and it has the Quarry Key. Spells for the Wisps, your staff for the Brutes.",
        choices: [
          { text: "I'll follow them.", do: [{ startQuest: 'q_thornwood' }] },
          { text: 'Not yet.' },
        ],
      },
      thorn_busy: { speaker: 'Captain Agent', text: 'The clearing is past the hill, deep in the Thornwood. Burn works on the big one, I hear.' },
      after: { speaker: 'Captain Agent', text: 'With that key, the Quarry Gate is yours to open. Rest at the gate shrine first.' },
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
      pest_done: { speaker: 'Farmer Broccoli', text: 'The fields are quiet! Bless you. The Elder said you would want this: a spell my grandmother kept for foxes.', next: 'pumpkins_offer' },
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
      after: { speaker: 'Miller Pepe', text: 'Hear that wheel? Music. Lightning jumps from one to the next, remember that.' },
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
        text: 'Three relic chests, lost in the valley: one by the mill waterfall, one under the Thornwood root arch, one at the foot of the Beanstalk. Find them for me?',
        choices: [
          { text: 'A treasure hunt? Yes.', do: [{ startQuest: 'q_relics' }] },
          { text: 'Maybe later.' },
        ],
      },
      busy: { speaker: 'Collector Pepe', text: 'The mill waterfall, the root arch, the Beanstalk. Three chests, three relics.' },
      relics_done: { speaker: 'Collector Pepe', text: 'All three! As promised: the Moonward staff, and a knot that makes woven spells sing.' },
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
