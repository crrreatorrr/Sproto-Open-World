import type { LevelDef } from '../sandbox';
import type { RegionManifest, WorldBounds } from './format';

/**
 * A streamed region as a sim level: no ground plane and no fixed shapes (cells bring their own
 * colliders through SimWorld.loadCell), the manifest's player start. `edge` is the rectangle of the
 * whole walkable world, which the Edge Warden guards; without it there is no Warden.
 */
export function worldLevel(manifest: Pick<RegionManifest, 'id' | 'playerStart'>, edge?: WorldBounds): LevelDef {
  return {
    ...(edge ? { edge } : {}),
    id: manifest.id,
    spawn: { pos: [...manifest.playerStart.pos], yaw: manifest.playerStart.yaw },
    shapes: [],
  };
}
