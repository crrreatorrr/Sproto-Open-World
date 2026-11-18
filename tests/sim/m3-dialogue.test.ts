import { afterEach, describe, expect, it } from 'vitest';
import { DIALOGUE } from '../../src/content/dialogue';
import { NPCS } from '../../src/content/npcs';
import type { RegionContent } from '../../src/content/world/sproutvaleContent';
import { BTN } from './combatHelpers';
import { choose, evs, interact, stand, standBy, tick1, ui, village } from './m3Helpers';

/** Plan §5 dialogue: the sim owns the cursor, entry rules by quest state, choices validated. */

describe('entry rules pick the node by quest state', () => {
  const cases: [string, Parameters<typeof setQuest>[1], string][] = [
    ['no quest yet', undefined, 'intro'],
    ['quest active, step 0', { status: 'active', step: 0, progress: [0] }, 'busy'],
    ['quest active, step 3', { status: 'active', step: 3, progress: [0, 0] }, 'seed_return'],
    // M4: the Elder then offers the next main quest, Pest Control.
    ['quest complete', { status: 'complete', step: 5, progress: [] }, 'pest_offer'],
  ];
  function setQuest(v: Awaited<ReturnType<typeof village>>, q: { status: 'active' | 'complete'; step: number; progress: number[] } | undefined) {
    if (q) v.prog().quests.q_wake_up = q;
  }
  for (const [name, q, node] of cases) {
    it(`${name} → ${node}`, async () => {
      const v = await village();
      setQuest(v, q);
      standBy(v.w, 'elder_pepe');
      const e = tick1(v.w, interact());
      expect(evs(e, 'interact')).toMatchObject([{ object: 'elder_pepe', kind: 'npc' }]);
      expect(evs(e, 'talk')).toMatchObject([{ npc: 'elder_pepe', node }]);
      expect(v.prog().dialogue).toEqual({ npc: 'elder_pepe', node });
      v.w.dispose();
    });
  }
});

describe('the cursor and choices', () => {
  it('a missing choice index is refused and changes nothing', async () => {
    const { w, prog } = await village();
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    tick1(w, choose(0));
    expect(prog().dialogue).toEqual({ npc: 'elder_pepe', node: 'intro2' });
    for (const bad of [2, -1, 99]) {
      const e = tick1(w, choose(bad));
      expect(evs(e, 'refused'), `choice ${bad}`).toMatchObject([{ action: 'dialogueChoose' }]);
      expect(prog().dialogue).toEqual({ npc: 'elder_pepe', node: 'intro2' });
      expect(prog().quests.q_wake_up).toBeUndefined();
    }
    w.dispose();
  });

  it('a node with no choices continues to next; with no next it ends the talk (dialogueEnd)', async () => {
    const { w, prog } = await village();
    prog().quests.q_wake_up = { status: 'active', step: 3, progress: [0, 0] };
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    const e1 = tick1(w, choose(7)); // the index doesn't matter on a node without choices
    expect(evs(e1, 'talk')).toMatchObject([{ node: 'seed_thanks' }]);
    expect(evs(e1, 'refused')).toEqual([]);
    const e2 = tick1(w, choose(0));
    expect(evs(e2, 'dialogueEnd')).toMatchObject([{ npc: 'elder_pepe' }]);
    expect(prog().dialogue).toBeNull();
    w.dispose();
  });

  it('dialogueChoose while not talking does nothing', async () => {
    const { w, prog } = await village();
    const e = tick1(w, choose(0));
    expect(e.filter((x) => x.type === 'talk' || x.type === 'refused' || x.type === 'dialogueEnd')).toEqual([]);
    expect(prog().dialogue).toBeNull();
    w.dispose();
  });

  it('the view lists only the available choices with their real indices', async () => {
    const { w } = await village();
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    expect(w.view().dialogueChoices(0)).toEqual([]); // intro: no choices
    tick1(w, choose(0));
    expect(w.view().dialogueChoices(0)).toEqual([
      { index: 0, text: "I'm on it." },
      { index: 1, text: 'Maybe later.' },
    ]);
    w.dispose();
  });

  it('while talking, movement and attacks are ignored; interact presses do not restart the talk', async () => {
    const { w, p, prog } = await village();
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    const before = { ...p.tf.pos };
    for (let i = 0; i < 20; i++) {
      const c = ui([], i % 5 === 0 ? BTN.light | BTN.interact | BTN.dodge : BTN.sprint);
      c.move = { x: 0, y: 1 };
      tick1(w, c);
    }
    expect(p.combat!.action).toBeNull();
    expect(Math.hypot(p.tf.pos.x - before.x, p.tf.pos.z - before.z)).toBeLessThan(1e-3);
    expect(prog().dialogue).toEqual({ npc: 'elder_pepe', node: 'intro' });
    w.dispose();
  });

  it('nothing to talk to out of reach or behind you', async () => {
    const { w } = await village();
    const at = w.locate('elder_pepe')!;
    stand(w, at.x, at.z - 4, { x: at.x, z: at.z }); // too far
    expect(w.view().interactTarget(0)).toBeNull();
    stand(w, at.x, at.z - 2, { x: at.x, z: at.z - 10 }); // in reach, facing away
    expect(w.view().interactTarget(0)).toBeNull();
    const e = tick1(w, interact());
    expect(evs(e, 'talk')).toEqual([]);
    w.dispose();
  });
});

describe('conditional choices (a test-only NPC injected into the content tables)', () => {
  // DIALOGUE and NPCS are plain records: a temporary graph exercises `if` on choices, which no
  // shipped M3 graph uses yet. Removed after each test.
  afterEach(() => {
    delete DIALOGUE.test_sage;
    delete NPCS.test_sage;
  });

  async function sage() {
    NPCS.test_sage = { id: 'test_sage', name: 'Test Sage', model: 'npc', dialogue: 'test_sage', body: { radius: 0.4, height: 1.8 } };
    DIALOGUE.test_sage = {
      id: 'test_sage',
      entry: [{ node: 'ask' }],
      nodes: {
        ask: {
          speaker: 'Test Sage',
          text: 'Well?',
          choices: [
            { text: 'Show the seed.', if: [{ hasItem: 'sprout_seed' }], do: [{ setFlag: 'sage_saw_seed' }], next: 'thanks' },
            { text: 'Ask about the flag.', if: [{ flag: 'sage_saw_seed' }], do: [{ learnSpell: 'blast' }] },
            { text: 'Leave.' },
          ],
        },
        thanks: { speaker: 'Test Sage', text: 'A fine seed.', do: [{ currency: 5 }] },
      },
    };
    const content: RegionContent = { npcs: [{ id: 'test_sage', npc: 'test_sage', pos: [250, 13.5, 50], yaw: Math.PI }], shrines: [], chests: [], enemies: [], triggers: [] };
    const v = await village({ content });
    standBy(v.w, 'test_sage');
    tick1(v.w, interact());
    expect(v.prog().dialogue).toEqual({ npc: 'test_sage', node: 'ask' });
    return v;
  }

  it('a choice whose conditions fail is hidden from the view and refused by the sim (no effects)', async () => {
    const { w, prog } = await sage();
    expect(w.view().dialogueChoices(0).map((c) => c.index)).toEqual([2]);
    const e = tick1(w, choose(0));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'dialogueChoose' }]);
    expect(w.world.flags.sage_saw_seed).toBeUndefined();
    expect(prog().dialogue).toEqual({ npc: 'test_sage', node: 'ask' });
    w.dispose();
  });

  it("a passing choice applies its effects, then the next node's `do`", async () => {
    const { w, prog } = await sage();
    prog().inventory.sprout_seed = 1;
    expect(w.view().dialogueChoices(0).map((c) => c.index)).toEqual([0, 2]);
    const e = tick1(w, choose(0));
    expect(w.world.flags.sage_saw_seed).toBe(1);
    expect(evs(e, 'talk')).toMatchObject([{ node: 'thanks' }]);
    expect(prog().sprouts).toBe(5);
    tick1(w, choose(0)); // ends
    tick1(w, interact()); // talk again: the flag now unlocks choice 1
    expect(w.view().dialogueChoices(0).map((c) => c.index)).toEqual([0, 1, 2]);
    const e2 = tick1(w, choose(1));
    expect(evs(e2, 'spellLearned')).toMatchObject([{ spell: 'blast' }]);
    expect(prog().spells).toEqual(['bolt', 'blast']);
    expect(evs(e2, 'dialogueEnd').length).toBe(1);
    w.dispose();
  });
});
