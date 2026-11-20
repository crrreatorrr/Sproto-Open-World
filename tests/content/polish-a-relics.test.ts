import { describe, expect, it } from 'vitest';
import { DIALOGUE } from '../../src/content/dialogue';
import { relicCopy } from '../../src/content/relicCopy';
import { KEEPSAKES } from '../../src/content/relics';
import { QUESTS } from '../../src/content/quests';
import type { WorldState } from '../../src/sim/entity';
import { checkAll, newProgress } from '../../src/sim/systems/rpg';

const world = (flags: Record<string, number> = {}): WorldState => ({ flags, openedChests: [], killedUniques: [] });

const opening = (npc: string, flags: Record<string, number> = {}) => {
  const p = newProgress(['bolt']);
  p.relics!.owned = ['relic_drowned_coins', 'relic_sprotos_stride', 'relic_elder_iron_rivet'];
  p.quests.q_watchtower = { status: 'complete', step: 0, progress: [] };
  p.quests.q_hollow_giant = { status: 'complete', step: 0, progress: [] };
  p.quests.q_iron_gallery = { status: 'complete', step: 0, progress: [] };
  p.quests.q_rivet_volley = { status: 'complete', step: 0, progress: [] };
  p.quests.q_lens_flare = { status: 'complete', step: 0, progress: [] };
  return DIALOGUE[npc].entry.find((r) => checkAll(r.if, p, world(flags)))?.node;
};

describe('Polish A relic lines', () => {
  it('uses the relic card clue as each quest-log clue', () => {
    for (const k of KEEPSAKES) {
      expect(QUESTS[k.quest]?.clue, k.quest).toBe(relicCopy(k.id)?.clue);
    }
  });

  it('shows the three bonus lines when the keepsake is owned and not in the bag', () => {
    expect(opening('elder_pepe')).toBe('after_tower_myth');
    expect(opening('ranger_moss')).toBe('after_myth');
    expect(opening('watch_captain', { 'dialogue.q_lens_flare.done': 1 })).toBe('a3_rivet');
    const bare = newProgress(['bolt']);
    bare.quests.q_watchtower = { status: 'complete', step: 0, progress: [] };
    expect(DIALOGUE.elder_pepe.entry.find((r) => checkAll(r.if, bare, world()))?.node).toBe('after_tower');
  });
});
