import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { CELL_RES, CELL_SIZE, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { idleInput } from '../../src/sim/commands';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';

/** A steady climb toward +z, too gentle for the blink's wall check to see. */
const SLOPE = 0.12;

function hill(cx: number, cz: number): CellColliders {
  const heights = new Float32Array(CELL_RES * CELL_RES);
  for (let iz = 0; iz < CELL_RES; iz++) for (let ix = 0; ix < CELL_RES; ix++) heights[iz * CELL_RES + ix] = (cz * CELL_SIZE + iz) * SLOPE;
  return { cx, cz, heights, shapes: [] };
}

describe("the Hex Wisp's blink", () => {
  it('lands on the ground on a hillside instead of inside it', async () => {
    await initPhysics();
    const w = new SimWorld(worldLevel({ id: 'hill', playerStart: { pos: [96, 20, 96], yaw: 0 } }), 1);
    for (let cx = 0; cx < 4; cx++) for (let cz = 0; cz < 4; cz++) w.loadCell(hill(cx, cz));
    const idle = new Map([[0, idleInput(0)]]);
    const p = w.spawnPlayer(0, { x: 96, y: 90 * SLOPE + 0.1, z: 90 }, 0);
    for (let i = 0; i < 3; i++) w.tick(idle);
    const start = { x: 96, y: 96 * SLOPE + 0.05, z: 96 };
    const wisp = w.spawnEnemy('wisp', start, Math.PI);
    for (let i = 0; i < 5; i++) w.tick(idle);

    let blinks = 0;
    for (let i = 0; i < 20; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      wisp.combat!.action = null;
      wisp.brain!.target = p.id;
      wisp.brain!.meleeHitsTaken = ENEMIES.wisp.blink!.hits;
      w.tick(idle);
      if (w.events.some((e) => e.type === 'blink')) blinks++;
      for (let k = 0; k < 20; k++) w.tick(idle);
      expect(wisp.tf.pos.y, `after blink ${i}`).toBeGreaterThan(wisp.tf.pos.z * SLOPE - 0.3);
      // Back beside the player for the next one.
      wisp.tf.pos = { ...start };
      wisp.tf.prevPos = { ...start };
      w.physics.teleport(wisp.id, wisp.tf.pos);
    }
    expect(blinks).toBeGreaterThan(10);
    w.dispose();
  });
});
