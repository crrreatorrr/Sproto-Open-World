/**
 * The Rootdeep (cave plan, Design): eight hidden entrances and the two cave shrines.
 * Pure data, and only `import type` from the registries, so this module never takes part in an import cycle.
 * Enemies, levers, chests and Pepe's quests arrive in later quests. Nothing here is environment art.
 */
import type { Placement, RegionContent } from '../world/sproutvaleContent';

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
 * Cave content only. Surface mouths live here too, so Sproutvale's own counts (enemies, camp
 * spacing, the map border) stay about the valley. The game populates `WORLD_CONTENT`, which joins the two.
 */
export const ROOTDEEP_CONTENT: RegionContent = {
  npcs: [],
  shrines: [
    { id: 'shrine_rootdeep_lantern', pos: [RD_X + 168, 0, 168], yaw: 0 },
    { id: 'shrine_rootdeep_crossing', pos: [RD_X + 256, 0, 364], yaw: 0 },
  ],
  chests: [],
  portals,
  enemies: [],
  triggers: [],
};
