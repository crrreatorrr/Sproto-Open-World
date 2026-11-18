import * as THREE from 'three';
import { GAMEPAD, MOUSE } from '../input/bindings';
import type { ReadonlySimView } from '../sim/view';

/** Tuning, from sproto-duel's camera (pulled back a little for melee: you need to see around you). */
export const CAM = {
  fov: 62,
  sprintFovBoost: 6,
  distance: 4.6,
  height: 1.55,
  shoulder: 0.55,
  followSharpness: 16,
  minPitch: -0.75,
  maxPitch: 0.65,
  collisionRadius: 0.25,
  maxShakeOffset: 0.3,
  maxShakeRoll: 0.035,
  shakeDecay: 1.7,
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
} as const;

const damp = (a: number, b: number, sharpness: number, dt: number) => a + (b - a) * (1 - Math.exp(-sharpness * dt));
/** Damp an angle along the short way round. */
const dampAngle = (a: number, b: number, sharpness: number, dt: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-sharpness * dt));
};

/**
 * Third-person camera, ported from sproto-duel `src/camera/CameraRig.ts`: raw mouse rotation (no
 * smoothing), a smoothed follow, sphere-cast collision against the world through the sim's
 * read-only view (Rapier stays inside the sim), and trauma² shake.
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
  private scaleNow = 1;
  private shoulder: number = CAM.shoulder;
  private rise = 0;
  private fovBoost = 0;
  private time = 0;
  private padHeldEdge = 0;
  private readonly pivot = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private hasPivot = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  rotateMouse(dx: number, dy: number): void {
    const s = MOUSE.sensitivity * this.mouseScale;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (this.invertY ? -1 : 1);
    this.clampPitch();
  }

  /** Right stick, already shaped (deadzone + curve), -1..1 with +y = down. */
  rotatePad(x: number, y: number, dt: number): void {
    const G = GAMEPAD;
    const A = G.acceleration;
    // Held at the edge: ramp in extra yaw for quick turns.
    if (Math.abs(x) >= A.threshold) this.padHeldEdge += dt;
    else this.padHeldEdge = 0;
    const ramp = Math.min(1, Math.max(0, (this.padHeldEdge - A.delay) / A.rampTime));
    const yawSpeed = (G.sensitivity.yaw + A.extraYaw * ramp) * this.padScale;
    this.yaw -= x * yawSpeed * dt;
    this.pitch -= y * G.sensitivity.pitch * this.padScale * dt * (this.invertY ? -1 : 1);
    this.clampPitch();
  }

  private clampPitch(): void {
    this.pitch = Math.min(CAM.maxPitch, Math.max(CAM.minPitch, this.pitch));
  }

  /** Place the camera behind a target instantly (spawn, respawn). */
  snap(target: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.pitch = -0.12;
    this.pivot.set(target.x, target.y + CAM.height, target.z);
    this.distance = CAM.distance;
    this.hasPivot = true;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * Follow `target` (the player's feet). With `lockOn` (the locked enemy's chest), the pivot moves
   * part of the way toward it and yaw eases round to face it; the player keeps pitch control
   * within the lock clamp, and App stops feeding horizontal look into yaw.
   */
  update(dt: number, target: THREE.Vector3, view: ReadonlySimView, sprinting: boolean, lockOn: THREE.Vector3 | null = null): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - CAM.shakeDecay * dt);
    this.tmp.set(target.x, target.y + CAM.height, target.z);
    if (lockOn) {
      const dx = lockOn.x - target.x, dz = lockOn.z - target.z;
      const shift = Math.min(CAM.lockPivot, CAM.lockPivotMax / Math.max(1e-3, Math.hypot(dx, dz)));
      this.tmp.x += dx * shift;
      this.tmp.z += dz * shift;
      if (dx * dx + dz * dz > 0.04) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), CAM.lockYawSharpness, dt);
      // Ease into the lock's pitch range rather than snapping when the lock starts. A target overhead
      // (the Skyfire Drake) lifts the range, so the camera looks up and keeps it in frame.
      const up = Math.atan2(lockOn.y - target.y - CAM.height, Math.max(1, Math.hypot(dx, dz))) - CAM.lockAirMargin;
      const air = Math.min(CAM.lockAirMaxPitch, up);
      const lo = air > 0 ? air : CAM.lockMinPitch;
      const hi = Math.max(CAM.lockMaxPitch, air);
      this.pitch = damp(this.pitch, Math.min(hi, Math.max(lo, this.pitch)), air > 0 ? 5 : 12, dt);
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

    // Shoulder offset, then pull back along -forward; both legs are sphere casts so the near plane
    // never slices into a wall the camera only just misses.
    const r = CAM.collisionRadius;
    this.desired.copy(this.right).multiplyScalar(CAM.shoulder);
    const sideHit = view.sphereCast(this.pivot, this.desired, r);
    const allowedShoulder = sideHit ? Math.max(0, sideHit.distance - 0.02) : CAM.shoulder;
    this.shoulder = allowedShoulder < this.shoulder ? allowedShoulder : damp(this.shoulder, allowedShoulder, 8, dt);
    const shoulder = this.tmp.copy(this.pivot).addScaledVector(this.right, this.shoulder);

    this.scaleNow = damp(this.scaleNow, this.distanceScale, 3, dt);
    const reach = CAM.distance * this.scaleNow;
    this.desired.copy(this.forward).multiplyScalar(-reach);
    const backHit = view.sphereCast(shoulder, this.desired, r);
    const maxDist = backHit ? Math.max(0, backHit.distance - 0.02) : reach;
    // Pull in instantly when blocked, ease back out.
    this.distance = maxDist < this.distance ? maxDist : damp(this.distance, maxDist, 6, dt);

    const cam = this.camera;
    cam.position.copy(shoulder).addScaledVector(this.forward, -this.distance);
    // Pulled in close: rise over the shoulder as far as the space above allows.
    const close = Math.max(0, 1 - this.distance / Math.min(CAM.distance, 2.2));
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

    this.tmp.copy(cam.position).add(this.forward);
    cam.lookAt(this.tmp);
    cam.rotateZ((Math.sin(t * 0.9 + 2.2) + Math.sin(t * 1.9) * 0.5) * shake * CAM.maxShakeRoll);

    this.fovBoost = damp(this.fovBoost, sprinting ? CAM.sprintFovBoost : 0, 8, dt);
    const fov = CAM.fov + this.fovBoost;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
