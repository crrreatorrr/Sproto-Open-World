import type * as THREE from 'three';
import type { Entity } from '../../sim/entity';

export const lerpAngle = (a: number, b: number, t: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** Put a view between the entity's last two ticks (render interpolation, plan §2.3). */
export function placeEntity(root: THREE.Object3D, e: Readonly<Entity>, alpha: number): void {
  const { pos, prevPos, yaw, prevYaw } = e.tf;
  root.position.set(prevPos.x + (pos.x - prevPos.x) * alpha, prevPos.y + (pos.y - prevPos.y) * alpha, prevPos.z + (pos.z - prevPos.z) * alpha);
  root.rotation.y = lerpAngle(prevYaw, yaw, alpha);
}

/** Critically-ish damped spring step toward 0 (procedural recoil and wobble). */
export function spring(s: { x: number; v: number }, k: number, damping: number, dt: number): void {
  const h = Math.min(dt, 1 / 30);
  s.v += (-k * s.x - damping * s.v) * h;
  s.x += s.v * h;
}
