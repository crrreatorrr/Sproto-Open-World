import { AIM } from '../../content/combat';
import type { AimRay } from '../commands';
import type { Entity } from '../entity';
import type { Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { bodySegment, segmentSegmentDistSq } from './geometry';

export interface AimResult {
  /** The world point under the crosshair (on the target's body when there is one). */
  point: Vec3;
  /** The enemy under the crosshair, if any. */
  target: Entity | null;
}

const at = (r: AimRay, t: number): Vec3 => ({ x: r.from.x + r.dir.x * t, y: r.from.y + r.dir.y * t, z: r.from.z + r.dir.z * t });

/**
 * What the crosshair is on. The ray starts at the camera, but only counts from the player onward:
 * the camera sits behind the player, and nothing between the two can be aimed at.
 */
export function resolveAim(entities: readonly Entity[], physics: PhysicsWorld, p: Entity, ray: AimRay): AimResult {
  const { from, dir } = ray;
  const chestY = p.tf.pos.y + (p.body?.height ?? 1.8) * 0.55;
  const start = Math.max(0, (p.tf.pos.x - from.x) * dir.x + (chestY - from.y) * dir.y + (p.tf.pos.z - from.z) * dir.z);
  const hit = physics.raycast(at(ray, start), dir, AIM.range);
  // A ray that starts inside a prop beside the player is not aimed at that prop.
  const worldT = hit && hit.distance > 0.05 ? start + hit.distance : start + AIM.range;
  const a = at(ray, start);
  const b = at(ray, start + AIM.range);
  const flat2 = dir.x * dir.x + dir.z * dir.z;
  const tan = Math.tan((AIM.assistDeg * Math.PI) / 180);

  let target: Entity | null = null;
  let point = at(ray, worldT);
  let best = Infinity;
  for (const e of entities) {
    if (!e.combat || !e.body || e.combat.team === p.combat!.team || e.combat.action?.kind === 'dead') continue;
    const [b0, b1] = bodySegment(e.tf.pos, e.body.radius, e.body.height);
    const along = flat2 > 1e-6 ? ((e.tf.pos.x - from.x) * dir.x + (e.tf.pos.z - from.z) * dir.z) / flat2 : (b0.y - from.y) / dir.y;
    if (along < start - e.body.radius || along > start + AIM.range) continue;
    // Behind a wall (a little slack: a ray that lands on the ground at an enemy's feet is on them).
    if (along - e.body.radius - 0.5 > worldT) continue;
    const gap = Math.sqrt(segmentSegmentDistSq(a, b, b0, b1)) - e.body.radius;
    if (gap > Math.max(AIM.assistMin, along * tan)) continue;
    // On the body: the nearest wins. Beside it: the smallest miss wins, after any direct hit.
    const score = gap <= 0 ? along : 1000 + gap / Math.max(along, 1);
    if (score < best) {
      best = score;
      target = e;
      const y = from.y + dir.y * along;
      point = { x: e.tf.pos.x, y: Math.min(b1.y, Math.max(b0.y, y)), z: e.tf.pos.z };
    }
  }
  return { point, target };
}

/** The flat direction a swing at the crosshair goes (unit x, z). */
export function aimSwingDir(p: Entity, ray: AimRay, point: Vec3): { x: number; z: number } {
  const dx = point.x - p.tf.pos.x, dz = point.z - p.tf.pos.z;
  const d = Math.hypot(dx, dz);
  if (d >= AIM.meleeMinPoint) return { x: dx / d, z: dz / d };
  const f = Math.hypot(ray.dir.x, ray.dir.z) || 1;
  return { x: ray.dir.x / f, z: ray.dir.z / f };
}
