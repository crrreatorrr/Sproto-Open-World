import { describe, expect, it } from 'vitest';
import { CLASS_IDS, CLASS_PASSIVES, CLASSES, STARTER_GUNS, type ClassId } from '../../src/content/classes';
import { ITEMS } from '../../src/content/items';
import { BRANCH_IDS, LEVEL_CAP, SKILL_IDS, classPerkDef, classSkillDef } from '../../src/content/progression';
import { SANDBOX } from '../../src/content/sandbox';
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

  it('the Soldier holds the Toy MG, carries the other starter guns and a staff to block with, and casts the Arcane Bolt like anyone', () => {
    const p = newProgress(['bolt'], 'soldier');
    expect(p.class).toBe('soldier');
    expect(p.equipment.staff).toBe('gun_mg');
    expect(p.weapons).toEqual(['gun_mg', null, null, null]);
    for (const g of STARTER_GUNS) expect(p.inventory[g], g).toBe(1);
    // A gun can't block: the Watchtower's parry drill needs a staff.
    expect(newProgress(['bolt'], 'pepe').inventory.staff_sproto).toBe(1);
    expect(p.inventory.staff_sproto).toBe(1);
    expect(p.spells).toEqual(['bolt']);
    expect(p.loadout).toEqual(['bolt', null, null, null]);
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

  it('Pepe holds a gun and knows the Arcane Bolt; nobody knows Gunfire', () => {
    const p = newProgress(['bolt'], 'pepe');
    expect(p.class).toBe('pepe');
    expect(p.equipment.staff).toBe('gun_mg');
    expect(p.spells).toEqual(['bolt']);
    expect(p.loadout).toEqual(['bolt', null, null, null]);
  });

  it('each class has its own body', async () => {
    for (const cls of CLASS_IDS) {
      const { w, p } = await world(cls);
      expect(p.view.model).toBe(CLASSES[cls].model);
      w.dispose();
    }
  });
});

describe('shooting (the gun has its own trigger; Gunfire is no longer a spell)', () => {
  const gunShots = (w: SimWorld) => w.gunEvents.filter((g) => g.fired);

  it('the trigger costs no mana and fires at the gun\'s rate while it is held', async () => {
    const { w, p } = await world('soldier');
    p.vitals!.mana = 5;
    let fired = 0;
    for (let i = 0; i < 60; i++) {
      step(w, i === 0 ? press(BTN.light) : hold(BTN.light));
      fired += gunShots(w).length;
    }
    // 60 ticks at the Toy MG's ten shots a second.
    expect(fired).toBeGreaterThanOrEqual(9);
    expect(fired).toBeLessThanOrEqual(11);
    // Nothing spent (mana only regenerates), and nothing was cast.
    expect(p.vitals!.mana).toBeGreaterThanOrEqual(5);
    expect(p.combat!.action?.kind).not.toBe('cast');
    w.dispose();
  });

  it('a shotgun fans nine pellets; a bazooka\'s rocket explodes', async () => {
    const { w, p } = await world('pepe');
    step(w, ui([equip('gun_shotgun')]));
    expect(p.progress!.equipment.staff).toBe('gun_shotgun');
    expect(p.progress!.weapons![0]).toBe('gun_shotgun');
    for (let i = 0; i < 40 && !gunShots(w).length; i++) step(w, hold(BTN.light));
    const [blast] = gunShots(w);
    expect(blast.tracers).toHaveLength(9);
    // Spread across the fan: no two pellets end in the same place.
    expect(new Set(blast.tracers.map((t) => t.to.x.toFixed(3))).size).toBe(9);
    step(w, ui([equip('gun_bazooka')]));
    for (let i = 0; i < 60 && !shots(w).length; i++) step(w, hold(BTN.light));
    const [rocket] = shots(w);
    expect(rocket.view.model).toBe('rocket');
    expect(rocket.projectile!.explode).toBeGreaterThan(0);
    expect(rocket.projectile!.splash!.damage).toBeGreaterThan(0);
    w.dispose();
  });

  it('every class casts its spells as magic, the Soldier included', async () => {
    for (const cls of ['soldier', 'pepe', 'pepe_warrior', 'wizard'] as const) {
      const { w, p } = await world(cls);
      step(w, ui([{ kind: 'equipSpell', slot: 2, spell: 'blast' }]));
      p.vitals!.mana = p.vitals!.manaMax = 200;
      p.combat!.cooldowns = {};
      step(w, press(BTN.spell3));
      for (let i = 0; i < 40; i++) step(w);
      expect(shots(w).map((x) => x.view.model), cls).toContain('blastOrb');
      w.dispose();
    }
  });

  it('a Soldier taught the Arcane Bolt learns the Arcane Bolt', async () => {
    const { w, p } = await world('soldier');
    expect(p.progress!.spells).not.toContain('gunfire');
    step(w, press(BTN.spell1));
    expect(p.combat!.action).toMatchObject({ kind: 'cast', spell: 'bolt' });
    w.dispose();
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
