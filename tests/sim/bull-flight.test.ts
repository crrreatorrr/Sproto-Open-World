import { describe, expect, it } from 'vitest';
import { MOUNT } from '../../src/content/mounts';
import { CELL_RES, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { SPROUTVALE_CONTENT } from '../../src/content/world/sproutvaleContent';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { step, stepN } from './combatHelpers';
import { interact, VILLAGE_Y } from './m3Helpers';
import { standAt } from './m4Helpers';

/** The Pepe Bull flies: three quick jumps take off, it flies like a plane, and the ground lands it. */

const BULL = { x: 256, z: 120 };

/** Flat ground, the bull standing on it facing +Z, its rider in the saddle. */
async function saddled(seed = 1): Promise<{ w: SimWorld; p: Entity; bull: Entity }> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: [BULL.x, VILLAGE_Y + 1, 100], yaw: 0 } }), seed);
  w.spawnPlayer(0);
  for (let cx = 0; cx < 8; cx++) {
    for (let cz = 0; cz < 8; cz++) {
      w.loadCell({ cx, cz, heights: new Float32Array(CELL_RES * CELL_RES).fill(VILLAGE_Y), shapes: [] } as CellColliders);
    }
  }
  step(w);
  w.populateWorld({
    ...SPROUTVALE_CONTENT, npcs: [], shrines: [], chests: [], enemies: [], camps: [], objects: [], obstacles: [], triggers: [],
    mounts: [{ id: 'pepe_bull', pos: [BULL.x, VILLAGE_Y, BULL.z], yaw: 0 }],
  });
  stepN(w, 5);
  const p = w.playerEntity(0)!;
  const bull = w.entities.find((e) => e.mount)!;
  standAt(w, bull.tf.pos.x - 2.5, bull.tf.pos.z, bull.tf.pos);
  step(w, interact());
  stepN(w, MOUNT.mountTicks + 2);
  expect(p.riding?.state).toBe('riding');
  return { w, p, bull };
}

/** One tick with the stick at (x, y) (y forward) and these buttons pressed this tick. */
function cmd(x: number, y: number, pressed = 0): InputCommand {
  const c = idleInput(0);
  c.move = { x, y };
  c.pressed = pressed;
  c.held = pressed;
  return c;
}

function fly(w: SimWorld, ticks: number, x: number, y: number, press: (i: number) => number = () => 0): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...step(w, cmd(x, y, press(i))));
  return out;
}

/** Three jump presses this many ticks apart. */
function tripleJump(w: SimWorld, gap = 8): SimEvent[] {
  const out: SimEvent[] = [];
  for (let n = 0; n < 3; n++) {
    out.push(...step(w, cmd(0, 0, BTN.jump)));
    if (n < 2) out.push(...fly(w, gap - 1, 0, 0));
  }
  return out;
}

/** Up off the ground and climbing clear of it. */
function takeOff(w: SimWorld, p: Entity): void {
  tripleJump(w);
  expect(p.riding!.flight).toBeDefined();
  fly(w, 90, 0, -1); // stick back: nose up
}

describe('three quick jumps take off', () => {
  it('rises off the ground and flies without falling, the bull with its rider', async () => {
    const { w, p, bull } = await saddled();
    const ev = tripleJump(w);
    expect(ev.some((e) => e.type === 'mountFlight' && e.phase === 'takeoff')).toBe(true);
    expect(p.riding!.flight).toBeDefined();
    fly(w, 60, 0, 0);
    const high = p.tf.pos.y;
    expect(high).toBeGreaterThan(VILLAGE_Y + 2);
    // Level, hands off: no gravity pulls it down.
    fly(w, 120, 0, 0);
    expect(p.tf.pos.y).toBeGreaterThanOrEqual(high - 0.1);
    expect(p.riding!.flight).toBeDefined();
    expect(bull.tf.pos).toEqual(p.tf.pos);
    expect(bull.mount!.fly).toBeDefined();
    expect(bull.mount!.speed).toBeGreaterThan(MOUNT.fly.slowest);
    w.dispose();
  });

  it('jumps spaced too far apart are only jumps', async () => {
    const { w, p } = await saddled();
    tripleJump(w, MOUNT.fly.jumpWindow + 30);
    expect(p.riding!.flight).toBeUndefined();
    fly(w, 120, 0, 0);
    expect(p.tf.pos.y).toBeCloseTo(VILLAGE_Y, 1);
    w.dispose();
  });

  it('can\'t be got off in mid-air: the interact button does nothing up there', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    step(w, interact());
    fly(w, MOUNT.dismountTicks + 5, 0, 0);
    expect(p.riding?.state).toBe('riding');
    expect(p.riding!.flight).toBeDefined();
    w.dispose();
  });
});

describe('it flies like a plane', () => {
  it('stick forward dives, stick back climbs, let go and it levels out', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    const y0 = p.tf.pos.y;
    fly(w, 60, 0, -1);
    expect(p.tf.pos.y).toBeGreaterThan(y0 + 5);
    expect(p.riding!.flight!.pitch).toBeCloseTo(MOUNT.fly.pitchMax, 2);
    fly(w, 120, 0, 0);
    expect(p.riding!.flight!.pitch).toBeCloseTo(0, 3);
    const y1 = p.tf.pos.y;
    fly(w, 40, 0, 1);
    expect(p.tf.pos.y).toBeLessThan(y1 - 3);
    expect(p.riding!.flight!.pitch).toBeLessThan(0);
    w.dispose();
  });

  it('a dive gathers speed and a climb loses it', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    fly(w, 150, 0, 0);
    const level = p.riding!.flight!.speed;
    expect(level).toBeCloseTo(MOUNT.fly.cruise, 0);
    fly(w, 90, 0, 1);
    expect(p.riding!.flight!.speed).toBeGreaterThan(level + 2);
    w.dispose();
  });

  it('the stick\'s side banks it, and it turns the way it banks', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    fly(w, 120, 0, 0);
    const yaw0 = p.tf.yaw;
    fly(w, 60, 1, 0);
    expect(p.riding!.flight!.bank).toBeGreaterThan(0.5);
    // Heading +Z, the stick's right is world −X: the bull turns toward it.
    expect(p.tf.vel.x).toBeLessThan(-2);
    expect(p.tf.yaw).toBeLessThan(yaw0 - 0.5);
    fly(w, 90, 0, 0);
    expect(p.riding!.flight!.bank).toBeCloseTo(0, 3);
    w.dispose();
  });

  it('the gallop button is the throttle: boost flies faster than cruising', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    fly(w, 150, 0, 0);
    const cruise = p.loco!.speed;
    fly(w, 1, 0, 0, () => BTN.sprint);
    fly(w, 180, 0, 0);
    expect(p.riding!.gallop).toBe(true);
    expect(p.loco!.speed).toBeGreaterThan(cruise + 6);
    expect(p.riding!.flight!.speed).toBeCloseTo(MOUNT.fly.boost, 0);
    w.dispose();
  });

  it('can\'t climb past the ceiling', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    fly(w, 60 * 20, 0, -1);
    expect(p.tf.pos.y).toBeLessThanOrEqual(MOUNT.fly.ceiling + 0.01);
    w.dispose();
  });

  it('a wall in the air stops it: it doesn\'t fly through', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    const wall = p.tf.pos.z + 40;
    w.physics.addBarrier(9001, { x: p.tf.pos.x, y: p.tf.pos.y, z: wall }, [30, 30, 0.1], 0);
    w.physics.step();
    fly(w, 60 * 6, 0, 0);
    expect(p.tf.pos.z + MOUNT.bodyHalfLength).toBeLessThanOrEqual(wall);
    w.dispose();
  });
});

describe('fighting from the air', () => {
  /** Flying level this high over the ground, with a dummy on the ground just ahead and to the side. */
  async function overADummy(height: number) {
    const f = await saddled();
    takeOff(f.w, f.p);
    fly(f.w, 120, 0, 0);
    f.p.tf.pos.y = f.p.tf.prevPos.y = VILLAGE_Y + height;
    f.p.riding!.flight!.pitch = 0;
    f.w.physics.teleport(f.p.id, f.p.tf.pos);
    const ahead = f.p.riding!.flight!.speed * 0.2;
    const d = f.w.spawnEnemy('dummy_passive', { x: f.p.tf.pos.x + MOUNT.rideRadius, y: VILLAGE_Y, z: f.p.tf.pos.z + ahead + 1 }, Math.PI);
    delete d.settle;
    return { ...f, d };
  }

  it('a swing on a low pass hits what it flies over, and it keeps flying', async () => {
    const { w, p, d } = await overADummy(2);
    const ev = fly(w, 34, 0, 0, (i) => (i === 0 ? BTN.light : 0));
    expect(ev.some((e) => e.type === 'hit' && e.attacker === p.id && e.target === d.id)).toBe(true);
    expect(p.riding!.flight).toBeDefined();
    w.dispose();
  });

  it('high up, a swing reaches nothing on the ground', async () => {
    const { w, p, d } = await overADummy(9);
    const ev = fly(w, 34, 0, 0, (i) => (i === 0 ? BTN.light : 0));
    expect(ev.some((e) => e.type === 'hit' && e.target === d.id)).toBe(false);
    expect(p.riding!.flight).toBeDefined();
    w.dispose();
  });

  it('casts from the air without slowing or dropping', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    fly(w, 120, 0, 0);
    const speed = p.loco!.speed;
    const ev = fly(w, 30, 0, 0, (i) => (i === 0 ? BTN.spell1 : 0));
    expect(ev.some((e) => e.type === 'cast' && e.entity === p.id)).toBe(true);
    expect(p.riding!.flight).toBeDefined();
    expect(p.loco!.speed).toBeGreaterThan(speed - 1);
    w.dispose();
  });
});

describe('coming down', () => {
  it('touching the ground lands it: back to running, on the ground', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    const ev = fly(w, 60 * 8, 0, 1);
    expect(ev.some((e) => e.type === 'mountFlight' && e.phase === 'landed')).toBe(true);
    expect(p.riding!.flight).toBeUndefined();
    expect(p.riding?.state).toBe('riding');
    fly(w, 30, 0, 1);
    expect(p.loco!.grounded).toBe(true);
    expect(p.tf.pos.y).toBeCloseTo(VILLAGE_Y, 1);
    w.dispose();
  });

  it('three quick jumps in the air drop it out of flight, and it falls to the ground', async () => {
    const { w, p } = await saddled();
    takeOff(w, p);
    const ev = tripleJump(w);
    expect(ev.some((e) => e.type === 'mountFlight' && e.phase === 'dropped')).toBe(true);
    expect(p.riding!.flight).toBeUndefined();
    fly(w, 60 * 5, 0, 0);
    expect(p.loco!.grounded).toBe(true);
    expect(p.tf.pos.y).toBeCloseTo(VILLAGE_Y, 1);
    expect(p.riding?.state).toBe('riding');
    w.dispose();
  });

  it('a flight replays the same from a snapshot', async () => {
    const script = (i: number) => cmd(Math.sin(i / 40), Math.cos(i / 55), i % 70 === 3 ? BTN.sprint : 0);
    const { w, p } = await saddled(5);
    takeOff(w, p);
    const snap = w.snapshot();
    const a: number[] = [];
    for (let i = 0; i < 300; i++) {
      step(w, script(i));
      a.push(w.hash());
    }
    w.restore(snap);
    const b: number[] = [];
    for (let i = 0; i < 300; i++) {
      step(w, script(i));
      b.push(w.hash());
    }
    expect(b).toEqual(a);
    w.dispose();
  });
});
