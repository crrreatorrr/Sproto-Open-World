import { describe, expect, it } from 'vitest';
import { combatWorld, step } from './combatHelpers';
import { ui } from './m3Helpers';

const swap = { kind: 'equip', item: 'charm_second_wind' } as const;

describe('Second Wind and the tonic flask', () => {
  it.each([[1, 1], [2, 2], [3, 3], [4, 4], [0, 0]])('worn at %i of 4, off and on again leaves %i', async (from, to) => {
    const { w, p } = await combatWorld();
    const t = p.progress!.tonics;
    p.progress!.inventory.charm_second_wind = 1;
    step(w, ui([swap]));
    t.charges = from;
    for (let i = 0; i < 3; i++) {
      step(w, ui([swap]));
      step(w, ui([swap]));
      expect(t).toEqual({ charges: to, max: 4 });
    }
    w.dispose();
  });

  it('putting it on with an empty flask brings its one charge, once per rest', async () => {
    const { w, p } = await combatWorld();
    const t = p.progress!.tonics;
    p.progress!.inventory.charm_second_wind = 1;
    t.charges = 0;
    step(w, ui([swap]));
    expect(t).toEqual({ charges: 1, max: 4 });
    t.charges = 0; // drunk
    step(w, ui([swap]));
    step(w, ui([swap]));
    expect(t.charges).toBe(0);
    w.dispose();
  });
});
