import { describe, expect, it } from 'vitest';
import { regionAt, type RegionId } from '../../src/content/world/regions';
import { OVERWORLD_LABELS, mapBounds, mapPoint } from '../../src/ui/mapTab';

describe('overworld maps', () => {
  it('shows each region on its own map', () => {
    expect(mapBounds(760, 232)).toMatchObject({ region: 'town', image: 'world/town/map.webp', minX: 512, minZ: 0, size: 1024, sizeZ: 512 });
    expect(mapBounds(1150, 1730).region).toBe('waterfalls');
  });

  it('puts every place name inside its own region and on the map', () => {
    for (const [id, labels] of Object.entries(OVERWORLD_LABELS)) {
      const b = mapBounds(labels![0].x, labels![0].z);
      for (const l of labels!) {
        expect(regionAt(l.x, l.z).id, l.name).toBe(id as RegionId);
        const at = mapPoint(l.x, l.z, b.minX, b.size, b.minZ, b.sizeZ);
        for (const v of [at.left, at.top]) expect(v >= 0 && v <= 100, l.name).toBe(true);
      }
    }
  });
});
