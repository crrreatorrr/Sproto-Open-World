/**
 * Every baked region, where it sits, and what the game calls it. Pure data (no three, no DOM).
 *
 * The overworld is one walkable world: Sproutvale in the south-west corner, Bellmere east of it,
 * the Maple Terraces and the Willowrun north of those, the Frostspine and the Veilfalls along the
 * top. Neighbouring regions meet with no cliff between them (tools/bake-world.ts blends their
 * terrain into the same heights along the seam). The Rootdeep is a cave far to the east, reached by
 * its portals. Each region's rectangle must match its world-src/<id>/terrain.json.
 *
 *          x 0       512      768         1536 m
 *   z 2560 +--------------------------------+
 *          | Frostspine (12x16) | Veilfalls  |
 *   z 1536 +---------+----------+------------+
 *          | Maple   |  Willowrun (16x16)    |
 *          | Terraces|                       |
 *   z  512 +---------+-----------------------+
 *          |Sproutvale| Bellmere (16x8)      |
 *   z    0 +---------+-----------------------+
 */
import { CELL_SIZE, type WorldBounds } from './format';

export type RegionId = 'sproutvale' | 'town' | 'zen' | 'river' | 'mountains' | 'waterfalls' | 'rootdeep';

export interface RegionDef {
  id: RegionId;
  /** The name in a sentence ("Loading the Willowrun…"), article included. */
  name: string;
  /** SW cell and size in cells. */
  origin: readonly [number, number];
  size: readonly [number, number];
  /** Part of the walkable overworld (its horizon is drawn), or the cave. */
  overworld: boolean;
  /** Manifest path under public/. */
  manifest: string;
}

const def = (id: RegionId, name: string, origin: [number, number], size: [number, number], overworld = true): RegionDef => ({
  id, name, origin, size, overworld, manifest: `world/${id}/region.json`,
});

/** Load order: Sproutvale first (the player start, and the title screen's view), the cave last. */
export const REGIONS: readonly RegionDef[] = [
  def('sproutvale', 'Sproutvale', [0, 0], [8, 8]),
  def('town', 'Bellmere', [8, 0], [16, 8]),
  def('zen', 'the Maple Terraces', [0, 8], [8, 16]),
  def('river', 'the Willowrun', [8, 8], [16, 16]),
  def('mountains', 'the Frostspine', [0, 24], [12, 16]),
  def('waterfalls', 'the Veilfalls', [12, 24], [12, 16]),
  def('rootdeep', 'the Rootdeep', [64, 0], [8, 8], false),
];

/** The region whose rectangle holds this world point (Sproutvale when none does). */
export function regionAt(x: number, z: number): RegionDef {
  for (const r of REGIONS) {
    const x0 = r.origin[0] * CELL_SIZE, z0 = r.origin[1] * CELL_SIZE;
    if (x >= x0 && z >= z0 && x < x0 + r.size[0] * CELL_SIZE && z < z0 + r.size[1] * CELL_SIZE) return r;
  }
  return REGIONS[0];
}

export const regionById = (id: RegionId): RegionDef => REGIONS.find((r) => r.id === id)!;

/** The overworld's bounding box in metres. */
export function overworldBounds(): WorldBounds {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of REGIONS) {
    if (!r.overworld) continue;
    minX = Math.min(minX, r.origin[0] * CELL_SIZE);
    minZ = Math.min(minZ, r.origin[1] * CELL_SIZE);
    maxX = Math.max(maxX, (r.origin[0] + r.size[0]) * CELL_SIZE);
    maxZ = Math.max(maxZ, (r.origin[1] + r.size[1]) * CELL_SIZE);
  }
  return { minX, minZ, maxX, maxZ };
}
