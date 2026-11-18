import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellColliders, decodeCellBin, sampleHeight } from '../../src/content/world/codec';
import { cellKey, cellOf, type CellColliders, type CellData, type RegionManifest } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';

/** The baked Sproutvale's edge: a player on foot can't run, jump or roll off the built world. */
const DIR = resolve(__dirname, '../../public/world/sproutvale');
const manifest = JSON.parse(readFileSync(resolve(DIR, 'region.json'), 'utf8')) as RegionManifest;
const [sizeX, sizeZ] = manifest.size;
const inRegion = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < sizeX && cz < sizeZ;

const cells = new Map<string, { colliders: CellColliders; heights: Float32Array }>();
for (let cx = 0; cx < sizeX; cx++) {
  for (let cz = 0; cz < sizeZ; cz++) {
    const name = `c_${cx}_${cz}`;
    const { heights } = decodeCellBin(new Uint8Array(readFileSync(resolve(DIR, 'cells', `${name}.bin`))), manifest.heightRange);
    const json = JSON.parse(readFileSync(resolve(DIR, 'cells', `${name}.json`), 'utf8')) as CellData;
    cells.set(cellKey(cx, cz), { colliders: cellColliders(json, heights, manifest), heights });
  }
}

/** [name, x, z, facing]: 20 m inside each edge, heading straight out. */
const EDGES: [string, number, number, number][] = [
  ['south', 256, 20, Math.PI],
  ['north', 256, 492, 0],
  ['west', 20, 256, -Math.PI / 2],
  ['east', 492, 256, Math.PI / 2],
  ['south-west corner', 20, 20, (-3 * Math.PI) / 4],
  ['north-east corner', 492, 492, Math.PI / 4],
];

const run = (yaw: number, buttons: number): InputCommand => {
  const c = idleInput(yaw);
  c.move = { x: 0, y: 1 };
  c.pressed = buttons;
  c.held = buttons | BTN.sprint;
  return c;
};

describe('the edge of the map', () => {
  it.each(EDGES)('%s: running, jumping and rolling at it stays on the map', async (_name, x, z, yaw) => {
    await initPhysics();
    const [cx, cz] = cellOf(x, z);
    const y = sampleHeight(cells.get(cellKey(cx, cz))!.heights, cx, cz, x, z);
    for (const [every, button] of [[0, 0], [20, BTN.jump], [30, BTN.jump], [47, BTN.jump], [50, BTN.dodge]] as const) {
      const w = new SimWorld(worldLevel({ id: 'edge', playerStart: { pos: [x, y + 0.1, z], yaw } }), 1);
      const p = w.spawnPlayer(0);
      for (const c of cells.values()) w.loadCell(c.colliders);
      while ([...cells.keys()].some((k) => { const [a, b] = k.split(',').map(Number); return !w.cellReady(a, b); })) w.tick(new Map([[0, idleInput(yaw)]]));
      let left = false;
      for (let i = 0; i < 1800 && !left; i++) {
        p.vitals!.stamina = p.vitals!.staminaMax;
        w.tick(new Map([[0, run(yaw, every && i % every === 0 ? button : 0)]]));
        left = !inRegion(...cellOf(p.tf.pos.x, p.tf.pos.z));
      }
      w.dispose();
      expect(left, `pressing ${button} every ${every} ticks`).toBe(false);
    }
  }, 180_000);
});
