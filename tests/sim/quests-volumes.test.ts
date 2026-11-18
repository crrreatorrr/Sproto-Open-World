import { describe, expect, it } from 'vitest';
import { bakedWorld, prog, reach, tick } from './quests-helpers';

/** A `reach` step asked of a player who is already inside the volume. */
describe('a volume you are already standing in', () => {
  it('Watchtower Hill counts when the parry that opens the step happens on the hill', async () => {
    const w = await bakedWorld();
    prog(w).quests.q_watchtower = { status: 'active', step: 0, progress: [0] };
    reach(w, 'watchtower_hill');
    expect(prog(w).quests.q_watchtower.step).toBe(0);
    // A coin parried up there: the Captain's own tip, and the feat counts anywhere.
    prog(w).quests.q_watchtower = { status: 'active', step: 1, progress: [0] };
    tick(w);
    tick(w);
    expect(prog(w).quests.q_watchtower.step).toBe(2);
    w.dispose();
  });

  it('with no quest waiting for it, standing there fires nothing', async () => {
    const w = await bakedWorld();
    reach(w, 'watchtower_hill');
    expect(tick(w).filter((e) => e.type === 'trigger')).toEqual([]);
    w.dispose();
  });
});
