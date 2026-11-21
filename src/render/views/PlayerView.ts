import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import type { Priority } from '../../assets/RequestQueue';
import { OFFHAND_SOCKET, STAFF_SOCKET, WEAPON_SOCKET, type ModelKey } from '../../assets/manifest';
import { PLAYER_MOVES, ROLL, clipTiming, type PlayerMoveId } from '../../content/combat';
import { PLAYER_MOVE_TIMING } from '../../content/generated/playerMoveTiming';
import { BACKSTEP, PLUNGE } from '../../content/packs/m7';
import { SPELLS, type SpellDef } from '../../content/spells';
import { TICK_HZ } from '../../content/tuning';
import type { Entity } from '../../sim/entity';
import { Animator, ENTRY_FADE } from '../anim/Animator';
import { armBones, leftHandGrips, reachArm, relaxHand, squareGun, type ArmBones } from '../anim/gunPose';
import { CAST_PEAKS, castClipTime } from '../anim/castTiming';
import { HitReaction } from '../fx/HitReaction';
import { BodyGlow } from './BodyGlow';
import { glowStatusOf } from './EnemyViews';
import { placeEntity } from './interp';

/** The block clip holds on this clip tick while the guard is up (plan §4.3). */
const BLOCK_HOLD = PLAYER_MOVE_TIMING.block.holdFrom;
/** Falling over is slower to blend into than a combat entry. */
const DEATH_FADE = 0.12;
/** The arms blend into a cast fast (a woven bolt releases 5 ticks in) and back out more gently. */
const CAST_IN_FADE = 0.06;
const CAST_OUT_FADE = 0.15;
/** How much of a flinch a raised guard lets through. */
const GUARD_RECOIL = 0.55;
/** A gun stays raised this long after the last shot (s). */
const AIM_HOLD = 0.6;
/** Between the gun layers (ready hold, shouldered aim, reload). */
const GUN_FADE = 0.14;
/** Into the slide and the dash, and how fast the grapple arm goes out and comes back (1/s). */
const SLIDE_FADE = 0.1;
const DASH_FADE = 0.05;
const GRAPPLE_RATE = 14;
/** How fast a hand's fingers open when it lets go, and close when it takes hold (1/s). */
const FINGER_RATE = 12;

/**
 * What the sim's gun and movement systems are doing for this player, for the frame's pose. The sim
 * keeps these per player, not on the entity (SimWorld.gunRuntime, SimWorld.movementTech).
 */
export interface PlayerPoseInput {
  /** Aiming down the sights. */
  ads: boolean;
  /** The gun in hand is a sidearm (a dual-wield gun): one hand carries it. */
  oneHanded: boolean;
  /** Ticks left in a reload (0: not reloading). */
  reloadTicks: number;
  /** The same for the left hand's gun of a dual-wielded pair. */
  reloadTicksLeft: number;
  sliding: boolean;
  dashing: boolean;
  /** The grapple's anchor while the hook is out. */
  grapple: Readonly<{ x: number; y: number; z: number }> | null;
}
const NO_INPUT: PlayerPoseInput = { ads: false, oneHanded: false, reloadTicks: 0, reloadTicksLeft: 0, sliding: false, dashing: false, grapple: null };
/** Into and out of the saddle poses. */
const RIDE_FADE = 0.1;
/** The rider's bounce: its rate at a standstill, and how fast it rises with the bull's speed (m/s per 1× rate). */
const RIDE_RATE_BASE = 0.6;
const RIDE_RATE_SPEED = 6;
/** A driving strike throws the body forward (radians), easing in and out at this sharpness. */
const DRIVE_LEAN = 0.24;
const DRIVE_LEAN_SHARPNESS = 18;
/** The rider's forward lean (radians): a little at a run, the rest as the bull opens into a gallop. */
const RUN_LEAN = 0.07;
const GALLOP_LEAN = 0.24;
/** Speeds the lean builds across (m/s): from a walk up to a run, then from a run up to a gallop. */
const RUN_LEAN_SPEEDS: readonly [number, number] = [3, 9.5];
const GALLOP_LEAN_SPEEDS: readonly [number, number] = [10.5, 15];
/** How quickly the lean follows the speed (1/s). */
const LEAN_RATE = 5;
/** The lean turns about the saddle, this high above the rider's feet origin (m), so the seat stays put. */
const SEAT_HEIGHT = 1.28;
/** At a gallop the body rides the saddle's bounce a little harder than the saddle itself moves. */
const BOUNCE_GAIN = 0.15;
/** It also rocks with the bounce (radians per metre the saddle is above its average height). */
const BOUNCE_ROCK = 0.5;
/** How quickly the saddle's average height follows it (1/s): the bounce is what is left over. */
const SADDLE_MEAN_RATE = 4;

/**
 * The arms' clip time for a cast. Gunfire's `shoot` (the gun classes' trigger pull) plays straight
 * through its release and recovery; the spells' clips land the hand's peak on the release tick.
 */
function castPose(def: SpellDef, t: number, release: number): { clip: string; time: number } {
  if (def.clip === 'shoot') return { clip: 'shoot', time: t / TICK_HZ };
  return { clip: def.clip, time: castClipTime(CAST_PEAKS.player, def.clip, t, release, def.recovery) };
}

/**
 * Draws one player entity: the rigged body of its class, the weapon in its hand (a staff on
 * `socket_staff`, a gun on `socket_weapon`), and its animation.
 */
export class PlayerView {
  readonly root = new THREE.Group();
  /** The flinch's pivot, between the placed root and the animated model. */
  private readonly pivot = new THREE.Group();
  private readonly reaction = new HitReaction();
  private readonly glow = new BodyGlow();
  animator: Animator | null = null;
  private model: ModelInstance | null = null;
  private staff: ModelInstance | null = null;
  /** Counts setStaff calls, so a slow download can't replace a newer choice. */
  private staffRequest = 0;
  /** The staff attached to the socket (false: no socket, or no staff model). */
  staffMounted = false;
  /** The last update showed an attack clip at the sim's clip tick (QA: command → pose). */
  attackShown = false;
  /** The attack on show, while one is going on. */
  private poseMove: PlayerMoveId | null = null;
  /** The last update showed a cast on the upper body (QA). */
  castShown = false;
  /** On the bull: how far its saddle has moved from its idle height this frame (m). */
  saddleLift = 0;
  private lean = 0;
  /** The rider's current forward lean (radians), and the saddle's average height (m). */
  private rideLean = 0;
  private saddleMean = 0;

  private staffKey: ModelKey | null = null;
  /** Seconds the gun stays raised after a shot. */
  private aimHold = 0;
  /** This frame's gun and movement state (App sets it before `update`). */
  input: PlayerPoseInput = NO_INPUT;
  /** A gun is in hand (not a staff). */
  private gunInHand = false;
  /** Seconds into the trigger pull on show (a shot the sim fired outside a cast), or -1; and which hand's. */
  private shotT = -1;
  private shotHand: 'left' | 'right' = 'right';
  /** The second gun of a dual-wielded pair, in the left hand. */
  private offhand: ModelInstance | null = null;
  private offhandKey: ModelKey | null = null;
  private offhandRequest = 0;
  /** The reload on show: the ticks it started with, so its progress is known. */
  private reloadFrom = 0;
  private reloadFromLeft = 0;
  private slideT = 0;
  /** How open the left hand is (0: gripping, 1: relaxed). */
  private leftOpen = 1;
  private frameDt = 0;
  private grappleArm: ArmBones | null | undefined;
  private grappleWeight = 0;
  private readonly grappleAt = new THREE.Vector3();
  private readonly stopListening: () => void;

  constructor(private readonly assets: AssetLoader, readonly body: ModelKey = 'player') {
    this.stopListening = assets.onRecovered((key) => {
      if (key === this.body) void this.reloadBody();
      else if (key === this.staffKey) void this.setStaff(key);
    });
    this.root.add(this.pivot);
  }

  async load(staffKey: ModelKey = 'staff_sproto'): Promise<void> {
    this.model = await this.assets.instance(this.body);
    this.pivot.add(this.model.root);
    this.forgetGunBones();
    this.glow.adopt(this.model.root);
    this.animator = new Animator(this.model.root, this.model.clips);
    await this.setStaff(staffKey);
  }

  /** A new body: find its arms again. */
  private forgetGunBones(): void {
    this.grappleArm = undefined;
  }

  /** The sim fired this player's gun: the trigger pull plays from its start. `hand`: which gun of a pair. */
  fired(hand: 'left' | 'right' = 'right'): void {
    this.shotT = 0;
    this.shotHand = hand;
    this.aimHold = AIM_HOLD;
  }

  /**
   * The barrel tip of a gun in hand, in the world (false: no gun in that hand, or it has no `muzzle`
   * node). Ask for the left only while dual wielding.
   */
  muzzleWorld(out: THREE.Vector3, hand: 'left' | 'right' = 'right'): boolean {
    const gun = hand === 'left' ? this.offhand : this.gunInHand ? this.staff : null;
    const tip = gun?.root.getObjectByName('muzzle');
    if (!tip) return false;
    tip.getWorldPosition(out);
    return true;
  }

  /** A gun's barrel direction in the world (false: no gun in that hand). */
  muzzleDir(out: THREE.Vector3, hand: 'left' | 'right' = 'right'): boolean {
    const gun = hand === 'left' ? this.offhand : this.gunInHand ? this.staff : null;
    if (!gun) return false;
    gun.root.getWorldDirection(out);
    return true;
  }

  /**
   * The second gun of a dual-wielded pair (null: none). It mounts in the left hand, and the arms
   * switch to the akimbo layers while it is there.
   */
  async setOffhand(key: ModelKey | null): Promise<void> {
    if (key === this.offhandKey) return;
    const request = ++this.offhandRequest;
    this.offhandKey = key;
    this.offhand?.dispose();
    this.offhand = null;
    const socket = key ? this.model?.root.getObjectByName(OFFHAND_SOCKET) : undefined;
    if (!key || !socket) return;
    const next = await this.assets.instance(key);
    if (request !== this.offhandRequest) {
      next.dispose();
      return;
    }
    this.offhand = next;
    socket.add(next.root);
  }

  /** Struck from `from`: the body flashes and is knocked away from the blow. */
  flinch(from: { x: number; z: number }, heavy: boolean): void {
    this.glow.hit();
    this.reaction.hit(from, this.root.position, this.root.rotation.y, heavy);
  }

  /** The player's own blow landed at `at`: some of it comes back up the staff. */
  strikeRecoil(at: { x: number; z: number }, scale: number): void {
    this.reaction.hit(at, this.root.position, this.root.rotation.y, false, scale);
  }

  /** A blow landed on the raised guard: the arms take it and the feet slide. */
  guardRecoil(from: { x: number; z: number }, broke: boolean): void {
    this.reaction.hit(from, this.root.position, this.root.rotation.y, broke, GUARD_RECOIL);
  }

  /** Poise broke: reel back. */
  reel(): void {
    this.reaction.lurch();
  }

  /**
   * Mount a staff. A staff may have to download first: the one in hand stays until the new one
   * arrives, only the latest request is mounted, and a stand-in never replaces a real staff.
   */
  async setStaff(key: ModelKey, priority: Priority = 'now'): Promise<void> {
    const request = ++this.staffRequest;
    this.staffKey = key;
    const root = this.model?.root;
    // A gun sits on the gun socket (barrel forward in the aim pose), a staff on the staff socket (the
    // Wizard's grip, shaft upright); a body missing one takes the other.
    const gun = key.startsWith('gun_');
    const [first, second] = gun ? [WEAPON_SOCKET, STAFF_SOCKET] : [STAFF_SOCKET, WEAPON_SOCKET];
    const socket = root?.getObjectByName(first) ?? root?.getObjectByName(second);
    if (!socket) {
      this.staff?.dispose();
      this.staff = null;
      this.staffMounted = false;
      console.warn('[player] no weapon socket: weapon not shown');
      return;
    }
    const next = await this.assets.instance(key, priority);
    if (request !== this.staffRequest || (!next.real && this.staff?.real)) {
      next.dispose();
      return;
    }
    this.staff?.dispose();
    this.staff = next;
    socket.add(next.root);
    this.staffMounted = true;
    this.gunInHand = gun;
  }

  /** The body's file arrived after a failed download: swap the stand-in and remount the staff. */
  private async reloadBody(): Promise<void> {
    const next = await this.assets.instance(this.body);
    this.animator?.dispose();
    this.staff?.dispose();
    this.staff = null;
    this.model?.dispose();
    this.model = next;
    this.pivot.add(next.root);
    this.forgetGunBones();
    this.animator = new Animator(next.root, next.clips);
    if (this.staffKey) await this.setStaff(this.staffKey);
    const offhand = this.offhandKey;
    this.offhandKey = null;
    this.offhand = null;
    await this.setOffhand(offhand);
  }

  /** In the saddle the rider tilts with the bull. Call after the bull's view has updated this frame. */
  tiltWithSaddle(tilt: Readonly<{ pitch: number; roll: number }>): void {
    this.root.rotation.x = -tilt.pitch;
    this.root.rotation.z = tilt.roll;
  }

  /** Interpolate between the last two ticks and pose the model from the sim's state. */
  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    if (e.riding?.state === 'riding') this.root.position.y += this.saddleLift;
    this.root.rotation.order = 'YXZ';
    this.root.rotation.x = this.root.rotation.z = 0;
    this.leanInSaddle(e, dt);
    const anim = this.animator;
    if (!anim) return;
    this.frameDt = dt;
    this.attackShown = false;
    if (e.combat?.action?.kind !== 'attack') this.poseMove = null;
    if (e.riding) {
      this.poseRiding(e, anim);
      this.finishFrame(e, anim, dt);
      return;
    }
    // Spells are upper body only (plan §4.4): the arms scrub the cast so the hand's peak lands on
    // the release tick, while the legs keep the locomotion layer (the player may walk slowly).
    // With a gun in hand the guard button aims down the sights: the sim still runs its block, but
    // the body shows the gun layers over free legs, not the staff's guard.
    const sights = this.gunInHand && e.combat?.action?.kind === 'block' && anim.has('aim');
    const a = sights ? undefined : e.combat?.action;
    if (a?.kind === 'cast') {
      // A channel holds the hands at the release pose for as long as it lasts.
      const pose = castPose(SPELLS[a.spell], a.channel ? Math.min(a.t, a.release) : a.t, a.release);
      this.castShown = anim.upper(pose.clip, pose.time, CAST_IN_FADE);
    } else {
      this.castShown = false;
      if (sights) this.aimHold = Math.max(this.aimHold, 0.1);
      if (a || !this.gunLayer(anim, dt)) anim.upperOff(a ? ENTRY_FADE : CAST_OUT_FADE);
    }
    if (sights || !this.pose(e, anim)) {
      const loco = e.loco;
      const speed = loco?.speed ?? 0;
      // Locked on (and not sprinting) the body faces the target: legs follow velocity vs facing.
      const locked = e.combat?.lock != null && !(loco?.sprinting ?? false);
      let strafe: { x: number; z: number } | undefined;
      if (locked) {
        const s = Math.sin(e.tf.yaw), c = Math.cos(e.tf.yaw);
        const { x: vx, z: vz } = e.tf.vel;
        strafe = { x: -c * vx + s * vz, z: s * vx + c * vz };
      }
      this.moveBase(anim, dt, () => anim.locomotion({ grounded: loco?.grounded ?? true, speed, sprinting: loco?.sprinting ?? false, strafe }));
    }
    this.finishFrame(e, anim, dt);
  }

  /**
   * A gun in hand and nothing else going on: the arms carry it (Sproto Shooter's layers, art/README.md).
   * The trigger pull, a reload, the sights (held a moment after a shot, so a burst doesn't bob), or
   * the ready hold. Returns false with a staff in hand, or on a body without the layers.
   */
  private gunLayer(anim: Animator, dt: number): boolean {
    const input = this.input;
    this.aimHold = Math.max(0, this.aimHold - dt);
    if (this.shotT >= 0) this.shotT += dt;
    if (this.shotT >= anim.duration('shoot')) this.shotT = -1;
    if (input.reloadTicks <= 0) this.reloadFrom = 0;
    else this.reloadFrom = Math.max(this.reloadFrom, input.reloadTicks);
    if (input.reloadTicksLeft <= 0) this.reloadFromLeft = 0;
    else this.reloadFromLeft = Math.max(this.reloadFromLeft, input.reloadTicksLeft);
    if (!this.gunInHand) return false;
    const reload = this.reloadFrom > 0 ? 1 - input.reloadTicks / this.reloadFrom : -1;
    // A gun in each hand: one stance carries and fires them, and each hand shoots and reloads on its
    // own (its own trigger, its own magazine), so one can reload while the other stays up.
    if (this.offhand && anim.has('dual')) {
      if (this.shotT >= 0) return anim.upper(this.shotHand === 'left' ? 'dual_shoot_l' : 'dual_shoot_r', this.shotT, CAST_IN_FADE);
      const left = this.reloadFromLeft > 0 ? 1 - input.reloadTicksLeft / this.reloadFromLeft : -1;
      const clip = reload >= 0 && left >= 0 ? 'dual_reload' : reload >= 0 ? 'dual_reload_r' : left >= 0 ? 'dual_reload_l' : null;
      // Both at once: the pair moves together, at the pace of the one further behind.
      if (clip && anim.has(clip)) return anim.upper(clip, (clip === 'dual_reload' ? Math.min(reload, left) : Math.max(reload, left)) * anim.duration(clip), GUN_FADE);
      return anim.upper('dual', 0, GUN_FADE);
    }
    // A sidearm on its own is carried and fired in one hand; anything longer takes both.
    const one = input.oneHanded && anim.has('hold_1h') ? '_1h' : '';
    if (this.shotT >= 0) return anim.upper(`shoot${one}`, this.shotT, CAST_IN_FADE);
    if (reload >= 0) return anim.upper(`reload${one}`, reload * anim.duration(`reload${one}`), GUN_FADE);
    if (input.ads || this.aimHold > 0) return anim.upper(`aim${one}`, 0, GUN_FADE);
    return anim.upper(`hold${one}`, 0, GUN_FADE);
  }

  /** The legs' state out of combat: the shooter's slide and dash while the sim runs them, else `locomotion`. */
  private moveBase(anim: Animator, dt: number, locomotion: () => void): void {
    const input = this.input;
    if (input.sliding) {
      this.slideT += dt;
      if (anim.scrub('slide', this.slideT, SLIDE_FADE)) return;
    } else {
      this.slideT = 0;
    }
    if (input.dashing && anim.loop('dash', 1, DASH_FADE)) return;
    locomotion();
  }

  /**
   * Lean into the bull's speed and ride its bounce. Only the drawn body moves, and it turns about the
   * saddle, so the rider stays seated and the sim's position is untouched.
   */
  private leanInSaddle(e: Readonly<Entity>, dt: number): void {
    const body = this.model?.root;
    if (!body) return;
    const riding = e.riding?.state === 'riding';
    const speed = e.loco?.speed ?? 0;
    const gallop = riding ? THREE.MathUtils.smoothstep(speed, GALLOP_LEAN_SPEEDS[0], GALLOP_LEAN_SPEEDS[1]) : 0;
    const target = riding ? RUN_LEAN * THREE.MathUtils.smoothstep(speed, RUN_LEAN_SPEEDS[0], RUN_LEAN_SPEEDS[1]) + GALLOP_LEAN * gallop : 0;
    this.rideLean = THREE.MathUtils.damp(this.rideLean, target, LEAN_RATE, dt);
    this.saddleMean = THREE.MathUtils.damp(this.saddleMean, riding ? this.saddleLift : 0, SADDLE_MEAN_RATE, dt);
    const bounce = riding ? (this.saddleLift - this.saddleMean) * gallop : 0;
    const angle = this.rideLean + bounce * BOUNCE_ROCK;
    body.rotation.x = angle;
    body.position.set(0, SEAT_HEIGHT * (1 - Math.cos(angle)) + bounce * BOUNCE_GAIN, -SEAT_HEIGHT * Math.sin(angle));
  }

  /** Advance the clips, then the flinch and the status glow on top of them. */
  private finishFrame(e: Readonly<Entity>, anim: Animator, dt: number): void {
    anim.update(dt);
    const body = this.model?.root;
    if (body) {
      squareGun(body, anim.upperClip);
      this.reachGrapple(body, dt);
      // A hand that holds nothing hangs open; the left one closes on a long gun or its own sidearm.
      this.leftOpen = THREE.MathUtils.damp(this.leftOpen, leftHandGrips(anim.upperClip) ? 0 : 1, FINGER_RATE, dt);
      relaxHand(body, 'Left', this.leftOpen);
    }
    this.reaction.update(dt);
    this.lean += (this.driveLean(e) - this.lean) * (1 - Math.exp(-DRIVE_LEAN_SHARPNESS * dt));
    this.reaction.apply(this.pivot, this.lean);
    this.glow.setStatus(glowStatusOf(e));
    this.glow.update(dt);
  }

  /** While the grapple hook is out, the left arm reaches for its anchor (the shooter's grapple arm). */
  private reachGrapple(body: THREE.Object3D, dt: number): void {
    const anchor = this.input.grapple;
    if (anchor) this.grappleAt.set(anchor.x, anchor.y, anchor.z);
    this.grappleWeight = THREE.MathUtils.damp(this.grappleWeight, anchor ? 1 : 0, GRAPPLE_RATE, dt);
    if (this.grappleWeight < 0.01) return;
    if (this.grappleArm === undefined) this.grappleArm = armBones(body, 'Left');
    if (!this.grappleArm) return;
    body.updateWorldMatrix(true, true);
    reachArm(this.grappleArm, this.grappleAt, this.grappleWeight);
  }

  /** How far a sprint attack is leaning into its drive this frame. */
  private driveLean(e: Readonly<Entity>): number {
    const a = e.combat?.action;
    if (a?.kind !== 'attack') return 0;
    const def = PLAYER_MOVES[a.move as PlayerMoveId];
    return def?.drive && a.clipT < clipTiming(def.clip).activeEnd ? DRIVE_LEAN : 0;
  }

  /** A new move on the clip already showing (the Brawler's fourth hit replays the third's) starts it over. */
  private startsOver(move: PlayerMoveId): boolean {
    const shown = this.poseMove;
    this.poseMove = move;
    return shown !== null && shown !== move && PLAYER_MOVES[shown]?.clip === PLAYER_MOVES[move]?.clip;
  }

  /**
   * On the bull the legs stay in the saddle (the Blender `ride` clip) and every action plays on the
   * upper body, scrubbed from the same sim counters as on foot, so melee and magic keep their timing.
   */
  private poseRiding(e: Readonly<Entity>, anim: Animator): void {
    const a = e.combat?.action;
    this.castShown = false;
    if (a?.kind === 'mounting') {
      anim.upperOff(ENTRY_FADE);
      anim.scrub(e.riding!.state === 'dismounting' ? 'dismount' : 'mount', a.t / TICK_HZ, RIDE_FADE);
      return;
    }
    anim.loop('ride', RIDE_RATE_BASE + (e.loco?.speed ?? 0) / RIDE_RATE_SPEED, RIDE_FADE);
    switch (a?.kind) {
      case 'attack': {
        const def = PLAYER_MOVES[a.move as PlayerMoveId];
        this.attackShown = !!def && anim.upper(def.clip, a.clipT / TICK_HZ, ENTRY_FADE, this.startsOver(a.move as PlayerMoveId));
        return;
      }
      case 'cast': {
        // A channel holds the hands at the release pose for as long as it lasts.
        const pose = castPose(SPELLS[a.spell], a.channel ? Math.min(a.t, a.release) : a.t, a.release);
        this.castShown = anim.upper(pose.clip, pose.time, CAST_IN_FADE);
        return;
      }
      case 'block':
        anim.upper('block', Math.min(a.t, BLOCK_HOLD) / TICK_HZ, ENTRY_FADE);
        return;
      case 'hitstun':
        anim.upper('hit', (Math.min(a.t, a.dur) / Math.max(1, a.dur)) * anim.duration('hit'), ENTRY_FADE);
        return;
      case 'stagger': {
        const d = anim.duration('stun');
        anim.upper('stun', d > 0 ? (a.t / TICK_HZ) % d : 0, ENTRY_FADE);
        return;
      }
      default:
        if (a || !this.gunLayer(anim, this.frameDt)) anim.upperOff(a ? ENTRY_FADE : CAST_OUT_FADE);
    }
  }

  /**
   * Combat actions are scrubbed from the sim's tick counters (plan §4.2), never free-run, so the
   * pose always is the frame data and hit-stop freezes it. Returns false in free locomotion.
   */
  private pose(e: Readonly<Entity>, anim: Animator): boolean {
    const a = e.combat?.action;
    if (!a) return false;
    switch (a.kind) {
      case 'attack': {
        const def = PLAYER_MOVES[a.move as PlayerMoveId];
        if (!def) return false;
        this.attackShown = anim.scrub(def.clip, a.clipT / TICK_HZ, ENTRY_FADE, this.startsOver(a.move as PlayerMoveId));
        return true;
      }
      case 'dodge':
        // A backstep is half a stride of the backward run, played fast.
        if (a.back) anim.scrub('run_back', (Math.min(a.t, BACKSTEP.ticks) / BACKSTEP.ticks) * anim.duration('run_back') * 0.5);
        else anim.scrub(ROLL.clip, (Math.min(a.t, ROLL.ticks) / ROLL.ticks) * anim.duration(ROLL.clip));
        return true;
      case 'plunge': {
        // The heavy's wind-up, held over the dive; the landing plays its strike and recovery.
        const tm = PLAYER_MOVE_TIMING.attack_heavy;
        const clipT = a.landT < 0
          ? Math.min(tm.chargeEnd - 1, tm.chargeStart + a.t)
          : tm.activeStart + (Math.min(a.landT, PLUNGE.recovery) / PLUNGE.recovery) * (tm.end - tm.activeStart);
        anim.scrub('attack_heavy', clipT / TICK_HZ, ENTRY_FADE);
        return true;
      }
      case 'block':
        // Raise, then hold on the hold marker while the button stays down.
        anim.scrub('block', Math.min(a.t, BLOCK_HOLD) / TICK_HZ);
        return true;
      case 'hitstun':
        anim.scrub('hit', (Math.min(a.t, a.dur) / Math.max(1, a.dur)) * anim.duration('hit'));
        return true;
      case 'stagger': {
        const d = anim.duration('stun');
        anim.scrub('stun', d > 0 ? (a.t / TICK_HZ) % d : 0);
        return true;
      }
      case 'dead':
        anim.scrub('defeat', a.t / TICK_HZ, DEATH_FADE);
        return true;
      default:
        return false;
    }
  }

  dispose(): void {
    this.stopListening();
    this.staffRequest++;
    this.animator?.dispose();
    this.glow.dispose();
    this.staff?.dispose();
    this.offhandRequest++;
    this.offhand?.dispose();
    this.model?.dispose();
    this.root.removeFromParent();
  }
}
