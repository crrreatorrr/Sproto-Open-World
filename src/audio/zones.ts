/** The parts of Sproutvale that sound different (world-src/sproutvale/terrain.json's areas, in metres). */
export type ZoneId = 'village' | 'orchard' | 'hill' | 'millrun' | 'thornwood' | 'quarry' | 'meadow';

/** What the ground is made of underfoot. */
export type Surface = 'grass' | 'dirt' | 'stone';

export const ZONE_SURFACE: Record<ZoneId, Surface> = {
  village: 'dirt', orchard: 'grass', hill: 'grass', millrun: 'dirt', thornwood: 'dirt', quarry: 'stone', meadow: 'grass',
};

/** The zone at a world position. Checked from the most enclosed place outward. */
export function zoneAt(x: number, z: number): ZoneId {
  if (Math.hypot(x - 440, z - 452) < 72 || (x >= 296 && z >= 392)) return 'quarry';
  if (x >= 196 && x <= 324 && z >= 20 && z <= 132) return 'village';
  if (Math.hypot(x - 256, z - 256) < 86) return 'hill';
  if (x >= 350 && z < 340) return 'millrun';
  if (z >= 262) return 'thornwood';
  if (x <= 196) return 'orchard';
  return 'meadow';
}
