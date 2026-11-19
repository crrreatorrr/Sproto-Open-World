import { describe, expect, it } from 'vitest';
import { CHARGE, PLAYER_MOVES, clipTiming } from '../../src/content/combat';
import { ITEMS } from '../../src/content/items';
import { SANDBOX, type LevelDef } from '../../src/content/sandbox';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, attack, combatWorld, hold, idle, player, press, step } from './combatHelpers';
import { ui } from './m3Helpers';

/**
 * Rootcleaver (plan Quest 4): an epic staff-slot greatsword. A fully charged heavy sends one
 * shockwave; a quick heavy and a light send none. The wave travels 8 m along the ground and stops
 * at a wall.
 */

const HEAVY_ACTIVE = clipTiming(PLAYER_MOVES.heavy.clip).activeStart;

/** A wall across +Z, tall enough to catch a wave travelling above the floor. */
const WALL: LevelDef = {
  ...SANDBOX,
  id: 'sunder-wall',
  enemies: [],
  shapes: [{ kind: 'box', pos: [0, 2, 4], half: [6, 2, 0.5] }],
};

function equip(w: SimWorld, item: string): void {
  const p = player(w);
  p.progress!.inventory[item] = (p.progress!.inventory[item] ?? 0) + 1;
  step(w, ui([{ kind: 'equip', item }]));
  expect(player(w).progress!.equipment.staff).toBe(item);
}

/** Hold heavy until the charge is full, release, and stop on the tick the swing becomes active. */
function chargedHeavy(w: SimWorld): void {
  step(w, press(BTN.heavy));
  for (let i = 0; i < 120; i++) {
    step(w, hold(BTN.heavy));
    const a = attack(player(w));
    if (a?.charging && a.charge >= CHARGE.full) break;
  }
  step(w, idle());
  for (let i = 0; i < 40; i++) {
    step(w, idle());
    const a = attack(player(w));
    if (a?.charged && a.clipT === HEAVY_ACTIVE) return;
  }
  throw new Error('charged heavy never reached its active tick');
}

/** Release the heavy while it is still charging, and stop on the same active tick. */
function quickHeavy(w: SimWorld): void {
  step(w, press(BTN.heavy));
  for (let i = 0; i < 40; i++) {
    step(w, hold(BTN.heavy));
    if (attack(player(w))?.charging) break;
  }
  for (let i = 0; i < 5; i++) step(w, hold(BTN.heavy));
  expect(attack(player(w))?.charge ?? 0).toBeLessThan(CHARGE.full);
  step(w, idle());
  for (let i = 0; i < 40; i++) {
    step(w, idle());
    const a = attack(player(w));
    if (a && !a.charging && a.clipT === HEAVY_ACTIVE) return;
  }
  throw new Error('quick heavy never reached its active tick');
}

function light(w: SimWorld): void {
  // The quick heavy is still in its swing. Let it finish, then throw the light.
  for (let i = 0; i < 80 && attack(player(w)); i++) step(w, idle());
  step(w, press(BTN.light));
  const start = clipTiming(PLAYER_MOVES.light1.clip).activeStart;
  for (let i = 0; i < 40; i++) {
    step(w, idle());
    const a = attack(player(w));
    if (a?.move === 'light1' && a.clipT === start) return;
  }
  throw new Error('light never reached its active tick');
}

function playerProjectiles(w: SimWorld): Entity[] {
  const id = player(w).id;
  return w.entities.filter((e) => e.projectile?.owner === id);
}

/** A charged heavy, then whether a stationary dummy `metres` ahead of the player loses health. */
async function shockwaveHits(metres: number): Promise<boolean> {
  const { w } = await combatWorld({ yaw: 0 });
  try {
    equip(w, 'staff_rootcleaver');
    chargedHeavy(w);
    const here = player(w).tf.pos;
    const foe = w.spawnEnemy('dummy_passive', { x: here.x, y: here.y, z: here.z + metres }, Math.PI);
    const hp = foe.vitals!.hp;
    for (let i = 0; i < 50 && playerProjectiles(w).length > 0; i++) step(w, idle());
    return foe.vitals!.hp < hp;
  } finally {
    w.dispose();
  }
}

/** The same wave, with a wall between the player and a dummy that the open wave would reach. */
async function shockwaveHitsThroughWall(): Promise<boolean> {
  const { w } = await combatWorld({ yaw: 0, level: WALL });
  try {
    equip(w, 'staff_rootcleaver');
    chargedHeavy(w);
    const here = player(w).tf.pos;
    const foe = w.spawnEnemy('dummy_passive', { x: here.x, y: here.y, z: here.z + 7 }, Math.PI);
    const hp = foe.vitals!.hp;
    for (let i = 0; i < 50 && playerProjectiles(w).length > 0; i++) step(w, idle());
    return foe.vitals!.hp < hp;
  } finally {
    w.dispose();
  }
}

describe('Rootcleaver', () => {
  it('hits harder than any other weapon, and casts weakly', () => {
    const s = ITEMS.staff_rootcleaver.staff!;
    expect(s.damage).toBe(52);
    expect(s.spellPower).toBe(0.6);
    for (const i of Object.values(ITEMS)) if (i.staff && i.id !== 'staff_rootcleaver') expect(i.staff.damage).toBeLessThan(52);
  });

  it('sends one shockwave on a fully charged heavy', async () => {
    const { w } = await combatWorld();
    equip(w, 'staff_rootcleaver');
    chargedHeavy(w);
    expect(playerProjectiles(w).length).toBe(1);
    w.dispose();
  });

  it('sends none on a quick heavy or a light attack', async () => {
    const { w } = await combatWorld();
    equip(w, 'staff_rootcleaver');
    quickHeavy(w);
    expect(playerProjectiles(w).length).toBe(0);
    light(w);
    expect(playerProjectiles(w).length).toBe(0);
    w.dispose();
  });

  it('hits an enemy 7 m ahead and misses one 10 m ahead', async () => {
    expect(await shockwaveHits(7)).toBe(true);
    expect(await shockwaveHits(10)).toBe(false);
  });

  it('stops the shockwave at a wall', async () => {
    expect(await shockwaveHitsThroughWall()).toBe(false);
  });

  it('gives other staffs no shockwave', async () => {
    const { w } = await combatWorld();
    equip(w, 'staff_fighters_might');
    chargedHeavy(w);
    expect(playerProjectiles(w).length).toBe(0);
    w.dispose();
  });
});
