import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { TONIC } from '../../src/content/items';
import { kill } from '../../src/sim/combat/hits';
import { applyEffects } from '../../src/sim/systems/rpg';
import { BTN, combatWorld, press, step } from './combatHelpers';
import { ctxOf } from './m1bHelpers';
import { evs, rpgCtx, standBy, tick1, ui, village, VILLAGE_START, VILLAGE_Y } from './m3Helpers';

/** Plan §4.5 Sprout Tonic, §4.4 learned spells, §2.9 death in the world. */

describe('Sprout Tonic (BTN.potion)', () => {
  it(`drinks: one charge, ${TONIC.heal * 100}% of max HP over ${TONIC.healTicks} ticks, locked ${TONIC.lockTicks} ticks`, async () => {
    const { w, p, prog } = await village();
    p.vitals!.hp = 20;
    const max = p.vitals!.hpMax;
    const e = tick1(w, ui([], BTN.potion));
    expect(evs(e, 'drink')).toMatchObject([{ entity: p.id, charges: TONIC.charges - 1 }]);
    expect(prog().tonics.charges).toBe(TONIC.charges - 1);
    expect(p.combat!.action?.kind).toBe('drink');
    let healTicks = 0;
    let last = p.vitals!.hp;
    if (last > 20) healTicks++;
    let free = -1;
    for (let i = 1; i < 60 && free < 0; i++) {
      // Attack presses during the drink lock don't cut it short (one may be buffered for after).
      tick1(w, ui([], i % 7 === 0 ? BTN.light : 0));
      if (p.vitals!.hp > last + 1e-9) healTicks++;
      last = p.vitals!.hp;
      if (p.combat!.action?.kind !== 'drink') free = i;
    }
    expect(healTicks).toBe(TONIC.healTicks);
    expect(p.vitals!.hp).toBeCloseTo(20 + max * TONIC.heal, 6);
    // The press tick is the lock's first tick (the drink advances to t = 1 on it), so the lock ends
    // on press + 39: 40 ticks counting the one it ends on. (Ambiguity noted in the M3 test report.)
    expect(free).toBe(TONIC.lockTicks - 1);
    w.dispose();
  });

  it('heals no further than max HP', async () => {
    const { w, p } = await village();
    p.vitals!.hp = p.vitals!.hpMax - 5;
    tick1(w, ui([], BTN.potion));
    for (let i = 0; i < 45; i++) tick1(w);
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });

  it('at 0 charges it is refused and nothing happens', async () => {
    const { w, p, prog } = await village();
    prog().tonics.charges = 0;
    p.vitals!.hp = 20;
    const e = tick1(w, ui([], BTN.potion));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'potion' }]);
    expect(evs(e, 'drink')).toEqual([]);
    expect(p.combat!.action).toBeNull();
    expect(prog().tonics.charges).toBe(0);
    w.dispose();
  });

  it('a press during another action (an attack) does not drink', async () => {
    const { w, p, prog } = await village();
    tick1(w, ui([], BTN.light));
    expect(p.combat!.action?.kind).toBe('attack');
    const e = tick1(w, ui([], BTN.potion));
    expect(evs(e, 'drink')).toEqual([]);
    expect(prog().tonics.charges).toBe(TONIC.charges);
    w.dispose();
  });

  it('three drinks empty the flask; a shrine rest refills it', async () => {
    const { w, prog } = await village();
    for (let k = 0; k < 3; k++) {
      tick1(w, ui([], BTN.potion));
      for (let i = 0; i < TONIC.lockTicks; i++) tick1(w);
    }
    expect(prog().tonics.charges).toBe(0);
    standBy(w, 'shrine_first_light');
    tick1(w, ui([], BTN.interact));
    tick1(w, ui([{ kind: 'rest' }]));
    expect(prog().tonics.charges).toBe(3);
    w.dispose();
  });
});

describe('learned spells (plan §4.4, §5 learnSpell)', () => {
  it('in a populated world only Bolt is known: Blast is refused (no mana spent) until learned', async () => {
    const { w, p, prog } = await village();
    expect(prog().spells).toEqual(['bolt']);
    const e = tick1(w, ui([], BTN.spell2));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'cast' }]);
    expect(evs(e, 'castStart')).toEqual([]);
    expect(p.vitals!.mana).toBe(p.vitals!.manaMax);
    for (const b of [BTN.spell3, BTN.spell4]) expect(evs(tick1(w, ui([], b)), 'refused')).toMatchObject([{ action: 'cast' }]);
    // Bolt works.
    expect(evs(tick1(w, ui([], BTN.spell1)), 'castStart')).toMatchObject([{ spell: 'bolt' }]);
    for (let i = 0; i < 30; i++) tick1(w);
    // learnSpell (a quest or dialogue effect) teaches Blast.
    const events: ReturnType<typeof rpgCtx>['events'] = [];
    applyEffects(rpgCtx(w, events), p, [{ learnSpell: 'blast' }, { learnSpell: 'blast' }]);
    expect(evs(events, 'spellLearned').map((x) => x.spell)).toEqual(['blast']); // once
    expect(prog().spells).toEqual(['bolt', 'blast']);
    expect(evs(tick1(w, ui([], BTN.spell2)), 'castStart')).toMatchObject([{ spell: 'blast' }]);
    w.dispose();
  });

  it('the yard / sandbox world knows all four', async () => {
    const { w, p } = await combatWorld();
    expect([...p.progress!.spells].sort()).toEqual(['blast', 'bolt', 'chainZap', 'frostNova']);
    expect(step(w, press(BTN.spell2)).filter((e) => e.type === 'castStart').length).toBe(1);
    w.dispose();
  });
});

describe('death in the world (plan §2.9)', () => {
  const dieAndWait = (w: Awaited<ReturnType<typeof village>>['w']) => {
    const p = w.playerEntity(0)!;
    kill(ctxOf(w), p, null);
    const out = [];
    for (let i = 0; i <= PLAYER_STATS.respawnTicks + 2; i++) out.push(...tick1(w));
    return out;
  };

  it('respawns at the last shrine rested at, full HP, tonics refilled, menus closed', async () => {
    const { w, p, prog } = await village();
    standBy(w, 'shrine_first_light');
    tick1(w, ui([], BTN.interact));
    tick1(w, ui([{ kind: 'rest' }]));
    tick1(w, ui([{ kind: 'closeMenu' }]));
    prog().tonics.charges = 0;
    // Walk away and die there.
    w.teleportPlayer(0, { x: 300, y: VILLAGE_Y + 0.05, z: 100 });
    tick1(w);
    const out = dieAndWait(w);
    expect(evs(out, 'respawn').filter((x) => x.entity === p.id).length).toBe(1);
    const shrine = w.locate('shrine_first_light')!;
    expect(Math.hypot(p.tf.pos.x - (shrine.x + 1.5), p.tf.pos.z - (shrine.z + 1.5))).toBeLessThan(0.2);
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    expect(prog().tonics.charges).toBe(prog().tonics.max);
    expect(p.combat!.action).toBeNull();
    w.dispose();
  });

  it('with no shrine rested at, respawns at the region start, tonics refilled', async () => {
    const { w, p, prog } = await village();
    prog().tonics.charges = 1;
    w.teleportPlayer(0, { x: 300, y: VILLAGE_Y + 0.05, z: 100 });
    tick1(w);
    dieAndWait(w);
    expect(Math.hypot(p.tf.pos.x - VILLAGE_START[0], p.tf.pos.z - VILLAGE_START[2])).toBeLessThan(0.2);
    expect(prog().tonics.charges).toBe(prog().tonics.max);
    w.dispose();
  });

  it('dying keeps the RPG state (XP, Sprouts, quests, inventory)', async () => {
    const { w, prog } = await village();
    prog().sprouts = 77;
    prog().xp = 30;
    prog().inventory.sprout_seed = 1;
    dieAndWait(w);
    expect(prog().sprouts).toBe(77);
    expect(prog().xp).toBe(30);
    expect(prog().inventory.sprout_seed).toBe(1);
    w.dispose();
  });

  it('a dead player cannot interact or drink', async () => {
    const { w, p, prog } = await village();
    standBy(w, 'elder_pepe');
    kill(ctxOf(w), p, null);
    const e = tick1(w, ui([], BTN.interact | BTN.potion));
    expect(evs(e, 'talk')).toEqual([]);
    expect(evs(e, 'drink')).toEqual([]);
    expect(prog().dialogue).toBeNull();
    w.dispose();
  });
});
