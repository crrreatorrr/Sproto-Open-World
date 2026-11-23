import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CellData, PropKind } from '../../src/content/world/format';
import { PropInstancer, type PropHost } from '../../src/world/PropInstancer';
import { NEAR_SHADOW_M, coverageM, propRanges } from '../../src/world/rings';

const CELL = 64;
const KINDS: Record<string, PropKind> = {
  // A house: tall, casts a shadow, seen from far.
  house: { path: 'house.glb', lod1Path: 'house-lod1.glb', collider: { kind: 'none' }, capacity: 400, size: [9.7, 13.8] },
  // A fern: ground clutter, no shadow, gone a short way off.
  fern: { path: 'fern.glb', lod1Path: 'fern-lod1.glb', collider: { kind: 'none' }, capacity: 400, size: [1.6, 0.7] },
};

function host(): PropHost & { clock: number } {
  const h = {
    clock: 0,
    load: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
      return Promise.resolve(g);
    },
    uploadTexture: () => Promise.resolve(),
    compile: () => Promise.resolve(),
    now: () => h.clock,
  };
  return h;
}

/** A row of one prop kind along +z through the cell column cx = 0, one every `step` m. */
function row(key: string, cz: number, step: number): CellData {
  const packed: number[] = [];
  for (let z = cz * CELL + step / 2; z < (cz + 1) * CELL; z += step) packed.push(32, 0, z, 0, 1);
  return { cx: 0, cz, props: { [key]: packed } };
}

function camera(x: number, z: number, lookX: number, lookZ: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2200);
  c.position.set(x, 3, z);
  c.lookAt(lookX, 3, lookZ);
  c.updateMatrixWorld();
  return c;
}

/** Let the fake loads finish, then draw a frame. */
async function settle(p: PropInstancer, cam: THREE.PerspectiveCamera, seconds = 10): Promise<void> {
  for (let i = 0; i < 6; i++) {
    p.present(cam, seconds, CELL);
    await new Promise((r) => setTimeout(r, 0));
  }
  p.present(cam, seconds, CELL);
}

const count = (p: PropInstancer, name: string) => (p.root.children.find((m) => m.name === name) as THREE.InstancedMesh | undefined)?.count ?? 0;
/** The z of every instance in a set. */
function zs(p: PropInstancer, name: string): number[] {
  const m = p.root.children.find((c) => c.name === name) as THREE.InstancedMesh | undefined;
  if (!m) return [];
  return Array.from({ length: m.count }, (_, i) => m.instanceMatrix.array[i * 16 + 14]);
}

describe('the prop instancer draws what the camera can see, at each prop\'s own distance', () => {
  const RINGS = 5, SCALE = 1;
  const cover = coverageM(RINGS);
  const house = propRanges(KINDS.house, SCALE, cover), fern = propRanges(KINDS.fern, SCALE, cover);

  async function world(): Promise<{ p: PropInstancer; h: ReturnType<typeof host> }> {
    const h = host();
    const p = new PropInstancer(KINDS, h);
    p.configure(RINGS, SCALE);
    for (let cz = 0; cz < 6; cz++) {
      p.addCell(0, cz, { cx: 0, cz, props: { ...row('house', cz, 8).props, ...row('fern', cz, 4).props } });
    }
    return { p, h };
  }

  it('each prop is in the detailed set or the simple one by its distance, never lost between them', async () => {
    const { p } = await world();
    const cam = camera(32, 1, 32, 400);
    await settle(p, cam);
    const detailed = [...zs(p, 'house:near:0'), ...zs(p, 'house:hd:0')], simple = zs(p, 'house:far:0');
    expect(detailed.length).toBeGreaterThan(0);
    expect(simple.length).toBeGreaterThan(0);
    // Nothing detailed past the detailed model's reach (plus the slack for camera movement)...
    for (const z of detailed) expect(z - 1).toBeLessThan(house.hd + 4);
    // ...nothing simple before the swap starts, or past the far distance.
    for (const z of simple) {
      expect(z - 1).toBeGreaterThan(house.hd - house.band - 4);
      expect(z - 1).toBeLessThan(house.far + 4);
    }
    // Every house within the far distance is in at least one set.
    const all = new Set([...detailed, ...simple]);
    for (let z = 4; z - 1 < house.far - 4; z += 8) expect(all.has(z), `house at z ${z}`).toBe(true);
  });

  it('ground clutter stops a short way off; a house is seen far beyond it', async () => {
    const { p } = await world();
    await settle(p, camera(32, 1, 32, 400));
    const ferns = [...zs(p, 'fern:hd:0'), ...zs(p, 'fern:far:0')];
    const houses = [...zs(p, 'house:near:0'), ...zs(p, 'house:hd:0'), ...zs(p, 'house:far:0')];
    expect(Math.max(...ferns)).toBeLessThan(fern.far + 5);
    expect(Math.max(...houses)).toBeGreaterThan(fern.far * 2);
    // Ferns cast no shadow: they are never in the shadow-casting set.
    expect(count(p, 'fern:near:0')).toBe(0);
  });

  it('only props near the camera are in the one set that casts shadows', async () => {
    const { p } = await world();
    await settle(p, camera(32, 1, 32, 400));
    const near = zs(p, 'house:near:0');
    expect(near.length).toBeGreaterThan(0);
    for (const z of near) expect(Math.abs(z - 1)).toBeLessThan(NEAR_SHADOW_M);
    const mesh = (name: string) => p.root.children.find((m) => m.name === name) as THREE.InstancedMesh;
    expect(mesh('house:near:0').castShadow).toBe(true);
    expect(mesh('house:hd:0').castShadow).toBe(false);
    expect(mesh('house:far:0').castShadow).toBe(false);
  });

  it('what is behind the camera is not drawn, except the shadow casters close by', async () => {
    const { p } = await world();
    const ahead = camera(32, 100, 32, 400);
    await settle(p, ahead);
    const before = count(p, 'house:far:0');
    expect(before).toBeGreaterThan(0);
    // Turn round: the row now runs away behind the camera.
    const back = camera(32, 100, 32, -400);
    await settle(p, back);
    const shown = zs(p, 'house:far:0');
    for (const z of shown) expect(z).toBeLessThan(100 + CELL);
    expect(shown.length).toBeLessThan(before);
    // A house just behind the camera still casts its shadow into view.
    expect(zs(p, 'house:near:0').some((z) => z > 100)).toBe(true);
  });

  it('a cell that leaves takes its props with it', async () => {
    const { p } = await world();
    const cam = camera(32, 1, 32, 400);
    await settle(p, cam);
    expect(p.stats().instances).toBeGreaterThan(0);
    for (let cz = 0; cz < 6; cz++) p.removeCell(0, cz);
    await settle(p, cam);
    expect(p.stats().instances).toBe(0);
    expect(p.stats().placed).toBe(0);
  });

  it('from high above the ground everything is the simple model, with no shadow casters', async () => {
    const { p } = await world();
    const cam = camera(32, 1, 32, 400);
    for (let i = 0; i < 6; i++) {
      p.present(cam, 10, CELL, 80);
      await new Promise((r) => setTimeout(r, 0));
    }
    p.present(cam, 10, CELL, 80);
    expect(count(p, 'house:near:0')).toBe(0);
    expect(count(p, 'house:hd:0')).toBe(0);
    expect(count(p, 'house:far:0')).toBeGreaterThan(0);
  });

  it('a landmark shows in every loaded cell, however far', async () => {
    const h = host();
    const p = new PropInstancer({ tower: { path: 'tower.glb', lod1Path: 'tower-lod1.glb', collider: { kind: 'none' }, capacity: 4, size: [8.5, 31.4], landmark: true } }, h);
    p.configure(RINGS, SCALE);
    // 7 cells north: about 450 m off, past every other prop's reach.
    p.addCell(0, 7, { cx: 0, cz: 7, props: { tower: [32, 0, 7 * CELL + 32, 0, 1] } });
    await settle(p, camera(32, 1, 32, 600));
    expect(count(p, 'tower:far:0')).toBe(1);
  });

  it('a set made while the view was narrow still holds the widest view', async () => {
    // Behind the title two rings stream; play opens the view. The simple set must not be sized for two.
    const h = host();
    const kinds = { house: { ...KINDS.house, capacity: 12 } };
    const p = new PropInstancer(kinds, h);
    p.configure(2, SCALE);
    p.addCell(0, 0, row('house', 0, 8));
    p.addCell(0, 1, row('house', 1, 8));
    const cam = camera(32, 1, 32, 400);
    await settle(p, cam);
    p.configure(RINGS, SCALE);
    for (let cz = 2; cz < 5; cz++) p.addCell(0, cz, row('house', cz, 8));
    await settle(p, cam);
    expect(count(p, 'house:far:0')).toBeGreaterThan(12);
    expect(p.stats().overflow).toBe(0);
  });

  it('nothing overflows its buffers with the widest view', async () => {
    const { p } = await world();
    await settle(p, camera(32, 1, 32, 400));
    expect(p.stats().overflow).toBe(0);
  });
});
