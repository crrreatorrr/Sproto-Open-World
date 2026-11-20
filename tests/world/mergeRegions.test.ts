import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PropCollider, RegionManifest } from '../../src/content/world/format';
import { mergeManifests } from '../../src/world/RegionManifest';

/**
 * The world's regions join into one manifest: cells joined, origin and size widened to cover every
 * region (the horizon mask is built over it), player start and horizon kept from the first. All
 * regions share one height range; a prop several use keeps the largest baked capacity; a river two
 * regions list is kept once.
 */
const PUBLIC = path.resolve(__dirname, '../../public');
const readManifest = (region: string) =>
  JSON.parse(fs.readFileSync(path.join(PUBLIC, 'world', region, 'region.json'), 'utf8')) as RegionManifest;

const sproutvale = readManifest('sproutvale');
const rootdeep = readManifest('rootdeep');

const none: PropCollider = { kind: 'none' };
function withProp(key: string, capacity: number): RegionManifest {
  return {
    id: key,
    version: 1,
    origin: [0, 0],
    size: [1, 1],
    cellSize: 64,
    heightRange: { min: -16, max: 240 },
    cells: [],
    props: { [key]: { path: `models/props/${key}.glb`, collider: none, capacity } },
    playerStart: { pos: [0, 0, 0], yaw: 0 },
    horizon: `world/${key}/horizon.glb`,
    splatLayers: ['grass', 'dirt', 'rock', 'path'],
    fog: { near: 80, far: 180, farPlane: 450 },
  };
}

describe('mergeManifests', () => {
  it('joins the cells, covers both regions and keeps the first region\'s start and horizon', () => {
    const m = mergeManifests(sproutvale, rootdeep);
    expect(m.cells.length).toBe(sproutvale.cells.length + rootdeep.cells.length);
    expect(m.origin).toEqual([0, 0]);
    expect(m.size).toEqual([72, 8]);
    expect(m.horizon).toBe(sproutvale.horizon);
    expect(m.playerStart).toEqual(sproutvale.playerStart);
  });

  it('keeps a river that two regions list once', () => {
    const river = { id: 'r', kind: 'river' as const, points: [[0, 0, 1], [10, 0, 1]] as [number, number, number][], halfWidth: 3, flow: 1 };
    const m = mergeManifests({ ...withProp('a', 1), water: [river] }, { ...withProp('b', 1), water: [river] });
    expect(m.water).toHaveLength(1);
  });

  it('takes the larger capacity for a prop both regions use', () => {
    expect(mergeManifests(withProp('rock', 4), withProp('rock', 9)).props.rock.capacity).toBe(9);
  });

  it('refuses regions with different height ranges', () => {
    expect(() => mergeManifests(sproutvale, { ...rootdeep, heightRange: { min: 0, max: 1 } })).toThrow(/heightRange/);
  });
});
