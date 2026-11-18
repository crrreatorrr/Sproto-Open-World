import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/save/migrations';
import { SAVE_SCHEMA, type SaveFile } from '../../src/save/schema';
import type { Progress } from '../../src/sim/entity';
import { applyEffects } from '../../src/sim/systems/rpg';
import { BTN } from './combatHelpers';
import { choose, evs, interact, playWakeUp, rpgCtx, standBy, tick1, ui, village } from './m3Helpers';

/** Plan §2.8 saving, through the sim: toSave → a new world → applySave. */

const META = { savedAt: '2026-11-17T12:00:00.000Z', build: 'test', region: 'sproutvale' };

const persistent = (p: Progress) => {
  const { dialogue: _d, shop: _s, atShrine: _a, ...rest } = p;
  void _d;
  void _s;
  void _a;
  return rest;
};

/** Through JSON, as localStorage would carry it. */
const roundTrip = (s: SaveFile): SaveFile => JSON.parse(JSON.stringify(s));

async function loadInto(save: SaveFile): Promise<Awaited<ReturnType<typeof village>>> {
  const v = await village();
  v.w.applySave(migrate(roundTrip(save)));
  return v;
}

/** A session that touches every saved field: the quest, shopping, gear, a point, a spell, a shrine. */
async function playedWorld() {
  const v = await village();
  const { w, p, prog } = v;
  playWakeUp(w); // ends resting at shrine_first_light (level 2: two skill points)
  tick1(w, ui([{ kind: 'spendSkill', skill: 'focus' }, { kind: 'closeMenu' }]));
  prog().sprouts += 300; // test setup: enough to shop
  standBy(w, 'merchant_village');
  tick1(w, interact());
  tick1(w, choose(0));
  tick1(w, ui([{ kind: 'buy', merchant: 'merchant_village', item: 'staff_nobu' }, { kind: 'buy', merchant: 'merchant_village', item: 'charm_second_wind' }]));
  tick1(w, ui([{ kind: 'equip', item: 'staff_nobu' }, { kind: 'equip', item: 'charm_second_wind' }]));
  applyEffects(rpgCtx(w), p, [{ learnSpell: 'frostNova' }, { setFlag: 'met_trader', value: 2 }]);
  tick1(w, ui([{ kind: 'equipSpell', slot: 0, spell: 'frostNova' }, { kind: 'equipSpell', slot: 3, spell: 'bolt' }]));
  // Drink one tonic (out of the shop: a menu swallows gameplay presses), then reopen the shop.
  tick1(w, ui([{ kind: 'closeMenu' }], BTN.potion));
  expect(prog().tonics.charges).toBe(3);
  for (let i = 0; i < 45; i++) tick1(w);
  tick1(w, interact());
  tick1(w, choose(0));
  // Save with the shop still open and wounded.
  p.vitals!.hp = 33;
  expect(prog().shop).toBe('merchant_village');
  return v;
}

describe('save round trip through the sim (plan §2.8)', () => {
  it('toSave: schema, meta, no menus; passes migrate unchanged; well under 20 KB', async () => {
    const { w } = await playedWorld();
    const s = w.toSave(META);
    expect(s.schema).toBe(SAVE_SCHEMA);
    expect(s).toMatchObject(META);
    expect(s.player).not.toHaveProperty('dialogue');
    expect(s.player).not.toHaveProperty('shop');
    expect(s.player).not.toHaveProperty('atShrine');
    expect(migrate(roundTrip(s))).toEqual(roundTrip(s));
    expect(JSON.stringify(s).length).toBeLessThan(20_000);
    w.dispose();
  });

  it('a new world restores level, XP, skills, points, the loadout, Sprouts, gear, inventory, spells, tonics, quests, shrines, flags and chests', async () => {
    const a = await playedWorld();
    const before = structuredClone(persistent(a.prog()));
    expect(before.level).toBe(2);
    expect(before.skills.focus).toBe(1);
    expect(before.points).toBe(1);
    expect(before.loadout).toEqual(['frostNova', null, null, 'bolt']);
    expect(before.equipment).toEqual({ staff: 'staff_nobu', robe: 'robe_apprentice', charm: 'charm_second_wind' });
    expect(before.spells).toEqual(['bolt', 'frostNova']);
    expect(before.quests.q_wake_up.status).toBe('complete');
    expect(before.lastShrine).toBe('shrine_first_light');
    expect(before.tonics).toEqual({ charges: 3, max: 4 }); // drank one of four
    const worldBefore = structuredClone(a.w.world);
    expect(worldBefore.openedChests).toEqual(['chest_training']);
    expect(worldBefore.flags).toMatchObject({ met_trader: 2, 'bought:merchant_village:staff_nobu': 1, 'bought:merchant_village:charm_second_wind': 1 });
    const save = a.w.toSave(META);
    a.w.dispose();

    const b = await loadInto(save);
    expect(persistent(b.prog())).toEqual(before);
    expect(b.w.world).toEqual(worldBefore);
    // Derived stats re-computed from the loaded state: Focus 1 and level 2, Second Wind's charge.
    expect(b.p.vitals!.manaMax).toBe(100 + 4 + 5);
    expect(b.p.vitals!.hp).toBe(b.p.vitals!.hpMax);
    expect(b.prog().tonics.max).toBe(4);
    // Menus are not resumed.
    expect(b.prog().dialogue).toBeNull();
    expect(b.prog().shop).toBeNull();
    expect(b.prog().atShrine).toBeNull();
    const e = tick1(b.w, ui([{ kind: 'buy', merchant: 'merchant_village', item: 'tonic_upgrade' }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'buy', reason: 'That shop is not open.' }]);
    b.w.dispose();
  });

  it('the player is placed at its last shrine', async () => {
    const a = await playedWorld();
    const save = a.w.toSave(META);
    a.w.dispose();
    const b = await loadInto(save);
    const s = b.w.locate('shrine_first_light')!;
    expect(Math.hypot(b.p.tf.pos.x - (s.x + 1.5), b.p.tf.pos.z - (s.z + 1.5))).toBeLessThan(1e-6);
    // And it stands there (the ground is loaded), not falling.
    for (let i = 0; i < 20; i++) tick1(b.w);
    expect(b.p.loco!.grounded).toBe(true);
    expect(Math.abs(b.p.tf.pos.y - s.y)).toBeLessThan(0.1);
    b.w.dispose();
  });

  it('an opened chest stays used after loading: not interactable, gives nothing again', async () => {
    const a = await playedWorld();
    const save = a.w.toSave(META);
    a.w.dispose();
    const b = await loadInto(save);
    const chest = b.w.entities.find((e) => e.interactable?.id === 'chest_training')!;
    expect(chest.interactable!.used).toBe(true);
    standBy(b.w, 'chest_training');
    expect(b.w.view().interactTarget(0)).toBeNull();
    const seeds = b.prog().inventory.sprout_seed ?? 0;
    const e = tick1(b.w, interact());
    expect(evs(e, 'itemGained')).toEqual([]);
    expect(b.prog().inventory.sprout_seed ?? 0).toBe(seeds);
    b.w.dispose();
  });

  it('a sold-out item stays sold out after loading', async () => {
    const a = await playedWorld();
    const save = a.w.toSave(META);
    a.w.dispose();
    const b = await loadInto(save);
    b.prog().sprouts = 1000;
    standBy(b.w, 'merchant_village');
    tick1(b.w, interact());
    tick1(b.w, choose(0));
    const e = tick1(b.w, ui([{ kind: 'buy', merchant: 'merchant_village', item: 'staff_nobu' }]));
    expect(evs(e, 'refused')).toMatchObject([{ reason: 'Sold out.' }]);
    b.w.dispose();
  });

  it('a mid-quest save resumes the quest: tracked, step and progress, and it still completes', async () => {
    const a = await village();
    playWakeUp(a.w, 'chest'); // step 3: seed in hand, talk to Pepe next
    expect(a.prog().quests.q_wake_up).toEqual({ status: 'active', step: 3, progress: [1, 0] });
    expect(a.prog().discoveredShrines).toEqual([]);
    const save = a.w.toSave(META);
    a.w.dispose();
    const b = await loadInto(save);
    expect(b.prog().tracked).toBe('q_wake_up');
    expect(b.prog().quests.q_wake_up).toEqual({ status: 'active', step: 3, progress: [1, 0] });
    expect(b.prog().inventory.sprout_seed).toBe(1);
    // No shrine rested at: the player stays where the new world spawned it.
    expect(b.p.tf.pos.z).toBeCloseTo(58, 1);
    standBy(b.w, 'elder_pepe');
    tick1(b.w, interact());
    expect(b.prog().quests.q_wake_up.step).toBe(4);
    tick1(b.w, choose(0));
    tick1(b.w, choose(0));
    standBy(b.w, 'shrine_first_light');
    const e = tick1(b.w, interact());
    expect(evs(e, 'questComplete')).toMatchObject([{ quest: 'q_wake_up' }]);
    expect(b.prog().discoveredShrines).toEqual(['shrine_first_light']);
    b.w.dispose();
  });

  it('applySave replaces state rather than merging: a fresh save on a played world resets it', async () => {
    const fresh = await village();
    const save = fresh.w.toSave(META);
    fresh.w.dispose();
    const a = await playedWorld();
    a.w.applySave(migrate(roundTrip(save)));
    expect(a.prog().level).toBe(1);
    expect(a.prog().quests).toEqual({});
    expect(a.w.world.openedChests).toEqual([]);
    expect(a.w.entities.find((e) => e.interactable?.id === 'chest_training')!.interactable!.used).toBe(false);
    a.w.dispose();
  });

  it('toSave without a player throws', async () => {
    const { w } = await village();
    expect(() => w.toSave(META, 7)).toThrow();
    w.dispose();
  });
});
