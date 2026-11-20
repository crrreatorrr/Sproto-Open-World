import { describe, expect, it } from 'vitest';
import { MOUNT } from '../../src/content/mounts';
import { DT } from '../../src/content/tuning';
import { CELL_RES, CELL_SIZE, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { SPROUTVALE_CONTENT } from '../../src/content/world/sproutvaleContent';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { GROUP, initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { step, stepN } from './combatHelpers';
import { interact, VILLAGE_Y } from './m3Helpers';
import { standAt } from './m4Helpers';

/** Calling the Pepe Bull: it runs to you, or appears out of sight nearby and runs in. */

const BULL = { x: 256, z: 40 };
const flatDist = (a: Entity, b: Entity) => Math.hypot(a.tf.pos.x - b.tf.pos.x, a.tf.pos.z - b.tf.pos.z);

async function field(opts: { hillDeg?: number; ledgeBefore?: number; cells?: (cx: number, cz: number) => boolean } = {}): Promise<{ w: SimWorld; p: Entity; bull: Entity }> {
  await initPhysics();
  const rise = Math.tan(((opts.hillDeg ?? 0) * Math.PI) / 180);
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: [BULL.x, VILLAGE_Y + 1, 20], yaw: 0 } }), 1);
  w.spawnPlayer(0);
  for (let cx = 0; cx < 8; cx++) {
    for (let cz = 0; cz < 8; cz++) {
      if (opts.cells && !opts.cells(cx, cz)) continue;
      const heights = new Float32Array(CELL_RES * CELL_RES);
      for (let iz = 0; iz < CELL_RES; iz++) {
        const z = cz * CELL_SIZE + (iz / (CELL_RES - 1)) * CELL_SIZE;
        heights.fill(VILLAGE_Y + Math.max(0, z - 50) * rise + (opts.ledgeBefore !== undefined && z < opts.ledgeBefore ? 8 : 0), iz * CELL_RES, (iz + 1) * CELL_RES);
      }
      w.loadCell({ cx, cz, heights, shapes: [] } as CellColliders);
    }
  }
  stepN(w, 30);
  w.populateWorld({
    ...SPROUTVALE_CONTENT, npcs: [], shrines: [], chests: [], enemies: [], camps: [], objects: [], obstacles: [], triggers: [],
    mounts: [{ id: 'pepe_bull', pos: [BULL.x, VILLAGE_Y, BULL.z], yaw: 0 }],
  });
  stepN(w, 5);
  return { w, p: w.playerEntity(0)!, bull: w.entities.find((e) => e.mount)! };
}

const call = (camYaw = 0): InputCommand => {
  const c = idleInput(camYaw);
  c.pressed = BTN.callMount;
  c.held = BTN.callMount;
  return c;
};

/** Run until the call ends; report the events and the biggest single-tick move the bull made after `from`. */
function untilDone(w: SimWorld, bull: Entity, maxTicks = 1500, camYaw = 0) {
  const events: SimEvent[] = [];
  let biggest = 0, top = 0;
  for (let i = 0; i < maxTicks && bull.mount!.call; i++) {
    const was = { ...bull.tf.pos };
    const out = step(w, idleInput(camYaw));
    events.push(...out);
    if (!out.some((e) => e.type === 'mountCall' && e.phase === 'appeared')) biggest = Math.max(biggest, Math.hypot(bull.tf.pos.x - was.x, bull.tf.pos.z - was.z));
    top = Math.max(top, bull.mount!.speed);
  }
  return { events, biggest, top, phases: events.flatMap((e) => (e.type === 'mountCall' ? [e.phase] : [])) };
}

describe('within range the bull runs to you', () => {
  it('runs over the ground, stops beside you facing you, and can be ridden', async () => {
    const { w, p, bull } = await field();
    standAt(w, BULL.x + 40, BULL.z + 20, bull.tf.pos);
    step(w, call());
    expect(bull.mount!.call).toBeDefined();
    const r = untilDone(w, bull);
    expect(r.phases).toEqual(['arrived']);
    expect(r.biggest).toBeLessThanOrEqual(MOUNT.gallopSpeed * DT + 0.02);
    expect(r.top).toBeGreaterThan(MOUNT.trotSpeed);
    expect(flatDist(p, bull)).toBeLessThanOrEqual(MOUNT.callStop + 0.3);
    expect(bull.mount!.speed).toBe(0);
    const toward = Math.atan2(p.tf.pos.x - bull.tf.pos.x, p.tf.pos.z - bull.tf.pos.z);
    expect(Math.abs(Math.sin(bull.tf.yaw - toward))).toBeLessThan(0.05);
    p.tf.yaw = p.tf.prevYaw = Math.atan2(bull.tf.pos.x - p.tf.pos.x, bull.tf.pos.z - p.tf.pos.z);
    step(w, interact());
    expect(p.riding?.state).toBe('mounting');
    w.dispose();
  });

  it('climbs a hill to reach you', async () => {
    const { w, p, bull } = await field({ hillDeg: 20 });
    standAt(w, BULL.x, 100, bull.tf.pos);
    p.tf.pos.y = VILLAGE_Y + 50 * Math.tan((20 * Math.PI) / 180) + 0.5;
    w.physics.teleport(p.id, p.tf.pos);
    stepN(w, 30);
    step(w, call());
    expect(untilDone(w, bull).phases).toEqual(['arrived']);
    expect(flatDist(p, bull)).toBeLessThanOrEqual(MOUNT.callStop + 0.3);
    w.dispose();
  });

  it('goes round a wall in its way', async () => {
    const { w, p, bull } = await field();
    standAt(w, BULL.x, BULL.z + 40, bull.tf.pos);
    w.physics.addBarrier(9001, { x: BULL.x, y: VILLAGE_Y + 1.5, z: BULL.z + 15 }, [5, 3, 0.3], 0);
    stepN(w, 2);
    step(w, call());
    expect(untilDone(w, bull).phases).toEqual(['arrived']);
    expect(flatDist(p, bull)).toBeLessThanOrEqual(MOUNT.callStop + 0.3);
    w.dispose();
  });
});

describe('from too far away it appears out of sight and runs in', () => {
  it('appears behind the camera at the arrival distance, then runs the rest of the way', async () => {
    const { w, p, bull } = await field();
    standAt(w, 256, 300, bull.tf.pos);
    stepN(w, 3);
    const camYaw = 0.7;
    const out = step(w, call(camYaw));
    expect(out.some((e) => e.type === 'mountCall' && e.phase === 'appeared')).toBe(true);
    const d = flatDist(p, bull);
    expect(d).toBeGreaterThanOrEqual(Math.min(...MOUNT.callAppear) - 0.5);
    expect(d).toBeLessThanOrEqual(Math.max(...MOUNT.callAppear) + 0.5);
    // Behind the camera: the way it is looking points away from the bull.
    const dot = Math.sin(camYaw) * (bull.tf.pos.x - p.tf.pos.x) + Math.cos(camYaw) * (bull.tf.pos.z - p.tf.pos.z);
    expect(dot).toBeLessThan(0);
    // Drawn from where it appeared: no streak across the map.
    expect(Math.hypot(bull.tf.pos.x - bull.tf.prevPos.x, bull.tf.pos.z - bull.tf.prevPos.z)).toBeLessThanOrEqual(MOUNT.gallopSpeed * DT + 0.02);
    const r = untilDone(w, bull, 1500, camYaw);
    expect(r.phases).toEqual(['arrived']);
    expect(r.biggest).toBeLessThanOrEqual(MOUNT.gallopSpeed * DT + 0.02);
    expect(r.top).toBeGreaterThan(5);
    w.dispose();
  });

  it('walled in where it stands, it stops trying and appears near you', async () => {
    const { w, p, bull } = await field();
    standAt(w, BULL.x, BULL.z + 50, bull.tf.pos);
    for (const [id, x, z, hx, hz] of [[9001, 0, 4, 6, 0.3], [9002, 0, -4, 6, 0.3], [9003, 4, 0, 0.3, 6], [9004, -4, 0, 0.3, 6]] as const) {
      w.physics.addBarrier(id, { x: BULL.x + x, y: VILLAGE_Y + 1.5, z: BULL.z + z }, [hx, 3, hz], 0);
    }
    stepN(w, 2);
    step(w, call());
    const r = untilDone(w, bull);
    expect(r.phases).toEqual(['appeared', 'arrived']);
    expect(flatDist(p, bull)).toBeLessThanOrEqual(MOUNT.callStop + 0.3);
    w.dispose();
  });

  it('with nowhere to appear, it says so and stays where it is', async () => {
    const { w, p, bull } = await field();
    standAt(w, 256, 300, bull.tf.pos);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      w.physics.addBarrier(9001 + i, { x: p.tf.pos.x + Math.sin(a) * 6, y: VILLAGE_Y + 3, z: p.tf.pos.z + Math.cos(a) * 6 }, [2.2, 8, 0.3], a);
    }
    stepN(w, 2);
    const at = { ...bull.tf.pos };
    const out = step(w, call());
    expect(out.some((e) => e.type === 'mountCall' && e.phase === 'failed')).toBe(true);
    expect(bull.mount!.call).toBeUndefined();
    expect(bull.tf.pos).toEqual(at);
    w.dispose();
  });

  it('never runs onto ground that has not loaded: it appears on your side of the gap instead', async () => {
    const { w, p, bull } = await field({ cells: (_cx, cz) => cz !== 1 });
    bull.tf.pos.z = bull.tf.prevPos.z = 60;
    standAt(w, BULL.x, 132, bull.tf.pos);
    stepN(w, 3);
    expect(flatDist(p, bull)).toBeLessThan(MOUNT.callRange);
    const camYaw = Math.PI; // Looking back over the gap: behind the camera is the loaded side.
    step(w, call(camYaw));
    const phases: string[] = [];
    for (let i = 0; i < 900 && bull.mount!.call; i++) {
      for (const e of step(w, idleInput(camYaw))) if (e.type === 'mountCall') phases.push(e.phase);
      expect(Math.floor(bull.tf.pos.z / CELL_SIZE)).not.toBe(1);
    }
    expect(phases).toEqual(['appeared', 'arrived']);
    expect(flatDist(p, bull)).toBeLessThanOrEqual(MOUNT.callStop + 0.3);
    w.dispose();
  });
});

describe('ground going away under a running bull', () => {
  it('stops it falling: it appears near the caller instead', async () => {
    const { w, p, bull } = await field();
    // Far enough apart that the bull's cell isn't one of the three around the player, which stay loaded.
    bull.tf.pos.z = bull.tf.prevPos.z = 60;
    standAt(w, BULL.x, 132, bull.tf.pos);
    stepN(w, 3);
    step(w, call(Math.PI));
    expect(bull.mount!.call).toBeDefined();
    stepN(w, 2);
    const [cx, cz] = [Math.floor(bull.tf.pos.x / CELL_SIZE), Math.floor(bull.tf.pos.z / CELL_SIZE)];
    expect(w.unloadCell(cx, cz)).toBe(true);
    let lowest = bull.tf.pos.y;
    for (let i = 0; i < 400 && bull.mount!.call; i++) {
      step(w, idleInput(Math.PI));
      lowest = Math.min(lowest, bull.tf.pos.y);
    }
    expect(lowest).toBeGreaterThan(VILLAGE_Y - 0.5);
    expect(flatDist(p, bull)).toBeLessThanOrEqual(MOUNT.callStop + 0.3);
    w.dispose();
  });
});

describe('awkward places', () => {
  it('called off a ledge, it lands before it counts as arrived, and can be ridden', async () => {
    const { w, p, bull } = await field({ ledgeBefore: 60 });
    bull.tf.pos = { x: BULL.x, y: VILLAGE_Y + 8, z: 58 };
    bull.tf.prevPos = { ...bull.tf.pos };
    // Far enough out from the face for the bull to land between it and the caller: 2.5 m on the hub-sized bull.
    standAt(w, BULL.x, 60 + 2.5 * MOUNT.scale, bull.tf.pos);
    stepN(w, 3);
    step(w, call());
    expect(bull.mount!.call).toBeDefined();
    untilDone(w, bull);
    stepN(w, 5);
    // On the ground where it stands (the ledge's face falls 8 m between z = 59 and 60), and in reach.
    const surface = VILLAGE_Y + 8 * Math.max(0, Math.min(1, 60 - bull.tf.pos.z));
    expect(Math.abs(bull.tf.pos.y - surface)).toBeLessThan(0.4);
    expect(Math.abs(bull.tf.pos.y - p.tf.pos.y)).toBeLessThanOrEqual(2.5);
    p.tf.yaw = p.tf.prevYaw = Math.atan2(bull.tf.pos.x - p.tf.pos.x, bull.tf.pos.z - p.tf.pos.z);
    step(w, interact());
    expect(p.riding?.state).toBe('mounting');
    w.dispose();
  });

  it('a bull not yet set down, far away after loading a save, still comes', async () => {
    const { w, p, bull } = await field();
    standAt(w, 256, 300, bull.tf.pos);
    stepN(w, 3);
    bull.settle = true;
    const out = step(w, call());
    expect(out.some((e) => e.type === 'mountCall' && e.phase === 'appeared')).toBe(true);
    expect(bull.settle).toBeUndefined();
    expect(untilDone(w, bull).phases).toEqual(['arrived']);
    expect(flatDist(p, bull)).toBeLessThanOrEqual(MOUNT.callStop + 0.3);
    w.dispose();
  });
});

describe('what ends a call', () => {
  it('does nothing while riding', async () => {
    const { w, p, bull } = await field();
    standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
    step(w, interact());
    stepN(w, MOUNT.mountTicks + 2);
    expect(p.riding?.state).toBe('riding');
    step(w, call());
    expect(bull.mount!.call).toBeUndefined();
    w.dispose();
  });

  it('climbing on while it runs ends the run', async () => {
    const { w, p, bull } = await field();
    standAt(w, BULL.x, BULL.z + 30, bull.tf.pos);
    step(w, call());
    while (flatDist(p, bull) > MOUNT.reach - 0.2 && bull.mount!.call) step(w);
    p.tf.yaw = p.tf.prevYaw = Math.atan2(bull.tf.pos.x - p.tf.pos.x, bull.tf.pos.z - p.tf.pos.z);
    step(w, interact());
    expect(p.riding?.state).toBe('mounting');
    expect(bull.mount!.call).toBeUndefined();
    stepN(w, MOUNT.mountTicks + 2);
    expect(p.riding?.state).toBe('riding');
    w.dispose();
  });

  it('the caller dying ends the run', async () => {
    const { w, p, bull } = await field();
    standAt(w, BULL.x, BULL.z + 60, bull.tf.pos);
    step(w, call());
    stepN(w, 5);
    p.combat!.action = { kind: 'dead', t: 0 } as never;
    stepN(w, 2);
    expect(bull.mount!.call).toBeUndefined();
    expect(bull.mount!.speed).toBe(0);
    w.dispose();
  });
});

describe('a call replays', () => {
  it('a snapshot taken mid-run restores it, and the replay matches', async () => {
    const run = async (rewind: boolean) => {
      const { w, p, bull } = await field();
      standAt(w, BULL.x + 30, BULL.z + 30, bull.tf.pos);
      step(w, call());
      stepN(w, 40);
      expect(bull.mount!.call).toBeDefined();
      const snap = w.snapshot();
      if (rewind) {
        stepN(w, 25);
        w.restore(snap);
      }
      stepN(w, 200);
      const out = { hash: w.hash(), x: w.entities.find((e) => e.mount)!.tf.pos.x, near: flatDist(p, w.entities.find((e) => e.mount)!) };
      w.dispose();
      return out;
    };
    const a = await run(false), b = await run(true);
    expect(b.hash).toBe(a.hash);
    expect(a.near).toBeLessThanOrEqual(MOUNT.callStop + 0.3);
  });

  it('a rewind puts the running bull\'s collider back with it', async () => {
    const { w, bull } = await field();
    standAt(w, BULL.x, BULL.z + 60, bull.tf.pos);
    step(w, call());
    stepN(w, 20);
    const snap = w.snapshot();
    stepN(w, 30);
    const later = { ...w.entities.find((e) => e.mount)!.tf.pos };
    w.restore(snap);
    const now = w.entities.find((e) => e.mount)!.tf.pos;
    expect(Math.hypot(later.x - now.x, later.z - now.z)).toBeGreaterThan(3);
    const body = (at: { x: number; y: number; z: number }) => w.physics.raycast({ x: at.x, y: at.y + 5, z: at.z }, { x: 0, y: -1, z: 0 }, 4.5, GROUP.CHARACTER);
    expect(body(now)).not.toBeNull();
    expect(body(later)).toBeNull();
    w.dispose();
  });

  it('the call counts toward the world hash', async () => {
    const { w, bull } = await field();
    standAt(w, BULL.x, BULL.z + 30, bull.tf.pos);
    step(w);
    const before = w.hash();
    bull.mount!.call = { caller: 1, speed: 0, fall: 0, grounded: true, closest: 30, stuck: 0, side: 1, appeared: false };
    expect(w.hash()).not.toBe(before);
    w.dispose();
  });
});
