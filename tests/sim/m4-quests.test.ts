import { describe, expect, it } from 'vitest';
import type { InputCommand } from '../../src/sim/commands';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { step, stepN } from './combatHelpers';
import { choose, evs, interact, playWakeUp, standBy, ui } from './m3Helpers';
import { alive, campMembers, collectPickups, flatSproutvale, parrySwing, slay, slayN, standAt } from './m4Helpers';

/**
 * M4 acceptance 1 (plan §9): every quest of the Scrap Rumble's main chain (M1–M4) and the side
 * quests S1–S3 completes, played by commands (teleports stand in for walking).
 */
function talk(w: SimWorld, npc: string, choices: number[] = []): SimEvent[] {
  const out: SimEvent[] = [];
  const t = (c?: InputCommand) => out.push(...step(w, c));
  standBy(w, npc);
  t(interact());
  for (const c of choices) t(choose(c));
  // Read through the rest of the talk.
  for (let i = 0; i < 6 && w.playerEntity(0)!.progress!.dialogue; i++) t(choose(0));
  return out;
}

function reach(w: SimWorld, trigger: string): SimEvent[] {
  const at = w.locate(trigger)!;
  standAt(w, at.x, at.z);
  return stepN(w, 2).map((x) => x.ev);
}

function rest(w: SimWorld, shrine: string): SimEvent[] {
  standBy(w, shrine);
  return [...step(w, interact()), ...step(w, ui([{ kind: 'rest' }])), ...step(w, ui([{ kind: 'closeMenu' }]))];
}

const status = (w: SimWorld, q: string) => w.playerEntity(0)!.progress!.quests[q]?.status;

describe('the Scrap Rumble main chain (plan §6.2)', () => {
  it('M1 → M2 → M3 → M4 complete in order, each giving its reward', async () => {
    const { w } = await flatSproutvale(3);
    const prog = () => w.playerEntity(0)!.progress!;
    playWakeUp(w);
    step(w, ui([{ kind: 'closeMenu' }]));
    expect(status(w, 'q_wake_up')).toBe('complete');

    // M2 Pest Control: the Elder → the Orchard → 8 Grunts → Farmer Broccoli → Blast.
    let e = talk(w, 'elder_pepe', [0]);
    expect(evs(e, 'questStarted').map((x) => x.quest)).toEqual(['q_pest_control']);
    reach(w, 'orchard_fields');
    slayN(w, 8, (x) => x.brain!.camp?.startsWith('orchard') ?? false);
    expect(prog().quests.q_pest_control).toMatchObject({ status: 'active', step: 2 });
    expect(prog().spells).not.toContain('blast');
    talk(w, 'farmer_broccoli');
    expect(status(w, 'q_pest_control')).toBe('complete');
    expect(prog().spells).toContain('blast');

    // M3 Light the Watchtower: Captain Agent → a parry → the hill → 5 Slingers → the beacon → rest.
    e = talk(w, 'captain_agent', [0]);
    expect(evs(e, 'questStarted').map((x) => x.quest)).toEqual(['q_watchtower']);
    parrySwing(w, w.entities.find((x) => x.brain?.def === 'dummy_swing')!);
    expect(prog().quests.q_watchtower.step).toBe(1);
    reach(w, 'watchtower_hill');
    slayN(w, 5, (x) => x.brain!.camp === 'watchtower_squad');
    expect(prog().quests.q_watchtower.step).toBe(3);
    standBy(w, 'watchtower_beacon');
    e = step(w, interact());
    expect(evs(e, 'interact')).toMatchObject([{ object: 'watchtower_beacon', kind: 'object' }]);
    expect(w.world.flags['beacon.lit']).toBe(1);
    rest(w, 'shrine_watchtower');
    expect(status(w, 'q_watchtower')).toBe('complete');
    expect(prog().inventory.robe_warden).toBe(1);

    // M4 Thornwood Tracks: the clearing → the Gatekeeper → the Quarry Key.
    talk(w, 'captain_agent', [0]);
    expect(status(w, 'q_thornwood')).toBe('active');
    reach(w, 'thornwood_clearing');
    slay(w, campMembers(w, 'thornwood_clearing')[0]);
    step(w);
    expect(status(w, 'q_thornwood')).toBe('complete');
    expect(prog().inventory.quarry_key).toBe(1);
    expect(w.world.flags['gate.quarry.key']).toBe(1);
    w.dispose();
  }, 60_000);

  it('the Frost Nova tome on the Thornwood path teaches Frost Nova once', async () => {
    const { w } = await flatSproutvale();
    standBy(w, 'frost_tome');
    const e = step(w, interact());
    expect(evs(e, 'spellLearned')).toMatchObject([{ spell: 'frostNova' }]);
    expect(step(w, interact()).some((x) => x.type === 'spellLearned')).toBe(false);
    w.dispose();
  });
});

describe('side quests (plan §6.3)', () => {
  it('S1 Pumpkin Thieves: 5 Stolen Pumpkins from Orchard Grunts → the Gourd Staff', async () => {
    const { w } = await flatSproutvale(4);
    const prog = () => w.playerEntity(0)!.progress!;
    talk(w, 'farmer_broccoli', [0]);
    expect(status(w, 'q_pumpkins')).toBe('active');
    // Clear the Orchard and pick up what drops; rest to bring the camps back until five are in hand.
    let picked = 0;
    for (let round = 0; round < 5 && prog().quests.q_pumpkins.step === 0; round++) {
      for (const g of w.entities.filter((x) => x.brain?.camp?.startsWith('orchard') && alive(x))) {
        // Pumpkins can also be walked over while fighting the next Grunt: count every pickup.
        picked += evs([...slay(w, g), ...collectPickups(w)], 'pickup').filter((x) => x.item === 'stolen_pumpkin').length;
        if (prog().quests.q_pumpkins.step > 0) break;
      }
      rest(w, 'shrine_first_light');
    }
    expect(prog().quests.q_pumpkins.step).toBe(1);
    talk(w, 'farmer_broccoli');
    expect(status(w, 'q_pumpkins')).toBe('complete');
    expect(prog().inventory.staff_gourd).toBe(1);
    // The step took exactly five (consume); anything picked up past that stays in the bag.
    expect(prog().inventory.stolen_pumpkin ?? 0).toBe(picked - 5);
    w.dispose();
  }, 60_000);

  it('S2 The Mill\'s Racket: the mill → Big Coin → the lever → Chain Zap', async () => {
    const { w } = await flatSproutvale();
    talk(w, 'miller_pepe', [0]);
    reach(w, 'mill');
    slay(w, campMembers(w, 'mill_yard').find((x) => x.brain!.unique === 'big_coin')!);
    standBy(w, 'mill_lever');
    step(w, interact());
    expect(status(w, 'q_mill')).toBe('complete');
    expect(w.playerEntity(0)!.progress!.spells).toContain('chainZap');
    w.dispose();
  });

  it('S3 Lost Relics: three relic chests → Moonward and Scholar\'s Knot', async () => {
    const { w } = await flatSproutvale();
    talk(w, 'collector_pepe', [0]);
    for (const id of ['relic_mill', 'relic_rootarch', 'relic_beanstalk']) {
      standBy(w, id);
      step(w, interact());
    }
    talk(w, 'collector_pepe');
    expect(status(w, 'q_relics')).toBe('complete');
    expect(w.playerEntity(0)!.progress!.inventory).toMatchObject({ staff_moonward: 1, charm_scholars_knot: 1 });
    w.dispose();
  });
});

describe('the beacon stands on its prop (M4)', () => {
  it('it can be lit from the ground, about 4 m below it', async () => {
    const { w } = await flatSproutvale();
    const beacon = w.entities.find((e) => e.interactable?.id === 'watchtower_beacon')!;
    beacon.tf.pos.y += 4;
    standBy(w, 'watchtower_beacon');
    const e = step(w, interact());
    expect(evs(e, 'interact')).toMatchObject([{ object: 'watchtower_beacon', kind: 'object' }]);
    w.dispose();
  });
});

describe('out of order never soft-locks (M4)', () => {
  it('relic chests opened before taking S3 still count', async () => {
    const { w } = await flatSproutvale();
    for (const id of ['relic_mill', 'relic_rootarch', 'relic_beanstalk']) {
      standBy(w, id);
      step(w, interact());
    }
    talk(w, 'collector_pepe', [0]);
    step(w);
    expect(w.playerEntity(0)!.progress!.quests.q_relics.step).toBe(1);
    w.dispose();
  });

  it('Big Coin killed before taking S2 still counts (uniques never come back)', async () => {
    const { w } = await flatSproutvale();
    slay(w, campMembers(w, 'mill_yard').find((x) => x.brain!.unique === 'big_coin')!);
    talk(w, 'miller_pepe', [0]);
    reach(w, 'mill');
    step(w);
    expect(w.playerEntity(0)!.progress!.quests.q_mill.step).toBe(2);
    w.dispose();
  });

  it('the beacon lit before M3 still counts', async () => {
    const { w } = await flatSproutvale();
    standBy(w, 'watchtower_beacon');
    step(w, interact());
    const p = w.playerEntity(0)!.progress!;
    p.quests.q_watchtower = { status: 'active', step: 3, progress: [0] };
    step(w);
    expect(p.quests.q_watchtower.step).toBe(4);
    w.dispose();
  });
});
