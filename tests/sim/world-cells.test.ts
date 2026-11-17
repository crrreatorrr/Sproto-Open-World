import { describe, expect, it } from 'vitest';
import { sampleHeight } from '../../src/content/world/codec';
import { CELL_RES, CELL_SIZE, cellKey, type CellColliders, type ColliderShape } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { CELL_COLLIDERS_PER_TICK, SimWorld } from '../../src/sim/SimWorld';

/** Streamed cells in the sim (plan §3.2, M2 acceptance 5 and 6). */

type HeightFn = (x: number, z: number) => number;

function cell(cx: number, cz: number, h: HeightFn, shapes: ColliderShape[] = []): CellColliders {
  const heights = new Float32Array(CELL_RES * CELL_RES);
  for (let iz = 0; iz < CELL_RES; iz++) for (let ix = 0; ix < CELL_RES; ix++) heights[iz * CELL_RES + ix] = h(cx * CELL_SIZE + ix, cz * CELL_SIZE + iz);
  return { cx, cz, heights, shapes };
}

/** A gentle slope rising toward +X and a little toward +Z: never flat, never steeper than ~17°. */
const slope: HeightFn = (x, z) => 0.25 * x + 0.1 * z;

async function world(start: [number, number, number], yaw = 0): Promise<SimWorld> {
  await initPhysics();
  return new SimWorld(worldLevel({ id: 'test', playerStart: { pos: start, yaw } }), 1);
}

function loadAll(w: SimWorld, h: HeightFn, cells: [number, number][]): void {
  for (const [cx, cz] of cells) w.loadCell(cell(cx, cz, h));
}

function ticks(w: SimWorld, n: number, input: (i: number) => InputCommand = () => idleInput(0)): void {
  for (let i = 0; i < n; i++) w.tick(new Map([[0, input(i)]]));
}

const grid = (x0: number, x1: number, z0: number, z1: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push([x, z]);
  return out;
};

describe('streamed cells in the sim', () => {
  it('the heightfield matches the grid (orientation and scale): rays land on sampleHeight', async () => {
    const w = await world([10, 20, 10]);
    const c = cell(0, 0, slope);
    w.loadCell(c);
    ticks(w, 1);
    for (const [x, z] of [[10, 30], [30, 10], [50, 5], [5, 50], [63.5, 63.5]] as const) {
      const hit = w.physics.raycast({ x, y: 100, z }, { x: 0, y: -1, z: 0 }, 200)!;
      expect(hit, `${x},${z}`).not.toBeNull();
      expect(100 - hit.distance, `${x},${z}`).toBeCloseTo(sampleHeight(c.heights, 0, 0, x, z), 2);
    }
    w.dispose();
  });

  it('a player held over an unloaded cell neither moves nor falls; once its cell is built it lands on the terrain', async () => {
    const w = await world([32, 12, 32]);
    w.spawnPlayer(0);
    const p = w.playerEntity(0)!;
    ticks(w, 30, () => ({ ...idleInput(0), move: { x: 0, y: 1 } }));
    expect(w.view().waitingForGround).toBe(true);
    expect(p.tf.pos).toEqual({ x: 32, y: 12, z: 32 });
    loadAll(w, slope, grid(0, 1, 0, 1));
    ticks(w, 90);
    expect(w.view().waitingForGround).toBe(false);
    expect(p.loco!.grounded).toBe(true);
    expect(Math.abs(p.tf.pos.y - slope(p.tf.pos.x, p.tf.pos.z))).toBeLessThan(0.05);
    w.dispose();
  });

  it(`builds at most ${CELL_COLLIDERS_PER_TICK} colliders a tick, the player's own cells first`, async () => {
    const w = await world([32, 0, 32]);
    w.spawnPlayer(0);
    const trees: ColliderShape[] = Array.from({ length: 300 }, (_, i) => ({ kind: 'cylinder', pos: [200 + (i % 20) * 3, 2, 10 + Math.floor(i / 20) * 3], radius: 0.4, height: 4 }));
    w.loadCell(cell(3, 0, () => 0, trees)); // far away, queued first, heavy
    w.loadCell(cell(0, 0, () => 0)); // the player's own cell, queued second
    ticks(w, 1);
    expect(w.cellReady(0, 0)).toBe(true); // jumped the queue
    expect(w.cellReady(3, 0)).toBe(false);
    // Tick 1 built the near cell (1 collider) and 95 of the far cell's 301 (body + 300 trees);
    // 96 a tick after that finishes it on tick 4, not before.
    const total = 1 + 1 + 300;
    const lastTick = Math.ceil(total / CELL_COLLIDERS_PER_TICK);
    ticks(w, lastTick - 2);
    expect(w.cellReady(3, 0)).toBe(false);
    ticks(w, 1);
    expect(w.cellReady(3, 0)).toBe(true);
    w.dispose();
  });

  it('walks across cell edges (in X and Z) without dropping through, staying on the slope', async () => {
    const w = await world([60, 0, 60]);
    w.spawnPlayer(0);
    loadAll(w, slope, grid(0, 2, 0, 2));
    ticks(w, 5);
    const p = w.playerEntity(0)!;
    p.tf.pos.y = slope(60, 60);
    w.physics.teleport(p.id, p.tf.pos);
    let worst = 0;
    // Diagonally across the corner where four cells meet, then on.
    ticks(w, 240, () => ({ ...idleInput(Math.PI / 4), move: { x: 0, y: 1 } }));
    for (let i = 0; i < 120; i++) {
      w.tick(new Map([[0, { ...idleInput(Math.PI / 4), move: { x: 0, y: 1 } }]]));
      worst = Math.max(worst, Math.abs(p.tf.pos.y - slope(p.tf.pos.x, p.tf.pos.z)));
    }
    expect(p.tf.pos.x).toBeGreaterThan(70);
    expect(p.tf.pos.z).toBeGreaterThan(70);
    expect(worst).toBeLessThan(0.1);
    expect(p.loco!.grounded).toBe(true);
    w.dispose();
  });

  it("refuses to unload a player's 3 × 3", async () => {
    const w = await world([100, 0, 100]);
    w.spawnPlayer(0);
    loadAll(w, slope, grid(0, 3, 0, 3));
    ticks(w, 3);
    expect(w.cellAnchors()).toHaveLength(9);
    expect(w.unloadCell(1, 1)).toBe(false); // the player's own cell (100, 100) → (1, 1)
    expect(w.unloadCell(0, 0)).toBe(false);
    expect(w.unloadCell(3, 3)).toBe(true);
    expect(w.cellReady(3, 3)).toBe(false);
    w.dispose();
  });

  it('M2 acceptance 5: combat works on a slope (a light lands on a dummy uphill)', async () => {
    const w = await world([40, 0, 40]);
    w.spawnPlayer(0);
    loadAll(w, slope, grid(0, 1, 0, 1));
    ticks(w, 3);
    const p = w.playerEntity(0)!;
    p.tf.pos.y = slope(40, 40);
    w.physics.teleport(p.id, p.tf.pos);
    const d = w.spawnEnemy('dummy_passive', { x: 40, y: slope(40, 42.2), z: 42.2 }, Math.PI);
    ticks(w, 20);
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      const c = idleInput(0);
      if (i === 0) c.pressed = c.held = BTN.light;
      w.tick(new Map([[0, c]]));
      hits += w.events.filter((e) => e.type === 'hit' && e.target === d.id).length;
    }
    expect(hits).toBe(1);
    w.dispose();
  });

  it('M2 acceptance 6: a Brute leashing home across a cell edge never falls through, and its cell stays anchored', async () => {
    const w = await world([60, 0, 20]);
    w.spawnPlayer(0);
    loadAll(w, slope, grid(0, 2, 0, 1));
    ticks(w, 5);
    const p = w.playerEntity(0)!;
    const b = w.spawnEnemy('brute', { x: 40, y: slope(40, 20), z: 20 }, Math.PI / 2);
    // Lure it east over the x = 64 edge, then sprint away past its leash so it walks home west.
    let minGap = Infinity;
    let anchoredWhileBusy = true;
    for (let i = 0; i < 60 * 30; i++) {
      const c: InputCommand = idleInput(Math.PI / 2);
      if (i > 120) {
        c.move = { x: 0, y: 1 };
        c.held = BTN.sprint;
      }
      w.tick(new Map([[0, c]]));
      // Keep the player alive and on loaded ground (the test is about the Brute).
      p.vitals!.hp = p.vitals!.hpMax;
      if (p.tf.pos.x > 180) {
        p.tf.pos = { x: 180, y: slope(180, 20), z: 20 };
        w.physics.teleport(p.id, p.tf.pos);
      }
      minGap = Math.min(minGap, b.tf.pos.y - slope(b.tf.pos.x, b.tf.pos.z));
      if (b.brain!.state === 'leash') {
        const [cx, cz] = [Math.floor(b.tf.pos.x / 64), Math.floor(b.tf.pos.z / 64)];
        anchoredWhileBusy &&= w.cellAnchors().some(([x, z]) => x === cx && z === cz);
      }
    }
    expect(b.brain!.state).toBe('idle');
    expect(Math.hypot(b.tf.pos.x - 40, b.tf.pos.z - 20)).toBeLessThan(1.5);
    expect(minGap).toBeGreaterThan(-0.1);
    expect(anchoredWhileBusy).toBe(true);
    expect(cellKey(Math.floor(b.tf.pos.x / 64), 0)).toBe('0,0');
    w.dispose();
  });

  it('a level with a ground plane (the yard) needs no cells', async () => {
    const { makeWorld } = await import('./helpers');
    const w = await makeWorld();
    expect(w.streamed).toBe(false);
    expect(w.cellReady(5, 5)).toBe(true);
    expect(w.cellAnchors()).toEqual([]);
    expect(w.view().waitingForGround).toBe(false);
    w.dispose();
  });
});

describe('teleportPlayer', () => {
  it('moves the player, clears momentum and pushback, and the controller follows', async () => {
    const w = await world([40, 0, 40]);
    w.spawnPlayer(0);
    loadAll(w, slope, grid(0, 2, 0, 2));
    ticks(w, 5);
    const p = w.playerEntity(0)!;
    p.tf.vel = { x: 5, y: 0, z: 5 };
    p.combat!.push = { x: 1, z: 1, ticks: 6 };
    w.teleportPlayer(0, { x: 100, y: slope(100, 100) + 0.05, z: 100 });
    expect(p.tf.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.combat!.push).toBeNull();
    ticks(w, 20);
    expect(Math.hypot(p.tf.pos.x - 100, p.tf.pos.z - 100)).toBeLessThan(0.05);
    expect(Math.abs(p.tf.pos.y - slope(100, 100))).toBeLessThan(0.05);
    w.dispose();
  });
});
