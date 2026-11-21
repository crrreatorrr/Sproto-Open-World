import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE_M, NEAR_SHADOW_M, RING_ACTIVE, coverageM, planRings, prefetchSeconds, propClass, propRanges, propTiers, terrainRes, viewRings,
  type CellLevel,
} from '../../src/world/rings';

describe('a draw distance for each prop kind, by its size (San Andreas: one per model)', () => {
  it('sorts props into classes by how big they are', () => {
    expect(propClass({ size: [1.6, 0.7] })).toBe('clutter'); // a fern
    expect(propClass({ size: [4.3, 0.8] })).toBe('small'); // a crop row
    expect(propClass({ size: [8, 0.1] })).toBe('medium'); // a patch of cobbles
    expect(propClass({ size: [6.3, 16.4] })).toBe('large'); // a pine
    expect(propClass({ size: [9.7, 13.8] })).toBe('large'); // a house
    expect(propClass({ size: [8.5, 31.4], landmark: true })).toBe('landmark');
    // A kind baked before sizes were written draws like a mid-sized prop.
    expect(propClass({})).toBe('medium');
  });

  it('small things stop early and big things reach further', () => {
    const cover = coverageM(4);
    const r = (size: [number, number], landmark = false) => propRanges({ size, landmark }, 1, cover);
    expect(r([1.6, 0.7]).far).toBeLessThan(r([4.3, 0.8]).far);
    expect(r([4.3, 0.8]).far).toBeLessThan(r([8, 0.1]).far);
    expect(r([8, 0.1]).far).toBeLessThan(r([6.3, 16.4]).far);
    expect(r([6.3, 16.4]).far).toBeLessThanOrEqual(r([8.5, 31.4], true).far);
    for (const size of [[1.6, 0.7], [4.3, 0.8], [8, 0.1], [6.3, 16.4]] as [number, number][]) {
      const x = r(size);
      expect(x.hd).toBeLessThan(x.far);
      expect(x.band).toBeGreaterThan(0);
      expect(x.edge).toBeGreaterThan(0);
      expect(x.far - x.edge).toBeGreaterThan(x.hd);
      expect(x.hd - x.band).toBeGreaterThan(0);
    }
  });

  it('nothing is ever drawn past the ground that is loaded, so nothing can pop in', () => {
    for (const rings of [2, 3, 4, 5]) {
      const cover = coverageM(rings);
      for (const scale of [0.8, 1, 1.2, 2]) {
        for (const kind of [{ size: [1.6, 0.7] }, { size: [6.3, 16.4] }, { size: [8.5, 31.4], landmark: true }] as const) {
          expect(propRanges(kind, scale, cover).far, `rings ${rings}, scale ${scale}`).toBeLessThanOrEqual(cover);
        }
      }
    }
    // The loaded square reaches `rings` cells from the player's cell: its nearest edge is that far
    // away when the player stands at their cell's edge. The camera trails them by a few metres.
    expect(coverageM(2)).toBeLessThan(2 * CELL_SIZE_M);
    expect(coverageM(2)).toBeGreaterThan(2 * CELL_SIZE_M - 16);
  });

  it('only things tall enough to matter cast a shadow', () => {
    expect(propRanges({ size: [1.6, 0.7] }, 1, 300).casts).toBe(false); // fern
    expect(propRanges({ size: [4.3, 0.8] }, 1, 300).casts).toBe(false); // crops
    expect(propRanges({ size: [2.1, 2] }, 1, 300).casts).toBe(true); // hedge
    expect(propRanges({ size: [9.7, 13.8] }, 1, 300).casts).toBe(true); // house
  });
});

describe('which level of detail a cell feeds, from its distance to the camera', () => {
  const r = { hd: 80, far: 240, band: 20, edge: 20, casts: true };

  it('a cell close by feeds the detailed model only', () => {
    expect(propTiers(0, 50, r)).toEqual({ near: true, hd: true, far: false });
  });

  it('a cell across the swap distance feeds both, and the shader picks per prop', () => {
    expect(propTiers(40, 130, r)).toEqual({ near: true, hd: true, far: true });
  });

  it('a far cell feeds the simple model only, and a cell past the far distance nothing', () => {
    expect(propTiers(100, 190, r)).toEqual({ near: false, hd: false, far: true });
    expect(propTiers(241, 330, r)).toEqual({ near: false, hd: false, far: false });
  });

  it('only cells within shadow reach feed the shadow-casting set, and only for kinds that cast', () => {
    expect(propTiers(NEAR_SHADOW_M + 1, 120, r).near).toBe(false);
    expect(propTiers(0, 50, { ...r, casts: false }).near).toBe(false);
  });

  it('high above the ground, everything is the simple model (San Andreas: only LODs from the air)', () => {
    expect(propTiers(0, 50, r, true)).toEqual({ near: false, hd: false, far: true });
  });
});

describe('how far the world loads, by graphics quality', () => {
  it('reaches further on higher quality', () => {
    expect(viewRings('low')).toBe(2);
    expect(viewRings('medium')).toBeGreaterThan(viewRings('low'));
    expect(viewRings('high')).toBeGreaterThan(viewRings('medium'));
  });

  it('far cells get coarser ground', () => {
    expect(terrainRes('active', 0)).toBe(64);
    expect(terrainRes('active', 1)).toBe(64);
    expect(terrainRes('visual', 2)).toBe(32);
    expect(terrainRes('visual', 3)).toBe(16);
    expect(terrainRes('visual', 5)).toBe(16);
  });

  const plan = (rings: number, current = new Map<string, CellLevel>(), view?: { x: number; z: number; dx: number; dz: number }) =>
    planRings({ players: [[10, 10]], anchors: [], current, inRegion: () => true, rings, view });

  it('loads a square of cells out to the view rings; colliders stay in the 3 × 3', () => {
    const p = plan(4);
    expect(p.want.length).toBe(81);
    expect(p.want.filter((w) => w.level === 'active').length).toBe((2 * RING_ACTIVE + 1) ** 2);
    expect(p.want.filter((w) => w.priority === 'now').length).toBe(9);
    expect(Math.max(...p.want.map((w) => w.dist))).toBe(4);
  });

  it('keeps one more ring than it loads, so walking along an edge does not thrash', () => {
    const current = new Map<string, CellLevel>([['15,10', 'visual'], ['16,10', 'visual']]);
    const p = plan(4, current);
    expect(p.want.some((w) => w.key === '15,10')).toBe(true);
    expect(p.unload).toEqual(['16,10']);
  });

  it('asks for what is in front of the camera before what is behind it', () => {
    // Looking east (+x) from the middle of cell 10,10.
    const p = plan(4, new Map(), { x: 10.5 * CELL_SIZE_M, z: 10.5 * CELL_SIZE_M, dx: 1, dz: 0 });
    const later = p.want.filter((w) => w.priority === 'later');
    const at = (key: string) => later.findIndex((w) => w.key === key);
    expect(at('13,10')).toBeLessThan(at('7,10'));
    expect(at('14,10')).toBeLessThan(at('8,10'));
    // But a near cell behind still comes before the far edge ahead.
    expect(at('8,10')).toBeLessThan(at('14,14'));
    // The player's own cells are never reordered: they are needed now.
    expect(p.want.slice(0, 9).every((w) => w.priority === 'now')).toBe(true);
  });
});

describe('fetching ahead by speed (San Andreas pushed its load point ahead of a fast vehicle)', () => {
  it('looks 4 s ahead on foot and further at a gallop or in the air', () => {
    expect(prefetchSeconds(5)).toBe(4);
    expect(prefetchSeconds(14)).toBeGreaterThan(4);
    expect(prefetchSeconds(40)).toBeGreaterThanOrEqual(prefetchSeconds(14));
    expect(prefetchSeconds(40)).toBeLessThanOrEqual(8);
  });
});
