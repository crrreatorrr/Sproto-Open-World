import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { CAMP_AFFIX_POOLS } from '../../src/content/packs/c4';
import { RD_X, ROOTDEEP_CONTENT } from '../../src/content/packs/rootdeep';
import { decodeCellBin, sampleHeight } from '../../src/content/world/codec';
import { cellOf, type RegionManifest } from '../../src/content/world/format';

/**
 * Rootdeep Quest 5 placements. Cave floor is baked height ≤ 0.6. The hedge diggers stand on the
 * orchard, so that camp is checked against Sproutvale's ground instead. No 3 × 3 cell window of
 * cave elites, including cells cx 64–71, holds more than 4.
 */

const PUBLIC = path.resolve(__dirname, '../../public');
const FLOOR = 0.6;

function loadHeights(region: string): Map<string, { cx: number; cz: number; heights: Float32Array }> {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'world', region, 'region.json'), 'utf8')) as RegionManifest;
  const cells = new Map<string, { cx: number; cz: number; heights: Float32Array }>();
  for (const c of manifest.cells) {
    const { heights } = decodeCellBin(fs.readFileSync(path.join(PUBLIC, c.bin)), manifest.heightRange);
    cells.set(`${c.cx},${c.cz}`, { cx: c.cx, cz: c.cz, heights });
  }
  return cells;
}

const heights = new Map([...loadHeights('sproutvale'), ...loadHeights('rootdeep')]);

function heightAt(x: number, z: number): number {
  const [cx, cz] = cellOf(x, z);
  const c = heights.get(`${cx},${cz}`);
  if (!c) throw new Error(`no baked cell ${cx},${cz} for ${x}, ${z}`);
  return sampleHeight(c.heights, cx, cz, x, z);
}

const camps = ROOTDEEP_CONTENT.camps ?? [];
const objects = ROOTDEEP_CONTENT.objects ?? [];
const obstacles = ROOTDEEP_CONTENT.obstacles ?? [];

const memberPos = (camp: (typeof camps)[number], at: readonly [number, number]): [number, number, number] =>
  [camp.pos[0] + at[0], camp.pos[1], camp.pos[2] + at[1]];

describe('Rootdeep placements stand on floor', () => {
  const caveSpots: [string, number, number][] = [
    ...camps.filter((c) => c.pos[0] >= RD_X).flatMap((c) => [
      [c.id, c.pos[0], c.pos[2]] as [string, number, number],
      ...c.members.map((m, i): [string, number, number] => {
        const p = memberPos(c, m.at);
        return [`${c.id}#${i}`, p[0], p[2]];
      }),
    ]),
    ...ROOTDEEP_CONTENT.shrines.map((s): [string, number, number] => [s.id, s.pos[0], s.pos[2]]),
    ...objects.map((o): [string, number, number] => [o.id, o.pos[0], o.pos[2]]),
    ...ROOTDEEP_CONTENT.chests.map((c): [string, number, number] => [c.id, c.pos[0], c.pos[2]]),
    ...obstacles.map((o): [string, number, number] => [o.id, o.pos[0], o.pos[2]]),
  ];

  it('every cave camp, shrine, lever, lock, chest and the gate is on the cave floor', () => {
    expect(caveSpots.length).toBeGreaterThan(20);
    for (const [id, x, z] of caveSpots) {
      expect(x, id).toBeGreaterThanOrEqual(RD_X);
      expect(heightAt(x, z), id).toBeLessThanOrEqual(FLOOR);
    }
  });

  it('the hedge diggers stand on the orchard ground, not in the cave and not on a wall', () => {
    const camp = camps.find((c) => c.id === 'hedge_diggers');
    expect(camp).toBeDefined();
    const spots = [camp!.pos, ...camp!.members.map((m) => memberPos(camp!, m.at))];
    for (const p of spots) {
      expect(p[0], 'surface x').toBeLessThan(RD_X);
      const h = heightAt(p[0], p[2]);
      expect(h).toBeGreaterThan(8);
      expect(h).toBeLessThan(12);
    }
  });
});

describe('who lives where', () => {
  const members = (id: string, def: string) => camps.find((c) => c.id === id)!.members.filter((m) => m.def === def);

  it('places every camp from the Design table', () => {
    expect(camps.map((c) => c.id).sort()).toEqual([
      'hedge_diggers',
      'rd_h2', 'rd_h3', 'rd_h4', 'rd_h5', 'rd_h6', 'rd_h7', 'rd_h8',
      'rd_m2', 'rd_m3', 'rd_m4', 'rd_m5', 'rd_m6', 'rd_m7', 'rd_m8',
      'rd_vault',
    ]);
    expect(members('rd_m2', 'rd_grunt')).toHaveLength(8);
    expect(members('rd_m3', 'rd_slinger')).toHaveLength(5);
    expect(members('rd_m3', 'rd_grunt')).toHaveLength(2);
    expect(members('rd_m4', 'rd_wisp')).toHaveLength(4);
    expect(members('rd_m5', 'rd_brute')).toHaveLength(2);
    expect(members('rd_m5', 'rd_grunt')).toHaveLength(2);
    expect(members('rd_m5', 'rd_brute').map((m) => m.at).sort()).toEqual([[-5, 0], [5, 0]]);
    expect(members('rd_m6', 'rd_grunt')).toHaveLength(3);
    expect(members('rd_m6', 'rd_slinger')).toHaveLength(2);
    expect(members('rd_m7', 'rd_brute').map((m) => m.at)).toEqual([[0, 0]]);
    expect(members('rd_m7', 'rd_wisp')).toHaveLength(2);
    expect(members('rd_m8', 'rd_slinger')).toHaveLength(3);
    expect(members('rd_m8', 'rd_wisp')).toHaveLength(2);
    for (const hall of ['rd_h2', 'rd_h3', 'rd_h4', 'rd_h5', 'rd_h6', 'rd_h7', 'rd_h8']) expect(members(hall, 'rd_grunt'), hall).toHaveLength(2);
    expect(members('hedge_diggers', 'rootdeep_digger')).toHaveLength(4);
    const warden = members('rd_vault', 'deep_warden');
    expect(warden).toHaveLength(1);
    expect(warden[0].unique).toBe('deep_warden');
    expect(warden[0].at).toEqual([0, 12]);
  });

  it('puts the pocket chests, the vault chest, the levers and the gate where the plan says', () => {
    const chest = (id: string) => ROOTDEEP_CONTENT.chests.find((c) => c.id === id)!;
    for (const id of ['rd_chest_p1', 'rd_chest_p2', 'rd_chest_p3', 'rd_chest_p4']) {
      expect(chest(id).chest.items).toEqual([{ item: 'heart', count: 1 }]);
      expect(chest(id).chest.sprouts).toBe(80);
    }
    const vault = chest('chest_rootdeep_vault');
    expect(vault.chest.items).toEqual([{ item: 'staff_rootcleaver', count: 1 }]);
    expect(vault.chest.sprouts).toBe(250);
    expect(vault.pos[0]).toBeCloseTo(RD_X + 256, 5);
    expect(vault.pos[2]).toBeCloseTo(280, 5);
    const gate = obstacles.find((o) => o.id === 'gate_rootdeep_vault')!;
    expect(gate.model).toBe('gate_barrier');
    expect(gate.openFlag).toBe('gate:rootdeep_vault');
    expect(gate.shape).toEqual({ kind: 'box', half: [5, 8, 1.2], yaw: 0 });
    expect(gate.pos[2]).toBeCloseTo(205, 5);
    const triggers = ROOTDEEP_CONTENT.triggers.map((t) => t.id).sort();
    expect(triggers).toEqual(['old_hedge_wall', 'rootdeep_vault']);
  });
});

describe('elites in any 3 × 3 cells', () => {
  const elites = camps.flatMap((c) => c.members.filter((m) => ENEMIES[m.def]?.elite).map((m) => cellOf(c.pos[0] + m.at[0], c.pos[2] + m.at[1])));

  it('no window holds more than 4, including the cave cells cx 64–71', () => {
    expect(elites.length).toBeGreaterThan(0);
    for (let cx = 0; cx <= 71; cx++) {
      for (let cz = 0; cz <= 7; cz++) {
        const n = elites.filter(([x, z]) => Math.abs(x - cx) <= 1 && Math.abs(z - cz) <= 1).length;
        expect(n, `ring around (${cx}, ${cz})`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('cave camps are not in an affix pool, so a Colossal roll cannot add an elite', () => {
    for (const c of camps) expect(CAMP_AFFIX_POOLS[c.id], c.id).toBeUndefined();
  });
});

describe('the vault gate seals only the vault tunnel', () => {
  it('covers the 7 m floor at local z 205 and no other passage on that line', () => {
    const gate = obstacles.find((o) => o.id === 'gate_rootdeep_vault')!;
    expect(gate.shape.kind).toBe('box');
    if (gate.shape.kind !== 'box') return;
    const [halfX, , halfZ] = gate.shape.half;
    const gx = gate.pos[0] - RD_X;
    const gz = gate.pos[2];
    for (const z of [Math.round(gz - halfZ), Math.round(gz), Math.round(gz + halfZ)]) {
      const floor: number[] = [];
      // Local x 512 is the next cell east, which this region does not bake.
      for (let x = 0; x < 512; x++) if (heightAt(RD_X + x, z) <= FLOOR) floor.push(x);
      // The vault tunnel is the floor within 20 m of the gate. Every metre of it sits under the gate,
      // and the gate does not reach a floor band further along the same z.
      const tunnel = floor.filter((x) => Math.abs(x - gx) <= 20);
      const covered = floor.filter((x) => Math.abs(x - gx) <= halfX);
      expect(tunnel.length, `z ${z}`).toBeGreaterThan(0);
      for (const x of tunnel) expect(Math.abs(x - gx), `z ${z} x ${x}`).toBeLessThanOrEqual(halfX);
      for (const x of covered) expect(Math.abs(x - gx), `z ${z} covered x ${x}`).toBeLessThanOrEqual(20);
    }
  });
});
