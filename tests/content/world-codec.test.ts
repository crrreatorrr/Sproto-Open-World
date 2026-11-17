import { describe, expect, it } from 'vitest';
import { CELL_BIN_BYTES, decodeCellBin, encodeCellBin, sampleHeight } from '../../src/content/world/codec';
import { CELL_RES } from '../../src/content/world/format';

/** The cell .bin codec (plan §3.1). */
describe('world cell codec', () => {
  const N = CELL_RES * CELL_RES;

  for (const range of [{ min: -3, max: 40 }, { min: -50, max: 250 }]) {
    it(`round-trips heights within 1 cm over [${range.min}, ${range.max}] and keeps the splat exactly`, () => {
      const heights = new Float32Array(N);
      const splat = new Uint8Array(N * 4);
      for (let i = 0; i < N; i++) {
        // Sweep the whole range, both ends included, with irregular steps.
        heights[i] = range.min + ((i * 7919) % N) / (N - 1) * (range.max - range.min);
        for (let c = 0; c < 4; c++) splat[i * 4 + c] = (i * 31 + c * 67) & 255;
      }
      heights[0] = range.min;
      heights[N - 1] = range.max;
      const bin = encodeCellBin(heights, splat, range);
      expect(bin.byteLength).toBe(CELL_BIN_BYTES);
      const out = decodeCellBin(bin, range);
      let worst = 0;
      for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(out.heights[i] - heights[i]));
      expect(worst).toBeLessThan(0.01);
      expect(Array.from(out.splat)).toEqual(Array.from(splat));
    });
  }

  it('clamps heights outside the range instead of wrapping', () => {
    const range = { min: 0, max: 10 };
    const heights = new Float32Array(N).fill(5);
    heights[1] = -4;
    heights[2] = 14;
    const out = decodeCellBin(encodeCellBin(heights, new Uint8Array(N * 4), range), range).heights;
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(10, 5);
  });

  it('decodes from an ArrayBuffer and rejects a wrong size', () => {
    const range = { min: 0, max: 1 };
    const bin = encodeCellBin(new Float32Array(N), new Uint8Array(N * 4), range);
    expect(decodeCellBin(bin.buffer.slice(0) as ArrayBuffer, range).heights.length).toBe(N);
    expect(() => decodeCellBin(new Uint8Array(10), range)).toThrow();
  });

  it('sampleHeight interpolates the grid bilinearly in world coordinates', () => {
    const heights = new Float32Array(N);
    for (let iz = 0; iz < CELL_RES; iz++) for (let ix = 0; ix < CELL_RES; ix++) heights[iz * CELL_RES + ix] = 0.5 * ix + 0.25 * iz;
    // Cell (2, 3) covers x ∈ [128, 192), z ∈ [192, 256).
    expect(sampleHeight(heights, 2, 3, 128 + 10.5, 192 + 20.25)).toBeCloseTo(0.5 * 10.5 + 0.25 * 20.25, 5);
    expect(sampleHeight(heights, 2, 3, 192, 256)).toBeCloseTo(0.5 * 64 + 0.25 * 64, 5);
  });
});
