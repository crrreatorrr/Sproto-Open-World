import type { Vec3 } from './math';

export type EntityId = number;
export type PlayerId = number;
export type EntityKind = 'player' | 'enemy' | 'boss' | 'npc' | 'projectile' | 'area' | 'pickup' | 'interactable';

/** Transform. `prevPos` is the position at the start of the tick (render interpolation). */
export interface Transform {
  pos: Vec3;
  prevPos: Vec3;
  yaw: number;
  prevYaw: number;
  vel: Vec3;
}

/** A capsule body. Its Rapier collider lives in sim/physics, keyed by entity id. */
export interface Body {
  radius: number;
  height: number;
}

/** Ground movement state (player and, later, enemies). */
export interface Locomotion {
  grounded: boolean;
  sprinting: boolean;
  /** Ticks left in which a jump press still counts (pressed just before landing). */
  jumpBuffer: number;
  /** Ticks left after walking off a ledge in which a jump still works. */
  coyote: number;
  /** Planar speed this tick (m/s), for animation. */
  speed: number;
  /** Ticks since the last landing (0 while airborne). */
  landedTicks: number;
}

/**
 * Plain-data entity with optional components (plan §2.4). Everything here is cloneable and
 * hashable; nothing holds a class instance, a function or a three.js object.
 */
export interface Entity {
  id: EntityId;
  kind: EntityKind;
  tf: Transform;
  body?: Body;
  loco?: Locomotion;
  owner?: PlayerId;
  /** Presentation hint only: which model to draw. */
  view: { model: string; tint?: number };
}
