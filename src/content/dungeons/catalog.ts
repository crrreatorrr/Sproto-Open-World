/**
 * Complete catalog of all 10 instanced Campaign Dungeons (L01-L10), adapted from Sproto Shooter's
 * v2 (L01-L05) and legacy corridor (L06-L10) campaign levels for Sproto Open World.
 *
 * Pure content module: no three.js, DOM, Math.random, timers, or Rapier.
 */
import type {
  DungeonBoxPrimitive,
  DungeonCylinderPrimitive,
  DungeonDef,
  DungeonId,
  DungeonMaterial,
  DungeonPrimitive,
  DungeonRampPrimitive,
  DungeonTerrainDef,
  Vec3Tuple,
} from './types';

function box(
  id: string,
  at: Vec3Tuple,
  size: Vec3Tuple,
  material: DungeonMaterial,
  yaw = 0,
): DungeonBoxPrimitive {
  return { kind: 'box', id, at, size, yaw, material };
}

function ramp(
  id: string,
  at: Vec3Tuple,
  size: Vec3Tuple,
  material: DungeonMaterial,
  yaw = 0,
): DungeonRampPrimitive {
  return { kind: 'ramp', id, at, size, yaw, material };
}

function pillar(
  id: string,
  at: Vec3Tuple,
  r: number,
  h: number,
  material: DungeonMaterial,
): DungeonCylinderPrimitive {
  return { kind: 'cylinder', id, at, r, h, material };
}

/**
 * Helper to lay out a corridor/room section floor + side walls + cover + optional elevated flank.
 * Floor top surface sits at `y = baseY` (slab thickness 1m).
 */
function buildSection(
  prefix: string,
  x0: number,
  length: number,
  width: number,
  floorMat: DungeonMaterial,
  wallMat: DungeonMaterial,
  coverMat: DungeonMaterial,
  opts: {
    baseY?: number;
    wallHeight?: number;
    pillars?: boolean;
    rampUp?: { xOffset: number; zOffset: number; yaw?: number };
    ceiling?: boolean;
  } = {},
): DungeonPrimitive[] {
  const baseY = opts.baseY ?? 0;
  const wallH = opts.wallHeight ?? 6;
  const cx = x0 + length / 2;
  const halfW = width / 2;
  const out: DungeonPrimitive[] = [
    box(`${prefix}-floor`, [cx, baseY - 0.5, 0], [length, 1, width], floorMat),
    box(`${prefix}-wall-n`, [cx, baseY + wallH / 2, -halfW - 0.4], [length, wallH, 0.8], wallMat),
    box(`${prefix}-wall-s`, [cx, baseY + wallH / 2, halfW + 0.4], [length, wallH, 0.8], wallMat),
  ];
  if (opts.ceiling) {
    out.push(box(`${prefix}-ceil`, [cx, baseY + wallH + 0.3, 0], [length, 0.6, width], wallMat));
  }
  // Waist-high tactical cover boxes along the lane
  out.push(
    box(`${prefix}-cov-a`, [x0 + length * 0.32, baseY + 0.75, -width * 0.22], [2.4, 1.5, 3.6], coverMat),
    box(`${prefix}-cov-b`, [x0 + length * 0.64, baseY + 0.75, width * 0.22], [2.4, 1.5, 3.6], coverMat),
  );
  if (opts.pillars) {
    out.push(
      pillar(`${prefix}-pil-n`, [cx, baseY + wallH / 2, -width * 0.28], 1.1, wallH, wallMat),
      pillar(`${prefix}-pil-s`, [cx, baseY + wallH / 2, width * 0.28], 1.1, wallH, wallMat),
    );
  }
  if (opts.rampUp) {
    const rx = x0 + opts.rampUp.xOffset;
    const rz = opts.rampUp.zOffset;
    out.push(
      ramp(`${prefix}-ramp`, [rx, baseY + 1.25, rz], [8, 2.5, 4], coverMat, opts.rampUp.yaw ?? 0),
      box(`${prefix}-plat`, [rx + 8, baseY + 2.25, rz], [8, 0.5, 5], floorMat),
    );
  }
  return out;
}

/** Deterministic undulating terrain patch (pure math, zero Math.random). */
function makeTerrainPatch(
  id: string,
  origin: Vec3Tuple,
  size: readonly [number, number],
  cols: number,
  rows: number,
  amp: number,
): DungeonTerrainDef {
  const heights: number[] = [];
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const u = ix / (cols - 1);
      const v = iz / (rows - 1);
      // Keep edges near 0 so terrain meets adjacent slabs smoothly.
      const edgeFade = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      const h = edgeFade * amp * (0.6 * Math.sin(u * Math.PI * 3) + 0.4 * Math.cos(v * Math.PI * 2));
      heights.push(Math.round(h * 1000) / 1000);
    }
  }
  return { id, origin, size, cols, rows, heights };
}

// --------------------------------------------------------------------------- L01 - L10

const L01: DungeonDef = {
  id: 'L01',
  name: 'Sproto Landing',
  subtitle: 'Dusk Strip-Mall Drop & Plaza Siege',
  act: 1,
  suggestedLevel: 2,
  regionId: 'sproutvale',
  unlockAbility: 'slide',
  skyColor: 0x3b2c4a,
  fogColor: 0x4b385c,
  fogNear: 28,
  fogFar: 135,
  sunColor: 0xffa06b,
  ambientColor: 0x6f5a8c,
  spawn: [4, 0, 0],
  exit: [184, 0, 0],
  solids: [
    ...buildSection('L01-S1', 0, 56, 26, 'concrete', 'concrete', 'metal', {
      rampUp: { xOffset: 24, zOffset: -7, yaw: 0 },
    }),
    ...buildSection('L01-S2', 56, 58, 32, 'concrete', 'concrete', 'concrete', {
      pillars: true,
      rampUp: { xOffset: 20, zOffset: 8, yaw: 90 },
    }),
    ...buildSection('L01-S3', 114, 78, 42, 'concrete', 'metal', 'concrete', {
      pillars: true,
      wallHeight: 8,
    }),
    // Backstop walls
    box('L01-west-cap', [-0.4, 3, 0], [0.8, 6, 26], 'concrete'),
    box('L01-east-cap', [192.4, 4, 0], [0.8, 8, 42], 'metal'),
  ],
  checkpoints: [
    { id: 'L01-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L01-CP1', pos: [60, 0, 0], radius: 4.5 },
    { id: 'L01-CP2', pos: [120, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L01-GA1', pos: [36, 7.5, -7], radius: 14 },
    { id: 'L01-GA2', pos: [148, 8.5, 0], radius: 16 },
  ],
  noGrapple: [{ min: [114, 10, -21], max: [192, 20, 21] }],
  encounters: [
    {
      id: 'L01-E1',
      triggerPos: [28, 0, 0],
      triggerRadius: 12,
      lockdownDoorId: 'L01-door-1',
      enemies: [
        { kind: 'midget', count: 4, level: 2 },
        { kind: 'obama', count: 2, level: 2 },
      ],
    },
    {
      id: 'L01-E2',
      triggerPos: [84, 0, 0],
      triggerRadius: 13,
      lockdownDoorId: 'L01-door-2',
      enemies: [
        { kind: 'riotMidget', count: 3, level: 3 },
        { kind: 'obama', count: 3, level: 3 },
      ],
    },
    {
      id: 'L01-BOSS',
      triggerPos: [148, 0, 0],
      triggerRadius: 16,
      lockdownDoorId: 'L01-door-boss',
      enemies: [
        { kind: 'midget', count: 4, level: 3 },
        { kind: 'bigObama', count: 1, level: 4 },
      ],
      boss: 'bigObama',
    },
  ],
  mechanisms: [
    { id: 'L01-door-1', kind: 'door', pos: [56, 2.5, 0], size: [1.2, 5, 26] },
    { id: 'L01-door-2', kind: 'door', pos: [114, 2.5, 0], size: [1.2, 5, 32] },
    { id: 'L01-door-boss', kind: 'door', pos: [176, 3, 0], size: [1.2, 6, 42] },
    { id: 'L01-sw-1', kind: 'switch', pos: [50, 1.2, -10], size: [1.6, 2.4, 1.6], targetId: 'L01-door-1' },
  ],
  rewardGun: 'gun_handgun',
  rewardSprouts: 120,
  rewardXp: 350,
};

const L02: DungeonDef = {
  id: 'L02',
  name: 'The Grand Bazaar',
  subtitle: 'Sun-Baked Souk & RugMaster Showroom',
  act: 1,
  suggestedLevel: 4,
  regionId: 'town',
  unlockAbility: 'dash',
  skyColor: 0xd88c4a,
  fogColor: 0xc97e42,
  fogNear: 30,
  fogFar: 150,
  sunColor: 0xffd28a,
  ambientColor: 0x9c6c4a,
  spawn: [4, 0, 0],
  exit: [192, 0, 0],
  solids: [
    ...buildSection('L02-S1', 0, 60, 28, 'sand', 'stone', 'wood', {
      rampUp: { xOffset: 22, zOffset: 8, yaw: 0 },
    }),
    ...buildSection('L02-S2', 60, 62, 34, 'stone', 'stone', 'carpet', {
      pillars: true,
      rampUp: { xOffset: 24, zOffset: -9, yaw: 180 },
    }),
    ...buildSection('L02-SB', 122, 78, 46, 'carpet', 'stone', 'wood', {
      pillars: true,
      wallHeight: 9,
    }),
    box('L02-west-cap', [-0.4, 3, 0], [0.8, 6, 28], 'stone'),
    box('L02-east-cap', [200.4, 4.5, 0], [0.8, 9, 46], 'stone'),
  ],
  checkpoints: [
    { id: 'L02-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L02-CP1', pos: [64, 0, 0], radius: 4.5 },
    { id: 'L02-CP2', pos: [128, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L02-GA1', pos: [90, 8, -8], radius: 15 },
    { id: 'L02-GA2', pos: [158, 9, 0], radius: 18 },
  ],
  noGrapple: [{ min: [122, 12, -23], max: [200, 22, 23] }],
  encounters: [
    {
      id: 'L02-E1',
      triggerPos: [30, 0, 0],
      triggerRadius: 12,
      lockdownDoorId: 'L02-door-1',
      enemies: [
        { kind: 'midget', count: 5, level: 4 },
        { kind: 'boomMidget', count: 2, level: 4 },
      ],
    },
    {
      id: 'L02-E2',
      triggerPos: [92, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L02-door-2',
      enemies: [
        { kind: 'obama', count: 4, level: 4 },
        { kind: 'riotMidget', count: 2, level: 5 },
      ],
    },
    {
      id: 'L02-BOSS',
      triggerPos: [156, 0, 0],
      triggerRadius: 18,
      lockdownDoorId: 'L02-door-boss',
      enemies: [
        { kind: 'sahil', count: 1, level: 5 },
        { kind: 'midget', count: 4, level: 4 },
      ],
      boss: 'sahil',
    },
  ],
  mechanisms: [
    { id: 'L02-door-1', kind: 'door', pos: [60, 2.5, 0], size: [1.2, 5, 28] },
    { id: 'L02-door-2', kind: 'door', pos: [122, 2.5, 0], size: [1.2, 5, 34] },
    { id: 'L02-door-boss', kind: 'door', pos: [184, 3, 0], size: [1.2, 6, 46] },
    { id: 'L02-fire-ring', kind: 'hazard', pos: [156, 0.25, 0], size: [8, 0.5, 8], dps: 10 },
  ],
  rewardGun: 'gun_shotgun',
  rewardSprouts: 180,
  rewardXp: 520,
};

const L03: DungeonDef = {
  id: 'L03',
  name: 'The Vegetable Grove',
  subtitle: 'Twilight Canopy & Hex Auditor Clearing',
  act: 1,
  suggestedLevel: 6,
  regionId: 'river',
  unlockAbility: null,
  skyColor: 0x162b1a,
  fogColor: 0x1c3a18,
  fogNear: 20,
  fogFar: 115,
  sunColor: 0x9be08a,
  ambientColor: 0x3b6136,
  spawn: [4, 0, 0],
  exit: [196, 0, 0],
  solids: [
    ...buildSection('L03-S1', 0, 58, 30, 'grass', 'wood', 'wood', {
      pillars: true,
      rampUp: { xOffset: 24, zOffset: -8, yaw: 0 },
    }),
    ...buildSection('L03-S2', 58, 62, 34, 'grass', 'rock', 'wood', {
      pillars: true,
      rampUp: { xOffset: 26, zOffset: 9, yaw: 270 },
    }),
    ...buildSection('L03-SB', 120, 84, 48, 'grass', 'wood', 'rock', {
      pillars: true,
      wallHeight: 8,
    }),
    box('L03-west-cap', [-0.4, 3, 0], [0.8, 6, 30], 'wood'),
    box('L03-east-cap', [204.4, 4, 0], [0.8, 8, 48], 'wood'),
  ],
  terrain: makeTerrainPatch('L03-grove-floor', [126, 0, -18], [60, 36], 13, 9, 1.4),
  checkpoints: [
    { id: 'L03-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L03-CP1', pos: [62, 0, 0], radius: 4.5 },
    { id: 'L03-CP2', pos: [124, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L03-GA1', pos: [88, 9, 0], radius: 16 },
    { id: 'L03-GA2', pos: [160, 10, -10], radius: 18 },
    { id: 'L03-GA3', pos: [160, 10, 10], radius: 18 },
  ],
  noGrapple: [],
  encounters: [
    {
      id: 'L03-E1',
      triggerPos: [28, 0, 0],
      triggerRadius: 13,
      lockdownDoorId: 'L03-door-1',
      enemies: [
        { kind: 'hexAcolyte', count: 3, level: 6 },
        { kind: 'midget', count: 4, level: 6 },
      ],
    },
    {
      id: 'L03-E2',
      triggerPos: [88, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L03-door-2',
      enemies: [
        { kind: 'hexAcolyte', count: 3, level: 6 },
        { kind: 'bigObama', count: 1, level: 7 },
      ],
    },
    {
      id: 'L03-BOSS',
      triggerPos: [158, 0, 0],
      triggerRadius: 18,
      lockdownDoorId: 'L03-door-boss',
      enemies: [
        { kind: 'hexAuditor', count: 1, level: 7 },
        { kind: 'hexAcolyte', count: 3, level: 6 },
      ],
      boss: 'hexAuditor',
    },
  ],
  mechanisms: [
    { id: 'L03-door-1', kind: 'door', pos: [58, 2.5, 0], size: [1.2, 5, 30] },
    { id: 'L03-door-2', kind: 'door', pos: [120, 2.5, 0], size: [1.2, 5, 34] },
    { id: 'L03-door-boss', kind: 'door', pos: [188, 3, 0], size: [1.2, 6, 48] },
    { id: 'L03-spore-vent', kind: 'geyser', pos: [144, 0.4, -12], size: [3, 0.8, 3], power: 13 },
  ],
  rewardGun: 'gun_machinepistol',
  rewardSprouts: 240,
  rewardXp: 700,
};

const L04: DungeonDef = {
  id: 'L04',
  name: 'The Blockchain Void',
  subtitle: 'Aurora Ledger Platforms & Bitcoin Duo Podium',
  act: 2,
  suggestedLevel: 8,
  regionId: 'zen',
  unlockAbility: 'doubleJump',
  skyColor: 0x05050d,
  fogColor: 0x0b081c,
  fogNear: 45,
  fogFar: 220,
  sunColor: 0x8ef7c0,
  ambientColor: 0x6236a8,
  spawn: [4, 0, 0],
  exit: [202, 0, 0],
  solids: [
    ...buildSection('L04-S1', 0, 56, 26, 'void', 'neon', 'neon', {
      wallHeight: 3,
      rampUp: { xOffset: 24, zOffset: 0, yaw: 0 },
    }),
    ...buildSection('L04-S2', 62, 58, 32, 'void', 'neon', 'void', {
      wallHeight: 3,
      pillars: true,
    }),
    // Energy bridge spanning the 6m gap between S1 and S2
    box('L04-bridge-1', [59, -0.25, 0], [8, 0.5, 10], 'neon'),
    ...buildSection('L04-SB', 124, 86, 48, 'void', 'neon', 'neon', {
      wallHeight: 4,
      pillars: true,
    }),
    box('L04-bridge-2', [122, -0.25, 0], [6, 0.5, 10], 'neon'),
    box('L04-west-cap', [-0.4, 2, 0], [0.8, 4, 26], 'neon'),
    box('L04-east-cap', [210.4, 2, 0], [0.8, 4, 48], 'neon'),
  ],
  checkpoints: [
    { id: 'L04-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L04-CP1', pos: [68, 0, 0], radius: 4.5 },
    { id: 'L04-CP2', pos: [130, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L04-GA1', pos: [59, 7, 0], radius: 16 },
    { id: 'L04-GA2', pos: [122, 7, 0], radius: 16 },
    { id: 'L04-GA3', pos: [166, 11, 0], radius: 20 },
  ],
  noGrapple: [{ min: [152, 0, -8], max: [180, 14, 8] }],
  encounters: [
    {
      id: 'L04-E1',
      triggerPos: [28, 0, 0],
      triggerRadius: 12,
      lockdownDoorId: 'L04-door-1',
      enemies: [
        { kind: 'bitbug', count: 4, level: 8 },
        { kind: 'jetObama', count: 2, level: 8 },
      ],
    },
    {
      id: 'L04-E2',
      triggerPos: [92, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L04-door-2',
      enemies: [
        { kind: 'flyingMidget', count: 4, level: 8 },
        { kind: 'auditSniper', count: 2, level: 9 },
      ],
    },
    {
      id: 'L04-BOSS',
      triggerPos: [166, 0, 0],
      triggerRadius: 18,
      lockdownDoorId: 'L04-door-boss',
      enemies: [
        { kind: 'obamaDuo', count: 1, level: 9 },
        { kind: 'midgetDuo', count: 1, level: 9 },
      ],
      boss: 'obamaDuo',
    },
  ],
  mechanisms: [
    { id: 'L04-door-1', kind: 'door', pos: [56, 2.5, 0], size: [1.2, 5, 26] },
    { id: 'L04-door-2', kind: 'door', pos: [120, 2.5, 0], size: [1.2, 5, 32] },
    { id: 'L04-door-boss', kind: 'door', pos: [194, 3, 0], size: [1.2, 6, 48] },
    { id: 'L04-pad-1', kind: 'geyser', pos: [88, 0.3, -10], size: [3.5, 0.6, 3.5], power: 16 },
    { id: 'L04-mover-1', kind: 'mover', pos: [148, 2.5, 14], size: [6, 0.8, 6] },
  ],
  rewardGun: 'gun_sniper',
  rewardSprouts: 320,
  rewardXp: 950,
};

const L05: DungeonDef = {
  id: 'L05',
  name: 'Frostspire Black Site',
  subtitle: 'Polar-Night Ridge, Whiteout Pass & Ledger Vault',
  act: 2,
  suggestedLevel: 10,
  regionId: 'mountains',
  unlockAbility: 'grapple',
  skyColor: 0x0c1b2e,
  fogColor: 0x1a3452,
  fogNear: 22,
  fogFar: 120,
  sunColor: 0xaad6ff,
  ambientColor: 0x456e96,
  spawn: [4, 0, 0],
  exit: [204, 0, 0],
  solids: [
    ...buildSection('L05-S1', 0, 62, 30, 'ice', 'rock', 'metal', {
      rampUp: { xOffset: 24, zOffset: -9, yaw: 0 },
    }),
    ...buildSection('L05-S2', 62, 64, 36, 'metal', 'metal', 'metal', {
      pillars: true,
      ceiling: true,
      wallHeight: 8,
    }),
    ...buildSection('L05-SB', 126, 86, 48, 'ice', 'metal', 'ice', {
      pillars: true,
      wallHeight: 9,
      rampUp: { xOffset: 20, zOffset: 12, yaw: 180 },
    }),
    box('L05-west-cap', [-0.4, 3, 0], [0.8, 6, 30], 'rock'),
    box('L05-east-cap', [212.4, 4.5, 0], [0.8, 9, 48], 'metal'),
  ],
  terrain: makeTerrainPatch('L05-glacier', [4, 0, -13], [52, 26], 11, 7, 0.9),
  checkpoints: [
    { id: 'L05-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L05-CP1', pos: [66, 0, 0], radius: 4.5 },
    { id: 'L05-CP2', pos: [132, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L05-GA1', pos: [38, 9, 0], radius: 16 },
    { id: 'L05-GA2', pos: [96, 7.5, 0], radius: 16 },
    { id: 'L05-GA3', pos: [168, 10, 0], radius: 18 },
  ],
  noGrapple: [{ min: [62, 7.5, -18], max: [126, 12, 18] }],
  encounters: [
    {
      id: 'L05-E1',
      triggerPos: [30, 0, 0],
      triggerRadius: 13,
      lockdownDoorId: 'L05-door-1',
      enemies: [
        { kind: 'frostHound', count: 4, level: 10 },
        { kind: 'auditSniper', count: 2, level: 10 },
      ],
    },
    {
      id: 'L05-E2',
      triggerPos: [94, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L05-door-2',
      enemies: [
        { kind: 'spotterDrone', count: 3, level: 10 },
        { kind: 'riotMidget', count: 3, level: 11 },
      ],
    },
    {
      id: 'L05-BOSS',
      triggerPos: [166, 0, 0],
      triggerRadius: 18,
      lockdownDoorId: 'L05-door-boss',
      enemies: [
        { kind: 'auditor', count: 1, level: 11 },
        { kind: 'frostHound', count: 3, level: 10 },
      ],
      boss: 'auditor',
    },
  ],
  mechanisms: [
    { id: 'L05-door-1', kind: 'door', pos: [62, 2.5, 0], size: [1.2, 5, 30] },
    { id: 'L05-door-2', kind: 'door', pos: [126, 2.5, 0], size: [1.2, 5, 36] },
    { id: 'L05-door-boss', kind: 'door', pos: [196, 3, 0], size: [1.2, 6, 48] },
    { id: 'L05-sw-bunker', kind: 'switch', pos: [118, 1.2, -14], size: [1.6, 2.4, 1.6], targetId: 'L05-door-2' },
    { id: 'L05-cryo-leak', kind: 'hazard', pos: [94, 0.25, 8], size: [7, 0.5, 7], dps: 12 },
  ],
  rewardGun: 'gun_mg',
  rewardSprouts: 400,
  rewardXp: 1200,
};

const L06: DungeonDef = {
  id: 'L06',
  name: 'Vape Cabal Skyline',
  subtitle: 'Rain-Slicked Freeway, Crane Yard & Cabal Streets',
  act: 2,
  suggestedLevel: 12,
  regionId: 'waterfalls',
  unlockAbility: null,
  skyColor: 0x161a28,
  fogColor: 0x262e42,
  fogNear: 24,
  fogFar: 130,
  sunColor: 0x80aaff,
  ambientColor: 0x4b5678,
  spawn: [4, 0, 0],
  exit: [204, 0, 0],
  solids: [
    ...buildSection('L06-S1', 0, 56, 34, 'metal', 'metal', 'concrete', {
      rampUp: { xOffset: 22, zOffset: 9, yaw: 0 },
    }),
    ...buildSection('L06-S2', 56, 62, 40, 'metal', 'metal', 'metal', {
      pillars: true,
      rampUp: { xOffset: 24, zOffset: -11, yaw: 90 },
    }),
    ...buildSection('L06-S4', 118, 94, 50, 'concrete', 'concrete', 'neon', {
      pillars: true,
      wallHeight: 8,
    }),
    box('L06-west-cap', [-0.4, 3, 0], [0.8, 6, 34], 'metal'),
    box('L06-east-cap', [212.4, 4, 0], [0.8, 8, 50], 'concrete'),
  ],
  checkpoints: [
    { id: 'L06-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L06-CP1', pos: [60, 0, 0], radius: 4.5 },
    { id: 'L06-CP2', pos: [124, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L06-GA1', pos: [84, 10, -8], radius: 18 },
    { id: 'L06-GA2', pos: [162, 10, 0], radius: 18 },
  ],
  noGrapple: [],
  encounters: [
    {
      id: 'L06-E1',
      triggerPos: [28, 0, 0],
      triggerRadius: 13,
      lockdownDoorId: 'L06-door-1',
      enemies: [
        { kind: 'boomMidget', count: 3, level: 12 },
        { kind: 'riotMidget', count: 2, level: 12 },
      ],
    },
    {
      id: 'L06-E2',
      triggerPos: [86, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L06-door-2',
      enemies: [
        { kind: 'jetObama', count: 3, level: 12 },
        { kind: 'bitbug', count: 4, level: 12 },
      ],
    },
    {
      id: 'L06-BOSS',
      triggerPos: [162, 0, 0],
      triggerRadius: 18,
      lockdownDoorId: 'L06-door-boss',
      enemies: [
        { kind: 'broccoli', count: 1, level: 13 },
        { kind: 'balloonMidget', count: 2, level: 12 },
      ],
      boss: 'broccoli',
    },
  ],
  mechanisms: [
    { id: 'L06-door-1', kind: 'door', pos: [56, 2.5, 0], size: [1.2, 5, 34] },
    { id: 'L06-door-2', kind: 'door', pos: [118, 2.5, 0], size: [1.2, 5, 40] },
    { id: 'L06-door-boss', kind: 'door', pos: [196, 3, 0], size: [1.2, 6, 50] },
    { id: 'L06-crane-hook', kind: 'mover', pos: [86, 4.5, 0], size: [5, 0.8, 5] },
  ],
  rewardGun: 'gun_raygun',
  rewardSprouts: 480,
  rewardXp: 1500,
};

const L07: DungeonDef = {
  id: 'L07',
  name: 'Hellfire Underworks',
  subtitle: 'Magma Shafts, Furnace Gallery & Reactor Meltdown',
  act: 3,
  suggestedLevel: 14,
  regionId: 'rootdeep',
  unlockAbility: null,
  skyColor: 0x240b08,
  fogColor: 0x3b120c,
  fogNear: 18,
  fogFar: 105,
  sunColor: 0xff6b35,
  ambientColor: 0x702418,
  spawn: [4, 0, 0],
  exit: [208, 0, 0],
  solids: [
    ...buildSection('L07-S1', 0, 60, 32, 'rock', 'rock', 'metal', {
      ceiling: true,
      wallHeight: 8,
      rampUp: { xOffset: 24, zOffset: -8, yaw: 0 },
    }),
    ...buildSection('L07-S2', 60, 64, 38, 'rock', 'rock', 'rock', {
      pillars: true,
      ceiling: true,
      wallHeight: 9,
    }),
    ...buildSection('L07-S4', 124, 92, 46, 'rock', 'metal', 'rock', {
      pillars: true,
      wallHeight: 10,
      rampUp: { xOffset: 26, zOffset: 10, yaw: 270 },
    }),
    box('L07-west-cap', [-0.4, 4, 0], [0.8, 8, 32], 'rock'),
    box('L07-east-cap', [216.4, 5, 0], [0.8, 10, 46], 'metal'),
  ],
  checkpoints: [
    { id: 'L07-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L07-CP1', pos: [64, 0, 0], radius: 4.5 },
    { id: 'L07-CP2', pos: [130, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L07-GA1', pos: [92, 7.5, 0], radius: 15 },
    { id: 'L07-GA2', pos: [168, 8.5, 0], radius: 17 },
  ],
  noGrapple: [],
  encounters: [
    {
      id: 'L07-E1',
      triggerPos: [30, 0, 0],
      triggerRadius: 13,
      lockdownDoorId: 'L07-door-1',
      enemies: [
        { kind: 'miniTinubu', count: 2, level: 14 },
        { kind: 'midget', count: 4, level: 14 },
      ],
    },
    {
      id: 'L07-E2',
      triggerPos: [92, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L07-door-2',
      enemies: [
        { kind: 'miniTinubu', count: 2, level: 14 },
        { kind: 'boomMidget', count: 3, level: 14 },
      ],
    },
    {
      id: 'L07-BOSS',
      triggerPos: [166, 0, 0],
      triggerRadius: 18,
      lockdownDoorId: 'L07-door-boss',
      enemies: [
        { kind: 'miniTinubu', count: 3, level: 15 },
        { kind: 'boomMidget', count: 2, level: 15 },
      ],
      boss: 'miniTinubu',
    },
  ],
  mechanisms: [
    { id: 'L07-door-1', kind: 'door', pos: [60, 2.5, 0], size: [1.2, 5, 32] },
    { id: 'L07-door-2', kind: 'door', pos: [124, 2.5, 0], size: [1.2, 5, 38] },
    { id: 'L07-door-boss', kind: 'door', pos: [198, 3, 0], size: [1.2, 6, 46] },
    { id: 'L07-lava-run', kind: 'hazard', pos: [92, 0.25, 0], size: [10, 0.5, 10], dps: 14 },
    { id: 'L07-steam-vent', kind: 'geyser', pos: [148, 0.4, -12], size: [3.2, 0.8, 3.2], power: 14 },
  ],
  rewardGun: 'gun_bazooka',
  rewardSprouts: 560,
  rewardXp: 1850,
};

const L08: DungeonDef = {
  id: 'L08',
  name: 'Government Office',
  subtitle: 'Federal Lobby, Server Floor & Rooftop Standoff',
  act: 3,
  suggestedLevel: 16,
  regionId: 'town',
  unlockAbility: null,
  skyColor: 0x202b38,
  fogColor: 0x2c394a,
  fogNear: 26,
  fogFar: 135,
  sunColor: 0xdbeeff,
  ambientColor: 0x6f849c,
  spawn: [4, 0, 0],
  exit: [206, 0, 0],
  solids: [
    ...buildSection('L08-S1', 0, 56, 34, 'metal', 'metal', 'glass', {
      ceiling: true,
      wallHeight: 8,
      rampUp: { xOffset: 20, zOffset: 8, yaw: 0 },
    }),
    ...buildSection('L08-S2', 56, 62, 40, 'metal', 'metal', 'metal', {
      pillars: true,
      ceiling: true,
      wallHeight: 7.5,
    }),
    ...buildSection('L08-S4', 118, 96, 52, 'metal', 'concrete', 'metal', {
      pillars: true,
      wallHeight: 5,
      rampUp: { xOffset: 24, zOffset: -12, yaw: 180 },
    }),
    box('L08-west-cap', [-0.4, 4, 0], [0.8, 8, 34], 'metal'),
    box('L08-east-cap', [214.4, 2.5, 0], [0.8, 5, 52], 'concrete'),
  ],
  checkpoints: [
    { id: 'L08-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L08-CP1', pos: [60, 0, 0], radius: 4.5 },
    { id: 'L08-CP2', pos: [124, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L08-GA1', pos: [88, 6.8, 0], radius: 14 },
    { id: 'L08-GA2', pos: [166, 9, 0], radius: 18 },
  ],
  noGrapple: [{ min: [0, 7.5, -17], max: [56, 10, 17] }],
  encounters: [
    {
      id: 'L08-E1',
      triggerPos: [28, 0, 0],
      triggerRadius: 13,
      lockdownDoorId: 'L08-door-1',
      enemies: [{ kind: 'glowieAgent', count: 4, level: 16 }],
    },
    {
      id: 'L08-E2',
      triggerPos: [86, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L08-door-2',
      enemies: [
        { kind: 'auditSniper', count: 2, level: 16 },
        { kind: 'hexAcolyte', count: 2, level: 16 },
        { kind: 'riotMidget', count: 2, level: 16 },
      ],
    },
    {
      id: 'L08-BOSS',
      triggerPos: [164, 0, 0],
      triggerRadius: 18,
      lockdownDoorId: 'L08-door-boss',
      enemies: [
        { kind: 'glowie', count: 1, level: 17 },
        { kind: 'glowieAgent', count: 3, level: 16 },
      ],
      boss: 'glowie',
    },
  ],
  mechanisms: [
    { id: 'L08-door-1', kind: 'door', pos: [56, 2.5, 0], size: [1.2, 5, 34] },
    { id: 'L08-door-2', kind: 'door', pos: [118, 2.5, 0], size: [1.2, 5, 40] },
    { id: 'L08-door-boss', kind: 'door', pos: [198, 2.5, 0], size: [1.2, 5, 52] },
    { id: 'L08-sw-turnstile', kind: 'switch', pos: [50, 1.2, 12], size: [1.6, 2.4, 1.6], targetId: 'L08-door-1' },
    { id: 'L08-server-grid', kind: 'hazard', pos: [86, 0.3, 0], size: [8, 0.6, 8], dps: 10 },
  ],
  rewardGun: 'gun_bigbullets',
  rewardSprouts: 650,
  rewardXp: 2200,
};

const L09: DungeonDef = {
  id: 'L09',
  name: 'Moonlit Ruins',
  subtitle: 'Ruin Plains, Catacombs & The Moon Gate',
  act: 3,
  suggestedLevel: 18,
  regionId: 'zen',
  unlockAbility: null,
  skyColor: 0x0b1026,
  fogColor: 0x161f42,
  fogNear: 28,
  fogFar: 155,
  sunColor: 0xc2d4ff,
  ambientColor: 0x4b5c99,
  spawn: [4, 0, 0],
  exit: [212, 0, 0],
  solids: [
    ...buildSection('L09-S1', 0, 64, 42, 'rock', 'stone', 'stone', {
      pillars: true,
      rampUp: { xOffset: 24, zOffset: -10, yaw: 0 },
    }),
    ...buildSection('L09-S2', 64, 62, 46, 'stone', 'stone', 'rock', {
      pillars: true,
      ceiling: true,
      wallHeight: 8,
    }),
    ...buildSection('L09-S3', 126, 94, 58, 'stone', 'stone', 'stone', {
      pillars: true,
      wallHeight: 7,
      rampUp: { xOffset: 24, zOffset: 14, yaw: 90 },
    }),
    box('L09-west-cap', [-0.4, 3, 0], [0.8, 6, 42], 'stone'),
    box('L09-east-cap', [220.4, 3.5, 0], [0.8, 7, 58], 'stone'),
  ],
  checkpoints: [
    { id: 'L09-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L09-CP1', pos: [68, 0, 0], radius: 4.5 },
    { id: 'L09-CP2', pos: [132, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L09-GA1', pos: [34, 10, 0], radius: 18 },
    { id: 'L09-GA2', pos: [172, 11, -12], radius: 20 },
    { id: 'L09-GA3', pos: [172, 11, 12], radius: 20 },
  ],
  noGrapple: [],
  encounters: [
    {
      id: 'L09-E1',
      triggerPos: [32, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L09-door-1',
      enemies: [
        { kind: 'glowieAgent', count: 2, level: 18 },
        { kind: 'obama', count: 2, level: 18 },
        { kind: 'midget', count: 2, level: 18 },
      ],
    },
    {
      id: 'L09-E2',
      triggerPos: [94, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L09-door-2',
      enemies: [
        { kind: 'hexAcolyte', count: 3, level: 18 },
        { kind: 'sewerMidget', count: 3, level: 18 },
      ],
    },
    {
      id: 'L09-BOSS',
      triggerPos: [172, 0, 0],
      triggerRadius: 20,
      lockdownDoorId: 'L09-door-boss',
      enemies: [
        { kind: 'bigObama', count: 2, level: 19 },
        { kind: 'tinubu', count: 1, level: 19 },
      ],
      boss: 'bigObama',
    },
  ],
  mechanisms: [
    { id: 'L09-door-1', kind: 'door', pos: [64, 2.5, 0], size: [1.2, 5, 42] },
    { id: 'L09-door-2', kind: 'door', pos: [126, 2.5, 0], size: [1.2, 5, 46] },
    { id: 'L09-door-boss', kind: 'door', pos: [204, 3, 0], size: [1.2, 6, 58] },
    { id: 'L09-moon-pad', kind: 'geyser', pos: [152, 0.4, 0], size: [4, 0.8, 4], power: 16 },
  ],
  rewardGun: 'gun_duckgun',
  rewardSprouts: 800,
  rewardXp: 2600,
};

const L10: DungeonDef = {
  id: 'L10',
  name: 'Hellfire Caldera',
  subtitle: 'Geyser Fields, Demon Audit & Volcanic Eruption',
  act: 3,
  suggestedLevel: 20,
  regionId: 'rootdeep',
  unlockAbility: null,
  skyColor: 0x330804,
  fogColor: 0x521409,
  fogNear: 24,
  fogFar: 145,
  sunColor: 0xff5522,
  ambientColor: 0x993014,
  spawn: [4, 0, 0],
  exit: [222, 0, 0],
  solids: [
    ...buildSection('L10-S1', 0, 62, 36, 'rock', 'rock', 'rock', {
      rampUp: { xOffset: 24, zOffset: 10, yaw: 0 },
    }),
    ...buildSection('L10-S2', 62, 64, 44, 'rock', 'lava', 'rock', {
      pillars: true,
      rampUp: { xOffset: 22, zOffset: -12, yaw: 270 },
    }),
    ...buildSection('L10-S3', 126, 104, 62, 'rock', 'rock', 'lava', {
      pillars: true,
      wallHeight: 8,
    }),
    box('L10-west-cap', [-0.4, 3, 0], [0.8, 6, 36], 'rock'),
    box('L10-east-cap', [230.4, 4, 0], [0.8, 8, 62], 'rock'),
  ],
  checkpoints: [
    { id: 'L10-CP0', pos: [6, 0, 0], radius: 4 },
    { id: 'L10-CP1', pos: [66, 0, 0], radius: 4.5 },
    { id: 'L10-CP2', pos: [132, 0, 0], radius: 5 },
  ],
  grappleAnchors: [
    { id: 'L10-GA1', pos: [92, 11, 0], radius: 18 },
    { id: 'L10-GA2', pos: [176, 12, -16], radius: 22 },
    { id: 'L10-GA3', pos: [176, 12, 16], radius: 22 },
  ],
  noGrapple: [{ min: [164, 16, -24], max: [194, 30, 24] }],
  encounters: [
    {
      id: 'L10-E1',
      triggerPos: [30, 0, 0],
      triggerRadius: 14,
      lockdownDoorId: 'L10-door-1',
      enemies: [
        { kind: 'miniTinubu', count: 2, level: 20 },
        { kind: 'auditSniper', count: 2, level: 20 },
      ],
    },
    {
      id: 'L10-E2',
      triggerPos: [92, 0, 0],
      triggerRadius: 15,
      lockdownDoorId: 'L10-door-2',
      enemies: [
        { kind: 'boomMidget', count: 3, level: 20 },
        { kind: 'jetObama', count: 2, level: 20 },
      ],
    },
    {
      id: 'L10-BOSS',
      triggerPos: [176, 0, 0],
      triggerRadius: 20,
      lockdownDoorId: 'L10-door-boss',
      enemies: [
        { kind: 'tinubu', count: 1, level: 21 },
        { kind: 'flyingMidget', count: 3, level: 20 },
      ],
      boss: 'tinubu',
    },
  ],
  mechanisms: [
    { id: 'L10-door-1', kind: 'door', pos: [62, 2.5, 0], size: [1.2, 5, 36] },
    { id: 'L10-door-2', kind: 'door', pos: [126, 2.5, 0], size: [1.2, 5, 44] },
    { id: 'L10-door-boss', kind: 'door', pos: [212, 3.5, 0], size: [1.2, 7, 62] },
    { id: 'L10-geyser-1', kind: 'geyser', pos: [82, 0.4, -10], size: [3.5, 0.8, 3.5], power: 15 },
    { id: 'L10-geyser-2', kind: 'geyser', pos: [162, 0.4, 14], size: [3.5, 0.8, 3.5], power: 16 },
    { id: 'L10-lava-pool', kind: 'hazard', pos: [102, 0.25, 8], size: [10, 0.5, 10], dps: 16 },
  ],
  rewardGun: 'gun_bazooka',
  rewardSprouts: 1200,
  rewardXp: 3500,
};

export const DUNGEON_IDS: readonly DungeonId[] = [
  'L01',
  'L02',
  'L03',
  'L04',
  'L05',
  'L06',
  'L07',
  'L08',
  'L09',
  'L10',
];

export const DUNGEONS: Readonly<Record<DungeonId, DungeonDef>> = {
  L01,
  L02,
  L03,
  L04,
  L05,
  L06,
  L07,
  L08,
  L09,
  L10,
};

export const DUNGEON_LIST: readonly DungeonDef[] = DUNGEON_IDS.map((id) => DUNGEONS[id]);

export function getDungeon(id: DungeonId): DungeonDef {
  return DUNGEONS[id];
}

export function getDungeonById(id: string): DungeonDef | undefined {
  return (DUNGEONS as Record<string, DungeonDef | undefined>)[id];
}
