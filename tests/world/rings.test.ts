import { describe, expect, it } from 'vitest';
import { CELL_RES } from '../../src/content/world/format';
import { buildTerrainMesh } from '../../src/world/terrainMesh';
import { RequestQueue } from '../../src/assets/RequestQueue';
import {
  GROUND_NEAR_M, RETRY_DELAYS_MS, chebyshev, groundCells, planRings, prefetchCells, withRetry, type CellLevel,
} from '../../src/world/rings';

const region8 = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < 8 && cz < 8;
const levels = (plan: ReturnType<typeof planRings>) => new Map(plan.want.map((w) => [w.key, w.level]));

describe('the ground the player needs (asset streaming plan S0)', () => {
  const keys = (l: readonly (readonly [number, number])[]) => l.map(([x, z]) => `${x},${z}`).sort();

  it('behind the veil it is the whole 3 × 3', () => {
    expect(groundCells(96, 96, false)).toHaveLength(9);
  });

  it('in the middle of a cell, playing needs only that cell', () => {
    expect(keys(groundCells(96, 96, true))).toEqual(['1,1']);
  });

  it('just past a cell edge, playing needs the cell behind and not the three far neighbours', () => {
    // Walking north across z = 128: cells 1,3 are 64 m ahead and were only just made Active.
    expect(keys(groundCells(96, 128.5, true))).toEqual(['1,1', '1,2']);
  });

  it('near a corner it takes every cell within reach', () => {
    expect(keys(groundCells(64 + 10, 128 + 10, true))).toEqual(['0,1', '0,2', '1,1', '1,2']);
  });

  it('every cell needed after crossing any edge was already in the 3 × 3 before it', () => {
    for (let x = 64; x < 128; x += 3) {
      const before = new Set(keys(groundCells(x, 127.9, false)));
      for (const k of keys(groundCells(x, 128.1, true))) expect(before.has(k), `${x}: ${k}`).toBe(true);
    }
    expect(GROUND_NEAR_M).toBeLessThan(64);
  });
});

describe('ring policy (plan §3.2)', () => {
  it('loads Active ≤ 1 and Visual ≤ 2 around the player, nothing at 3 from cold', () => {
    const plan = planRings({ players: [[4, 4]], anchors: [], current: new Map(), inRegion: region8 });
    const l = levels(plan);
    expect([...l.values()].filter((v) => v === 'active')).toHaveLength(9);
    expect([...l.values()].filter((v) => v === 'visual')).toHaveLength(16);
    expect(l.get('4,4')).toBe('active');
    expect(l.get('6,6')).toBe('visual');
    expect(l.has('7,7')).toBe(false);
    expect(plan.unload).toEqual([]);
  });

  it('puts the 3 × 3 at NOW priority first, nearest first, then the visual ring at LATER', () => {
    const plan = planRings({ players: [[4, 4]], anchors: [], current: new Map(), inRegion: region8 });
    expect(plan.want[0].key).toBe('4,4');
    const firstLater = plan.want.findIndex((w) => w.priority === 'later');
    expect(firstLater).toBe(9);
    expect(plan.want.slice(0, 9).every((w) => w.priority === 'now' && w.level === 'active')).toBe(true);
    expect(plan.want.slice(9).every((w) => w.priority === 'later' && w.dist === 2)).toBe(true);
  });

  it('clips to the region', () => {
    const plan = planRings({ players: [[0, 0]], anchors: [], current: new Map(), inRegion: region8 });
    expect(plan.want).toHaveLength(9);
    expect(plan.want.every((w) => w.cx >= 0 && w.cz >= 0)).toBe(true);
  });

  it('keeps loaded cells in the hysteresis ring (Active drops to Visual) and unloads at 4', () => {
    const current = new Map<string, CellLevel>([['1,1', 'active'], ['1,2', 'visual'], ['0,0', 'visual'], ['2,2', 'active']]);
    // Player at (5, 4): (1, 1) and (1, 2) are 4 away, (2, 2) is 3 away.
    const plan = planRings({ players: [[5, 4]], anchors: [], current, inRegion: region8 });
    const l = levels(plan);
    expect(l.get('2,2')).toBe('visual');
    expect(plan.unload.sort()).toEqual(['0,0', '1,1', '1,2']);
  });

  it('a cell at distance 3 that is not loaded is not loaded', () => {
    const plan = planRings({ players: [[4, 4]], anchors: [], current: new Map(), inRegion: region8 });
    expect(levels(plan).has('1,4')).toBe(false);
  });

  it('an Active cell that drops to ring 2 stays Active (no collider churn on a cell edge)', () => {
    const current = new Map<string, CellLevel>([['3,4', 'active']]);
    const plan = planRings({ players: [[5, 4]], anchors: [], current, inRegion: region8 });
    expect(levels(plan).get('3,4')).toBe('active');
    // ...and goes back to Visual one ring further out.
    const plan2 = planRings({ players: [[6, 4]], anchors: [], current, inRegion: region8 });
    expect(levels(plan2).get('3,4')).toBe('visual');
  });

  it('never unloads or demotes a sim anchor, and loads one that is missing at NOW', () => {
    const current = new Map<string, CellLevel>([['0,0', 'active']]);
    const plan = planRings({ players: [[6, 6]], anchors: [[0, 0], [2, 7]], current, inRegion: region8 });
    expect(plan.unload).not.toContain('0,0');
    const a = plan.want.find((w) => w.key === '0,0')!;
    expect(a.level).toBe('active');
    expect(a.priority).toBe('now');
    expect(a.anchored).toBe(true);
    const b = plan.want.find((w) => w.key === '2,7')!;
    expect(b.level).toBe('active');
  });

  it('with no player, only anchors are kept', () => {
    const plan = planRings({ players: [], anchors: [[3, 3]], current: new Map([['5,5', 'visual']]), inRegion: region8 });
    expect(plan.want.map((w) => w.key)).toEqual(['3,3']);
    expect(plan.unload).toEqual(['5,5']);
  });

  it('is stable: replanning with its own result changes nothing', () => {
    const p1 = planRings({ players: [[3, 3]], anchors: [], current: new Map(), inRegion: region8 });
    const p2 = planRings({ players: [[3, 3]], anchors: [], current: levels(p1), inRegion: region8 });
    expect(levels(p2)).toEqual(levels(p1));
    expect(p2.unload).toEqual([]);
  });

  it('chebyshev distance', () => {
    expect(chebyshev([0, 0], [3, -2])).toBe(3);
    expect(chebyshev([1, 1], [1, 1])).toBe(0);
  });
});

describe('prefetch (velocity × 4 s)', () => {
  it('fetches the visual ring around where the player is heading, skipping what is loaded', () => {
    const skip = new Set<string>();
    for (let z = 2; z <= 6; z++) for (let x = 2; x <= 6; x++) skip.add(`${x},${z}`);
    // At the middle of cell (4, 4), running east at 8 m/s: 32 m ahead is still cell (4, 4)... so
    // sprint faster to reach the next cell: 16 m/s → 64 m → cell (5, 4).
    const cells = prefetchCells({ x: 4 * 64 + 32, z: 4 * 64 + 32 }, { x: 16, z: 0 }, 64, region8, skip);
    const keys = new Set(cells.map(([x, z]) => `${x},${z}`));
    expect(keys.has('7,4')).toBe(true);
    expect(keys.has('7,2')).toBe(true);
    expect([...keys].every((k) => !skip.has(k))).toBe(true);
    expect(cells.every(([x, z]) => region8(x, z))).toBe(true);
  });

  it('standing still prefetches nothing', () => {
    expect(prefetchCells({ x: 100, z: 100 }, { x: 0.1, z: 0 }, 64, region8, new Set())).toEqual([]);
  });
});

describe('cell fetch retries (plan §2.9)', () => {
  it('retries 3 times with 0.5, 1 and 2 s backoff, then gives up', async () => {
    const waits: number[] = [];
    let tries = 0;
    await expect(
      withRetry(
        () => {
          tries++;
          return Promise.reject(new Error('503'));
        },
        async (ms) => {
          waits.push(ms);
        },
      ),
    ).rejects.toThrow('503');
    expect(tries).toBe(4);
    expect(waits).toEqual([...RETRY_DELAYS_MS]);
    expect(waits).toEqual([500, 1000, 2000]);
  });

  it('succeeds on a later try', async () => {
    let tries = 0;
    const v = await withRetry(() => (++tries < 3 ? Promise.reject(new Error('x')) : Promise.resolve(42)), async () => {});
    expect(v).toBe(42);
    expect(tries).toBe(3);
  });

  it('stops retrying once the cell is no longer wanted', async () => {
    let tries = 0;
    let alive = true;
    await expect(
      withRetry(
        () => {
          tries++;
          return Promise.reject(new Error('x'));
        },
        async () => {
          alive = false;
        },
        () => alive,
      ),
    ).rejects.toThrow();
    expect(tries).toBe(1);
  });
});

describe('request queue (NOW/LATER, 4 in flight)', () => {
  it('runs at most 4 at once and NOW before LATER', async () => {
    const q = new RequestQueue(4);
    const started: string[] = [];
    const gates: (() => void)[] = [];
    const job = (name: string) => () =>
      new Promise<string>((res) => {
        started.push(name);
        gates.push(() => res(name));
      });
    const tickets = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].map((n) => q.run(job(n), 'later'));
    const now = q.run(job('n1'), 'now');
    expect(q.active).toBe(4);
    expect(q.queued).toBe(3);
    expect(started).toEqual(['l1', 'l2', 'l3', 'l4']);
    gates.shift()!();
    await tickets[0].promise;
    await Promise.resolve();
    expect(started[4]).toBe('n1');
    // Promote a waiting LATER job and cancel another.
    tickets[5].promote();
    tickets[4].cancel();
    await expect(tickets[4].promise).rejects.toThrow('cancelled');
    gates.shift()!();
    await tickets[1].promise;
    await Promise.resolve();
    expect(started[5]).toBe('l6');
    for (const g of gates.splice(0)) g();
    await now.promise;
  });
});

describe('terrain mesh (terrain.worker.ts)', () => {
  const heights = new Float32Array(CELL_RES * CELL_RES).map((_, i) => (i % CELL_RES) * 0.5);
  const splat = new Uint8Array(CELL_RES * CELL_RES * 4).fill(64);

  it('builds 64 × 64 quads plus a skirt, with world UVs', () => {
    const m = buildTerrainMesh(heights, splat, 2, 3, 64);
    expect(m.position.length / 3).toBe(65 * 65 + 4 * 64);
    expect(m.index.length / 3).toBe(64 * 64 * 2 + 4 * 64 * 2);
    expect(m.uv[0]).toBe(128);
    expect(m.uv[1]).toBe(192);
    expect(m.maxY).toBeCloseTo(32);
  });

  it('builds 32 × 32 quads from every other sample', () => {
    const m = buildTerrainMesh(heights, splat, 0, 0, 32);
    expect(m.position.length / 3).toBe(33 * 33 + 4 * 32);
    // Vertex 1 sits at x = 2 m and samples height column 2.
    expect(m.position[3]).toBe(2);
    expect(m.position[4]).toBeCloseTo(1);
  });

  it('every triangle faces up or out (skirts face away from the cell)', () => {
    const m = buildTerrainMesh(heights, splat, 0, 0, 32);
    const p = (i: number) => [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
    let bad = 0;
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, b, c] = [p(m.index[t]), p(m.index[t + 1]), p(m.index[t + 2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const centre = [(a[0] + b[0] + c[0]) / 3 - 32, (a[2] + b[2] + c[2]) / 3 - 32];
      // Up-facing, or (skirts) pointing away from the cell centre.
      if (!(n[1] > 0 || n[0] * centre[0] + n[2] * centre[1] > 0)) bad++;
    }
    expect(bad).toBe(0);
  });

  it('normals tilt against the slope', () => {
    const m = buildTerrainMesh(heights, splat, 0, 0, 64);
    // Heights rise along +x at 0.5 m/m, so normals lean toward −x.
    expect(m.normal[100 * 3]).toBeLessThan(0);
    expect(m.normal[100 * 3 + 1]).toBeGreaterThan(0.8);
  });
});
