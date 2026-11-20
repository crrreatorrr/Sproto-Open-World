/**
 * Mixed SOW + Sproto Shooter overworld camps, roaming world bosses, Sprouts-priced Weapon Box
 * shops, and all 10 Campaign Dungeon portals (`L01`–`L10`) across the 6 walkable overworld
 * regions + Rootdeep (unification plan §4.4 & §5.1).
 *
 * Pure data module: no three.js, DOM, Math.random, timers, storage, or Rapier.
 *
 * Region bounds (CELL_SIZE = 64 m; see `src/content/world/regions.ts`):
 * - sproutvale: x ∈ [0, 512),     z ∈ [0, 512)
 * - town:       x ∈ [512, 1536),  z ∈ [0, 512)      (Bellmere)
 * - zen:        x ∈ [0, 512),     z ∈ [512, 1536)   (Maple Terraces)
 * - river:      x ∈ [512, 1536),  z ∈ [512, 1536)   (Willowrun)
 * - mountains:  x ∈ [0, 768),     z ∈ [1536, 2560)  (Frostspine)
 * - waterfalls: x ∈ [768, 1536),  z ∈ [1536, 2560)  (Veilfalls)
 * - rootdeep:   x ∈ [4096, 4608), z ∈ [0, 512)      (Rootdeep cave)
 */
import type { AmmoType, GunItemId } from '../guns';
import type { RegionId } from '../world/regions';
import type { CampDef } from '../world/sproutvaleContent';

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

export type MovementUnlockId = 'slide' | 'dash' | 'doubleJump' | 'grapple';

export interface OverworldMixCampDef extends CampDef {
  /** Region whose rectangle contains this camp and all of its members. */
  region: RegionId;
  /** Human-readable encounter label for telemetry, maps, and HUD. */
  name: string;
  /** Target player level band for this encounter (scales Lv 1–30 across the 6 regions). */
  levelRange: readonly [number, number];
  /** True for roaming / shrine world-boss encounters. */
  isWorldBoss?: boolean;
}

export interface WeaponBoxGunStock {
  item: GunItemId;
  /** Price in Sprouts (never Run Tickets). */
  price: number;
  /** Optional recommended player level hint. */
  minLevel?: number;
}

export interface WeaponBoxAmmoBundle {
  id: string;
  name: string;
  ammoType: AmmoType;
  amount: number;
  /** Price in Sprouts (never Run Tickets). */
  price: number;
}

export interface WeaponBoxShopDef {
  id: string;
  name: string;
  region: RegionId;
  pos: readonly [number, number, number];
  yaw: number;
  /** Unified SOW economy: Sprouts only (no Run Tickets). */
  currency: 'sprouts';
  guns: readonly WeaponBoxGunStock[];
  ammoBundles: readonly WeaponBoxAmmoBundle[];
}

export interface BrickPhoneFastTravelDef {
  /** Unique Brick Phone waypoint ID. */
  waypointId: string;
  /** Short label shown on the Brick Phone dial list. */
  label: string;
  /** World flag set when the player discovers this portal on foot. */
  discoverFlag: string;
  /** Safe arrival offset (dx, dy, dz) in front of the portal pad. */
  arrivalOffset: readonly [number, number, number];
}

export interface DungeonPortalDef {
  id: string;
  dungeonId: DungeonId;
  name: string;
  act: 1 | 2 | 3;
  region: RegionId;
  landmark: string;
  pos: readonly [number, number, number];
  yaw: number;
  levelRange: readonly [number, number];
  /** Movement tech relic/ability unlocked by clearing this dungeon, if any. */
  unlocksAbility?: MovementUnlockId;
  /** Brick Phone fast-travel registration once discovered. */
  fastTravel: BrickPhoneFastTravelDef;
}

// ---------------------------------------------------------------------------
// 1. Mixed SOW + Shooter Overworld Camps & Roaming World Bosses (Lv 1–30)
// ---------------------------------------------------------------------------

export const OVERWORLD_MIX_CAMPS: readonly OverworldMixCampDef[] = [
  // ---- Sproutvale (x 0..512, z 0..512) — Lv 1–5 ----
  {
    id: 'mix_sproutvale_outskirts',
    name: 'Swarmer Clearing',
    region: 'sproutvale',
    levelRange: [1, 3],
    pos: [148, 12, 164],
    members: [
      { def: 'grunt', at: [-3.5, 1.5], yaw: 0.4 },
      { def: 'midget_swarmer', at: [3.2, -1.8], yaw: -1.2 },
      { def: 'midget_swarmer', at: [0.5, 4.0], yaw: 2.6 },
    ],
  },
  {
    id: 'mix_sproutvale_roadblock',
    name: 'East Road Ambush',
    region: 'sproutvale',
    levelRange: [3, 5],
    pos: [412, 12, 296],
    members: [
      { def: 'grunt_vet', at: [-4.0, 2.0], yaw: 0.8 },
      { def: 'midget_swarmer', at: [3.5, 2.5], yaw: -0.9 },
      { def: 'slinger', at: [0, -4.5], yaw: 0 },
      { def: 'flying_midget', at: [5.0, -3.0], yaw: -1.5 },
    ],
  },

  // ---- Bellmere / town (x 512..1536, z 0..512) — Lv 5–10 & Lv 20–23 ----
  {
    id: 'mix_bellmere_outer_market',
    name: 'Bellmere Coin Alley',
    region: 'town',
    levelRange: [5, 8],
    pos: [664, 12, 168],
    members: [
      { def: 'midget_swarmer', at: [-4.0, 3.0], yaw: 0.6 },
      { def: 'midget_swarmer', at: [4.0, 2.0], yaw: -0.8 },
      { def: 'bitcoin_obama', at: [0, -4.0], yaw: 0 },
      { def: 'slinger', at: [-3.0, -4.5], yaw: 0.3 },
    ],
  },
  {
    id: 'mix_bellmere_plaza_patrol',
    name: 'Bellmere Plaza Patrol',
    region: 'town',
    levelRange: [8, 10],
    pos: [960, 14, 288],
    members: [
      { def: 'brute', at: [0, 0], yaw: Math.PI },
      { def: 'bitcoin_obama', at: [-5.5, -3.0], yaw: 0.5 },
      { def: 'flying_midget', at: [5.5, -2.5], yaw: -0.7 },
      { def: 'wisp', at: [0, 5.5], yaw: Math.PI },
    ],
  },
  {
    id: 'mix_bellmere_citadel_guard',
    name: 'Upper Citadel Audit Squad',
    region: 'town',
    levelRange: [20, 23],
    pos: [1344, 24, 344],
    members: [
      { def: 'big_bitcoin_obama', at: [0, 0], yaw: Math.PI },
      { def: 'shooter_bot', at: [-6.0, 3.0], yaw: 0.9 },
      { def: 'laser_bot', at: [6.0, 3.0], yaw: -0.9 },
      { def: 'bitcoin_obama', at: [0, -5.5], yaw: 0 },
    ],
  },

  // ---- Maple Terraces / zen (x 0..512, z 512..1536) — Lv 8–14 & Lv 24–26 ----
  {
    id: 'mix_maple_lower_terrace',
    name: 'Maple Border Skirmish',
    region: 'zen',
    levelRange: [8, 11],
    pos: [240, 16, 672],
    members: [
      { def: 'grunt_vet', at: [-4.5, 2.5], yaw: 0.5 },
      { def: 'flying_midget', at: [4.5, 2.5], yaw: -0.5 },
      { def: 'wisp', at: [-3.0, -4.0], yaw: 0.3 },
      { def: 'bitcoin_obama', at: [3.5, -4.0], yaw: -0.3 },
    ],
  },
  {
    id: 'mix_maple_lantern_grove',
    name: 'Lantern Grove Heavy Squad',
    region: 'zen',
    levelRange: [12, 14],
    pos: [320, 20, 1024],
    members: [
      { def: 'big_bitcoin_obama', at: [0, 0], yaw: 0 },
      { def: 'midget_swarmer', at: [-5.0, 3.5], yaw: 0.8 },
      { def: 'midget_swarmer', at: [5.0, 3.5], yaw: -0.8 },
      { def: 'wisp', at: [0, -5.5], yaw: Math.PI },
    ],
  },
  {
    id: 'mix_maple_high_shrine_boss',
    name: 'Hex Sahil — Moonlit Shrine Manifestation',
    region: 'zen',
    levelRange: [24, 26],
    isWorldBoss: true,
    pos: [248, 28, 1264],
    members: [
      { def: 'hex_sahil', at: [0, 0], yaw: Math.PI, unique: 'world_boss_hex_sahil_maple' },
      { def: 'flying_midget', at: [-7.0, 4.0], yaw: 2.4 },
      { def: 'flying_midget', at: [7.0, 4.0], yaw: -2.4 },
    ],
  },

  // ---- Willowrun / river (x 512..1536, z 512..1536) — Lv 12–18 ----
  {
    id: 'mix_willowrun_ford',
    name: 'Willowrun River Crossing',
    region: 'river',
    levelRange: [12, 15],
    pos: [768, 14, 832],
    members: [
      { def: 'rivet_gunner', at: [-5.0, -2.0], yaw: 0.4 },
      { def: 'bitcoin_obama', at: [5.0, -2.0], yaw: -0.4 },
      { def: 'flying_midget', at: [0, 5.0], yaw: Math.PI },
      { def: 'brute', at: [0, -4.5], yaw: 0 },
    ],
  },
  {
    id: 'mix_willowrun_cliff_watch',
    name: 'Skyline Cliff Garrison',
    region: 'river',
    levelRange: [16, 18],
    pos: [1184, 20, 1216],
    members: [
      { def: 'shooter_bot', at: [-5.5, 2.0], yaw: 0.6 },
      { def: 'laser_bot', at: [5.5, 2.0], yaw: -0.6 },
      { def: 'big_bitcoin_obama', at: [0, -4.0], yaw: 0 },
      { def: 'flying_midget', at: [-4.0, -5.5], yaw: 0.3 },
    ],
  },

  // ---- Veilfalls / waterfalls (x 768..1536, z 1536..2560) — Lv 18–26 ----
  {
    id: 'mix_veilfalls_basin',
    name: 'Veilfalls Mist Outpost',
    region: 'waterfalls',
    levelRange: [18, 21],
    pos: [1024, 18, 1792],
    members: [
      { def: 'laser_bot', at: [-5.0, 3.0], yaw: 0.8 },
      { def: 'shooter_bot', at: [5.0, 3.0], yaw: -0.8 },
      { def: 'wisp', at: [-4.5, -4.5], yaw: 0.4 },
      { def: 'big_bitcoin_obama', at: [3.5, -4.0], yaw: -0.5 },
    ],
  },
  {
    id: 'mix_veilfalls_drake_roost',
    name: 'Skyfire Drake — Veilfalls Overlook',
    region: 'waterfalls',
    levelRange: [22, 26],
    isWorldBoss: true,
    pos: [1280, 32, 2240],
    members: [
      { def: 'skyfire_drake', at: [0, 0], yaw: Math.PI, unique: 'world_boss_drake_veilfalls' },
      { def: 'flying_midget', at: [-8.0, 5.0], yaw: 2.2 },
      { def: 'flying_midget', at: [8.0, 5.0], yaw: -2.2 },
    ],
  },

  // ---- Frostspine / mountains (x 0..768, z 1536..2560) — Lv 16–30 ----
  {
    id: 'mix_frostspine_pass',
    name: 'Frostspine Lower Pass Blockade',
    region: 'mountains',
    levelRange: [16, 19],
    pos: [288, 24, 1824],
    members: [
      { def: 'gatekeeper', at: [0, 0], yaw: Math.PI },
      { def: 'shooter_bot', at: [-6.0, 4.0], yaw: 2.5 },
      { def: 'bitcoin_obama', at: [6.0, 4.0], yaw: -2.5 },
      { def: 'midget_swarmer', at: [0, 6.5], yaw: Math.PI },
    ],
  },
  {
    id: 'mix_frostspine_ridge',
    name: 'Glacier Ridge Heavy Battery',
    region: 'mountains',
    levelRange: [22, 25],
    pos: [576, 36, 2080],
    members: [
      { def: 'hollow_giant', at: [0, 0], yaw: Math.PI },
      { def: 'laser_bot', at: [-6.5, -3.5], yaw: 0.6 },
      { def: 'big_bitcoin_obama', at: [6.5, -3.5], yaw: -0.6 },
      { def: 'flying_midget', at: [0, 6.5], yaw: Math.PI },
    ],
  },
  {
    id: 'mix_frostspine_summit_boss',
    name: 'Mega Tinubu — Frostspine Summit Tyrant',
    region: 'mountains',
    levelRange: [28, 30],
    isWorldBoss: true,
    pos: [384, 46, 2304],
    members: [
      { def: 'mega_tinubu', at: [0, 0], yaw: Math.PI, unique: 'world_boss_mega_tinubu_summit' },
      { def: 'laser_bot', at: [-8.0, 5.0], yaw: 2.3 },
      { def: 'shooter_bot', at: [8.0, 5.0], yaw: -2.3 },
    ],
  },
];

// ---------------------------------------------------------------------------
// 2. Sprouts-Priced Weapon Box Shops (All 9 Fixed Guns + Ammo — No Run Tickets)
// ---------------------------------------------------------------------------

const STANDARD_AMMO_BUNDLES: readonly WeaponBoxAmmoBundle[] = [
  { id: 'ammo_light_pack', name: 'Light Ammo Crate (×120)', ammoType: 'light', amount: 120, price: 25 },
  { id: 'ammo_shells_pack', name: 'Shotgun Shells Pack (×24)', ammoType: 'shells', amount: 24, price: 30 },
  { id: 'ammo_sniper_pack', name: 'Sniper Rounds Box (×16)', ammoType: 'sniper', amount: 16, price: 45 },
  { id: 'ammo_rockets_pack', name: 'Rocket Tube Bundle (×6)', ammoType: 'rockets', amount: 6, price: 60 },
];

export const WEAPON_BOX_SHOPS: readonly WeaponBoxShopDef[] = [
  {
    id: 'weapon_box_sproutvale',
    name: 'Sproutvale Weapon Box',
    region: 'sproutvale',
    pos: [254, 13.5, 78],
    yaw: Math.PI * 0.75,
    currency: 'sprouts',
    guns: [
      { item: 'gun_mg', price: 80, minLevel: 1 },
      { item: 'gun_handgun', price: 70, minLevel: 1 },
      { item: 'gun_machinepistol', price: 110, minLevel: 2 },
      { item: 'gun_shotgun', price: 120, minLevel: 3 },
    ],
    ammoBundles: STANDARD_AMMO_BUNDLES,
  },
  {
    id: 'weapon_box_bellmere',
    name: 'Bellmere Grand Bazaar Weapon Box',
    region: 'town',
    pos: [736, 12, 232],
    yaw: Math.PI,
    currency: 'sprouts',
    guns: [
      { item: 'gun_mg', price: 80, minLevel: 1 },
      { item: 'gun_handgun', price: 70, minLevel: 1 },
      { item: 'gun_machinepistol', price: 110, minLevel: 2 },
      { item: 'gun_shotgun', price: 120, minLevel: 3 },
      { item: 'gun_sniper', price: 240, minLevel: 6 },
      { item: 'gun_bazooka', price: 280, minLevel: 7 },
    ],
    ammoBundles: STANDARD_AMMO_BUNDLES,
  },
  {
    id: 'weapon_box_rootdeep_hub',
    name: 'Rootdeep Vault Weapon Box',
    region: 'rootdeep',
    pos: [4312, 4, 240],
    yaw: Math.PI * 0.5,
    currency: 'sprouts',
    guns: [
      { item: 'gun_shotgun', price: 120, minLevel: 3 },
      { item: 'gun_sniper', price: 240, minLevel: 6 },
      { item: 'gun_bazooka', price: 280, minLevel: 7 },
      { item: 'gun_raygun', price: 540, minLevel: 12 },
    ],
    ammoBundles: STANDARD_AMMO_BUNDLES,
  },
  {
    id: 'weapon_box_maple_hub',
    name: 'Maple Terraces Shrine Weapon Box',
    region: 'zen',
    pos: [248, 20, 912],
    yaw: -Math.PI * 0.5,
    currency: 'sprouts',
    guns: [
      { item: 'gun_machinepistol', price: 110, minLevel: 2 },
      { item: 'gun_sniper', price: 240, minLevel: 6 },
      { item: 'gun_raygun', price: 540, minLevel: 12 },
      { item: 'gun_duckgun', price: 760, minLevel: 20 },
    ],
    ammoBundles: STANDARD_AMMO_BUNDLES,
  },
  {
    id: 'weapon_box_frostspine_hub',
    name: 'Frostspine Summit Weapon Box',
    region: 'mountains',
    pos: [352, 26, 1760],
    yaw: Math.PI,
    currency: 'sprouts',
    guns: [
      { item: 'gun_sniper', price: 240, minLevel: 6 },
      { item: 'gun_bazooka', price: 280, minLevel: 7 },
      { item: 'gun_raygun', price: 540, minLevel: 12 },
      { item: 'gun_bigbullets', price: 680, minLevel: 18 },
      { item: 'gun_duckgun', price: 760, minLevel: 20 },
    ],
    ammoBundles: STANDARD_AMMO_BUNDLES,
  },
];

// ---------------------------------------------------------------------------
// 3. All 10 Campaign Dungeon Portals (L01–L10, Plan §5.1) + Brick Phone Travel
// ---------------------------------------------------------------------------

export const DUNGEON_PORTALS: readonly DungeonPortalDef[] = [
  {
    id: 'portal_l01_sproto_landing',
    dungeonId: 'L01',
    name: 'Sproto Landing',
    act: 1,
    region: 'sproutvale',
    landmark: 'Sproutvale south-west outskirts',
    pos: [112, 12, 118],
    yaw: Math.PI * 0.25,
    levelRange: [3, 5],
    unlocksAbility: 'slide',
    fastTravel: {
      waypointId: 'ft_dungeon_l01',
      label: 'L01 · Sproto Landing',
      discoverFlag: 'discovered_dungeon_L01',
      arrivalOffset: [0, 0, 4],
    },
  },
  {
    id: 'portal_l02_grand_bazaar',
    dungeonId: 'L02',
    name: 'Grand Bazaar',
    act: 1,
    region: 'town',
    landmark: 'Bellmere market square',
    pos: [760, 12, 240],
    yaw: Math.PI,
    levelRange: [6, 8],
    unlocksAbility: 'dash',
    fastTravel: {
      waypointId: 'ft_dungeon_l02',
      label: 'L02 · Grand Bazaar',
      discoverFlag: 'discovered_dungeon_L02',
      arrivalOffset: [0, 0, -4],
    },
  },
  {
    id: 'portal_l03_vegetable_grove',
    dungeonId: 'L03',
    name: 'Vegetable Grove',
    act: 1,
    region: 'zen',
    landmark: 'Sproutvale / Maple Terraces border',
    pos: [224, 14, 528],
    yaw: Math.PI,
    levelRange: [8, 10],
    fastTravel: {
      waypointId: 'ft_dungeon_l03',
      label: 'L03 · Vegetable Grove',
      discoverFlag: 'discovered_dungeon_L03',
      arrivalOffset: [0, 0, -4],
    },
  },
  {
    id: 'portal_l04_blockchain_void',
    dungeonId: 'L04',
    name: 'Blockchain Void',
    act: 2,
    region: 'rootdeep',
    landmark: 'Rootdeep deep vault wing',
    pos: [4352, 4, 256],
    yaw: -Math.PI * 0.5,
    levelRange: [11, 13],
    unlocksAbility: 'doubleJump',
    fastTravel: {
      waypointId: 'ft_dungeon_l04',
      label: 'L04 · Blockchain Void',
      discoverFlag: 'discovered_dungeon_L04',
      arrivalOffset: [-4, 0, 0],
    },
  },
  {
    id: 'portal_l05_frostspire_black_site',
    dungeonId: 'L05',
    name: 'Frostspire Black Site',
    act: 2,
    region: 'mountains',
    landmark: 'Frostspine lower pass',
    pos: [320, 24, 1720],
    yaw: Math.PI,
    levelRange: [14, 16],
    unlocksAbility: 'grapple',
    fastTravel: {
      waypointId: 'ft_dungeon_l05',
      label: 'L05 · Frostspire Black Site',
      discoverFlag: 'discovered_dungeon_L05',
      arrivalOffset: [0, 0, -4],
    },
  },
  {
    id: 'portal_l06_vape_cabal_skyline',
    dungeonId: 'L06',
    name: 'Vape Cabal Skyline',
    act: 2,
    region: 'river',
    landmark: 'Willowrun high cliffs',
    pos: [1024, 22, 1088],
    yaw: -Math.PI * 0.75,
    levelRange: [17, 18],
    fastTravel: {
      waypointId: 'ft_dungeon_l06',
      label: 'L06 · Vape Cabal Skyline',
      discoverFlag: 'discovered_dungeon_L06',
      arrivalOffset: [0, 0, -4],
    },
  },
  {
    id: 'portal_l07_hellfire_underworks',
    dungeonId: 'L07',
    name: 'Hellfire Underworks',
    act: 2,
    region: 'waterfalls',
    landmark: 'Veilfalls cavern mouth',
    pos: [1152, 18, 1984],
    yaw: Math.PI,
    levelRange: [19, 20],
    fastTravel: {
      waypointId: 'ft_dungeon_l07',
      label: 'L07 · Hellfire Underworks',
      discoverFlag: 'discovered_dungeon_L07',
      arrivalOffset: [0, 0, -4],
    },
  },
  {
    id: 'portal_l08_government_office',
    dungeonId: 'L08',
    name: 'Government Office',
    act: 3,
    region: 'town',
    landmark: 'Bellmere upper citadel',
    pos: [1280, 26, 384],
    yaw: -Math.PI * 0.5,
    levelRange: [21, 24],
    fastTravel: {
      waypointId: 'ft_dungeon_l08',
      label: 'L08 · Government Office',
      discoverFlag: 'discovered_dungeon_L08',
      arrivalOffset: [-4, 0, 0],
    },
  },
  {
    id: 'portal_l09_moonlit_ruins',
    dungeonId: 'L09',
    name: 'Moonlit Ruins',
    act: 3,
    region: 'zen',
    landmark: 'Maple Terraces high shrine',
    pos: [256, 30, 1344],
    yaw: Math.PI,
    levelRange: [25, 27],
    fastTravel: {
      waypointId: 'ft_dungeon_l09',
      label: 'L09 · Moonlit Ruins',
      discoverFlag: 'discovered_dungeon_L09',
      arrivalOffset: [0, 0, -4],
    },
  },
  {
    id: 'portal_l10_hellfire_caldera',
    dungeonId: 'L10',
    name: 'Hellfire Caldera',
    act: 3,
    region: 'mountains',
    landmark: 'Frostspine caldera peak',
    pos: [448, 48, 2368],
    yaw: Math.PI,
    levelRange: [28, 30],
    fastTravel: {
      waypointId: 'ft_dungeon_l10',
      label: 'L10 · Hellfire Caldera',
      discoverFlag: 'discovered_dungeon_L10',
      arrivalOffset: [0, 0, -4],
    },
  },
];

export const DUNGEON_PORTAL_BY_ID: Readonly<Record<DungeonId, DungeonPortalDef>> = Object.fromEntries(
  DUNGEON_PORTALS.map((p) => [p.dungeonId, p]),
) as Readonly<Record<DungeonId, DungeonPortalDef>>;
