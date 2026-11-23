/**
 * Spreads GPU uploads over frames (plan §3.3): each frame runs queued geometry and texture jobs
 * until a count cap or a byte cap is reached, so crossing into a ring of new cells, or a camp of
 * enemies coming into view, never lands as one long frame. Jobs run in the order queued within
 * each kind, and at least one of each kind runs every frame, however large it is. `run()` is called
 * once per rendered frame before drawing.
 */
export const GEOMETRIES_PER_FRAME = 4;
export const TEXTURES_PER_FRAME = 2;
/** A full-resolution terrain cell is about 180 KiB; four of them fit. */
export const GEOMETRY_BYTES_PER_FRAME = 1_500_000;
/** One 1024² RGBA texture with its mips is about 5.6 MiB; a larger one gets a frame to itself. */
export const TEXTURE_BYTES_PER_FRAME = 6_000_000;

interface Job {
  run: () => void;
  bytes: number;
}

export class UploadBudget {
  private readonly geometries: Job[] = [];
  private readonly textures: Job[] = [];
  /** Totals since start (debug overlay). */
  geometriesDone = 0;
  texturesDone = 0;
  bytesDone = 0;

  /** Queue a geometry upload of about `bytes` bytes (0: small). */
  geometry(job: () => void, bytes = 0): void {
    this.geometries.push({ run: job, bytes });
  }

  /** Queue a texture upload of about `bytes` bytes (0: small). */
  texture(job: () => void, bytes = 0): void {
    this.textures.push({ run: job, bytes });
  }

  get pending(): number {
    return this.geometries.length + this.textures.length;
  }

  run(): void {
    this.geometriesDone += this.spend(this.geometries, GEOMETRIES_PER_FRAME, GEOMETRY_BYTES_PER_FRAME);
    this.texturesDone += this.spend(this.textures, TEXTURES_PER_FRAME, TEXTURE_BYTES_PER_FRAME);
  }

  private spend(queue: Job[], maxJobs: number, maxBytes: number): number {
    let done = 0, bytes = 0;
    while (queue.length && done < maxJobs) {
      const next = queue[0];
      // The first job always runs; a later one waits if it would pass the byte cap.
      if (done > 0 && bytes + next.bytes > maxBytes) break;
      queue.shift();
      bytes += next.bytes;
      done++;
      try {
        next.run();
      } catch (err) {
        console.warn('[uploads] a GPU upload failed', err);
      }
    }
    this.bytesDone += bytes;
    return done;
  }

  clear(): void {
    this.geometries.length = 0;
    this.textures.length = 0;
  }
}

/** The bytes a texture takes on the GPU, mips included (RGBA8; a guess for anything else). */
export function textureBytes(tex: { image?: unknown }): number {
  const img = tex.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0, h = img?.height ?? 0;
  return Math.round(w * h * 4 * 1.34);
}
