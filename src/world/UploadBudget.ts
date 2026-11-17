/**
 * Spreads GPU uploads over frames (plan §3.3): at most 4 new geometries and 2 textures per frame,
 * so crossing into a ring of new cells never lands as one long frame. Jobs run in the order queued
 * within each kind; `run()` is called once per rendered frame before drawing.
 */
export const GEOMETRIES_PER_FRAME = 4;
export const TEXTURES_PER_FRAME = 2;

export class UploadBudget {
  private readonly geometries: (() => void)[] = [];
  private readonly textures: (() => void)[] = [];
  /** Totals since start (debug overlay). */
  geometriesDone = 0;
  texturesDone = 0;

  geometry(job: () => void): void {
    this.geometries.push(job);
  }

  texture(job: () => void): void {
    this.textures.push(job);
  }

  get pending(): number {
    return this.geometries.length + this.textures.length;
  }

  run(): void {
    for (let i = 0; i < GEOMETRIES_PER_FRAME && this.geometries.length; i++) {
      this.geometries.shift()!();
      this.geometriesDone++;
    }
    for (let i = 0; i < TEXTURES_PER_FRAME && this.textures.length; i++) {
      this.textures.shift()!();
      this.texturesDone++;
    }
  }

  clear(): void {
    this.geometries.length = 0;
    this.textures.length = 0;
  }
}
