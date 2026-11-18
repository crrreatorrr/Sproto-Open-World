import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/events';
import { breakIt, choose, dummies, evs, interact, questTrail, stand, standBy, tick1, ui, village } from './m3Helpers';

/**
 * M3 acceptance 1 (plan §9 M3, §5 quests): the test quest q_wake_up completes through all five
 * objective kinds — talk, reach, kill, interact, collect — driven by commands only (interact
 * presses, dialogue choices, light attacks, a rest). The test only places the player (like the QA
 * teleport) and faces them at things.
 */
describe('q_wake_up: all five objective kinds by commands (M3 acceptance 1)', () => {
  it('talk → reach → kill ×3 → interact chest → collect + talk → interact shrine → complete with rewards', async () => {
    const { w, p, prog } = await village();
    const all: SimEvent[] = [];
    const t = (c?: Parameters<typeof tick1>[1]) => {
      const e = tick1(w, c);
      all.push(...e);
      return e;
    };

    // Talk to Elder Pepe: intro → intro2 → "I'm on it." (choice 0).
    standBy(w, 'elder_pepe');
    expect(w.view().interactTarget(0)).toMatchObject({ id: 'elder_pepe', kind: 'npc', name: 'Elder Pepe' });
    let e = t(interact());
    expect(evs(e, 'talk')).toMatchObject([{ npc: 'elder_pepe', node: 'intro' }]);
    expect(prog().dialogue).toEqual({ npc: 'elder_pepe', node: 'intro' });
    t(choose(0)); // no choices: continue
    expect(prog().dialogue).toEqual({ npc: 'elder_pepe', node: 'intro2' });
    expect(w.view().dialogueChoices(0).map((c) => c.index)).toEqual([0, 1]);
    e = t(choose(0));
    expect(evs(e, 'questStarted')).toMatchObject([{ quest: 'q_wake_up' }]);
    expect(evs(e, 'dialogueEnd')).toMatchObject([{ npc: 'elder_pepe' }]);
    expect(prog().dialogue).toBeNull();
    expect(prog().quests.q_wake_up).toEqual({ status: 'active', step: 0, progress: [0] });
    expect(prog().tracked).toBe('q_wake_up');

    // Reach the training yard.
    const yard = w.locate('training_yard')!;
    stand(w, yard.x, yard.z - 5);
    e = t();
    expect(evs(e, 'trigger')).toMatchObject([{ trigger: 'training_yard' }]);
    expect(prog().quests.q_wake_up.step).toBe(1);

    // Break three straw dummies with light attacks.
    const ds = dummies(w);
    expect(ds.length).toBe(3);
    for (const d of ds) {
      stand(w, d.tf.pos.x, d.tf.pos.z - 1.5, { x: d.tf.pos.x, z: d.tf.pos.z });
      all.push(...breakIt(w, d));
    }
    expect(prog().quests.q_wake_up.step).toBe(2);
    expect(evs(all, 'xp').filter((x) => x.entity === p.id).map((x) => x.amount)).toEqual([5, 5, 5]);

    // Open the chest: it gives the Sprout Seed (and 10 Sprouts), which also fills the collect objective.
    standBy(w, 'chest_training');
    expect(w.view().interactTarget(0)).toMatchObject({ id: 'chest_training', kind: 'chest' });
    e = t(interact());
    expect(evs(e, 'itemGained')).toMatchObject([{ item: 'sprout_seed', count: 1 }]);
    expect(prog().inventory.sprout_seed).toBe(1);
    expect(prog().quests.q_wake_up).toEqual({ status: 'active', step: 3, progress: [1, 0] });
    expect(w.view().interactTarget(0)).toBeNull(); // the chest is used

    // Bring the seed back: Pepe's entry rule picks seed_return; the seed is consumed.
    standBy(w, 'elder_pepe');
    e = t(interact());
    expect(evs(e, 'talk')).toMatchObject([{ npc: 'elder_pepe', node: 'seed_return' }]);
    expect(prog().quests.q_wake_up.step).toBe(4);
    expect(prog().inventory.sprout_seed ?? 0).toBe(0);
    t(choose(0));
    expect(prog().dialogue).toEqual({ npc: 'elder_pepe', node: 'seed_thanks' });
    e = t(choose(0));
    expect(evs(e, 'dialogueEnd').length).toBe(1);

    // The shrine: interact (opens its menu), then rest.
    const xpBefore = prog().xp;
    const sproutsBefore = prog().sprouts;
    standBy(w, 'shrine_first_light');
    e = t(interact());
    expect(prog().atShrine).toBe('shrine_first_light');
    e.push(...t(ui([{ kind: 'rest' }])));
    expect(evs(e, 'questComplete')).toMatchObject([{ quest: 'q_wake_up' }]);
    expect(evs(e, 'shrineRest')).toMatchObject([{ shrine: 'shrine_first_light' }]);
    expect(prog().quests.q_wake_up).toEqual({ status: 'complete', step: 5, progress: [] });
    expect(prog().xp - xpBefore).toBe(60);
    expect(prog().sprouts - sproutsBefore).toBe(20);
    expect(prog().tracked).toBeNull();
    expect(prog().lastShrine).toBe('shrine_first_light');

    // The quest events, in order.
    expect(questTrail(all)).toEqual([
      ['started', 'q_wake_up'],
      ['progress', 'q_wake_up', 0, [1]],
      ['step', 'q_wake_up', 1],
      ['progress', 'q_wake_up', 1, [1]],
      ['progress', 'q_wake_up', 1, [2]],
      ['progress', 'q_wake_up', 1, [3]],
      ['step', 'q_wake_up', 2],
      ['progress', 'q_wake_up', 2, [1]],
      ['step', 'q_wake_up', 3],
      ['progress', 'q_wake_up', 3, [1, 0]],
      ['progress', 'q_wake_up', 3, [1, 1]],
      ['step', 'q_wake_up', 4],
      ['progress', 'q_wake_up', 4, [1]],
      ['complete', 'q_wake_up'],
    ]);

    // Afterwards Pepe moves on to the next main quest (M4: Pest Control).
    t(ui([{ kind: 'closeMenu' }]));
    standBy(w, 'elder_pepe');
    e = t(interact());
    expect(evs(e, 'talk')).toMatchObject([{ node: 'pest_offer' }]);
    w.dispose();
  });

  it('progress only counts while the quest is active: the yard and the dummies before accepting do nothing', async () => {
    const { w, prog } = await village();
    const yard = w.locate('training_yard')!;
    stand(w, yard.x, yard.z);
    tick1(w);
    const d = dummies(w)[0];
    stand(w, d.tf.pos.x, d.tf.pos.z - 1.5, { x: d.tf.pos.x, z: d.tf.pos.z });
    breakIt(w, d);
    expect(prog().quests.q_wake_up).toBeUndefined();
    w.dispose();
  });

  it('"Maybe later." ends the talk without starting the quest; talking again starts at intro', async () => {
    const { w, prog } = await village();
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    tick1(w, choose(0));
    const e = tick1(w, choose(1));
    expect(evs(e, 'dialogueEnd').length).toBe(1);
    expect(evs(e, 'questStarted').length).toBe(0);
    expect(prog().quests.q_wake_up).toBeUndefined();
    expect(evs(tick1(w, interact()), 'talk')).toMatchObject([{ node: 'intro' }]);
    w.dispose();
  });

  it('track: only an active quest can be tracked', async () => {
    const { w, prog } = await village();
    tick1(w, ui([{ kind: 'track', quest: 'q_wake_up' }]));
    expect(prog().tracked).toBeNull();
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    tick1(w, choose(0));
    tick1(w, choose(0));
    expect(prog().tracked).toBe('q_wake_up');
    tick1(w, ui([{ kind: 'track', quest: 'no_such_quest' }]));
    expect(prog().tracked).toBe('q_wake_up');
    w.dispose();
  });
});
