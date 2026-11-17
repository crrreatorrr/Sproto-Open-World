import { describe, expect, it } from 'vitest';
import { SANDBOX } from '../../src/content/sandbox';
import { BTN, idleInput } from '../../src/sim/commands';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';

/**
 * Sim time budget (plan §3.5): ≤ 2 ms per tick on average with 40 active entities. Node on a dev
 * machine or CI runner is a generous stand-in for the target laptop, so the bound here is the
 * budget itself, measured over a long, busy fight (every enemy engaged, the player casting and
 * swinging, projectiles in the air).
 */
describe('sim performance', () => {
  it('40 active entities average ≤ 2 ms per tick', async () => {
    await initPhysics();
    const w = new SimWorld({ ...SANDBOX, enemies: [] }, 7);
    w.spawnPlayer(0);
    const p = w.playerEntity(0)!;
    const kinds = ['grunt', 'grunt', 'grunt', 'slinger', 'wisp', 'brute'];
    for (let i = 0; i < 39; i++) {
      const a = (i / 39) * Math.PI * 2;
      const r = 6 + (i % 4) * 3;
      const e = w.spawnEnemy(kinds[i % kinds.length], { x: Math.sin(a) * r, y: 0, z: Math.cos(a) * r }, a + Math.PI);
      e.brain!.state = 'engage';
      e.brain!.target = p.id;
    }
    const spells = [BTN.spell1, BTN.spell2, BTN.spell3, BTN.spell4];
    const cmd = (t: number) => {
      const c = idleInput(t / 90);
      c.move = { x: Math.sin(t / 50), y: 0.5 };
      if (t % 11 === 0) c.pressed |= BTN.light;
      if (t % 37 === 3) c.pressed |= spells[(t / 37) % 4 | 0];
      return c;
    };
    // Warm up (JIT, Rapier's broad phase), keeping the fight going and the player alive.
    for (let t = 0; t < 120; t++) {
      w.tick(new Map([[0, cmd(t)]]));
      p.vitals!.hp = p.vitals!.hpMax;
      p.vitals!.mana = p.vitals!.manaMax;
    }
    const N = 1200;
    const t0 = performance.now();
    for (let t = 120; t < 120 + N; t++) {
      w.tick(new Map([[0, cmd(t)]]));
      p.vitals!.hp = p.vitals!.hpMax;
      p.vitals!.mana = p.vitals!.manaMax;
    }
    const perTick = (performance.now() - t0) / N;
    const alive = w.entities.filter((e) => e.combat && e.combat.action?.kind !== 'dead').length;
    console.log(`sim: ${perTick.toFixed(3)} ms/tick with ${w.entities.length} entities (${alive} alive combatants)`);
    expect(w.entities.filter((e) => e.body).length).toBeGreaterThanOrEqual(30);
    expect(perTick).toBeLessThanOrEqual(2);
    w.dispose();
  }, 30_000);
});
