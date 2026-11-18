/**
 * Dialogue graphs (plan §5). The sim owns the cursor: the UI shows `player.dialogue.node` and sends
 * `dialogueChoose`; the sim checks conditions and applies effects. Strings live here, keyed, for
 * later localization.
 */
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
      { if: [{ quest: 'q_wake_up', status: 'complete' }], node: 'after' },
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
      after: { speaker: 'Elder Pepe', text: 'The valley is yours to walk. Mind the Thornwood.' },
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
