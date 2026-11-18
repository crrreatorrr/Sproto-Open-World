import { describe, expect, it } from 'vitest';
import { evs, interact, standBy, tick1, ui, village } from './m3Helpers';

/** Back leaves a talk at any line, as the dialogue's hint says. */
describe('leaving a dialogue', () => {
  it('ends the talk, starts nothing, and the villager can be talked to again', async () => {
    const { w, p } = await village();
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    const prog = p.progress!;
    expect(prog.dialogue?.npc).toBe('elder_pepe');

    const left = tick1(w, ui([{ kind: 'closeMenu' }]));
    expect(prog.dialogue).toBeNull();
    expect(evs(left, 'dialogueEnd').map((e) => e.npc)).toEqual(['elder_pepe']);
    expect(prog.quests.q_wake_up?.status ?? 'none').not.toBe('active');

    tick1(w);
    tick1(w, interact());
    expect(prog.dialogue?.npc).toBe('elder_pepe');
    w.dispose();
  });

  it('closing with no talk open says nothing', async () => {
    const { w } = await village();
    expect(evs(tick1(w, ui([{ kind: 'closeMenu' }])), 'dialogueEnd')).toEqual([]);
    w.dispose();
  });
});
