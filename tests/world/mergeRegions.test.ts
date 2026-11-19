import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PropCollider, RegionManifest } from '../../src/content/world/format';
import { mergeManifests } from '../../src/world/RegionManifest';

/**
 * Quest 1: the cave's cells join Sproutvale's manifest. Origin, size and horizon stay the valley's,
 * so streaming, the horizon mask and the player start keep working. Both regions share one height
 * range; a prop both use keeps the larger baked capacity.
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
    heightRange: { min: -8, max: 40 },
    cells: [],
    props: { [key]: { path: `models/props/${key}.glb`, collider: none, capacity } },
    playerStart: { pos: [0, 0, 0], yaw: 0 },
    horizon: `world/${key}/horizon.glb`,
    splatLayers: ['grass', 'dirt', 'rock', 'path'],
    fog: { near: 80, far: 180, farPlane: 450 },
  };
}

describe('mergeManifests', () => {
  it('joins the cells of both regions and keeps the first region\'s origin, size and horizon', () => {
    const m = mergeManifests(sproutvale, rootdeep);
    expect(m.cells.length).toBe(sproutvale.cells.length + rootdeep.cells.length);
    expect(m.origin).toEqual(sproutvale.origin);
    expect(m.size).toEqual(sproutvale.size);
    expect(m.horizon).toBe(sproutvale.horizon);
  });

  it('takes the larger capacity for a prop both regions use', () => {
    expect(mergeManifests(withProp('rock', 4), withProp('rock', 9)).props.rock.capacity).toBe(9);
  });

  it('refuses regions with different height ranges', () => {
    expect(() => mergeManifests(sproutvale, { ...rootdeep, heightRange: { min: 0, max: 1 } })).toThrow(/heightRange/);
  });
});
