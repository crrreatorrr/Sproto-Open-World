/**
 * Everything the streamed world spawns: Sproutvale and the Rootdeep together.
 * `SPROUTVALE_CONTENT` itself stays the valley, because its tests count that region alone.
 */
import { ROOTDEEP_CONTENT } from '../packs/rootdeep';
import { SPROUTVALE_CONTENT, type RegionContent } from './sproutvaleContent';

function join<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): T[] {
  return [...(a ?? []), ...(b ?? [])];
}

export const WORLD_CONTENT: RegionContent = {
  npcs: join(SPROUTVALE_CONTENT.npcs, ROOTDEEP_CONTENT.npcs),
  shrines: join(SPROUTVALE_CONTENT.shrines, ROOTDEEP_CONTENT.shrines),
  chests: join(SPROUTVALE_CONTENT.chests, ROOTDEEP_CONTENT.chests),
  mounts: join(SPROUTVALE_CONTENT.mounts, ROOTDEEP_CONTENT.mounts),
  objects: join(SPROUTVALE_CONTENT.objects, ROOTDEEP_CONTENT.objects),
  obstacles: join(SPROUTVALE_CONTENT.obstacles, ROOTDEEP_CONTENT.obstacles),
  enemies: join(SPROUTVALE_CONTENT.enemies, ROOTDEEP_CONTENT.enemies),
  camps: join(SPROUTVALE_CONTENT.camps, ROOTDEEP_CONTENT.camps),
  triggers: join(SPROUTVALE_CONTENT.triggers, ROOTDEEP_CONTENT.triggers),
  portals: join(SPROUTVALE_CONTENT.portals, ROOTDEEP_CONTENT.portals),
};
