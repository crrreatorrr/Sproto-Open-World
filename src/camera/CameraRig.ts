import * as THREE from 'three';
import { GAMEPAD, MOUSE } from '../input/bindings';
import { MOUNT } from '../content/mounts';
import type { AimRay } from '../sim/commands';
import type { ReadonlySimView } from '../sim/view';
import { Eased, smoothstep, trail } from './ease';

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
  /**
   * The pivot's height trails the player's, up and down, so a jump, a landing, a kerb and the bumps
   * underfoot don't reach the picture at once. It is never more than `jumpMaxLag` m below its place,
   * nor more than `dropMaxLead` m above it in a fall: room for the tallest step the character takes
   * in one go (`KCC.autostepHeight`). At these rates a jump leaves it less than `clearMargin`
   * behind, so the centre of the screen stays over the player's head (tests/camera/smoothness).
   */
  jumpRiseSharpness: 10,
  jumpMaxLag: 0.6,
  dropSharpness: 10,
  dropMaxLead: 0.6,
  /** Hard lock (plan §4.1): the pivot sits this far from the player toward the target (0.3 = 70% toward the player). */
  lockPivot: 0.3,
  /**
   * …but never more than this (m). The 30% is for melee range; locking a target 15 m away would
   * otherwise slide the pivot 4.5 m out and put the camera inside the player.
   */
  lockPivotMax: 1.6,
  /** How fast the pivot leans toward a new target, and back when the lock is dropped (spring, 1/s). */
  lockShiftResponse: 10,
  /** How fast yaw and pitch turn to face the target (spring, 1/s); pitch is gentler for one overhead. */
  lockYawResponse: 10,
  lockAirPitchResponse: 8,
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
   * camera pulls back so the whole beast stays in the picture. Eased at `rideResponse` (spring, 1/s).
   */
  rideLift: 1.27 * (MOUNT.scale - 1),
  rideDistance: 1 + 0.3 * (MOUNT.scale - 1),
  rideResponse: 5,
  /**
   * Flying the bull: with no look input for `flyChaseAfter` s, the camera swings round behind it
   * and follows its climbs and dives (a share of its pitch, a little above), at `flyChaseSharpness`,
   * which it reaches over `flyChaseEase` s.
   */
  flyChaseAfter: 0.6,
  flyChaseEase: 0.5,
  flyChaseSharpness: 2.5,
  flyChasePitch: 0.55,
  flyChaseAbove: -0.12,
  /**
   * The centre of the screen is where attacks and spells aim, so it must never land on the player
   * or the bull they ride: the camera rises until the centre ray passes this far over them (m).
   */
  clearMargin: 0.35,
  /**
   * The rise lets go as the centre ray moves off a body sideways: all of it over the body, none this
   * far beside it (m). It is no wider than the shoulder cameras stand off the player
   * (`otsShoulder` less the body's radius), so a gun's cameras sit at the player's own height.
   */
  clearFeather: 0.2,
  /** How fast the rise comes on and lets go (spring, 1/s). */
  clearRiseResponse: 20,
  clearFallResponse: 8,
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
  /** How fast the camera moves between modes: distance, shoulder, height and field of view (spring, 1/s). */
  modeResponse: 18,
  /**
   * A wall pulls the camera in at once, less `inSlack` m that it takes at `inResponse` (spring, 1/s):
   * the lumps of a hedge or a rock face behind the camera are eased over, not stepped over. The
   * slack is inside the camera's own radius, so the picture never cuts into the wall.
   */
  inSlack: 0.1,
  inResponse: 40,
  /** How fast it eases back out after a wall pulled it in (1/s), and back over the shoulder or up close. */
  outResponse: 9.5,
  sideResponse: 12,
  /**
   * A wall coming up behind the camera pulls it in as it comes. Something that blocks the boom all
   * at once, by `passStep` m or more, would make it jump, and it only has to when its own place is
   * no place to be (`CameraRig.blockedBy`). Otherwise: what it can still see past, it ignores;
   * something thin (a tree trunk, a post, up to `passThick` m through between where the camera's
   * sphere touches it on either side) is let pass between, as in front of a real camera, and if it
   * is still there after `passGrace` s the camera glides in front of it at `passResponse` (spring,
   * 1/s); in front of anything thicker it glides at once.
   */
  passThick: 1.6,
  passGrace: 0.3,
  passResponse: 12,
  passStep: 0.3,
  /** Seeing the player means seeing this high up their body (m above the feet). */
  passSee: 1.1,
  /** The camera's place is in the clear when nothing is this far over it (m): not underground, not under a roof. */
  passSky: 6,
  /** How fast the sprint's wider view comes and goes (spring, 1/s). */
  sprintFovResponse: 12,
  /** How fast it rises to keep a locked giant's head in the picture (spring, 1/s). */
  liftResponse: 8,
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
/**
 * Third-person / OTS / ADS / scope / first-person camera: raw mouse rotation (no smoothing),
 * smoothed follow (every move the rig makes on its own is eased: camera/ease.ts), sphere-cast collision against the world through the sim's read-only view
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
  /** Giants pull the camera back (EnemyDef.cameraScale): the follow distance's multiplier, eased. */
  distanceScale = 1;
  /** In the saddle (App sets it): lifts the pivot and pulls the camera back, eased. */
  riding = false;
  /** Sliding in FPS / scope mode (App sets it): drops eye height to `CAM.fpsSlideHeight`. */
  sliding = false;
  private readonly ride = new Eased(0);
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
  private readonly lift = new Eased(0);
  private readonly height = new Eased(CAM.height);
  /** The shoulder offset the mode asks for, and how far a wall pushes it back in. */
  private readonly shoulderGoal = new Eased(CAM.shoulder);
  private readonly sidePush = new Eased(0);
  /** The boom length the mode asks for, and how far a wall pulls it in. */
  private readonly reach = new Eased(CAM.distance);
  private readonly boomPull = new Eased(0);
  /** The boom is blocked short of the camera, which is in the clear; and for how long by something thin (s). */
  private passing = false;
  private passT = 0;
  /** The rise over the shoulder when pulled in close. */
  private readonly closeUp = new Eased(0);
  /** The rise that keeps the centre of the screen off the player; `clearFresh` until it is first set. */
  private readonly clear = new Eased(0);
  private clearFresh = true;
  /** The pivot's eased height, before that rise. */
  private readonly follow = new Eased(0);
  private readonly lockShiftX = new Eased(0);
  private readonly lockShiftZ = new Eased(0);
  private readonly lockYaw = new Eased(0);
  private readonly lockPitch = new Eased(0);
  private readonly fovNow = new Eased(CAM.fov);
  private readonly fovBoost = new Eased(0);
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

  /** The camera's distance behind the pivot (m). */
  get distance(): number {
    return Math.max(0, this.reach.x - this.boomPull.x);
  }

  private get shoulder(): number {
    return Math.max(0, this.shoulderGoal.x - this.sidePush.x);
  }

  private get rise(): number {
    return Math.max(0, this.closeUp.x);
  }

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
    this.height.set(this.targetHeight());
    this.shoulderGoal.set(this.targetShoulder());
    this.sidePush.set(0);
    this.reach.set(this.targetDistance());
    this.boomPull.set(0);
    this.passing = false;
    this.passT = 0;
    this.fovNow.set(this.targetFov());
    this.lockShiftX.set(0);
    this.lockShiftZ.set(0);
    this.lockYaw.v = 0;
    this.lockPitch.v = 0;
    this.pivot.set(target.x, target.y + this.height.x, target.z);
    this.follow.set(this.pivot.y);
    this.clearFresh = true;
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
   * The boom is blocked `hit` m behind `from`, well short of where the camera is. Must the camera
   * jump in front of it? Only when its own place at the end of the boom (`reach` m back) is no place
   * to be: inside something, under the ground or under a roof. In clear air it never has to jump:
   *
   * - `'grazed'`: the camera can still see past it, both along the boom and to the player's body at
   *   (`bodyX`, `bodyY`, `bodyZ`): the side of a trunk, the crest of a rise. It stays where it is.
   * - `'thin'`: something up to `passThick` through is between them, or sweeping through the
   *   camera's place. It is probably crossing (a tree trunk as the player runs by): wait.
   * - `'thick'`: something that will not pass. Glide in front of it.
   * - `'solid'`: jump, as before.
   */
  private blockedBy(view: ReadonlySimView, from: THREE.Vector3, reach: number, hit: number, bodyX: number, bodyY: number, bodyZ: number): 'grazed' | 'thin' | 'thick' | 'solid' {
    const r = CAM.collisionRadius;
    const f = this.forward;
    // From the camera's place back toward the player: the far side of whatever is in the way.
    const end = this.desired.copy(from).addScaledVector(f, -reach);
    const toPlayer = { x: f.x * reach, y: f.y * reach, z: f.z * reach };
    let back = view.sphereCast(end, toPlayer, r);
    let kind: 'grazed' | 'thin' | 'thick';
    if (back && back.distance >= 0.05) {
      const toBody = { x: bodyX - end.x, y: bodyY - end.y, z: bodyZ - end.z };
      if (view.sphereCast(end, toPlayer, 0.03) === null && view.sphereCast(end, toBody, 0.03) === null) kind = 'grazed';
      else kind = reach - hit - back.distance > CAM.passThick ? 'thick' : 'thin';
    } else {
      // The camera's place is inside it. Thin, if there is clear air just beyond the thickest a thin thing may be.
      const far = hit + CAM.passThick;
      end.copy(from).addScaledVector(f, -far);
      back = view.sphereCast(end, { x: f.x * far, y: f.y * far, z: f.z * far }, r);
      if (!back || back.distance < 0.05) return 'solid';
      kind = 'thin';
    }
    // Under the ground or a roof, the far side of a surface is nowhere a camera should be.
    const over = { x: end.x, y: end.y + CAM.passSky, z: end.z };
    return view.sphereCast(over, { x: 0, y: -(CAM.passSky - 0.05), z: 0 }, 0.03) === null ? kind : 'solid';
  }

  /**
   * How far the pivot must rise above its place (`ty`, where it sits once it has caught up with the
   * player) for the centre ray, taken `side` m to the pivot's right, to pass `margin` over every
   * occluder. Over a body's footprint the ray is lowest at its near edge when looking up and at its
   * far edge when looking down; behind the camera nothing counts. The rise fades out over
   * `clearFeather` as the ray moves off a body sideways, rather than stopping at its edge.
   */
  private riseOver(ty: number, side: number, margin: number): number {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const slope = Math.tan(this.pitch);
    const behind = -this.distance * Math.cos(this.pitch);
    const px = this.pivot.x + this.right.x * side, pz = this.pivot.z + this.right.z * side;
    let rise = 0;
    for (const o of this.occluders) {
      // The flat ray s ↦ p + s·f in the box's own axes: along its length (l) and its width (w).
      const lx = Math.sin(o.yaw), lz = Math.cos(o.yaw);
      const ox = px - o.x, oz = pz - o.z;
      const atL = ox * lx + oz * lz, stepL = fx * lx + fz * lz;
      const atW = ox * lz - oz * lx, stepW = fx * lz - fz * lx;
      // How much wider the box would have to be, all round, for the ray's line to touch it.
      const miss = (Math.abs(atL * stepW - atW * stepL) - o.halfLength * Math.abs(stepW) - o.halfWidth * Math.abs(stepL)) / (Math.abs(stepW) + Math.abs(stepL));
      if (miss >= CAM.clearFeather) continue;
      const grow = Math.max(0, miss) + 1e-6;
      let s0 = behind, s1 = Infinity;
      for (const [at, step, half] of [
        [atL, stepL, o.halfLength + grow],
        [atW, stepW, o.halfWidth + grow],
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
      rise = Math.max(rise, (1 - smoothstep(miss / CAM.clearFeather)) * Math.max(0, o.top + margin - worst * slope - ty));
    }
    return rise;
  }

  /**
   * The rise that keeps the centre of the screen off the player and the bull, as a goal for the
   * spring. Two things ask for it:
   *
   * - The camera's place: where the centre ray is meant to pass, it passes `clearMargin` over a body.
   *   The pivot trails the player, and that lag must not decide this, or the rise would switch on
   *   and off as they run sideways (WORLD-0005): the ray is taken from where the pivot is heading
   *   sideways (`sideLag` m to its right). So behind the player the rise is always there, and over
   *   the shoulder it never is, whichever way they run.
   * - The ray itself: wherever the lag does carry a body under it (a gun in hand, running toward the
   *   shoulder side, looking down), the ray must still not meet the body. No margin: just over it.
   */
  private clearRise(ty: number, sideLag: number): number {
    return Math.max(this.riseOver(ty, this.shoulder + sideLag, CAM.clearMargin), this.riseOver(ty, this.shoulder, 0));
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
    this.lift.to(Math.min(CAM.lockTallMax, Math.max(0, tall)), CAM.liftResponse, dt);
    this.ride.to(this.riding ? 1 : 0, CAM.rideResponse, dt);
    this.height.to(this.targetHeight(), CAM.modeResponse, dt);
    this.sinceLook += dt;
    if (this.flight && !lockOn && this.sinceLook > CAM.flyChaseAfter) {
      const k = (1 - Math.exp(-CAM.flyChaseSharpness * dt)) * smoothstep((this.sinceLook - CAM.flyChaseAfter) / CAM.flyChaseEase);
      this.yaw += Math.atan2(Math.sin(this.flight.yaw - this.yaw), Math.cos(this.flight.yaw - this.yaw)) * k;
      this.pitch += (this.flight.pitch * CAM.flyChasePitch + CAM.flyChaseAbove - this.pitch) * k;
      this.clampPitch();
    }
    // Where the pivot is heading: above the player, leaning toward a locked target.
    const goal = this.tmp.set(target.x, target.y + this.height.x + this.lift.x + this.ride.x * CAM.rideLift, target.z);
    let shiftX = 0, shiftZ = 0;
    if (lockOn && !fp) {
      const dx = lockOn.x - target.x, dz = lockOn.z - target.z;
      const flat = Math.max(1e-3, Math.hypot(dx, dz));
      // The pivot leans toward the target, but never into its body.
      const room = body ? Math.max(0, flat - body.radius - CAM.solidMargin) / flat : 1;
      const shift = Math.min(CAM.lockPivot, CAM.lockPivotMax / flat, room);
      shiftX = dx * shift;
      shiftZ = dz * shift;
      this.lockYaw.x = this.yaw;
      if (dx * dx + dz * dz > 0.04) this.yaw = this.lockYaw.toAngle(Math.atan2(dx, dz), CAM.lockYawResponse, dt);
      // Keep the locked enemy at the centre of the screen, within the lock's pitch range. A target
      // overhead (the Skyfire Drake) lifts the top of that range, so the camera can look up at it.
      const toTarget = Math.atan2(lockOn.y - goal.y, Math.max(0.5, Math.hypot(lockOn.x - goal.x - shiftX, lockOn.z - goal.z - shiftZ)));
      const up = Math.atan2(lockOn.y - target.y - CAM.height, Math.max(1, Math.hypot(dx, dz))) - CAM.lockAirMargin;
      const air = Math.min(CAM.lockAirMaxPitch, up);
      const hi = Math.max(CAM.lockMaxPitch, air);
      this.lockPitch.x = this.pitch;
      this.pitch = this.lockPitch.to(Math.min(hi, Math.max(CAM.lockMinPitch, toTarget)), air > 0 ? CAM.lockAirPitchResponse : CAM.lockYawResponse, dt);
    } else if (Math.abs(this.lockYaw.v) + Math.abs(this.lockPitch.v) > 1e-4) {
      // Let go of mid-turn: the turn runs out instead of stopping dead.
      const fade = Math.exp(-CAM.lockYawResponse * dt);
      this.yaw += this.lockYaw.v * dt;
      this.pitch += this.lockPitch.v * dt;
      this.lockYaw.v *= fade;
      this.lockPitch.v *= fade;
      this.clampPitch();
    }
    // The lean comes on and lets go on a spring: locking on must not lurch the camera.
    goal.x += this.lockShiftX.to(shiftX, CAM.lockShiftResponse, dt);
    goal.z += this.lockShiftZ.to(shiftZ, CAM.lockShiftResponse, dt);
    if (!this.hasPivot) {
      this.pivot.copy(goal);
      this.follow.set(goal.y);
      this.clearFresh = true;
      this.hasPivot = true;
    }
    this.pivot.x = damp(this.pivot.x, goal.x, CAM.followSharpness, dt);
    this.pivot.z = damp(this.pivot.z, goal.z, CAM.followSharpness, dt);
    // The height trails: lazily up, a little faster down, and never far from its place either way.
    const ty = goal.y;
    if (ty > this.follow.x) trail(this.follow, ty, CAM.jumpRiseSharpness, CAM.jumpMaxLag, dt);
    else trail(this.follow, ty, CAM.dropSharpness, CAM.dropMaxLead, dt);

    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    // Rise far enough that the centre of the screen sees past the player and the bull (3P modes only).
    // The rise is added to the trailing height, so it doesn't undo the trailing, and it comes on and
    // lets go on a spring: whatever changes under the centre ray, the camera never steps.
    const sideLag = (goal.x - this.pivot.x) * this.right.x + (goal.z - this.pivot.z) * this.right.z;
    const clear = fp ? 0 : this.clearRise(ty, sideLag);
    if (this.clearFresh) this.clear.set(clear);
    else this.clear.to(clear, clear > this.clear.x ? CAM.clearRiseResponse : CAM.clearFallResponse, dt);
    this.clearFresh = false;
    this.pivot.y = this.follow.x + Math.max(0, this.clear.x);

    // Shoulder offset, then pull back along -forward; both legs are sphere casts so the near plane
    // never slices into a wall the camera only just misses.
    const r = CAM.collisionRadius;
    this.shoulderGoal.to(this.targetShoulder(), CAM.modeResponse, dt);
    const wantShoulder = Math.max(0, this.shoulderGoal.x);
    let push = 0;
    if (wantShoulder > 1e-4) {
      this.desired.copy(this.right).multiplyScalar(wantShoulder);
      const sideHit = view.sphereCast(this.pivot, this.desired, r);
      if (sideHit) push = wantShoulder - Math.max(0, sideHit.distance - 0.02);
    }
    // Pushed in at once by a wall, eased back out. With no wall the mode's own easing is all there is.
    if (push > this.sidePush.x) this.sidePush.set(push);
    else this.sidePush.to(push, CAM.sideResponse, dt);
    const shoulder = this.tmp.copy(this.pivot).addScaledVector(this.right, this.shoulder);

    this.scaleNow = damp(this.scaleNow, this.distanceScale * (1 + this.ride.x * (CAM.rideDistance - 1)), 3, dt);
    if (this.pushInT > 0) this.pushInT = Math.max(0, this.pushInT - dt);
    const baseDist = this.targetDistance();
    this.reach.to(baseDist > 0 ? baseDist * this.scaleNow * (this.pushInT > 0 ? 0.78 : 1) : 0, CAM.modeResponse, dt);
    const reach = Math.max(0, this.reach.x);
    let maxDist = reach;
    let glide = false;
    let passing = false;
    if (reach > 1e-4) {
      this.desired.copy(this.forward).multiplyScalar(-reach);
      const backHit = view.sphereCast(shoulder, this.desired, r);
      const free = backHit ? Math.max(0, backHit.distance - 0.02) : reach;
      // Blocked all at once, short of where the camera is (and until it is in front, or the way is clear).
      const sudden = backHit !== null && reach - free > this.boomPull.x + (this.passing ? 0.002 : CAM.passStep);
      const by = sudden ? this.blockedBy(view, shoulder, reach, backHit.distance, target.x, target.y + CAM.passSee, target.z) : 'solid';
      passing = by !== 'solid';
      this.passT = by === 'thin' ? this.passT + dt : 0;
      glide = by === 'thick' || this.passT > CAM.passGrace;
      maxDist = this.clearOfSolid(shoulder, passing && !glide ? reach : free);
    }
    this.passing = passing;
    // Pull in at once when blocked (but for the slack), ease back out. From clear air, glide in front
    // of what is in the way.
    const pull = reach - maxDist;
    if (glide) this.boomPull.to(pull, CAM.passResponse, dt);
    else if (pull > this.boomPull.x) {
      this.boomPull.to(pull, CAM.inResponse, dt);
      if (this.boomPull.x < pull - CAM.inSlack) this.boomPull.set(pull - CAM.inSlack);
    } else this.boomPull.to(pull, CAM.outResponse, dt);

    const cam = this.camera;
    cam.position.copy(shoulder).addScaledVector(this.forward, -this.distance);
    // Pulled in close: rise over the shoulder as far as the space above allows (3P modes only).
    const closeRef = Math.min(reach, 2.2);
    const close = !fp && closeRef > 0.1 ? Math.max(0, 1 - this.distance / closeRef) : 0;
    const closeRise = CAM.closeRise * smoothstep(close);
    const up = Math.max(closeRise, this.rise);
    let ceiling = Infinity;
    if (up > 0.01) {
      const upHit = view.sphereCast(cam.position, { x: 0, y: up, z: 0 }, r);
      if (upHit) ceiling = Math.max(0, upHit.distance - 0.02);
    }
    // Eased both ways; only a ceiling stops it at once.
    this.closeUp.to(Math.min(closeRise, ceiling), CAM.sideResponse, dt);
    if (this.closeUp.x > ceiling) this.closeUp.set(ceiling);
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
    this.fovNow.to(this.targetFov(), CAM.modeResponse, dt);
    this.fovBoost.to(sprinting && !zoomed ? CAM.sprintFovBoost : 0, CAM.sprintFovResponse, dt);
    this.fovKick = damp(this.fovKick, 0, CAM.fovKickSharpness, dt);
    const fov = this.fovNow.x + this.fovBoost.x - this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
