import { describe, expect, it } from 'vitest';
import { bossWorld, startFight, tickAlive } from './bossHelpers';
import { alive, campMembers, standAt } from './m4Helpers';

describe('a sealed boss fight is a duel', () => {
  it("the Orchard camp beside the Drake's arena stays out of it", async () => {
    const { w, p, boss } = await bossWorld('skyfire_drake');
    const camp = campMembers(w, 'orchard_scarecrow');
    expect(camp.length).toBeGreaterThan(0);
    startFight(w, p, boss);
    // At the wall, right beside the camp.
    const home = boss.brain!.home;
    const c = camp[0].brain!.home;
    const d = Math.hypot(c.x - home.x, c.z - home.z);
    const edge = { x: home.x + ((c.x - home.x) / d) * 29, z: home.z + ((c.z - home.z) / d) * 29 };
    for (let i = 0; i < 600; i++) {
      standAt(w, edge.x, edge.z);
      tickAlive(w, p);
      for (const g of camp) expect(g.brain!.target, `tick ${i}`).toBeNull();
    }
    for (const g of camp) expect(Math.hypot(g.tf.pos.x - g.brain!.home.x, g.tf.pos.z - g.brain!.home.z)).toBeLessThan(2);
    w.dispose();
  }, 30000);

  it('a camp already chasing the player goes home when the fight starts', async () => {
    const { w, p, boss } = await bossWorld('skyfire_drake');
    const camp = campMembers(w, 'orchard_scarecrow');
    const c = camp[0].brain!.home;
    standAt(w, c.x + 6, c.z);
    for (let i = 0; i < 40; i++) tickAlive(w, p);
    expect(camp.some((g) => g.brain!.target === p.id)).toBe(true);
    startFight(w, p, boss);
    for (let i = 0; i < 420; i++) tickAlive(w, p);
    for (const g of camp.filter(alive)) {
      expect(g.brain!.target).toBeNull();
      expect(Math.hypot(g.tf.pos.x - g.brain!.home.x, g.tf.pos.z - g.brain!.home.z)).toBeLessThan(2);
    }
    w.dispose();
  }, 30000);

  it("a boss's own adds still fight", async () => {
    const { w, p, boss } = await bossWorld('scrapjaw');
    startFight(w, p, boss);
    boss.vitals!.hp = boss.vitals!.hpMax * 0.4;
    for (let i = 0; i < 400 && !w.entities.some((e) => e.brain?.summoned); i++) tickAlive(w, p);
    const adds = w.entities.filter((e) => e.brain?.summoned);
    expect(adds.length).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) tickAlive(w, p);
    expect(adds.some((a) => a.brain!.target === p.id)).toBe(true);
    w.dispose();
  }, 30000);
});
