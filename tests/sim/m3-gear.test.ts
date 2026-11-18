import { describe, expect, it } from 'vitest';
import { ROLL } from '../../src/content/combat';
import { WOVEN } from '../../src/content/spells';
import { computeDamage, type HitInfo } from '../../src/sim/combat/hits';
import { spellPower } from '../../src/sim/combat/spells';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, combatWorld, hitsOn, hold, idle, ofType, press, step, stepN } from './combatHelpers';
import { evs, tick1, ui, village } from './m3Helpers';

/** Plan §5 gear: staffs (§4.6 table), robes (defense), the six data-only charms. Equipped by command. */

const equip = (item: string) => ui([{ kind: 'equip', item }]);
const own = (p: Entity, ...items: string[]) => {
  for (const i of items) p.progress!.inventory[i] = 1;
};

/** light1 on a 0-defense level-1 dummy 1.5 m ahead: its damage. */
function light1On(w: SimWorld, p: Entity): number {
  const d = w.spawnEnemy('dummy_passive', { x: p.tf.pos.x, y: p.tf.pos.y, z: p.tf.pos.z + 1.5 }, Math.PI);
  p.tf.yaw = 0;
  const out = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
  const hits = hitsOn(out, d.id);
  expect(hits.length).toBe(1);
  return hits[0].ev.damage;
}

const info = (over: Partial<HitInfo> = {}): HitInfo => ({
  move: 'test', base: 100, kind: 'physical', poise: 10, hitstun: 0, knockdown: false, pushback: 0, hitstop: 0,
  unblockable: false, heavy: false, crit: false, mana: 0, from: { x: 0, y: 0, z: 0 }, projectile: false, ...over,
});

describe('equip (plan §2.2: equip{item}, validated by the sim)', () => {
  it('equipping a staff you do not own is refused and changes nothing', async () => {
    const { w, p } = await combatWorld();
    const e = step(w, equip('staff_nobu'));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'equip', reason: "You don't have that." }]);
    expect(p.progress!.equipment.staff).toBe('staff_sproto');
    expect(evs(step(w, equip('no_such_item')), 'refused').length).toBe(1);
    // A non-gear item you own can't be equipped either.
    own(p, 'sprout_seed');
    expect(evs(step(w, equip('sprout_seed')), 'refused').length).toBe(1);
    w.dispose();
  });

  it('Nobu (owned): light1 hits for 26 instead of 20; spell power unchanged (1.0)', async () => {
    const { w, p } = await combatWorld();
    const before = spellPower('bolt', false, p);
    own(p, 'staff_nobu');
    const e = step(w, equip('staff_nobu'));
    expect(evs(e, 'equip')).toMatchObject([{ item: 'staff_nobu', slot: 'staff' }]);
    expect(p.progress!.equipment.staff).toBe('staff_nobu');
    expect(spellPower('bolt', false, p)).toBeCloseTo(before, 9);
    expect(light1On(w, p)).toBe(26);
    w.dispose();
  });

  it('the Sprout Staff: light1 20 (baseline)', async () => {
    const { w, p } = await combatWorld();
    expect(light1On(w, p)).toBe(20);
    w.dispose();
  });

  it('Moonward: spell power ×1.35 (and melee 18)', async () => {
    const { w, p } = await combatWorld();
    const before = spellPower('blast', false, p);
    own(p, 'staff_moonward');
    step(w, equip('staff_moonward'));
    expect(spellPower('blast', false, p) / before).toBeCloseTo(1.35, 9);
    expect(light1On(w, p)).toBe(18);
    w.dispose();
  });

  it('a robe adds defense, which reduces damage taken (Warden: 8 physical / 4 arcane)', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 30 }, Math.PI);
    g.combat!.level = p.combat!.level;
    expect(computeDamage(g, p, info()).damage).toBe(100);
    own(p, 'robe_warden');
    step(w, equip('robe_warden'));
    expect(p.progress!.equipment.robe).toBe('robe_warden');
    expect(p.combat!.defense).toEqual({ physical: 8, arcane: 4 });
    expect(computeDamage(g, p, info()).damage).toBe(Math.round(10000 / 108)); // 93
    expect(computeDamage(g, p, info({ kind: 'arcane' })).damage).toBe(Math.round(10000 / 104)); // 96
    w.dispose();
  });
});

describe('charms (plan §5: six, data-only)', () => {
  it('equipping the charm you wear takes it off', async () => {
    const { w, p } = await combatWorld();
    own(p, 'charm_iron_root');
    step(w, equip('charm_iron_root'));
    expect(p.progress!.equipment.charm).toBe('charm_iron_root');
    step(w, equip('charm_iron_root'));
    expect(p.progress!.equipment.charm).toBeNull();
    w.dispose();
  });

  it(`Quick Step: a roll costs ${ROLL.stamina} × 0.85 stamina`, async () => {
    const roll = async (charm: boolean) => {
      const { w, p } = await combatWorld();
      if (charm) {
        own(p, 'charm_quick_step');
        step(w, equip('charm_quick_step'));
      }
      const before = p.vitals!.stamina;
      step(w, press(BTN.dodge, { move: { x: 0, y: 1 } }));
      expect(p.combat!.action?.kind).toBe('dodge');
      const cost = before - p.vitals!.stamina;
      w.dispose();
      return cost;
    };
    expect(await roll(false)).toBeCloseTo(ROLL.stamina, 9);
    expect(await roll(true)).toBeCloseTo(ROLL.stamina * 0.85, 9);
  });

  it('Second Wind: +1 tonic charge (max and current); taking it off removes it', async () => {
    const { w, p } = await combatWorld();
    own(p, 'charm_second_wind');
    step(w, equip('charm_second_wind'));
    expect(p.progress!.tonics).toEqual({ charges: 4, max: 4 });
    step(w, equip('charm_second_wind'));
    expect(p.progress!.tonics).toEqual({ charges: 3, max: 3 });
    w.dispose();
  });

  it("Scholar's Knot: woven spells ×1.45 (WOVEN 1.2 + 0.25) instead of ×1.2", async () => {
    const { w, p } = await combatWorld();
    expect(spellPower('bolt', true, p) / spellPower('bolt', false, p)).toBeCloseTo(WOVEN.damage, 9);
    own(p, 'charm_scholars_knot');
    step(w, equip('charm_scholars_knot'));
    expect(spellPower('bolt', true, p) / spellPower('bolt', false, p)).toBeCloseTo(1.45, 9);
    w.dispose();
  });

  it('Iron Root: defense ×1.1 (both kinds, rounded)', async () => {
    const { w, p } = await combatWorld();
    own(p, 'robe_quarryproof', 'charm_iron_root');
    step(w, ui([{ kind: 'equip', item: 'robe_quarryproof' }, { kind: 'equip', item: 'charm_iron_root' }]));
    expect(p.combat!.defense).toEqual({ physical: Math.round(16 * 1.1), arcane: Math.round(10 * 1.1) });
    w.dispose();
  });

  it('Spark Catcher: +2 mana per landed melee hit', async () => {
    const gain = async (charm: boolean) => {
      const { w, p } = await combatWorld();
      if (charm) {
        own(p, 'charm_spark_catcher');
        step(w, equip('charm_spark_catcher'));
      }
      p.vitals!.mana = 40;
      const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
      const out = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
      expect(hitsOn(out, d.id).length).toBe(1);
      const m = p.vitals!.mana;
      w.dispose();
      return m;
    };
    expect((await gain(true)) - (await gain(false))).toBeCloseTo(2, 9);
  });

  it('Ember Heart: a parry sets the attacker burning; without it, no burn', async () => {
    const parry = async (charm: boolean) => {
      const { w, p } = await combatWorld();
      if (charm) {
        own(p, 'charm_ember_heart');
        step(w, equip('charm_ember_heart'));
      }
      const d = w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
      // The swinging dummy connects on world tick 54 (combat-block.test.ts); raise block 5 ticks before.
      const out = stepN(w, 56 - w.now, () => (w.now >= 49 ? hold(BTN.block) : idle()));
      expect(ofType(out, 'parry').length).toBe(1);
      const burning = !!d.statuses?.burn;
      w.dispose();
      return burning;
    };
    expect(await parry(false)).toBe(false);
    expect(await parry(true)).toBe(true);
  });
});

describe('gear in the village', () => {
  it('equip works outside menus; equipping in the streamed world uses the same rules', async () => {
    const { w, p, prog } = await village();
    const e = tick1(w, equip('staff_nobu'));
    expect(evs(e, 'refused').length).toBe(1);
    own(p, 'staff_nobu');
    tick1(w, equip('staff_nobu'));
    expect(prog().equipment.staff).toBe('staff_nobu');
    w.dispose();
  });
});
