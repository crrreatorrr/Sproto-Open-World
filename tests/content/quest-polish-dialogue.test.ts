import { describe, expect, it } from 'vitest';
import { DIALOGUE, DIALOGUE_LINE_LIMIT, QUEST_BOSS_BARKS, type DialogueNode } from '../../src/content/dialogue';
import { QUEST_CLUES, QUESTS } from '../../src/content/quests';

/** The eight myth lines, word for word (Lore Master). */
const MYTHS = [
  'You look awake at last. They say the first Sproto slept through a harvest too.',
  'The beacon burns again. Those coins you caught — minted before the mud came. They still know the way home.',
  "Hear that wheel? Music. That grim seal was stuck in the works. The old folk say it was the tyrant Tinubu's. It will serve you now, and never him.",
  'Look through it. A chip of the Speaking Stone, if you believe the old talk. It shows the blow before the blow.',
  'And this rivet. Iron from the kingdom under the mud. Strike it, and it answers.',
  'Wear those wraps like the old stories say Sproto did. Never where the blow falls.',
  'Lovely, still humming. Grown where the wild surge runs closest to the ground. And this bracer, from the same hedge.',
  'Then Sproutvale sleeps easy. This glass came out of the beast — the green the old folk called hope. Time drinks it slowly.',
];

/** Nodes the polish pass adds or rewrites, by graph. */
const NODES: Record<string, string[]> = {
  elder_pepe: ['wake_after', 'pest_offer', 'pest_busy', 'after', 'after_tower', 'after_tower_myth', 'a5_done', 'a5_after', 'scrapjaw_return', 'scrapjaw_thanks', 'scrapjaw_after', 'a12_return', 'a12_thanks', 'a12_after'],
  captain_agent: ['tower_offer', 'parry_tip', 'tower_done', 'tower_after', 'thorn_offer', 'thorn_offer_2', 'thorn_busy', 'after', 'thorn_after', 'scrapjaw_offer', 'scrapjaw_busy', 'after_quarry'],
  farmer_broccoli: ['pest_done', 'pumpkins_offer', 'pumpkins_busy', 'pumpkins_done', 'after', 'a4_done', 'a4_after', 'a10_done', 'a10_pail', 'a10_after', 'a11_post', 'a11_after'],
  miller_pepe: ['offer', 'busy', 'mill_done', 'after'],
  collector_pepe: ['offer', 'offer_ask', 'busy', 'relics_done', 'relics_lantern', 'after'],
  watch_captain: ['a1_offer', 'a1_brief', 'a1_done', 'a2_brief', 'a2_done', 'a3_brief', 'a3_brief_2', 'a3_done', 'a3_rivet', 'after', 'after_lens', 'after_iron'],
  ranger_moss: ['offer', 'busy', 'after', 'after_myth'],
  weaver_tansy: ['offer', 'a7_brief', 'a7_done', 'after'],
  miner_bram: ['offer', 'tremors_done', 'a9_offer', 'go', 'seam_done', 'tremors_after', 'after'],
  miner_ketta: ['a8_ketta'],
  miner_odo: ['a8_odo'],
};

// No relic or totem: pumpkins pay a staff, the map pays a shard that is spent, and the sword is the chest.
const NO_NEW_ITEM = ['q_pumpkins', 'q_pumpkin_strength', 'q_collectors_map', 'q_rootdeep'];

/** Modern and crypto talk the valley does not use (Lore Master). Whole words only. */
const BANNED = /\b(sats|fud|frens?|jeet|hodl|bitcoin|crypto|nfts?|wallet|blockchain|berachain|testnet|hopium|emilokan|glowie|coomer|boomerang|liquidity|rocket|candle|chart)\b/i;

const texts: { where: string; text: string }[] = [];
for (const g of Object.values(DIALOGUE)) {
  for (const [id, n] of Object.entries(g.nodes)) {
    texts.push({ where: `${g.id}.${id}`, text: n.text });
    for (const [i, c] of (n.choices ?? []).entries()) texts.push({ where: `${g.id}.${id}#${i}`, text: c.text });
  }
}
for (const [id, clue] of Object.entries(QUEST_CLUES)) texts.push({ where: `clue.${id}`, text: clue });
for (const [id, line] of Object.entries(QUEST_BOSS_BARKS)) texts.push({ where: `bark.${id}`, text: line });
for (const q of Object.values(QUESTS)) for (const s of q.steps) texts.push({ where: `${q.id}.${s.id}`, text: s.text });

const node = (graph: string, id: string): DialogueNode => DIALOGUE[graph].nodes[id];

describe('quest polish dialogue', () => {
  it('every quest has the nodes the plan names', () => {
    for (const [graph, ids] of Object.entries(NODES)) {
      for (const id of ids) expect(DIALOGUE[graph].nodes[id], `${graph}.${id}`).toBeDefined();
    }
  });

  it('keeps the eight myth lines', () => {
    const said = new Set(Object.values(DIALOGUE).flatMap((g) => Object.values(g.nodes).map((n) => n.text)));
    for (const line of MYTHS) expect(said.has(line), line).toBe(true);
  });

  it('speaks Pest Control from the Elder, and the finish from Farmer Broccoli', () => {
    expect(QUESTS.q_pest_control.giver).toBe('elder_pepe');
    expect(node('farmer_broccoli', 'pest_done').speaker).toBe('Farmer Broccoli');
    expect(node('elder_pepe', 'pest_offer').text).toContain('Farmer Broccoli');
  });

  it("gives Tremors' mid line to Ketta, and keeps Old Odo's warning", () => {
    expect(node('miner_ketta', 'a8_ketta').speaker).toBe('Ketta the Driller');
    expect(node('miner_ketta', 'a8_ketta').text).toBe('The dust jumps before she does. Watch it run across the ground at you, then get off that spot, fast.');
    expect(node('miner_odo', 'a8_odo').text).toBe('We called her the Burrowmother when I was a lad, to scare the new hands. Turns out she was never a story.');
  });

  it('offers Scrapjaw from Captain Agent instead of starting it when Thornwood ends', () => {
    const offer = node('captain_agent', 'scrapjaw_offer');
    expect(offer.choices?.some((c) => c.do?.some((fx) => 'startQuest' in fx && fx.startQuest === 'q_scrapjaw'))).toBe(true);
    expect(QUESTS.q_thornwood.rewards.some((fx) => 'startQuest' in fx && fx.startQuest === 'q_scrapjaw')).toBe(false);
    expect(node('captain_agent', 'after').do?.some((fx) => 'startQuest' in fx)).toBeFalsy();
  });

  it("leaves Collector Pepe's after rule in place, so another quest can insert above it", () => {
    const after = DIALOGUE.collector_pepe.entry.find((r) => r.node === 'after');
    expect(after).toEqual({ if: [{ quest: 'q_relics', status: 'complete' }], node: 'after' });
    expect(DIALOGUE.collector_pepe.entry[0]?.if, 'the first rule stays conditional').toBeDefined();
  });

  it('puts a clue only on quests that award an item', () => {
    expect(Object.keys(QUEST_CLUES).sort()).toEqual(Object.keys(QUESTS).filter((id) => !NO_NEW_ITEM.includes(id)).sort());
    for (const id of NO_NEW_ITEM) expect(QUESTS[id].clue, id).toBeUndefined();
    for (const [id, clue] of Object.entries(QUEST_CLUES)) expect(QUESTS[id].clue, id).toBe(clue);
    expect(QUEST_CLUES.q_watchtower).toBe('A watchman once kept something under the bell.');
    expect(QUEST_CLUES.q_deep_seam).toBe('The deep earth breathes for those who listen.');
  });

  it('keeps the optional boss barks', () => {
    expect(QUEST_BOSS_BARKS.gatekeeper).toBe('NO KEY. NO EXIT.');
    expect(QUEST_BOSS_BARKS.big_coin).toBe('YOU WILL NOT MOVE ME.');
  });

  it(`keeps every line within ${DIALOGUE_LINE_LIMIT} characters`, () => {
    const over = texts.filter((t) => t.text.length > DIALOGUE_LINE_LIMIT).map((t) => `${t.where} (${t.text.length})`);
    expect(over).toEqual([]);
  });

  it('has no modern or crypto wording', () => {
    const hits = texts.filter((t) => BANNED.test(t.text)).map((t) => `${t.where}: ${t.text}`);
    expect(hits).toEqual([]);
  });
});
