import { describe, expect, it } from 'vitest';
import { cmd, step, stepN } from './combatHelpers';
import { interact, standBy, ui } from './m3Helpers';
import { alive, campMembers, flatSproutvale, slay, standAt } from './m4Helpers';

describe("a camp enemy's body", () => {
  it('stops being in the way once it has been cleared from view, and is solid again after a rest', async () => {
    const { w, p } = await flatSproutvale();
    const [g, ...rest] = campMembers(w, 'orchard_south');
    slay(w, g);
    for (const o of rest) slay(w, o);
    // The horn brings the second wave. Clear them too, or they stand on the walk.
    stepN(w, 5);
    for (const o of campMembers(w, 'orchard_south')) if (alive(o)) slay(w, o);
    expect(alive(g)).toBe(false);
    stepN(w, 700);
    // Walk straight at where it lies, from 3 m away: nothing should turn the player aside.
    const at = { ...g.tf.pos };
    standAt(w, at.x, at.z - 3);
    for (let i = 0; i < 90; i++) step(w, cmd({ camYaw: 0, move: { x: 0, y: 1 } }));
    expect(p.tf.pos.z, 'walked past the spot').toBeGreaterThan(at.z + 1);
    expect(Math.abs(p.tf.pos.x - at.x), 'not pushed aside').toBeLessThan(0.05);

    standBy(w, 'shrine_first_light');
    step(w, interact());
    step(w, ui([{ kind: 'rest' }]));
    stepN(w, 3);
    expect(alive(g)).toBe(true);
    expect(w.physics.hasCharacter(g.id)).toBe(true);
    expect(g.tf.pos.y).toBeCloseTo(g.brain!.home.y, 1);
    w.dispose();
  }, 30000);

  it('does not sink or drift while it lies there', async () => {
    const { w } = await flatSproutvale();
    const [g] = campMembers(w, 'orchard_south');
    slay(w, g);
    stepN(w, 60);
    const y = g.tf.pos.y;
    stepN(w, 900);
    expect(g.tf.pos.y).toBeCloseTo(y, 3);
    w.dispose();
  }, 30000);
});
