import RAPIER from '@dimforge/rapier3d-compat';
import { KCC } from '../../content/tuning';
import type { LevelDef } from '../../content/sandbox';
import { CELL_RES, CELL_SIZE, type CellColliders, type ColliderShape } from '../../content/world/format';
import type { Body, EntityId, Obstacle } from '../entity';
import type { Vec3 } from '../math';

type ObstacleShape = Obstacle['shape'];

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
  radius: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly characters = new Map<EntityId, CharacterBody>();
  private readonly barriers = new Map<EntityId, RAPIER.Collider>();

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
    if (level.ground) {
      const g = level.ground.size / 2;
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(g, 0.5, g).setTranslation(0, -0.5, 0).setCollisionGroups(worldGroups), fixed);
    }
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

  // ---------------------------------------------------------------- streamed cells

  private readonly cells = new Map<string, RAPIER.RigidBody>();

  /**
   * Create a cell's fixed body with its heightfield. Prop colliders are added separately (the sim
   * caps colliders created per tick). Rapier's heightfield is centred on its body and stores its
   * heights column-major with rows along Z, so our row-major grid (iz · 65 + ix) is transposed.
   */
  addCellBody(key: string, c: CellColliders): void {
    this.removeCell(key);
    const n = CELL_RES - 1;
    const colMajor = new Float32Array(CELL_RES * CELL_RES);
    for (let iz = 0; iz < CELL_RES; iz++) for (let ix = 0; ix < CELL_RES; ix++) colMajor[ix * CELL_RES + iz] = c.heights[iz * CELL_RES + ix];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(c.cx * CELL_SIZE + CELL_SIZE / 2, 0, c.cz * CELL_SIZE + CELL_SIZE / 2),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.heightfield(n, n, colMajor, { x: CELL_SIZE, y: 1, z: CELL_SIZE }).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
      body,
    );
    this.cells.set(key, body);
  }

  /** Add one prop collider (world space) to a cell's body. */
  addCellShape(key: string, s: ColliderShape): void {
    const body = this.cells.get(key);
    if (!body) return;
    const t = body.translation();
    const local = { x: s.pos[0] - t.x, y: s.pos[1] - t.y, z: s.pos[2] - t.z };
    const desc =
      s.kind === 'cylinder'
        ? RAPIER.ColliderDesc.cylinder(s.height / 2, s.radius)
        : RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]).setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) });
    this.world.createCollider(desc.setTranslation(local.x, local.y, local.z).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), body);
  }

  /** Remove a cell's body and every collider on it. */
  removeCell(key: string): void {
    const body = this.cells.get(key);
    if (!body) return;
    this.world.removeRigidBody(body);
    this.cells.delete(key);
  }

  hasCell(key: string): boolean {
    return this.cells.has(key);
  }

  // ---------------------------------------------------------------- obstacles

  /** Gate barriers and breakable pillars, by entity id: free-standing colliders the sim adds and drops. */
  private readonly obstacles = new Map<EntityId, RAPIER.Collider>();

  /** Add an obstacle's collider. `feet` is the ground under it; it reaches a little below that. */
  addObstacle(id: EntityId, feet: Vec3, shape: ObstacleShape): void {
    this.removeObstacle(id);
    const SINK = 1;
    const desc =
      shape.kind === 'cylinder'
        ? RAPIER.ColliderDesc.cylinder(shape.height / 2, shape.radius).setTranslation(feet.x, feet.y + shape.height / 2 - SINK, feet.z)
        : RAPIER.ColliderDesc.cuboid(shape.half[0], shape.half[1], shape.half[2])
            .setTranslation(feet.x, feet.y + shape.half[1] - SINK, feet.z)
            .setRotation({ x: 0, y: Math.sin(shape.yaw / 2), z: 0, w: Math.cos(shape.yaw / 2) });
    this.obstacles.set(id, this.world.createCollider(desc.setCollisionGroups(groups(GROUP.WORLD, 0xffff))));
  }

  removeObstacle(id: EntityId): void {
    const c = this.obstacles.get(id);
    if (!c) return;
    this.world.removeCollider(c, false);
    this.obstacles.delete(id);
  }

  hasObstacle(id: EntityId): boolean {
    return this.obstacles.has(id);
  }

  /** Every obstacle with a collider now (a restored snapshot may have dropped some of their entities). */
  obstacleIds(): EntityId[] {
    return [...this.obstacles.keys()];
  }

  /** Standing mounts' solid bodies, by entity id. */
  private readonly mountBodies = new Map<EntityId, { collider: RAPIER.Collider; x: number; y: number; z: number; yaw: number; solid: boolean }>();

  /**
   * Put a mount's solid box under it. Each mount keeps one collider for life and switches it on and
   * off, so getting on and off never changes the slots the characters' colliders sit in (a replay has
   * to meet them in the same order). `half` is half its width, length and height. Queries see the change from the next `step()`.
   */
  placeMountBody(id: EntityId, feet: Readonly<Vec3>, half: readonly [number, number, number], yaw: number, solid: boolean): void {
    const SINK = 1;
    const halfY = half[2] + SINK / 2;
    const y = feet.y + half[2] * 2 - halfY;
    let c = this.mountBodies.get(id);
    if (!c) {
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], halfY, half[1]).setCollisionGroups(groups(GROUP.WORLD, 0xffff)).setEnabled(false));
      c = { collider, x: NaN, y: NaN, z: NaN, yaw: NaN, solid: false };
      this.mountBodies.set(id, c);
    }
    // Only a real change touches Rapier: a moved collider costs the broad phase work on every step.
    if (c.x !== feet.x || c.y !== y || c.z !== feet.z || c.yaw !== yaw) {
      c.collider.setTranslation({ x: feet.x, y, z: feet.z });
      c.collider.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      Object.assign(c, { x: feet.x, y, z: feet.z, yaw });
    }
    if (c.solid !== solid) {
      c.collider.setEnabled(solid);
      c.solid = solid;
    }
  }

  /** Is this mount's body solid for queries right now? */
  mountBodySolid(id: EntityId): boolean {
    return this.mountBodies.get(id)?.solid ?? false;
  }

  /** The capsules mounts run on when called, by entity id. One each for life, switched on and off like their bodies. */
  private readonly mountRunners = new Map<EntityId, { collider: RAPIER.Collider; centerOffset: number; on: boolean }>();

  addMountRunner(id: EntityId, body: Body, feet: Readonly<Vec3>): void {
    const centerOffset = body.height / 2 + KCC.offset;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(Math.max(0.01, body.height / 2 - body.radius), body.radius)
        .setTranslation(feet.x, feet.y + centerOffset, feet.z)
        .setCollisionGroups(groups(GROUP.CHARACTER, GROUP.WORLD | GROUP.CHARACTER))
        .setEnabled(false),
    );
    this.mountRunners.set(id, { collider, centerOffset, on: false });
  }

  /** Switch a mount's running capsule on or off; while on, it stands where the mount is. */
  setMountRunning(id: EntityId, feet: Readonly<Vec3>, on: boolean): void {
    const r = this.mountRunners.get(id);
    if (!r) return;
    if (on) r.collider.setTranslation({ x: feet.x, y: feet.y + r.centerOffset, z: feet.z });
    if (r.on === on) return;
    r.collider.setEnabled(on);
    r.on = on;
  }

  /** Slide a called mount's capsule over the ground, as `moveCharacter` does for a character. */
  moveMount(id: EntityId, feet: Readonly<Vec3>, delta: Vec3): MoveResult {
    const r = this.mountRunners.get(id);
    if (!r) return { moved: { x: 0, y: 0, z: 0 }, grounded: false };
    r.collider.setTranslation({ x: feet.x, y: feet.y + r.centerOffset, z: feet.z });
    this.controller.computeColliderMovement(r.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(GROUP.CHARACTER, GROUP.WORLD | GROUP.CHARACTER));
    const m = this.controller.computedMovement();
    r.collider.setTranslation({ x: feet.x + m.x, y: feet.y + m.y + r.centerOffset, z: feet.z + m.z });
    return { moved: { x: m.x, y: m.y, z: m.z }, grounded: this.controller.computedGrounded() };
  }

  /** Is there room for a body this size standing here? Raised a little, so the slope under it doesn't count. */
  spotFree(feet: Readonly<Vec3>, body: Body): boolean {
    const RAISE = 0.5;
    const shape = new RAPIER.Capsule(Math.max(0.01, body.height / 2 - body.radius), body.radius);
    const at = { x: feet.x, y: feet.y + RAISE + body.height / 2, z: feet.z };
    return this.world.intersectionWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, groups(0xffff, GROUP.WORLD | GROUP.CHARACTER)) === null;
  }

  /**
   * Make a character's capsule this wide, in place (a rider takes on the width of their mount). Its
   * bottom stays at the feet: wider than the body is tall, it grows to a ball that tall, standing on them.
   */
  setCharacterRadius(id: EntityId, body: Body, radius: number): void {
    const c = this.characters.get(id);
    if (!c || c.radius === radius) return;
    const halfTall = Math.max(body.height / 2, radius + 0.01);
    const at = c.collider.translation();
    const feetY = at.y - c.centerOffset;
    c.collider.setShape(new RAPIER.Capsule(halfTall - radius, radius));
    c.centerOffset = halfTall + KCC.offset;
    c.collider.setTranslation({ x: at.x, y: feetY + c.centerOffset, z: at.z });
    c.radius = radius;
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
        .setCollisionGroups(groups(GROUP.CHARACTER, GROUP.WORLD | GROUP.CHARACTER)),
    );
    this.characters.set(id, { collider, centerOffset, radius: body.radius });
  }

  removeCharacter(id: EntityId): void {
    const c = this.characters.get(id);
    if (!c) return;
    this.world.removeCollider(c.collider, false);
    this.characters.delete(id);
  }

  hasCharacter(id: EntityId): boolean {
    return this.characters.has(id);
  }

  removeAllCharacters(): void {
    // Last first: Rapier reuses freed slots newest-first, so re-adding in the same order restores each
    // collider to its old slot, and contacts between characters resolve in the same order.
    for (const id of [...this.characters.keys()].reverse()) this.removeCharacter(id);
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
    // Characters slide against the world and against each other (no walking through the Brute).
    this.controller.computeColliderMovement(c.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(GROUP.CHARACTER, GROUP.WORLD | GROUP.CHARACTER));
    const m = this.controller.computedMovement();
    const moved = { x: m.x, y: m.y, z: m.z };
    c.collider.setTranslation({ x: feet.x + moved.x, y: feet.y + moved.y + c.centerOffset, z: feet.z + moved.z });
    return { moved, grounded: this.controller.computedGrounded() };
  }

  /**
   * A temporary solid box (Bramble Wall). It's in the world's collision group, so characters, spell
   * lines and projectiles all stop on it. Queries see it from the next `step()`.
   */
  addBarrier(id: EntityId, centre: Readonly<Vec3>, half: readonly [number, number, number], yaw: number): void {
    this.removeBarrier(id);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
    );
    this.barriers.set(id, collider);
  }

  removeBarrier(id: EntityId): void {
    const c = this.barriers.get(id);
    if (!c) return;
    this.world.removeCollider(c, false);
    this.barriers.delete(id);
  }

  removeAllBarriers(): void {
    for (const id of [...this.barriers.keys()]) this.removeBarrier(id);
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

  /** `sphereCast`, also giving the hit surface's normal (it faces back toward the sphere). */
  sphereCastNormal(origin: Readonly<Vec3>, dir: Readonly<Vec3>, radius: number, mask: number = GROUP.WORLD): { distance: number; normal: Vec3 } | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9) return null;
    const vel = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const hit = this.world.castShape(origin, { x: 0, y: 0, z: 0, w: 1 }, vel, new RAPIER.Ball(radius), 0, len, true, undefined, groups(0xffff, mask));
    if (!hit) return null;
    const n = hit.normal1;
    return { distance: hit.time_of_impact, normal: { x: n.x, y: n.y, z: n.z } };
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
