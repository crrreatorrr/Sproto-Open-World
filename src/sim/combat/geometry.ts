import type { Vec3 } from '../math';

/** Squared distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentSegmentDistSq(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-9;
  let s: number, t: number;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const x = rx + d1x * s - d2x * t, y = ry + d1y * s - d2y * t, z = rz + d1z * s - d2z * t;
  return x * x + y * y + z * z;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A character's capsule axis: from feet+radius to crown-radius. */
export function bodySegment(pos: Vec3, radius: number, height: number): [Vec3, Vec3] {
  return [
    { x: pos.x, y: pos.y + radius, z: pos.z },
    { x: pos.x, y: pos.y + Math.max(radius, height - radius), z: pos.z },
  ];
}

/** Rotate a point in an entity's frame (+Z forward, +X left, yaw about +Y) and add its position. */
export function toWorld(pos: Vec3, yaw: number, local: readonly [number, number, number]): Vec3 {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { x: pos.x + local[0] * c + local[2] * s, y: pos.y + local[1], z: pos.z - local[0] * s + local[2] * c };
}

/** Horizontal angle (radians, 0..PI) between an entity's facing and the direction to a point. */
export function angleTo(from: Vec3, yaw: number, to: Vec3): number {
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / len;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

export const yawTo = (from: Vec3, to: Vec3): number => Math.atan2(to.x - from.x, to.z - from.z);
export const flatDist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
