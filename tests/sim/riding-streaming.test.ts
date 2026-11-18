import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOUNT } from '../../src/content/mounts';
import { DT, KCC } from '../../src/content/tuning';
import { cellColliders, decodeCellBin, sampleHeight } from '../../src/content/world/codec';
import { CELL_RES, CELL_SIZE, cellKey, cellOf, type CellColliders, type CellData, type ColliderShape, type RegionManifest } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { CELL_COLLIDERS_PER_TICK, SimWorld } from '../../src/sim/SimWorld';
import { startMount } from '../../src/sim/systems/riding';
import { GROUND_NEAR_M, groundCells, planRings, type CellLevel } from '../../src/world/rings';

/**
 * The world keeps up with a galloping bull: the real streaming policy (rings.ts) drives a sim whose
 * rider covers the map at top speed, on flat cells and on the baked Sproutvale terrain.
 */

const WORLD_DIR = resolve(__dirname, '../../public/world/sproutvale');
const manifest = JSON.parse(readFileSync(resolve(WORLD_DIR, 'region.json'), 'utf8')) as RegionManifest;
const inRegion = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < manifest.size[0] && cz < manifest.size[1];

function bakedCell(cx: number, cz: number): { colliders: CellColliders; heights: Float32Array } {
  const name = `c_${cx}_${cz}`;
  const bin = readFileSync(resolve(WORLD_DIR, 'cells', `${name}.bin`));
  const json = JSON.parse(readFileSync(resolve(WORLD_DIR, 'cells', `${name}.json`), 'utf8')) as CellData;
  const { heights } = decodeCellBin(new Uint8Array(bin), manifest.heightRange);
  return { colliders: cellColliders(json, heights, manifest), heights };
}

const baked = new Map<string, ReturnType<typeof bakedCell>>();
function allBaked(): Map<string, ReturnType<typeof bakedCell>> {
  if (!baked.size) for (let cx = 0; cx < manifest.size[0]; cx++) for (let cz = 0; cz < manifest.size[1]; cz++) baked.set(cellKey(cx, cz), bakedCell(cx, cz));
  return baked;
}

/** A rider in the saddle at (x, z), the gallop on; the bull is spawned for them. */
async function rider(cells: Iterable<CellColliders>, x: number, y: number, z: number): Promise<{ w: SimWorld; p: Entity }> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'gallop', playerStart: { pos: [x, y, z], yaw: 0 } }), 1);
  const p = w.spawnPlayer(0);
  for (const c of cells) w.loadCell(c);
  w.populateWorld({ npcs: [], shrines: [], chests: [], enemies: [], camps: [], objects: [], obstacles: [], triggers: [], mounts: [{ id: 'bull', pos: [x, y, z], yaw: 0 }] } as never);
  const bull = w.entities.find((e) => e.mount)!;
  delete bull.settle;
  startMount(w.events, p, bull);
  p.riding!.state = 'riding';
  p.riding!.gallop = true;
  p.combat!.action = null;
  return { w, p };
}

const go = (yaw: number, extra = 0): InputCommand => {
  const c = idleInput(yaw);
  c.move = { x: 0, y: 1 };
  c.pressed = extra;
  c.held = extra;
  return c;
};

const flat = (cx: number, cz: number, shapes: ColliderShape[] = []): CellColliders => ({ cx, cz, heights: new Float32Array(CELL_RES * CELL_RES), shapes });

/** Colliders high above a flat cell, out of the rider's way: `count` is far more than any baked cell has (31 at most). */
function forest(cx: number, cz: number, count: number): ColliderShape[] {
  return Array.from({ length: count }, (_, i): ColliderShape => ({
    kind: 'cylinder', pos: [cx * CELL_SIZE + 3 + (i % 29) * 2, 60, cz * CELL_SIZE + 3 + Math.floor(i / 29) * 2], radius: 0.3, height: 4,
  }));
}

/**
 * CellStreamer's policy without the browser: each tick plan the rings, wait `latency` ticks from the
 * moment a cell is first wanted (fetch, decode and the worker's mesh build), hand Active cells'
 * colliders to the sim and take them back when they drop out.
 */
function streamer(w: SimWorld, make: (cx: number, cz: number) => CellColliders, latency: number) {
  const current = new Map<string, CellLevel>();
  const wantedAt = new Map<string, number>();
  const given = new Set<string>();
  return (tick: number, x: number, z: number) => {
    const plan = planRings({ players: [cellOf(x, z)], anchors: w.cellAnchors(), current, inRegion });
    for (const k of plan.unload) {
      const [cx, cz] = k.split(',').map(Number);
      if (w.unloadCell(cx, cz) !== false) given.delete(k);
      current.delete(k);
      wantedAt.delete(k);
    }
    for (const c of plan.want) {
      current.set(c.key, c.level);
      if (!wantedAt.has(c.key)) wantedAt.set(c.key, tick);
      if (c.level === 'active' && !given.has(c.key) && tick - wantedAt.get(c.key)! >= latency) {
        w.loadCell(make(c.cx, c.cz));
        given.add(c.key);
      } else if (c.level === 'visual' && given.has(c.key) && !c.anchored && w.unloadCell(c.cx, c.cz) !== false) given.delete(c.key);
    }
  };
}

/** The app's veil condition while playing (CellStreamer.groundReady). */
const veil = (w: SimWorld, x: number, z: number) =>
  w.view().waitingForGround || groundCells(x, z, true).some(([cx, cz]) => inRegion(cx, cz) && !w.cellReady(cx, cz));

describe('streaming keeps up with a gallop', () => {
  it('a new cell is needed no sooner than 2.3 s after it starts building', () => {
    // Crossing into a cell makes the next row Active a whole cell ahead; the veil only needs it 24 m out.
    expect((CELL_SIZE - GROUND_NEAR_M) / MOUNT.gallopSpeed).toBeGreaterThan(2.3);
    // Even the fastest thing in the saddle, a dodge out of a gallop.
    expect((CELL_SIZE - GROUND_NEAR_M) / (MOUNT.gallopSpeed * MOUNT.dodgeScale)).toBeGreaterThan(1.8);
  });

  it.each([
    ['east', Math.PI / 2, 20, 100],
    ['north', 0, 100, 20],
    ['the diagonal', Math.PI / 4, 20, 20],
    ['along a cell edge', 0, CELL_SIZE * 3 - 0.2, 20],
  ])('riding %s across the map never shows the veil, with cells slow to arrive', async (_name, yaw, x, z) => {
    const make = (cx: number, cz: number) => flat(cx, cz, forest(cx, cz, 300));
    const start: CellColliders[] = [];
    const [c0, c1] = cellOf(x, z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (inRegion(c0 + dx, c1 + dz)) start.push(flat(c0 + dx, c1 + dz));
    const { w, p } = await rider(start, x, 0, z);
    // A pessimistic 1.5 s from wanting a cell to having its colliders (fetch, decode, mesh).
    const stream = streamer(w, make, 90);
    w.tick(new Map([[0, go(yaw)]]));
    let veiled = 0;
    let fastest = 0;
    let ticks = 0;
    const end = (manifest.size[0] - 0.5) * CELL_SIZE;
    while (p.tf.pos.x < end && p.tf.pos.z < end && ticks < 3000) {
      stream(ticks, p.tf.pos.x, p.tf.pos.z);
      w.tick(new Map([[0, go(yaw)]]));
      if (veil(w, p.tf.pos.x, p.tf.pos.z)) veiled++;
      fastest = Math.max(fastest, p.loco!.speed);
      expect(p.tf.pos.y).toBeGreaterThan(-0.1);
      expect(p.tf.pos.y).toBeLessThan(0.1);
      ticks++;
    }
    expect(veiled).toBe(0);
    expect(fastest).toBeCloseTo(MOUNT.gallopSpeed, 1);
    expect(p.tf.pos.x >= end || p.tf.pos.z >= end).toBe(true);
    w.dispose();
  }, 60_000);

  it('a rider who outruns the loading is stopped at the cell\'s edge, never dropped through it', async () => {
    const { w, p } = await rider([flat(0, 0)], 32, 0, 50);
    for (let i = 0; i < 180; i++) w.tick(new Map([[0, go(0)]]));
    expect(cellOf(p.tf.pos.x, p.tf.pos.z)).toEqual([0, 0]);
    expect(p.tf.pos.z).toBeGreaterThan(CELL_SIZE - MOUNT.gallopSpeed * DT - 0.5);
    expect(p.tf.pos.y).toBeCloseTo(0, 1);
    expect(w.view().waitingForGround).toBe(false);
    expect(p.riding!.gallop).toBe(true);
    w.loadCell(flat(0, 1));
    for (let i = 0; i < 30; i++) w.tick(new Map([[0, go(0)]]));
    expect(p.tf.pos.z).toBeGreaterThan(CELL_SIZE);
    expect(p.tf.pos.y).toBeCloseTo(0, 1);
    w.dispose();
  });

  it(`the shipped cells fit the collider budget: a crossing's five new cells build in well under a second`, () => {
    const counts = [...allBaked().values()].map((c) => c.colliders.shapes.length + 1).sort((a, b) => b - a);
    const worstCrossing = counts.slice(0, 5).reduce((a, b) => a + b, 0);
    expect(worstCrossing / CELL_COLLIDERS_PER_TICK / 60).toBeLessThan(1);
  });
});

describe('colliders at a gallop', () => {
  it.each([
    ['a thin wall', 0.02],
    ['a paper-thin wall', 0.005],
  ])('stops dead on %s at full gallop, dodging into it too', async (_name, half) => {
    for (const dodge of [false, true]) {
      const { w, p } = await rider([flat(0, 0), flat(0, 1), flat(1, 0), flat(1, 1)], 32, 0, 8);
      w.physics.addBarrier(9001, { x: 32, y: 1.5, z: 60 }, [30, 3, half], 0);
      w.physics.step();
      w.tick(new Map([[0, go(0)]]));
      let fastest = 0;
      for (let i = 0; i < 240; i++) {
        const near = p.tf.pos.z > 52 && dodge && !p.combat!.action;
        w.tick(new Map([[0, go(0, near ? BTN.dodge : 0)]]));
        fastest = Math.max(fastest, p.loco!.speed);
        expect(p.tf.pos.z).toBeLessThan(60 - half);
      }
      expect(p.tf.pos.z).toBeGreaterThan(59);
      expect(fastest).toBeGreaterThan(dodge ? MOUNT.gallopSpeed + 1 : MOUNT.gallopSpeed - 0.1);
      w.dispose();
    }
  });
});

describe('the baked Sproutvale at a gallop', () => {
  /** Ride a straight line with the real terrain and props loaded; report the worst of it. */
  async function run(x: number, z: number, yaw: number, ticks: number, jumpEvery = 0) {
    const all = allBaked();
    const [cx, cz] = cellOf(x, z);
    const y = sampleHeight(all.get(cellKey(cx, cz))!.heights, cx, cz, x, z);
    const { w, p } = await rider([...all.values()].map((c) => c.colliders), x, y + 0.1, z);
    w.tick(new Map([[0, go(yaw)]]));
    while (!w.cellReady(cx, cz) || [...all.keys()].some((k) => { const [a, b] = k.split(',').map(Number); return !w.cellReady(a, b); })) w.tick(new Map([[0, idleInput(yaw)]]));
    let deepest = 0;
    let left = false;
    let far = 0;
    let fastest = 0;
    w.tick(new Map([[0, go(yaw, BTN.sprint)]]));
    for (let i = 0; i < ticks; i++) {
      w.tick(new Map([[0, go(yaw, jumpEvery && i % jumpEvery === 0 ? BTN.jump : 0)]]));
      fastest = Math.max(fastest, p.loco!.speed);
      const [ax, az] = cellOf(p.tf.pos.x, p.tf.pos.z);
      if (!inRegion(ax, az)) {
        left = true;
        break;
      }
      const ground = sampleHeight(all.get(cellKey(ax, az))!.heights, ax, az, p.tf.pos.x, p.tf.pos.z);
      deepest = Math.max(deepest, ground - p.tf.pos.y);
      far = Math.max(far, Math.hypot(p.tf.pos.x - x, p.tf.pos.z - z));
    }
    w.dispose();
    return { deepest, left, far, fastest };
  }

  const size = manifest.size[0] * CELL_SIZE;
  const lines: [string, number, number, number][] = [
    ['the west edge', 60, 256, -Math.PI / 2],
    ['the east edge', size - 60, 256, Math.PI / 2],
    ['the south edge', 256, 60, Math.PI],
    ['the north edge', 256, size - 60, 0],
    ['the south-west corner', 60, 60, (-3 * Math.PI) / 4],
    ['the north-east corner', size - 60, size - 60, Math.PI / 4],
    ['the west border, slantwise', 40, 200, -Math.PI / 3],
    ['the east border, slantwise', size - 40, 300, (2 * Math.PI) / 3],
  ];

  it.each(lines)('galloping at %s stays on the map and on the ground', async (_name, x, z, yaw) => {
    for (const jumpEvery of [0, 20, 30, 47]) {
      const r = await run(x, z, yaw, 2400, jumpEvery);
      expect(r.left, `jumping every ${jumpEvery} ticks`).toBe(false);
      expect(r.deepest).toBeLessThan(KCC.offset + 0.25);
      expect(r.fastest).toBeGreaterThan(MOUNT.trotSpeed + 1);
    }
  }, 120_000);

  it.each(lines)('on foot, running and jumping at %s stays on the map too', async (_name, x, z, yaw) => {
    const all = allBaked();
    const [cx, cz] = cellOf(x, z);
    const y = sampleHeight(all.get(cellKey(cx, cz))!.heights, cx, cz, x, z);
    for (const jumpEvery of [0, 20, 30, 47]) {
      const { w, p } = await rider([...all.values()].map((c) => c.colliders), x, y + 0.1, z);
      const bull = w.entities.find((e) => e.mount)!;
      delete p.riding;
      bull.mount!.rider = null;
      while ([...all.keys()].some((k) => { const [a, b] = k.split(',').map(Number); return !w.cellReady(a, b); })) w.tick(new Map([[0, idleInput(yaw)]]));
      let left = false;
      for (let i = 0; i < 2400 && !left; i++) {
        w.tick(new Map([[0, go(yaw, jumpEvery && i % jumpEvery === 0 ? BTN.jump : 0)]]));
        left = !inRegion(...cellOf(p.tf.pos.x, p.tf.pos.z));
      }
      w.dispose();
      expect(left, `jumping every ${jumpEvery} ticks`).toBe(false);
    }
  }, 120_000);

  it('crosses the map through the woods without sinking into the ground', async () => {
    for (const [x, z, yaw] of [[30, 30, Math.PI / 4], [480, 40, -Math.PI / 4], [100, 470, (3 * Math.PI) / 4], [256, 20, 0]] as const) {
      const r = await run(x, z, yaw, 1800);
      expect(r.left).toBe(false);
      expect(r.deepest).toBeLessThan(KCC.offset + 0.25);
      expect(r.far).toBeGreaterThan(15);
    }
  }, 120_000);
});
