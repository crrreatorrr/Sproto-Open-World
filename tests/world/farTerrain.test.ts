import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CELL_RES, CELL_SIZE } from '../../src/content/world/format';
import { FAR_BLOCK_CELLS, FarTerrain } from '../../src/world/FarTerrain';
import { TerrainChunk } from '../../src/world/TerrainChunk';
import { buildTerrainMesh } from '../../src/world/terrainMesh';

const material = new THREE.MeshStandardMaterial();

/** A coarse chunk for a cell whose ground is a plane at height `h`. */
function chunk(cx: number, cz: number, h: number): TerrainChunk {
  const heights = new Float32Array(CELL_RES * CELL_RES).fill(h);
  const splat = new Uint8Array(CELL_RES * CELL_RES * 4).fill(64);
  return new TerrainChunk(cx, cz, buildTerrainMesh(heights, splat, cx, cz, 16), material);
}

const meshes = (root: THREE.Group) => root.children as THREE.Mesh[];
const count = (m: THREE.Mesh, name: string) => m.geometry.getAttribute(name).count;

describe('far ground is drawn in blocks, not cell by cell', () => {
  it('cells of one block become one mesh', () => {
    const root = new THREE.Group();
    const far = new FarTerrain(root, material);
    const a = chunk(4, 4, 10), b = chunk(5, 4, 20), c = chunk(4, 5, 30);
    far.add(a);
    far.add(b);
    far.add(c);
    far.flush();
    expect(meshes(root).length).toBe(1);
    const m = meshes(root)[0];
    expect(count(m, 'position')).toBe(count(a.mesh, 'position') * 3);
    expect(m.geometry.index!.count).toBe(a.mesh.geometry.index!.count * 3);
    // Every index points inside the merged buffer, and each cell's triangles at its own vertices.
    const idx = m.geometry.index!.array, per = count(a.mesh, 'position'), tri = a.mesh.geometry.index!.count;
    for (let k = 0; k < 3; k++) {
      for (let i = k * tri; i < (k + 1) * tri; i++) {
        expect(idx[i]).toBeGreaterThanOrEqual(k * per);
        expect(idx[i]).toBeLessThan((k + 1) * per);
      }
    }
  });

  it('puts each cell where it stands in the world, and tells the shader which cell a vertex belongs to', () => {
    const root = new THREE.Group();
    const far = new FarTerrain(root, material);
    far.add(chunk(5, 6, 12));
    far.flush();
    const m = meshes(root)[0];
    const pos = m.geometry.getAttribute('position'), cell = m.geometry.getAttribute('cellc');
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minX = Math.min(minX, pos.getX(i));
      maxX = Math.max(maxX, pos.getX(i));
      minZ = Math.min(minZ, pos.getZ(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
      maxY = Math.max(maxY, pos.getY(i));
      expect(cell.getX(i)).toBe(5.5 * CELL_SIZE);
      expect(cell.getY(i)).toBe(6.5 * CELL_SIZE);
    }
    expect([minX, maxX, minZ, maxZ]).toEqual([5 * CELL_SIZE, 6 * CELL_SIZE, 6 * CELL_SIZE, 7 * CELL_SIZE]);
    expect(maxY).toBeCloseTo(12, 5);
    // The mesh sits at the origin with honest bounds, so the renderer can cull it by view.
    expect(m.position.lengthSq()).toBe(0);
    const box = m.geometry.boundingBox!;
    expect(box.min.x).toBe(5 * CELL_SIZE);
    expect(box.max.z).toBe(7 * CELL_SIZE);
    expect(m.frustumCulled).toBe(true);
  });

  it('cells of different blocks get a mesh each', () => {
    const root = new THREE.Group();
    const far = new FarTerrain(root, material);
    far.add(chunk(0, 0, 1));
    far.add(chunk(FAR_BLOCK_CELLS, 0, 1));
    far.add(chunk(-1, 0, 1));
    far.flush();
    expect(meshes(root).length).toBe(3);
  });

  it('a cell that leaves is taken out, and an empty block goes away', () => {
    const root = new THREE.Group();
    const far = new FarTerrain(root, material);
    const a = chunk(4, 4, 10), b = chunk(5, 4, 20);
    far.add(a);
    far.add(b);
    far.flush();
    far.remove(a);
    far.flush();
    expect(meshes(root).length).toBe(1);
    expect(count(meshes(root)[0], 'position')).toBe(count(b.mesh, 'position'));
    far.remove(b);
    far.flush();
    expect(meshes(root).length).toBe(0);
    expect(far.has(b)).toBe(false);
  });

  it('rebuilds only a few blocks a frame, the rest next frame', () => {
    const root = new THREE.Group();
    const far = new FarTerrain(root, material);
    for (let i = 0; i < 5; i++) far.add(chunk(i * FAR_BLOCK_CELLS, 0, 1));
    far.flush(2);
    expect(meshes(root).length).toBe(2);
    far.flush(2);
    far.flush(2);
    expect(meshes(root).length).toBe(5);
  });
});
