import { describe, expect, it } from 'vitest';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import { VILLAGE_Y, stand, village } from './m3Helpers';

const script = (i: number): InputCommand => {
  const c = idleInput(0);
  c.move = { x: Math.sin(i / 37), y: 0.8 };
  if (i % 24 === 0) c.pressed = c.held = BTN.light;
  if (i % 90 > 70) c.held |= BTN.block;
  return c;
};

/**
 * The ticks right after a restore are exact. Later, characters in contact can differ by a fraction
 * of a millimetre: Rapier's internal query tree is rebuilt on restore, and only a full physics
 * snapshot would carry it over (needed before co-op rollback; nothing in the game rewinds today).
 */
describe('restoring a snapshot in the middle of a fight', () => {
  for (const at of [60, 300, 450]) {
    it(`replays the next ticks from tick ${at} exactly`, async () => {
      const { w } = await village();
      stand(w, 230, 80, { x: 230, z: 84 });
      for (const [x, z] of [[230, 84], [233, 84], [227, 85]]) w.spawnEnemy('grunt', { x, y: VILLAGE_Y, z }, Math.PI);
      for (let i = 0; i < at; i++) w.tick(new Map([[0, script(i)]]));
      const snap = w.snapshot();
      const first: number[] = [];
      for (let i = 0; i < 3; i++) {
        w.tick(new Map([[0, script(at + i)]]));
        first.push(w.hash());
      }
      w.restore(snap);
      for (let i = 0; i < 3; i++) {
        w.tick(new Map([[0, script(at + i)]]));
        expect(w.hash(), `tick +${i}`).toBe(first[i]);
      }
      w.dispose();
    });
  }
});
