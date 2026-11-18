import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { bakedWorld, prog, talk } from './quests-helpers';

/** What the villagers say once a job is done: never a job you have already finished. */
const nodes = (e: SimEvent[]) => e.flatMap((x) => (x.type === 'talk' ? [x.node] : []));
const finish = (w: SimWorld, ...ids: string[]) => {
  for (const id of ids) prog(w).quests[id] = { status: 'complete', step: 99, progress: [] };
};

describe('villagers keep up with the story', () => {
  it('the Elder points you at the shrine after the seed, not back at the dummies', async () => {
    const w = await bakedWorld();
    prog(w).quests.q_wake_up = { status: 'active', step: 4, progress: [0] };
    expect(nodes(talk(w, 'elder_pepe'))).toEqual(['seed_thanks']);
    w.dispose();
  });

  it('the Elder stops sending you to a Watchtower you already lit', async () => {
    const w = await bakedWorld();
    finish(w, 'q_wake_up', 'q_pest_control');
    expect(nodes(talk(w, 'elder_pepe'))).toEqual(['after']);
    finish(w, 'q_watchtower');
    expect(nodes(talk(w, 'elder_pepe'))).toEqual(['after_tower']);
    w.dispose();
  });

  it('Captain Agent stops sending you to a gate you already went through', async () => {
    const w = await bakedWorld();
    finish(w, 'q_wake_up', 'q_pest_control', 'q_watchtower', 'q_thornwood');
    prog(w).quests.q_scrapjaw = { status: 'active', step: 0, progress: [0] };
    expect(nodes(talk(w, 'captain_agent'))).toEqual(['after']);
    finish(w, 'q_scrapjaw');
    expect(nodes(talk(w, 'captain_agent'))).toEqual(['after_quarry']);
    w.dispose();
  });

  it('Foreman Bram stops sending you to fires you already put out', async () => {
    const w = await bakedWorld();
    finish(w, 'q_tremors', 'q_deep_seam');
    expect(nodes(talk(w, 'miner_bram'))).toEqual(['after']);
    finish(w, 'q_smoke_hills');
    expect(nodes(talk(w, 'miner_bram'))).toEqual(['after_quiet']);
    w.dispose();
  });
});
