/**
 * The M0 test yard: a flat ground plus a few shapes to prove step-up, slopes, ledges and camera
 * collision. Plain data shared by the sim (colliders) and the renderer (greybox meshes).
 */
export interface BoxDef {
  kind: 'box';
  /** Centre (m). */
  pos: [number, number, number];
  /** Half extents (m). */
  half: [number, number, number];
  /** Rotation about Y (rad). */
  yaw?: number;
  /** Rotation about X (rad): ramps. */
  pitch?: number;
  color?: number;
}

export interface CylinderDef {
  kind: 'cylinder';
  /** Base centre (m). */
  pos: [number, number, number];
  radius: number;
  height: number;
  color?: number;
}

export type ShapeDef = BoxDef | CylinderDef;

export interface EnemySpawn {
  def: string;
  pos: [number, number, number];
  yaw: number;
}

export interface LevelDef {
  id: string;
  spawn: { pos: [number, number, number]; yaw: number };
  /** Enemies placed by SimWorld.populate(). */
  enemies?: EnemySpawn[];
  /**
   * A flat square ground plane (the yard). Absent in a streamed world, where the ground comes
   * from cell heightfields loaded through SimWorld.loadCell.
   */
  ground?: { size: number; color: number };
  shapes: ShapeDef[];
}

const STONE = 0x9a8f86;
const MOSS = 0x7c9a5a;

export const SANDBOX: LevelDef = {
  id: 'sandbox',
  spawn: { pos: [0, 0, 0], yaw: 0 },
  // M1a: three training dummies in a row to the player's left, and the Brute in the open to the
  // north-east, far enough that you choose when to pull it.
  enemies: [
    { def: 'dummy_passive', pos: [5, 0, 4], yaw: Math.PI },
    { def: 'dummy_swing', pos: [9, 0, 4], yaw: Math.PI },
    { def: 'dummy_shooter', pos: [-6, 0, -14], yaw: 0 },
    { def: 'brute', pos: [0, 0, -24], yaw: 0 },
  ],
  ground: { size: 200, color: 0x6f9a4a },
  shapes: [
    // Four pillars in a ring (the M1 arena layout).
    { kind: 'cylinder', pos: [9, 0, 9], radius: 0.9, height: 5.5, color: STONE },
    { kind: 'cylinder', pos: [-9, 0, 9], radius: 0.9, height: 5.5, color: STONE },
    { kind: 'cylinder', pos: [9, 0, -9], radius: 0.9, height: 5.5, color: STONE },
    { kind: 'cylinder', pos: [-9, 0, -9], radius: 0.9, height: 5.5, color: STONE },
    // Steps: 0.3 m (autostep), 0.6 m (jump), then a 1.2 m ledge.
    { kind: 'box', pos: [-4, 0.15, 16], half: [1.5, 0.15, 1.5], color: MOSS },
    { kind: 'box', pos: [-1, 0.3, 16], half: [1.5, 0.3, 1.5], color: MOSS },
    { kind: 'box', pos: [2, 0.6, 16], half: [1.5, 0.6, 1.5], color: MOSS },
    // A 20° ramp up to a platform, and a 40° ramp beside it.
    { kind: 'box', pos: [16, 1.2, 2], half: [2, 0.2, 3.6], pitch: -Math.atan2(2.4, 7), color: STONE },
    { kind: 'box', pos: [16, 2.2, 9], half: [3, 0.2, 3], color: STONE },
    { kind: 'box', pos: [21, 2, 2], half: [1.2, 0.2, 3.1], pitch: -0.7, color: 0xb07a5a },
    // A wall to back the camera into.
    { kind: 'box', pos: [-16, 2, 0], half: [0.5, 2, 6], color: STONE },
  ],
};
