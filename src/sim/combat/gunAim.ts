/**
 * Where a gun shot starts and where it goes. The crosshair (the camera's centre ray) only picks a
 * point in the world; the shot itself leaves the gun's barrel and travels to that point, so what
 * is drawn and what is hit are the same line. Pure: the world is reached through a ray callback.
 */
import { gunDef, GUNS, type GunRef } from '../../content/guns';
import type { AimRay } from '../commands';
import type { Vec3 } from '../math';
import { raycastEnemyZones, type HitboxEnemyInput } from './ballistics';

/** Distance to the first world surface along a unit ray, or null when nothing is within reach. */
export type WorldRay = (origin: Vec3, dir: Vec3, maxDist: number) => number | null;

export type GunHand = 'right' | 'left' | 'single';

export const GUN_AIM = {
  /** The player's chest above their feet (m): the shot's start when the barrel is inside a wall. */
  chestY: 1.45,
  /** The hand holding the gun, in the aim's frame (m): right of centre, above the feet. */
  handRight: 0.22,
  handUp: 1.55,
  /** The grip sits this far in front of the body; the barrel ends this share of the gun's length further. */
  gripForward: 0.3,
  barrelShare: 0.7,
  /** A crosshair point nearer than this does not bend the shot: it flies along the camera's ray (m). */
  minConverge: 3,
  /** The shot lands at least this far from the crosshair point before the HUD marks it as blocked (m). */
  blockedGap: 0.5,
  /** The longest crosshair ray (m). */
  maxRange: 150,
} as const;

const add = (a: Vec3, d: Vec3, t: number): Vec3 => ({ x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t });
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function unit(v: Vec3, fallback: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return len < 1e-8 ? fallback : { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** The barrel's end in the world: the hand's place beside the body, pushed out along the aim. */
export function simMuzzle(pos: Vec3, aimDir: Vec3, gun: GunRef, hand: GunHand = 'single'): Vec3 {
  const def = gunDef(gun) ?? GUNS.mg;
  const yaw = Math.atan2(aimDir.x, aimDir.z);
  // Yaw 0 faces +Z, so right is (-cos, 0, sin).
  const side = hand === 'left' ? -1 : 1;
  const rx = -Math.cos(yaw) * side, rz = Math.sin(yaw) * side;
  const reach = GUN_AIM.gripForward + def.length * GUN_AIM.barrelShare;
  return {
    x: pos.x + rx * GUN_AIM.handRight + aimDir.x * reach,
    y: pos.y + GUN_AIM.handUp + aimDir.y * reach,
    z: pos.z + rz * GUN_AIM.handRight + aimDir.z * reach,
  };
}

/**
 * The world point under the crosshair. The ray starts at the camera, but only counts from the
 * player onward: nothing between the camera and the player can be aimed at.
 */
export function crosshairPoint(
  ray: AimRay,
  pos: Vec3,
  enemies: readonly HitboxEnemyInput[],
  worldRay: WorldRay,
  maxRange: number = GUN_AIM.maxRange,
): Vec3 {
  const dir = unit(ray.dir, { x: 0, y: 0, z: 1 });
  const chest = { x: pos.x, y: pos.y + GUN_AIM.chestY, z: pos.z };
  const startT = Math.max(0, (chest.x - ray.from.x) * dir.x + (chest.y - ray.from.y) * dir.y + (chest.z - ray.from.z) * dir.z);
  const start = add(ray.from, dir, startT);
  let t = maxRange;
  const w = worldRay(start, dir, maxRange);
  // A ray that starts inside a prop beside the player is not aimed at that prop.
  if (w !== null && w > 0.05) t = Math.min(t, w);
  const e = raycastEnemyZones(start, dir, t, enemies);
  if (e) t = Math.min(t, e.t);
  return add(start, dir, t);
}

export interface ShotAim {
  /** Where the shot starts: the barrel, or the chest when the barrel is inside a wall. */
  origin: Vec3;
  /** Unit direction of the shot before spread. */
  dir: Vec3;
  /** The world point under the crosshair. */
  point: Vec3;
  /** Where the shot lands instead, when something stands between the barrel and the crosshair point. */
  blocked: Vec3 | null;
}

/**
 * Aim one shot: from the barrel to the crosshair point. Without a camera ray (tests, bots) the
 * shot flies straight along `fallbackDir` from the barrel.
 */
export function aimShot(params: {
  pos: Vec3;
  gun: GunRef;
  hand?: GunHand;
  ray: AimRay | undefined;
  fallbackDir: Vec3;
  enemies: readonly HitboxEnemyInput[];
  worldRay: WorldRay;
}): ShotAim {
  const { pos, gun, ray, enemies, worldRay } = params;
  const def = gunDef(gun) ?? GUNS.mg;
  const range = Math.min(GUN_AIM.maxRange, def.range.max);
  const camDir = unit(ray?.dir ?? params.fallbackDir, { x: 0, y: 0, z: 1 });
  const chest = { x: pos.x, y: pos.y + GUN_AIM.chestY, z: pos.z };

  let origin = simMuzzle(pos, camDir, gun, params.hand);
  const reach = dist(chest, origin);
  if (worldRay(chest, unit({ x: origin.x - chest.x, y: origin.y - chest.y, z: origin.z - chest.z }, camDir), reach) !== null) origin = chest;

  const point = ray ? crosshairPoint(ray, pos, enemies, worldRay, range) : add(origin, camDir, range);
  const toPoint = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z };
  const far = Math.hypot(toPoint.x, toPoint.y, toPoint.z);
  // The point must be far enough, and in front of the barrel, to steer the shot.
  const ahead = toPoint.x * camDir.x + toPoint.y * camDir.y + toPoint.z * camDir.z;
  const dir = far >= GUN_AIM.minConverge && ahead > 0 ? unit(toPoint, camDir) : camDir;

  let t = worldRay(origin, dir, range) ?? range;
  const e = raycastEnemyZones(origin, dir, t, enemies);
  if (e) t = Math.min(t, e.t);
  const lands = add(origin, dir, t);
  const blocked = dir !== camDir && dist(lands, point) > GUN_AIM.blockedGap && t < far - GUN_AIM.blockedGap ? lands : null;
  return { origin, dir, point, blocked };
}
