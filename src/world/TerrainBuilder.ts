import type { TerrainJob, TerrainResult } from '../workers/terrain.worker';
import type { TerrainMeshData } from './terrainMesh';

export interface BuiltTerrain {
  heights: Float32Array;
  mesh: TerrainMeshData;
}

/** Workers decoding and meshing cells: two, so a full-res build doesn't hold up the next one. */
const WORKERS = 2;

/**
 * The main thread's side of terrain.worker.ts: round-robins jobs over a couple of workers and
 * resolves each with its transferred arrays. The .bin is copied before it is sent, because the
 * streamer keeps the original to rebuild the cell at another resolution later.
 */
export class TerrainBuilder {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, { resolve(r: BuiltTerrain): void; reject(e: Error): void }>();
  private nextId = 1;
  private turn = 0;

  constructor() {
    for (let i = 0; i < WORKERS; i++) {
      const w = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<TerrainResult>) => this.done(e.data);
      w.onerror = (e) => {
        // A broken worker fails every job it holds; the streamer retries them as fetch failures.
        e.preventDefault();
        for (const [id, p] of this.pending) {
          this.pending.delete(id);
          p.reject(new Error(`terrain worker: ${e.message}`));
        }
      };
      this.workers.push(w);
    }
  }

  /** Jobs sent and not back yet. */
  get inFlight(): number {
    return this.pending.size;
  }

  build(bin: ArrayBuffer, range: { min: number; max: number }, cx: number, cz: number, res: 64 | 32 | 16): Promise<BuiltTerrain> {
    const id = this.nextId++;
    const copy = bin.slice(0);
    const job: TerrainJob = { id, bin: copy, range, cx, cz, res };
    return new Promise<BuiltTerrain>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.workers[this.turn++ % this.workers.length].postMessage(job, [copy]);
    });
  }

  private done(r: TerrainResult): void {
    const p = this.pending.get(r.id);
    if (!p) return;
    this.pending.delete(r.id);
    if (r.ok) p.resolve({ heights: r.heights, mesh: r.mesh });
    else p.reject(new Error(r.error));
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    for (const p of this.pending.values()) p.reject(new Error('terrain builder disposed'));
    this.pending.clear();
  }
}
