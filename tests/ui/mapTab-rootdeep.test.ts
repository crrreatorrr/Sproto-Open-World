import { describe, expect, it } from 'vitest';
import { mapBounds, mapPoint } from '../../src/ui/mapTab';

describe('Rootdeep map', () => {
  it('picks the cave map underground and the valley map on the surface', () => {
    expect(mapBounds(4200).image).toBe('world/rootdeep/map.webp');
    expect(mapBounds(200).image).toBe('world/sproutvale/map.webp');
  });

  it('places a cave point on the cave map', () => {
    const { minX, size } = mapBounds(4352);
    expect(mapPoint(4352, 256, minX, size)).toEqual({ left: 50, top: 50 });
  });
});
