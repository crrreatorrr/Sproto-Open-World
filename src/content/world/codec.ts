import { CELL_RES, CELL_SIZE, type CellColliders, type CellData, type RegionManifest } from './format';

/**
 * The cell .bin layout (plan §3.1), little-endian:
 *   - 65 × 65 Uint16 heights, row-major (iz · 65 + ix), mapped onto manifest.heightRange;
 *   - 65 × 65 × 4 Uint8 splat weights (RGBA = manifest.splatLayers), same order.
 * Pure: the bake tool encodes, the streamer and the sim tests decode.
 */
export const HEIGHT_BYTES = CELL_RES * CELL_RES * 2;
export const SPLAT_BYTES = CELL_RES * CELL_RES * 4;
export const CELL_BIN_BYTES = HEIGHT_BYTES + SPLAT_BYTES;

export function encodeCellBin(heights: Float32Array, splat: Uint8Array, range: { min: number; max: number }): Uint8Array {
  const out = new Uint8Array(CELL_BIN_BYTES);
  const view = new DataView(out.buffer);
  const span = range.max - range.min || 1;
  for (let i = 0; i < CELL_RES * CELL_RES; i++) {
    const v = Math.round(((heights[i] - range.min) / span) * 65535);
    view.setUint16(i * 2, Math.max(0, Math.min(65535, v)), true);
  }
  out.set(splat, HEIGHT_BYTES);
  return out;
}

export function decodeCellBin(buf: ArrayBuffer | Uint8Array, range: { min: number; max: number }): { heights: Float32Array; splat: Uint8Array } {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength !== CELL_BIN_BYTES) throw new Error(`cell bin: expected ${CELL_BIN_BYTES} bytes, got ${bytes.byteLength}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const heights = new Float32Array(CELL_RES * CELL_RES);
  const span = range.max - range.min;
  for (let i = 0; i < heights.length; i++) heights[i] = range.min + (view.getUint16(i * 2, true) / 65535) * span;
  return { heights, splat: bytes.slice(HEIGHT_BYTES, HEIGHT_BYTES + SPLAT_BYTES) };
}

/** Bilinear height at a world point inside a cell's height grid (clamped to the cell). */
export function sampleHeight(heights: Float32Array, cx: number, cz: number, x: number, z: number): number {
  const fx = Math.max(0, Math.min(CELL_RES - 1, x - cx * CELL_SIZE));
  const fz = Math.max(0, Math.min(CELL_RES - 1, z - cz * CELL_SIZE));
  const ix = Math.min(CELL_RES - 2, Math.floor(fx)), iz = Math.min(CELL_RES - 2, Math.floor(fz));
  const tx = fx - ix, tz = fz - iz;
  const h = (i: number, j: number) => heights[j * CELL_RES + i];
  return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
}

/** The sim's colliders for a cell: its heightfield plus a primitive per placed prop that has one. */
export function cellColliders(data: CellData, heights: Float32Array, manifest: Pick<RegionManifest, 'props'>): CellColliders {
  const shapes: CellColliders['shapes'] = [];
  for (const [key, packed] of Object.entries(data.props)) {
    const kind = manifest.props[key];
    if (!kind || kind.collider.kind === 'none') continue;
    for (let i = 0; i + 5 <= packed.length; i += 5) {
      const [x, y, z, yaw, s] = packed.slice(i, i + 5);
      const c = kind.collider;
      if (c.kind === 'cylinder') shapes.push({ kind: 'cylinder', pos: [x, y + (c.height * s) / 2, z], radius: c.radius * s, height: c.height * s });
      else shapes.push({ kind: 'box', pos: [x, y + c.half[1] * s, z], half: [c.half[0] * s, c.half[1] * s, c.half[2] * s], yaw });
    }
  }
  return { cx: data.cx, cz: data.cz, heights, shapes };
}
