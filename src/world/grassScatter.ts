import { CELL_RES, CELL_SIZE, type CellData, type PropKind } from '../content/world/format';

/**
 * Where a cell's grass tufts stand. Pure (no three), and the same every time a cell comes back: the
 * random stream is seeded by the cell's coordinates.
 *
 * Candidates are thrown at the cell in order, and each keeps its candidate index as a rank in [0, 1).
 * The draw distance thins the grass by rank (`grassDensity`), so a far cell draws only the head of
 * its list and nothing pops: the shader hides exactly the tufts the instance count leaves out.
 */

/** Tufts tried per cell (about one per square metre where the ground is all grass). */
export const GRASS_CANDIDATES = 3600;
/** Full density inside this distance from the player (m), none beyond `GRASS_FAR`. */
export const GRASS_NEAR = 14;
export const GRASS_FAR = 44;

/** Splat weight of the grass layer below which nothing grows, and above which everything does. */
const WEIGHT_MIN = 0.42;
const WEIGHT_FULL = 0.78;
/** Steeper ground than this stays bare (rise over run). */
const MAX_SLOPE = 0.85;
const SCALE_MIN = 0.42;
const SCALE_MAX = 0.82;
/** Clear ground around a prop without a collider, and around a named mark (m). */
const PROP_CLEAR = 0.5;
const MARK_CLEAR = 1.6;
/** Tufts sit this far into the ground, so a slope never shows their roots (m). */
const SINK = 0.04;

/** The share of tufts drawn at a distance: 1 near the player, easing to 0 at GRASS_FAR. */
export function grassDensity(dist: number): number {
  const t = Math.min(1, Math.max(0, (dist - GRASS_NEAR) / (GRASS_FAR - GRASS_NEAR)));
  return 1 - t * t * (3 - 2 * t);
}

export interface GrassResult {
  count: number;
  minY: number;
  maxY: number;
}

/** A small seeded generator (mulberry32). */
function cellRandom(cx: number, cz: number): () => number {
  let s = (Math.imul(cx + 1013, 73856093) ^ Math.imul(cz + 2039, 19349663)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 1 m squares of a cell that props and marks keep clear. */
function occupancy(json: CellData, kinds: Readonly<Record<string, PropKind>>, cx: number, cz: number): Uint8Array {
  const taken = new Uint8Array(CELL_SIZE * CELL_SIZE);
  const ox = cx * CELL_SIZE, oz = cz * CELL_SIZE;
  const stamp = (x: number, z: number, r: number) => {
    const lx = x - ox, lz = z - oz;
    const x0 = Math.max(0, Math.floor(lx - r)), x1 = Math.min(CELL_SIZE - 1, Math.ceil(lx + r));
    const z0 = Math.max(0, Math.floor(lz - r)), z1 = Math.min(CELL_SIZE - 1, Math.ceil(lz + r));
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        if ((i + 0.5 - lx) ** 2 + (j + 0.5 - lz) ** 2 <= r * r) taken[j * CELL_SIZE + i] = 1;
      }
    }
  };
  for (const [key, packed] of Object.entries(json.props)) {
    const c = kinds[key]?.collider;
    const base = c?.kind === 'cylinder' ? c.radius : c?.kind === 'box' ? Math.hypot(c.half[0], c.half[2]) : PROP_CLEAR;
    for (let p = 0; p + 4 < packed.length; p += 5) stamp(packed[p], packed[p + 2], base * packed[p + 4] + 0.3);
  }
  for (const m of json.marks ?? []) stamp(m.pos[0], m.pos[2], MARK_CLEAR);
  return taken;
}

/**
 * Fill `place` (x, y, z, rank per tuft) and `shape` (yaw, scale per tuft) for one cell, in rank
 * order. `heights` and `splat` are the cell's decoded 65 × 65 grids; `channel` is the grass layer.
 */
export function scatterGrass(
  place: Float32Array,
  shape: Float32Array,
  heights: Float32Array,
  splat: Uint8Array,
  channel: number,
  json: CellData,
  kinds: Readonly<Record<string, PropKind>>,
  cx: number,
  cz: number,
): GrassResult {
  const random = cellRandom(cx, cz);
  const taken = occupancy(json, kinds, cx, cz);
  const ox = cx * CELL_SIZE, oz = cz * CELL_SIZE;
  const h = (i: number, j: number) => heights[j * CELL_RES + i];
  let count = 0;
  let minY = Infinity, maxY = -Infinity;
  for (let n = 0; n < GRASS_CANDIDATES; n++) {
    // Every candidate draws the same numbers, kept or not, so its place never depends on the others.
    const lx = random() * CELL_SIZE, lz = random() * CELL_SIZE, pick = random(), yaw = random() * Math.PI * 2, size = random();
    const i = Math.floor(lx), j = Math.floor(lz);
    if (taken[j * CELL_SIZE + i]) continue;
    const near = (Math.round(lz) * CELL_RES + Math.round(lx)) * 4;
    const weight = splat[near + channel] / 255;
    if (pick >= (weight - WEIGHT_MIN) / (WEIGHT_FULL - WEIGHT_MIN)) continue;
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    if (Math.max(Math.abs(b - a), Math.abs(d - c), Math.abs(c - a), Math.abs(d - b)) > MAX_SLOPE) continue;
    const fx = lx - i, fz = lz - j;
    const y = a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz - SINK;
    place[count * 4] = ox + lx;
    place[count * 4 + 1] = y;
    place[count * 4 + 2] = oz + lz;
    place[count * 4 + 3] = n / GRASS_CANDIDATES;
    shape[count * 2] = yaw;
    shape[count * 2 + 1] = SCALE_MIN + (SCALE_MAX - SCALE_MIN) * size;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    count++;
  }
  return { count, minY, maxY };
}

/** How many of the rank-ordered tufts can show at this density (a binary search on the ranks). */
export function grassDrawCount(place: Float32Array, count: number, density: number): number {
  let lo = 0, hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (place[mid * 4 + 3] < density) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
