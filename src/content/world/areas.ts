/**
 * The named areas of the world, in world x, z: the map's labels, and where god mode's travel list
 * goes. Pure data.
 */
import { RD_X } from '../packs/rootdeep';

export interface AreaDef {
  name: string;
  x: number;
  z: number;
}

/** Where the regions of Sproutvale are. */
export const SURFACE_AREAS: readonly AreaDef[] = [
  { name: 'Sprout Hollow', x: 260, z: 98 },
  { name: 'Orchard Fields', x: 104, z: 160 },
  { name: 'Millrun', x: 424, z: 176 },
  { name: 'Watchtower Hill', x: 256, z: 286 },
  { name: 'Thornwood', x: 216, z: 352 },
  { name: 'The Quarry', x: 440, z: 452 },
];

/** The eight main caves of the Rootdeep and the vault (world x is local x + 4096). */
export const CAVE_AREAS: readonly AreaDef[] = [
  { name: 'Lantern Hall', x: RD_X + 168, z: 168 },
  { name: 'Grunt Warren', x: RD_X + 256, z: 148 },
  { name: 'Slinger Gallery', x: RD_X + 344, z: 168 },
  { name: 'Wisp Hollow', x: RD_X + 364, z: 256 },
  { name: 'Brute Den', x: RD_X + 344, z: 344 },
  { name: 'Fungus Crossing', x: RD_X + 256, z: 364 },
  { name: 'Old Mine', x: RD_X + 168, z: 344 },
  { name: 'Echo Pit', x: RD_X + 148, z: 256 },
  { name: 'Vault', x: RD_X + 256, z: 256 },
];
