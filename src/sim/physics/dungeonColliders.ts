/**
 * Compiles any DungeonDef's solids (box, 6-vertex wedge ramp, cylinder), optional terrain
 * heightfield, and toggleable lockdown doors into Rapier3D fixed colliders.
 *
 * Lives under src/sim/physics/ so Rapier stays strictly isolated (checked by tests/architecture.test.ts).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { DungeonDef, DungeonId, DungeonRampPrimitive } from '../../content/dungeons/types';
import { GROUP } from './PhysicsWorld';

const WORLD_GROUPS = ((GROUP.WORLD & 0xffff) << 16) | 0xffff;

function quatYawDeg(yawDeg = 0): { x: number; y: number; z: number; w: number } {
  const half = ((yawDeg * Math.PI) / 180) * 0.5;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

/**
 * Build the 6 local-space vertices of a wedge ramp centered on `ramp.at`.
 * At yaw = 0, the ramp starts low at x = -hx and rises linearly to y = +hy at x = +hx.
 * Rotating by yaw (0 / 90 / 180 / 270 deg) orients the ascent toward +X / -Z / -X / +Z.
 */
export function buildRampWedgeVertices(ramp: Pick<DungeonRampPrimitive, 'size'>): Float32Array {
  const hx = ramp.size[0] * 0.5;
  const hy = ramp.size[1] * 0.5;
  const hz = ramp.size[2] * 0.5;
  return new Float32Array([
    // Bottom 4 corners (y = -hy)
    -hx, -hy, -hz,
    hx, -hy, -hz,
    hx, -hy, hz,
    -hx, -hy, hz,
    // Top ridge along x = +hx (y = +hy)
    hx, hy, -hz,
    hx, hy, hz,
  ]);
}

export interface CompiledDungeonColliders {
  readonly dungeonId: DungeonId;
  readonly colliderCount: number;
  readonly doorIds: readonly string[];
  /** Enable (sealed=true) or disable (sealed=false) a lockdown door collider. */
  setDoorSealed(doorId: string, sealed: boolean): boolean;
  /** Returns whether a lockdown door collider is currently sealed (solid). */
  isDoorSealed(doorId: string): boolean;
  /** Remove all compiled static bodies and door colliders from the Rapier world. */
  dispose(): void;
}

/**
 * Compile a DungeonDef's static geometry, optional terrain heightfield, and lockdown doors into
 * Rapier colliders on `world`.
 */
export function compileDungeonColliders(
  world: RAPIER.World,
  dungeon: DungeonDef,
  initialSealedDoors: readonly string[] = [],
): CompiledDungeonColliders {
  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const staticColliders: RAPIER.Collider[] = [];
  const terrainBodies: RAPIER.RigidBody[] = [];

  for (const solid of dungeon.solids) {
    if (solid.kind === 'box') {
      const desc = RAPIER.ColliderDesc.cuboid(
        solid.size[0] * 0.5,
        solid.size[1] * 0.5,
        solid.size[2] * 0.5,
      )
        .setTranslation(solid.at[0], solid.at[1], solid.at[2])
        .setRotation(quatYawDeg(solid.yaw ?? 0))
        .setCollisionGroups(WORLD_GROUPS);
      staticColliders.push(world.createCollider(desc, staticBody));
    } else if (solid.kind === 'ramp') {
      const verts = buildRampWedgeVertices(solid);
      const desc = RAPIER.ColliderDesc.convexHull(verts);
      if (!desc) {
        throw new Error(`Failed to build convexHull for dungeon ramp "${solid.id}" in ${dungeon.id}`);
      }
      desc
        .setTranslation(solid.at[0], solid.at[1], solid.at[2])
        .setRotation(quatYawDeg(solid.yaw ?? 0))
        .setCollisionGroups(WORLD_GROUPS);
      staticColliders.push(world.createCollider(desc, staticBody));
    } else {
      const desc = RAPIER.ColliderDesc.cylinder(solid.h * 0.5, solid.r)
        .setTranslation(solid.at[0], solid.at[1], solid.at[2])
        .setRotation(quatYawDeg(solid.yaw ?? 0))
        .setCollisionGroups(WORLD_GROUPS);
      staticColliders.push(world.createCollider(desc, staticBody));
    }
  }

  if (dungeon.terrain) {
    const t = dungeon.terrain;
    const expected = t.cols * t.rows;
    if (t.cols < 2 || t.rows < 2 || t.heights.length !== expected) {
      throw new Error(
        `Invalid terrain "${t.id}" in ${dungeon.id}: expected ${expected} heights (${t.cols}x${t.rows}), got ${t.heights.length}`,
      );
    }
    // Rapier heightfield stores heights column-major with rows along Z: index = ix * rows + iz.
    const colMajor = new Float32Array(expected);
    for (let iz = 0; iz < t.rows; iz++) {
      for (let ix = 0; ix < t.cols; ix++) {
        colMajor[ix * t.rows + iz] = t.heights[iz * t.cols + ix];
      }
    }
    const terrainBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        t.origin[0] + t.size[0] * 0.5,
        t.origin[1],
        t.origin[2] + t.size[1] * 0.5,
      ),
    );
    const hfDesc = RAPIER.ColliderDesc.heightfield(
      t.rows - 1,
      t.cols - 1,
      colMajor,
      { x: t.size[0], y: 1, z: t.size[1] },
    ).setCollisionGroups(WORLD_GROUPS);
    staticColliders.push(world.createCollider(hfDesc, terrainBody));
    terrainBodies.push(terrainBody);
  }

  const sealedSet = new Set(initialSealedDoors);
  const doors = new Map<string, { collider: RAPIER.Collider; sealed: boolean }>();
  for (const mech of dungeon.mechanisms) {
    if (mech.kind !== 'door') continue;
    const sealed = sealedSet.has(mech.id);
    const desc = RAPIER.ColliderDesc.cuboid(
      mech.size[0] * 0.5,
      mech.size[1] * 0.5,
      mech.size[2] * 0.5,
    )
      .setTranslation(mech.pos[0], mech.pos[1], mech.pos[2])
      .setCollisionGroups(WORLD_GROUPS)
      .setEnabled(sealed);
    const collider = world.createCollider(desc);
    doors.set(mech.id, { collider, sealed });
  }

  // Populate query pipeline / broadphase so raycasts work immediately before the first sim step.
  world.step();

  let disposed = false;

  return {
    dungeonId: dungeon.id,
    colliderCount: staticColliders.length + doors.size,
    doorIds: [...doors.keys()],

    setDoorSealed(doorId: string, sealed: boolean): boolean {
      if (disposed) return false;
      const entry = doors.get(doorId);
      if (!entry) return false;
      if (entry.sealed !== sealed) {
        entry.collider.setEnabled(sealed);
        entry.sealed = sealed;
        world.step();
      }
      return true;
    },

    isDoorSealed(doorId: string): boolean {
      return doors.get(doorId)?.sealed ?? false;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of doors.values()) {
        world.removeCollider(entry.collider, false);
      }
      doors.clear();
      for (const tb of terrainBodies) {
        world.removeRigidBody(tb);
      }
      terrainBodies.length = 0;
      world.removeRigidBody(staticBody);
      world.step();
    },
  };
}
