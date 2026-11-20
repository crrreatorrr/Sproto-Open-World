/**
 * The streamed world's data format (plan §3.1). Pure types and constants shared by the bake tool
 * (tools/bake-world.ts), the client streamer (src/world) and the sim (cell colliders).
 *
 * Global layout: a cell (cx, cz) covers x ∈ [cx·64, cx·64 + 64), z ∈ [cz·64, cz·64 + 64) in world
 * metres. A region is a rectangle of cells with its own manifest. Sproutvale's SW cell is (0, 0).
 */

export const CELL_SIZE = 64;
/** Height samples per cell side: 1 m spacing with shared edges (65 × 65). */
export const CELL_RES = 65;

/** Collider shape for a prop kind, at instance scale 1 (scaled by each instance's scale). */
export type PropCollider =
  | { kind: 'none' }
  | { kind: 'cylinder'; radius: number; height: number }
  | { kind: 'box'; half: [number, number, number] };

export interface PropKind {
  /** GLB under public/assets (LOD0). */
  path: string;
  /** Simplified LOD1 GLB (70–180 m), when there is one. */
  lod1Path?: string;
  collider: PropCollider;
  /** Landmarks also appear on the horizon mesh as impostors and are never culled by LOD distance. */
  landmark?: boolean;
  /**
   * Baked maximum number of instances of this prop in any 7 × 7 cell window (the hysteresis ring), so each prop's
   * InstancedMesh is sized once and never resized (plan §3.1).
   */
  capacity: number;
}

export interface CellEntry {
  cx: number;
  cz: number;
  /** Paths under public/ (e.g. `world/sproutvale/cells/c_3_0.bin`). */
  bin: string;
  json: string;
  /** Bytes of bin + json, for budgets and the loader's progress. */
  bytes: number;
}

export interface RegionManifest {
  id: string;
  version: number;
  /** Global cell coordinates of the region's SW cell, and its size in cells. */
  origin: [number, number];
  size: [number, number];
  cellSize: number;
  /** Heights in the .bin are Uint16, mapped linearly onto [min, max] metres. */
  heightRange: { min: number; max: number };
  cells: CellEntry[];
  props: Record<string, PropKind>;
  playerStart: { pos: [number, number, number]; yaw: number };
  /** Path under public/ of the always-resident low-detail horizon GLB. */
  horizon: string;
  /** Splat layer order in the .bin RGBA channels. */
  splatLayers: [string, string, string, string];
  /** World-space fog band and far plane (plan §3.2). */
  fog: { near: number; far: number; farPlane: number };
  /** Water surfaces the renderer draws (rivers as ribbons, pools as discs). Visual only: the bed is terrain. */
  water?: WaterBody[];
}

/**
 * A water surface in world metres. A river is a ribbon along `points` ([x, z, surfaceY], already
 * sampled smooth), `halfWidth` either side; where the surface drops steeply the ribbon becomes a
 * falling sheet. A pool is a flat disc. `flow` is metres per second along the ribbon (0 for still).
 */
export type WaterBody =
  | { id: string; kind: 'river'; points: [number, number, number][]; halfWidth: number; flow: number }
  | { id: string; kind: 'pool'; center: [number, number]; radius: number; y: number };

/**
 * A cell's JSON half. Prop placements are packed per prop key as flat arrays of
 * [x, y, z, yaw, scale] in world metres (y is the ground height at the prop).
 */
export interface CellData {
  cx: number;
  cz: number;
  props: Record<string, number[]>;
  /** Named points for later milestones (shrines, camps, triggers); free-form for now. */
  marks?: { id: string; kind: string; pos: [number, number, number]; yaw?: number }[];
}

/** One collider shape in world space (sim side). */
export type ColliderShape =
  | { kind: 'cylinder'; pos: [number, number, number]; radius: number; height: number }
  | { kind: 'box'; pos: [number, number, number]; half: [number, number, number]; yaw: number };

/**
 * Everything the sim needs to build a cell's fixed body: the heightfield (metres, row-major:
 * index = iz·CELL_RES + ix, x = cx·64 + ix, z = cz·64 + iz) and the prop colliders (centres are the
 * shapes' centres, not their bases).
 */
export interface CellColliders {
  cx: number;
  cz: number;
  heights: Float32Array;
  shapes: ColliderShape[];
}

export const cellKey = (cx: number, cz: number): string => `${cx},${cz}`;
export const cellOf = (x: number, z: number): [number, number] => [Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)];
