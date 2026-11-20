import { describe, expect, it } from 'vitest';
import { MOUNT } from '../../src/content/mounts';
import { MOVE } from '../../src/content/tuning';
import { CELL_RES, CELL_SIZE, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { SPROUTVALE_CONTENT } from '../../src/content/world/sproutvaleContent';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { step, stepN } from './combatHelpers';
import { interact, VILLAGE_Y } from './m3Helpers';
import { standAt } from './m4Helpers';

/** The Pepe Bull has a body: nobody walks through it, it fits where it rides, and hills don't stop it. */

const BULL = { x: 256, z: 40 };

/** Flat ground up to z = 80, then a hill of this many degrees; the bull stands facing +Z. */
async function field(hillDeg = 0): Promise<{ w: SimWorld; p: Entity; bull: Entity }> {
  await initPhysics();
  const rise = Math.tan((hillDeg * Math.PI) / 180);
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: [BULL.x, VILLAGE_Y + 1, 20], yaw: 0 } }), 1);
  w.spawnPlayer(0);
  for (let cx = 0; cx < 8; cx++) {
    for (let cz = 0; cz < 8; cz++) {
      const heights = new Float32Array(CELL_RES * CELL_RES);
      for (let iz = 0; iz < CELL_RES; iz++) {
        const z = cz * CELL_SIZE + (iz / (CELL_RES - 1)) * CELL_SIZE;
        heights.fill(VILLAGE_Y + Math.max(0, z - 80) * rise, iz * CELL_RES, (iz + 1) * CELL_RES);
      }
      w.loadCell({ cx, cz, heights, shapes: [] } as CellColliders);
    }
  }
  step(w);
  w.populateWorld({
    ...SPROUTVALE_CONTENT, npcs: [], shrines: [], chests: [], enemies: [], camps: [], objects: [], obstacles: [], triggers: [],
    mounts: [{ id: 'pepe_bull', pos: [BULL.x, VILLAGE_Y, BULL.z], yaw: 0 }],
  });
  stepN(w, 5);
  return { w, p: w.playerEntity(0)!, bull: w.entities.find((e) => e.mount)! };
}

function saddleUp(w: SimWorld, p: Entity, bull: Entity): void {
  standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
  step(w, interact());
  stepN(w, MOUNT.mountTicks + 2);
  expect(p.riding?.state).toBe('riding');
}

const push = (x: number, y: number, press = 0): InputCommand => {
  const c = idleInput(0);
  c.move = { x, y };
  c.pressed = press;
  c.held = press;
  return c;
};
const hold = (w: SimWorld, ticks: number, c: InputCommand) => {
  for (let i = 0; i < ticks; i++) step(w, { ...c, pressed: i === 0 ? c.pressed : 0 });
};

/** Is the bull's body in the way of a ray across its middle? */
const solid = (w: SimWorld, bull: Entity) =>
  w.physics.raycast({ x: bull.tf.pos.x - 3, y: bull.tf.pos.y + 0.8, z: bull.tf.pos.z }, { x: 1, y: 0, z: 0 }, 6) !== null;

describe('the standing bull is solid', () => {
  it.each([
    ['from the side', -4, 0, 1, 0, 'x', MOUNT.bodyHalfWidth],
    ['from behind', 0, -5, 0, 1, 'z', MOUNT.bodyHalfLength],
  ] as const)('a runner %s stops at its body', async (_name, ox, oz, wx, wz, axis, half) => {
    const { w, p, bull } = await field();
    standAt(w, bull.tf.pos.x + ox, bull.tf.pos.z + oz);
    // Camera right is world -X at yaw 0, so the stick's x runs the other way.
    hold(w, 180, push(-wx, wz));
    const gap = Math.abs(p.tf.pos[axis] - bull.tf.pos[axis]);
    expect(gap).toBeGreaterThanOrEqual(half + p.body!.radius - 0.05);
    expect(gap).toBeLessThan(half + p.body!.radius + 0.2);
    w.dispose();
  });

  it('can\'t be slipped through at a corner', async () => {
    const { w, p, bull } = await field();
    standAt(w, bull.tf.pos.x - 4, bull.tf.pos.z - 4);
    for (let i = 0; i < 240; i++) {
      step(w, push(-1, 1));
      const side = Math.max(0, Math.abs(p.tf.pos.x - bull.tf.pos.x) - MOUNT.bodyHalfWidth), along = Math.max(0, Math.abs(p.tf.pos.z - bull.tf.pos.z) - MOUNT.bodyHalfLength);
      expect(Math.hypot(side, along)).toBeGreaterThan(p.body!.radius - 0.05);
    }
    w.dispose();
  });

  it('stays solid under someone leaning on it, at its side and at its corner', async () => {
    for (const [ox, oz, wx, wz] of [[-4, 0, 1, 0], [-4, -4, Math.SQRT1_2, Math.SQRT1_2]] as const) {
      const { w, p, bull } = await field();
      standAt(w, bull.tf.pos.x + ox, bull.tf.pos.z + oz);
      for (let i = 0; i < 300; i++) {
        step(w, push(-wx, wz));
        const out = Math.hypot(Math.max(0, Math.abs(p.tf.pos.x - bull.tf.pos.x) - MOUNT.bodyHalfWidth), Math.max(0, Math.abs(p.tf.pos.z - bull.tf.pos.z) - MOUNT.bodyHalfLength));
        expect(out, `tick ${i}`).toBeGreaterThan(p.body!.radius - 0.05);
      }
      w.dispose();
    }
  });

  it('turns with the bull: it is long the way the bull faces', async () => {
    const { w, p, bull } = await field();
    bull.tf.yaw = bull.tf.prevYaw = Math.PI / 2;
    stepN(w, 2);
    standAt(w, bull.tf.pos.x - 5, bull.tf.pos.z);
    hold(w, 180, push(-1, 0));
    expect(bull.tf.pos.x - p.tf.pos.x).toBeGreaterThanOrEqual(MOUNT.bodyHalfLength + p.body!.radius - 0.05);
    w.dispose();
  });

  it('is solid where it really stands in Sproutvale', async () => {
    await initPhysics();
    const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: [BULL.x, VILLAGE_Y + 1, 20], yaw: 0 } }), 1);
    w.spawnPlayer(0);
    for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) w.loadCell({ cx, cz, heights: new Float32Array(CELL_RES * CELL_RES).fill(VILLAGE_Y), shapes: [] } as CellColliders);
    step(w);
    w.populateWorld(SPROUTVALE_CONTENT);
    stepN(w, 8);
    expect(solid(w, w.entities.find((e) => e.mount)!)).toBe(true);
    w.dispose();
  });
});

describe('getting on and off a solid bull', () => {
  it('its body is gone while it is ridden, and back once the rider is clear', async () => {
    const { w, p, bull } = await field();
    expect(solid(w, bull)).toBe(true);
    saddleUp(w, p, bull);
    stepN(w, 2);
    expect(solid(w, bull)).toBe(false);
    step(w, interact());
    expect(p.riding?.state).toBe('dismounting');
    stepN(w, MOUNT.dismountTicks + 3);
    expect(p.riding).toBeUndefined();
    expect(Math.hypot(p.tf.pos.x - bull.tf.pos.x, p.tf.pos.z - bull.tf.pos.z)).toBeCloseTo(MOUNT.dismountSide, 0);
    expect(solid(w, bull)).toBe(true);
    w.dispose();
  });

  it('never traps anyone: with no room to climb down, the rider walks out and the body comes back', async () => {
    const { w, p, bull } = await field();
    saddleUp(w, p, bull);
    w.physics.addBarrier(9001, { x: bull.tf.pos.x + 0.95, y: VILLAGE_Y + 1.5, z: bull.tf.pos.z }, [0.1, 3, 6], 0);
    w.physics.addBarrier(9002, { x: bull.tf.pos.x - 0.95, y: VILLAGE_Y + 1.5, z: bull.tf.pos.z }, [0.1, 3, 6], 0);
    w.physics.step();
    step(w, interact());
    stepN(w, MOUNT.dismountTicks + 3);
    expect(p.riding).toBeUndefined();
    // Looked at along the bull: the walls either side are out of this ray's way.
    const body = () => w.physics.raycast({ x: bull.tf.pos.x, y: bull.tf.pos.y + 0.8, z: bull.tf.pos.z - 3 }, { x: 0, y: 0, z: 1 }, 6) !== null;
    expect(body()).toBe(false);
    hold(w, 90, push(0, 1));
    expect(p.tf.pos.z - bull.tf.pos.z).toBeGreaterThan(MOUNT.bodyHalfLength + p.body!.radius);
    stepN(w, 2);
    expect(body()).toBe(true);
    w.dispose();
  });

  it('a replay from a snapshot taken while climbing down matches', async () => {
    const run = async (restoreAt: number | null) => {
      const { w, p, bull } = await field();
      saddleUp(w, p, bull);
      hold(w, 40, push(0, 1));
      hold(w, 60, push(0, 0));
      step(w, interact());
      stepN(w, 10);
      const snap = w.snapshot();
      const script = (i: number) => push(i < 60 ? 1 : -1, 0.3);
      const play = (n: number) => { for (let i = 0; i < n; i++) step(w, script(i)); };
      if (restoreAt !== null) {
        play(restoreAt);
        w.restore(snap);
      }
      play(120);
      const out = w.hash();
      w.dispose();
      return out;
    };
    expect(await run(45)).toBe(await run(null));
  });
});

describe('resting with the bull at the shrine', () => {
  it('leaves it on the ground, however many times you rest', async () => {
    await initPhysics();
    const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: [BULL.x, VILLAGE_Y + 1, 20], yaw: 0 } }), 1);
    w.spawnPlayer(0);
    for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) w.loadCell({ cx, cz, heights: new Float32Array(CELL_RES * CELL_RES).fill(VILLAGE_Y), shapes: [] } as CellColliders);
    stepN(w, 30);
    const shrine = SPROUTVALE_CONTENT.shrines[0];
    w.populateWorld({
      ...SPROUTVALE_CONTENT, npcs: [], chests: [], enemies: [], camps: [], objects: [], obstacles: [], triggers: [],
      shrines: [{ ...shrine, pos: [BULL.x, VILLAGE_Y, BULL.z] }],
    });
    stepN(w, 5);
    const p = w.playerEntity(0)!;
    const bull = w.entities.find((e) => e.mount)!;
    const rest = () => {
      standAt(w, BULL.x, BULL.z - 2, { x: BULL.x, z: BULL.z });
      step(w, interact());
      expect(p.progress!.atShrine).toBe(shrine.id);
      const c = idleInput(0);
      c.ui = [{ kind: 'rest' }];
      step(w, c);
      stepN(w, 6);
    };
    for (let i = 0; i < 4; i++) {
      rest();
      expect(bull.tf.pos.y, `rest ${i + 1}`).toBeCloseTo(VILLAGE_Y, 1);
    }
    w.dispose();
  });
});

describe('in the saddle the bull is as wide as it looks', () => {
  it('stops with its flank on a wall, not the rider\'s', async () => {
    const { w, p, bull } = await field();
    saddleUp(w, p, bull);
    w.physics.addBarrier(9001, { x: bull.tf.pos.x + 6, y: VILLAGE_Y + 1.5, z: bull.tf.pos.z }, [0.1, 3, 20], 0);
    w.physics.step();
    hold(w, 90, push(-1, 0));
    expect(p.tf.pos.x).toBeLessThanOrEqual(bull.tf.pos.x + 5.9);
    expect(bull.tf.pos.x + 6 - 0.1 - p.tf.pos.x).toBeGreaterThanOrEqual(MOUNT.rideRadius - 0.03);
    w.dispose();
  });

  it('can\'t squeeze through a gap a person fits through', async () => {
    const { w, p, bull } = await field();
    const gap = (MOUNT.rideRadius + p.body!.radius); // wider than a person, narrower than the bull
    for (const [id, side] of [[9001, -1], [9002, 1]] as const) w.physics.addBarrier(id, { x: bull.tf.pos.x + side * (gap / 2 + 0.5), y: VILLAGE_Y + 1.5, z: bull.tf.pos.z + 12 }, [0.5, 3, 0.5], 0);
    w.physics.step();
    saddleUp(w, p, bull);
    p.tf.pos.x = bull.tf.pos.x;
    hold(w, 120, push(0, 1));
    expect(p.tf.pos.z).toBeLessThan(bull.tf.pos.z + 12);
    w.dispose();
  });
});

describe('in the saddle the bull is as long as it looks', () => {
  it('runs at a wall and stops with its nose on it, not its middle', async () => {
    const { w, p, bull } = await field();
    saddleUp(w, p, bull);
    const wall = bull.tf.pos.z + 30;
    w.physics.addBarrier(9001, { x: bull.tf.pos.x, y: VILLAGE_Y + 1.5, z: wall }, [10, 3, 0.1], 0);
    w.physics.step();
    hold(w, 150, push(0, 1, BTN.sprint));
    const nose = p.tf.pos.z + MOUNT.bodyHalfLength;
    expect(nose).toBeLessThanOrEqual(wall - 0.1 + 0.02);
    expect(nose).toBeGreaterThan(wall - 0.1 - MOUNT.noseRadius - 0.1);
    expect(p.loco!.speed).toBeLessThan(0.5);
    w.dispose();
  });

  it('puts its head over a low fence: only its body stops on it', async () => {
    const { w, p, bull } = await field();
    saddleUp(w, p, bull);
    const fence = bull.tf.pos.z + 10;
    const top = MOUNT.noseHeight - MOUNT.noseRadius - 0.2;
    w.physics.addBarrier(9001, { x: bull.tf.pos.x, y: VILLAGE_Y + top / 2, z: fence }, [10, top / 2, 0.1], 0);
    w.physics.step();
    hold(w, 120, push(0, 1));
    expect(fence - 0.1 - p.tf.pos.z).toBeLessThan(MOUNT.rideRadius + 0.1);
    expect(p.tf.pos.z + MOUNT.bodyHalfLength).toBeGreaterThan(fence);
    w.dispose();
  });

  it('stands on the ground in the saddle, not above it', async () => {
    const { w, p, bull } = await field();
    saddleUp(w, p, bull);
    hold(w, 60, push(0, 1));
    hold(w, 60, push(0, 0));
    expect(p.tf.pos.y).toBeCloseTo(VILLAGE_Y, 1);
    expect(Math.abs(p.tf.pos.y - VILLAGE_Y)).toBeLessThan(0.05);
    expect(Math.abs(bull.tf.pos.y - VILLAGE_Y)).toBeLessThan(0.05);
    w.dispose();
  });
});

describe('the bull climbs', () => {
  const climb = async (deg: number, gallop: boolean) => {
    const { w, p, bull } = await field(deg);
    saddleUp(w, p, bull);
    hold(w, 1, push(0, 1, gallop ? BTN.sprint : 0));
    while (p.tf.pos.z < 86) step(w, push(0, 1));
    const z0 = p.tf.pos.z;
    const ticks = 120;
    hold(w, ticks, push(0, 1));
    const speed = (p.tf.pos.z - z0) / (ticks / 60);
    w.dispose();
    return speed;
  };

  it.each([
    [10, 16],
    [20, 14.5],
    [30, 12],
    [40, 9.5],
  ])('gallops up a %i° hill at over %d m/s across the ground', async (deg, least) => {
    expect(await climb(deg, true)).toBeGreaterThan(least);
  });

  it('trots up a 20° hill, slower than it gallops', async () => {
    const trot = await climb(20, false);
    expect(trot).toBeGreaterThan(8);
    expect(trot).toBeLessThan(MOUNT.trotSpeed);
  });

  it('a wall on the hill still stops it dead', async () => {
    const { w, p, bull } = await field(20);
    saddleUp(w, p, bull);
    w.physics.addBarrier(9001, { x: bull.tf.pos.x, y: VILLAGE_Y + 8, z: 100 }, [30, 20, 0.2], 0);
    w.physics.step();
    hold(w, 1, push(0, 1, BTN.sprint));
    hold(w, 300, push(0, 1));
    expect(p.tf.pos.z).toBeLessThan(100);
    expect(p.loco!.speed).toBeLessThan(1);
    expect(Math.hypot(p.tf.vel.x, p.tf.vel.z)).toBeLessThan(1);
    w.dispose();
  });

  it('on foot a hill slows a runner as it always did', async () => {
    const { w, p } = await field(20);
    standAt(w, BULL.x + 6, 84);
    hold(w, 30, push(0, 1));
    const z0 = p.tf.pos.z;
    hold(w, 60, push(0, 1));
    expect(p.tf.pos.z - z0).toBeLessThan(MOVE.runSpeed);
    w.dispose();
  });
});
