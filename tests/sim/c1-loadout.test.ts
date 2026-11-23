import { describe, expect, it } from 'vitest';
import { GEAR_LOCK_TICKS } from '../../src/content/progression';
import { SPELLS, SWAP_MIN_COOLDOWN, type SpellId } from '../../src/content/spells';
import type { UiAction } from '../../src/sim/commands';
import { applyEffects } from '../../src/sim/systems/rpg';
import { BTN, combatWorld, idle, press, step } from './combatHelpers';
import { evs, interact, rpgCtx, standBy, tick1, ui, village, VILLAGE_Y } from './m3Helpers';

/** C1 (expansion plan §1.1, §1.4): the loadout, the spell selector's rules, and the gear lock. */

const eq = (slot: number, spell: SpellId | null): UiAction => ({ kind: 'equipSpell', slot, spell });

describe('the loadout', () => {
  it('a new world starts with Bolt in slot 1; the yard knows all four in their home slots', async () => {
    const v = await village();
    expect(v.prog().loadout).toEqual(['bolt', null, null, null]);
    v.w.dispose();
    const { w, p } = await combatWorld();
    expect(p.progress!.loadout).toEqual(['bolt', 'blast', 'frostNova', 'chainZap']);
    w.dispose();
  });

  it('a learned spell goes to its home slot, or the first free one when that is taken', async () => {
    const { w, p, prog } = await village();
    applyEffects(rpgCtx(w), p, [{ learnSpell: 'frostNova' }]);
    expect(prog().loadout).toEqual(['bolt', null, 'frostNova', null]);
    tick1(w, ui([eq(2, 'bolt')])); // bolt moves onto Frost Nova's home
    expect(prog().loadout).toEqual([null, null, 'bolt', null]);
    applyEffects(rpgCtx(w), p, [{ learnSpell: 'chainZap' }, { learnSpell: 'blast' }]);
    expect(prog().loadout).toEqual([null, 'blast', 'bolt', 'chainZap']);
    w.dispose();
  });

  it('playerCombat casts what the loadout holds, not the spell’s home slot; an empty slot is refused', async () => {
    const { w, p } = await combatWorld();
    step(w, ui([eq(0, 'chainZap'), eq(3, 'bolt')]));
    expect(p.progress!.loadout).toEqual(['chainZap', 'blast', 'frostNova', 'bolt']);
    p.combat!.cooldowns = {};
    const e1 = step(w, press(BTN.spell4));
    expect(evs(e1, 'castStart')).toMatchObject([{ spell: 'bolt' }]);
    for (let i = 0; i < 40; i++) step(w);
    step(w, ui([eq(1, null)]));
    expect(p.progress!.loadout[1]).toBeNull();
    const mana = p.vitals!.mana;
    const e2 = step(w, press(BTN.spell2));
    expect(evs(e2, 'castStart')).toEqual([]);
    expect(evs(e2, 'refused')).toMatchObject([{ action: 'cast' }]);
    expect(p.vitals!.mana).toBeGreaterThanOrEqual(mana);
    w.dispose();
  });
});

describe('equipSpell: the swap rules (validated in the sim)', () => {
  it('an unknown power is refused and changes nothing', async () => {
    const { w, prog } = await village();
    const e = tick1(w, ui([eq(1, 'blast')]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'equipSpell' }]);
    expect(prog().loadout).toEqual(['bolt', null, null, null]);
    w.dispose();
  });

  it('a bad slot or an unknown id is refused', async () => {
    const { w, p } = await combatWorld();
    for (const a of [eq(4, 'bolt'), eq(-1, 'bolt'), eq(1.5, 'bolt'), { kind: 'equipSpell', slot: 0, spell: 'nope' } as unknown as UiAction, { kind: 'equipSpell', slot: 0, spell: 'constructor' } as unknown as UiAction]) {
      expect(evs(step(w, ui([a])), 'refused'), JSON.stringify(a)).toMatchObject([{ action: 'equipSpell' }]);
    }
    expect(p.progress!.loadout).toEqual(['bolt', 'blast', 'frostNova', 'chainZap']);
    w.dispose();
  });

  it('a swap into the loadout gets max(remaining, max(full, 180)): Bolt 180, Frost Nova 480', async () => {
    const { w, p } = await combatWorld();
    step(w, ui([eq(0, null), eq(2, null)]));
    expect(p.progress!.loadout).toEqual([null, 'blast', null, 'chainZap']);
    p.combat!.cooldowns = {};
    const e = step(w, ui([eq(0, 'bolt'), eq(2, 'frostNova')]));
    expect(evs(e, 'spellEquipped')).toMatchObject([
      { slot: 0, spell: 'bolt', cooldown: SWAP_MIN_COOLDOWN, free: false },
      { slot: 2, spell: 'frostNova', cooldown: SPELLS.frostNova.cooldown, free: false },
    ]);
    // The cooldowns tick down from there (this tick's own decrement included).
    expect(p.combat!.cooldowns.bolt).toBe(SWAP_MIN_COOLDOWN - 1);
    expect(p.combat!.cooldowns.frostNova).toBe(480 - 1);
    expect(evs(step(w, press(BTN.spell1)), 'cooldown')).toMatchObject([{ spell: 'bolt' }]);
    for (let i = 0; i < SWAP_MIN_COOLDOWN; i++) step(w);
    expect(evs(step(w, press(BTN.spell1)), 'castStart')).toMatchObject([{ spell: 'bolt' }]);
    w.dispose();
  });

  it('a swap never shortens a cooldown: a longer remaining one is kept', async () => {
    const { w, p } = await combatWorld();
    step(w, ui([eq(2, null)]));
    p.combat!.cooldowns.frostNova = 700; // e.g. a long effect still counting down
    const e = step(w, ui([eq(2, 'frostNova')]));
    expect(evs(e, 'spellEquipped')).toMatchObject([{ cooldown: 700 }]);
    expect(p.combat!.cooldowns.frostNova).toBe(699);
    // Swapping out and straight back in gives nothing back either.
    for (let i = 0; i < 400; i++) step(w);
    const left = p.combat!.cooldowns.frostNova!;
    step(w, ui([eq(2, null)]));
    step(w, ui([eq(2, 'frostNova')]));
    expect(p.combat!.cooldowns.frostNova!).toBeGreaterThanOrEqual(left - 2);
    expect(p.combat!.cooldowns.frostNova!).toBe(Math.max(left - 1, 480) - 1);
    w.dispose();
  });

  it('a swapped-out power keeps counting down', async () => {
    const { w, p } = await combatWorld();
    p.combat!.cooldowns.blast = 100;
    step(w, ui([eq(1, null)]));
    for (let i = 0; i < 50; i++) step(w);
    expect(p.combat!.cooldowns.blast).toBe(49);
    w.dispose();
  });

  it('a duplicate moves: equipping a slotted spell elsewhere empties its old slot and keeps its cooldown', async () => {
    const { w, p } = await combatWorld();
    p.combat!.cooldowns = { blast: 20 };
    const e = step(w, ui([eq(0, 'blast')]));
    expect(p.progress!.loadout).toEqual(['blast', null, 'frostNova', 'chainZap']);
    expect(new Set(p.progress!.loadout.filter(Boolean)).size).toBe(3);
    expect(evs(e, 'spellEquipped')).toMatchObject([{ slot: 0, spell: 'blast', cooldown: 20 }]);
    expect(p.combat!.cooldowns.blast).toBe(19);
    // The same spell in the same slot is a no-op.
    expect(evs(step(w, ui([eq(0, 'blast')])), 'spellEquipped')).toEqual([]);
    w.dispose();
  });

  it('a swap during a cast is refused (before and after the release)', async () => {
    const { w, p } = await combatWorld();
    p.combat!.cooldowns = {};
    step(w, press(BTN.spell1));
    expect(p.combat!.action?.kind).toBe('cast');
    const e = step(w, ui([eq(0, 'chainZap')]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'equipSpell', reason: 'Finish casting first.' }]);
    for (let i = 0; i < 12; i++) step(w);
    expect(p.combat!.action).toMatchObject({ kind: 'cast', released: true });
    expect(evs(step(w, ui([eq(1, null)])), 'refused')).toMatchObject([{ action: 'equipSpell' }]);
    expect(p.progress!.loadout).toEqual(['bolt', 'blast', 'frostNova', 'chainZap']);
    w.dispose();
  });

  it('a swap while dead is refused', async () => {
    const { w, p } = await combatWorld();
    p.combat!.action = { kind: 'dead', t: 0 };
    expect(evs(step(w, ui([eq(0, null)])), 'refused')).toMatchObject([{ action: 'equipSpell' }]);
    expect(p.progress!.loadout[0]).toBe('bolt');
    w.dispose();
  });

  it('at a shrine the swap skips the cooldown', async () => {
    const { w, p, prog } = await village();
    applyEffects(rpgCtx(w), p, [{ learnSpell: 'frostNova' }]);
    tick1(w, ui([eq(2, null)]));
    standBy(w, 'shrine_first_light');
    tick1(w, interact());
    expect(prog().atShrine).toBe('shrine_first_light');
    const e = tick1(w, ui([eq(1, 'frostNova')]));
    expect(evs(e, 'spellEquipped')).toMatchObject([{ slot: 1, spell: 'frostNova', cooldown: 0, free: true }]);
    expect(p.combat!.cooldowns.frostNova ?? 0).toBe(0);
    w.dispose();
  });

  it('the rules hold with menus open and on ticks with no other input (a paused tick)', async () => {
    const { w, p } = await combatWorld();
    // Idle ticks carrying only the menu's intents, as App.pausedTick sends them.
    step(w, ui([eq(0, null)]));
    const e = step(w, ui([eq(0, 'bolt'), eq(0, 'nope' as never)]));
    expect(evs(e, 'spellEquipped').length).toBe(1);
    expect(evs(e, 'refused').length).toBe(1);
    expect(p.combat!.cooldowns.bolt).toBe(SWAP_MIN_COOLDOWN - 1);
    w.dispose();
  });
});

describe('the gear lock (expansion plan §1.1)', () => {
  async function owningNobu() {
    const v = await village();
    v.prog().inventory.staff_nobu = 1;
    return v;
  }

  it('out of combat, gear changes', async () => {
    const { w, prog } = await owningNobu();
    expect(w.view().gearLocked(0)).toBe(false);
    const e = tick1(w, ui([{ kind: 'equip', item: 'staff_nobu' }]));
    expect(evs(e, 'equip')).toMatchObject([{ item: 'staff_nobu' }]);
    expect(prog().equipment.staff).toBe('staff_nobu');
    w.dispose();
  });

  it('an enemy targeting you locks gear for 5 s after it last did; spells still swap', async () => {
    const { w, p, prog } = await owningNobu();
    const g = w.spawnEnemy('grunt', { x: p.tf.pos.x, y: VILLAGE_Y, z: p.tf.pos.z + 6 }, Math.PI);
    tick1(w);
    expect(g.brain!.target).toBe(p.id);
    expect(w.view().gearLocked(0)).toBe(true);
    const e = tick1(w, ui([{ kind: 'equip', item: 'staff_nobu' }, eq(0, null)]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'equip', reason: "You can't change gear in combat." }]);
    expect(evs(e, 'spellEquipped').length).toBe(1);
    expect(prog().equipment.staff).toBe('staff_sproto');
    // The grunt leaves (removed by its death): the lock lasts GEAR_LOCK_TICKS after the last targeting.
    g.combat!.action = { kind: 'dead', t: 0 };
    g.brain!.target = null;
    const lastTargeted = p.combat!.targetedAt;
    while (w.now - lastTargeted < GEAR_LOCK_TICKS) {
      expect(evs(tick1(w, ui([{ kind: 'equip', item: 'staff_nobu' }])), 'refused').length).toBe(1);
    }
    expect(w.view().gearLocked(0)).toBe(false);
    expect(evs(tick1(w, ui([{ kind: 'equip', item: 'staff_nobu' }])), 'equip').length).toBe(1);
    w.dispose();
  });

  for (const dummy of ['dummy_passive', 'dummy_swing', 'dummy_shooter']) {
    it(`a training dummy (${dummy}) is not combat`, async () => {
      const { w, p } = await owningNobu();
      w.spawnEnemy(dummy, { x: p.tf.pos.x, y: VILLAGE_Y, z: p.tf.pos.z + 2 }, Math.PI);
      for (let i = 0; i < 5; i++) tick1(w);
      expect(w.view().gearLocked(0)).toBe(false);
      w.dispose();
    });
  }

  it('at a shrine, gear changes even in combat', async () => {
    const { w, p, prog } = await owningNobu();
    standBy(w, 'shrine_first_light');
    w.spawnEnemy('grunt', { x: p.tf.pos.x, y: VILLAGE_Y, z: p.tf.pos.z - 6 }, 0);
    tick1(w, interact());
    expect(prog().atShrine).toBe('shrine_first_light');
    // A shrine is safe ground, so the Grunt never targets you there. Had something just done so:
    expect(p.combat!.targetedAt).not.toBe(w.now - 1);
    p.combat!.targetedAt = w.now - 1;
    expect(w.view().gearLocked(0)).toBe(false);
    expect(evs(tick1(w, ui([{ kind: 'equip', item: 'staff_nobu' }])), 'equip').length).toBe(1);
    w.dispose();
  });

  it('idle ticks still count down the lock (a paused tick is a tick)', async () => {
    const { w, p } = await owningNobu();
    p.combat!.targetedAt = w.now - 1;
    expect(w.view().gearLocked(0)).toBe(true);
    for (let i = 0; i < GEAR_LOCK_TICKS; i++) step(w, idle());
    expect(w.view().gearLocked(0)).toBe(false);
    w.dispose();
  });
});
