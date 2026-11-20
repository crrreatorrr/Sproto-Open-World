/**
 * The Rootdeep (cave plan, Design): eight hidden entrances, the cave's camps, levers, gate and chests.
 * Pure data, and only `import type` from the registries, so this module never takes part in an import cycle.
 * Pepe's quests arrive in a later quest. Nothing here is environment art.
 */
import type { EnemyDef, EnemyMoveDef } from '../enemies';
import type { ObjectDef } from '../objects';
import type { CampDef, Placement, RegionContent } from '../world/sproutvaleContent';

/** World x of local cave x 0. The cave sits east of Sproutvale, cell column 64. */
export const RD_X = 4096;

/** True on the cave's side of the world. The valley stays below this. */
export const isRootdeep = (x: number): boolean => x >= RD_X;

/** Set when the Collector's Map reveals the main door. Hedge North opens on this alone. */
export const DOOR_REVEALED_FLAG = 'rootdeep.door.revealed';

/** One mouth of the cave, on the surface or inside a hall. */
export interface PortalDef {
  id: string;
  key: string;
  side: 'surface' | 'cave';
  pos: [number, number, number];
  yaw: number;
  /** The portal id travel goes to. */
  to: string;
  /** Where you stand when you arrive at this portal (x, z). The sim drops you onto the floor. */
  arrive: [number, number];
  /** The interact prompt, already a verb. */
  verb: string;
}

/** `rootdeep.open.<key>`: set by using either mouth, which unseals the surface side. */
export const portalOpenFlag = (key: string): string => `rootdeep.open.${key}`;

/**
 * A cave mouth is always usable. A surface mouth needs its open flag, except Hedge North, which
 * also opens once the map has revealed it. Lost Relics being complete does not open anything.
 */
export function portalUsable(def: PortalDef, flags: Readonly<Record<string, number>>): boolean {
  if (def.side === 'cave') return true;
  if ((flags[portalOpenFlag(def.key)] ?? 0) !== 0) return true;
  return def.key === 'hedge_north' && (flags[DOOR_REVEALED_FLAG] ?? 0) !== 0;
}

/**
 * Surface mouths, from the Design table. `at` and `arrive` are world x, z. `hall` is the cave
 * hall's local centre. A cave mouth stands on that centre and arrives 3 m toward local (256, 256).
 */
const SURFACE: readonly {
  key: string;
  at: readonly [number, number];
  yaw: number;
  arrive: readonly [number, number];
  hall: readonly [number, number];
}[] = [
  { key: 'hedge_north', at: [79.1, 226.4], yaw: Math.PI, arrive: [79.1, 228], hall: [96, 96] },
  { key: 'hedge_south', at: [54.8, 133.6], yaw: 0, arrive: [54.8, 132], hall: [256, 56] },
  { key: 'hedge_village_east', at: [300, 123.6], yaw: 0, arrive: [300, 122], hall: [416, 96] },
  { key: 'hedge_village_west', at: [216, 123.6], yaw: 0, arrive: [216, 122], hall: [456, 256] },
  { key: 'rock_quarry_west', at: [342.9, 462.8], yaw: Math.PI / 2, arrive: [341.4, 462.8], hall: [416, 416] },
  { key: 'rock_quarry_south', at: [401.1, 393.7], yaw: 0, arrive: [401.1, 392.2], hall: [256, 456] },
  { key: 'rock_quarry_east', at: [451.4, 387.6], yaw: 0, arrive: [451.4, 386.1], hall: [96, 416] },
  { key: 'hedge_scarecrow', at: [164.6, 198.4], yaw: Math.PI, arrive: [164.6, 200], hall: [56, 256] },
];

/** 3 m from a hall's centre, toward the vault at local (256, 256), in world x, z. */
function caveArrive(hall: readonly [number, number]): [number, number] {
  const [lx, lz] = hall;
  const dx = 256 - lx;
  const dz = 256 - lz;
  const len = Math.hypot(dx, dz);
  return [RD_X + lx + (dx / len) * 3, lz + (dz / len) * 3];
}

function buildPortals(): Record<string, PortalDef> {
  const out: Record<string, PortalDef> = {};
  for (const s of SURFACE) {
    const surfaceId = `rd_surface_${s.key}`;
    const caveId = `rd_cave_${s.key}`;
    const verb = s.key.startsWith('rock_') ? 'Squeeze between the rocks' : 'Slip through the hedge';
    out[surfaceId] = {
      id: surfaceId, key: s.key, side: 'surface', pos: [s.at[0], 0, s.at[1]], yaw: s.yaw,
      to: caveId, arrive: [s.arrive[0], s.arrive[1]], verb,
    };
    out[caveId] = {
      id: caveId, key: s.key, side: 'cave', pos: [RD_X + s.hall[0], 0, s.hall[1]], yaw: 0,
      to: surfaceId, arrive: caveArrive(s.hall), verb: 'Climb out',
    };
  }
  return out;
}

/** Both mouths of every entrance, keyed by entity id. */
export const ROOTDEEP_PORTALS: Record<string, PortalDef> = buildPortals();

const portals: Placement[] = Object.values(ROOTDEEP_PORTALS).map((p) => ({ id: p.id, pos: p.pos, yaw: p.yaw }));

/**
 * Cave variants. Called from `enemies.ts` after the base definitions exist and before the elite
 * scale loop, so `rd_brute` and `deep_warden` are grown with `ENEMY_SIZES` instead of keeping the
 * pre-scale body. Each id copies its base and changes only what the plan names.
 */
export function registerRootdeepEnemies(table: Record<string, EnemyDef>): void {
  const variant = (id: string, baseId: string, patch: Partial<EnemyDef>): void => {
    const base = table[baseId];
    const moves: EnemyMoveDef[] = base.moves.map((m) => ({ ...m, hitbox: { ...m.hitbox } }));
    table[id] = { ...base, ...patch, id, moves };
  };
  const sight = { needsSight: true } as const;
  variant('rd_grunt', 'grunt_vet', { aggroRange: 14, leashRange: 24, ...sight });
  variant('rd_slinger', 'slinger', { aggroRange: 16, leashRange: 24, ...sight });
  variant('rd_wisp', 'wisp', { aggroRange: 14, leashRange: 24, ...sight });
  variant('rd_brute', 'brute', { aggroRange: 14, leashRange: 24, ...sight });
  // `grunt` keeps Pest Control counting them, the same way an Orchard Grunt does. `rootdeep_digger` is the quest tag.
  variant('rootdeep_digger', 'grunt_vet', { tags: ['grunt', 'rootdeep_digger'] });
  variant('deep_warden', 'hollow_giant', { name: 'Deep Warden', hp: 2400, xp: 900, level: 9, aggroRange: 24, leashRange: 40, ...sight });
}

/** Same string as `usedFlag` in objects.ts. Inlined so this file does not import that module. */
const leverFlag = (id: string) => `used:${id}`;

/** The three old levers, and the lock that opens the vault once all three are spent. */
export const ROOTDEEP_OBJECTS: Record<string, ObjectDef> = {
  rootdeep_lever_a: { id: 'rootdeep_lever_a', name: 'Old Lever', verb: 'Pull', model: 'lever' },
  rootdeep_lever_b: { id: 'rootdeep_lever_b', name: 'Old Lever', verb: 'Pull', model: 'lever' },
  rootdeep_lever_c: { id: 'rootdeep_lever_c', name: 'Old Lever', verb: 'Pull', model: 'lever' },
  rootdeep_vault_lock: {
    id: 'rootdeep_vault_lock',
    name: 'Vault Gate',
    verb: 'Open',
    model: 'gate_lock',
    requires: [{ flag: leverFlag('rootdeep_lever_a') }, { flag: leverFlag('rootdeep_lever_b') }, { flag: leverFlag('rootdeep_lever_c') }],
    refusal: 'Three old levers still hold it shut.',
    effects: [{ openGate: 'rootdeep_vault' }],
  },
};

/** Local chamber centres (Design table). World x is `RD_X` plus this. */
const CHAMBER = {
  h2: [256, 56], h3: [416, 96], h4: [456, 256], h5: [416, 416], h6: [256, 456], h7: [96, 416], h8: [56, 256],
  m2: [256, 148], m3: [344, 168], m4: [364, 256], m5: [344, 344], m6: [256, 364], m7: [168, 344], m8: [148, 256],
  p1: [36, 36], p2: [476, 36], p3: [476, 476], p4: [36, 476],
  vault: [256, 256],
} as const;

const world = (x: number, z: number): [number, number, number] => [RD_X + x, 0, z];

/** 8 m from a chamber's centre toward the vault at local (256, 256). */
function towardVault(from: readonly [number, number], metres: number): [number, number, number] {
  const dx = 256 - from[0];
  const dz = 256 - from[1];
  const len = Math.hypot(dx, dz);
  return world(from[0] + (dx / len) * metres, from[1] + (dz / len) * metres);
}

/**
 * A ring of `n` members `r` m from the camp centre, facing out. Copied from the private `ring` in
 * `sproutvaleContent.ts` so that file, and the valley tests that own it, stay untouched.
 */
function ring(def: string, n: number, r: number, from = 0): CampDef['members'] {
  return Array.from({ length: n }, (_, i) => {
    const a = from + (i / n) * Math.PI * 2;
    return { def, at: [Math.round(Math.sin(a) * r * 10) / 10, Math.round(Math.cos(a) * r * 10) / 10] as [number, number], yaw: a };
  });
}

const camp = (id: string, at: readonly [number, number], members: CampDef['members']): CampDef => ({ id, pos: world(at[0], at[1]), members });

const HALLS = ['h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'] as const;

/**
 * Cave content, plus the surface mouths, the diggers and the old hedge. Sproutvale's own counts
 * (enemies, camp spacing, the map border) stay about the valley. The game populates `WORLD_CONTENT`.
 */
export const ROOTDEEP_CONTENT: RegionContent = {
  npcs: [],
  shrines: [
    { id: 'shrine_rootdeep_lantern', pos: world(168, 168), yaw: 0 },
    { id: 'shrine_rootdeep_crossing', pos: world(256, 364), yaw: 0 },
  ],
  chests: [
    ...(['p1', 'p2', 'p3', 'p4'] as const).map((id) => ({
      id: `rd_chest_${id}`,
      pos: world(CHAMBER[id][0], CHAMBER[id][1]),
      yaw: 0,
      chest: { id: `rd_chest_${id}`, items: [{ item: 'heart', count: 1 }], sprouts: 80 },
    })),
    {
      id: 'chest_rootdeep_vault',
      pos: world(256, 280),
      yaw: 0,
      chest: { id: 'chest_rootdeep_vault', items: [{ item: 'staff_rootcleaver', count: 1 }], sprouts: 250 },
    },
  ],
  objects: [
    { id: 'rootdeep_lever_a', pos: towardVault(CHAMBER.m3, 8), yaw: 0 },
    { id: 'rootdeep_lever_b', pos: towardVault(CHAMBER.m5, 8), yaw: 0 },
    { id: 'rootdeep_lever_c', pos: towardVault(CHAMBER.m7, 8), yaw: 0 },
    { id: 'rootdeep_vault_lock', pos: world(256, 200), yaw: 0 },
  ],
  obstacles: [
    {
      id: 'gate_rootdeep_vault', model: 'gate_barrier', pos: world(256, 205), yaw: 0,
      shape: { kind: 'box', half: [5, 8, 1.2], yaw: 0 }, openFlag: 'gate:rootdeep_vault',
    },
  ],
  portals,
  enemies: [],
  camps: [
    camp('rd_m2', CHAMBER.m2, [...ring('rd_grunt', 5, 6), ...ring('rd_grunt', 3, 12)]),
    camp('rd_m3', CHAMBER.m3, [...ring('rd_slinger', 5, 12), ...ring('rd_grunt', 2, 4)]),
    camp('rd_m4', CHAMBER.m4, ring('rd_wisp', 4, 10)),
    camp('rd_m5', CHAMBER.m5, [
      { def: 'rd_brute', at: [5, 0], yaw: Math.PI / 2 },
      { def: 'rd_brute', at: [-5, 0], yaw: -Math.PI / 2 },
      ...ring('rd_grunt', 2, 10),
    ]),
    camp('rd_m6', CHAMBER.m6, [...ring('rd_grunt', 3, 6), ...ring('rd_slinger', 2, 13)]),
    camp('rd_m7', CHAMBER.m7, [{ def: 'rd_brute', at: [0, 0], yaw: 0 }, ...ring('rd_wisp', 2, 10)]),
    camp('rd_m8', CHAMBER.m8, [...ring('rd_slinger', 3, 12), ...ring('rd_wisp', 2, 7)]),
    ...HALLS.map((id) => camp(`rd_${id}`, CHAMBER[id], ring('rd_grunt', 2, 6))),
    camp('rd_vault', CHAMBER.vault, [{ def: 'deep_warden', at: [0, 12], yaw: Math.PI, unique: 'deep_warden' }]),
    // Surface, on the orchard side of the north hedge. Not a cave floor.
    { id: 'hedge_diggers', pos: [79, 0, 240], members: ring('rootdeep_digger', 4, 4) },
  ],
  triggers: [
    { id: 'old_hedge_wall', pos: [79, 0, 231], radius: 12 },
    { id: 'rootdeep_vault', pos: world(256, 256), radius: 24 },
  ],
};
