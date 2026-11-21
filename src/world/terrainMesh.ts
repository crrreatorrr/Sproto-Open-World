import { CELL_RES, CELL_SIZE } from '../content/world/format';

/**
 * A cell's terrain mesh as flat typed arrays (plan §3.3): built in terrain.worker.ts and handed to
 * the main thread as transferables, so the main thread only wraps them in a BufferGeometry. Pure
 * (no three), so tests/world checks it in Node.
 *
 * Positions are local to the cell's SW corner (the mesh sits at the corner), which keeps the
 * bounding sphere small and the floats precise. `uv` carries world XZ in metres for world-space
 * texturing, so neighbouring cells tile seamlessly. A skirt hangs from every edge to hide the
 * cracks between a full-res cell and a half-res neighbour (their shared edges sample the same
 * heights at different spacings).
 */
export interface TerrainMeshData {
  res: number;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  /** 4 splat weights per vertex (manifest.splatLayers order), normalized Uint8. */
  splat: Uint8Array;
  index: Uint16Array;
  minY: number;
  maxY: number;
}

/** Skirt depth (m): deeper than the worst half-res mismatch on the baked slopes. */
export const SKIRT_DEPTH = 4;

export function buildTerrainMesh(heights: Float32Array, splat: Uint8Array, cx: number, cz: number, res: 64 | 32 | 16, skirt = SKIRT_DEPTH): TerrainMeshData {
  const n = res;
  const step = (CELL_RES - 1) / n;
  const spacing = CELL_SIZE / n;
  const side = n + 1;
  const gridVerts = side * side;
  const rim = 4 * n;
  const verts = gridVerts + rim;
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const weights = new Uint8Array(verts * 4);
  const ox = cx * CELL_SIZE, oz = cz * CELL_SIZE;
  const h = (ix: number, iz: number) => heights[Math.min(CELL_RES - 1, Math.max(0, iz)) * CELL_RES + Math.min(CELL_RES - 1, Math.max(0, ix))];
  let minY = Infinity, maxY = -Infinity;

  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const v = j * side + i;
      const ix = i * step, iz = j * step;
      const y = h(ix, iz);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      position[v * 3] = i * spacing;
      position[v * 3 + 1] = y;
      position[v * 3 + 2] = j * spacing;
      // Normals from the full 1 m grid (one-sided at the cell edge), so a half-res cell lights
      // the same as its full-res self.
      const x0 = Math.max(0, ix - 1), x1 = Math.min(CELL_RES - 1, ix + 1);
      const z0 = Math.max(0, iz - 1), z1 = Math.min(CELL_RES - 1, iz + 1);
      const dhdx = (h(x1, iz) - h(x0, iz)) / (x1 - x0);
      const dhdz = (h(ix, z1) - h(ix, z0)) / (z1 - z0);
      const len = Math.hypot(dhdx, 1, dhdz);
      normal[v * 3] = -dhdx / len;
      normal[v * 3 + 1] = 1 / len;
      normal[v * 3 + 2] = -dhdz / len;
      uv[v * 2] = ox + i * spacing;
      uv[v * 2 + 1] = oz + j * spacing;
      const s = (iz * CELL_RES + ix) * 4;
      weights[v * 4] = splat[s];
      weights[v * 4 + 1] = splat[s + 1];
      weights[v * 4 + 2] = splat[s + 2];
      weights[v * 4 + 3] = splat[s + 3];
    }
  }

  // The rim walks the edge anticlockwise seen from above (S edge +x, E edge +z, N edge −x, W edge
  // −z), so "up × travel" points out of the cell on every side.
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(i);
  for (let j = 0; j < n; j++) ring.push(j * side + n);
  for (let i = n; i > 0; i--) ring.push(n * side + i);
  for (let j = n; j > 0; j--) ring.push(j * side);
  for (let r = 0; r < rim; r++) {
    const src = ring[r], dst = gridVerts + r;
    position[dst * 3] = position[src * 3];
    position[dst * 3 + 1] = position[src * 3 + 1] - skirt;
    position[dst * 3 + 2] = position[src * 3 + 2];
    normal.copyWithin(dst * 3, src * 3, src * 3 + 3);
    uv.copyWithin(dst * 2, src * 2, src * 2 + 2);
    weights.copyWithin(dst * 4, src * 4, src * 4 + 4);
  }
  minY -= skirt;

  const index = new Uint16Array(n * n * 6 + rim * 6);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
      index[k++] = a;
      index[k++] = c;
      index[k++] = b;
      index[k++] = b;
      index[k++] = c;
      index[k++] = d;
    }
  }
  for (let r = 0; r < rim; r++) {
    const a = ring[r], b = ring[(r + 1) % rim];
    const a2 = gridVerts + r, b2 = gridVerts + ((r + 1) % rim);
    index[k++] = a;
    index[k++] = b;
    index[k++] = a2;
    index[k++] = b;
    index[k++] = b2;
    index[k++] = a2;
  }
  return { res, position, normal, uv, splat: weights, index, minY, maxY };
}
