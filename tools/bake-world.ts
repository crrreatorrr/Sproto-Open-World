/**
 * `npm run bake:world -- <region> [--check] [--out <dir>]` (plan §3.1, §3.6): reads
 * world-src/<region>/{terrain,placements}.json and writes public/world/<region>/:
 *
 *   region.json        RegionManifest (src/content/world/format.ts)
 *   cells/c_X_Z.bin    65×65 Uint16 heights + 65×65 RGBA8 splat (encodeCellBin)
 *   cells/c_X_Z.json   CellData: packed prop placements and marks
 *   horizon.glb        8 m terrain grid of the whole region, vertex-coloured by splat, plus
 *                      box/cylinder impostors for landmarks
 *
 * Deterministic: the same sources and prop GLBs give the same bytes (seeded integer PRNG and value
 * noise, only + − × ÷ and sqrt in the terrain maths, sorted keys, no clock).
 * `--check` bakes in memory and fails if the files on disk differ. `--out` writes somewhere else
 * (the tests bake into a temp dir).
 */
import { Document, Logger, NodeIO, getBounds, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import { encodeCellBin, decodeCellBin, sampleHeight } from '../src/content/world/codec';
import { CELL_RES, CELL_SIZE, type CellData, type CellEntry, type PropCollider, type PropKind, type RegionManifest, type WaterBody } from '../src/content/world/format';

const ROOT = path.resolve(import.meta.dirname, '..');
const CELL_BYTES_MAX = 120 * 1000;
const REGION_BYTES_MAX = 30 * 1024 * 1024;
/** Cells per side of the window capacities are counted over: the streamer's hysteresis ring keeps up to 7 × 7 loaded. */
const CAPACITY_WINDOW = 7;
const HORIZON_STEP = 8;

// ------------------------------------------------------------------ source types

type Shape = { rect: [number, number, number, number] } | { circle: [number, number, number] };
interface NoiseCfg { amplitude: number; scale: number; octaves: number; persistence: number; lacunarity: number }
interface TerrainSrc {
  id: string;
  version: number;
  seed: number;
  origin: [number, number];
  size: [number, number];
  base: { height: number; noise: NoiseCfg };
  noise: ({ id: string; shape: Shape; falloff: number } & NoiseCfg)[];
  raise: { id: string; shape: { circle: [number, number, number] }; plateau: number; height: number }[];
  flatten: { id: string; shape: Shape; falloff: number; height: number | 'auto'; strength: number }[];
  paths: { id: string; points: [number, number][]; halfWidth: number; flatten: number; falloff: number; strength: number }[];
  carve: { id: string; points: [number, number, number][]; bedHalfWidth: number; bankWidth: number }[];
  bowl: { id: string; center: [number, number]; flatRadius: number; radius: number; depth: number }[];
  border: { cliffWidth: number; cliffHeight: number; softWidth: number; softHeight: number };
  /** When set, cells encode into this range instead of the measured one. Heights outside it are an error. */
  heightRange?: { min: number; max: number };
  /** Water with an absolute surface: the bed is carved under it and the renderer draws the surface. */
  rivers?: RiverSrc[];
  pools?: PoolSrc[];
  /** Fog band, when the region is not in the overworld (which sets its own). */
  fog?: { near: number; far: number; farPlane: number };
  splat: {
    pathFade: number;
    rockSlope: [number, number];
    zones: ({ layer: 'dirt' | 'rock'; weight: number; patch?: number } & ({ shape: Shape; falloff?: number } | { spline: string; within: number; fade: number }))[];
  };
}
/** A river: points [x, z, surfaceY]. Bed surfaceY - depth (shallower toward the edge), banks rise to at least surfaceY + 0.4. */
interface RiverSrc { id: string; points: [number, number, number][]; halfWidth: number; bankWidth: number; depth: number; flow?: number }
/** A still pool with a flat surface. */
interface PoolSrc { id: string; center: [number, number]; radius: number; bank: number; depth: number; surface: number }
/** world-src/overworld.json: what the walkable regions share (see its _doc). */
interface OverworldSrc {
  regions: string[];
  heightRange: { min: number; max: number };
  fog: { near: number; far: number; farPlane: number };
  seam: {
    band: number;
    noise: NoiseCfg;
    grid: { origin: [number, number]; step: number; heights: number[][] };
    closed: { edge: 'x' | 'z'; at: number; from: number; to: number }[];
  };
  rivers: RiverSrc[];
  pools: PoolSrc[];
  paths: { id: string; points: [number, number][]; halfWidth: number }[];
}
/** The overworld as one region sees it: the shared data and the cells of every other region. */
interface Overworld { src: OverworldSrc; others: Set<string>; seed: number }

interface KindSrc {
  model: string;
  collider: PropCollider;
  footprint: number;
  landmark?: boolean;
  impostor?: { shape: 'box' | 'cylinder'; color: [number, number, number] };
}
interface PlaceSrc { _?: string; key: string; at: [number, number]; yaw: number; scale: number; ground?: 'center' | 'min' | 'max'; groundRadius?: number; dy?: number }
interface ScatterSrc {
  key: string;
  in?: string[];
  near?: [string, number, number];
  perHectare: number;
  scale: [number, number];
  maxSlope: number;
  clearPaths: number;
  minBorder: number;
  avoid?: string[];
  avoidSplines?: [string, number][];
  yawJitter?: number;
  dy?: number;
}
interface PlacementsSrc {
  seed: number;
  kinds: Record<string, KindSrc>;
  place: PlaceSrc[];
  lines: { key: string; from: [number, number]; to: [number, number]; step: number; yaw: number; scale?: number }[];
  zones: Record<string, Shape & { falloff?: number }>;
  scatter: ScatterSrc[];
  marks: { id: string; kind: string; at: [number, number]; yaw?: number; clear?: number }[];
}

// ------------------------------------------------------------------ deterministic maths

const DEG = Math.PI / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise in [-1, 1], smoothstep-interpolated. */
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (lerp(lerp(a, b, ux), lerp(c, d, ux), uz)) * 2 - 1;
}

function fbm(x: number, z: number, n: NoiseCfg, seed: number): number {
  let sum = 0, amp = 1, freq = 1 / n.scale, norm = 0;
  for (let o = 0; o < n.octaves; o++) {
    sum += valueNoise(x * freq, z * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= n.persistence;
    freq *= n.lacunarity;
  }
  return (sum / norm) * n.amplitude;
}

/** mulberry32: a small seeded PRNG in [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1 inside the shape, smoothstep down to 0 over `falloff` metres outside. */
function shapeMask(s: Shape, falloff: number, x: number, z: number): number {
  let d: number;
  if ('rect' in s) {
    const [x0, z0, x1, z1] = s.rect;
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    d = Math.sqrt(dx * dx + dz * dz);
  } else {
    const [cx, cz, r] = s.circle;
    d = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz)) - r;
  }
  if (d <= 0) return 1;
  if (falloff <= 0) return 0;
  return smooth(1 - d / falloff);
}
const shapeCentre = (s: Shape): [number, number] => ('rect' in s ? [(s.rect[0] + s.rect[2]) / 2, (s.rect[1] + s.rect[3]) / 2] : [s.circle[0], s.circle[1]]);

// ------------------------------------------------------------------ splines

/** A polyline with a value per vertex (depth for carves, height for paths). */
interface Polyline { xs: number[]; zs: number[]; vs: number[]; minX: number; maxX: number; minZ: number; maxZ: number }

/** Uniform Catmull-Rom through the control points, 8 samples per span; the third value is linear. */
function catmull(points: number[][]): Polyline {
  const xs: number[] = [], zs: number[] = [], vs: number[] = [];
  const P = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  const SUB = 8;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      xs.push(cr(p0[0], p1[0], p2[0], p3[0]));
      zs.push(cr(p0[1], p1[1], p2[1], p3[1]));
      vs.push(lerp(p1[2] ?? 0, p2[2] ?? 0, t));
    }
  }
  const last = points[points.length - 1];
  xs.push(last[0]);
  zs.push(last[1]);
  vs.push(last[2] ?? 0);
  return { xs, zs, vs, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Distance to the polyline and the interpolated per-vertex value at the nearest point. */
function nearest(pl: Polyline, x: number, z: number, maxDist: number): { d: number; v: number } {
  if (x < pl.minX - maxDist || x > pl.maxX + maxDist || z < pl.minZ - maxDist || z > pl.maxZ + maxDist) return { d: Infinity, v: 0 };
  let best = Infinity, bv = 0;
  for (let i = 0; i < pl.xs.length - 1; i++) {
    const ax = pl.xs[i], az = pl.zs[i], bx = pl.xs[i + 1], bz = pl.zs[i + 1];
    const ex = bx - ax, ez = bz - az;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? clamp01(((x - ax) * ex + (z - az) * ez) / len2) : 0;
    const px = ax + ex * t - x, pz = az + ez * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < best) {
      best = d2;
      bv = lerp(pl.vs[i], pl.vs[i + 1], t);
    }
  }
  return { d: Math.sqrt(best), v: bv };
}

// ------------------------------------------------------------------ terrain

interface Terrain {
  /** Global sample grid, (W+1) × (D+1) at 1 m: index = z · (W+1) + x, relative to the region origin. */
  heights: Float64Array;
  splat: Uint8Array;
  W: number;
  D: number;
  paths: Map<string, { pl: Polyline; halfWidth: number }>;
  splines: Map<string, Polyline>;
  /** Distance (m) from a world point to the nearest region edge that is a wall (no open seam), or Infinity. */
  wallDist: (x: number, z: number) => number;
  water: WaterBody[];
}

/** 1 at the ends of a closed seam span and inside it, fading to 0 over TAPER metres along the edge. */
const SEAM_TAPER = 24;

function buildTerrain(src: TerrainSrc, ow: Overworld | null = null): Terrain {
  const W = src.size[0] * CELL_SIZE, D = src.size[1] * CELL_SIZE;
  const ox = src.origin[0] * CELL_SIZE, oz = src.origin[1] * CELL_SIZE;
  const seed = src.seed;

  const carves = src.carve.map((c) => ({ c, pl: catmull(c.points) }));
  const splines = new Map<string, Polyline>(carves.map(({ c, pl }) => [c.id, pl]));
  const pathLines = src.paths.map((p) => ({ p, pl: catmull(p.points) }));
  const localRivers = (src.rivers ?? []).map((r) => ({ r, pl: catmull(r.points) }));
  const sharedRivers = (ow?.src.rivers ?? []).map((r) => ({ r, pl: catmull(r.points) }));
  const localPools = src.pools ?? [];
  const sharedPools = ow?.src.pools ?? [];
  const sharedPaths = (ow?.src.paths ?? []).map((p) => ({ p, pl: catmull(p.points.map(([x, z]) => [x, z, 0])) }));
  for (const { r, pl } of [...localRivers, ...sharedRivers]) splines.set(r.id, pl);

  /** Carve one river into h and return the new height and its bank paint weight. */
  const applyRiver = (r: RiverSrc, pl: Polyline, x: number, z: number, h: number): [number, number, number] => {
    const reach = r.halfWidth + r.bankWidth;
    const n = nearest(pl, x, z, reach);
    if (n.d >= reach) return [h, 0, 0];
    const surface = n.v;
    if (n.d < r.halfWidth) {
      const t = n.d / r.halfWidth;
      return [Math.min(h, surface - r.depth * (1 - 0.5 * t * t)), 0, 1];
    }
    const t = smooth((n.d - r.halfWidth) / r.bankWidth);
    return [lerp(surface - r.depth * 0.5, Math.max(h, surface + 0.4), t), 1 - t, 0];
  };
  const applyPool = (p: PoolSrc, x: number, z: number, h: number): [number, number, number] => {
    const d = Math.sqrt((x - p.center[0]) * (x - p.center[0]) + (z - p.center[1]) * (z - p.center[1]));
    if (d >= p.radius + p.bank) return [h, 0, 0];
    if (d < p.radius) {
      const t = d / p.radius;
      return [Math.min(h, p.surface - p.depth * (1 - 0.7 * t * t)), 0, 1];
    }
    const t = smooth((d - p.radius) / p.bank);
    return [lerp(p.surface - p.depth * 0.3, Math.max(h, p.surface + 0.4), t), 1 - t, 0];
  };

  // Seams: for each of the four edges, whether another overworld region lies across it here, and how closed it is.
  const x0m = ox, z0m = oz, x1m = ox + W, z1m = oz + D;
  const hasCell = (x: number, z: number) => ow !== null && ow.others.has(`${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`);
  const closedness = (axis: 'x' | 'z', at: number, along: number): number => {
    let c = 0;
    for (const span of ow?.src.seam.closed ?? []) {
      if (span.edge !== axis || span.at !== at) continue;
      const out = Math.max(span.from - along, 0, along - span.to);
      c = Math.max(c, out <= 0 ? 1 : smooth(1 - out / SEAM_TAPER));
    }
    return c;
  };
  /** Per edge: distance to it, whether a neighbour is across (open seam), and the cliff factor there. */
  const edges = (x: number, z: number) => {
    const zc = Math.min(Math.max(z, z0m + 0.5), z1m - 0.5), xc = Math.min(Math.max(x, x0m + 0.5), x1m - 0.5);
    const list: { e: number; seam: boolean; cliff: number }[] = [];
    const add = (e: number, across: [number, number], axis: 'x' | 'z', at: number, along: number) => {
      const seam = hasCell(across[0], across[1]);
      list.push({ e, seam, cliff: seam ? closedness(axis, at, along) : 1 });
    };
    add(x - x0m, [x0m - 0.5, zc], 'x', x0m, z);
    add(x1m - x, [x1m + 0.5, zc], 'x', x1m, z);
    add(z - z0m, [xc, z0m - 0.5], 'z', z0m, x);
    add(z1m - z, [xc, z1m + 0.5], 'z', z1m, x);
    return list;
  };
  const wallDist = (x: number, z: number) => {
    let best = Infinity;
    for (const ed of edges(x, z)) if (!ed.seam || ed.cliff > 0.5) best = Math.min(best, ed.e);
    return best;
  };
  const seamCfg = ow?.src.seam;
  /** The height both sides of a seam agree on: the shared grid, bilinear, plus shared noise. */
  const seamHeight = (x: number, z: number): number => {
    const g = seamCfg!.grid;
    const rows = g.heights.length, cols = g.heights[0].length;
    const fx = Math.min(Math.max((x - g.origin[0]) / g.step, 0), cols - 1), fz = Math.min(Math.max((z - g.origin[1]) / g.step, 0), rows - 1);
    const ix = Math.min(Math.floor(fx), cols - 2), iz = Math.min(Math.floor(fz), rows - 2);
    const tx = smooth(fx - ix), tz = smooth(fz - iz);
    const a = g.heights[iz][ix], b = g.heights[iz][ix + 1], c = g.heights[iz + 1][ix], d = g.heights[iz + 1][ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz) + fbm(x, z, seamCfg!.noise, ow!.seed);
  };

  /** Phases 1–3: base fBm, noise stamps, raises. */
  const natural = (x: number, z: number): number => {
    let h = src.base.height + fbm(x, z, src.base.noise, seed);
    src.noise.forEach((n, i) => {
      const m = shapeMask(n.shape, n.falloff, x, z);
      if (m > 0) h += m * fbm(x, z, n, seed + 7919 * (i + 1));
    });
    for (const r of src.raise) {
      const [cx, cz, R] = r.shape.circle;
      const d = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
      if (d < R) h += r.height * smooth((R - d) / Math.max(1e-6, R - r.plateau));
    }
    return h;
  };
  /** Phase 4: flattens in file order ('auto' takes the height at the centre before this phase). */
  const flatTargets = src.flatten.map((f) => (f.height === 'auto' ? natural(...shapeCentre(f.shape)) : f.height));
  const flattened = (x: number, z: number): number => {
    let h = natural(x, z);
    src.flatten.forEach((f, i) => {
      const m = shapeMask(f.shape, f.falloff, x, z) * f.strength;
      if (m > 0) h = lerp(h, flatTargets[i], m);
    });
    return h;
  };
  // Path centre heights come from the flattened terrain, so a path keeps its run but loses cross-slope.
  for (const { pl } of pathLines) for (let i = 0; i < pl.xs.length; i++) pl.vs[i] = flattened(pl.xs[i], pl.zs[i]);

  const heights = new Float64Array((W + 1) * (D + 1));
  const pathW = new Float64Array((W + 1) * (D + 1));
  const seamWs = new Float32Array((W + 1) * (D + 1));
  const bankW = new Float32Array((W + 1) * (D + 1));
  const bedW = new Float32Array((W + 1) * (D + 1));
  const b = src.border;
  for (let iz = 0; iz <= D; iz++) {
    for (let ix = 0; ix <= W; ix++) {
      const x = ox + ix, z = oz + iz;
      let h = flattened(x, z);
      // Phase 5: paths, slightly flattened toward their centre line, and their paint weight.
      let pw = 0;
      for (const { p, pl } of pathLines) {
        const reach = p.flatten + p.falloff;
        const n = nearest(pl, x, z, reach);
        if (n.d >= reach) continue;
        const m = (n.d <= p.flatten ? 1 : smooth(1 - (n.d - p.flatten) / p.falloff)) * p.strength;
        h = lerp(h, n.v, m);
        pw = Math.max(pw, n.d <= p.halfWidth ? 1 : smooth(1 - (n.d - p.halfWidth) / src.splat.pathFade));
      }
      // Phase 6: carves and bowls; the deepest one wins where they overlap.
      let lower = 0;
      for (const { c, pl } of carves) {
        const reach = c.bedHalfWidth + c.bankWidth;
        const n = nearest(pl, x, z, reach);
        if (n.d >= reach) continue;
        const prof = n.d <= c.bedHalfWidth ? 1 : smooth(1 - (n.d - c.bedHalfWidth) / c.bankWidth);
        lower = Math.max(lower, n.v * prof);
      }
      for (const bw of src.bowl) {
        const d = Math.sqrt((x - bw.center[0]) * (x - bw.center[0]) + (z - bw.center[1]) * (z - bw.center[1]));
        if (d >= bw.radius) continue;
        const prof = d <= bw.flatRadius ? 1 : smooth(1 - (d - bw.flatRadius) / (bw.radius - bw.flatRadius));
        lower = Math.max(lower, bw.depth * prof);
      }
      h -= lower;
      // Phase 6b: this region's own rivers and pools (absolute surfaces).
      let bank = 0, bed = 0;
      for (const { r, pl } of localRivers) {
        const [nh, bk, bd] = applyRiver(r, pl, x, z, h);
        h = nh;
        bank = Math.max(bank, bk);
        bed = Math.max(bed, bd);
      }
      for (const p of localPools) {
        const [nh, bk, bd] = applyPool(p, x, z, h);
        h = nh;
        bank = Math.max(bank, bk);
        bed = Math.max(bed, bd);
      }
      // Phase 7: seams and the border. Toward an open seam the terrain blends into the shared seam
      // height; a wall edge (no neighbour, or a closed span) adds the soft rise and the cliff.
      const eds = edges(x, z);
      let seamW = 0;
      // On a closed span the blend only reaches across the cliff itself, so the ground behind it stays this region's.
      if (ow) {
        for (const ed of eds) {
          if (!ed.seam) continue;
          const band = lerp(seamCfg!.band, b.cliffWidth, ed.cliff);
          if (ed.e < band) seamW = Math.max(seamW, smooth(1 - ed.e / band));
        }
      }
      if (seamW > 0) {
        h = lerp(h, seamHeight(x, z), seamW);
        pw *= 1 - seamW;
        bank *= 1 - seamW;
        bed *= 1 - seamW;
      }
      // Shared roads only paint (their line is the same on both sides of a seam).
      for (const { p, pl } of sharedPaths) {
        const n = nearest(pl, x, z, p.halfWidth + src.splat.pathFade);
        if (n.d < p.halfWidth + src.splat.pathFade) pw = Math.max(pw, n.d <= p.halfWidth ? 1 : smooth(1 - (n.d - p.halfWidth) / src.splat.pathFade));
      }
      for (const { r, pl } of sharedRivers) {
        const [nh, bk, bd] = applyRiver(r, pl, x, z, h);
        h = nh;
        bank = Math.max(bank, bk);
        bed = Math.max(bed, bd);
      }
      for (const p of sharedPools) {
        const [nh, bk, bd] = applyPool(p, x, z, h);
        h = nh;
        bank = Math.max(bank, bk);
        bed = Math.max(bed, bd);
      }
      let rise = 0;
      for (const ed of eds) {
        if (ed.cliff <= 0 || ed.e >= b.cliffWidth + b.softWidth) continue;
        let r = b.softHeight * smooth((b.cliffWidth + b.softWidth - ed.e) / b.softWidth);
        if (ed.e < b.cliffWidth) r += (b.cliffHeight * (b.cliffWidth - ed.e)) / b.cliffWidth;
        rise = Math.max(rise, r * ed.cliff);
      }
      h += rise;
      seamWs[iz * (W + 1) + ix] = seamW;
      bankW[iz * (W + 1) + ix] = bank;
      bedW[iz * (W + 1) + ix] = bed;
      heights[iz * (W + 1) + ix] = h;
      pathW[iz * (W + 1) + ix] = pw;
    }
  }

  // Splat: path over rock over dirt over grass.
  const splat = new Uint8Array((W + 1) * (D + 1) * 4);
  const [rs0, rs1] = [Math.tan(src.splat.rockSlope[0] * DEG), Math.tan(src.splat.rockSlope[1] * DEG)];
  const H = (ix: number, iz: number) => heights[Math.max(0, Math.min(D, iz)) * (W + 1) + Math.max(0, Math.min(W, ix))];
  for (let iz = 0; iz <= D; iz++) {
    for (let ix = 0; ix <= W; ix++) {
      const x = ox + ix, z = oz + iz;
      const gx = (H(ix + 1, iz) - H(ix - 1, iz)) / 2, gz = (H(ix, iz + 1) - H(ix, iz - 1)) / 2;
      const slope = Math.sqrt(gx * gx + gz * gz);
      let rock = smooth((slope - rs0) / (rs1 - rs0));
      let dirt = 0;
      src.splat.zones.forEach((zn, zi) => {
        let m: number;
        if ('shape' in zn) m = shapeMask(zn.shape, zn.falloff ?? 0, x, z);
        else {
          const pl = splines.get(zn.spline);
          if (!pl) throw new Error(`splat zone: unknown spline ${zn.spline}`);
          const n = nearest(pl, x, z, zn.within + zn.fade);
          m = n.d <= zn.within ? 1 : n.d >= zn.within + zn.fade ? 0 : smooth(1 - (n.d - zn.within) / zn.fade);
        }
        if (m <= 0) return;
        if (zn.patch) m *= smooth(0.5 + valueNoise(x / zn.patch, z / zn.patch, seed + 31 * (zi + 1)) * 0.9);
        const w = m * zn.weight * (1 - seamWs[iz * (W + 1) + ix]);
        if (zn.layer === 'rock') rock = Math.max(rock, w);
        else dirt = Math.max(dirt, w);
      });
      dirt = Math.max(dirt, bedW[iz * (W + 1) + ix]);
      const p = Math.max(pathW[iz * (W + 1) + ix], bankW[iz * (W + 1) + ix] * 0.85);
      const P = Math.round(p * 255);
      const R = Math.round((1 - p) * rock * 255);
      const Dt = Math.round((1 - p) * (1 - rock) * dirt * 255);
      const G = Math.max(0, 255 - P - R - Dt);
      const o = (iz * (W + 1) + ix) * 4;
      splat[o] = G;
      splat[o + 1] = Dt;
      splat[o + 2] = R;
      splat[o + 3] = P;
    }
  }

  // Water the renderer draws: every river or pool that reaches this region (shared ones are deduped at load by id).
  const inRegion = (minX: number, maxX: number, minZ: number, maxZ: number) => maxX >= x0m - 8 && minX <= x1m + 8 && maxZ >= z0m - 8 && minZ <= z1m + 8;
  const water: WaterBody[] = [];
  for (const { r, pl } of [...localRivers, ...sharedRivers]) {
    if (!inRegion(pl.minX - r.halfWidth, pl.maxX + r.halfWidth, pl.minZ - r.halfWidth, pl.maxZ + r.halfWidth)) continue;
    water.push({ id: r.id, kind: 'river', points: pl.xs.map((x, i) => [r2(x), r2(pl.zs[i]), r2(pl.vs[i])] as [number, number, number]), halfWidth: r2(r.halfWidth + r.bankWidth * 0.35), flow: r.flow ?? 1.2 });
  }
  for (const p of [...localPools, ...sharedPools]) {
    const R = p.radius + p.bank * 0.35;
    if (!inRegion(p.center[0] - R, p.center[0] + R, p.center[1] - R, p.center[1] + R)) continue;
    water.push({ id: p.id, kind: 'pool', center: [r2(p.center[0]), r2(p.center[1])], radius: r2(R), y: r2(p.surface) });
  }
  return { heights, splat, W, D, paths: new Map(pathLines.map(({ p, pl }) => [p.id, { pl, halfWidth: p.halfWidth }])), splines, wallDist, water };
}

// ------------------------------------------------------------------ props

interface Instance { key: string; x: number; z: number; yaw: number; scale: number; y: number }

async function readPropBounds(models: string[]): Promise<Map<string, { min: number[]; max: number[] }>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const out = new Map<string, { min: number[]; max: number[] }>();
  for (const m of models) {
    const file = path.join(ROOT, 'public/assets/models/props', `${m}.glb`);
    if (!fs.existsSync(file)) throw new Error(`prop model missing: ${file} (run npm run import:assets)`);
    const doc = await io.read(file);
    const b = getBounds(doc.getRoot().listScenes()[0]);
    out.set(m, { min: [...b.min], max: [...b.max] });
  }
  return out;
}

function placeProps(t: Terrain, terrainSrc: TerrainSrc, src: PlacementsSrc, groundAt: (x: number, z: number) => number): Instance[] {
  const ox = terrainSrc.origin[0] * CELL_SIZE, oz = terrainSrc.origin[1] * CELL_SIZE;
  const kind = (key: string) => {
    const k = src.kinds[key];
    if (!k) throw new Error(`placements: unknown prop kind ${key}`);
    return k;
  };
  const out: Instance[] = [];
  /** Keep-out discs: placed props and marks. */
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => taken.every((o) => (o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) >= (o.r + r) * (o.r + r));
  const ground = (x: number, z: number, mode: 'center' | 'min' | 'max', r: number) => {
    const c = groundAt(x, z);
    if (mode === 'center' || r <= 0) return c;
    const s = [c, groundAt(x + r, z), groundAt(x - r, z), groundAt(x, z + r), groundAt(x, z - r)];
    return mode === 'min' ? Math.min(...s) : Math.max(...s);
  };
  const push = (key: string, x: number, z: number, yawDeg: number, scale: number, y: number) => {
    let yaw = yawDeg % 360;
    if (yaw > 180) yaw -= 360;
    if (yaw <= -180) yaw += 360;
    out.push({ key, x: r2(x), z: r2(z), yaw: r4(yaw * DEG), scale: r4(scale), y: r2(y) });
    taken.push({ x, z, r: kind(key).footprint * scale });
  };

  for (const m of src.marks) taken.push({ x: m.at[0], z: m.at[1], r: m.clear ?? 2 });
  for (const p of src.place) {
    if (!p.key) continue;
    const k = kind(p.key);
    const r = p.groundRadius ?? k.footprint * p.scale * 0.5;
    push(p.key, p.at[0], p.at[1], p.yaw, p.scale, ground(p.at[0], p.at[1], p.ground ?? 'min', r) + (p.dy ?? 0));
  }
  for (const l of src.lines) {
    const dx = l.to[0] - l.from[0], dz = l.to[1] - l.from[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(1, Math.floor(len / l.step + 1e-9));
    for (let i = 0; i <= n; i++) {
      const x = l.from[0] + (dx * i) / n, z = l.from[1] + (dz * i) / n;
      const scale = l.scale ?? 1;
      out.push({ key: l.key, x: r2(x), z: r2(z), yaw: r4(l.yaw * DEG), scale: r4(scale), y: r2(ground(x, z, 'min', kind(l.key).footprint * scale * 0.5)) });
    }
    for (let i = 0; i <= n; i++) taken.push({ x: l.from[0] + (dx * i) / n, z: l.from[1] + (dz * i) / n, r: kind(l.key).footprint });
  }

  const zone = (name: string) => {
    const zn = src.zones[name];
    if (!zn) throw new Error(`placements: unknown zone ${name}`);
    return zn;
  };
  const spline = (id: string) => {
    const pl = t.splines.get(id) ?? t.paths.get(id)?.pl;
    if (!pl) throw new Error(`placements: unknown spline ${id}`);
    return pl;
  };
  const slopeAt = (x: number, z: number) => {
    const gx = (groundAt(x + 1, z) - groundAt(x - 1, z)) / 2, gz = (groundAt(x, z + 1) - groundAt(x, z - 1)) / 2;
    return Math.sqrt(gx * gx + gz * gz);
  };

  src.scatter.forEach((rule, ri) => {
    const k = kind(rule.key);
    const rand = prng((src.seed * 1000003 + ri * 7919) >>> 0);
    const g = 100 / Math.sqrt(rule.perHectare);
    const maxSlope = Math.tan(rule.maxSlope * DEG);
    const nx = Math.ceil(t.W / g), nz = Math.ceil(t.D / g);
    for (let gz = 0; gz < nz; gz++) {
      for (let gx = 0; gx < nx; gx++) {
        // Always draw the same five numbers per grid point, so editing one constraint doesn't reshuffle the rest.
        const jx = rand(), jz = rand(), accept = rand(), ryaw = rand(), rscale = rand();
        const x = ox + (gx + jx) * g, z = oz + (gz + jz) * g;
        // Inside this region (an open seam lets the grid run to its edge), and clear of every wall edge.
        if (x < ox + 0.5 || z < oz + 0.5 || x > ox + t.W - 0.5 || z > oz + t.D - 0.5) continue;
        if (t.wallDist(x, z) < rule.minBorder) continue;
        let w = 1;
        if (rule.in?.length) w = Math.max(...rule.in.map((n) => shapeMask(zone(n), zone(n).falloff ?? 0, x, z)));
        if (w <= 0 || accept >= w) continue;
        if ((rule.avoid ?? []).some((n) => shapeMask(zone(n), 0, x, z) > 0)) continue;
        if (rule.near) {
          const d = nearest(spline(rule.near[0]), x, z, rule.near[2]).d;
          if (d < rule.near[1] || d > rule.near[2]) continue;
        }
        if ((rule.avoidSplines ?? []).some(([id, within]) => nearest(spline(id), x, z, within).d < within)) continue;
        let onPath = false;
        for (const { pl, halfWidth } of t.paths.values()) if (nearest(pl, x, z, halfWidth + rule.clearPaths).d < halfWidth + rule.clearPaths) onPath = true;
        if (onPath) continue;
        if (slopeAt(x, z) > maxSlope) continue;
        const scale = lerp(rule.scale[0], rule.scale[1], rscale);
        if (!free(x, z, k.footprint * scale)) continue;
        const yaw = rule.yawJitter !== undefined ? (ryaw * 2 - 1) * rule.yawJitter : ryaw * 360 - 180;
        push(rule.key, x, z, yaw, scale, ground(x, z, 'min', k.footprint * scale * 0.4) + (rule.dy ?? 0));
      }
    }
  });
  return out;
}

// ------------------------------------------------------------------ horizon GLB

async function buildHorizon(
  t: Terrain,
  terrainSrc: TerrainSrc,
  q: (h: number) => number,
  landmarks: { inst: Instance; impostor: NonNullable<KindSrc['impostor']>; bounds: { min: number[]; max: number[] } }[],
): Promise<Uint8Array> {
  const ox = terrainSrc.origin[0] * CELL_SIZE, oz = terrainSrc.origin[1] * CELL_SIZE;
  const COLORS = [[0.36, 0.55, 0.24], [0.52, 0.41, 0.28], [0.5, 0.49, 0.47], [0.7, 0.6, 0.43]];
  const nx = t.W / HORIZON_STEP + 1, nz = t.D / HORIZON_STEP + 1;
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const H = (ix: number, iz: number) => q(t.heights[Math.max(0, Math.min(t.D, iz)) * (t.W + 1) + Math.max(0, Math.min(t.W, ix))]);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ix = i * HORIZON_STEP, iz = j * HORIZON_STEP;
      pos.push(ox + ix, H(ix, iz), oz + iz);
      const gx = (H(ix + HORIZON_STEP, iz) - H(ix - HORIZON_STEP, iz)) / (2 * HORIZON_STEP);
      const gz = (H(ix, iz + HORIZON_STEP) - H(ix, iz - HORIZON_STEP)) / (2 * HORIZON_STEP);
      const l = Math.sqrt(gx * gx + 1 + gz * gz);
      nrm.push(-gx / l, 1 / l, -gz / l);
      // Average the splat over the 8 m footprint so the far colour matches the near blend.
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let dz = -4; dz <= 4; dz += 2) {
        for (let dx = -4; dx <= 4; dx += 2) {
          const sx = Math.max(0, Math.min(t.W, ix + dx)), sz = Math.max(0, Math.min(t.D, iz + dz));
          const o = (sz * (t.W + 1) + sx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += t.splat[o + c];
          n++;
        }
      }
      const rgb = [0, 0, 0];
      for (let c = 0; c < 4; c++) for (let k = 0; k < 3; k++) rgb[k] += (acc[c] / (n * 255)) * COLORS[c][k];
      col.push(...rgb.map((v) => r4(v)));
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  // Landmark impostors: an 8-sided prism or a yawed box from the prop's bounds, flat-shaded.
  const ip: number[] = [], inm: number[] = [], ic: number[] = [], ii: number[] = [];
  const quad = (p: number[][], color: number[]) => {
    const [a, b, c] = p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
    const l = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2) || 1;
    nx2 /= l;
    ny2 /= l;
    nz2 /= l;
    const base = ip.length / 3;
    for (const v of p) {
      ip.push(r4(v[0]), r4(v[1]), r4(v[2]));
      inm.push(r4(nx2), r4(ny2), r4(nz2));
      ic.push(...color);
    }
    ii.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const { inst, impostor, bounds } of landmarks) {
    const s = inst.scale;
    const cy = Math.cos(inst.yaw), sy = Math.sin(inst.yaw);
    const y0 = inst.y + bounds.min[1] * s, y1 = inst.y + bounds.max[1] * s;
    const world = (lx: number, lz: number) => [inst.x + lx * cy + lz * sy, inst.z - lx * sy + lz * cy];
    let ring: number[][];
    if (impostor.shape === 'cylinder') {
      const rad = (Math.max(-bounds.min[0], bounds.max[0], -bounds.min[2], bounds.max[2]) * s) * 0.8;
      const K = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
      ring = K.map(([a, b]) => [inst.x + a * rad, inst.z + b * rad]);
    } else {
      const [x0, z0, x1, z1] = [bounds.min[0] * s, bounds.min[2] * s, bounds.max[0] * s, bounds.max[2] * s];
      ring = [world(x1, z1), world(x0, z1), world(x0, z0), world(x1, z0)];
    }
    // Wind the ring counter-clockwise seen from above (+y) so the faces point outward.
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      quad([[b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]]], impostor.color);
    }
    // Top cap as a fan of quads (ring has an even count).
    const cxm = ring.reduce((n, p) => n + p[0], 0) / ring.length, czm = ring.reduce((n, p) => n + p[1], 0) / ring.length;
    for (let k = 0; k < ring.length; k += 2) {
      const a = ring[k], b = ring[(k + 1) % ring.length], c = ring[(k + 2) % ring.length];
      quad([[cxm, y1, czm], [c[0], y1, c[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], impostor.color);
    }
  }

  const doc = new Document();
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const buffer = doc.createBuffer();
  const mat = doc.createMaterial('horizon').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0);
  const mesh = (name: string, p: number[], n: number[], c: number[], i: number[]) => {
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(n)).setBuffer(buffer))
      .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(c)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(p.length / 3 > 65535 ? new Uint32Array(i) : new Uint16Array(i)).setBuffer(buffer))
      .setMaterial(mat);
    return doc.createMesh(name).addPrimitive(prim);
  };
  const nodes: GNode[] = [doc.createNode('horizon_terrain').setMesh(mesh('horizon_terrain', pos, nrm, col, idx))];
  if (ip.length) nodes.push(doc.createNode('horizon_landmarks').setMesh(mesh('horizon_landmarks', ip, inm, ic, ii)));
  const scene = doc.createScene('horizon');
  for (const n of nodes) scene.addChild(n);
  scene.setExtras({ note: 'True terrain heights; the renderer draws this 0.5 m lower and masks it under loaded cells (plan §3.2).', step: HORIZON_STEP });
  doc.getRoot().setDefaultScene(scene);
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io.writeBinary(doc);
}

// ------------------------------------------------------------------ bake

/** Stable JSON: object keys in insertion order (built in a fixed order), compact or 2-space. */
const json = (v: unknown, pretty: boolean) => new TextEncoder().encode(JSON.stringify(v, null, pretty ? 2 : undefined) + '\n');
const sortedKeys = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, o[k]]));

/** The overworld this region belongs to, or null (the cave). Reads every other region's rectangle. */
function loadOverworld(region: string): Overworld | null {
  const file = path.join(ROOT, 'world-src', 'overworld.json');
  if (!fs.existsSync(file)) return null;
  const src = JSON.parse(fs.readFileSync(file, 'utf8')) as OverworldSrc;
  if (!src.regions.includes(region)) return null;
  const others = new Set<string>();
  for (const id of src.regions) {
    if (id === region) continue;
    const tf = path.join(ROOT, 'world-src', id, 'terrain.json');
    if (!fs.existsSync(tf)) continue;
    const o = JSON.parse(fs.readFileSync(tf, 'utf8')) as TerrainSrc;
    for (let cz = 0; cz < o.size[1]; cz++) for (let cx = 0; cx < o.size[0]; cx++) others.add(`${o.origin[0] + cx},${o.origin[1] + cz}`);
  }
  return { src, others, seed: 20261120 };
}

async function bakeRegion(region: string): Promise<{ files: Map<string, Uint8Array>; stats: string[] }> {
  const dir = path.join(ROOT, 'world-src', region);
  const terrainSrc = JSON.parse(fs.readFileSync(path.join(dir, 'terrain.json'), 'utf8')) as TerrainSrc;
  const placeSrc = JSON.parse(fs.readFileSync(path.join(dir, 'placements.json'), 'utf8')) as PlacementsSrc;
  if (terrainSrc.id !== region) throw new Error(`terrain.json id ${terrainSrc.id} != ${region}`);
  const [SW, SD] = terrainSrc.size;
  const [OX, OZ] = terrainSrc.origin;
  const ow = loadOverworld(region);
  if (ow) {
    if (terrainSrc.heightRange && (terrainSrc.heightRange.min !== ow.src.heightRange.min || terrainSrc.heightRange.max !== ow.src.heightRange.max)) {
      throw new Error(`terrain.json heightRange differs from overworld.json's (leave it out: the overworld sets it)`);
    }
    terrainSrc.heightRange = ow.src.heightRange;
  }
  const t = buildTerrain(terrainSrc, ow);

  let hmin = Infinity, hmax = -Infinity;
  for (const h of t.heights) {
    if (h < hmin) hmin = h;
    if (h > hmax) hmax = h;
  }
  const fixed = terrainSrc.heightRange;
  if (fixed && (hmin < fixed.min || hmax > fixed.max)) {
    throw new Error(`height ${hmin}..${hmax} falls outside heightRange ${fixed.min}..${fixed.max}`);
  }
  const heightRange = fixed ?? { min: Math.floor(hmin) - 1, max: Math.ceil(hmax) + 1 };
  const span = heightRange.max - heightRange.min;
  /** The height after a Uint16 round trip, so everything placed on the ground matches the decoded cells. */
  const q = (h: number) => heightRange.min + (Math.max(0, Math.min(65535, Math.round(((h - heightRange.min) / span) * 65535))) / 65535) * span;

  // Encode every cell, and keep the decoded heights for placing props.
  const bins = new Map<string, Uint8Array>();
  const decoded = new Map<string, Float32Array>();
  for (let cz = 0; cz < SD; cz++) {
    for (let cx = 0; cx < SW; cx++) {
      const hs = new Float32Array(CELL_RES * CELL_RES);
      const sp = new Uint8Array(CELL_RES * CELL_RES * 4);
      for (let iz = 0; iz < CELL_RES; iz++) {
        for (let ix = 0; ix < CELL_RES; ix++) {
          const g = (cz * CELL_SIZE + iz) * (t.W + 1) + cx * CELL_SIZE + ix;
          hs[iz * CELL_RES + ix] = t.heights[g];
          sp.set(t.splat.subarray(g * 4, g * 4 + 4), (iz * CELL_RES + ix) * 4);
        }
      }
      const bin = encodeCellBin(hs, sp, heightRange);
      bins.set(`${cx},${cz}`, bin);
      decoded.set(`${cx},${cz}`, decodeCellBin(bin, heightRange).heights);
    }
  }
  const groundAt = (x: number, z: number) => {
    const lx = Math.max(0, Math.min(SW * CELL_SIZE - 1e-6, x - OX * CELL_SIZE)), lz = Math.max(0, Math.min(SD * CELL_SIZE - 1e-6, z - OZ * CELL_SIZE));
    const cx = Math.floor(lx / CELL_SIZE), cz = Math.floor(lz / CELL_SIZE);
    return sampleHeight(decoded.get(`${cx},${cz}`)!, OX + cx, OZ + cz, OX * CELL_SIZE + lx, OZ * CELL_SIZE + lz);
  };

  const instances = placeProps(t, terrainSrc, placeSrc, groundAt);
  const cellOfLocal = (x: number, z: number): [number, number] => [
    Math.max(0, Math.min(SW - 1, Math.floor((x - OX * CELL_SIZE) / CELL_SIZE))),
    Math.max(0, Math.min(SD - 1, Math.floor((z - OZ * CELL_SIZE) / CELL_SIZE))),
  ];

  // Per-cell prop arrays and counts.
  const cellProps = new Map<string, Record<string, number[]>>();
  const counts = new Map<string, Int32Array>();
  for (const inst of instances) {
    const [cx, cz] = cellOfLocal(inst.x, inst.z);
    const k = `${cx},${cz}`;
    const rec = cellProps.get(k) ?? {};
    (rec[inst.key] ??= []).push(inst.x, inst.y, inst.z, inst.yaw, inst.scale);
    cellProps.set(k, rec);
    const c = counts.get(inst.key) ?? new Int32Array(SW * SD);
    c[cz * SW + cx]++;
    counts.set(inst.key, c);
  }
  const capacity = (key: string) => {
    const c = counts.get(key)!;
    const ww = Math.min(CAPACITY_WINDOW, SW), wd = Math.min(CAPACITY_WINDOW, SD);
    let best = 0;
    for (let z0 = 0; z0 + wd <= SD; z0++) {
      for (let x0 = 0; x0 + ww <= SW; x0++) {
        let n = 0;
        for (let z = z0; z < z0 + wd; z++) for (let x = x0; x < x0 + ww; x++) n += c[z * SW + x];
        best = Math.max(best, n);
      }
    }
    return best;
  };

  // Marks per cell.
  const cellMarks = new Map<string, NonNullable<CellData['marks']>>();
  let playerStart: RegionManifest['playerStart'] | undefined;
  for (const m of placeSrc.marks) {
    const [cx, cz] = cellOfLocal(m.at[0], m.at[1]);
    const pos: [number, number, number] = [r2(m.at[0]), r2(groundAt(m.at[0], m.at[1])), r2(m.at[1])];
    const mark: NonNullable<CellData['marks']>[number] = { id: m.id, kind: m.kind, pos };
    if (m.yaw !== undefined) mark.yaw = r4(m.yaw * DEG);
    const list = cellMarks.get(`${cx},${cz}`) ?? [];
    list.push(mark);
    cellMarks.set(`${cx},${cz}`, list);
    if (m.kind === 'playerStart') playerStart = { pos, yaw: r4((m.yaw ?? 0) * DEG) };
  }
  if (!playerStart) throw new Error('placements: no playerStart mark');

  // Prop table: only kinds that are placed, sorted by key.
  const usedKeys = [...counts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const unused = Object.keys(placeSrc.kinds).filter((k) => !counts.has(k));
  const props: Record<string, PropKind> = {};
  for (const key of usedKeys) {
    const k = placeSrc.kinds[key];
    const lod1 = `models/props/${k.model}-lod1.glb`;
    const entry: PropKind = { path: `models/props/${k.model}.glb`, collider: k.collider, capacity: capacity(key) };
    if (fs.existsSync(path.join(ROOT, 'public/assets', lod1))) entry.lod1Path = lod1;
    if (k.landmark) entry.landmark = true;
    props[key] = { path: entry.path, ...(entry.lod1Path ? { lod1Path: entry.lod1Path } : {}), collider: entry.collider, ...(entry.landmark ? { landmark: true } : {}), capacity: entry.capacity };
  }

  const files = new Map<string, Uint8Array>();
  const cells: CellEntry[] = [];
  const base = `world/${region}`;
  for (let cz = 0; cz < SD; cz++) {
    for (let cx = 0; cx < SW; cx++) {
      const k = `${cx},${cz}`;
      const gcx = OX + cx, gcz = OZ + cz;
      const data: CellData = { cx: gcx, cz: gcz, props: sortedKeys(cellProps.get(k) ?? {}) };
      const marks = cellMarks.get(k);
      if (marks?.length) data.marks = marks;
      const jb = json(data, false);
      const bb = bins.get(k)!;
      const name = `c_${gcx}_${gcz}`;
      files.set(`cells/${name}.bin`, bb);
      files.set(`cells/${name}.json`, jb);
      cells.push({ cx: gcx, cz: gcz, bin: `${base}/cells/${name}.bin`, json: `${base}/cells/${name}.json`, bytes: bb.byteLength + jb.byteLength });
    }
  }

  const models = [...new Set(Object.values(placeSrc.kinds).filter((k) => k.landmark).map((k) => k.model))].sort();
  const bounds = await readPropBounds(models);
  const landmarks = instances
    .filter((i) => placeSrc.kinds[i.key].landmark)
    .map((inst) => {
      const k = placeSrc.kinds[inst.key];
      return { inst, impostor: k.impostor ?? { shape: 'box' as const, color: [0.5, 0.48, 0.45] as [number, number, number] }, bounds: bounds.get(k.model)! };
    });
  files.set('horizon.glb', await buildHorizon(t, terrainSrc, q, landmarks));

  const manifest: RegionManifest = {
    id: region,
    version: terrainSrc.version,
    origin: [OX, OZ],
    size: [SW, SD],
    cellSize: CELL_SIZE,
    heightRange,
    cells,
    props,
    playerStart,
    horizon: `${base}/horizon.glb`,
    splatLayers: ['grass', 'dirt', 'rock', 'path'],
    fog: ow?.src.fog ?? terrainSrc.fog ?? { near: 80, far: 180, farPlane: 450 },
  };
  if (t.water.length) manifest.water = t.water;
  files.set('region.json', json(manifest, true));

  // Budgets (plan §3.5).
  const stats: string[] = [];
  let total = 0, largest = 0, largestName = '';
  for (const [name, b] of files) {
    total += b.byteLength;
    if (name.startsWith('cells/') && name.endsWith('.bin')) {
      const c = cells.find((e) => e.bin.endsWith(name))!;
      if (c.bytes > largest) {
        largest = c.bytes;
        largestName = name.replace(/\.bin$/, '');
      }
    }
  }
  for (const c of cells) if (c.bytes > CELL_BYTES_MAX) throw new Error(`cell ${c.cx},${c.cz} is ${c.bytes} bytes (budget ${CELL_BYTES_MAX})`);
  if (total > REGION_BYTES_MAX) throw new Error(`region ${region} is ${total} bytes (budget ${REGION_BYTES_MAX})`);
  stats.push(`heights ${heightRange.min}..${heightRange.max} m; ${instances.length} props in ${usedKeys.length} kinds; region ${(total / 1024).toFixed(0)} KiB; largest cell ${largestName} ${(largest / 1024).toFixed(1)} KiB; horizon ${(files.get('horizon.glb')!.byteLength / 1024).toFixed(1)} KiB`);
  stats.push('capacities: ' + usedKeys.map((k) => `${k}=${props[k].capacity}`).join(' '));
  if (unused.length) stats.push(`unused kinds (left out of the manifest): ${unused.join(', ')}`);
  return { files, stats };
}

// ------------------------------------------------------------------ CLI

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const check = args.includes('--check');
  const outIdx = args.indexOf('--out');
  const outArg = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const region = args.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1)) ?? 'sproutvale';
  const outDir = outArg ? path.resolve(outArg) : path.join(ROOT, 'public/world', region);

  const { files, stats } = await bakeRegion(region);
  const onDisk = (dir: string, base = ''): string[] =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? onDisk(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]))
      : [];

  if (check) {
    const stale: string[] = [];
    for (const [name, bytes] of files) {
      const f = path.join(outDir, name);
      if (!fs.existsSync(f) || !Buffer.from(bytes).equals(fs.readFileSync(f))) stale.push(name);
    }
    // `map.webp` comes from `npm run bake:map`.
    for (const name of onDisk(outDir)) if (!files.has(name) && name !== 'map.webp') stale.push(`${name} (not produced by the bake)`);
    if (stale.length) {
      console.error(`bake:world --check: ${outDir} is stale (${stale.length} files): ${stale.slice(0, 8).join(', ')}${stale.length > 8 ? ', …' : ''}`);
      console.error(`run: npm run bake:world -- ${region}`);
      process.exit(1);
    }
    console.log(`bake:world --check: ${region} is up to date (${files.size} files)`);
    return;
  }

  for (const name of onDisk(outDir)) if (!files.has(name)) fs.rmSync(path.join(outDir, name));
  for (const [name, bytes] of files) {
    const f = path.join(outDir, name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, bytes);
  }
  console.log(`bake:world: wrote ${files.size} files to ${path.relative(ROOT, outDir) || outDir}`);
  for (const s of stats) console.log(`  ${s}`);
}

await main();
