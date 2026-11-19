import { describe, expect, it } from 'vitest';
import { MOVE } from '../../src/content/tuning';
import { CELL_RES, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { step, stepN } from './combatHelpers';
import { VILLAGE_Y } from './m3Helpers';

/** Turning on foot: a runner leans through a corner at speed, and plants to reverse. */

async function runner(): Promise<{ w: SimWorld; p: Entity }> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: [256, VILLAGE_Y + 0.1, 40], yaw: 0 } }), 1);
  w.spawnPlayer(0);
  for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) w.loadCell({ cx, cz, heights: new Float32Array(CELL_RES * CELL_RES).fill(VILLAGE_Y), shapes: [] } as CellColliders);
  stepN(w, 5);
  return { w, p: w.playerEntity(0)! };
}

const stick = (x: number, y: number, sprint: boolean): InputCommand => {
  const c = idleInput(0);
  c.move = { x, y };
  c.held = sprint ? BTN.sprint : 0;
  return c;
};

/** Up to speed heading +Z, then steer: how long until they run the new line, and the slowest they went. */
async function turn(x: number, y: number, sprint: boolean) {
  const { w, p } = await runner();
  for (let i = 0; i < 60; i++) step(w, stick(0, 1, sprint));
  const top = p.loco!.speed;
  const goal = Math.atan2(-x, y);
  let ticks = 0, slowest = top;
  for (; ticks < 120; ticks++) {
    const off = Math.atan2(p.tf.vel.x, p.tf.vel.z) - goal;
    if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < 0.05 && p.loco!.speed > top * 0.97) break;
    step(w, stick(x, y, sprint));
    slowest = Math.min(slowest, p.loco!.speed);
  }
  w.dispose();
  return { seconds: ticks / 60, slowest, top };
}

describe('turning at a run', () => {
  it.each([
    ['a run', false],
    ['a sprint', true],
  ])('a right angle at %s keeps nearly all the speed', async (_name, sprint) => {
    const t = await turn(-1, 0, sprint);
    expect(t.seconds).toBeLessThan(0.17);
    expect(t.slowest).toBeGreaterThan(t.top * 0.95);
  });

  it('a sharp 135° turn is still carved, not stopped', async () => {
    const t = await turn(-Math.SQRT1_2, -Math.SQRT1_2, true);
    expect(t.seconds).toBeLessThan(0.25);
    expect(t.slowest).toBeGreaterThan(t.top * 0.95);
  });

  it('turning right round plants and goes back the other way, quickly', async () => {
    const t = await turn(0, -1, true);
    expect(t.seconds).toBeLessThan(0.37);
    expect(t.slowest).toBeLessThan(t.top / 2);
  });

  it('setting off in a straight line is as quick as it always was', async () => {
    const { w, p } = await runner();
    let ticks = 0;
    while (p.loco!.speed < MOVE.runSpeed - 0.01 && ticks < 60) {
      step(w, stick(0, 1, false));
      ticks++;
    }
    expect(ticks / 60).toBeCloseTo(MOVE.runSpeed / MOVE.accel, 1);
    w.dispose();
  });
});
