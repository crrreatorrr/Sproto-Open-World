import { describe, expect, it } from 'vitest';
import { MOUNT } from '../../src/content/mounts';
import { step, stepN } from './combatHelpers';
import { interact } from './m3Helpers';
import { flatSproutvale, standAt } from './m4Helpers';

/** A teleport (fast travel, the QA cheat) in the middle of climbing on leaves the bull behind. */
describe('teleporting while getting on the bull', () => {
  it('cancels the mount: the player stays where they landed and the bull is free', async () => {
    const { w, p } = await flatSproutvale();
    const bull = w.entities.find((e) => e.mount)!;
    standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
    step(w, interact());
    expect(p.riding?.state).toBe('mounting');

    const at = { x: bull.tf.pos.x + 60, y: bull.tf.pos.y, z: bull.tf.pos.z + 60 };
    w.teleportPlayer(0, at);
    stepN(w, MOUNT.mountTicks + 5);

    expect(Math.hypot(p.tf.pos.x - at.x, p.tf.pos.z - at.z)).toBeLessThan(1);
    expect(p.riding).toBeUndefined();
    expect(p.combat!.action).toBeNull();
    expect(bull.mount!.rider).toBeNull();
    w.dispose();
  });
});
