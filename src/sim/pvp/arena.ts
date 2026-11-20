// Pure symmetric circular PvP arena with 4 AABB pillars and boundary wall.
// Zero Three.js, zero Rapier, zero DOM — identical in browser and Nakama Goja ES2020.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ArenaBox {
  readonly id: string;
  readonly kind: 'box';
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface RayHit {
  t: number;
  x: number;
  y: number;
  z: number;
  id: string;
}

/** Circular arena radius in metres. */
export const ARENA_R = 45;

/** Height of the circular boundary wall that can be grappled. Above this is open air. */
export const ARENA_WALL_H = 12;

/** Half-width (X/Z) and height (Y) of each symmetric arena pillar. */
export const PILLAR_HALF = 1.1;
export const PILLAR_H = 10;

function makeBox(id: string, x: number, z: number, hx: number, hy: number, hz: number): ArenaBox {
  return Object.freeze({
    id,
    kind: 'box' as const,
    min: Object.freeze([x - hx, 0, z - hz] as const),
    max: Object.freeze([x + hx, hy, z + hz] as const),
  });
}

/** Four symmetric AABB pillars at (±14, ±14), invariant under 90°/180° rotation. */
export const ARENA_SOLIDS: readonly ArenaBox[] = Object.freeze([
  makeBox('ne', 14, 14, PILLAR_HALF, PILLAR_H, PILLAR_HALF),
  makeBox('nw', -14, 14, PILLAR_HALF, PILLAR_H, PILLAR_HALF),
  makeBox('se', 14, -14, PILLAR_HALF, PILLAR_H, PILLAR_HALF),
  makeBox('sw', -14, -14, PILLAR_HALF, PILLAR_H, PILLAR_HALF),
]);

/** Ray vs axis-aligned box slab test. Returns distance t in [0, maxDist] or -1 on miss. */
export function rayBox(origin: Vec3, dir: Vec3, box: ArenaBox, maxDist: number): number {
  let tmin = 0;
  let tmax = maxDist;

  const ox = origin.x;
  const dx = dir.x;
  if (Math.abs(dx) < 1e-9) {
    if (ox < box.min[0] || ox > box.max[0]) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (box.min[0] - ox) * inv;
    let t2 = (box.max[0] - ox) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  const oy = origin.y;
  const dy = dir.y;
  if (Math.abs(dy) < 1e-9) {
    if (oy < box.min[1] || oy > box.max[1]) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (box.min[1] - oy) * inv;
    let t2 = (box.max[1] - oy) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  const oz = origin.z;
  const dz = dir.z;
  if (Math.abs(dz) < 1e-9) {
    if (oz < box.min[2] || oz > box.max[2]) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (box.min[2] - oz) * inv;
    let t2 = (box.max[2] - oz) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  return tmin >= 0 && tmin <= maxDist ? tmin : -1;
}

/** Closest hit against the 4 arena pillars along a unit ray, or null on miss. */
export function firstArenaSolid(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  ignoreId: string | null = null,
): RayHit | null {
  let bestT = maxDist + 1;
  let bestId: string | null = null;
  for (let i = 0; i < ARENA_SOLIDS.length; i++) {
    const solid = ARENA_SOLIDS[i];
    if (ignoreId !== null && solid.id === ignoreId) continue;
    const t = rayBox(origin, dir, solid, maxDist);
    if (t >= 0 && t < bestT) {
      bestT = t;
      bestId = solid.id;
    }
  }
  if (bestId === null) return null;
  return {
    t: bestT,
    x: origin.x + dir.x * bestT,
    y: origin.y + dir.y * bestT,
    z: origin.z + dir.z * bestT,
    id: bestId,
  };
}

/** First hit on the inside of the circular boundary wall, or null if missed. */
export function rayArenaWall(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null {
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-8) return null;
  const b = origin.x * dir.x + origin.z * dir.z;
  const c = origin.x * origin.x + origin.z * origin.z - ARENA_R * ARENA_R;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b + Math.sqrt(disc)) / a;
  if (!(t >= 0.4) || t > maxDist) return null;
  const y = origin.y + dir.y * t;
  if (y < 0 || y > ARENA_WALL_H) return null;
  return {
    t,
    x: origin.x + dir.x * t,
    y,
    z: origin.z + dir.z * t,
    id: 'wall',
  };
}

/** Closest grapple anchor on a pillar or the boundary wall. Never the floor. */
export function arenaHook(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null {
  let best = firstArenaSolid(origin, dir, maxDist, null);
  const wall = rayArenaWall(origin, dir, maxDist);
  if (wall && (!best || wall.t < best.t)) best = wall;
  return best;
}

/** True when a pillar sits on the segment, ignoring the anchor itself. */
export function arenaOccludes(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  ignoreId: string | null = null,
): boolean {
  if (maxDist <= 0) return false;
  return firstArenaSolid(origin, dir, maxDist, ignoreId) !== null;
}

/** Circle-vs-AABB push-out in XZ. Returns new (x, z) if overlapping, else null. */
export function pushCircleOutOfBox(
  x: number,
  z: number,
  box: ArenaBox,
  radius: number,
): { x: number; z: number } | null {
  const cx = Math.max(box.min[0], Math.min(x, box.max[0]));
  const cz = Math.max(box.min[2], Math.min(z, box.max[2]));
  const dx = x - cx;
  const dz = z - cz;
  const dist = Math.hypot(dx, dz);
  if (dist >= radius) return null;
  if (dist < 1e-6) {
    const left = x - box.min[0];
    const right = box.max[0] - x;
    const back = z - box.min[2];
    const fwd = box.max[2] - z;
    const m = Math.min(left, right, back, fwd);
    const pad = radius + 1e-4;
    if (m === left) return { x: box.min[0] - pad, z };
    if (m === right) return { x: box.max[0] + pad, z };
    if (m === back) return { x, z: box.min[2] - pad };
    return { x, z: box.max[2] + pad };
  }
  const k = (radius - dist) / dist + 1e-4;
  return { x: x + dx * k, z: z + dz * k };
}

/** Push a player capsule out of all 4 arena pillars. */
export function pushOutOfPillars(
  pos: { x: number; y: number; z: number },
  radius: number,
  height: number,
): void {
  const feet = pos.y;
  const head = feet + height;
  const step = 0.4;
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < ARENA_SOLIDS.length; i++) {
      const s = ARENA_SOLIDS[i];
      if (s.max[1] <= feet + step + 0.02) continue;
      if (head <= s.min[1] + 0.01 || feet + step >= s.max[1]) continue;
      const next = pushCircleOutOfBox(pos.x, pos.z, s, radius);
      if (!next) continue;
      pos.x = next.x;
      pos.z = next.z;
    }
  }
}

/** Clamp a player inside the circular boundary wall and remove outward radial velocity. */
export function clampToArenaBounds(
  pos: { x: number; z: number },
  vel: { vx: number; vz: number },
  radius: number,
): void {
  const r = Math.hypot(pos.x, pos.z);
  const maxR = ARENA_R - radius;
  if (r > maxR && r > 0) {
    const nx = pos.x / r;
    const nz = pos.z / r;
    pos.x = nx * maxR;
    pos.z = nz * maxR;
    const vr = vel.vx * nx + vel.vz * nz;
    if (vr > 0) {
      vel.vx -= nx * vr;
      vel.vz -= nz * vr;
    }
  }
}

/** Highest walkable surface beneath (x, z) at feetY (pillar top or floor 0). */
export function pillarGroundHeight(
  x: number,
  z: number,
  radius: number,
  feetY: number,
  stepHeight = 0.4,
): number {
  let best = 0;
  for (let i = 0; i < ARENA_SOLIDS.length; i++) {
    const s = ARENA_SOLIDS[i];
    if (s.max[1] > feetY + stepHeight) continue;
    const cx = Math.max(s.min[0], Math.min(x, s.max[0]));
    const cz = Math.max(s.min[2], Math.min(z, s.max[2]));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz <= radius * radius) {
      if (s.max[1] > best) best = s.max[1];
    }
  }
  return best;
}
