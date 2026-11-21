/**
 * Pure gun ballistics, analytic multi-zone enemy hitboxes, reload/ammo state machine,
 * unified elemental procs, and Crit-Weave emission for SOW's 9 fixed guns.
 *
 * 100% pure sim module: zero three.js, DOM, Math.random, timers, or Rapier.
 */
import {
  GUNS,
  GUN_HEAT,
  ZOOM_FEEL,
  computeGunStats,
  gunDef,
  gunRange,
  hasInfiniteReserve,
  loadsByShell,
  rangeFalloff,
  type AmmoType,
  type ComputedGunStats,
  type GunElement,
  type GunRef,
  type GunSkillMods,
} from '../../content/guns';
import type { StatusId } from '../../content/statuses';
import type { AmmoReserves, EntityId } from '../entity';
import type { Vec3 } from '../math';
import { next, type RngState } from '../rng';
import type { DualWieldState } from './dualWield';
import type { WorldRay } from './gunAim';

export const SIM_HZ = 60;
/** An empty gun with no reserve clicks this often while the trigger is held (ticks). */
export const DRY_FIRE_TICKS = 24;
export const HIT_ZONE_TIE_EPS = 0.05; // 0.05 m priority tie-breaker
export const SHIELD_DAMAGE_MULT = 0.1;
export const SHOCK_CHAIN_TARGETS = 2;
export const SHOCK_CHAIN_RANGE_M = 5;
export const SHOCK_CHAIN_DMG_FRAC = 0.5;
export const GOO_SLOW_FRAC = 0.4;

export type HitZoneKind = 'weak' | 'shield' | 'body';

export const HIT_ZONE_PRIORITY: Record<HitZoneKind, number> = {
  weak: 3,
  shield: 2,
  body: 1,
};

export type EnemyHitZone =
  | { kind: 'sphere'; zone: HitZoneKind; x: number; y: number; z: number; r: number }
  | { kind: 'capsule'; zone: HitZoneKind; x: number; z: number; y0: number; y1: number; r: number };

/**
 * Minimal structural view of an enemy for analytic hit-zone raycasting.
 * Every SOW `Entity` satisfies this interface directly.
 */
export interface HitboxEnemyInput {
  id: EntityId;
  kind?: string;
  tf: { pos: Vec3; yaw: number };
  body?: { radius: number; height: number };
  brain?: { def: string };
  combat?: { action: { kind: string } | null };
  view?: { scale?: number };
  /** Explicit front-shield override (auto-enabled for `bigObama` / shielded defs). */
  shieldFront?: boolean;
}

export interface ZoneRayHit {
  entityId: EntityId;
  t: number;
  zone: HitZoneKind;
  point: Vec3;
}

function isShieldedEnemy(e: HitboxEnemyInput): boolean {
  if (e.shieldFront !== undefined) return e.shieldFront;
  const def = e.brain?.def?.toLowerCase() ?? '';
  return def.includes('bigobama') || def.includes('shield');
}

function isBossEnemy(e: HitboxEnemyInput): boolean {
  return e.kind === 'boss';
}

/**
 * Analytic multi-zone hitboxes for an enemy in world space:
 * - `weak`: head/weak-spot sphere
 * - `shield`: optional front shield sphere for `bigObama` / shielded enemies
 * - `body`: vertical capsule covering torso and legs
 *
 * Uses SOW's coordinate convention: +Y up, yaw 0 faces +Z (`forward = (sin(yaw), cos(yaw))`).
 */
export function computeEnemyHitZones(e: HitboxEnemyInput): EnemyHitZone[] {
  const sc = e.view?.scale ?? 1;
  const radius = (e.body?.radius ?? 0.45) * sc;
  const height = (e.body?.height ?? 1.8) * sc;
  const { x, y, z } = e.tf.pos;
  const fx = Math.sin(e.tf.yaw);
  const fz = Math.cos(e.tf.yaw);

  const zones: EnemyHitZone[] = [];

  // Head / weak-spot sphere atop the shoulders
  const headRadius = Math.max(0.2, radius * 0.62);
  const headY = y + height * 0.85;
  zones.push({
    kind: 'sphere',
    zone: 'weak',
    x,
    y: headY,
    z,
    r: headRadius,
  });

  // Optional front shield sphere for bigObama / shielded enemies
  if (isShieldedEnemy(e)) {
    const shieldDist = radius * 1.15;
    const shieldRadius = radius * 0.85;
    zones.push({
      kind: 'sphere',
      zone: 'shield',
      x: x + fx * shieldDist,
      y: y + height * 0.52,
      z: z + fz * shieldDist,
      r: shieldRadius,
    });
  }

  // Body capsule (feet to shoulders, leaving the head weak-spot cleanly exposed)
  zones.push({
    kind: 'capsule',
    zone: 'body',
    x,
    z,
    y0: y,
    y1: y + height * 0.78,
    r: radius,
  });

  return zones;
}

/** Ray vs sphere intersection. `dir` must be unit length. Returns distance `t >= 0` or `-1`. */
export function raySphere(origin: Vec3, dir: Vec3, center: Vec3, r: number): number {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t >= 0 ? t : -1;
}

/** Ray vs vertical capsule from `(cx, y0 + r, cz)` to `(cx, y1 - r, cz)`. Returns `t >= 0` or `-1`. */
export function rayCapsule(
  origin: Vec3,
  dir: Vec3,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  r: number,
): number {
  const a0 = y0 + r;
  const a1 = Math.max(a0, y1 - r);
  let best = -1;
  const ox = origin.x - cx;
  const oz = origin.z - cz;
  const A = dir.x * dir.x + dir.z * dir.z;
  if (A > 1e-9) {
    const B = ox * dir.x + oz * dir.z;
    const C = ox * ox + oz * oz - r * r;
    const disc = B * B - A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-B - s) / A, (-B + s) / A]) {
        if (t < 0) continue;
        const y = origin.y + dir.y * t;
        if (y >= a0 && y <= a1) {
          best = t;
          break;
        }
      }
    }
  }
  for (const capY of [a0, a1]) {
    const t = raySphere(origin, dir, { x: cx, y: capY, z: cz }, r);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/**
 * Raycast against analytic multi-zone hitboxes of all alive enemies.
 * Uses a 0.05 m priority tie-breaker favoring `weak > shield > body`.
 */
export function raycastEnemyZones(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  enemies: readonly HitboxEnemyInput[],
  ignoreIds?: ReadonlySet<EntityId>,
): ZoneRayHit | null {
  let best: ZoneRayHit | null = null;
  for (const e of enemies) {
    if (e.combat?.action?.kind === 'dead') continue;
    if (ignoreIds && ignoreIds.has(e.id)) continue;

    const zones = computeEnemyHitZones(e);
    for (const hb of zones) {
      const t =
        hb.kind === 'sphere'
          ? raySphere(origin, dir, hb, hb.r)
          : rayCapsule(origin, dir, hb.x, hb.z, hb.y0, hb.y1, hb.r);
      if (t < 0 || t > maxDist) continue;
      const betterDist = !best || t < best.t - HIT_ZONE_TIE_EPS;
      const tieWithHigherPri =
        best !== null &&
        Math.abs(t - best.t) <= HIT_ZONE_TIE_EPS &&
        HIT_ZONE_PRIORITY[hb.zone] > HIT_ZONE_PRIORITY[best.zone];
      if (betterDist || tieWithHigherPri) {
        best = {
          entityId: e.id,
          t,
          zone: hb.zone,
          point: {
            x: origin.x + dir.x * t,
            y: origin.y + dir.y * t,
            z: origin.z + dir.z * t,
          },
        };
      }
    }
  }
  return best;
}

/** Per-player runtime gun state (60 Hz ticks). Plain data, cloneable and hashable. */
export interface GunRuntimeState {
  mag: number;
  /** The magazine's size with the player's skills applied, for the HUD. */
  magSize: number;
  reloadTicks: number;
  /** How long the running reload (or the running shell) takes in all, so a view can show progress. */
  reloadTotalTicks: number;
  fireCooldownTicks: number;
  shotsFired: number;
  adsActive: boolean;
  scopeZoom: 0 | 1 | 2;
  /** Sustained fire, 0..1: widens the hip spread and hardens the kick (GUN_HEAT). */
  heat: number;
  /** The spread a shot fired this tick would have (degrees), for the crosshair. */
  spreadDeg: number;
  dual?: DualWieldState;
}

export function createGunRuntimeState(
  gun: GunRef,
  playerLevel = 1,
  skillMods?: GunSkillMods,
): GunRuntimeState {
  const s = computeGunStats(gun, playerLevel, skillMods);
  return {
    mag: s.magSize,
    magSize: s.magSize,
    reloadTicks: 0,
    reloadTotalTicks: 0,
    fireCooldownTicks: 0,
    shotsFired: 0,
    adsActive: false,
    scopeZoom: 0,
    heat: 0,
    spreadDeg: s.spread,
  };
}

export type GunProjectileKind = 'rocket' | 'bigBullet' | 'rubberBullet';

/** Pure descriptor of a gun projectile to be spawned by the caller / projectile system. */
export interface SpawnedGunProjectile {
  kind: GunProjectileKind;
  origin: Vec3;
  vel: Vec3;
  radius: number;
  gravity: number;
  damage: number;
  element: GunElement | null;
  elementChance: number;
  critMult: number;
  critChance: number;
  pierce: number;
  bounces: number;
  ttlTicks: number;
  splash?: {
    radius: number;
    damage: number;
    minFalloff: number;
    selfMult: number;
    knockback: number;
  };
  hand: 'right' | 'left' | 'single';
}

export interface ReloadStartResult {
  started: boolean;
  reason?: 'already_reloading' | 'mag_full' | 'empty_reserve';
  reloadTicks: number;
  ammoType: AmmoType;
}

export interface ReloadTickResult {
  reloading: boolean;
  completed: boolean;
  loaded: number;
  ammoType: AmmoType;
}

/** Ticks one reload step takes: the whole magazine, or one shell on a gun that loads by the shell. */
export function reloadTicksFor(gun: GunRef, stats: ComputedGunStats): number {
  const whole = stats.reloadTime * SIM_HZ;
  return Math.max(1, Math.round(loadsByShell(gun) ? whole / stats.magSize : whole));
}

/**
 * Begin reloading a fixed gun if not already reloading, not full, and reserve ammo is available.
 */
export function startReload(
  runtime: GunRuntimeState,
  gun: GunRef,
  ammo: AmmoReserves,
  playerLevel = 1,
  skillMods?: GunSkillMods,
  opts?: { infiniteAmmo?: boolean },
): ReloadStartResult {
  const def = gunDef(gun) ?? GUNS.mg;
  const ammoType = def.ammoType;
  const stats = computeGunStats(def.id, playerLevel, skillMods);

  if (runtime.reloadTicks > 0) {
    return {
      started: false,
      reason: 'already_reloading',
      reloadTicks: runtime.reloadTicks,
      ammoType,
    };
  }
  if (runtime.mag >= stats.magSize) {
    return { started: false, reason: 'mag_full', reloadTicks: 0, ammoType };
  }

  const free = !!opts?.infiniteAmmo || hasInfiniteReserve(def.id);
  if (!free && ammo[ammoType] <= 0) {
    return { started: false, reason: 'empty_reserve', reloadTicks: 0, ammoType };
  }

  const ticks = reloadTicksFor(def.id, stats);
  runtime.reloadTicks = ticks;
  runtime.reloadTotalTicks = ticks;
  return { started: true, reloadTicks: ticks, ammoType };
}

/**
 * Advance an active reload by 1 sim tick (60 Hz). When complete, pulls rounds from `ammo[ammoType]`
 * into `runtime.mag`.
 */
export function tickReload(
  runtime: GunRuntimeState,
  gun: GunRef,
  ammo: AmmoReserves,
  playerLevel = 1,
  skillMods?: GunSkillMods,
  opts?: { infiniteAmmo?: boolean },
): ReloadTickResult {
  const def = gunDef(gun) ?? GUNS.mg;
  const ammoType = def.ammoType;
  if (runtime.reloadTicks <= 0) {
    return { reloading: false, completed: false, loaded: 0, ammoType };
  }

  runtime.reloadTicks = Math.max(0, runtime.reloadTicks - 1);
  if (runtime.reloadTicks > 0) {
    return { reloading: true, completed: false, loaded: 0, ammoType };
  }

  const stats = computeGunStats(def.id, playerLevel, skillMods);
  const need = Math.max(0, stats.magSize - runtime.mag);
  const free = !!opts?.infiniteAmmo || hasInfiniteReserve(def.id);
  const want = loadsByShell(def.id) ? Math.min(1, need) : need;
  const take = free ? want : Math.min(want, Math.max(0, ammo[ammoType]));
  if (!free) ammo[ammoType] -= take;
  runtime.mag += take;
  // By the shell: the next one goes in until the magazine is full or the reserve is dry.
  if (loadsByShell(def.id) && take > 0 && runtime.mag < stats.magSize && (free || ammo[ammoType] > 0)) {
    runtime.reloadTicks = runtime.reloadTotalTicks = reloadTicksFor(def.id, stats);
    return { reloading: true, completed: false, loaded: take, ammoType };
  }

  return { reloading: false, completed: true, loaded: take, ammoType };
}

export interface UnifiedStatusProc {
  element: GunElement;
  status: StatusId;
  stacks: number;
  durationTicks: number;
  /** Fire Burn: fraction of hit damage per second. */
  dpsFrac?: number;
  /** Goo Chill/Slow: movement/action slow fraction (0.4x; halved on bosses). */
  slowFrac?: number;
}

export interface ShockChainHit {
  fromEntityId: EntityId;
  targetEntityId: EntityId;
  damage: number;
  point: Vec3;
}

export interface ShotHitResult {
  entityId: EntityId;
  zone: HitZoneKind;
  damage: number;
  distance: number;
  falloff: number;
  isWeak: boolean;
  isCrit: boolean;
  /** True when a weak-spot hit opens SOW's Crit-Weave window for an empowered spell cast. */
  critWeave: boolean;
  point: Vec3;
  element: GunElement | null;
  statusProc?: UnifiedStatusProc;
  shockChains: ShockChainHit[];
}

export interface HitscanShotParams {
  gun: GunRef;
  stats: ComputedGunStats;
  origin: Vec3;
  dir: Vec3;
  enemies: readonly HitboxEnemyInput[];
  rng: RngState;
  /** Optional world-geometry occlusion distance (e.g. from Rapier world raycast). */
  worldHitDist?: number;
  dmgMult?: number;
}

export interface HitscanShotResult {
  hits: ShotHitResult[];
  endPoint: Vec3;
  critWeaveTriggered: boolean;
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-8) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Deterministic cone-spread perturbation around unit `aim` by `spreadDeg` degrees. */
export function coneSpreadDir(rng: RngState, aim: Vec3, spreadDeg: number): Vec3 {
  const unitAim = normalizeVec3(aim);
  if (spreadDeg <= 0) return unitAim;
  const rad = (spreadDeg * Math.PI) / 180;
  const theta = rad * Math.sqrt(next(rng));
  const phi = next(rng) * Math.PI * 2;
  const up: Vec3 = Math.abs(unitAim.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let rx = unitAim.y * up.z - unitAim.z * up.y;
  let ry = unitAim.z * up.x - unitAim.x * up.z;
  let rz = unitAim.x * up.y - unitAim.y * up.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * unitAim.z - rz * unitAim.y;
  const uy = rz * unitAim.x - rx * unitAim.z;
  const uz = rx * unitAim.y - ry * unitAim.x;
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  return normalizeVec3({
    x: unitAim.x * ct + (rx * cp + ux * sp) * st,
    y: unitAim.y * ct + (ry * cp + uy * sp) * st,
    z: unitAim.z * ct + (rz * cp + uz * sp) * st,
  });
}

function enemyCenter(e: HitboxEnemyInput): Vec3 {
  const sc = e.view?.scale ?? 1;
  const h = (e.body?.height ?? 1.8) * sc;
  return { x: e.tf.pos.x, y: e.tf.pos.y + h * 0.55, z: e.tf.pos.z };
}

function findShockChains(
  primary: HitboxEnemyInput,
  baseDamage: number,
  enemies: readonly HitboxEnemyInput[],
): ShockChainHit[] {
  const chains: ShockChainHit[] = [];
  const visited = new Set<EntityId>([primary.id]);
  let from = primary;

  for (let hop = 0; hop < SHOCK_CHAIN_TARGETS; hop++) {
    let best: HitboxEnemyInput | null = null;
    let bestDist = SHOCK_CHAIN_RANGE_M;
    for (const candidate of enemies) {
      if (candidate.combat?.action?.kind === 'dead') continue;
      if (visited.has(candidate.id)) continue;
      const d = Math.hypot(
        candidate.tf.pos.x - from.tf.pos.x,
        candidate.tf.pos.z - from.tf.pos.z,
      );
      if (d <= bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    if (!best) break;
    visited.add(best.id);
    chains.push({
      fromEntityId: from.id,
      targetEntityId: best.id,
      damage: Math.max(1, Math.round(baseDamage * SHOCK_CHAIN_DMG_FRAC)),
      point: enemyCenter(best),
    });
    from = best;
  }
  return chains;
}

/**
 * Resolve a unified elemental proc (`fire` -> Burn, `shock` -> Shock + 2-target 5m chain,
 * `goo` -> Chill/Slow 0.4x halved on bosses) for either hitscan or projectile hits.
 */
export function resolveElementProc(
  element: GunElement,
  damage: number,
  target: HitboxEnemyInput | undefined,
  enemies: readonly HitboxEnemyInput[],
): { statusProc: UnifiedStatusProc; shockChains: ShockChainHit[] } {
  if (element === 'fire') {
    return {
      statusProc: {
        element: 'fire',
        status: 'burn',
        stacks: 1,
        durationTicks: 3 * SIM_HZ,
        dpsFrac: 0.25,
      },
      shockChains: [],
    };
  }
  if (element === 'shock') {
    return {
      statusProc: {
        element: 'shock',
        status: 'shock',
        stacks: 1,
        durationTicks: 3 * SIM_HZ,
      },
      shockChains: target ? findShockChains(target, damage, enemies) : [],
    };
  }
  const bossScale = target && isBossEnemy(target) ? 0.5 : 1;
  return {
    statusProc: {
      element: 'goo',
      status: 'chill',
      stacks: 1,
      durationTicks: Math.round(2.5 * SIM_HZ * bossScale),
      slowFrac: GOO_SLOW_FRAC * bossScale,
    },
    shockChains: [],
  };
}

/**
 * Resolve a single hitscan ray with range falloff, pierce, multi-zone hitboxes,
 * Crit-Weave emission, and unified elemental procs.
 */
export function resolveHitscanShot(params: HitscanShotParams): HitscanShotResult {
  const { gun, stats, origin, enemies, rng } = params;
  const def = gunDef(gun) ?? GUNS.mg;
  const dir = normalizeVec3(params.dir);
  const range = gunRange(def.id);
  let remaining = Math.min(range.max, params.worldHitDist ?? range.max);
  let cursor: Vec3 = { ...origin };
  const ignore = new Set<EntityId>();
  const hits: ShotHitResult[] = [];
  let endPoint: Vec3 | null = null;
  let critWeaveTriggered = false;

  const byId = new Map<EntityId, HitboxEnemyInput>();
  for (const e of enemies) byId.set(e.id, e);

  const element = def.element;

  for (let step = 0; step <= stats.pierce; step++) {
    if (remaining <= 0) break;
    const hit = raycastEnemyZones(cursor, dir, remaining, enemies, ignore);
    if (!hit) break;

    const totalDist = Math.hypot(
      hit.point.x - origin.x,
      hit.point.y - origin.y,
      hit.point.z - origin.z,
    );
    const falloff = rangeFalloff(range, totalDist);
    if (falloff <= 0) break;

    const isWeak = hit.zone === 'weak';
    let dmg = stats.damage * (params.dmgMult ?? 1) * falloff;
    if (isWeak) dmg *= stats.critMult;
    const isCrit = stats.critChance > 0 && next(rng) < stats.critChance;
    if (isCrit) dmg *= 1.5;
    if (hit.zone === 'shield') dmg *= SHIELD_DAMAGE_MULT;
    dmg = Math.max(1, Math.round(dmg));

    const target = byId.get(hit.entityId);
    const critWeave = isWeak;
    if (critWeave) critWeaveTriggered = true;

    let statusProc: UnifiedStatusProc | undefined;
    let shockChains: ShockChainHit[] = [];
    if (element && stats.elementChance > 0 && next(rng) < stats.elementChance) {
      const proc = resolveElementProc(element, dmg, target, enemies);
      statusProc = proc.statusProc;
      shockChains = proc.shockChains;
    }

    const shotHit: ShotHitResult = {
      entityId: hit.entityId,
      zone: hit.zone,
      damage: dmg,
      distance: totalDist,
      falloff,
      isWeak,
      isCrit,
      critWeave,
      point: hit.point,
      element,
      shockChains,
    };
    if (statusProc) shotHit.statusProc = statusProc;

    hits.push(shotHit);
    ignore.add(hit.entityId);
    endPoint = hit.point;
    remaining -= hit.t;
    cursor = {
      x: hit.point.x + dir.x * 0.05,
      y: hit.point.y + dir.y * 0.05,
      z: hit.point.z + dir.z * 0.05,
    };
  }

  if (!endPoint) {
    const dist = Math.min(range.max, params.worldHitDist ?? range.max);
    endPoint = {
      x: origin.x + dir.x * dist,
      y: origin.y + dir.y * dist,
      z: origin.z + dir.z * dist,
    };
  }

  return { hits, endPoint, critWeaveTriggered };
}

export interface StepGunFireParams {
  runtime: GunRuntimeState;
  gun: GunRef;
  ammo: AmmoReserves;
  fireHeld: boolean;
  reloadPressed?: boolean;
  origin: Vec3;
  aimDir: Vec3;
  enemies: readonly HitboxEnemyInput[];
  rng: RngState;
  playerLevel?: number;
  skillMods?: GunSkillMods;
  worldHitDist?: number;
  /** World occlusion per ray (each pellet gets its own); replaces `worldHitDist` when given. */
  worldRay?: WorldRay;
  /** Multiplies the hip spread for movement (moving, airborne); heat is added here. */
  moveSpreadMult?: number;
  infiniteAmmo?: boolean;
  hand?: 'right' | 'left' | 'single';
}

export interface GunFireResult {
  fired: boolean;
  hand: 'right' | 'left' | 'single';
  hits: ShotHitResult[];
  tracers: { from: Vec3; to: Vec3 }[];
  projectiles: SpawnedGunProjectile[];
  recoilKick: { pitchDeg: number; yawDeg: number };
  reloadStarted: boolean;
  reloadCompleted: boolean;
  critWeaveTriggered: boolean;
  /** The trigger was pulled on an empty gun with nothing left to load. */
  dryFire?: boolean;
}

/**
 * Pure single-shot execution given an already-validated trigger pull.
 * Shared by `stepGunFire` and `dualWield.ts`.
 */
export function executeGunShot(params: {
  gun: GunRef;
  stats: ComputedGunStats;
  adsActive: boolean;
  origin: Vec3;
  aimDir: Vec3;
  enemies: readonly HitboxEnemyInput[];
  rng: RngState;
  worldHitDist?: number;
  worldRay?: WorldRay;
  /** Multiplies the hip spread (heat, movement); the zoomed spread is not touched. */
  hipSpreadMult?: number;
  /** Multiplies the kick (heat, zoom). */
  recoilMult?: number;
  hand: 'right' | 'left' | 'single';
}): Pick<GunFireResult, 'hits' | 'tracers' | 'projectiles' | 'recoilKick' | 'critWeaveTriggered'> {
  const { gun, stats, adsActive, origin, enemies, rng, worldHitDist, worldRay, hand } = params;
  const def = gunDef(gun) ?? GUNS.mg;
  const aim = normalizeVec3(params.aimDir);
  const spreadDeg = adsActive ? stats.adsSpread : stats.spread * (params.hipSpreadMult ?? 1);

  const hits: ShotHitResult[] = [];
  const tracers: { from: Vec3; to: Vec3 }[] = [];
  const projectiles: SpawnedGunProjectile[] = [];
  let critWeaveTriggered = false;

  if (def.projectile === 'rubberBullet') {
    // Duck Gun: lobbed bouncing duck projectile with splash + goo element
    const d = coneSpreadDir(rng, aim, spreadDeg);
    projectiles.push({
      kind: 'rubberBullet',
      origin: { ...origin },
      vel: {
        x: d.x * stats.projectileSpeed,
        y: d.y * stats.projectileSpeed + 2.5,
        z: d.z * stats.projectileSpeed,
      },
      radius: 0.24,
      gravity: 14,
      damage: Math.round(stats.damage),
      element: def.element,
      elementChance: stats.elementChance,
      critMult: stats.critMult,
      critChance: stats.critChance,
      pierce: stats.pierce,
      bounces: stats.bounces,
      ttlTicks: 4 * SIM_HZ,
      splash: {
        radius: stats.splashRadius,
        damage: Math.round(stats.splashDamage),
        minFalloff: 0.35,
        selfMult: 0,
        knockback: 9,
      },
      hand,
    });
  } else if (def.projectile === 'bigBullet') {
    // Big Bullets: heavy piercing round with fire element & splash
    const d = coneSpreadDir(rng, aim, spreadDeg);
    projectiles.push({
      kind: 'bigBullet',
      origin: { ...origin },
      vel: {
        x: d.x * stats.projectileSpeed,
        y: d.y * stats.projectileSpeed,
        z: d.z * stats.projectileSpeed,
      },
      radius: 0.32,
      gravity: 4,
      damage: Math.round(stats.damage),
      element: def.element,
      elementChance: stats.elementChance,
      critMult: stats.critMult,
      critChance: stats.critChance,
      pierce: stats.pierce,
      bounces: 0,
      ttlTicks: 3 * SIM_HZ,
      splash: {
        radius: stats.splashRadius,
        damage: Math.round(stats.splashDamage),
        minFalloff: 0.4,
        selfMult: 0,
        knockback: 7,
      },
      hand,
    });
  } else if (def.projectile === 'rocket' || stats.projectileSpeed > 0) {
    // Toy Bazooka: rocket with splash & rocket-jump self knockback
    const d = coneSpreadDir(rng, aim, spreadDeg);
    projectiles.push({
      kind: 'rocket',
      origin: { ...origin },
      vel: {
        x: d.x * stats.projectileSpeed,
        y: d.y * stats.projectileSpeed,
        z: d.z * stats.projectileSpeed,
      },
      radius: 0.2,
      gravity: 0,
      damage: Math.round(stats.damage),
      element: def.element,
      elementChance: stats.elementChance,
      critMult: stats.critMult,
      critChance: stats.critChance,
      pierce: 0,
      bounces: 0,
      ttlTicks: 5 * SIM_HZ,
      splash: {
        radius: stats.splashRadius,
        damage: Math.round(stats.splashDamage),
        minFalloff: 0.3,
        selfMult: 0.35,
        knockback: 8,
      },
      hand,
    });
  } else {
    for (let i = 0; i < stats.pellets; i++) {
      const rayDir = coneSpreadDir(rng, aim, spreadDeg);
      const res = resolveHitscanShot({
        gun: def.id,
        stats,
        origin,
        dir: rayDir,
        enemies,
        rng,
        worldHitDist: worldRay ? (worldRay(origin, rayDir, def.range.max) ?? undefined) : worldHitDist,
      });
      hits.push(...res.hits);
      tracers.push({ from: { ...origin }, to: res.endPoint });
      if (res.critWeaveTriggered) critWeaveTriggered = true;
    }
  }

  const kick = params.recoilMult ?? 1;
  const yawKick = stats.recoilYaw * (next(rng) * 2 - 1) * kick;
  return {
    hits,
    tracers,
    projectiles,
    recoilKick: { pitchDeg: stats.recoil * kick, yawDeg: yawKick },
    critWeaveTriggered,
  };
}

/** The trigger is up: the gun cools. */
export function coolGun(runtime: GunRuntimeState, fireHeld: boolean): void {
  if (!fireHeld) runtime.heat = Math.max(0, runtime.heat - GUN_HEAT.heatCool / SIM_HZ);
}

/** A shot was fired: the gun heats. */
export function heatGun(runtime: GunRuntimeState): void {
  runtime.heat = Math.min(1, runtime.heat + GUN_HEAT.heatPerShot);
}

/** What the gun's heat, the player's movement and the zoom do to the next shot's spread and kick. */
export function heatMults(runtime: GunRuntimeState, moveSpreadMult = 1): { hipSpreadMult: number; recoilMult: number } {
  return {
    hipSpreadMult: (1 + runtime.heat * GUN_HEAT.heatSpread) * moveSpreadMult,
    recoilMult: (1 + runtime.heat * GUN_HEAT.heatRecoil) * (runtime.adsActive ? ZOOM_FEEL.recoilMult : 1),
  };
}

/**
 * Advance single-gun firing and reloading by 1 sim tick (60 Hz).
 */
export function stepGunFire(params: StepGunFireParams): GunFireResult {
  const {
    runtime,
    gun,
    ammo,
    fireHeld,
    reloadPressed,
    origin,
    aimDir,
    enemies,
    rng,
    playerLevel = 1,
    skillMods,
    worldHitDist,
    worldRay,
    infiniteAmmo,
  } = params;
  const hand = params.hand ?? 'single';
  const emptyResult: GunFireResult = {
    fired: false,
    hand,
    hits: [],
    tracers: [],
    projectiles: [],
    recoilKick: { pitchDeg: 0, yawDeg: 0 },
    reloadStarted: false,
    reloadCompleted: false,
    critWeaveTriggered: false,
  };

  if (runtime.fireCooldownTicks > 0) runtime.fireCooldownTicks--;
  coolGun(runtime, fireHeld);

  // Loading by the shell, the trigger stops the reload and fires what is already in.
  if (runtime.reloadTicks > 0 && fireHeld && runtime.mag > 0 && loadsByShell(gun)) runtime.reloadTicks = 0;

  if (runtime.reloadTicks > 0) {
    const tick = tickReload(runtime, gun, ammo, playerLevel, skillMods, { infiniteAmmo });
    emptyResult.reloadCompleted = tick.completed;
    return emptyResult;
  }

  if (reloadPressed) {
    const start = startReload(runtime, gun, ammo, playerLevel, skillMods, { infiniteAmmo });
    emptyResult.reloadStarted = start.started;
    return emptyResult;
  }

  if (!fireHeld || runtime.fireCooldownTicks > 0) return emptyResult;

  if (runtime.mag <= 0) {
    const start = startReload(runtime, gun, ammo, playerLevel, skillMods, { infiniteAmmo });
    emptyResult.reloadStarted = start.started;
    if (start.reason === 'empty_reserve') {
      emptyResult.dryFire = true;
      runtime.fireCooldownTicks = DRY_FIRE_TICKS;
    }
    return emptyResult;
  }

  const stats = computeGunStats(gun, playerLevel, skillMods);
  runtime.mag = Math.max(0, runtime.mag - 1);
  runtime.shotsFired++;
  runtime.fireCooldownTicks = Math.max(1, Math.round(SIM_HZ / stats.fireRate));

  const shot = executeGunShot({
    gun,
    stats,
    adsActive: runtime.adsActive,
    origin,
    aimDir,
    enemies,
    rng,
    worldHitDist,
    worldRay,
    ...heatMults(runtime, params.moveSpreadMult),
    hand,
  });
  heatGun(runtime);

  let reloadStarted = false;
  if (runtime.mag <= 0) {
    const autoReload = startReload(runtime, gun, ammo, playerLevel, skillMods, { infiniteAmmo });
    reloadStarted = autoReload.started;
  }

  return {
    fired: true,
    hand,
    hits: shot.hits,
    tracers: shot.tracers,
    projectiles: shot.projectiles,
    recoilKick: shot.recoilKick,
    reloadStarted,
    reloadCompleted: false,
    critWeaveTriggered: shot.critWeaveTriggered,
  };
}
