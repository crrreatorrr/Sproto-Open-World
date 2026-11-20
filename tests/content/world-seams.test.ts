import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCellBin } from '../../src/content/world/codec';
import { CELL_RES, type RegionManifest } from '../../src/content/world/format';
import { REGIONS } from '../../src/content/world/regions';
import { mergeWorld } from '../../src/world/RegionManifest';

/**
 * The overworld is one walkable world (world-src/overworld.json): where two regions' cells touch,
 * the shared edge has the same heights on both sides, so there is no step or crack, and an open
 * seam is not a cliff. Every region's rectangle matches the registry.
 */
const PUBLIC = path.resolve(__dirname, '../../public');
const manifests = new Map<string, RegionManifest>();
for (const r of REGIONS) manifests.set(r.id, JSON.parse(fs.readFileSync(path.join(PUBLIC, r.manifest), 'utf8')) as RegionManifest);
const overworld = REGIONS.filter((r) => r.overworld);

const owner = new Map<string, { region: string; bin: string }>();
for (const r of overworld) for (const c of manifests.get(r.id)!.cells) owner.set(`${c.cx},${c.cz}`, { region: r.id, bin: c.bin });
const heightCache = new Map<string, Float32Array>();
function heights(cx: number, cz: number): Float32Array {
  const key = `${cx},${cz}`;
  let h = heightCache.get(key);
  if (!h) {
    const o = owner.get(key)!;
    h = decodeCellBin(fs.readFileSync(path.join(PUBLIC, o.bin)), manifests.get(o.region)!.heightRange).heights;
    heightCache.set(key, h);
  }
  return h;
}

describe('overworld seams', () => {
  it('every region matches its registry rectangle and shares one height range', () => {
    for (const r of REGIONS) {
      const m = manifests.get(r.id)!;
      expect(m.origin, r.id).toEqual([...r.origin]);
      expect(m.size, r.id).toEqual([...r.size]);
      expect(m.heightRange, r.id).toEqual(manifests.get('sproutvale')!.heightRange);
    }
    expect(() => mergeWorld([...manifests.values()], REGIONS.map((r) => r.overworld))).not.toThrow();
  });

  it('cells of neighbouring regions meet with identical edge heights', () => {
    let seams = 0, worst = 0;
    for (const [key, o] of owner) {
      const [cx, cz] = key.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const n = owner.get(`${cx + dx},${cz + dz}`);
        if (!n || n.region === o.region) continue;
        seams++;
        const a = heights(cx, cz), b = heights(cx + dx, cz + dz);
        for (let i = 0; i < CELL_RES; i++) {
          // East neighbour: a's column 64 against b's column 0. North neighbour: a's row 64 against b's row 0.
          const ha = dx ? a[i * CELL_RES + CELL_RES - 1] : a[(CELL_RES - 1) * CELL_RES + i];
          const hb = dx ? b[i * CELL_RES] : b[i];
          worst = Math.max(worst, Math.abs(ha - hb));
        }
      }
    }
    expect(seams).toBeGreaterThan(60);
    expect(worst).toBeLessThan(0.01);
  });

  it('an open seam is walkable ground, not a cliff', () => {
    // Sproutvale's east edge at z 100 (open) against its north-east corner (closed: the quarry keeps its cliff).
    const slope = (cx: number, cz: number, ix: number, iz: number) => {
      const h = heights(cx, cz);
      return Math.abs(h[iz * CELL_RES + ix] - h[iz * CELL_RES + ix - 4]) / 4;
    };
    expect(slope(7, 1, 64, 36)).toBeLessThan(0.7);
    expect(slope(7, 7, 64, 32)).toBeGreaterThan(1);
  });
});
