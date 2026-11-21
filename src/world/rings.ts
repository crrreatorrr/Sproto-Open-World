import { CELL_SIZE, cellKey, cellOf } from '../content/world/format';
import type { Priority } from '../assets/RequestQueue';

/**
 * Pure streaming policy (plan §3.2): which cells should be loaded, at what level and priority,
 * given the players' cells, the sim's collider anchors and what is loaded now. No three, DOM or
 * clock, so tests/world covers it in Node.
 *
 *   Chebyshev distance from the nearest player cell
 *   ≤ 1  Active: full-res terrain and colliders (NOW priority)
 *   = 2  Visual: half-res terrain, LOD1 props, no colliders (LATER). An Active cell that drops to 2
 *        stays Active, so walking back and forth over a cell edge doesn't rebuild colliders.
 *   = 3  Hysteresis: a loaded cell stays (Active drops to Visual), nothing new loads
 *   ≥ 4  Unloaded
 *
 * A sim anchor (an enemy fighting or leashing, plus the player's own 3 × 3) is always Active at
 * NOW priority and never unloads, whatever its distance: its colliders must stay (plan §3.2).
 */
export type CellLevel = 'active' | 'visual';

export const RING_ACTIVE = 1;
/** The fewest rings of ground ever shown (Low quality). An Active cell that drops to this ring keeps its colliders. */
export const RING_VISUAL = 2;
/** With the fewest rings, the hysteresis ring. In general it is one past `rings` (see `planRings`). */
export const RING_KEEP = 3;
export const CELL_SIZE_M = CELL_SIZE;

/** The graphics qualities, as the streaming policy needs them (render/quality.ts owns the setting). */
export type ViewQuality = 'low' | 'medium' | 'high';

/**
 * How many rings of cells are shown around the player's cell, by graphics quality. Colliders stay in
 * the 3 × 3 whatever this is; the rings past 2 carry coarse ground (`terrainRes`) and only the props
 * big enough to be seen from there (`propRanges`).
 */
export function viewRings(quality: ViewQuality): number {
  return quality === 'low' ? 2 : quality === 'medium' ? 3 : 5;
}

/** Every prop draw distance is multiplied by this (San Andreas's draw-distance slider). */
export function viewScale(quality: ViewQuality): number {
  return quality === 'low' ? 0.8 : quality === 'medium' ? 1 : 1.2;
}

/** The camera trails the player by up to this far (m): the loaded square is centred on the player's cell. */
const CAMERA_TRAIL_M = 8;

/**
 * The distance from the camera out to which ground is certain to be loaded with `rings` rings: the
 * loaded square's nearest edge when the player stands at the edge of their own cell. Nothing may be
 * drawn past it, or it would appear out of thin air as its cell loads.
 */
export function coverageM(rings: number): number {
  return rings * CELL_SIZE - CAMERA_TRAIL_M;
}

/** Terrain resolution (quads along a cell's side) for a cell `dist` rings from the player. */
export function terrainRes(level: CellLevel, dist: number): 64 | 32 | 16 {
  if (level === 'active') return 64;
  return dist <= RING_VISUAL ? 32 : 16;
}
/** Prefetch looks this far ahead along the player's velocity (plan §3.2). */
export const PREFETCH_SECONDS = 4;
/** Cell fetch retries and their backoff (plan §2.9). */
export const RETRY_DELAYS_MS = [500, 1000, 2000] as const;
/** How long the player's cell may stay unready behind the veil before we offer Retry / Return (plan §2.9). */
export const VEIL_TIMEOUT_MS = 15_000;

export type CellXZ = readonly [number, number];

/** While playing, the ground only has to be built this close to the player (m). */
export const GROUND_NEAR_M = 24;

/**
 * The cells whose colliders the player needs. Coming out from behind the veil (a load, teleport or
 * respawn) that is the whole 3 × 3. During play it is only the cells within `GROUND_NEAR_M`: crossing
 * a cell edge makes the far three neighbours Active that same frame, and they are 64 m away, so
 * waiting for them would flash the veil and drop input for nothing. Every cell this close was
 * already in the 3 × 3 before the crossing.
 */
export function groundCells(x: number, z: number, playing: boolean): CellXZ[] {
  const [px, pz] = cellOf(x, z);
  const out: CellXZ[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = px + dx, cz = pz + dz;
      if (!playing || distanceToCell(x, z, cx, cz, CELL_SIZE) <= GROUND_NEAR_M) out.push([cx, cz]);
    }
  }
  return out;
}

export interface RingInput {
  /** Each player's cell (one now, N in co-op). */
  players: readonly CellXZ[];
  /** Cells whose colliders must stay loaded (the sim's `cellAnchors()`). */
  anchors: readonly CellXZ[];
  /** What is loaded or loading now, by cellKey. */
  current: ReadonlyMap<string, CellLevel>;
  /** Whether a region manifest has this cell. */
  inRegion(cx: number, cz: number): boolean;
  /** Rings of cells to show (`viewRings`); 2 when left out. One more ring is kept if already loaded. */
  rings?: number;
  /**
   * Where the camera is and which way it looks on the ground plane (m; `dx, dz` need not be unit
   * length). Given, cells in front are asked for before cells behind (San Andreas, SA9).
   */
  view?: { x: number; z: number; dx: number; dz: number };
}

export interface CellWant {
  cx: number;
  cz: number;
  key: string;
  level: CellLevel;
  priority: Priority;
  /** Chebyshev distance to the nearest player cell (Infinity with no players). */
  dist: number;
  anchored: boolean;
  /** Terrain resolution to build (`terrainRes`). */
  res: 64 | 32 | 16;
}

export interface RingPlan {
  /** Every cell that should be loaded, NOW before LATER, nearest first. */
  want: CellWant[];
  /** Keys loaded now that should be dropped. */
  unload: string[];
}

export function chebyshev(a: CellXZ, b: CellXZ): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

export function ringDistance(cell: CellXZ, players: readonly CellXZ[]): number {
  let d = Infinity;
  for (const p of players) d = Math.min(d, chebyshev(cell, p));
  return d;
}

/** How much being straight ahead of the camera is worth, in rings, when ordering requests. */
const AHEAD_WEIGHT = 1.1;

export function planRings(input: RingInput): RingPlan {
  const { players, anchors, current, inRegion, view } = input;
  const rings = Math.max(RING_VISUAL, input.rings ?? RING_VISUAL);
  const keepRing = rings + 1;
  const anchored = new Set(anchors.map(([x, z]) => cellKey(x, z)));
  const candidates = new Map<string, CellXZ>();
  for (const [px, pz] of players) {
    for (let dz = -keepRing; dz <= keepRing; dz++) {
      for (let dx = -keepRing; dx <= keepRing; dx++) candidates.set(cellKey(px + dx, pz + dz), [px + dx, pz + dz]);
    }
  }
  for (const a of anchors) candidates.set(cellKey(a[0], a[1]), a);
  for (const k of current.keys()) {
    if (!candidates.has(k)) candidates.set(k, parseKey(k));
  }

  const want: CellWant[] = [];
  for (const [key, cell] of candidates) {
    if (!inRegion(cell[0], cell[1])) continue;
    const dist = ringDistance(cell, players);
    const isAnchor = anchored.has(key);
    const cur = current.get(key);
    let level: CellLevel | null;
    if (isAnchor || dist <= RING_ACTIVE) level = 'active';
    else if (dist === RING_VISUAL) level = cur === 'active' ? 'active' : 'visual';
    else if (dist <= rings) level = 'visual';
    else if (dist === keepRing) level = cur ? 'visual' : null;
    else level = null;
    if (!level) continue;
    const priority: Priority = isAnchor || dist <= RING_ACTIVE ? 'now' : 'later';
    want.push({ cx: cell[0], cz: cell[1], key, level, priority, dist, anchored: isAnchor, res: terrainRes(level, dist) });
  }
  // Needed-now cells nearest first. The rest by distance too, but a cell the camera faces counts as
  // up to AHEAD_WEIGHT rings nearer and one behind it as that much further.
  const vl = view ? Math.hypot(view.dx, view.dz) : 0;
  const order = new Map<string, number>();
  for (const w of want) {
    let score = w.dist;
    if (view && vl > 1e-6 && w.priority === 'later') {
      const ox = (w.cx + 0.5) * CELL_SIZE - view.x, oz = (w.cz + 0.5) * CELL_SIZE - view.z;
      const ol = Math.hypot(ox, oz);
      if (ol > 1e-6) score -= AHEAD_WEIGHT * ((ox * view.dx + oz * view.dz) / (ol * vl));
    }
    order.set(w.key, score);
  }
  want.sort((a, b) => (a.priority === b.priority ? order.get(a.key)! - order.get(b.key)! || a.dist - b.dist || a.cz - b.cz || a.cx - b.cx : a.priority === 'now' ? -1 : 1));
  const keep = new Set(want.map((w) => w.key));
  const unload = [...current.keys()].filter((k) => !keep.has(k));
  return { want, unload };
}

/**
 * Cells worth fetching ahead of time: the visual ring (5 × 5) around where the player will be over
 * the next `seconds`, sampled every half cell along the velocity. Only cells in the region, and
 * never the cells already in `skip` (they are loading anyway). Nearest to the path's end last, so
 * the soonest-needed cells queue first.
 */
/** How far ahead to fetch at this ground speed (m/s): 4 s on foot, further at a gallop or in the air (SA12). */
export function prefetchSeconds(speed: number): number {
  return speed <= 8 ? PREFETCH_SECONDS : speed <= 20 ? 6 : 8;
}

export function prefetchCells(
  pos: { x: number; z: number },
  vel: { x: number; z: number },
  cellSize: number,
  inRegion: (cx: number, cz: number) => boolean,
  skip: ReadonlySet<string>,
  seconds = PREFETCH_SECONDS,
): CellXZ[] {
  const dx = vel.x * seconds, dz = vel.z * seconds;
  const len = Math.hypot(dx, dz);
  if (len < cellSize / 4) return [];
  const steps = Math.max(1, Math.ceil(len / (cellSize / 2)));
  const out: CellXZ[] = [];
  const seen = new Set<string>();
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.floor((pos.x + dx * t) / cellSize), cz = Math.floor((pos.z + dz * t) / cellSize);
    for (let oz = -RING_VISUAL; oz <= RING_VISUAL; oz++) {
      for (let ox = -RING_VISUAL; ox <= RING_VISUAL; ox++) {
        const k = cellKey(cx + ox, cz + oz);
        if (seen.has(k) || skip.has(k) || !inRegion(cx + ox, cz + oz)) continue;
        seen.add(k);
        out.push([cx + ox, cz + oz]);
      }
    }
  }
  return out;
}

/**
 * Run `attempt` and retry it after each of `delays` while `alive()` holds (plan §2.9: 3 retries at
 * 0.5, 1 and 2 s). `sleep` is injected so tests run without real timers. Rejects with the last
 * error once the retries are spent, or at once if the cell stopped being wanted.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  alive: () => boolean = () => true,
  delays: readonly number[] = RETRY_DELAYS_MS,
  onRetry?: (n: number, err: unknown) => void,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (i >= delays.length || !alive() || isCancel(err)) throw err;
      onRetry?.(i + 1, err);
      await sleep(delays[i]);
      if (!alive()) throw err;
    }
  }
}

export function isCancel(err: unknown): boolean {
  return err instanceof Error && (err.name === 'CancelledError' || err.name === 'AbortError');
}

function parseKey(k: string): CellXZ {
  const [x, z] = k.split(',').map(Number);
  return [x, z];
}

/**
 * Prop draw distances (San Andreas gave every model its own; SA6). A prop's size puts it in a class,
 * and the class says how far its detailed model (LOD0) and its simple one (LOD1) are drawn. Small
 * things stop early, where nobody can see them any more; big things reach as far as ground is loaded.
 * The swap between the two models, and the far edge, are faded per prop in the shader over `band`.
 */
export type PropClass = 'clutter' | 'small' | 'medium' | 'large' | 'landmark';

/** What the policy needs to know of a prop kind (content/world/format.ts PropKind has it). */
export interface PropSized {
  /** Width (the larger of x and z) and height of the model's bounds, in metres. */
  readonly size?: readonly [number, number];
  readonly landmark?: boolean;
}

export interface PropRange {
  /** The detailed model is drawn out to here (m)... */
  hd: number;
  /** ...the simple one from there out to here. */
  far: number;
  /** Width of the fade at each of those two distances (m). */
  band: number;
  /** Whether the prop casts a sun shadow when close. */
  casts: boolean;
}

/** LOD0 and LOD1 distances at scale 1, per class (m). Landmarks reach as far as ground is loaded. */
const CLASS_RANGE: Record<PropClass, readonly [number, number]> = {
  clutter: [36, 64],
  small: [44, 110],
  medium: [60, 180],
  large: [84, 260],
  landmark: [120, Infinity],
};

/** Props shorter than this never cast a shadow (crops, ferns, paving): nobody misses it. */
const CAST_MIN_HEIGHT_M = 1.5;

const classOf = (s: number): PropClass => (s < 1.6 ? 'clutter' : s < 3.5 ? 'small' : s < 9 ? 'medium' : 'large');

/** The class that sets how far a prop is seen at all: by its height, or half its width if that is more. */
export function propClass(kind: PropSized): PropClass {
  if (kind.landmark) return 'landmark';
  if (!kind.size) return 'medium';
  return classOf(Math.max(kind.size[1], kind.size[0] * 0.5));
}

/**
 * The class that sets how far a prop keeps its detailed model. Width counts for less here: a wide,
 * flat thing (paving, a crop row) is seen from far off, but its detail is lost long before a tall
 * thing's is.
 */
function detailClass(kind: PropSized): PropClass {
  if (kind.landmark) return 'landmark';
  if (!kind.size) return 'medium';
  return classOf(Math.max(kind.size[1], kind.size[0] * 0.25));
}

/**
 * A kind's draw distances at a draw-distance `scale`, never past `coverage` (`coverageM`): a prop
 * drawn beyond the loaded ground would pop in when its cell arrives instead of fading in.
 */
export function propRanges(kind: PropSized, scale: number, coverage: number): PropRange {
  const far = Math.max(1, Math.min(CLASS_RANGE[propClass(kind)][1] * scale, coverage));
  const hd = Math.min(CLASS_RANGE[detailClass(kind)][0] * scale, far * 0.6);
  return { hd, far, band: Math.min(20, hd * 0.3), casts: kind.size ? kind.size[1] >= CAST_MIN_HEIGHT_M : true };
}

/** Props within this distance of the camera are in the shadow-casting set (the shadow box is ±35 m). */
export const NEAR_SHADOW_M = 46;
/** The camera this far above the ground draws every prop as its simple model, without shadows (SA11). */
export const ALOFT_M = 50;

/**
 * Which sets a cell's props of one kind feed, from the nearest and farthest the cell gets to the
 * camera (m): `near` the detailed, shadow-casting set (chosen per prop inside it), `hd` the detailed
 * set, `far` the simple one. A cell that straddles the swap distance feeds both and the shader shows
 * each prop in exactly one.
 */
export function propTiers(dmin: number, dmax: number, r: PropRange, aloft = false): { near: boolean; hd: boolean; far: boolean } {
  if (aloft) return { near: false, hd: false, far: dmin < r.far };
  return { near: r.casts && dmin < NEAR_SHADOW_M, hd: dmin < r.hd, far: dmin < r.far && dmax > r.hd - r.band };
}

/** Distance (m) in XZ from a point to the nearest point of a cell's square. */
export function distanceToCell(x: number, z: number, cx: number, cz: number, cellSize: number): number {
  const x0 = cx * cellSize, z0 = cz * cellSize;
  const ddx = Math.max(x0 - x, 0, x - (x0 + cellSize));
  const ddz = Math.max(z0 - z, 0, z - (z0 + cellSize));
  return Math.hypot(ddx, ddz);
}

/** Distance (m) in XZ from a point to the farthest corner of a cell's square. */
export function farDistanceToCell(x: number, z: number, cx: number, cz: number, cellSize: number): number {
  const x0 = cx * cellSize, z0 = cz * cellSize;
  return Math.hypot(Math.max(Math.abs(x - x0), Math.abs(x - x0 - cellSize)), Math.max(Math.abs(z - z0), Math.abs(z - z0 - cellSize)));
}
