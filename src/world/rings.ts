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
export const RING_VISUAL = 2;
export const RING_KEEP = 3;
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

export function planRings(input: RingInput): RingPlan {
  const { players, anchors, current, inRegion } = input;
  const anchored = new Set(anchors.map(([x, z]) => cellKey(x, z)));
  const candidates = new Map<string, CellXZ>();
  for (const [px, pz] of players) {
    for (let dz = -RING_KEEP; dz <= RING_KEEP; dz++) {
      for (let dx = -RING_KEEP; dx <= RING_KEEP; dx++) candidates.set(cellKey(px + dx, pz + dz), [px + dx, pz + dz]);
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
    else if (dist === RING_KEEP) level = cur ? 'visual' : null;
    else level = null;
    if (!level) continue;
    const priority: Priority = isAnchor || dist <= RING_ACTIVE ? 'now' : 'later';
    want.push({ cx: cell[0], cz: cell[1], key, level, priority, dist, anchored: isAnchor });
  }
  want.sort((a, b) => (a.priority === b.priority ? a.dist - b.dist || a.cz - b.cz || a.cx - b.cx : a.priority === 'now' ? -1 : 1));
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
 * Prop LOD bucket for a cell (plan §3.4), from the distance (m) between the player and the nearest
 * point of the cell: 0 = LOD0 that casts shadows (≤ 60 m), 1 = LOD0 (≤ 70 m), 2 = LOD1 (≤ 180 m),
 * null = hidden. Visual-ring cells use LOD1 whatever the distance. Cells past the visual ring show
 * only landmarks, which keeps every non-landmark bucket inside the 5 × 5 window that the baked
 * capacities cover.
 */
export type PropBucket = 0 | 1 | 2;
export const LOD0_SHADOW_M = 60;
export const LOD0_M = 70;
export const LOD1_M = 180;

export function propBucket(meters: number, level: CellLevel, ring: number, landmark: boolean): PropBucket | null {
  if (ring > RING_VISUAL) return landmark ? 2 : null;
  if (meters > LOD1_M) return landmark ? 2 : null;
  if (level === 'visual' || meters > LOD0_M) return 2;
  return meters > LOD0_SHADOW_M ? 1 : 0;
}

/** Distance (m) in XZ from a point to the nearest point of a cell's square. */
export function distanceToCell(x: number, z: number, cx: number, cz: number, cellSize: number): number {
  const x0 = cx * cellSize, z0 = cz * cellSize;
  const ddx = Math.max(x0 - x, 0, x - (x0 + cellSize));
  const ddz = Math.max(z0 - z, 0, z - (z0 + cellSize));
  return Math.hypot(ddx, ddz);
}
