/**
 * Progressive movement tech: Slide (+ downhill boost & slide-hop), Dash (burst + i-frames),
 * Double-Jump, and Grapple Hook (anchors, raycast solids, no-grapple volumes, LOS check).
 *
 * 100% pure simulation logic: zero Three.js, DOM, Rapier, timers, or Math.random.
 * All abilities are gated by `MovementAbilities` and disabled while mounted (`mounted === true`)
 * so the Pepe Bull remains the overworld surface-speed king (unification plan §4.3).
 */
import { DT } from '../../content/tuning';
import type { MovementAbilities } from '../entity';
import type { Vec3 } from '../math';

/** Hand-tuned 60 Hz movement tech constants (ported from sproto-shooter GAMEPLAY). */
export const MOVEMENT_TECH = Object.freeze({
  slideBoost: 16,
  slideCruise: 8,
  slideDrag: 2.4,
  slideTicks: 42,
  slideHopBoost: 1.12,
  slideMinSpeed: 4.2,
  slideCdTicks: 13,
  slideHopCdTicks: 51,
  slideSlope: 14,
  slideSteer: 10,
  slideStopSpeed: 5.85,
  dashSpeed: 24,
  dashTicks: 9,
  dashCooldownTicks: 120,
  dashInvulnTicks: 7,
  dashEndScale: 0.45,
  doubleJumpVel: 7.0,
  grappleRange: 16,
  grappleSpeed: 12.5,
  grapplePull: 54,
  grappleArrive: 1.35,
  grappleReleaseSpeed: 8.5,
  grappleCooldownTicks: 360,
  grappleEyeHeight: 1.6,
  grappleOriginY: 0.9,
  grappleAnchorSnapRadius: 2.4,
  grappleAnchorRayRadius: 1.4,
  grappleLosMargin: 0.35,
});

export interface GrappleAnchor {
  id?: string;
  at: readonly [number, number, number];
  /** Optional custom snap/ray reach radius in metres. */
  r?: number;
}

export interface AabbVolume {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface GrappleState {
  active: boolean;
  anchor: Vec3;
  ticks: number;
  anchorId?: string | null;
}

/** Plain-data runtime state for a player's movement tech (cloneable & hashable). */
export interface MovementTechState {
  slidingTicks: number;
  slideDir: { x: number; z: number };
  slideHopCdTicks: number;
  dashTicks: number;
  dashCdTicks: number;
  dashDir: { x: number; z: number };
  doubleJumpUsed: boolean;
  grapple: GrappleState | null;
  grappleCdTicks: number;
}

export function createMovementTechState(): MovementTechState {
  return {
    slidingTicks: 0,
    slideDir: { x: 0, z: 1 },
    slideHopCdTicks: 0,
    dashTicks: 0,
    dashCdTicks: 0,
    dashDir: { x: 0, z: 1 },
    doubleJumpUsed: false,
    grapple: null,
    grappleCdTicks: 0,
  };
}

export interface MovementTechInput {
  pos: Readonly<Vec3>;
  /** Current velocity (mutated in-place and returned in the step result). */
  vel: Vec3;
  /** Facing yaw in radians (yaw 0 faces +Z: x = sin(yaw), z = cos(yaw)). */
  yaw: number;
  /** Optional 3D aim direction for grapple targeting; defaults to horizontal facing from `yaw`. */
  aimDir?: Readonly<Vec3>;
  /** Desired horizontal movement direction in world XZ (magnitude 0..1). */
  wishX: number;
  wishZ: number;
  grounded: boolean;
  sprinting: boolean;
  slidePressed: boolean;
  dashPressed: boolean;
  jumpPressed: boolean;
  grappleHeld: boolean;
  /** Optional level grapple anchors to snap onto. */
  grappleAnchors?: readonly GrappleAnchor[];
  /** Optional exclusion boxes where grapple hooks cannot attach. */
  noGrapple?: readonly AabbVolume[];
  /** Optional timestep in seconds (defaults to 1/60). */
  dt?: number;
}

export interface RaycastHit {
  point: Vec3;
  dist: number;
  id?: string | null;
}

/** Pure raycast callback provided by the caller (wrapping Rapier or a test double). */
export type MovementRaycastFn = (
  origin: Readonly<Vec3>,
  dir: Readonly<Vec3>,
  maxDist: number,
) => RaycastHit | null;

/**
 * Pure ground-slope probe callback: returns the downhill height drop (metres) along `(dirX, dirZ)`
 * at `pos` (`> 0.02` = downhill slope, `<= 0` = flat or uphill).
 */
export type GroundSlopeFn = (
  pos: Readonly<Vec3>,
  dirX: number,
  dirZ: number,
) => number;

export type MovementTechEvent =
  | 'slideStart'
  | 'slideHop'
  | 'slideEnd'
  | 'dashStart'
  | 'dashEnd'
  | 'doubleJump'
  | 'grappleAttach'
  | 'grappleMiss'
  | 'grappleArrive'
  | 'grappleRelease';

export interface MovementTechResult {
  active: 'slide' | 'dash' | 'grapple' | null;
  vel: Vec3;
  /** Remaining invulnerability ticks from an active dash (0 when not invulnerable). */
  invulnTicks: number;
  /** True when movement tech controls horizontal velocity this tick. */
  overrideHorizontal: boolean;
  /** True when gravity should be suppressed this tick (dash or active grapple pull). */
  suppressGravity: boolean;
  doubleJumped: boolean;
  slideHopped: boolean;
  events: MovementTechEvent[];
}

function inBox(box: AabbVolume, x: number, y: number, z: number): boolean {
  return (
    x >= box.min[0] && x <= box.max[0]
    && y >= box.min[1] && y <= box.max[1]
    && z >= box.min[2] && z <= box.max[2]
  );
}

function isBlockedByNoGrapple(zones: readonly AabbVolume[] | undefined, x: number, y: number, z: number): boolean {
  if (!zones || zones.length === 0) return false;
  for (let i = 0; i < zones.length; i++) {
    if (inBox(zones[i], x, y, z)) return true;
  }
  return false;
}

function scaleCooldown(baseTicks: number, cooldownMult: number): number {
  const mult = cooldownMult > 0.1 ? cooldownMult : 0.1;
  return Math.max(1, Math.round(baseTicks * mult));
}

function grappleSpeedScale(x: number, y: number, z: number, limit: number): number {
  const speed = Math.hypot(x, y, z);
  return speed > limit ? limit / speed : 1;
}

function releaseGrappleSpeed(vel: Vec3): void {
  const k = grappleSpeedScale(vel.x, vel.y, vel.z, MOVEMENT_TECH.grappleReleaseSpeed);
  vel.x *= k;
  vel.y *= k;
  vel.z *= k;
}

function anchorOnRay(
  anchors: readonly GrappleAnchor[] | undefined,
  origin: Readonly<Vec3>,
  dir: Readonly<Vec3>,
  maxDist: number,
): (Vec3 & { dist: number; id: string | null }) | null {
  if (!anchors || anchors.length === 0) return null;
  let best: (Vec3 & { dist: number; id: string | null }) | null = null;
  let bestT = maxDist;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const ax = a.at[0];
    const ay = a.at[1];
    const az = a.at[2];
    const ox = ax - origin.x;
    const oy = ay - origin.y;
    const oz = az - origin.z;
    if (Math.hypot(ox, oy, oz) > maxDist) continue;
    const t = ox * dir.x + oy * dir.y + oz * dir.z;
    if (t < 0.4 || t > maxDist) continue;
    const px = origin.x + dir.x * t;
    const py = origin.y + dir.y * t;
    const pz = origin.z + dir.z * t;
    const miss = Math.hypot(ax - px, ay - py, az - pz);
    const reach = a.r ?? MOVEMENT_TECH.grappleAnchorRayRadius;
    if (miss <= reach && t < bestT) {
      bestT = t;
      best = { x: ax, y: ay, z: az, dist: t, id: a.id ?? null };
    }
  }
  return best;
}

function snapAnchor(
  anchors: readonly GrappleAnchor[] | undefined,
  point: Readonly<Vec3>,
  origin: Readonly<Vec3>,
  maxDist: number,
): (Vec3 & { id: string | null }) | null {
  if (!anchors || anchors.length === 0) return null;
  let best: (Vec3 & { id: string | null }) | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const ax = a.at[0];
    const ay = a.at[1];
    const az = a.at[2];
    const reach = a.r ?? MOVEMENT_TECH.grappleAnchorSnapRadius;
    const d = Math.hypot(ax - point.x, ay - point.y, az - point.z);
    if (d <= reach && d < bestDist && Math.hypot(ax - origin.x, ay - origin.y, az - origin.z) <= maxDist) {
      bestDist = d;
      best = { x: ax, y: ay, z: az, id: a.id ?? null };
    }
  }
  return best;
}

function findGrappleHook(
  origin: Readonly<Vec3>,
  dir: Readonly<Vec3>,
  anchors: readonly GrappleAnchor[] | undefined,
  noGrapple: readonly AabbVolume[] | undefined,
  raycastFn: MovementRaycastFn | undefined,
): (Vec3 & { id: string | null }) | null {
  const maxDist = MOVEMENT_TECH.grappleRange;
  let hit: (Vec3 & { dist: number; id: string | null }) | null = null;
  const solid = raycastFn ? raycastFn(origin, dir, maxDist) : null;
  if (solid && solid.dist > 0.4 && solid.dist <= maxDist) {
    hit = { x: solid.point.x, y: solid.point.y, z: solid.point.z, dist: solid.dist, id: solid.id ?? null };
  }
  const along = anchorOnRay(anchors, origin, dir, maxDist);
  if (along && (!hit || along.dist <= hit.dist + 0.4)) {
    hit = along;
  }
  if (!hit) return null;
  let target: Vec3 & { id: string | null } = { x: hit.x, y: hit.y, z: hit.z, id: hit.id };
  const snapped = snapAnchor(anchors, target, origin, maxDist);
  if (snapped) target = snapped;
  if (isBlockedByNoGrapple(noGrapple, target.x, target.y, target.z)) return null;
  return target;
}

function hasGrappleLineOfSight(
  origin: Readonly<Vec3>,
  anchor: Readonly<Vec3>,
  raycastFn: MovementRaycastFn | undefined,
): boolean {
  if (!raycastFn) return true;
  const dx = anchor.x - origin.x;
  const dy = anchor.y - origin.y;
  const dz = anchor.z - origin.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= MOVEMENT_TECH.grappleLosMargin + 0.05) return true;
  const checkDist = dist - MOVEMENT_TECH.grappleLosMargin;
  const hit = raycastFn(origin, { x: dx / dist, y: dy / dist, z: dz / dist }, checkDist);
  return !hit || hit.dist >= checkDist;
}

/**
 * Advance one 60 Hz tick of movement tech (Slide, Dash, Double-Jump, Grapple).
 * Pure function: mutates `state` and `input.vel` deterministically with no side effects.
 */
export function stepMovementTech(
  state: MovementTechState,
  input: MovementTechInput,
  abilities: Readonly<MovementAbilities>,
  mounted: boolean,
  cooldownMult = 1,
  raycastFn?: MovementRaycastFn,
  groundSlopeFn?: GroundSlopeFn,
): MovementTechResult {
  const dt = input.dt ?? DT;
  const vel = input.vel;
  const events: MovementTechEvent[] = [];

  // Cooldowns always tick down.
  if (state.slideHopCdTicks > 0) state.slideHopCdTicks--;
  if (state.dashCdTicks > 0) state.dashCdTicks--;
  if (state.grappleCdTicks > 0) state.grappleCdTicks--;

  if (input.grounded) {
    state.doubleJumpUsed = false;
  }

  // Disabled while mounted so the Pepe Bull remains the fastest surface travel option.
  if (mounted) {
    state.slidingTicks = 0;
    state.dashTicks = 0;
    state.grapple = null;
    return {
      active: null,
      vel,
      invulnTicks: 0,
      overrideHorizontal: false,
      suppressGravity: false,
      doubleJumped: false,
      slideHopped: false,
      events,
    };
  }

  let active: 'slide' | 'dash' | 'grapple' | null = null;
  let invulnTicks = 0;
  let overrideHorizontal = false;
  let suppressGravity = false;
  let doubleJumped = false;
  let slideHopped = false;

  const faceX = Math.sin(input.yaw);
  const faceZ = Math.cos(input.yaw);
  const wishLen = Math.hypot(input.wishX, input.wishZ);

  // 1. Dash (gated by abilities.dash)
  if (abilities.dash && input.dashPressed && state.dashCdTicks === 0 && state.dashTicks === 0) {
    const dirX = wishLen > 0.1 ? input.wishX / wishLen : faceX;
    const dirZ = wishLen > 0.1 ? input.wishZ / wishLen : faceZ;
    state.dashDir = { x: dirX, z: dirZ };
    state.dashTicks = MOVEMENT_TECH.dashTicks;
    state.dashCdTicks = scaleCooldown(MOVEMENT_TECH.dashCooldownTicks, cooldownMult);
    state.slidingTicks = 0;
    state.grapple = null;
    events.push('dashStart');
  }

  if (state.dashTicks > 0) {
    const elapsedBefore = MOVEMENT_TECH.dashTicks - state.dashTicks;
    if (elapsedBefore < MOVEMENT_TECH.dashInvulnTicks) {
      invulnTicks = MOVEMENT_TECH.dashInvulnTicks - elapsedBefore;
    }
    vel.x = state.dashDir.x * MOVEMENT_TECH.dashSpeed;
    vel.z = state.dashDir.z * MOVEMENT_TECH.dashSpeed;
    vel.y = Math.max(vel.y, 0);
    state.dashTicks--;
    active = 'dash';
    overrideHorizontal = true;
    suppressGravity = true;
    if (state.dashTicks === 0) {
      vel.x *= MOVEMENT_TECH.dashEndScale;
      vel.z *= MOVEMENT_TECH.dashEndScale;
      events.push('dashEnd');
    }
    return {
      active,
      vel,
      invulnTicks,
      overrideHorizontal,
      suppressGravity,
      doubleJumped,
      slideHopped,
      events,
    };
  }

  // 2. Grapple (gated by abilities.grapple)
  if (!abilities.grapple || !input.grappleHeld) {
    if (state.grapple?.active) {
      releaseGrappleSpeed(vel);
      state.grapple = null;
      events.push('grappleRelease');
    }
  } else {
    const eyeOrigin: Vec3 = {
      x: input.pos.x,
      y: input.pos.y + MOVEMENT_TECH.grappleEyeHeight,
      z: input.pos.z,
    };
    if (!state.grapple && state.grappleCdTicks === 0) {
      let aimX = faceX;
      let aimY = 0;
      let aimZ = faceZ;
      if (input.aimDir) {
        const al = Math.hypot(input.aimDir.x, input.aimDir.y, input.aimDir.z);
        if (al > 1e-5) {
          aimX = input.aimDir.x / al;
          aimY = input.aimDir.y / al;
          aimZ = input.aimDir.z / al;
        }
      }
      const hook = findGrappleHook(
        eyeOrigin,
        { x: aimX, y: aimY, z: aimZ },
        input.grappleAnchors,
        input.noGrapple,
        raycastFn,
      );
      state.grappleCdTicks = scaleCooldown(MOVEMENT_TECH.grappleCooldownTicks, cooldownMult);
      if (!hook) {
        events.push('grappleMiss');
      } else {
        state.slidingTicks = 0;
        state.grapple = {
          active: true,
          anchor: { x: hook.x, y: hook.y, z: hook.z },
          ticks: 0,
          anchorId: hook.id,
        };
        events.push('grappleAttach');
      }
    }

    if (state.grapple?.active) {
      const anchor = state.grapple.anchor;
      if (!hasGrappleLineOfSight(eyeOrigin, anchor, raycastFn)) {
        releaseGrappleSpeed(vel);
        state.grapple = null;
        events.push('grappleRelease');
      } else {
        const originY = input.pos.y + MOVEMENT_TECH.grappleOriginY;
        const dx = anchor.x - input.pos.x;
        const dy = anchor.y - originY;
        const dz = anchor.z - input.pos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < MOVEMENT_TECH.grappleArrive) {
          releaseGrappleSpeed(vel);
          state.grapple = null;
          events.push('grappleArrive');
        } else {
          const pull = MOVEMENT_TECH.grapplePull * dt;
          vel.x += (dx / dist) * pull;
          vel.y += (dy / dist) * pull;
          vel.z += (dz / dist) * pull;
          const k = grappleSpeedScale(vel.x, vel.y, vel.z, MOVEMENT_TECH.grappleSpeed);
          vel.x *= k;
          vel.y *= k;
          vel.z *= k;
          state.grapple.ticks++;
          active = 'grapple';
          overrideHorizontal = true;
          suppressGravity = true;
        }
      }
    }
  }

  if (active === 'grapple') {
    return {
      active,
      vel,
      invulnTicks,
      overrideHorizontal,
      suppressGravity,
      doubleJumped,
      slideHopped,
      events,
    };
  }

  // 3. Slide & Slide-Hop (gated by abilities.slide)
  const hs = Math.hypot(vel.x, vel.z);
  const canStartSlide =
    abilities.slide
    && input.grounded
    && state.slidingTicks === 0
    && state.slideHopCdTicks === 0
    && input.slidePressed
    && (hs > MOVEMENT_TECH.slideMinSpeed || input.sprinting);

  if (canStartSlide) {
    const dirX = hs > 0.4 ? vel.x / hs : wishLen > 0.1 ? input.wishX / wishLen : faceX;
    const dirZ = hs > 0.4 ? vel.z / hs : wishLen > 0.1 ? input.wishZ / wishLen : faceZ;
    const boost = Math.max(hs, MOVEMENT_TECH.slideBoost);
    vel.x = dirX * boost;
    vel.z = dirZ * boost;
    state.slidingTicks = MOVEMENT_TECH.slideTicks;
    state.slideDir = { x: dirX, z: dirZ };
    events.push('slideStart');
  }

  if (state.slidingTicks > 0) {
    if (input.jumpPressed && input.grounded) {
      // Slide-hop: boost planar speed and end slide.
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > 0.1) {
        const boosted = sp * MOVEMENT_TECH.slideHopBoost;
        vel.x = (vel.x / sp) * boosted;
        vel.z = (vel.z / sp) * boosted;
      }
      state.slidingTicks = 0;
      state.slideHopCdTicks = MOVEMENT_TECH.slideHopCdTicks;
      slideHopped = true;
      events.push('slideHop');
    } else {
      state.slidingTicks--;
      if (wishLen > 0.2) {
        vel.x += input.wishX * MOVEMENT_TECH.slideSteer * dt;
        vel.z += input.wishZ * MOVEMENT_TECH.slideSteer * dt;
      }
      let sp = Math.hypot(vel.x, vel.z) || 0.0001;
      if (groundSlopeFn) {
        const ux = vel.x / sp;
        const uz = vel.z / sp;
        const drop = groundSlopeFn(input.pos, ux, uz);
        if (drop > 0.02) {
          const gain = Math.min(MOVEMENT_TECH.slideSlope * dt, drop * 12);
          vel.x += ux * gain;
          vel.z += uz * gain;
          sp = Math.hypot(vel.x, vel.z) || 0.0001;
        }
      }
      const next = sp + (MOVEMENT_TECH.slideCruise - sp) * Math.min(1, MOVEMENT_TECH.slideDrag * dt);
      const scale = Math.max(0, next) / sp;
      vel.x *= scale;
      vel.z *= scale;
      if (next > 0.01) {
        state.slideDir = { x: vel.x / next, z: vel.z / next };
      }
      active = 'slide';
      overrideHorizontal = true;
      if (state.slidingTicks <= 0 || next < MOVEMENT_TECH.slideStopSpeed || !input.grounded) {
        state.slidingTicks = 0;
        state.slideHopCdTicks = Math.max(state.slideHopCdTicks, MOVEMENT_TECH.slideCdTicks);
        events.push('slideEnd');
      }
    }
  }

  // 4. Double-Jump (gated by abilities.doubleJump, once per airtime, resets on ground)
  if (abilities.doubleJump && input.jumpPressed && !input.grounded && !state.doubleJumpUsed) {
    vel.y = MOVEMENT_TECH.doubleJumpVel;
    state.doubleJumpUsed = true;
    doubleJumped = true;
    events.push('doubleJump');
  }

  return {
    active,
    vel,
    invulnTicks,
    overrideHorizontal,
    suppressGravity,
    doubleJumped,
    slideHopped,
    events,
  };
}
