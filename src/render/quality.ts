import type { HitFx } from './fx/HitFx';
import type { Renderer } from './Renderer';
import { fogReach } from '../world/rings';

export type QualityLevel = 'low' | 'medium' | 'high';

/** What each graphics quality costs: resolution, sun shadows and how many sparks a hit throws. */
export const QUALITY: Record<QualityLevel, { pixelRatio: number; shadows: boolean; shadowMap: number; particles: number }> = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 1024, particles: 0.45 },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, particles: 0.75 },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, particles: 1 },
};

/** Apply a graphics quality now: every part of it can change while the game runs. */
export function applyQuality(r: Renderer, fx: HitFx, level: QualityLevel): void {
  const q = QUALITY[level];
  r.setPixelCap(q.pixelRatio);
  r.setFogReach(fogReach(level));
  const sun = r.sun;
  r.setShadows(q.shadows);
  if (sun.shadow.mapSize.x !== q.shadowMap) {
    sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    // The shadow pass makes a new map at the new size when it finds none.
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  fx.density = q.particles;
}
