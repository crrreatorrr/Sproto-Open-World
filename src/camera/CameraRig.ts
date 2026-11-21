import * as THREE from 'three';
import { GAMEPAD, MOUSE } from '../input/bindings';
import { MOUNT } from '../content/mounts';
import type { AimRay } from '../sim/commands';
import type { ReadonlySimView } from '../sim/view';

/** Tuning, from sproto-duel's camera (pulled back a little for melee: you need to see around you). */
export const CAM = {
  fov: 62,
  sprintFovBoost: 6,
  distance: 4.6,
  /** The pivot rides just above the head, so the character stands centred, a little below the middle of the screen. */
  height: 1.95,
  shoulder: 0,
  followSharpness: 16,
  minPitch: -0.75,
  maxPitch: 0.65,
  collisionRadius: 0.25,
  maxShakeOffset: 0.3,
  maxShakeRoll: 0.035,
  shakeDecay: 1.7,
  /** The kick of a landed blow: a stiff spring that throws the camera along it and brings it back. */
  kickStiffness: 150,
  kickDamping: 17,
  /** Launch speed per metre of kick asked for, so the spring peaks about there. */
  kickImpulse: 24,
  maxKick: 0.22,
  /** How fast the punch-in of the field of view lets go. */
  fovKickSharpness: 9,
  closeRise: 0.6,
  jumpRiseSharpness: 5,
  jumpMaxLag: 0.6,
  /** Hard lock (plan §4.1): the pivot sits this far from the player toward the target (0.3 = 70% toward the player). */
  lockPivot: 0.3,
  /**
   * …but never more than this (m). The 30% is for melee range; locking a target 15 m away would
   * otherwise slide the pivot 4.5 m out and put the camera inside the player.
   */
  lockPivotMax: 1.6,
  /** How fast yaw turns to face the target (exponential sharpness). */
  lockYawSharpness: 7,
  /** Pitch clamp while locked: −35° to +20°. */
  lockMinPitch: (-35 * Math.PI) / 180,
  lockMaxPitch: (20 * Math.PI) / 180,
  /** A locked target high in the air: the camera tips up to keep it this far (radians) below the top of the view. */
  lockAirMargin: 0.42,
  lockAirMaxPitch: (55 * Math.PI) / 180,
  /** A locked body taller than this (m) lifts the pivot, this much per metre, up to the most it may rise (m). */
  lockTallFrom: 3.2,
  lockTallLift: 0.28,
  lockTallMax: 1.5,
  /** Only bodies at least this tall (m) count as big: the camera works around them. */
  solidFrom: 3,
  /** The camera and the pivot keep this far off a big body's capsule (m). */
  solidMargin: 0.45,
  /**
   * On the bull: the pivot rises with the saddle above the hub-sized bull's (1.27 m at 1×), and the
   * camera pulls back so the whole beast stays in the picture. Eased at `rideSharpness` (1/s).
   */
  rideLift: 1.27 * (MOUNT.scale - 1),
  rideDistance: 1 + 0.3 * (MOUNT.scale - 1),
  rideSharpness: 3,
  /**
   * Flying the bull: with no look input for `flyChaseAfter` s, the camera swings round behind it
   * and follows its climbs and dives (a share of its pitch, a little above), at `flyChaseSharpness`.
   */
  flyChaseAfter: 0.6,
  flyChaseSharpness: 2.5,
  flyChasePitch: 0.55,
  flyChaseAbove: -0.12,
  /**
   * The centre of the screen is where attacks and spells aim, so it must never land on the player
   * or the bull they ride: the camera rises until the centre ray passes this far over them (m).
   */
  clearMargin: 0.35,
  /**
   * How the models are drawn (m), measured in the game on the hub-sized bull (1×): the player's crown
   * on foot (the staff on their back included) and in the saddle, above their feet origin; the Pepe
   * Bull's back and horns above the ground, and half its length nose to tail (longer than its
   * collider, `MOUNT.bodyHalfLength`). The bull's own lengths grow with `MOUNT.scale`; the rider sits
   * higher by the saddle's rise (`rideLift`).
   */
  footTop: 1.95,
  riderTop: 2.45 + 1.27 * (MOUNT.scale - 1),
  bullTop: 1.75 * MOUNT.scale,
  bullHalfLength: 1.4 * MOUNT.scale,
  /** Over-the-shoulder hip-fire camera (distance, right shoulder offset, FOV). */
  otsDistance: 3.4,
  otsShoulder: 0.55,
  otsFov: 62,
  /** Tight over-the-shoulder ADS camera. */
  adsDistance: 1.9,
  adsShoulder: 0.65,
  adsFov: 46,
  /** Sniper scope levels: scope1 uses zoomFov ?? 28; scope2 narrows by 1/3. */
  scope1Fov: 28,
  scope2Factor: 1 / 3,
  /** First-person eye-level camera (standing and sliding heights, FOV, pitch limits). */
  fpsFov: 68,
  fpsHeight: 1.6,
  fpsSlideHeight: 0.72,
  fpsMinPitch: -1.4,
  fpsMaxPitch: 1.4,
  /** Exponential damping sharpness (1/s) when blending between camera modes. */
  modeSharpness: 12,
} as const;

export type CameraMode = 'orbit' | 'ots' | 'ads' | 'scope1' | 'scope2' | 'fps';

/**
 * A body the centre ray must pass over: the player, or the bull under them. An upright box: its
 * centre on the ground plane, its heading, half its width and length, and the height of its top (m).
 */
export interface CameraOccluder {
  x: number;
  z: number;
  yaw: number;
  halfWidth: number;
  halfLength: number;
  top: number;
}

/** A big body the camera must not end up inside: the locked target, or the boss of the fight. */
export interface CameraSolid {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

const damp = (a: number, b: number, sharpness: number, dt: number) => a + (b - a) * (1 - Math.exp(-sharpness * dt));
/** Damp an angle along the short way round. */
const dampAngle = (a: number, b: number, sharpness: number, dt: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-sharpness * dt));
};

/**
 * Third-person / OTS / ADS / scope / first-person camera: raw mouse rotation (no smoothing),
 * smoothed follow, sphere-cast collision against the world through the sim's read-only view
 * (Rapier stays inside the sim), and trauma² shake.
 */
export class CameraRig {
  yaw = 0;
  pitch = -0.12;
  /** Mouse sensitivity multiplier and pad look multiplier (Settings). */
  mouseScale = 1;
  padScale = 1;
  invertY = false;
  /** 0..1; shake = trauma². Decays on its own. */
  trauma = 0;
  distance: number = CAM.distance;
  /** Giants pull the camera back (EnemyDef.cameraScale): the follow distance's multiplier, eased. */
  distanceScale = 1;
  /** In the saddle (App sets it): lifts the pivot and pulls the camera back, eased. */
  riding = false;
  /** Sliding in FPS / scope mode (App sets it): drops eye height to `CAM.fpsSlideHeight`. */
  sliding = false;
  private rideNow = 0;
  /** Flying the bull (App sets it): its heading and nose pitch, for the chase camera. */
  flight: { yaw: number; pitch: number } | null = null;
  /** Seconds since the player last turned the camera. */
  private sinceLook = Infinity;
  /** The body to keep out of (App sets it every frame). */
  solid: CameraSolid | null = null;
  /** The bodies the centre of the screen must see past (App sets them every frame). */
  occluders: readonly CameraOccluder[] = [];
  private _mode: CameraMode = 'orbit';
  private thirdPersonMode: CameraMode = 'orbit';
  private zoomFov: number | undefined = undefined;
  private scaleNow = 1;
  private lift = 0;
  private heightNow: number = CAM.height;
  private desiredShoulder: number = CAM.shoulder;
  private shoulder: number = CAM.shoulder;
  private desiredDistance: number = CAM.distance;
  private rise = 0;
  private fovNow: number = CAM.fov;
  private fovBoost = 0;
  private time = 0;
  /** Seconds left of a brief push-in (Scrapjaw's parried bite). */
  private pushInT = 0;
  private padHeldEdge = 0;
  private readonly kickAt = new THREE.Vector3();
  private readonly kickVel = new THREE.Vector3();
  /** A sharp punch-in (degrees) that eases back out: `kick`. */
  private fovKick = 0;
  private readonly pivot = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private hasPivot = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  get mode(): CameraMode {
    return this._mode;
  }

  /** True when the camera sits at eye level (first-person or sniper scope). */
  get isFirstPerson(): boolean {
    return this._mode === 'fps' || this._mode === 'scope1' || this._mode === 'scope2';
  }

  /** Switch camera mode with optional per-weapon ADS/scope FOV override. */
  setCameraMode(mode: CameraMode, zoomFov?: number): void {
    this._mode = mode;
    this.zoomFov = zoomFov;
    if (mode === 'orbit' || mode === 'ots' || mode === 'ads') {
      this.thirdPersonMode = mode;
    }
    this.clampPitch();
  }

  /** Toggle between eye-level first-person and the last third-person mode. */
  toggleFirstPerson(): CameraMode {
    if (this._mode === 'fps') {
      this.setCameraMode(this.thirdPersonMode);
    } else {
      this.setCameraMode('fps');
    }
    return this._mode;
  }

  private targetDistance(): number {
    switch (this._mode) {
      case 'orbit': return CAM.distance;
      case 'ots': return CAM.otsDistance;
      case 'ads': return CAM.adsDistance;
      case 'scope1':
      case 'scope2':
      case 'fps':
        return 0;
    }
  }

  private targetShoulder(): number {
    switch (this._mode) {
      case 'orbit': return CAM.shoulder;
      case 'ots': return CAM.otsShoulder;
      case 'ads': return CAM.adsShoulder;
      case 'scope1':
      case 'scope2':
      case 'fps':
        return 0;
    }
  }

  private targetHeight(): number {
    if (this.isFirstPerson) return this.sliding ? CAM.fpsSlideHeight : CAM.fpsHeight;
    return CAM.height;
  }

  private targetFov(): number {
    switch (this._mode) {
      case 'orbit': return CAM.fov;
      case 'ots': return CAM.otsFov;
      case 'ads': return this.zoomFov ?? CAM.adsFov;
      case 'scope1': return this.zoomFov ?? CAM.scope1Fov;
      case 'scope2': return (this.zoomFov ?? CAM.scope1Fov) * CAM.scope2Factor;
      case 'fps': return CAM.fpsFov;
    }
  }

  /**
   * Zoomed in, the same hand movement turns the view less, by the zoom's share of the hip view, so
   * the picture moves across the screen at the same speed at every zoom.
   */
  get lookScale(): number {
    const m = this._mode;
    return m === 'ads' || m === 'scope1' || m === 'scope2' ? Math.min(1, this.targetFov() / CAM.otsFov) : 1;
  }

  /** Turn the view by angles (rad), outside the look settings: aim assist's pull, a shot's recoil. */
  nudge(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch += dPitch;
    this.clampPitch();
  }

  rotateMouse(dx: number, dy: number): void {
    const s = MOUSE.sensitivity * this.mouseScale * this.lookScale;
    if (dx !== 0 || dy !== 0) this.sinceLook = 0;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (this.invertY ? -1 : 1);
    this.clampPitch();
  }

  /** Right stick, already shaped (deadzone + curve), -1..1 with +y = down. */
  rotatePad(x: number, y: number, dt: number): void {
    const G = GAMEPAD;
    const A = G.acceleration;
    if (x !== 0 || y !== 0) this.sinceLook = 0;
    // Held at the edge: ramp in extra yaw for quick turns.
    if (Math.abs(x) >= A.threshold) this.padHeldEdge += dt;
    else this.padHeldEdge = 0;
    const ramp = Math.min(1, Math.max(0, (this.padHeldEdge - A.delay) / A.rampTime));
    const yawSpeed = (G.sensitivity.yaw + A.extraYaw * ramp) * this.padScale * this.lookScale;
    this.yaw -= x * yawSpeed * dt;
    this.pitch -= y * G.sensitivity.pitch * this.padScale * this.lookScale * dt * (this.invertY ? -1 : 1);
    this.clampPitch();
  }

  /** Current damped right-shoulder offset (m). */
  get shoulderOffset(): number {
    return this.shoulder;
  }

  private clampPitch(): void {
    const lo = this.isFirstPerson ? CAM.fpsMinPitch : CAM.minPitch;
    const hi = this.isFirstPerson ? CAM.fpsMaxPitch : CAM.maxPitch;
    this.pitch = Math.min(hi, Math.max(lo, this.pitch));
  }

  /** Place the camera behind a target instantly (spawn, respawn). */
  snap(target: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.pitch = -0.12;
    this.heightNow = this.targetHeight();
    this.desiredShoulder = this.shoulder = this.targetShoulder();
    this.desiredDistance = this.distance = this.targetDistance();
    this.fovNow = this.targetFov();
    this.pivot.set(target.x, target.y + this.heightNow, target.z);
    this.hasPivot = true;
  }

  /**
   * The ray through the centre of the screen, from the current look angles (mouse and stick move
   * them before the rig's next update). Shake is left out: it must not throw an attack off.
   */
  aimRay(): AimRay | undefined {
    if (!this.hasPivot) return undefined;
    const cp = Math.cos(this.pitch);
    const dir = { x: Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: Math.cos(this.yaw) * cp };
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const from = {
      x: this.pivot.x + rx * this.shoulder - dir.x * this.distance,
      y: Math.max(0.3, this.pivot.y - dir.y * this.distance + this.rise),
      z: this.pivot.z + rz * this.shoulder - dir.z * this.distance,
    };
    return { from, dir };
  }

  /**
   * How far back the camera may sit on the boom from `from`: short of a big body behind the player, or
   * out past it when the boom starts inside one. The world's colliders don't include characters.
   */
  private clearOfSolid(from: THREE.Vector3, dist: number): number {
    const s = this.solid;
    if (!s || s.height < CAM.solidFrom) return dist;
    const R = s.radius + CAM.solidMargin;
    const dx = -this.forward.x, dz = -this.forward.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return dist;
    const ux = dx / len, uz = dz / len;
    const ox = from.x - s.x, oz = from.z - s.z;
    const b = ox * ux + oz * uz;
    const disc = b * b - (ox * ox + oz * oz - R * R);
    if (disc <= 0) return dist;
    const root = Math.sqrt(disc);
    // Along the boom, in metres of boom rather than of flat ground.
    const enter = (-b - root) / len, leave = (-b + root) / len;
    if (leave <= 0) return dist;
    const yAt = (t: number) => from.y - this.forward.y * t;
    const inHeight = (t: number) => yAt(t) >= s.y - 0.5 && yAt(t) <= s.y + s.height + CAM.solidMargin;
    if (enter <= 0) return inHeight(leave) ? Math.max(dist, leave + 0.05) : dist;
    return enter < dist && inHeight(Math.min(dist, leave)) ? Math.max(0, enter - 0.05) : dist;
  }

  /**
   * The lowest pivot height at which the centre ray (through the pivot, along `forward`) passes
   * `clearMargin` over every occluder. Over a body's footprint the ray is lowest at its near edge when
   * looking up and at its far edge when looking down; behind the camera nothing counts.
   */
  private clearHeight(): number {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const slope = Math.tan(this.pitch);
    const behind = -this.distance * Math.cos(this.pitch);
    let need = -Infinity;
    for (const o of this.occluders) {
      // The flat ray s ↦ pivot + s·f in the box's own axes: along its length (l) and its width (w).
      const lx = Math.sin(o.yaw), lz = Math.cos(o.yaw);
      const ox = this.pivot.x + this.right.x * this.shoulder - o.x;
      const oz = this.pivot.z + this.right.z * this.shoulder - o.z;
      let s0 = behind, s1 = Infinity;
      for (const [at, step, half] of [
        [ox * lx + oz * lz, fx * lx + fz * lz, o.halfLength],
        [ox * lz - oz * lx, fx * lz - fz * lx, o.halfWidth],
      ] as const) {
        if (Math.abs(step) < 1e-6) {
          if (Math.abs(at) > half) s1 = -Infinity;
          continue;
        }
        const a = (-half - at) / step, b = (half - at) / step;
        s0 = Math.max(s0, Math.min(a, b));
        s1 = Math.min(s1, Math.max(a, b));
      }
      if (s1 < s0) continue;
      const worst = slope > 0 ? s0 : s1;
      need = Math.max(need, o.top + CAM.clearMargin - worst * slope);
    }
    return need;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Pull the camera in for a short beat, then ease back out. */
  nudgeIn(seconds = 0.45): void {
    this.pushInT = Math.max(this.pushInT, seconds);
  }

  /** A blow landed along (dx, dz): lurch that way by about `metres` and punch in by `fov` degrees. */
  kick(dx: number, dz: number, metres: number, fov = 0): void {
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      this.kickVel.x += (dx / d) * metres * CAM.kickImpulse;
      this.kickVel.z += (dz / d) * metres * CAM.kickImpulse;
    }
    this.fovKick = Math.max(this.fovKick, fov);
  }

  /**
   * Follow `target` (the player's feet). With `lockOn` (the locked enemy's chest), the pivot moves
   * part of the way toward it and yaw eases round to face it; the player keeps pitch control
   * within the lock clamp, and App stops feeding horizontal look into yaw.
   */
  update(dt: number, target: THREE.Vector3, view: ReadonlySimView, sprinting: boolean, lockOn: THREE.Vector3 | null = null): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - CAM.shakeDecay * dt);
    const fp = this.isFirstPerson;
    // Locked onto a giant standing on the same ground: rise, so its head stays in the picture.
    const big = this.solid && this.solid.height >= CAM.solidFrom ? this.solid : null;
    const body = lockOn && !fp ? big : null;
    const tall = body && Math.abs(body.y - target.y) < body.height ? (body.height - CAM.lockTallFrom) * CAM.lockTallLift : 0;
    this.lift = damp(this.lift, Math.min(CAM.lockTallMax, Math.max(0, tall)), 5, dt);
    this.rideNow = damp(this.rideNow, this.riding ? 1 : 0, CAM.rideSharpness, dt);
    this.heightNow = damp(this.heightNow, this.targetHeight(), CAM.modeSharpness, dt);
    this.sinceLook += dt;
    if (this.flight && !lockOn && this.sinceLook > CAM.flyChaseAfter) {
      const k = 1 - Math.exp(-CAM.flyChaseSharpness * dt);
      this.yaw += Math.atan2(Math.sin(this.flight.yaw - this.yaw), Math.cos(this.flight.yaw - this.yaw)) * k;
      this.pitch += (this.flight.pitch * CAM.flyChasePitch + CAM.flyChaseAbove - this.pitch) * k;
      this.clampPitch();
    }
    this.tmp.set(target.x, target.y + this.heightNow + (fp ? 0 : this.lift) + this.rideNow * CAM.rideLift, target.z);
    if (lockOn && !fp) {
      const dx = lockOn.x - target.x, dz = lockOn.z - target.z;
      const flat = Math.max(1e-3, Math.hypot(dx, dz));
      // The pivot leans toward the target, but never into its body.
      const room = body ? Math.max(0, flat - body.radius - CAM.solidMargin) / flat : 1;
      const shift = Math.min(CAM.lockPivot, CAM.lockPivotMax / flat, room);
      this.tmp.x += dx * shift;
      this.tmp.z += dz * shift;
      if (dx * dx + dz * dz > 0.04) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), CAM.lockYawSharpness, dt);
      // Keep the locked enemy at the centre of the screen, within the lock's pitch range. A target
      // overhead (the Skyfire Drake) lifts the top of that range, so the camera can look up at it.
      const toTarget = Math.atan2(lockOn.y - this.tmp.y, Math.max(0.5, Math.hypot(lockOn.x - this.tmp.x, lockOn.z - this.tmp.z)));
      const up = Math.atan2(lockOn.y - target.y - CAM.height, Math.max(1, Math.hypot(dx, dz))) - CAM.lockAirMargin;
      const air = Math.min(CAM.lockAirMaxPitch, up);
      const hi = Math.max(CAM.lockMaxPitch, air);
      this.pitch = damp(this.pitch, Math.min(hi, Math.max(CAM.lockMinPitch, toTarget)), air > 0 ? 5 : CAM.lockYawSharpness, dt);
    }
    if (!this.hasPivot) {
      this.pivot.copy(this.tmp);
      this.hasPivot = true;
    }
    const lastY = this.pivot.y;
    this.pivot.x = damp(this.pivot.x, this.tmp.x, CAM.followSharpness, dt);
    this.pivot.z = damp(this.pivot.z, this.tmp.z, CAM.followSharpness, dt);
    // Rise lazily on a jump (never more than jumpMaxLag behind), drop with the player.
    const ty = this.tmp.y;
    this.pivot.y = ty > lastY ? Math.max(damp(lastY, ty, CAM.jumpRiseSharpness, dt), ty - CAM.jumpMaxLag) : ty;

    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    // Rise far enough that the centre of the screen sees past the player and the bull (3P modes only).
    if (!fp) {
      const clear = this.clearHeight();
      if (clear > this.pivot.y) this.pivot.y = clear;
    }

    // Shoulder offset, then pull back along -forward; both legs are sphere casts so the near plane
    // never slices into a wall the camera only just misses.
    const r = CAM.collisionRadius;
    this.desiredShoulder = damp(this.desiredShoulder, this.targetShoulder(), CAM.modeSharpness, dt);
    let allowedShoulder = this.desiredShoulder;
    if (Math.abs(this.desiredShoulder) > 1e-4) {
      this.desired.copy(this.right).multiplyScalar(this.desiredShoulder);
      const sideHit = view.sphereCast(this.pivot, this.desired, r);
      if (sideHit) allowedShoulder = Math.max(0, sideHit.distance - 0.02);
    }
    this.shoulder = allowedShoulder < this.shoulder ? allowedShoulder : damp(this.shoulder, allowedShoulder, 8, dt);
    const shoulder = this.tmp.copy(this.pivot).addScaledVector(this.right, this.shoulder);

    this.scaleNow = damp(this.scaleNow, this.distanceScale * (1 + this.rideNow * (CAM.rideDistance - 1)), 3, dt);
    if (this.pushInT > 0) this.pushInT = Math.max(0, this.pushInT - dt);
    const baseDist = this.targetDistance();
    const reach = baseDist > 0 ? baseDist * this.scaleNow * (this.pushInT > 0 ? 0.78 : 1) : 0;
    this.desiredDistance = damp(this.desiredDistance, reach, CAM.modeSharpness, dt);
    let maxDist = this.desiredDistance;
    if (this.desiredDistance > 1e-4) {
      this.desired.copy(this.forward).multiplyScalar(-this.desiredDistance);
      const backHit = view.sphereCast(shoulder, this.desired, r);
      maxDist = this.clearOfSolid(shoulder, backHit ? Math.max(0, backHit.distance - 0.02) : this.desiredDistance);
    }
    // Pull in instantly when blocked, ease back out.
    this.distance = maxDist < this.distance ? maxDist : damp(this.distance, maxDist, 6, dt);

    const cam = this.camera;
    cam.position.copy(shoulder).addScaledVector(this.forward, -this.distance);
    // Pulled in close: rise over the shoulder as far as the space above allows (3P modes only).
    const closeRef = Math.min(baseDist, 2.2);
    const close = !fp && closeRef > 0.1 ? Math.max(0, 1 - this.distance / closeRef) : 0;
    let rise = CAM.closeRise * close * close * (3 - 2 * close);
    if (rise > 0.01) {
      const upHit = view.sphereCast(cam.position, { x: 0, y: rise, z: 0 }, r);
      if (upHit) rise = Math.min(rise, Math.max(0, upHit.distance - 0.02));
    }
    this.rise = rise < this.rise ? rise : damp(this.rise, rise, 8, dt);
    cam.position.y += this.rise;
    if (cam.position.y < 0.3) cam.position.y = 0.3;

    const shake = this.trauma * this.trauma;
    const t = this.time * 38;
    cam.position.addScaledVector(this.right, (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 1.7) * 0.5) * shake * CAM.maxShakeOffset);
    cam.position.y += (Math.sin(t * 1.3 + 4.1) + Math.sin(t * 2.9) * 0.5) * shake * CAM.maxShakeOffset;

    // Stepped no coarser than 30 Hz: a long frame must not fling the spring.
    const h = Math.min(dt, 1 / 30);
    this.kickVel.addScaledVector(this.kickAt, -CAM.kickStiffness * h).multiplyScalar(Math.exp(-CAM.kickDamping * h));
    this.kickAt.addScaledVector(this.kickVel, h).clampLength(0, CAM.maxKick);
    cam.position.add(this.kickAt);

    this.tmp.copy(cam.position).add(this.forward);
    cam.lookAt(this.tmp);
    cam.rotateZ((Math.sin(t * 0.9 + 2.2) + Math.sin(t * 1.9) * 0.5) * shake * CAM.maxShakeRoll);

    const zoomed = this._mode === 'ads' || this._mode === 'scope1' || this._mode === 'scope2';
    this.fovNow = damp(this.fovNow, this.targetFov(), CAM.modeSharpness, dt);
    this.fovBoost = damp(this.fovBoost, sprinting && !zoomed ? CAM.sprintFovBoost : 0, 8, dt);
    this.fovKick = damp(this.fovKick, 0, CAM.fovKickSharpness, dt);
    const fov = this.fovNow + this.fovBoost - this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
