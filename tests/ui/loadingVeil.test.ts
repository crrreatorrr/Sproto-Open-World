import { describe, expect, it } from 'vitest';
import { ROOTDEEP_PORTALS } from '../../src/content/packs/rootdeep';
import { loadingVeilText } from '../../src/ui/loadingVeil';

/**
 * The loading veil names the region you are entering. A cave mouth's arrive point is inside the
 * Rootdeep; a surface mouth's arrive point is back in Sproutvale. The valley start is x 256.
 */
describe('the loading veil names the region you enter', () => {
  it('names the Rootdeep when the destination is a cave entrance', () => {
    const cave = Object.values(ROOTDEEP_PORTALS).filter((p) => p.side === 'cave');
    expect(cave.length).toBeGreaterThan(0);
    for (const dest of cave) expect(loadingVeilText(dest.arrive[0])).toBe('Loading the Rootdeep…');
  });

  it('names Sproutvale when the destination is a surface entrance', () => {
    expect(loadingVeilText(256)).toBe('Loading Sproutvale…');
    const surface = Object.values(ROOTDEEP_PORTALS).filter((p) => p.side === 'surface');
    expect(surface.length).toBeGreaterThan(0);
    for (const dest of surface) expect(loadingVeilText(dest.arrive[0])).toBe('Loading Sproutvale…');
  });
});
