import { describe, expect, it } from 'vitest';
import type { SimWorld } from '../../src/sim/SimWorld';
import { bakedWorld, hunt, prog, reach, reload, statusOf, talk, tick } from './quests-helpers';

/** The Gatekeeper never comes back, so nothing of its can be left on the ground to fade. */
const upToThornwood = (w: SimWorld) => {
  for (const id of ['q_wake_up', 'q_pest_control', 'q_watchtower']) prog(w).quests[id] = { status: 'complete', step: 99, progress: [] };
};

describe('the Quarry-proof robe', () => {
  it('is in your hands the moment the Gatekeeper falls, with nothing left on the ground', async () => {
    const w = await bakedWorld();
    upToThornwood(w);
    talk(w, 'captain_agent', 'q_thornwood');
    reach(w, 'thornwood_clearing');
    hunt(w, 'gatekeeper', true);
    expect(prog(w).inventory.robe_quarryproof).toBe(1);
    expect(w.entities.filter((e) => e.pickup?.item === 'robe_quarryproof')).toEqual([]);
    w.dispose();
  });

  it('survives killing the Gatekeeper early and reloading before picking anything up', async () => {
    let w = await bakedWorld();
    hunt(w, 'gatekeeper', true);
    w = await reload(w);
    upToThornwood(w);
    talk(w, 'captain_agent', 'q_thornwood');
    reach(w, 'thornwood_clearing');
    tick(w);
    expect(statusOf(w, 'q_thornwood')).toBe('complete');
    expect(prog(w).inventory.robe_quarryproof).toBe(1);
    w.dispose();
  });
});
