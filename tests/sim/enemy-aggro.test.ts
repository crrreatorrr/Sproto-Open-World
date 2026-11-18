import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { SANDBOX } from '../../src/content/sandbox';
import { BTN, combatWorld, press, step, stepN } from './combatHelpers';

describe('being shot from afar', () => {
  it('an enemy hit from beyond its sight range comes for the shooter', async () => {
    const range = ENEMIES.grunt.aggroRange + 6;
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 0 }, level: { ...SANDBOX, shapes: [], enemies: [] } });
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: range }, Math.PI);
    stepN(w, 2);
    let hit = false;
    for (let i = 0; i < 90 && !hit; i++) hit = step(w, i === 0 ? press(BTN.spell1, { camYaw: 0 }) : undefined).some((e) => e.type === 'hit' && e.target === g.id);
    expect(hit).toBe(true);
    stepN(w, 90);
    expect(g.brain!.target).toBe(p.id);
    expect(g.tf.pos.z).toBeLessThan(range - 3);
    w.dispose();
  });

  it('an unhurt enemy still only sees as far as its sight range', async () => {
    const range = ENEMIES.grunt.aggroRange + 6;
    const { w } = await combatWorld({ pos: { x: 0, y: 0, z: 0 }, level: { ...SANDBOX, shapes: [], enemies: [] } });
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: range }, Math.PI);
    stepN(w, 120);
    expect(g.brain!.target).toBeNull();
    expect(g.tf.pos.z).toBeCloseTo(range, 1);
    w.dispose();
  });
});
