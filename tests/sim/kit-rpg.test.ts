import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { ITEMS } from '../../src/content/items';
import { MERCHANTS } from '../../src/content/loot';
import { LEVEL_CAP, SKILL_MAX_RANK, pointsForLevel, xpForLevel } from '../../src/content/progression';
import type { UiAction } from '../../src/sim/commands';
import { kill } from '../../src/sim/combat/hits';
import { applyEffects, grantXp } from '../../src/sim/systems/rpg';
import { combatWorld, idle, step, stepN } from './combatHelpers';
import { ctxOf } from './m1bHelpers';
import { evs, rpgCtx, ui } from './m3Helpers';

/** The RPG layer's rules under abuse: menus while dead, gear loops, bad ids, the level cap, respecs. */

const equip = (item: string): UiAction => ({ kind: 'equip', item });

describe('Second Wind cannot refill your tonics', () => {
  it('taking the charm off and on again gives nothing back', async () => {
    const { w, p } = await combatWorld();
    p.progress!.inventory.charm_second_wind = 1;
    p.progress!.tonics.charges = 0;
    for (let i = 0; i < 6; i++) step(w, ui([equip('charm_second_wind')]));
    expect(p.progress!.tonics.charges).toBe(0);
    w.dispose();
  });

  it('nor does drinking the spare charge between swaps', async () => {
    const { w, p } = await combatWorld();
    p.progress!.inventory.charm_second_wind = 1;
    step(w, ui([equip('charm_second_wind')]));
    expect(p.progress!.tonics).toEqual({ charges: 4, max: 4 });
    p.progress!.tonics.charges = 1;
    step(w, ui([equip('charm_second_wind')])); // off
    step(w, ui([equip('charm_second_wind')])); // on
    expect(p.progress!.tonics.charges).toBeLessThanOrEqual(1);
    w.dispose();
  });
});

describe('menu intents from a dead player', () => {
  async function corpse() {
    const { w, p } = await combatWorld();
    kill(ctxOf(w), p, null);
    step(w);
    expect(p.combat!.action?.kind).toBe('dead');
    return { w, p };
  }

  it('resting at the shrine you died at does not heal a corpse', async () => {
    const { w, p } = await corpse();
    p.progress!.atShrine = 'shrine_first_light';
    const e = step(w, ui([{ kind: 'rest' }]));
    expect(evs(e, 'shrineRest')).toEqual([]);
    expect(p.vitals!.hp).toBe(0);
    w.dispose();
  });

  it('spending a point on Defense does not put health on a corpse', async () => {
    const { w, p } = await corpse();
    p.progress!.points = 1;
    step(w, ui([{ kind: 'spendSkill', skill: 'defense' }]));
    expect(p.vitals!.hp).toBe(0);
    w.dispose();
  });

  it('a level-up from a kill that lands after you fell does not either', async () => {
    const { w, p } = await corpse();
    grantXp(rpgCtx(w), p, xpForLevel(3));
    expect(p.progress!.level).toBe(3);
    expect(p.vitals!.hp).toBe(0);
    w.dispose();
  });

  it('buying and changing gear wait until you are back', async () => {
    const { w, p } = await corpse();
    const merchant = Object.keys(MERCHANTS)[0];
    const item = Object.keys(MERCHANTS[merchant].stock)[0];
    p.progress!.shop = merchant;
    p.progress!.sprouts = 100000;
    p.progress!.inventory.staff_nobu = 1;
    step(w, ui([{ kind: 'buy', merchant, item }, equip('staff_nobu')]));
    expect(p.progress!.sprouts).toBe(100000);
    expect(p.progress!.equipment.staff).toBe('staff_sproto');
    w.dispose();
  });

  it('the respawn still brings you back whole', async () => {
    const { w, p } = await corpse();
    stepN(w, PLAYER_STATS.respawnTicks + 2);
    expect(p.combat!.action).toBeNull();
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });
});

describe('the merchant', () => {
  it.each(['constructor', 'toString', '__proto__'])('%s is not for sale', async (item) => {
    const { w, p } = await combatWorld();
    const merchant = Object.keys(MERCHANTS)[0];
    p.progress!.shop = merchant;
    const before = JSON.stringify(p.progress!.inventory);
    const e = step(w, ui([{ kind: 'buy', merchant, item }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'buy' }]);
    expect(evs(e, 'bought')).toEqual([]);
    expect(JSON.stringify(p.progress!.inventory)).toBe(before);
    w.dispose();
  });

  it('too few Sprouts buys nothing and never goes negative', async () => {
    const { w, p } = await combatWorld();
    const merchant = Object.keys(MERCHANTS)[0];
    const item = Object.keys(MERCHANTS[merchant].stock).find((id) => (ITEMS[id]?.price ?? 0) > 0 && !MERCHANTS[merchant].after?.[id])!;
    p.progress!.shop = merchant;
    p.progress!.sprouts = ITEMS[item].price! - 1;
    const e = step(w, ui([{ kind: 'buy', merchant, item }]));
    expect(evs(e, 'bought')).toEqual([]);
    expect(p.progress!.sprouts).toBe(ITEMS[item].price! - 1);
    w.dispose();
  });
});

describe('gear you do not own', () => {
  it.each(['staff_nobu', 'nope', 'constructor', 'tonic_upgrade'])('%s cannot be equipped', async (item) => {
    const { w, p } = await combatWorld();
    const e = step(w, ui([equip(item)]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'equip' }]);
    expect(p.progress!.equipment.staff).toBe('staff_sproto');
    w.dispose();
  });
});

describe('levels and skill points', () => {
  it('stops at the cap: XP still counts, no level or points beyond it', async () => {
    const { w, p } = await combatWorld();
    grantXp(rpgCtx(w), p, xpForLevel(LEVEL_CAP) * 3);
    expect(p.progress!.level).toBe(LEVEL_CAP);
    expect(p.progress!.points).toBe(pointsForLevel(LEVEL_CAP));
    grantXp(rpgCtx(w), p, 100000);
    expect(p.progress!.level).toBe(LEVEL_CAP);
    expect(p.progress!.points).toBe(pointsForLevel(LEVEL_CAP));
    w.dispose();
  });

  it('a respec gives back every rank, keeps boss points and clamps what the ranks gave', async () => {
    const { w, p } = await combatWorld();
    grantXp(rpgCtx(w), p, xpForLevel(11));
    applyEffects(rpgCtx(w), p, [{ skillPoints: 1 }]);
    const total = p.progress!.points;
    for (let i = 0; i < SKILL_MAX_RANK + 1; i++) step(w, ui([{ kind: 'spendSkill', skill: 'focus' }]));
    expect(p.progress!.skills.focus).toBe(SKILL_MAX_RANK);
    p.vitals!.mana = p.vitals!.manaMax;
    p.progress!.atShrine = 'shrine_first_light';
    p.progress!.sprouts = 5000;
    step(w, ui([{ kind: 'respecSkills' }]));
    expect(p.progress!.points).toBe(total);
    expect(p.progress!.skills.focus).toBe(0);
    expect(p.vitals!.mana).toBeLessThanOrEqual(p.vitals!.manaMax);
    expect(Number.isFinite(p.vitals!.mana)).toBe(true);
    w.dispose();
  });

  it('a respec you cannot afford changes nothing', async () => {
    const { w, p } = await combatWorld();
    grantXp(rpgCtx(w), p, xpForLevel(4));
    step(w, ui([{ kind: 'spendSkill', skill: 'attack' }]));
    p.progress!.atShrine = 'shrine_first_light';
    p.progress!.sprouts = 1;
    const e = step(w, ui([{ kind: 'respecSkills' }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'respecSkills' }]);
    expect(p.progress!.skills.attack).toBe(1);
    expect(p.progress!.sprouts).toBe(1);
    step(w, idle());
    w.dispose();
  });
});
