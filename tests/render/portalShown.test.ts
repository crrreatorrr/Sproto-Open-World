import { describe, expect, it } from 'vitest';
import { DOOR_REVEALED_FLAG, ROOTDEEP_PORTALS, portalOpenFlag } from '../../src/content/packs/rootdeep';
import { portalShown } from '../../src/render/portalShown';

const north = ROOTDEEP_PORTALS.rd_surface_hedge_north;
const south = ROOTDEEP_PORTALS.rd_surface_hedge_south;
const cave = ROOTDEEP_PORTALS.rd_cave_hedge_north;
const at = { x: north.pos[0], z: north.pos[2] };

describe('portal drawing', () => {
  it('draws nothing for a sealed mouth, even with the player standing on it', () => {
    expect(portalShown(south.id, true, {}, { x: south.pos[0], z: south.pos[2] }, { x: south.pos[0], z: south.pos[2] })).toBeNull();
    expect(portalShown(north.id, true, {}, at, at)).toBeNull();
  });

  it('shows the main door as motes within 5 m once the map reveals it, and nothing farther out', () => {
    const flags = { [DOOR_REVEALED_FLAG]: 1 };
    expect(portalShown(north.id, false, flags, at, at)).toBe('motes');
    expect(portalShown(north.id, false, flags, at, { x: at.x, z: at.z + 5 })).toBe('motes');
    expect(portalShown(north.id, false, flags, at, { x: at.x, z: at.z + 5.01 })).toBeNull();
  });

  it('draws a dark opening once the mouth is open, and a column on the cave side', () => {
    const open = { [portalOpenFlag(north.key)]: 1 };
    expect(portalShown(north.id, false, open, at, { x: 0, z: 0 })).toBe('opening');
    expect(portalShown(south.id, false, { [portalOpenFlag(south.key)]: 1 }, { x: south.pos[0], z: south.pos[2] }, undefined)).toBe('opening');
    expect(portalShown(cave.id, false, {}, { x: cave.pos[0], z: cave.pos[2] }, undefined)).toBe('column');
  });
});
