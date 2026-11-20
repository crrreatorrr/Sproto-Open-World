import { describe, expect, it } from 'vitest';
import { CLASS_IDS, CLASS_PASSIVES, CLASSES, GUN_ITEMS, STARTER_GUNS, type ClassId } from '../../src/content/classes';
import { ITEMS } from '../../src/content/items';
import { BRANCH_IDS, LEVEL_CAP, SKILL_IDS, classPerkDef, classSkillDef } from '../../src/content/progression';
import { SANDBOX } from '../../src/content/sandbox';
import { SPELL_BASE } from '../../src/content/spells';
import type { UiAction } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { giveItem, newProgress, type RpgCtx } from '../../src/sim/systems/rpg';
import { BTN, hold, press, step } from './combatHelpers';
import { ui } from './m3Helpers';

/** The class system (content/classes.ts): Wizard, Soldier, Pepe Warrior and Pepe. */

async function world(cls: ClassId) {
  await initPhysics();
  const w = new SimWorld(SANDBOX, 1);
  const p = w.spawnPlayer(0, { x: 0, y: 0, z: 0 }, 0, cls);
  w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 8 }, Math.PI);
  return { w, p };
}

const shots = (w: SimWorld) => w.entities.filter((e) => e.projectile && e.projectile.team === 'player');
const equip = (item: string): UiAction => ({ kind: 'equip', item });

describe('a new save of each class', () => {
  it('the Wizard is exactly the old player: Sprout Staff, every spell but Gunfire, no class field', () => {
    const p = newProgress(['bolt']);
    expect(p).not.toHaveProperty('class');
    expect(p.equipment.staff).toBe('staff_sproto');
    expect(p.weapons).toEqual(['staff_sproto', null, null, null]);
    expect(p.activeWeaponSlot).toBe(0);
    expect(p.spells).toEqual(['bolt']);
    expect(p.loadout).toEqual(['bolt', null, null, null]);
    expect(Object.keys(p.inventory).some((id) => ITEMS[id]?.gun)).toBe(false);
  });

  it('the Soldier holds the Toy MG, carries the other starter guns, and Gunfire replaces the Arcane Bolt', () => {
    const p = newProgress(['bolt'], 'soldier');
    expect(p.class).toBe('soldier');
    expect(p.equipment.staff).toBe('gun_mg');
    expect(p.weapons).toEqual(['gun_mg', null, null, null]);
    for (const g of STARTER_GUNS) expect(p.inventory[g], g).toBe(1);
    expect(p.spells).toEqual(['gunfire']);
    expect(p.loadout).toEqual(['gunfire', null, null, null]);
  });

  it('Pepe Warrior starts with the Sprout Staff, class field pepe_warrior, and v6 defaults', () => {
    const p = newProgress(['bolt'], 'pepe_warrior');
    expect(p.class).toBe('pepe_warrior');
    expect(p.equipment.staff).toBe('staff_sproto');
    expect(p.weapons).toEqual(['staff_sproto', null, null, null]);
    expect(p.activeWeaponSlot).toBe(0);
    expect(p.guns).toEqual([]);
    expect(p.spells).toEqual(['bolt']);
    expect(p.loadout).toEqual(['bolt', null, null, null]);
  });

  it('Pepe holds a gun and knows both Gunfire and the Arcane Bolt', () => {
    const p = newProgress(['bolt'], 'pepe');
    expect(p.class).toBe('pepe');
    expect(p.equipment.staff).toBe('gun_mg');
    expect([...p.spells].sort()).toEqual(['bolt', 'gunfire']);
    expect(p.loadout).toEqual(['gunfire', 'bolt', null, null]);
  });

  it('each class has its own body', async () => {
    for (const cls of CLASS_IDS) {
      const { w, p } = await world(cls);
      expect(p.view.model).toBe(CLASSES[cls].model);
      w.dispose();
    }
  });
});

describe('Gunfire', () => {
  it('costs no mana, shoots the gun in hand and waits for its fire rate', async () => {
    const { w, p } = await world('soldier');
    p.vitals!.mana = 5;
    const ev = step(w, press(BTN.spell1));
    expect(ev.filter((e) => e.type === 'castStart')).toMatchObject([{ spell: 'gunfire' }]);
    let cooldown = -1;
    let b: Entity | undefined;
    for (let i = 0; i < 30 && p.combat!.action; i++) {
      if (step(w).some((e) => e.type === 'cast')) {
        cooldown = p.combat!.cooldowns.gunfire ?? 0;
        b = shots(w)[0];
      }
    }
    expect(cooldown).toBe(GUN_ITEMS.gun_mg.gun!.shot.cooldown);
    expect(b!.view.model).toBe('bullet');
    expect(b!.projectile!.damage).toBeCloseTo(SPELL_BASE * 1.0 * GUN_ITEMS.gun_mg.gun!.shot.mv);
    // Nothing spent (mana only regenerates).
    expect(p.vitals!.mana).toBeGreaterThanOrEqual(5);
    w.dispose();
  });

  it('keeps firing while the trigger is held, at the gun\'s rate', async () => {
    const { w, p } = await world('soldier');
    let fired = 0;
    for (let i = 0; i < 60; i++) fired += step(w, i === 0 ? press(BTN.spell1) : hold(BTN.spell1)).filter((e) => e.type === 'cast').length;
    // 60 ticks at one shot every 7 (plus the 2-tick release): about eight.
    expect(fired).toBeGreaterThanOrEqual(6);
    expect(fired).toBeLessThanOrEqual(9);
    void p;
    w.dispose();
  });

  it('a shotgun fans nine pellets; a bazooka\'s rocket explodes', async () => {
    const { w, p } = await world('pepe');
    step(w, ui([equip('gun_shotgun')]));
    expect(p.progress!.equipment.staff).toBe('gun_shotgun');
    expect(p.progress!.weapons![0]).toBe('gun_shotgun');
    step(w, press(BTN.spell1));
    for (let i = 0; i < 4; i++) step(w);
    const pellets = shots(w);
    expect(pellets).toHaveLength(9);
    // Spread across the fan: no two leave in the same direction.
    expect(new Set(pellets.map((x) => x.tf.vel.x.toFixed(3))).size).toBe(9);
    for (let i = 0; i < 120; i++) step(w);
    step(w, ui([equip('gun_bazooka')]));
    p.combat!.cooldowns = {};
    step(w, press(BTN.spell1));
    for (let i = 0; i < 4; i++) step(w);
    const [rocket] = shots(w);
    expect(rocket.view.model).toBe('rocket');
    expect(rocket.projectile!.explode).toBe(GUN_ITEMS.gun_bazooka.gun!.shot.explodeRadius);
    w.dispose();
  });

  it('the Soldier\'s shooting spells come out of the gun; Pepe\'s are still magic', async () => {
    for (const [cls, model] of [['soldier', 'rocket'], ['pepe', 'blastOrb'], ['pepe_warrior', 'blastOrb'], ['wizard', 'blastOrb']] as const) {
      const { w, p } = await world(cls);
      step(w, ui([{ kind: 'equipSpell', slot: 2, spell: 'blast' }]));
      p.vitals!.mana = p.vitals!.manaMax = 200;
      p.combat!.cooldowns = {};
      step(w, press(BTN.spell3));
      for (let i = 0; i < 40; i++) step(w);
      expect(shots(w).map((x) => x.view.model), cls).toContain(model);
      w.dispose();
    }
  });
});

describe('weapons by class', () => {
  it('any class can wield both staves and guns, keeping the active weapon bar slot synced', async () => {
    const wiz = await world('wizard');
    wiz.p.progress!.inventory.gun_mg = 1;
    const a = step(wiz.w, ui([equip('gun_mg')]));
    expect(a.filter((e) => e.type === 'refused')).toEqual([]);
    expect(wiz.p.progress!.equipment.staff).toBe('gun_mg');
    expect(wiz.p.progress!.weapons![0]).toBe('gun_mg');
    wiz.w.dispose();

    const sol = await world('soldier');
    sol.p.progress!.inventory.staff_nobu = 1;
    const b = step(sol.w, ui([equip('staff_nobu')]));
    expect(b.filter((e) => e.type === 'refused')).toEqual([]);
    expect(sol.p.progress!.equipment.staff).toBe('staff_nobu');
    expect(sol.p.progress!.weapons![0]).toBe('staff_nobu');
    step(sol.w, ui([equip('gun_sniper')]));
    expect(sol.p.progress!.equipment.staff).toBe('gun_sniper');
    expect(sol.p.progress!.weapons![0]).toBe('gun_sniper');
    sol.w.dispose();

    const war = await world('pepe_warrior');
    war.p.progress!.inventory.gun_shotgun = 1;
    step(war.w, ui([equip('gun_shotgun')]));
    expect(war.p.progress!.equipment.staff).toBe('gun_shotgun');
    expect(war.p.progress!.weapons![0]).toBe('gun_shotgun');
    war.w.dispose();
  });

  it('every class can hold the Brick Phone', async () => {
    for (const cls of CLASS_IDS) {
      const { w, p } = await world(cls);
      p.progress!.inventory.staff_brick_phone = 1;
      step(w, ui([equip('staff_brick_phone')]));
      expect(p.progress!.equipment.staff, cls).toBe('staff_brick_phone');
      w.dispose();
    }
  });

  it('a gun class handed an epic staff gets Sproto Shooter\'s boss gun instead', async () => {
    const { w, p } = await world('soldier');
    const ctx = { now: 0, entities: w.entities, events: [], world: w.world, rng: { s: 1 }, spawnPickup: () => {} } as unknown as RpgCtx;
    giveItem(ctx, p as Entity, 'staff_moonward');
    giveItem(ctx, p as Entity, 'staff_rootcleaver');
    giveItem(ctx, p as Entity, 'staff_nobu');
    expect(p.progress!.inventory.gun_raygun).toBe(1);
    expect(p.progress!.inventory.gun_duckgun).toBe(1);
    expect(p.progress!.inventory.staff_moonward).toBeUndefined();
    // A staff without a gun beside it still goes in the bags (it sells).
    expect(p.progress!.inventory.staff_nobu).toBe(1);
    w.dispose();
  });

  it('a save keeps the class and the body', async () => {
    for (const cls of ['pepe', 'pepe_warrior'] as const) {
      const { w } = await world(cls);
      const save = w.toSave({ savedAt: 'now', build: 'test', region: 'sandbox' });
      expect(save.player.class).toBe(cls);
      w.dispose();
      await initPhysics();
      const w2 = new SimWorld(SANDBOX, 1);
      const p2 = w2.spawnPlayer(0, { x: 0, y: 0, z: 0 }, 0);
      w2.applySave(save);
      expect(p2.progress!.class).toBe(cls);
      expect(p2.view.model).toBe(CLASSES[cls].model);
      w2.dispose();
    }
  });
});

describe('4-class progression metadata (Lv 30 + Gunslinger)', () => {
  it('raises LEVEL_CAP to 30 and exposes all 9 skills across 3 branches', () => {
    expect(LEVEL_CAP).toBe(30);
    expect(BRANCH_IDS).toEqual(['magic', 'combat', 'gunslinger']);
    expect(SKILL_IDS).toHaveLength(9);
  });

  it('every class has an innate passive, 1 signature skill, and 6 class-tailored perks', () => {
    const perkNames = new Set<string>();
    for (const cls of CLASS_IDS) {
      expect(CLASS_PASSIVES[cls].name.length).toBeGreaterThan(0);
      const sigs = SKILL_IDS.map((s) => classSkillDef(cls, s)).filter((d) => d.signature);
      expect(sigs, cls).toHaveLength(1);
      for (const br of BRANCH_IDS) {
        for (const tier of [10, 20] as const) {
          const perk = classPerkDef(cls, br, tier);
          expect(perk.classId).toBe(cls);
          expect(perk.branch).toBe(br);
          expect(perk.at).toBe(tier);
          expect(perk.name.length).toBeGreaterThan(0);
          expect(perk.text.length).toBeGreaterThan(0);
          perkNames.add(`${cls}:${perk.name}`);
        }
      }
    }
    expect(perkNames.size).toBe(24);
  });
});
