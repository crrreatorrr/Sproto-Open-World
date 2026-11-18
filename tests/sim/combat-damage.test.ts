import { describe, expect, it } from 'vitest';
import { computeDamage, resolveHit, type HitInfo } from '../../src/sim/combat/hits';
import type { CombatCtx } from '../../src/sim/combat/playerCombat';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, combatWorld, hitsOn, idle, press, stepN } from './combatHelpers';

/** Plan §4.6 damage formula and the §4.2 table's damage column (Sprout Staff, damage 20). */

const info = (over: Partial<HitInfo> = {}): HitInfo => ({
  move: 'test', base: 100, kind: 'physical', poise: 10, hitstun: 0, knockdown: false, pushback: 0, hitstop: 0,
  unblockable: false, heavy: false, crit: false, mana: 0, from: { x: 0, y: 0, z: 0 }, projectile: false, ...over,
});

function ctxOf(w: SimWorld): CombatCtx {
  return { now: w.now, entities: w.entities, get: (id) => w.get(id), events: [], motion: new Map(), frozen: new Set() };
}

describe('table damage in the sim (level 1 vs a level-1, 0-defense, normal-profile dummy)', () => {
  it('light1 20, light2 22, light3 32', async () => {
    const { w } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const evs = stepN(w, 100, (i) => (i === 0 || i === 22 || i === 46 ? press(BTN.light) : idle()));
    expect(hitsOn(evs, d.id).map((x) => [x.ev.move, x.ev.damage, x.ev.crit, x.ev.affinity])).toEqual([
      ['light1', 20, false, 'normal'],
      ['light2', 22, false, 'normal'],
      ['light3', 32, false, 'normal'],
    ]);
    w.dispose();
  });

  it('heavy (tap) 44', async () => {
    const { w } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const evs = stepN(w, 80, (i) => (i === 0 ? press(BTN.heavy) : idle()));
    expect(hitsOn(evs, d.id).map((x) => [x.ev.move, x.ev.damage, x.ev.heavy])).toEqual([['heavy', 44, true]]);
    w.dispose();
  });

  it('combo heavy 48', async () => {
    const { w } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    // light1 hits on 12 (3 ticks of hit-stop), so its cancel opens on 23.
    const evs = stepN(w, 80, (i) => (i === 0 ? press(BTN.light) : i === 23 ? press(BTN.heavy) : idle()));
    expect(hitsOn(evs, d.id).map((x) => [x.ev.move, x.ev.damage])).toEqual([['light1', 20], ['comboHeavy', 48]]);
    w.dispose();
  });

  /**
   * The lunge closes the gap to the clip's generated reach (content/combat.ts clipReach) so a
   * light at a dummy 2.5 m away connects (was a bug: it stopped 1.6 m short of the surface).
   */
  it('a light at a dummy 2.5 m away lunges into range and connects', async () => {
    const { w } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 2.5 }, Math.PI);
    const evs = stepN(w, 40, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(evs, d.id).length).toBe(1);
    w.dispose();
  });
});

describe('computeDamage (plan §4.6)', () => {
  it("the Brute's arcane resist halves an arcane hit; physical is normal", async () => {
    const { w, p } = await combatWorld();
    const b = w.spawnEnemy('brute', { x: 0, y: 0, z: 30 }, Math.PI);
    p.combat!.level = 2; // same level as the Brute: no level multiplier
    expect(computeDamage(p, b, info({ kind: 'physical', base: 40 }))).toEqual({ damage: 40, crit: false, affinity: 'normal' });
    expect(computeDamage(p, b, info({ kind: 'arcane', base: 40 }))).toEqual({ damage: 20, crit: false, affinity: 'resist' });
    // And through resolveHit: hp and poise both take the ×0.5.
    const before = b.vitals!.hp;
    resolveHit(ctxOf(w), p, b, info({ kind: 'arcane', base: 40, poise: 20, from: { ...p.tf.pos } }));
    expect(before - b.vitals!.hp).toBe(20);
    expect(b.combat!.poise).toBe(70 - 10);
    w.dispose();
  });

  it('level difference: ±5% per level, clamped to 0.8–1.2', async () => {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 30 }, Math.PI);
    const at = (attLv: number, defLv: number) => {
      p.combat!.level = attLv;
      d.combat!.level = defLv;
      return computeDamage(p, d, info()).damage;
    };
    expect(at(1, 1)).toBe(100);
    expect(at(2, 1)).toBe(105);
    expect(at(4, 1)).toBe(115);
    expect(at(5, 1)).toBe(120);
    expect(at(10, 1)).toBe(120);
    expect(at(1, 2)).toBe(95);
    expect(at(1, 5)).toBe(80);
    expect(at(1, 10)).toBe(80);
    w.dispose();
  });

  it('defense, crit, rounding and the minimum of 1', async () => {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 30 }, Math.PI);
    d.combat!.defense = { physical: 25, arcane: 0 };
    expect(computeDamage(p, d, info()).damage).toBe(80); // 100 × 100 / 125
    expect(computeDamage(p, d, info({ kind: 'arcane' })).damage).toBe(100);
    expect(computeDamage(p, d, info({ crit: true })).damage).toBe(120);
    expect(computeDamage(p, d, info({ base: 0.2 })).damage).toBe(1);
    d.combat!.defense = { physical: 0, arcane: 0 };
    expect(computeDamage(p, d, info({ base: 22.5 })).damage).toBe(23);
    w.dispose();
  });

  it('no random variance: the same hit always deals the same damage', async () => {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 30 }, Math.PI);
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(computeDamage(p, d, info({ base: 37 })).damage);
    expect([...seen]).toEqual([37]);
    w.dispose();
  });
});
