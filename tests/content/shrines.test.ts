import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUNGEON_LIST } from '../../src/content/dungeons/catalog';
import { EXTRA_SHRINES, SHRINE_TITLES } from '../../src/content/packs/shrines';
import { decodeCellBin, sampleHeight } from '../../src/content/world/codec';
import type { CellData, RegionManifest, WaterBody } from '../../src/content/world/format';
import { REGIONS } from '../../src/content/world/regions';
import { WORLD_CONTENT } from '../../src/content/world/worldContent';
import { shrineGroups, shrineLabel } from '../../src/ui/rpgText';

/**
 * The shrine network: enough shrines in every region, each one named, spaced out, away from the
 * camps, and standing on level, dry, clear ground in the baked world. And a shrine beside every
 * checkpoint of every Campaign Dungeon.
 */

const PUBLIC = path.resolve(__dirname, '../../public');

interface Baked {
  heights: Map<string, Float32Array>;
  props: { x: number; z: number; r: number; key: string }[];
  water: WaterBody[];
}

function loadBaked(): Baked {
  const out: Baked = { heights: new Map(), props: [], water: [] };
  for (const r of REGIONS) {
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, r.manifest), 'utf8')) as RegionManifest;
    out.water.push(...(m.water ?? []));
    for (const c of m.cells) {
      out.heights.set(`${c.cx},${c.cz}`, decodeCellBin(fs.readFileSync(path.join(PUBLIC, c.bin)), m.heightRange).heights);
      const data = JSON.parse(fs.readFileSync(path.join(PUBLIC, c.json), 'utf8')) as CellData;
      for (const [key, packed] of Object.entries(data.props)) {
        const col = m.props[key]?.collider;
        if (!col || col.kind === 'none') continue;
        for (let i = 0; i + 5 <= packed.length; i += 5) {
          const s = packed[i + 4];
          out.props.push({ x: packed[i], z: packed[i + 2], r: col.kind === 'cylinder' ? col.radius * s : Math.hypot(col.half[0], col.half[2]) * s, key });
        }
      }
    }
  }
  return out;
}

const baked = loadBaked();

function heightAt(x: number, z: number): number {
  const cx = Math.floor(x / 64), cz = Math.floor(z / 64);
  const h = baked.heights.get(`${cx},${cz}`);
  if (!h) throw new Error(`no baked cell at ${x}, ${z}`);
  return sampleHeight(h, cx, cz, x, z);
}

function segDist(px: number, pz: number, a: readonly number[], b: readonly number[]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
}

function waterEdge(x: number, z: number): number {
  let best = Infinity;
  for (const w of baked.water) {
    if (w.kind === 'pool') best = Math.min(best, Math.hypot(x - w.center[0], z - w.center[1]) - w.radius);
    else for (let i = 0; i + 1 < w.points.length; i++) best = Math.min(best, segDist(x, z, w.points[i], w.points[i + 1]) - w.halfWidth);
  }
  return best;
}

const shrines = WORLD_CONTENT.shrines;

describe('the shrine network', () => {
  it('has unique ids, and a name for every new shrine', () => {
    const ids = shrines.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of EXTRA_SHRINES) {
      expect(s.id, s.id).toMatch(/^shrine_[a-z_]+$/);
      expect(shrineLabel(s.id), s.id).toBe(s.name);
      expect(shrines.some((x) => x.id === s.id), s.id).toBe(true);
    }
  });

  it('reaches every region: at least four shrines each, fifty in all', () => {
    expect(shrines.length).toBeGreaterThanOrEqual(50);
    const groups = shrineGroups(shrines);
    expect(groups.map((g) => g.title)).toEqual(['Sproutvale', 'Bellmere', 'The Maple Terraces', 'The Willowrun', 'The Frostspine', 'The Veilfalls', 'The Rootdeep']);
    for (const g of groups) expect(g.shrines.length, g.title).toBeGreaterThanOrEqual(4);
    expect(groups.reduce((n, g) => n + g.shrines.length, 0)).toBe(shrines.length);
  });

  it('keeps shrines apart from each other', () => {
    for (let i = 0; i < shrines.length; i++) for (let j = i + 1; j < shrines.length; j++) {
      const a = shrines[i], b = shrines[j];
      expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]), `${a.id} / ${b.id}`).toBeGreaterThan(80);
    }
  });

  it('puts no new shrine in a camp, or on top of a villager, chest, object or portal', () => {
    const hostile = (WORLD_CONTENT.camps ?? []).flatMap((c) => c.members.map((m): [number, number] => [c.pos[0] + m.at[0], c.pos[2] + m.at[1]]));
    const things = [...WORLD_CONTENT.npcs, ...WORLD_CONTENT.chests, ...(WORLD_CONTENT.objects ?? []), ...(WORLD_CONTENT.portals ?? [])];
    for (const s of EXTRA_SHRINES) {
      for (const [x, z] of hostile) expect(Math.hypot(s.pos[0] - x, s.pos[2] - z), s.id).toBeGreaterThan(25);
      for (const t of things) expect(Math.hypot(s.pos[0] - t.pos[0], s.pos[2] - t.pos[2]), `${s.id} / ${t.id}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('stands every new shrine on level, dry ground, clear of props, in the baked world', () => {
    for (const s of EXTRA_SHRINES) {
      const [x, y, z] = s.pos;
      const h = heightAt(x, z);
      expect(Math.abs(h - y), `${s.id} height`).toBeLessThan(0.3);
      for (let a = 0; a < 16; a++) {
        const hh = heightAt(x + Math.cos((a * Math.PI) / 8) * 2.5, z + Math.sin((a * Math.PI) / 8) * 2.5);
        expect(Math.abs(hh - h), `${s.id} slope`).toBeLessThan(0.6);
      }
      for (const p of baked.props) expect(Math.hypot(p.x - x, p.z - z) - p.r, `${s.id} / ${p.key}`).toBeGreaterThan(3);
      expect(waterEdge(x, z), `${s.id} water`).toBeGreaterThan(5);
    }
  });
});

describe('dungeon shrines', () => {
  it('every Campaign Dungeon has a named shrine beside each checkpoint', () => {
    const ids = new Set<string>();
    for (const d of DUNGEON_LIST) {
      expect(d.shrines.length, d.id).toBe(d.checkpoints.length);
      expect(d.shrines.length, d.id).toBeGreaterThanOrEqual(3);
      for (const s of d.shrines) {
        expect(ids.has(s.id), s.id).toBe(false);
        ids.add(s.id);
        expect(SHRINE_TITLES[s.id], s.id).toBe(s.name);
        expect(shrineLabel(s.id), s.id).toContain(d.name);
        const cp = d.checkpoints.find((c) => c.id === s.checkpointId);
        expect(cp, s.id).toBeDefined();
        expect(Math.hypot(s.pos[0] - cp!.pos[0], s.pos[2] - cp!.pos[2]), s.id).toBeLessThan(10);
        expect(s.pos[1], s.id).toBe(cp!.pos[1]);
      }
    }
    expect(shrines.some((s) => ids.has(s.id))).toBe(false);
  });

  it('stands each one on open floor: clear of walls, cover, pillars, ramps, doors and hazards', () => {
    for (const d of DUNGEON_LIST) {
      for (const s of d.shrines) {
        const [x, y, z] = s.pos;
        const floor = d.solids.some((p) => p.kind === 'box' && Math.abs(x - p.at[0]) <= p.size[0] / 2 - 2 && Math.abs(z - p.at[2]) <= p.size[2] / 2 - 2 && Math.abs(p.at[1] + p.size[1] / 2 - y) < 0.01);
        expect(floor, `${s.id} floor`).toBe(true);
        for (const p of d.solids) {
          // Anything that rises above the floor here.
          const top = p.kind === 'cylinder' ? p.at[1] + p.h / 2 : p.at[1] + p.size[1] / 2;
          const bottom = p.kind === 'cylinder' ? p.at[1] - p.h / 2 : p.at[1] - p.size[1] / 2;
          if (top <= y + 0.05 || bottom > y + 4) continue;
          const reach = p.kind === 'cylinder' ? p.r : Math.hypot(p.size[0], p.size[2]) / 2;
          const near = p.kind === 'cylinder' || (p.yaw ?? 0) % 180 !== 0
            ? Math.hypot(x - p.at[0], z - p.at[2]) - reach
            : Math.max(Math.abs(x - p.at[0]) - p.size[0] / 2, Math.abs(z - p.at[2]) - p.size[2] / 2);
          expect(near, `${s.id} / ${p.id}`).toBeGreaterThan(2);
        }
        for (const m of d.mechanisms) {
          const near = Math.max(Math.abs(x - m.pos[0]) - m.size[0] / 2, Math.abs(z - m.pos[2]) - m.size[2] / 2);
          expect(near, `${s.id} / ${m.id}`).toBeGreaterThan(2);
        }
        if (d.terrain) {
          const t = d.terrain;
          const inside = x > t.origin[0] && x < t.origin[0] + t.size[0] && z > t.origin[2] && z < t.origin[2] + t.size[1];
          if (inside) {
            const ix = Math.round(((x - t.origin[0]) / t.size[0]) * (t.cols - 1)), iz = Math.round(((z - t.origin[2]) / t.size[1]) * (t.rows - 1));
            expect(Math.abs(t.heights[iz * t.cols + ix]), `${s.id} terrain`).toBeLessThan(0.3);
          }
        }
      }
    }
  });
});
