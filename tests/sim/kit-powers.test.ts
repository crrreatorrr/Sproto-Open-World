import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { TRAIT } from '../../src/content/packs/c2';
import { POWER } from '../../src/content/packs/c3';
import { SPELLS, type SpellId } from '../../src/content/spells';
import type { UiAction } from '../../src/sim/commands';
import { kill, type HitInfo } from '../../src/sim/combat/hits';
import { wardProjectile } from '../../src/sim/combat/powers/mirrorWard';
import { throwVine } from '../../src/sim/combat/powers/vine';
import { staffAfterReaction, staffPushback } from '../../src/sim/combat/staffTraits';
import type { Entity } from '../../src/sim/entity';
import { applyAffix } from '../../src/sim/systems/affixes';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, cmd, combatWorld, hold, idle, press, step, stepN } from './combatHelpers';
import { ctxOf } from './m1bHelpers';
import { ui } from './m3Helpers';

/** The twelve powers from every loadout slot (expansion plan §1.2), the staff traits (§2.1), and how they end. */

const ALL = Object.keys(SPELLS) as SpellId[];
const SLOT_BTN = [BTN.spell1, BTN.spell2, BTN.spell3, BTN.spell4] as const;
const eq = (slot: number, spell: SpellId | null): UiAction => ({ kind: 'equipSpell', slot, spell });

/** A yard with a target dummy ahead, `spell` in `slot`, off cooldown, with the Surge meter full. */
async function armed(spell: SpellId, slot: number) {
  const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
  const dummy = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 5 }, Math.PI);
  step(w, ui([eq(slot, spell)]));
  expect(p.progress!.loadout[slot]).toBe(spell);
  p.combat!.cooldowns = {};
  (p.powers ??= {}).surge = POWER.surge.max;
  return { w, p, dummy };
}

const areas = (w: SimWorld) => w.entities.filter((e) => e.powerArea);

describe.each(ALL)('%s', (spell) => {
  it.each([0, 1, 2, 3])('from slot %i: pays its cost, goes on cooldown at the release and ends', async (slot) => {
    const { w, p } = await armed(spell, slot);
    const def = SPELLS[spell];
    p.vitals!.mana = p.vitals!.manaMax = 200;
    const ev = step(w, press(SLOT_BTN[slot]));
    expect(ev.filter((e) => e.type === 'castStart'), JSON.stringify(ev)).toMatchObject([{ spell }]);
    expect(200 - p.vitals!.mana).toBeLessThanOrEqual(def.cost);
    expect(200 - p.vitals!.mana).toBeGreaterThan(def.cost - 1);
    let cooldownAtRelease = -1;
    for (let i = 0; i < 400 && p.combat!.action; i++) if (step(w).some((e) => e.type === 'cast')) cooldownAtRelease = p.combat!.cooldowns[spell] ?? 0;
    expect(cooldownAtRelease).toBe(def.cooldown);
    expect(p.combat!.action).toBeNull();
    w.dispose();
  });

  it('dying mid-cast ends it: nothing fires and no effect is left after the respawn', async () => {
    const { w, p } = await armed(spell, 0);
    step(w, press(BTN.spell1));
    kill(ctxOf(w), p, null);
    const ev = stepN(w, PLAYER_STATS.respawnTicks + 5).map((x) => x.ev);
    expect(ev.filter((e) => e.type === 'cast')).toEqual([]);
    expect(p.combat!.action).toBeNull();
    expect(p.powers).toBeUndefined();
    expect(areas(w)).toEqual([]);
    w.dispose();
  });

  it('a stagger mid-cast ends it without a release or a cooldown', async () => {
    const { w, p } = await armed(spell, 0);
    step(w, press(BTN.spell1));
    p.combat!.action = { kind: 'stagger', t: 0, dur: 5 };
    const ev = stepN(w, 40).map((x) => x.ev);
    expect(ev.filter((e) => e.type === 'cast')).toEqual([]);
    expect(p.combat!.cooldowns[spell] ?? 0).toBe(0);
    w.dispose();
  });
});

describe('effects that must not outlive their caster', () => {
  it.each(['brambleWall', 'healingBloom'] as const)('%s is gone once its owner dies', async (spell) => {
    const { w, p } = await armed(spell, 0);
    step(w, press(BTN.spell1));
    for (let i = 0; i < 40 && !areas(w).length; i++) step(w);
    expect(areas(w)).toHaveLength(1);
    kill(ctxOf(w), p, null);
    stepN(w, 2);
    expect(areas(w)).toEqual([]);
    w.dispose();
  });

  it("a dead caster's wall can't go on biting", async () => {
    const { w, p } = await armed('brambleWall', 0);
    step(w, press(BTN.spell1));
    for (let i = 0; i < 40 && !areas(w).length; i++) step(w);
    const wall = areas(w)[0];
    const grunt = w.spawnEnemy('grunt', { x: wall.tf.pos.x, y: 0, z: wall.tf.pos.z + 0.6 }, 0);
    kill(ctxOf(w), p, null);
    const hits = stepN(w, 100).map((x) => x.ev).filter((e) => e.type === 'hit' && e.target === grunt.id);
    expect(hits).toEqual([]);
    w.dispose();
  });
});

describe('a dead player', () => {
  it('stays where it fell, whatever the stick and the jump button say', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 0 } });
    stepN(w, 5);
    kill(ctxOf(w), p, null);
    const at = { ...p.tf.pos };
    for (let i = 0; i < 60; i++) step(w, cmd({ move: { x: 0, y: 1 }, hold: BTN.sprint, press: i === 10 ? BTN.jump : 0 }));
    expect(p.combat!.action?.kind).toBe('dead');
    expect(Math.hypot(p.tf.pos.x - at.x, p.tf.pos.z - at.z)).toBeLessThan(1e-6);
    expect(p.tf.pos.y).toBeCloseTo(at.y, 3);
    w.dispose();
  });
});

describe('Protection (expansion plan §7.2)', () => {
  const shot = (owner: Entity, at: Entity): Entity => ({
    id: 9999, kind: 'projectile',
    tf: { pos: { x: at.tf.pos.x, y: at.tf.pos.y + 0.9, z: at.tf.pos.z + 1 }, prevPos: { x: 0, y: 0, z: 0 }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: -10 } },
    projectile: { owner: owner.id, team: 'enemy', kind: 'arcane', damage: 10, poise: 1, radius: 0.2, life: 60, reflected: false },
    view: { model: 'hex' },
  });

  it('widens the Mirror Ward reflect window', async () => {
    const { w, p } = await combatWorld();
    const foe = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 8 }, Math.PI);
    p.powers = { ward: { t: POWER.ward.reflectTicks + 2, dur: 200 } };
    const a = shot(foe, p);
    expect(wardProjectile(ctxOf(w), a, a.tf.pos, { ...a.tf.pos, z: a.tf.pos.z - 0.2 })).toBe('blocked');
    p.progress!.skills.protection = 10;
    const b = shot(foe, p);
    expect(wardProjectile(ctxOf(w), b, b.tf.pos, { ...b.tf.pos, z: b.tf.pos.z - 0.2 })).toBe('reflected');
    w.dispose();
  });
});

describe('a Colossal champion (an elite by affix) is no light enemy', () => {
  const bolt = { move: 'bolt', pushback: 0.3, heavy: false, projectile: true } as HitInfo;

  async function champion() {
    const { w, p } = await combatWorld();
    const foe = w.spawnEnemy('grunt', { x: 0, y: 0, z: 6 }, Math.PI);
    applyAffix(foe, 'colossal');
    return { w, p, foe };
  }

  it('Shove does not throw it back', async () => {
    const { w, p, foe } = await champion();
    p.progress!.equipment.staff = 'staff_nobu';
    expect(staffPushback(p, foe, bolt)).toBe(bolt.pushback);
    w.dispose();
  });

  it('Abduct does not lift it', async () => {
    const { w, p, foe } = await champion();
    p.progress!.equipment.staff = 'staff_alien_ray';
    staffAfterReaction(ctxOf(w), p, foe, bolt);
    expect(foe.combat!.action).toBeNull();
    w.dispose();
  });

  it('Vine Pull reels the caster in instead', async () => {
    const { w, p, foe } = await champion();
    throwVine(ctxOf(w), p, 5, w.physics);
    expect(foe.combat!.push).toBeNull();
    expect(p.combat!.push).not.toBeNull();
    w.dispose();
  });
});

describe('Vine Pull on a frozen enemy', () => {
  it('leaves it frozen', async () => {
    const { w, p } = await combatWorld();
    const foe = w.spawnEnemy('grunt', { x: 0, y: 0, z: 6 }, Math.PI);
    foe.combat!.action = { kind: 'frozen', t: 0, dur: 100 };
    throwVine(ctxOf(w), p, 5, w.physics);
    expect(foe.combat!.action?.kind).toBe('frozen');
    w.dispose();
  });
});

describe('staff traits apply only while that staff is equipped', () => {
  const equip = (item: string): UiAction => ({ kind: 'equip', item });

  it('Moonlit: 15% off with Moonward, the full price after swapping away', async () => {
    const { w, p } = await combatWorld();
    p.progress!.inventory.staff_moonward = 1;
    step(w, ui([equip('staff_moonward')]));
    p.combat!.cooldowns = {};
    p.vitals!.mana = 100;
    step(w, press(BTN.spell1));
    expect(100 - p.vitals!.mana).toBeLessThan(SPELLS.bolt.cost * TRAIT.moonlit.cost + 1e-6);
    stepN(w, 40);
    step(w, ui([equip('staff_sproto')]));
    p.combat!.cooldowns = {};
    p.vitals!.mana = 100;
    step(w, press(BTN.spell1));
    expect(100 - p.vitals!.mana).toBeGreaterThan(SPELLS.bolt.cost * TRAIT.moonlit.cost + 0.5);
    w.dispose();
  });

  it('Charged Bolt: holding charges with the Shooter only, for ×2 mana at most', async () => {
    const { w, p } = await combatWorld();
    p.progress!.inventory.staff_shooter = 1;
    step(w, ui([equip('staff_shooter')]));
    p.combat!.cooldowns = {};
    p.vitals!.mana = p.vitals!.manaMax = 100;
    step(w, press(BTN.spell1));
    let held = 0;
    while (p.combat!.action?.kind === 'cast' && !p.combat!.action.released && held < 200) {
      step(w, hold(BTN.spell1));
      held++;
    }
    expect(held).toBeGreaterThanOrEqual(TRAIT.chargedBolt.ticks);
    expect(held).toBeLessThanOrEqual(TRAIT.chargedBolt.ticks + SPELLS.bolt.release + 1);
    // Mana regenerates a little as it charges, so what's gone is at most the ×2 price.
    expect(100 - p.vitals!.mana).toBeLessThanOrEqual(SPELLS.bolt.cost * TRAIT.chargedBolt.mana + 1e-6);
    stepN(w, 30);
    step(w, ui([equip('staff_sproto')]));
    p.combat!.cooldowns = {};
    step(w, press(BTN.spell1));
    let plain = 0;
    while (p.combat!.action?.kind === 'cast' && !p.combat!.action.released && plain < 200) {
      step(w, hold(BTN.spell1));
      plain++;
    }
    expect(plain).toBeLessThanOrEqual(SPELLS.bolt.release);
    w.dispose();
  });

  it('Brawler: a fourth light with the Fighter only', async () => {
    const chain = async (staff: string) => {
      const { w, p } = await combatWorld();
      p.progress!.inventory[staff] = 1;
      step(w, ui([equip(staff)]));
      const moves: string[] = [];
      for (let i = 0; i < 260; i++) {
        step(w, i % 6 === 0 ? press(BTN.light) : idle());
        p.vitals!.stamina = p.vitals!.staminaMax;
        const a = p.combat!.action;
        if (a?.kind === 'attack' && moves[moves.length - 1] !== a.move) moves.push(a.move as string);
      }
      w.dispose();
      return moves;
    };
    expect((await chain('staff_fighter')).slice(0, 5)).toEqual(['light1', 'light2', 'light3', 'light4', 'light1']);
    expect((await chain('staff_sproto')).slice(0, 4)).toEqual(['light1', 'light2', 'light3', 'light1']);
  });
});
