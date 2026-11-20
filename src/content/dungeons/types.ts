/**
 * Unified campaign dungeon schema normalizing both v2 (L01-L05) and legacy corridor (L06-L10)
 * Sproto Shooter campaign levels into Sproto Open World's instanced dungeon format.
 *
 * Pure content module: no three.js, DOM, Math.random, timers, or Rapier.
 */
import type { RegionId } from '../world/regions';

export type Vec3Tuple = readonly [number, number, number];

export type DungeonId =
  | 'L01'
  | 'L02'
  | 'L03'
  | 'L04'
  | 'L05'
  | 'L06'
  | 'L07'
  | 'L08'
  | 'L09'
  | 'L10';

export type DungeonAct = 1 | 2 | 3;

export type DungeonAbilityUnlock = 'slide' | 'dash' | 'doubleJump' | 'grapple' | null;

export type DungeonMaterial =
  | 'concrete'
  | 'metal'
  | 'rock'
  | 'stone'
  | 'sand'
  | 'wood'
  | 'grass'
  | 'ice'
  | 'void'
  | 'neon'
  | 'lava'
  | 'carpet'
  | 'glass';

export interface DungeonBoxPrimitive {
  readonly kind: 'box';
  readonly id: string;
  /** Center position [x, y, z] in metres. */
  readonly at: Vec3Tuple;
  /** Full dimensions [widthX, heightY, depthZ] in metres. */
  readonly size: Vec3Tuple;
  /** Yaw rotation around Y in degrees (0, 90, 180, 270 or arbitrary). */
  readonly yaw?: number;
  readonly material: DungeonMaterial;
}

export interface DungeonRampPrimitive {
  readonly kind: 'ramp';
  readonly id: string;
  /** Center of the ramp's bounding box [x, y, z] in metres. */
  readonly at: Vec3Tuple;
  /** Full bounding dimensions [lengthX, heightY, widthZ] in metres. At yaw=0, rises toward +X. */
  readonly size: Vec3Tuple;
  /** Yaw rotation around Y in degrees (0 = rises +X, 90 = rises -Z, 180 = rises -X, 270 = rises +Z). */
  readonly yaw?: number;
  readonly material: DungeonMaterial;
}

export interface DungeonCylinderPrimitive {
  readonly kind: 'cylinder';
  readonly id: string;
  /** Center position [x, y, z] in metres. */
  readonly at: Vec3Tuple;
  /** Radius in metres. */
  readonly r: number;
  /** Full height in metres. */
  readonly h: number;
  /** Optional yaw in degrees. */
  readonly yaw?: number;
  readonly material: DungeonMaterial;
}

export type DungeonPrimitive =
  | DungeonBoxPrimitive
  | DungeonRampPrimitive
  | DungeonCylinderPrimitive;

export interface DungeonTerrainDef {
  readonly id: string;
  /** World-space origin [minX, baseY, minZ] of the terrain patch. */
  readonly origin: Vec3Tuple;
  /** Patch footprint [sizeX, sizeZ] in metres. */
  readonly size: readonly [number, number];
  /** Number of height samples along X (must be >= 2). */
  readonly cols: number;
  /** Number of height samples along Z (must be >= 2). */
  readonly rows: number;
  /** Row-major height samples (length = cols * rows, index = iz * cols + ix). */
  readonly heights: readonly number[];
}

export interface DungeonCheckpointDef {
  readonly id: string;
  readonly pos: Vec3Tuple;
  readonly radius: number;
}

export interface DungeonGrappleAnchorDef {
  readonly id: string;
  readonly pos: Vec3Tuple;
  readonly radius: number;
}

export interface DungeonAabb {
  readonly min: Vec3Tuple;
  readonly max: Vec3Tuple;
}

export interface DungeonEncounterEnemyDef {
  readonly kind: string;
  readonly count: number;
  readonly level: number;
}

export interface DungeonEncounterDef {
  readonly id: string;
  readonly triggerPos: Vec3Tuple;
  readonly triggerRadius: number;
  readonly lockdownDoorId?: string;
  readonly enemies: readonly DungeonEncounterEnemyDef[];
  readonly boss?: string;
}

export type DungeonMechanismKind = 'door' | 'switch' | 'geyser' | 'hazard' | 'mover';

export interface DungeonMechanismDef {
  readonly id: string;
  readonly kind: DungeonMechanismKind;
  readonly pos: Vec3Tuple;
  readonly size: Vec3Tuple;
  readonly targetId?: string;
  /** Upward launch power for geysers (m/s). */
  readonly power?: number;
  /** Damage per second for hazards. */
  readonly dps?: number;
}

export interface DungeonDef {
  readonly id: DungeonId;
  readonly name: string;
  readonly subtitle: string;
  readonly act: DungeonAct;
  readonly suggestedLevel: number;
  readonly regionId: RegionId;
  readonly unlockAbility: DungeonAbilityUnlock;
  readonly skyColor: number;
  readonly fogColor: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly sunColor: number;
  readonly ambientColor: number;
  readonly spawn: Vec3Tuple;
  readonly exit: Vec3Tuple;
  readonly exitRadius?: number;
  readonly solids: readonly DungeonPrimitive[];
  readonly terrain?: DungeonTerrainDef;
  readonly checkpoints: readonly DungeonCheckpointDef[];
  readonly grappleAnchors: readonly DungeonGrappleAnchorDef[];
  readonly noGrapple: readonly DungeonAabb[];
  readonly encounters: readonly DungeonEncounterDef[];
  readonly mechanisms: readonly DungeonMechanismDef[];
  readonly rewardGun?: string;
  readonly rewardSprouts: number;
  readonly rewardXp: number;
}
