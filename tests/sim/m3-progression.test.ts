import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { GROWTH, LEVEL_CAP, xpForLevel, xpToNext } from '../../src/content/progression';
import { SPELLS } from '../../src/content/spells';
import { spellPower } from '../../src/sim/combat/spells';
import { grantXp } from '../../src/sim/systems/rpg';
import { BTN, hitsOn, idle, press, stepN } from './combatHelpers';
import { evs, rpgCtx, standBy, tick1, ui, village } from './m3Helpers';

/** Plan §5 attributes, levels and the XP curve; shrines (spend points, rest). */

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
  it('each level grants 1 point and grows max HP/stamina/mana by 12/4/4 (current values grow too)', async () => {
    const { w, p, prog } = await village();
    const events = [] as ReturnType<typeof rpgCtx>['events'];
    const ctx = rpgCtx(w, events);
    p.vitals!.hp = 50;
    grantXp(ctx, p, 59);
    expect(prog().level).toBe(1);
    grantXp(ctx, p, 1);
    expect(prog().level).toBe(2);
    expect(prog().points).toBe(1);
    expect(p.vitals!.hpMax).toBe(PLAYER_STATS.hp + 12);
    expect(p.vitals!.staminaMax).toBe(PLAYER_STATS.stamina + 4);
    expect(p.vitals!.manaMax).toBe(PLAYER_STATS.mana + 4);
    expect(p.vitals!.hp).toBe(62);
    expect(p.combat!.level).toBe(2);
    expect(evs(events, 'levelUp')).toMatchObject([{ entity: p.id, level: 2 }]);
    // A big grant crosses several levels at once: one levelUp event per level.
    grantXp(ctx, p, xpForLevel(6) - prog().xp);
    expect(prog().level).toBe(6);
    expect(prog().points).toBe(5);
    expect(evs(events, 'levelUp').map((x) => x.level)).toEqual([2, 3, 4, 5, 6]);
    expect(p.vitals!.hpMax).toBe(PLAYER_STATS.hp + 12 * 5);
    w.dispose();
  });

  it(`caps at level ${LEVEL_CAP}: XP keeps counting, no more points`, async () => {
    const { w, p, prog } = await village();
    grantXp(rpgCtx(w), p, 1_000_000);
    expect(prog().level).toBe(LEVEL_CAP);
    expect(prog().points).toBe(LEVEL_CAP - 1);
    expect(prog().xp).toBe(1_000_000);
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

describe('attributes, spent at a shrine (plan §5)', () => {
  async function atShrineWithPoints(points: number) {
    const v = await village();
    v.prog().points = points;
    standBy(v.w, 'shrine_first_light');
    tick1(v.w, ui([], BTN.interact));
    expect(v.prog().atShrine).toBe('shrine_first_light');
    return v;
  }

  it('spendAttr away from a shrine is refused and changes nothing', async () => {
    const { w, prog } = await village();
    prog().points = 2;
    const e = tick1(w, ui([{ kind: 'spendAttr', attr: 'vitality' }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'spendAttr' }]);
    expect(prog().points).toBe(2);
    expect(prog().attrs.vitality).toBe(0);
    w.dispose();
  });

  it('spendAttr at a shrine with no points is refused', async () => {
    const { w, prog } = await atShrineWithPoints(0);
    const e = tick1(w, ui([{ kind: 'spendAttr', attr: 'might' }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'spendAttr', reason: 'No points to spend.' }]);
    expect(prog().attrs.might).toBe(0);
    w.dispose();
  });

  it('Vitality: +15 max HP per point and +1 defense (both kinds) per 2 points', async () => {
    const { w, p, prog } = await atShrineWithPoints(4);
    const e = tick1(w, ui([{ kind: 'spendAttr', attr: 'vitality' }, { kind: 'spendAttr', attr: 'vitality' }]));
    expect(evs(e, 'attrSpent').map((x) => [x.attr, x.value])).toEqual([['vitality', 1], ['vitality', 2]]);
    expect(prog().points).toBe(2);
    expect(p.vitals!.hpMax).toBe(PLAYER_STATS.hp + 30);
    expect(p.combat!.defense).toEqual({ physical: 1, arcane: 1 });
    tick1(w, ui([{ kind: 'spendAttr', attr: 'vitality' }, { kind: 'spendAttr', attr: 'vitality' }]));
    expect(p.combat!.defense).toEqual({ physical: 2, arcane: 2 });
    expect(GROWTH.vitalityDefense).toBe(0.5);
    w.dispose();
  });

  it('Endurance: +5 max stamina per point', async () => {
    const { w, p } = await atShrineWithPoints(2);
    tick1(w, ui([{ kind: 'spendAttr', attr: 'endurance' }, { kind: 'spendAttr', attr: 'endurance' }]));
    expect(p.vitals!.staminaMax).toBe(PLAYER_STATS.stamina + 10);
    w.dispose();
  });

  it('Arcana: +5 max mana per point and spell power ×(1 + 0.04·Arcana)', async () => {
    const { w, p } = await atShrineWithPoints(5);
    const base = spellPower('bolt', false, p);
    tick1(w, ui(Array.from({ length: 5 }, () => ({ kind: 'spendAttr', attr: 'arcana' }) as const)));
    expect(p.vitals!.manaMax).toBe(PLAYER_STATS.mana + 25);
    expect(spellPower('bolt', false, p)).toBeCloseTo(base * 1.2, 9);
    expect(spellPower('bolt', false, p)).toBeCloseTo(20 * SPELLS.bolt.mv * 1.2, 9);
    w.dispose();
  });

  it("Might: a light's damage ×(1 + 0.04·Might) — light1 20 → 24 at Might 5", async () => {
    const { w, p } = await atShrineWithPoints(5);
    tick1(w, ui(Array.from({ length: 5 }, () => ({ kind: 'spendAttr', attr: 'might' }) as const)));
    tick1(w, ui([{ kind: 'closeMenu' }]));
    const d = w.spawnEnemy('dummy_passive', { x: p.tf.pos.x, y: p.tf.pos.y, z: p.tf.pos.z + 1.5 }, Math.PI);
    p.tf.yaw = 0;
    const out = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(out, d.id).map((x) => [x.ev.move, x.ev.damage])).toEqual([['light1', 24]]);
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
