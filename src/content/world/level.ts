import type { LevelDef } from '../sandbox';
import type { RegionManifest } from './format';

/**
 * A streamed region as a sim level: no ground plane and no fixed shapes (cells bring their own
 * colliders through SimWorld.loadCell), the manifest's player start.
 */
export function worldLevel(manifest: Pick<RegionManifest, 'id' | 'playerStart'>): LevelDef {
  return {
    id: manifest.id,
    spawn: { pos: [...manifest.playerStart.pos], yaw: manifest.playerStart.yaw },
    shapes: [],
  };
}
