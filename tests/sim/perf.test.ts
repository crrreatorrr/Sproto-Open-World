import { describe, expect, it } from 'vitest';
import { SANDBOX } from '../../src/content/sandbox';
import { BTN, idleInput } from '../../src/sim/commands';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';

/**
 * Sim time budget (plan §3.5): ≤ 2 ms per tick on average with 40 active entities, measured over a
 * long, busy fight (every enemy engaged, the player casting and swinging, projectiles in the air).
 * Locally the bound is the budget itself. A CI runner is a slow shared 2-core VM running test files
 * in parallel (it measured 2.8 ms where a dev machine measures 0.6), so there the bound is a
 * generous 6 ms (plan: "generous bound") that still catches a real regression. The number is always
 * printed.
 *
 * The time is the test thread's CPU time (`process.threadCpuUsage`), not the wall clock: the full
 * `npm test` runs files side by side, and on a busy machine the wall clock also counts the time the
 * test sat waiting for a core. It is taken in 12 blocks of 100 ticks and the bound applies to the median
 * block, so one block caught by a GC pause or a page fault doesn't decide it, while a sim that got
 * slower is slower in every block. The wall-clock average is printed beside it.
 */
const BOUND_MS = process.env.CI ? 6 : 2;
describe('sim performance', () => {
  it(`40 active entities take ≤ ${BOUND_MS} ms per tick (median block)`, async () => {
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
    const BLOCKS = 12, BLOCK = 100;
    const blocks: number[] = [];
    // This thread's CPU time where Node has it, else the whole process's.
    const usage = (process as { threadCpuUsage?: () => NodeJS.CpuUsage }).threadCpuUsage ?? process.cpuUsage;
    const cpuMs = () => {
      const u = usage.call(process);
      return (u.user + u.system) / 1000;
    };
    const wall0 = performance.now();
    for (let b = 0, t = 120; b < BLOCKS; b++) {
      const t0 = cpuMs();
      for (let i = 0; i < BLOCK; i++, t++) {
        w.tick(new Map([[0, cmd(t)]]));
        p.vitals!.hp = p.vitals!.hpMax;
        p.vitals!.mana = p.vitals!.manaMax;
      }
      blocks.push((cpuMs() - t0) / BLOCK);
    }
    const wall = (performance.now() - wall0) / (BLOCKS * BLOCK);
    const mean = blocks.reduce((a, b) => a + b, 0) / BLOCKS;
    const sorted = [...blocks].sort((a, b) => a - b);
    const perTick = (sorted[BLOCKS / 2 - 1] + sorted[BLOCKS / 2]) / 2;
    const alive = w.entities.filter((e) => e.combat && e.combat.action?.kind !== 'dead').length;
    console.log(`sim: ${perTick.toFixed(3)} ms/tick of CPU (median of ${BLOCKS} blocks; mean ${mean.toFixed(3)}, worst ${sorted[BLOCKS - 1].toFixed(3)}; wall clock ${wall.toFixed(3)}) with ${w.entities.length} entities (${alive} alive combatants)`);
    expect(w.entities.filter((e) => e.body).length).toBeGreaterThanOrEqual(30);
    expect(perTick).toBeLessThanOrEqual(BOUND_MS);
    w.dispose();
  }, 30_000);
});
