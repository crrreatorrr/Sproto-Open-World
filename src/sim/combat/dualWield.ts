/**
 * Pure dual-wield sidearm combat for the two dual-wieldable fixed guns (`handgun` & `machinepistol`).
 * Alternating hand fire, independent magazine & reload per hand, ±0.16 m lateral muzzle offset,
 * and ADS/zoom suppression while active.
 *
 * 100% pure sim module: zero three.js, DOM, Math.random, timers, or Rapier.
 */
import {
  GUNS,
  computeGunStats,
  hasInfiniteReserve,
  isDualWieldGun,
  resolveGunType,
  type GunRef,
  type GunSkillMods,
  type GunType,
} from '../../content/guns';
import type { AmmoReserves } from '../entity';
import type { Vec3 } from '../math';
import type { RngState } from '../rng';
import {
  SIM_HZ,
  executeGunShot,
  startReload,
  tickReload,
  type GunFireResult,
  type GunRuntimeState,
  type HitboxEnemyInput,
} from './ballistics';

/** Lateral muzzle offset per hand while dual wielding (metres). */
export const DUAL_MUZZLE_OFFSET_M = 0.16;

export type DualHand = 'right' | 'left';

/** Offhand dual-wield runtime state (60 Hz ticks). Plain data, cloneable and hashable. */
export interface DualWieldState {
  offhandType: GunType;
  offhandMag: number;
  fireCooldownTicks: number;
  reloadTicks: number;
  gapTicks: number;
  nextHand: DualHand;
}

/** True when both right-hand and left-hand guns are dual-wieldable sidearms (`handgun` or `machinepistol`). */
export function canDualWield(
  right: string | null | undefined,
  left: string | null | undefined,
): boolean {
  return isDualWieldGun(right) && isDualWieldGun(left);
}

/** Create initial dual-wield state for an equipped offhand sidearm (`handgun` or `machinepistol`). */
export function createDualWieldState(
  offhand: GunRef,
  playerLevel = 1,
  skillMods?: GunSkillMods,
  initialCooldownTicks = 0,
): DualWieldState {
  const offhandType = resolveGunType(offhand) ?? 'handgun';
  const stats = computeGunStats(offhandType, playerLevel, skillMods);
  return {
    offhandType,
    offhandMag: stats.magSize,
    fireCooldownTicks: Math.max(0, initialCooldownTicks),
    reloadTicks: 0,
    gapTicks: 0,
    nextHand: 'right',
  };
}

/**
 * Lateral muzzle offset (`±0.16 m`) perpendicular to SOW's facing direction.
 * SOW convention: +Y up, yaw 0 faces +Z (`forward = (sin(yaw), 0, cos(yaw))`),
 * so right is `(-cos(yaw), 0, sin(yaw))` and left is `(+cos(yaw), 0, -sin(yaw))`.
 */
export function dualMuzzleOffset(yaw: number, hand: DualHand): Vec3 {
  const side = hand === 'right' ? 1 : -1;
  return {
    x: -Math.cos(yaw) * DUAL_MUZZLE_OFFSET_M * side,
    y: 0,
    z: Math.sin(yaw) * DUAL_MUZZLE_OFFSET_M * side,
  };
}

/** World-space muzzle origin offset laterally by `±0.16 m` for the given hand. */
export function dualMuzzleOrigin(origin: Vec3, yaw: number, hand: DualHand): Vec3 {
  const off = dualMuzzleOffset(yaw, hand);
  return {
    x: origin.x + off.x,
    y: origin.y + off.y,
    z: origin.z + off.z,
  };
}

/** Dual wielding disables ADS and scope zoom. */
export function enforceDualWieldNoAds(runtime: GunRuntimeState): void {
  if (!runtime.dual) return;
  runtime.adsActive = false;
  runtime.scopeZoom = 0;
}

function startOffhandReload(
  dual: DualWieldState,
  ammo: AmmoReserves,
  playerLevel: number,
  skillMods: GunSkillMods | undefined,
  infiniteAmmo?: boolean,
): boolean {
  const proxy: GunRuntimeState = {
    mag: dual.offhandMag,
    reloadTicks: dual.reloadTicks,
    fireCooldownTicks: dual.fireCooldownTicks,
    shotsFired: 0,
    adsActive: false,
    scopeZoom: 0,
  };
  const res = startReload(proxy, dual.offhandType, ammo, playerLevel, skillMods, { infiniteAmmo });
  dual.reloadTicks = proxy.reloadTicks;
  return res.started;
}

function tickOffhandReload(
  dual: DualWieldState,
  ammo: AmmoReserves,
  playerLevel: number,
  skillMods: GunSkillMods | undefined,
  infiniteAmmo?: boolean,
): boolean {
  if (dual.reloadTicks <= 0) return false;
  dual.reloadTicks = Math.max(0, dual.reloadTicks - 1);
  if (dual.reloadTicks > 0) return false;

  const def = GUNS[dual.offhandType];
  const stats = computeGunStats(dual.offhandType, playerLevel, skillMods);
  const need = Math.max(0, stats.magSize - dual.offhandMag);
  const free = !!infiniteAmmo || hasInfiniteReserve(dual.offhandType);
  const take = free ? need : Math.min(need, Math.max(0, ammo[def.ammoType]));
  if (!free) ammo[def.ammoType] -= take;
  dual.offhandMag += take;
  return true;
}

export interface StepDualWieldFireParams {
  runtime: GunRuntimeState;
  rightGun: GunRef;
  ammo: AmmoReserves;
  fireHeld: boolean;
  reloadPressed?: boolean;
  yaw: number;
  origin: Vec3;
  aimDir: Vec3;
  enemies: readonly HitboxEnemyInput[];
  rng: RngState;
  playerLevel?: number;
  skillMods?: GunSkillMods;
  worldHitDist?: number;
  infiniteAmmo?: boolean;
}

export interface DualWieldFireResult extends GunFireResult {
  muzzleOrigin: Vec3;
  rightReloadStarted: boolean;
  leftReloadStarted: boolean;
  rightReloadCompleted: boolean;
  leftReloadCompleted: boolean;
}

/**
 * Advance dual-wield combat by 1 sim tick (60 Hz):
 * - Suppresses ADS/zoom while dual wielding
 * - Advances independent reloads for right and left hands
 * - Alternates fire between hands half a fire interval apart with ±0.16 m lateral muzzle offsets
 * - Allows one hand to keep firing while the other reloads
 */
export function stepDualWieldFire(params: StepDualWieldFireParams): DualWieldFireResult {
  const {
    runtime,
    rightGun,
    ammo,
    fireHeld,
    reloadPressed,
    yaw,
    origin,
    aimDir,
    enemies,
    rng,
    playerLevel = 1,
    skillMods,
    worldHitDist,
    infiniteAmmo,
  } = params;

  const result: DualWieldFireResult = {
    fired: false,
    hand: 'right',
    hits: [],
    tracers: [],
    projectiles: [],
    recoilKick: { pitchDeg: 0, yawDeg: 0 },
    reloadStarted: false,
    reloadCompleted: false,
    critWeaveTriggered: false,
    muzzleOrigin: { ...origin },
    rightReloadStarted: false,
    leftReloadStarted: false,
    rightReloadCompleted: false,
    leftReloadCompleted: false,
  };

  const dual = runtime.dual;
  if (!dual) return result;

  // Dual wielding always disables ADS / scope zoom
  enforceDualWieldNoAds(runtime);

  // Tick independent reloads for both hands
  if (runtime.reloadTicks > 0) {
    const rTick = tickReload(runtime, rightGun, ammo, playerLevel, skillMods, { infiniteAmmo });
    result.rightReloadCompleted = rTick.completed;
  }
  if (dual.reloadTicks > 0) {
    result.leftReloadCompleted = tickOffhandReload(
      dual,
      ammo,
      playerLevel,
      skillMods,
      infiniteAmmo,
    );
  }
  result.reloadCompleted = result.rightReloadCompleted || result.leftReloadCompleted;

  // Manual reload reloads both hands independently
  if (reloadPressed) {
    const rStart = startReload(runtime, rightGun, ammo, playerLevel, skillMods, { infiniteAmmo });
    const lStarted = startOffhandReload(dual, ammo, playerLevel, skillMods, infiniteAmmo);
    result.rightReloadStarted = rStart.started;
    result.leftReloadStarted = lStarted;
    result.reloadStarted = rStart.started || lStarted;
    return result;
  }

  // Tick cooldowns and alternating gap
  if (runtime.fireCooldownTicks > 0) runtime.fireCooldownTicks--;
  if (dual.fireCooldownTicks > 0) dual.fireCooldownTicks--;
  if (dual.gapTicks > 0) dual.gapTicks--;

  if (!fireHeld || dual.gapTicks > 0) return result;

  const order: readonly DualHand[] =
    dual.nextHand === 'left' ? ['left', 'right'] : ['right', 'left'];

  for (const hand of order) {
    const isRight = hand === 'right';
    const gunRef: GunRef = isRight ? rightGun : dual.offhandType;
    const reloading = isRight ? runtime.reloadTicks > 0 : dual.reloadTicks > 0;
    const cd = isRight ? runtime.fireCooldownTicks : dual.fireCooldownTicks;
    if (reloading || cd > 0) continue;

    const mag = isRight ? runtime.mag : dual.offhandMag;
    if (mag <= 0) {
      if (isRight) {
        const rStart = startReload(runtime, rightGun, ammo, playerLevel, skillMods, {
          infiniteAmmo,
        });
        result.rightReloadStarted = rStart.started;
      } else {
        result.leftReloadStarted = startOffhandReload(
          dual,
          ammo,
          playerLevel,
          skillMods,
          infiniteAmmo,
        );
      }
      result.reloadStarted = result.rightReloadStarted || result.leftReloadStarted;
      continue;
    }

    const stats = computeGunStats(gunRef, playerLevel, skillMods);
    if (isRight) {
      runtime.mag = Math.max(0, runtime.mag - 1);
      runtime.fireCooldownTicks = Math.max(1, Math.round(SIM_HZ / stats.fireRate));
    } else {
      dual.offhandMag = Math.max(0, dual.offhandMag - 1);
      dual.fireCooldownTicks = Math.max(1, Math.round(SIM_HZ / stats.fireRate));
    }

    const muzzle = dualMuzzleOrigin(origin, yaw, hand);
    runtime.shotsFired++;
    dual.gapTicks = Math.max(1, Math.round(SIM_HZ / (2 * stats.fireRate)));
    dual.nextHand = isRight ? 'left' : 'right';

    const shot = executeGunShot({
      gun: gunRef,
      stats,
      adsActive: false,
      origin: muzzle,
      aimDir,
      enemies,
      rng,
      worldHitDist,
      hand,
    });

    result.fired = true;
    result.hand = hand;
    result.hits = shot.hits;
    result.tracers = shot.tracers;
    result.projectiles.push(...shot.projectiles);
    result.recoilKick = shot.recoilKick;
    result.critWeaveTriggered = shot.critWeaveTriggered;
    result.muzzleOrigin = muzzle;

    // Auto-reload this hand if its magazine just emptied
    const remainingMag = isRight ? runtime.mag : dual.offhandMag;
    if (remainingMag <= 0) {
      if (isRight) {
        const autoR = startReload(runtime, rightGun, ammo, playerLevel, skillMods, {
          infiniteAmmo,
        });
        result.rightReloadStarted = autoR.started;
      } else {
        result.leftReloadStarted = startOffhandReload(
          dual,
          ammo,
          playerLevel,
          skillMods,
          infiniteAmmo,
        );
      }
      result.reloadStarted = result.rightReloadStarted || result.leftReloadStarted;
    }

    return result;
  }

  return result;
}
