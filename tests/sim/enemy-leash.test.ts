import { describe, expect, it } from 'vitest';
import { SANDBOX, type LevelDef } from '../../src/content/sandbox';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { combatWorld, step, stepN } from './combatHelpers';

const level = (shapes: LevelDef['shapes']): LevelDef => ({ ...SANDBOX, shapes, enemies: [] });

/** The Grunt has lost its player out at `z`: it turns for home by itself on the next tick. */
function strand(w: SimWorld, g: Entity, z: number): void {
  g.tf.pos = { x: 0, y: 0, z };
  g.tf.prevPos = { ...g.tf.pos };
  w.physics.teleport(g.id, g.tf.pos);
  g.brain!.state = 'engage';
}

describe('going home', () => {
  it('an enemy that cannot walk home does not run at the wall forever', async () => {
    // A long wall between the Grunt and its home; the player is far beyond its sight.
    const { w } = await combatWorld({ pos: { x: 0, y: 0, z: 70 }, level: level([{ kind: 'box', pos: [0, 2, 10], half: [45, 2, 0.5] }]) });
    stepN(w, 2);
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 0 }, 0);
    strand(w, g, 20);
    g.vitals!.hp = 5;
    stepN(w, 1800);
    expect(g.brain!.state).toBe('idle');
    expect(Math.hypot(g.tf.pos.x, g.tf.pos.z)).toBeLessThan(1.5);
    expect(g.vitals!.hp).toBe(g.vitals!.hpMax);
    w.dispose();
  });

  it('an enemy with a clear road home walks it (it is not snapped there)', async () => {
    const { w } = await combatWorld({ pos: { x: 0, y: 0, z: 90 }, level: level([]) });
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 0 }, 0);
    strand(w, g, 30);
    let biggest = 0;
    step(w);
    expect(g.brain!.state).toBe('leash');
    for (let i = 0; i < 400 && g.brain!.state === 'leash'; i++) {
      const was = g.tf.pos.z;
      step(w);
      biggest = Math.max(biggest, Math.abs(g.tf.pos.z - was));
    }
    expect(g.brain!.state).toBe('idle');
    expect(biggest).toBeLessThan(0.3);
    w.dispose();
  });
});
