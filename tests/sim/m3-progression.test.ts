import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { LEVEL_CAP, xpForLevel, xpToNext } from '../../src/content/progression';
import { grantXp } from '../../src/sim/systems/rpg';
import { BTN } from './combatHelpers';
import { evs, rpgCtx, standBy, tick1, ui, village } from './m3Helpers';

/** Plan §5 levels and the XP curve; shrines (rest). The skill tree is tests/sim/c1-skills.test.ts. */

describe('XP curve round(60·L^1.45) (plan §5)', () => {
  it('the code follows the formula: 60, 164, 295, 448, 619, 806, 1,008; L6 total 1,586, L7 2,392', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(xpToNext)).toEqual([1, 2, 3, 4, 5, 6, 7].map((l) => Math.round(60 * Math.pow(l, 1.45))));
    expect([1, 2, 3, 4, 5, 6, 7].map(xpToNext)).toEqual([60, 164, 295, 448, 619, 806, 1008]);
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(60);
    expect(xpForLevel(6)).toBe(1586);
    expect(xpForLevel(7)).toBe(2392);
  });

  /**
   * SPEC AMBIGUITY (plan §5, "XP curve `round(60·L^1.45)`: 60, 164, 295, 448, 620, 807, 1,008…
   * L6 is 1,587 and L7 is 2,394"): the listed numbers don't follow the formula (60·5^1.45 = 618.95
   * → 619, 60·6^1.45 = 806.25 → 806). The code follows the formula; this pins the plan's numbers so
   * whoever settles it flips one of the two tests.
   */
});

describe('levelling up', () => {
  it('each level grants 2 skill points and grows max HP/stamina/mana by 12/4/4 (current values grow too)', async () => {
    const { w, p, prog } = await village();
    const events = [] as ReturnType<typeof rpgCtx>['events'];
    const ctx = rpgCtx(w, events);
    p.vitals!.hp = 50;
    grantXp(ctx, p, 59);
    expect(prog().level).toBe(1);
    grantXp(ctx, p, 1);
    expect(prog().level).toBe(2);
    expect(prog().points).toBe(2);
    expect(p.vitals!.hpMax).toBe(PLAYER_STATS.hp + 12);
    expect(p.vitals!.staminaMax).toBe(PLAYER_STATS.stamina + 4);
    expect(p.vitals!.manaMax).toBe(PLAYER_STATS.mana + 4);
    expect(p.vitals!.hp).toBe(62);
    expect(p.combat!.level).toBe(2);
    expect(evs(events, 'levelUp')).toMatchObject([{ entity: p.id, level: 2, points: 2 }]);
    // A big grant crosses several levels at once: one levelUp event per level.
    grantXp(ctx, p, xpForLevel(6) - prog().xp);
    expect(prog().level).toBe(6);
    expect(prog().points).toBe(10);
    expect(evs(events, 'levelUp').map((x) => x.level)).toEqual([2, 3, 4, 5, 6]);
    expect(p.vitals!.hpMax).toBe(PLAYER_STATS.hp + 12 * 5);
    w.dispose();
  });

  it(`caps at level ${LEVEL_CAP}: XP keeps counting, no more points (58 in all)`, async () => {
    const { w, p, prog } = await village();
    expect(LEVEL_CAP).toBe(30);
    expect(xpForLevel(10)).toBe(6075);
    expect(xpForLevel(15)).toBe(17139);
    grantXp(rpgCtx(w), p, xpForLevel(LEVEL_CAP) - 1);
    expect(prog().level).toBe(LEVEL_CAP - 1);
    grantXp(rpgCtx(w), p, 1_000_000);
    expect(prog().level).toBe(LEVEL_CAP);
    expect(prog().points).toBe(58);
    expect(prog().xp).toBe(1_000_000 + xpForLevel(LEVEL_CAP) - 1);
    expect(p.vitals!.hpMax).toBe(PLAYER_STATS.hp + 12 * (LEVEL_CAP - 1));
    w.dispose();
  });

  it('zero or negative XP is ignored', async () => {
    const { w, p, prog } = await village();
    const events = [] as ReturnType<typeof rpgCtx>['events'];
    grantXp(rpgCtx(w, events), p, 0);
    grantXp(rpgCtx(w, events), p, -50);
    expect(prog().xp).toBe(0);
    expect(events).toEqual([]);
    w.dispose();
  });
});

describe('rest at a shrine (plan §5, §2.9)', () => {
  it('heals fully, refills mana, stamina and tonics, clears statuses, sets lastShrine and discovers the shrine', async () => {
    const { w, p, prog } = await village();
    p.vitals!.hp = 10;
    p.vitals!.mana = 5;
    p.vitals!.stamina = 1;
    prog().tonics.charges = 0;
    p.statuses = { burn: { ticks: 100, perTick: 0.1, source: p.id } };
    standBy(w, 'shrine_first_light');
    const e1 = tick1(w, ui([], BTN.interact));
    expect(evs(e1, 'interact')).toMatchObject([{ object: 'shrine_first_light', kind: 'shrine' }]);
    expect(prog().discoveredShrines).toEqual(['shrine_first_light']);
    expect(prog().lastShrine).toBeNull(); // only a rest sets the respawn point
    const e2 = tick1(w, ui([{ kind: 'rest' }]));
    expect(evs(e2, 'shrineRest')).toMatchObject([{ shrine: 'shrine_first_light' }]);
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    expect(p.vitals!.mana).toBe(p.vitals!.manaMax);
    expect(p.vitals!.stamina).toBe(p.vitals!.staminaMax);
    expect(prog().tonics.charges).toBe(prog().tonics.max);
    expect(p.statuses).toBeUndefined();
    expect(prog().lastShrine).toBe('shrine_first_light');
    w.dispose();
  });

  it('rest away from a shrine does nothing', async () => {
    const { w, p, prog } = await village();
    p.vitals!.hp = 10;
    const e = tick1(w, ui([{ kind: 'rest' }]));
    expect(evs(e, 'shrineRest')).toEqual([]);
    expect(p.vitals!.hp).toBeLessThan(20);
    expect(prog().lastShrine).toBeNull();
    w.dispose();
  });

  it('closeMenu leaves the shrine; gameplay input works again', async () => {
    const { w, p, prog } = await village();
    standBy(w, 'shrine_first_light');
    tick1(w, ui([], BTN.interact));
    tick1(w, ui([{ kind: 'closeMenu' }]));
    expect(prog().atShrine).toBeNull();
    tick1(w, ui([], BTN.light));
    expect(p.combat!.action?.kind).toBe('attack');
    w.dispose();
  });
});
