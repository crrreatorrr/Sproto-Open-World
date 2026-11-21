import * as THREE from 'three';
import { CELL_SIZE } from '../content/world/format';
import type { TerrainChunk } from './TerrainChunk';

/** Far ground is merged in blocks of this many cells a side (256 m). */
export const FAR_BLOCK_CELLS = 4;

interface Block {
  cells: Map<string, TerrainChunk>;
  mesh: THREE.Mesh | null;
  dirty: boolean;
}

/**
 * The ground of far cells, drawn a block at a time instead of a cell at a time.
 *
 * With several rings of cells in view, one draw call per cell of ground is most of the frame's draw
 * calls, and far cells are small on screen. Their coarse meshes are merged per 256 m block (aligned
 * to the world, so a block's mesh only changes when one of its own cells comes or goes), each block
 * one draw, culled by view like any mesh. A cell's own mesh is not in the scene while it is here.
 *
 * Every vertex carries the centre of the cell it came from (`cellc`), which is how the terrain
 * shader finds that cell's fade in the horizon mask (TerrainChunk.ts); a cell's own mesh gets it
 * from where the mesh stands.
 */
export class FarTerrain {
  private readonly blocks = new Map<string, Block>();
  private readonly where = new Map<TerrainChunk, Block>();
  private readonly drawn = new WeakSet<TerrainChunk>();

  constructor(private readonly root: THREE.Group, private readonly material: THREE.Material) {}

  has(chunk: TerrainChunk): boolean {
    return this.where.has(chunk);
  }

  /** Whether this chunk is in a block's mesh yet (it is added to one at the next `flush`). */
  shown(chunk: TerrainChunk): boolean {
    return this.drawn.has(chunk);
  }

  add(chunk: TerrainChunk): void {
    const key = `${Math.floor(chunk.cx / FAR_BLOCK_CELLS)},${Math.floor(chunk.cz / FAR_BLOCK_CELLS)}`;
    let block = this.blocks.get(key);
    if (!block) {
      block = { cells: new Map(), mesh: null, dirty: false };
      this.blocks.set(key, block);
    }
    block.cells.set(`${chunk.cx},${chunk.cz}`, chunk);
    block.dirty = true;
    this.where.set(chunk, block);
  }

  remove(chunk: TerrainChunk): void {
    const block = this.where.get(chunk);
    if (!block) return;
    this.where.delete(chunk);
    // Another chunk for the same cell may have taken its place already.
    const key = `${chunk.cx},${chunk.cz}`;
    if (block.cells.get(key) === chunk) block.cells.delete(key);
    block.dirty = true;
  }

  /** Rebuild the blocks whose cells changed, at most `max` of them (the rest wait a frame). */
  flush(max = Infinity): void {
    let done = 0;
    for (const [key, block] of this.blocks) {
      if (!block.dirty) continue;
      if (done >= max) return;
      done++;
      block.dirty = false;
      if (block.mesh) {
        block.mesh.removeFromParent();
        block.mesh.geometry.dispose();
        block.mesh = null;
      }
      if (block.cells.size === 0) {
        this.blocks.delete(key);
        continue;
      }
      block.mesh = this.merge([...block.cells.values()]);
      this.root.add(block.mesh);
      for (const c of block.cells.values()) this.drawn.add(c);
    }
  }

  private merge(chunks: readonly TerrainChunk[]): THREE.Mesh {
    let vertices = 0, indices = 0;
    for (const c of chunks) {
      vertices += c.mesh.geometry.getAttribute('position').count;
      indices += c.mesh.geometry.index!.count;
    }
    const first = chunks[0].mesh.geometry;
    const position = new Float32Array(vertices * 3), cellc = new Float32Array(vertices * 2);
    const index = new Uint32Array(indices);
    // The other attributes are copied as they are, whatever their type.
    const others = Object.keys(first.attributes).filter((name) => name !== 'position');
    const out = new Map(others.map((name) => {
      const a = first.getAttribute(name) as THREE.BufferAttribute;
      const Ctor = a.array.constructor as new (n: number) => THREE.TypedArray;
      return [name, { array: new Ctor(vertices * a.itemSize), itemSize: a.itemSize, normalized: a.normalized }] as const;
    }));
    const box = new THREE.Box3();
    let v = 0, i = 0;
    for (const c of chunks) {
      const g = c.mesh.geometry;
      const p = g.getAttribute('position').array as Float32Array;
      const n = p.length / 3;
      const ox = c.cx * CELL_SIZE, oz = c.cz * CELL_SIZE;
      for (let k = 0; k < n; k++) {
        position[(v + k) * 3] = p[k * 3] + ox;
        position[(v + k) * 3 + 1] = p[k * 3 + 1];
        position[(v + k) * 3 + 2] = p[k * 3 + 2] + oz;
        cellc[(v + k) * 2] = ox + CELL_SIZE / 2;
        cellc[(v + k) * 2 + 1] = oz + CELL_SIZE / 2;
      }
      for (const [name, o] of out) o.array.set((g.getAttribute(name) as THREE.BufferAttribute).array, v * o.itemSize);
      const src = g.index!.array;
      for (let k = 0; k < src.length; k++) index[i + k] = src[k] + v;
      const b = g.boundingBox!;
      box.expandByPoint(new THREE.Vector3(b.min.x + ox, b.min.y, b.min.z + oz));
      box.expandByPoint(new THREE.Vector3(b.max.x + ox, b.max.y, b.max.z + oz));
      v += n;
      i += src.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('cellc', new THREE.BufferAttribute(cellc, 2));
    for (const [name, o] of out) geometry.setAttribute(name, new THREE.BufferAttribute(o.array, o.itemSize, o.normalized));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = 'terrain:far';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  dispose(): void {
    for (const block of this.blocks.values()) {
      block.mesh?.removeFromParent();
      block.mesh?.geometry.dispose();
    }
    this.blocks.clear();
    this.where.clear();
  }
}
