import { decodeCellBin } from '../content/world/codec';
import { buildTerrainMesh, type TerrainMeshData } from '../world/terrainMesh';

/**
 * Terrain decode and mesh build off the main thread (plan §3.3). In: a cell's .bin and the
 * resolution to build. Out: the decoded heights (for the sim's colliders) and the mesh's typed
 * arrays, all transferred, not copied, so the main thread only wraps them.
 */
export interface TerrainJob {
  id: number;
  bin: ArrayBuffer;
  range: { min: number; max: number };
  cx: number;
  cz: number;
  res: 64 | 32 | 16;
}

export type TerrainResult =
  | { id: number; ok: true; heights: Float32Array; mesh: TerrainMeshData }
  | { id: number; ok: false; error: string };

/** The worker scope, typed by hand: the project's lib is DOM, and adding WebWorker conflicts with it. */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<TerrainJob>) => void) | null;
  postMessage(msg: TerrainResult, transfer?: Transferable[]): void;
};

ctx.onmessage = (e: MessageEvent<TerrainJob>) => {
  const job = e.data;
  try {
    const { heights, splat } = decodeCellBin(job.bin, job.range);
    const mesh = buildTerrainMesh(heights, splat, job.cx, job.cz, job.res);
    const out: TerrainResult = { id: job.id, ok: true, heights, mesh };
    ctx.postMessage(out, [heights.buffer, mesh.position.buffer, mesh.normal.buffer, mesh.uv.buffer, mesh.splat.buffer, mesh.index.buffer]);
  } catch (err) {
    const out: TerrainResult = { id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    ctx.postMessage(out);
  }
};
