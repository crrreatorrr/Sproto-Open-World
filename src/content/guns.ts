/**
 * Fixed, iconic gun definitions (one gun per type), level/skill stat scaling, and range falloff.
 * Pure content module: no three.js, DOM, Math.random, timers, or Rapier.
 *
 * Simplified single-gun-per-type model: 9 distinct guns keyed by `GunType` and item id (`gun_*`),
 * with zero procedural parts, zero random qualities, and zero gun manufacturers.
 */
import type { AmmoReserves } from '../sim/entity';

export type GunType =
  | 'mg'
  | 'shotgun'
  | 'sniper'
  | 'bazooka'
  | 'handgun'
  | 'machinepistol'
  | 'raygun'
  | 'bigbullets'
  | 'duckgun';

export type GunItemId =
  | 'gun_mg'
  | 'gun_shotgun'
  | 'gun_sniper'
  | 'gun_bazooka'
  | 'gun_handgun'
  | 'gun_machinepistol'
  | 'gun_raygun'
  | 'gun_bigbullets'
  | 'gun_duckgun';

export const GUN_TYPE_IDS: readonly GunType[] = [
  'mg',
  'handgun',
  'machinepistol',
  'shotgun',
  'sniper',
  'bazooka',
  'raygun',
  'bigbullets',
  'duckgun',
];

export const GUN_ITEM_IDS: readonly GunItemId[] = [
  'gun_mg',
  'gun_handgun',
  'gun_machinepistol',
  'gun_shotgun',
  'gun_sniper',
  'gun_bazooka',
  'gun_raygun',
  'gun_bigbullets',
  'gun_duckgun',
];

export type GunRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type GunElement = 'fire' | 'shock' | 'goo';
export type AmmoType = keyof AmmoReserves;

export interface GunRange {
  /** Full-damage distance in metres. */
  full: number;
  /** Maximum effective distance in metres (0 damage beyond this). */
  max: number;
  /** Minimum damage multiplier at `max` range. */
  min: number;
}

export interface GunBaseStats {
  damage: number;
  fireRate: number;
  magSize: number;
  reloadTime: number;
  pellets: number;
  spread: number;
  adsSpread: number;
  critMult: number;
  critChance: number;
  elementChance: number;
  zoomFov: number;
  pierce: number;
  splashRadius: number;
  splashDamage: number;
  projectileSpeed: number;
  bounces: number;
  recoil: number;
  recoilYaw: number;
  swapTime: number;
}

export type ComputedGunStats = GunBaseStats;

export interface FixedGunDef {
  id: GunType;
  itemId: GunItemId;
  name: string;
  short: string;
  rarity: GunRarity;
  ammoType: AmmoType;
  element: GunElement | null;
  dualWield?: boolean;
  beam?: boolean;
  infiniteReserve?: boolean;
  projectile?: 'rocket' | 'bigBullet' | 'rubberBullet';
  zoomLevels?: 1 | 2;
  range: GunRange;
  base: GunBaseStats;
}

const baseStats = (o: Partial<GunBaseStats>): GunBaseStats => ({
  damage: 10,
  fireRate: 1,
  magSize: 1,
  reloadTime: 2,
  pellets: 1,
  spread: 1,
  adsSpread: 0.5,
  critMult: 2,
  critChance: 0.05,
  elementChance: 0,
  zoomFov: 52,
  pierce: 0,
  splashRadius: 0,
  splashDamage: 0,
  projectileSpeed: 0,
  bounces: 0,
  recoil: 1,
  recoilYaw: 0.2,
  swapTime: 0.5,
  ...o,
});

/**
 * The 9 fixed, iconic guns. Lv 1 base damage is normalized to SOW's combat scale (starter staff
 * ~20/hit, Arcane Bolt 12/shot) and scales cleanly across Lv 1–30.
 */
export const GUNS: Record<GunType, FixedGunDef> = {
  mg: {
    id: 'mg',
    itemId: 'gun_mg',
    name: 'Toy MG',
    short: 'MG',
    rarity: 'common',
    ammoType: 'light',
    element: null,
    range: { full: 30, max: 75, min: 0.5 },
    base: baseStats({
      damage: 6,
      fireRate: 10,
      magSize: 36,
      reloadTime: 2.5,
      pellets: 1,
      spread: 1.2,
      adsSpread: 0.45,
      critMult: 2.0,
      critChance: 0.05,
      zoomFov: 52,
      recoil: 0.35,
      recoilYaw: 0.15,
      swapTime: 0.5,
    }),
  },
  handgun: {
    id: 'handgun',
    itemId: 'gun_handgun',
    name: 'Handgun',
    short: 'HG',
    rarity: 'common',
    ammoType: 'light',
    element: null,
    dualWield: true,
    range: { full: 22, max: 55, min: 0.5 },
    base: baseStats({
      damage: 11,
      fireRate: 3.5,
      magSize: 12,
      reloadTime: 1.5,
      pellets: 1,
      spread: 1.0,
      adsSpread: 0.5,
      critMult: 2.2,
      critChance: 0.06,
      zoomFov: 52,
      recoil: 1.4,
      recoilYaw: 0.35,
      swapTime: 0.35,
    }),
  },
  machinepistol: {
    id: 'machinepistol',
    itemId: 'gun_machinepistol',
    name: 'Machine Pistol',
    short: 'MP',
    rarity: 'uncommon',
    ammoType: 'light',
    element: null,
    dualWield: true,
    range: { full: 14, max: 40, min: 0.4 },
    base: baseStats({
      damage: 5.2,
      fireRate: 11,
      magSize: 24,
      reloadTime: 1.8,
      pellets: 1,
      spread: 2.4,
      adsSpread: 1.4,
      critMult: 1.8,
      critChance: 0.04,
      zoomFov: 52,
      recoil: 0.45,
      recoilYaw: 0.3,
      swapTime: 0.35,
    }),
  },
  shotgun: {
    id: 'shotgun',
    itemId: 'gun_shotgun',
    name: 'Toy Shotgun',
    short: 'SG',
    rarity: 'common',
    ammoType: 'shells',
    element: null,
    range: { full: 7, max: 16, min: 0.3 },
    base: baseStats({
      damage: 5.5,
      fireRate: 1.2,
      magSize: 6,
      reloadTime: 2.4,
      pellets: 9,
      spread: 6.0,
      adsSpread: 4.5,
      critMult: 2.0,
      critChance: 0.03,
      zoomFov: 55,
      recoil: 3.5,
      recoilYaw: 1.0,
      swapTime: 0.5,
    }),
  },
  sniper: {
    id: 'sniper',
    itemId: 'gun_sniper',
    name: 'Toy Sniper',
    short: 'SN',
    rarity: 'rare',
    ammoType: 'sniper',
    element: null,
    zoomLevels: 2,
    range: { full: 120, max: 150, min: 1.0 },
    base: baseStats({
      damage: 58,
      fireRate: 0.8,
      magSize: 4,
      reloadTime: 2.6,
      pellets: 1,
      spread: 3.0,
      adsSpread: 0,
      critMult: 3.0,
      critChance: 0.08,
      zoomFov: 12,
      pierce: 1,
      recoil: 5.0,
      recoilYaw: 0.8,
      swapTime: 0.6,
    }),
  },
  bazooka: {
    id: 'bazooka',
    itemId: 'gun_bazooka',
    name: 'Toy Bazooka',
    short: 'BZ',
    rarity: 'rare',
    ammoType: 'rockets',
    element: null,
    projectile: 'rocket',
    range: { full: 40, max: 60, min: 1.0 },
    base: baseStats({
      damage: 85,
      fireRate: 0.6,
      magSize: 1,
      reloadTime: 2.2,
      pellets: 1,
      spread: 0.5,
      adsSpread: 0.2,
      critMult: 1.5,
      critChance: 0,
      zoomFov: 52,
      splashRadius: 4.0,
      splashDamage: 68,
      projectileSpeed: 28,
      recoil: 4.0,
      recoilYaw: 0.5,
      swapTime: 0.7,
    }),
  },
  raygun: {
    id: 'raygun',
    itemId: 'gun_raygun',
    name: 'Raygun',
    short: 'RG',
    rarity: 'epic',
    ammoType: 'light',
    element: 'shock',
    beam: true,
    infiniteReserve: true,
    range: { full: 60, max: 100, min: 0.6 },
    base: baseStats({
      damage: 15,
      fireRate: 7,
      magSize: 30,
      reloadTime: 2.2,
      pellets: 1,
      spread: 0.3,
      adsSpread: 0.08,
      critMult: 2.2,
      critChance: 0.08,
      elementChance: 0.25,
      zoomFov: 48,
      pierce: 2,
      recoil: 0.3,
      recoilYaw: 0.08,
      swapTime: 0.55,
    }),
  },
  bigbullets: {
    id: 'bigbullets',
    itemId: 'gun_bigbullets',
    name: 'Big Bullets',
    short: 'BB',
    rarity: 'epic',
    ammoType: 'sniper',
    element: 'fire',
    projectile: 'bigBullet',
    infiniteReserve: true,
    range: { full: 50, max: 90, min: 0.8 },
    base: baseStats({
      damage: 185,
      fireRate: 1.1,
      magSize: 4,
      reloadTime: 2.6,
      pellets: 1,
      spread: 0.5,
      adsSpread: 0.1,
      critMult: 2.5,
      critChance: 0.1,
      elementChance: 0.35,
      zoomFov: 48,
      pierce: 1,
      splashRadius: 2.5,
      splashDamage: 75,
      projectileSpeed: 70,
      recoil: 6.5,
      recoilYaw: 1.0,
      swapTime: 0.7,
    }),
  },
  duckgun: {
    id: 'duckgun',
    itemId: 'gun_duckgun',
    name: 'Duck Gun',
    short: 'DG',
    rarity: 'legendary',
    ammoType: 'rockets',
    element: 'goo',
    projectile: 'rubberBullet',
    infiniteReserve: true,
    range: { full: 45, max: 75, min: 0.8 },
    base: baseStats({
      damage: 42,
      fireRate: 2.2,
      magSize: 8,
      reloadTime: 2.4,
      pellets: 1,
      spread: 0.9,
      adsSpread: 0.3,
      critMult: 2.0,
      critChance: 0.08,
      elementChance: 0.35,
      zoomFov: 50,
      splashRadius: 3.6,
      splashDamage: 62,
      projectileSpeed: 36,
      bounces: 1,
      recoil: 3.0,
      recoilYaw: 0.6,
      swapTime: 0.6,
    }),
  },
};

/** Alias keyed by `GunType`. */
export const GUN_TYPES: Record<GunType, FixedGunDef> = GUNS;

/** Lookup keyed by item id (`gun_mg`, `gun_handgun`, ...). */
export const GUNS_BY_ITEM_ID: Record<GunItemId, FixedGunDef> = {
  gun_mg: GUNS.mg,
  gun_handgun: GUNS.handgun,
  gun_machinepistol: GUNS.machinepistol,
  gun_shotgun: GUNS.shotgun,
  gun_sniper: GUNS.sniper,
  gun_bazooka: GUNS.bazooka,
  gun_raygun: GUNS.raygun,
  gun_bigbullets: GUNS.bigbullets,
  gun_duckgun: GUNS.duckgun,
};

/** Second zoom level multiplies zoomFov by this (12° -> 4° on the Toy Sniper). */
export const SCOPE_ZOOM2 = 1 / 3;

export type GunRef = GunType | GunItemId;

/** Resolve either a `GunType` (`'mg'`) or a `GunItemId` (`'gun_mg'`) to its `GunType`, or `null`. */
export function resolveGunType(ref: string | null | undefined): GunType | null {
  if (!ref) return null;
  if (ref in GUNS) return ref as GunType;
  if (ref in GUNS_BY_ITEM_ID) return GUNS_BY_ITEM_ID[ref as GunItemId].id;
  return null;
}

/** Resolve either a `GunType` or `GunItemId` to its `FixedGunDef`, or `null`. */
export function gunDef(ref: string | null | undefined): FixedGunDef | null {
  const type = resolveGunType(ref);
  return type ? GUNS[type] : null;
}

/** Player-level damage multiplier across SOW's Lv 1–30 combat curve (~5.4x at Lv 30). */
export function gunLevelMult(playerLevel: number): number {
  const lv = Math.max(1, Math.min(30, Math.round(playerLevel)));
  return Math.pow(1.06, lv - 1);
}

export interface GunSkillMods {
  /** Multiplier on direct and splash damage (default 1). */
  dmgMult?: number;
  /** Multiplier on reload time; < 1 is faster (default 1). */
  reloadMult?: number;
  /** Multiplier on fire rate; > 1 is faster (default 1). */
  fireRateMult?: number;
  /** Multiplier on magazine size (default 1). */
  magMult?: number;
  /** Additive bonus to crit chance (default 0). */
  critBonus?: number;
  /** Multiplier on hip & ADS spread; < 1 is tighter (default 1). */
  spreadMult?: number;
  /** Multiplier on pitch & yaw recoil; < 1 is steadier (default 1). */
  recoilMult?: number;
}

/**
 * Compute effective stats for a fixed gun at `playerLevel` (1–30) with optional Gunslinger skill modifiers.
 */
export function computeGunStats(
  typeOrItemId: GunRef,
  playerLevel = 1,
  skillMods?: GunSkillMods,
): ComputedGunStats {
  const def = gunDef(typeOrItemId) ?? GUNS.mg;
  const s: GunBaseStats = { ...def.base };
  const lm = gunLevelMult(playerLevel);

  s.damage *= lm;
  if (s.splashDamage > 0) s.splashDamage *= lm;

  if (skillMods) {
    if (skillMods.dmgMult !== undefined) {
      s.damage *= skillMods.dmgMult;
      if (s.splashDamage > 0) s.splashDamage *= skillMods.dmgMult;
    }
    if (skillMods.reloadMult !== undefined) s.reloadTime *= skillMods.reloadMult;
    if (skillMods.fireRateMult !== undefined) s.fireRate *= skillMods.fireRateMult;
    if (skillMods.magMult !== undefined) s.magSize *= skillMods.magMult;
    if (skillMods.critBonus !== undefined) s.critChance += skillMods.critBonus;
    if (skillMods.spreadMult !== undefined) {
      s.spread *= skillMods.spreadMult;
      s.adsSpread *= skillMods.spreadMult;
    }
    if (skillMods.recoilMult !== undefined) {
      s.recoil *= skillMods.recoilMult;
      s.recoilYaw *= skillMods.recoilMult;
    }
  }

  s.damage = Math.max(0.5, s.damage);
  s.fireRate = Math.max(0.2, s.fireRate);
  s.spread = Math.max(0, s.spread);
  s.adsSpread = Math.max(0, s.adsSpread);
  s.magSize = Math.max(1, Math.round(s.magSize));
  s.reloadTime = Math.max(0.3, s.reloadTime);
  s.pellets = Math.max(1, Math.round(s.pellets));
  s.pierce = Math.max(0, Math.round(s.pierce));
  s.bounces = Math.max(0, Math.round(s.bounces));
  s.elementChance = Math.min(1, Math.max(0, s.elementChance));
  s.critChance = Math.min(0.85, Math.max(0, s.critChance));

  for (const key of Object.keys(s) as (keyof GunBaseStats)[]) {
    if (key === 'magSize' || key === 'pellets' || key === 'pierce' || key === 'bounces') {
      s[key] = Math.round(s[key]);
    } else {
      s[key] = Math.round(s[key] * 1000) / 1000;
    }
  }
  return s;
}

/** Effective hitscan/ballistic range `{ full, max, min }` in metres for a fixed gun. */
export function gunRange(typeOrItemId: GunRef): GunRange {
  const def = gunDef(typeOrItemId) ?? GUNS.mg;
  return { ...def.range };
}

/** Distance falloff multiplier in `[0, 1]`: 1 up to `full`, linear to `min` at `max`, 0 beyond `max`. */
export function rangeFalloff(range: GunRange, distance: number): number {
  if (distance > range.max) return 0;
  if (distance <= range.full) return 1;
  const span = Math.max(1e-6, range.max - range.full);
  return 1 + (range.min - 1) * ((distance - range.full) / span);
}

/** Number of ADS zoom levels supported by this gun (2 for Sniper, 1 otherwise). */
export function zoomLevelsOf(typeOrItemId: string | null | undefined): 1 | 2 {
  return gunDef(typeOrItemId)?.zoomLevels ?? 1;
}

/** Field of view in degrees at `zoomLevel` (1 or 2). */
export function zoomFovFor(
  typeOrItemId: GunRef,
  stats: ComputedGunStats,
  zoomLevel: 1 | 2,
): number {
  return stats.zoomFov * (zoomLevel >= 2 && zoomLevelsOf(typeOrItemId) >= 2 ? SCOPE_ZOOM2 : 1);
}

/** True when this gun can be dual-wielded (`handgun` or `machinepistol`). */
export function isDualWieldGun(typeOrItemId: string | null | undefined): boolean {
  return !!gunDef(typeOrItemId)?.dualWield;
}

/** True when this gun never consumes reserve ammo (magazine still reloads). */
export function hasInfiniteReserve(typeOrItemId: string | null | undefined): boolean {
  return !!gunDef(typeOrItemId)?.infiniteReserve;
}
