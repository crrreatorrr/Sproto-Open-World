import { describe, expect, it } from 'vitest';
import { TOKENS } from '../../src/sim/ai/brain';
import type { Entity } from '../../src/sim/entity';
import { wrapAngle } from '../../src/sim/math';
import { BTN, cmd, combatWorld, idle, step } from './combatHelpers';
import { OPEN, bearing, immortal } from './aiHelpers';
import { isAttacking, tokens } from './m1bHelpers';

/** A camp spreads around the player instead of queueing, and the attack tokens still cap the pressure. */

/** The widest arc around the player with nobody in it (radians). */
function widestGap(es: Entity[], p: Entity): number {
  const bs = es.map((e) => bearing(e, p)).sort((a, b) => a - b);
  return Math.max(...bs.map((b, i) => (i + 1 < bs.length ? bs[i + 1] - b : bs[0] + Math.PI * 2 - b)));
}

/** A camp of `defs` standing together on one side of the player. */
async function clump(defs: string[], seed = 1) {
  const { w, p } = await combatWorld({ pos: OPEN, seed });
  const es = defs.map((d, i) => w.spawnEnemy(d, { x: OPEN.x + (i - (defs.length - 1) / 2) * 1.2, y: 0, z: OPEN.z + 9 }, Math.PI));
  return { w, p, es };
}

describe('groups', () => {
  it('a camp that arrives on one side ends up all around the player', async () => {
    for (const seed of [1, 2, 3]) {
      const { w, p, es } = await clump(['grunt', 'grunt', 'grunt', 'grunt'], seed);
      const before = widestGap(es, p);
      expect(before).toBeGreaterThan(Math.PI * 1.5);
      let sum = 0, n = 0;
      for (let t = 0; t < 900; t++) {
        immortal(p);
        step(w, idle());
        if (t >= 300) {
          sum += widestGap(es, p);
          n++;
        }
      }
      // Four spread evenly leave 90° empty; a queue would leave more than 270°.
      expect(sum / n, `seed ${seed}`).toBeLessThan(Math.PI);
      w.dispose();
    }
  });

  it('two enemies flank: they end up on different sides, not one behind the other', async () => {
    const { w, p, es } = await clump(['grunt', 'grunt']);
    let sum = 0, n = 0;
    for (let t = 0; t < 900; t++) {
      immortal(p);
      step(w, idle());
      if (t >= 300) {
        sum += Math.abs(wrapAngle(bearing(es[0], p) - bearing(es[1], p)));
        n++;
      }
    }
    expect(sum / n).toBeGreaterThan(1.2);
    w.dispose();
  });

  it('Slingers spread out too, and keep firing', async () => {
    const { w, p, es } = await clump(['slinger', 'slinger', 'slinger']);
    let shots = 0, sum = 0, n = 0;
    for (let t = 0; t < 1200; t++) {
      immortal(p);
      for (const ev of step(w, idle())) if (ev.type === 'fire') shots++;
      if (t >= 400) {
        sum += widestGap(es, p);
        n++;
      }
    }
    expect(sum / n).toBeLessThan(Math.PI * 1.25);
    expect(shots).toBeGreaterThan(10);
    w.dispose();
  });

  it('the token limits hold through flanking, lunges and punishes', async () => {
    const { w, p, es } = await clump(['grunt', 'grunt', 'grunt_vet', 'grunt_vet', 'slinger', 'slinger', 'wisp']);
    const melee = es.slice(0, 4);
    let peak = 0;
    for (let t = 0; t < 8000; t++) {
      immortal(p);
      for (const e of es) e.vitals!.hp = e.vitals!.hpMax;
      p.vitals!.stamina = t % 900 < 300 ? 5 : p.vitals!.staminaMax;
      // The player runs about, swings at the air and drinks: every reaction gets its chance.
      const walking = t % 300 < 150;
      step(w, cmd({ camYaw: t / 150, move: { x: 0, y: walking ? 1 : 0 }, press: t % 97 === 0 ? BTN.light : t % 613 === 0 ? BTN.potion : 0 }));
      const m = tokens(w, p, 'melee'), r = tokens(w, p, 'ranged');
      if (m > TOKENS.melee || r > TOKENS.ranged) throw new Error(`tick ${t}: melee ${m}, ranged ${r}`);
      peak = Math.max(peak, melee.filter(isAttacking).length);
    }
    expect(peak).toBe(TOKENS.melee);
    w.dispose();
  }, 30_000);
});
