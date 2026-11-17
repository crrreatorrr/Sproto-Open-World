import RAPIER from '@dimforge/rapier3d-compat';
import { KCC } from '../../content/tuning';
import type { LevelDef } from '../../content/sandbox';
import type { Body, EntityId } from '../entity';
import type { Vec3 } from '../math';

/**
 * The only place the sim touches Rapier (plan §2.2, checked by tests/architecture.test.ts).
 * Rapier state is derived from entity state: `hash()` never reads it, and a restored snapshot
 * rebuilds the character bodies from the entities.
 */

/** Collision groups: bit = membership, mask = what it collides with or is queried against. */
export const GROUP = {
  WORLD: 1 << 0,
  CHARACTER: 1 << 1,
  HURTBOX: 1 << 2,
} as const;

const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

let initPromise: Promise<void> | null = null;

/** Load Rapier's WebAssembly once. Rejects if it cannot start (the app shows an error panel). */
export function initPhysics(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
}

export interface MoveResult {
  moved: Vec3;
  grounded: boolean;
}

/**
 * A character is a free-standing capsule collider (no rigid body): the sim owns its position and
 * places it directly, which the character controller reads immediately. A collider attached to a
 * kinematic body only syncs on `step()`, so the controller would read a stale position.
 */
interface CharacterBody {
  collider: RAPIER.Collider;
  /** Feet to capsule centre (m). */
  centerOffset: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly characters = new Map<EntityId, CharacterBody>();

  /** Call after `initPhysics()` has resolved. */
  constructor(level: LevelDef) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    const c = this.world.createCharacterController(KCC.offset);
    c.setMaxSlopeClimbAngle((KCC.maxSlopeDeg * Math.PI) / 180);
    c.setMinSlopeSlideAngle((KCC.minSlideDeg * Math.PI) / 180);
    c.enableAutostep(KCC.autostepHeight, KCC.autostepMinWidth, false);
    c.enableSnapToGround(KCC.snapToGround);
    c.setSlideEnabled(true);
    c.setApplyImpulsesToDynamicBodies(false);
    this.controller = c;
    this.buildLevel(level);
  }

  private buildLevel(level: LevelDef): void {
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const worldGroups = groups(GROUP.WORLD, 0xffff);
    const g = level.ground.size / 2;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(g, 0.5, g).setTranslation(0, -0.5, 0).setCollisionGroups(worldGroups), fixed);
    for (const s of level.shapes) {
      if (s.kind === 'box') {
        const q = quatYawPitch(s.yaw ?? 0, s.pitch ?? 0);
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2])
            .setTranslation(s.pos[0], s.pos[1], s.pos[2])
            .setRotation(q)
            .setCollisionGroups(worldGroups),
          fixed,
        );
      } else {
        this.world.createCollider(
          RAPIER.ColliderDesc.cylinder(s.height / 2, s.radius)
            .setTranslation(s.pos[0], s.pos[1] + s.height / 2, s.pos[2])
            .setCollisionGroups(worldGroups),
          fixed,
        );
      }
    }
    // Build the query structures so casts work before the first step.
    this.world.step();
  }

  addCharacter(id: EntityId, body: Body, feet: Vec3): void {
    this.removeCharacter(id);
    // The controller keeps a skin of KCC.offset between the capsule and the ground, and ignores
    // surfaces the capsule already penetrates (it falls through them). So the capsule hovers by
    // that skin: the entity's feet stay on the surface while the shape never starts inside it.
    const centerOffset = body.height / 2 + KCC.offset;
    const half = Math.max(0.01, body.height / 2 - body.radius);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(half, body.radius)
        .setTranslation(feet.x, feet.y + centerOffset, feet.z)
        .setCollisionGroups(groups(GROUP.CHARACTER, GROUP.WORLD)),
    );
    this.characters.set(id, { collider, centerOffset });
  }

  removeCharacter(id: EntityId): void {
    const c = this.characters.get(id);
    if (!c) return;
    this.world.removeCollider(c.collider, false);
    this.characters.delete(id);
  }

  removeAllCharacters(): void {
    for (const id of [...this.characters.keys()]) this.removeCharacter(id);
  }

  /**
   * Slide a character's capsule by `delta` against the world (step-up, slopes, snap to ground).
   * Moves the body for the next step and returns what it actually moved.
   */
  moveCharacter(id: EntityId, feet: Vec3, delta: Vec3): MoveResult {
    const c = this.characters.get(id);
    if (!c) return { moved: { x: delta.x, y: delta.y, z: delta.z }, grounded: false };
    // Start from the sim's position (it is the authority; Rapier state is derived from it).
    c.collider.setTranslation({ x: feet.x, y: feet.y + c.centerOffset, z: feet.z });
    this.controller.computeColliderMovement(c.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(GROUP.CHARACTER, GROUP.WORLD));
    const m = this.controller.computedMovement();
    const moved = { x: m.x, y: m.y, z: m.z };
    c.collider.setTranslation({ x: feet.x + moved.x, y: feet.y + moved.y + c.centerOffset, z: feet.z + moved.z });
    return { moved, grounded: this.controller.computedGrounded() };
  }

  /** Place a character instantly (spawn, respawn, snapshot restore). */
  teleport(id: EntityId, feet: Vec3): void {
    const c = this.characters.get(id);
    if (!c) return;
    c.collider.setTranslation({ x: feet.x, y: feet.y + c.centerOffset, z: feet.z });
  }

  step(): void {
    this.world.step();
  }

  /** Closest world hit along a ray. `dir` need not be normalized. */
  raycast(origin: Readonly<Vec3>, dir: Readonly<Vec3>, maxDist: number, mask: number = GROUP.WORLD): RayHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9) return null;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(origin, d), maxDist, true, undefined, groups(0xffff, mask));
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      distance: t,
      point: { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    };
  }

  /** Sweep a sphere from `origin` along `dir` (its length is the distance). Returns the free distance. */
  sphereCast(origin: Readonly<Vec3>, dir: Readonly<Vec3>, radius: number, mask: number = GROUP.WORLD): { distance: number } | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9) return null;
    const vel = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const hit = this.world.castShape(origin, { x: 0, y: 0, z: 0, w: 1 }, vel, new RAPIER.Ball(radius), 0, len, true, undefined, groups(0xffff, mask));
    return hit ? { distance: hit.time_of_impact } : null;
  }

  dispose(): void {
    this.world.free();
  }
}

function quatYawPitch(yaw: number, pitch: number): { x: number; y: number; z: number; w: number } {
  // q = qYaw * qPitch (pitch about local X, then yaw about Y).
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}
