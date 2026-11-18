import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellColliders, decodeCellBin, sampleHeight } from '../../src/content/world/codec';
import { CELL_RES, CELL_SIZE, type CellData, type RegionManifest } from '../../src/content/world/format';
import { KCC } from '../../src/content/tuning';

/** The baked Sproutvale (plan §3.1, §3.5, §6.1): budgets, the prop table, and walkable ground. */
const PUBLIC = path.resolve(__dirname, '../../public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'world/sproutvale/region.json'), 'utf8')) as RegionManifest;
const [W, D] = manifest.size;
const [OX, OZ] = manifest.origin;

const cells = new Map<string, { data: CellData; heights: Float32Array; splat: Uint8Array }>();
for (const c of manifest.cells) {
  const { heights, splat } = decodeCellBin(fs.readFileSync(path.join(PUBLIC, c.bin)), manifest.heightRange);
  cells.set(`${c.cx},${c.cz}`, { data: JSON.parse(fs.readFileSync(path.join(PUBLIC, c.json), 'utf8')) as CellData, heights, splat });
}
const cell = (cx: number, cz: number) => cells.get(`${cx},${cz}`)!;
/** Region-wide sample grid at 1 m (decoded heights), index = z · (W·64 + 1) + x relative to the origin. */
const GW = W * CELL_SIZE + 1;
const grid = new Float32Array(GW * (D * CELL_SIZE + 1));
const pathW = new Uint8Array(grid.length);
for (const c of manifest.cells) {
  const { heights, splat } = cell(c.cx, c.cz);
  for (let iz = 0; iz < CELL_RES; iz++) {
    for (let ix = 0; ix < CELL_RES; ix++) {
      const g = ((c.cz - OZ) * CELL_SIZE + iz) * GW + (c.cx - OX) * CELL_SIZE + ix;
      grid[g] = heights[iz * CELL_RES + ix];
      pathW[g] = splat[(iz * CELL_RES + ix) * 4 + 3];
    }
  }
}
/** Steepest of the two triangles of the 1 m quad at (x, z), in degrees. */
const quadSlope = (x: number, z: number) => {
  const a = grid[z * GW + x], b = grid[z * GW + x + 1], c = grid[(z + 1) * GW + x], d = grid[(z + 1) * GW + x + 1];
  return (Math.atan(Math.max(Math.hypot(b - a, c - a), Math.hypot(d - c, d - b))) * 180) / Math.PI;
};
const groundAt = (x: number, z: number) => {
  const cx = Math.min(OX + W - 1, Math.floor(x / CELL_SIZE)), cz = Math.min(OZ + D - 1, Math.floor(z / CELL_SIZE));
  return sampleHeight(cell(cx, cz).heights, cx, cz, x, z);
};

describe('baked Sproutvale', () => {
  it('has all 8 × 8 cells, each ≤ 120 KB, with the byte counts the manifest claims, and the region ≤ 30 MiB', () => {
    expect(manifest.cells.length).toBe(64);
    let total = 0;
    for (const c of manifest.cells) {
      const bytes = fs.statSync(path.join(PUBLIC, c.bin)).size + fs.statSync(path.join(PUBLIC, c.json)).size;
      expect(bytes, `${c.cx},${c.cz}`).toBe(c.bytes);
      expect(bytes, `${c.cx},${c.cz}`).toBeLessThanOrEqual(120 * 1000);
      total += bytes;
    }
    for (const f of fs.readdirSync(path.join(PUBLIC, 'world/sproutvale'))) {
      const p = path.join(PUBLIC, 'world/sproutvale', f);
      if (fs.statSync(p).isFile()) total += fs.statSync(p).size;
    }
    expect(total).toBeLessThanOrEqual(30 * 1024 * 1024);
    for (let cz = OZ; cz < OZ + D; cz++) for (let cx = OX; cx < OX + W; cx++) expect(cells.has(`${cx},${cz}`), `${cx},${cz}`).toBe(true);
  });

  it('sets the fog, splat layers and horizon the plan asks for', () => {
    expect(manifest.fog).toEqual({ near: 80, far: 180, farPlane: 450 });
    expect(manifest.splatLayers).toEqual(['grass', 'dirt', 'rock', 'path']);
    expect(manifest.cellSize).toBe(CELL_SIZE);
    expect(fs.existsSync(path.join(PUBLIC, manifest.horizon))).toBe(true);
  });

  it('every prop key in the cells is in the manifest, and every prop GLB (and LOD1) exists', () => {
    for (const { data } of cells.values()) {
      for (const [key, packed] of Object.entries(data.props)) {
        expect(manifest.props[key], key).toBeDefined();
        expect(packed.length % 5, key).toBe(0);
        for (const v of packed) expect(Number.isFinite(v), key).toBe(true);
      }
    }
    for (const [key, k] of Object.entries(manifest.props)) {
      expect(fs.existsSync(path.join(PUBLIC, 'assets', k.path)), `${key} ${k.path}`).toBe(true);
      expect(k.lod1Path, key).toBeDefined();
      expect(fs.existsSync(path.join(PUBLIC, 'assets', k.lod1Path!)), `${key} ${k.lod1Path}`).toBe(true);
    }
  });

  it('every placement lies in the cell that lists it, at the ground height or below it', () => {
    for (const { data } of cells.values()) {
      for (const [key, p] of Object.entries(data.props)) {
        for (let i = 0; i < p.length; i += 5) {
          const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
          expect(Math.floor(x / CELL_SIZE), `${key} x`).toBe(data.cx);
          expect(Math.floor(z / CELL_SIZE), `${key} z`).toBe(data.cz);
          // Props sit on the lowest ground under their footprint (and the bridge spans the river).
          if (key !== 'grove_bridge') expect(y, `${key} at ${x},${z}`).toBeLessThanOrEqual(groundAt(x, z) + 0.02);
          expect(y, `${key} at ${x},${z}`).toBeGreaterThan(groundAt(x, z) - 3);
        }
      }
    }
  });

  // 7 × 7: the streamer's hysteresis ring (distance 3) keeps up to that many cells loaded.
  it('capacities cover the most instances of each prop in any 7 × 7 cell window', () => {
    const N = 7;
    for (const [key, k] of Object.entries(manifest.props)) {
      let best = 0;
      for (let z0 = OZ; z0 + N <= OZ + D; z0++) {
        for (let x0 = OX; x0 + N <= OX + W; x0++) {
          let n = 0;
          for (let cz = z0; cz < z0 + N; cz++) for (let cx = x0; cx < x0 + N; cx++) n += (cell(cx, cz).data.props[key]?.length ?? 0) / 5;
          best = Math.max(best, n);
        }
      }
      expect(best, key).toBeGreaterThan(0);
      expect(k.capacity, key).toBeGreaterThanOrEqual(best);
    }
  });

  it('heights and splat are continuous across cell edges (shared samples are equal)', () => {
    for (let cz = OZ; cz < OZ + D; cz++) {
      for (let cx = OX; cx < OX + W; cx++) {
        const a = cell(cx, cz);
        if (cx + 1 < OX + W) {
          const b = cell(cx + 1, cz);
          for (let i = 0; i < CELL_RES; i++) {
            expect(a.heights[i * CELL_RES + CELL_RES - 1], `east edge ${cx},${cz} row ${i}`).toBe(b.heights[i * CELL_RES]);
            for (let c = 0; c < 4; c++) expect(a.splat[(i * CELL_RES + CELL_RES - 1) * 4 + c]).toBe(b.splat[i * CELL_RES * 4 + c]);
          }
        }
        if (cz + 1 < OZ + D) {
          const b = cell(cx, cz + 1);
          for (let i = 0; i < CELL_RES; i++) expect(a.heights[(CELL_RES - 1) * CELL_RES + i], `north edge ${cx},${cz} col ${i}`).toBe(b.heights[i]);
        }
      }
    }
  });

  it('splat weights sum to 255 everywhere', () => {
    for (const { splat } of cells.values()) for (let i = 0; i < CELL_RES * CELL_RES; i++) expect(splat[i * 4] + splat[i * 4 + 1] + splat[i * 4 + 2] + splat[i * 4 + 3]).toBe(255);
  });

  it('paths are walkable: no 1 m quad painted as path is steeper than 45°', () => {
    let painted = 0, worst = 0;
    for (let z = 0; z < D * CELL_SIZE; z++) {
      for (let x = 0; x < W * CELL_SIZE; x++) {
        if (pathW[z * GW + x] < 128) continue;
        painted++;
        worst = Math.max(worst, quadSlope(x, z));
      }
    }
    expect(painted).toBeGreaterThan(3000);
    expect(worst).toBeLessThanOrEqual(45);
  });

  it('inside the border every slope is climbable, and the border cliff is not', () => {
    const inner = 8;
    let worstInside = 0;
    for (let z = inner; z < D * CELL_SIZE - inner; z++) for (let x = inner; x < W * CELL_SIZE - inner; x++) worstInside = Math.max(worstInside, quadSlope(x, z));
    expect(worstInside).toBeLessThanOrEqual(45);
    // Every edge column/row climbs a cliff steeper than the controller's slide angle.
    const n = W * CELL_SIZE;
    for (let i = 0; i < n; i += 4) {
      for (const [x, z] of [[2, i], [n - 3, i], [i, 2], [i, n - 3]]) expect(quadSlope(x, z), `edge ${x},${z}`).toBeGreaterThan(KCC.minSlideDeg);
    }
  });

  it('the player starts on walkable, clear ground in Sprout Hollow, facing north', () => {
    const { pos, yaw } = manifest.playerStart;
    const [cx, cz] = [Math.floor(pos[0] / CELL_SIZE), Math.floor(pos[2] / CELL_SIZE)];
    expect(cx >= 3 && cx <= 4 && cz >= 0 && cz <= 1, `start cell ${cx},${cz}`).toBe(true);
    expect(Math.abs(pos[1] - groundAt(pos[0], pos[2]))).toBeLessThan(0.05);
    for (let dz = -3; dz < 3; dz++) for (let dx = -3; dx < 3; dx++) expect(quadSlope(Math.floor(pos[0]) + dx, Math.floor(pos[2]) + dz)).toBeLessThan(10);
    expect(yaw).toBe(0);
    const start = cell(cx, cz).data.marks?.find((m) => m.kind === 'playerStart');
    expect(start?.pos).toEqual(pos);
    // No prop collider within 3 m of the start.
    for (let z = cz - 1; z <= cz + 1; z++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const c = cells.get(`${x},${z}`);
        if (!c) continue;
        for (const s of cellColliders(c.data, c.heights, manifest).shapes) {
          const reach = s.kind === 'cylinder' ? s.radius : Math.hypot(s.half[0], s.half[2]);
          expect(Math.hypot(s.pos[0] - pos[0], s.pos[2] - pos[2]) - reach, `collider at ${s.pos}`).toBeGreaterThan(3);
        }
      }
    }
  });

  it('marks the three shrines in their zones', () => {
    const marks = [...cells.values()].flatMap((c) => c.data.marks ?? []);
    const where = (id: string) => {
      const m = marks.find((k) => k.id === id);
      expect(m, id).toBeDefined();
      expect(m!.kind).toBe('shrine');
      return [Math.floor(m!.pos[0] / CELL_SIZE), Math.floor(m!.pos[2] / CELL_SIZE)];
    };
    const [a, b] = where('shrine_first_light');
    expect(a >= 3 && a <= 4 && b >= 0 && b <= 1).toBe(true);
    const [c, d] = where('shrine_watchtower');
    expect(c >= 3 && c <= 4 && d >= 3 && d <= 4).toBe(true);
    const [e, f] = where('shrine_quarry_gate');
    expect(e >= 4 && e <= 7 && f >= 5 && f <= 7).toBe(true);
  });

  it('the horizon is an 8 m grid of about 8k triangles plus landmark impostors', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(path.join(PUBLIC, manifest.horizon));
    const tris = (name: string) =>
      doc.getRoot().listNodes().filter((n) => n.getName() === name).flatMap((n) => n.getMesh()!.listPrimitives()).reduce((s, p) => s + p.getIndices()!.getCount() / 3, 0);
    expect(tris('horizon_terrain')).toBe((W * CELL_SIZE / 8) * (D * CELL_SIZE / 8) * 2);
    const landmarks = Object.entries(manifest.props).filter(([, k]) => k.landmark).length;
    expect(landmarks).toBeGreaterThanOrEqual(5);
    expect(tris('horizon_landmarks')).toBeGreaterThan(0);
  });
});
