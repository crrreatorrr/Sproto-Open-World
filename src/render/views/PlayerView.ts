import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import { STAFF_SOCKET, type ModelKey } from '../../assets/manifest';
import { PLAYER_MOVES, ROLL, type PlayerMoveId } from '../../content/combat';
import { PLAYER_MOVE_TIMING } from '../../content/generated/playerMoveTiming';
import { SPELLS } from '../../content/spells';
import { TICK_HZ } from '../../content/tuning';
import type { Entity } from '../../sim/entity';
import { Animator, ENTRY_FADE } from '../anim/Animator';
import { CAST_PEAKS, castClipTime } from '../anim/castTiming';
import { placeEntity } from './interp';

/** The block clip holds on this clip tick while the guard is up (plan §4.3). */
const BLOCK_HOLD = PLAYER_MOVE_TIMING.block.holdFrom;
/** Falling over is slower to blend into than a combat entry. */
const DEATH_FADE = 0.12;
/** The arms blend into a cast fast (a woven bolt releases 5 ticks in) and back out more gently. */
const CAST_IN_FADE = 0.06;
const CAST_OUT_FADE = 0.15;
/** Into and out of the saddle poses. */
const RIDE_FADE = 0.1;
/** The rider's bounce: its rate at a standstill, and how fast it rises with the bull's speed (m/s per 1× rate). */
const RIDE_RATE_BASE = 0.6;
const RIDE_RATE_SPEED = 6;

/** Draws one player entity: the rigged model, its staff on `socket_staff`, and its animation. */
export class PlayerView {
  readonly root = new THREE.Group();
  animator: Animator | null = null;
  private model: ModelInstance | null = null;
  private staff: ModelInstance | null = null;
  /** The staff attached to the socket (false: no socket, or no staff model). */
  staffMounted = false;
  /** The last update showed an attack clip at the sim's clip tick (QA: command → pose). */
  attackShown = false;
  /** The last update showed a cast on the upper body (QA). */
  castShown = false;
  /** On the bull: how far its saddle has moved from its idle height this frame (m). */
  saddleLift = 0;

  constructor(private readonly assets: AssetLoader) {}

  async load(staffKey: ModelKey = 'staff_sproto'): Promise<void> {
    this.model = await this.assets.instance('player');
    this.root.add(this.model.root);
    this.animator = new Animator(this.model.root, this.model.clips);
    await this.setStaff(staffKey);
  }

  async setStaff(key: ModelKey): Promise<void> {
    this.staff?.dispose();
    this.staff = null;
    this.staffMounted = false;
    const socket = this.model?.root.getObjectByName(STAFF_SOCKET);
    if (!socket) {
      console.warn('[player] no socket_staff node: staff not shown');
      return;
    }
    this.staff = await this.assets.instance(key);
    socket.add(this.staff.root);
    this.staffMounted = true;
  }

  /** Interpolate between the last two ticks and pose the model from the sim's state. */
  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    if (e.riding?.state === 'riding') this.root.position.y += this.saddleLift;
    const anim = this.animator;
    if (!anim) return;
    this.attackShown = false;
    if (e.riding) {
      this.poseRiding(e, anim);
      anim.update(dt);
      return;
    }
    // Spells are upper body only (plan §4.4): the arms scrub the cast so the hand's peak lands on
    // the release tick, while the legs keep the locomotion layer (the player may walk slowly).
    const a = e.combat?.action;
    if (a?.kind === 'cast') {
      const def = SPELLS[a.spell];
      this.castShown = anim.upper(def.clip, castClipTime(CAST_PEAKS.player, def.clip, a.t, a.release, def.recovery), CAST_IN_FADE);
    } else {
      this.castShown = false;
      anim.upperOff(a ? ENTRY_FADE : CAST_OUT_FADE);
    }
    if (!this.pose(e, anim)) {
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
      anim.locomotion({ grounded: loco?.grounded ?? true, speed, sprinting: loco?.sprinting ?? false, strafe });
    }
    anim.update(dt);
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
        this.attackShown = !!def && anim.upper(def.clip, a.clipT / TICK_HZ, ENTRY_FADE);
        return;
      }
      case 'cast': {
        const def = SPELLS[a.spell];
        this.castShown = anim.upper(def.clip, castClipTime(CAST_PEAKS.player, def.clip, a.t, a.release, def.recovery), CAST_IN_FADE);
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
        anim.upperOff(a ? ENTRY_FADE : CAST_OUT_FADE);
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
        this.attackShown = anim.scrub(def.clip, a.clipT / TICK_HZ, ENTRY_FADE);
        return true;
      }
      case 'dodge':
        anim.scrub(ROLL.clip, (Math.min(a.t, ROLL.ticks) / ROLL.ticks) * anim.duration(ROLL.clip));
        return true;
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
    this.animator?.dispose();
    this.staff?.dispose();
    this.model?.dispose();
    this.root.removeFromParent();
  }
}
