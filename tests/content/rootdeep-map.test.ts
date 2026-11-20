import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCellBin } from '../../src/content/world/codec';
import { CELL_RES, CELL_SIZE, type RegionManifest } from '../../src/content/world/format';
import { KCC } from '../../src/content/tuning';

/**
 * The baked Rootdeep (plan Quest 1). Local metres: world x = local x + 4096, world z = local z.
 * Height ≤ 0.6 is floor. Flood fill starts at the h1 hall, local (96, 96).
 */
const PUBLIC = path.resolve(__dirname, '../../public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'world/rootdeep/region.json'), 'utf8')) as RegionManifest;
const [W, D] = manifest.size;
const [OX, OZ] = manifest.origin;

/** Local (x, z) of each chamber centre. Flat radii are in the plan; centres are what the flood must reach. */
const CHAMBERS: { id: string; x: number; z: number }[] = [
  { id: 'h1', x: 96, z: 96 },
  { id: 'h2', x: 256, z: 56 },
  { id: 'h3', x: 416, z: 96 },
  { id: 'h4', x: 456, z: 256 },
  { id: 'h5', x: 416, z: 416 },
  { id: 'h6', x: 256, z: 456 },
  { id: 'h7', x: 96, z: 416 },
  { id: 'h8', x: 56, z: 256 },
  { id: 'm1', x: 168, z: 168 },
  { id: 'm2', x: 256, z: 148 },
  { id: 'm3', x: 344, z: 168 },
  { id: 'm4', x: 364, z: 256 },
  { id: 'm5', x: 344, z: 344 },
  { id: 'm6', x: 256, z: 364 },
  { id: 'm7', x: 168, z: 344 },
  { id: 'm8', x: 148, z: 256 },
  { id: 'p1', x: 36, z: 36 },
  { id: 'p2', x: 476, z: 36 },
  { id: 'p3', x: 476, z: 476 },
  { id: 'p4', x: 36, z: 476 },
  { id: 'vault', x: 256, z: 256 },
];

const GW = W * CELL_SIZE + 1;
const GH = D * CELL_SIZE + 1;
const grid = new Float32Array(GW * GH);
const grass = new Uint8Array(GW * GH);
for (const c of manifest.cells) {
  const { heights, splat } = decodeCellBin(fs.readFileSync(path.join(PUBLIC, c.bin)), manifest.heightRange);
  for (let iz = 0; iz < CELL_RES; iz++) {
    for (let ix = 0; ix < CELL_RES; ix++) {
      const x = (c.cx - OX) * CELL_SIZE + ix;
      const z = (c.cz - OZ) * CELL_SIZE + iz;
      const g = z * GW + x;
      grid[g] = heights[iz * CELL_RES + ix];
      grass[g] = splat[(iz * CELL_RES + ix) * 4];
    }
  }
}

/** Floor, including a little slack for the Uint16 round trip. */
const FLOOR = 0.6;
const isFloor = (x: number, z: number) => x >= 0 && z >= 0 && x < GW && z < GH && grid[z * GW + x] <= FLOOR;

/**
 * The vault gate plugs the tunnel at local z 205. The carved bed is 7 m wide, so a few metres
 * either side of x = 256 closes it without cutting the outer ring, which crosses the same z far east.
 */
const GATE_REACH = 8;

type FloodOpts = { blockZ?: [number, number]; nearX?: number };

function blocked(x: number, z: number, opts: FloodOpts): boolean {
  if (!opts.blockZ || opts.nearX === undefined) return false;
  const [z0, z1] = opts.blockZ;
  return z >= z0 && z <= z1 && Math.abs(x - opts.nearX) <= GATE_REACH;
}

/** 8-connected: diagonal tunnels leave a centre line that only touches at corners once eroded. */
const NEIGHBOURS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function flood(opts: FloodOpts = {}): Set<string> {
  const seen = new Uint8Array(GW * GH);
  const q: number[] = [];
  const push = (x: number, z: number) => {
    if (!isFloor(x, z) || blocked(x, z, opts)) return;
    const i = z * GW + x;
    if (seen[i]) return;
    seen[i] = 1;
    q.push(i);
  };
  push(96, 96);
  for (let i = 0; i < q.length; i++) {
    const idx = q[i];
    const x = idx % GW;
    const z = (idx / GW) | 0;
    for (const [dx, dz] of NEIGHBOURS) push(x + dx, z + dz);
  }
  const reached = new Set<string>();
  for (const c of CHAMBERS) if (seen[c.z * GW + c.x]) reached.add(c.id);
  return reached;
}

const open = flood();
const reached = (c: { id: string }) => open.has(c.id);

/** Cells where a disc of `radius` metres stays on the floor, then flood-filled. */
function floodEroded(radius: number): Set<string> {
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  const eroded = new Uint8Array(GW * GH);
  for (let z = 0; z < GH; z++) {
    for (let x = 0; x < GW; x++) {
      if (!isFloor(x, z)) continue;
      let ok = true;
      for (let dz = -r; dz <= r && ok; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r2) continue;
          if (!isFloor(x + dx, z + dz)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) eroded[z * GW + x] = 1;
    }
  }
  const seen = new Uint8Array(GW * GH);
  const q: number[] = [];
  const push = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= GW || z >= GH) return;
    const i = z * GW + x;
    if (seen[i] || !eroded[i]) return;
    seen[i] = 1;
    q.push(i);
  };
  push(96, 96);
  for (let i = 0; i < q.length; i++) {
    const idx = q[i];
    const x = idx % GW;
    const z = (idx / GW) | 0;
    for (const [dx, dz] of NEIGHBOURS) push(x + dx, z + dz);
  }
  const ids = new Set<string>();
  for (const c of CHAMBERS) if (seen[c.z * GW + c.x]) ids.add(c.id);
  return ids;
}

/** Steepest of the two triangles of the 1 m quad at local (x, z), in degrees. */
const quadSlope = (x: number, z: number) => {
  const a = grid[z * GW + x], b = grid[z * GW + x + 1], c = grid[(z + 1) * GW + x], d = grid[(z + 1) * GW + x + 1];
  return (Math.atan(Math.max(Math.hypot(b - a, c - a), Math.hypot(d - c, d - b))) * 180) / Math.PI;
};

/**
 * Quads on the wall face gentler than `deg`. The face is the band above the floor and below the
 * rock top (y 16). Smoothstep puts a shallow shoulder on the floor and on the roof; those are not
 * the face, and the face between them is what the player would have to climb.
 */
const ROCK_TOP = 16;
function wallSamplesGentlerThan(deg: number): number {
  let n = 0;
  for (let z = 0; z < D * CELL_SIZE; z++) {
    for (let x = 0; x < W * CELL_SIZE; x++) {
      const a = grid[z * GW + x], b = grid[z * GW + x + 1], c = grid[(z + 1) * GW + x], d = grid[(z + 1) * GW + x + 1];
      const mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
      if (mn <= FLOOR || mx >= ROCK_TOP) continue;
      if (quadSlope(x, z) < deg) n++;
    }
  }
  return n;
}

function grassWeightOnAnyFloorSample(): number {
  let max = 0;
  for (let z = 0; z < GH; z++) {
    for (let x = 0; x < GW; x++) {
      if (grid[z * GW + x] <= FLOOR) max = Math.max(max, grass[z * GW + x]);
    }
  }
  return max;
}

describe('baked Rootdeep', () => {
  it('has 64 cells at origin [64, 0] and shares Sproutvale\'s height range', () => {
    expect(manifest.cells.length).toBe(64);
    expect(manifest.origin).toEqual([64, 0]);
    expect(manifest.heightRange).toEqual({ min: -16, max: 240 });
  });

  it('connects all 21 chambers', () => {
    for (const c of CHAMBERS) expect(reached(c), c.id).toBe(true);
  });

  it('seals only the vault when the gate at local z 205 is shut', () => {
    const shut = (id: string) => flood({ blockZ: [204, 206], nearX: 256 }).has(id);
    expect(CHAMBERS.filter((c) => !shut(c.id)).map((c) => c.id)).toEqual(['vault']);
  });

  it('lets a 3 m-radius body through every passage', () => {
    expect(floodEroded(3).size).toBe(21);
  });

  it('has no wall the player can climb', () => {
    expect(wallSamplesGentlerThan(KCC.maxSlopeDeg)).toBe(0);
  });

  it('grows no grass', () => {
    expect(grassWeightOnAnyFloorSample()).toBe(0);
  });
});
