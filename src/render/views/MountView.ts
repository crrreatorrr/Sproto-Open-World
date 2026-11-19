import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import type { Entity } from '../../sim/entity';
import { Animator } from '../anim/Animator';
import type { EntityView } from './EnemyViews';
import { placeEntity } from './interp';

/** The saddle sits this far behind the model's origin: moved so the rider's origin is on it (m). */
const SADDLE_BACK = 0.15;
/** Speeds where the gait changes (m/s). */
const WALK_FROM = 0.4;
const RUN_FROM = 5;
const GALLOP_FROM = 12;
/** A gait is held this far past its limit, so a steady speed on the line can't flicker between two (m/s). */
const GAIT_MARGIN = 0.4;
/** Crossfade between gaits (s). */
const GAIT_FADE = 0.22;
/** Saddle heights measured around each gait's loop. */
const SADDLE_SAMPLES = 32;

/** Over this speed the bull's line shows the slope under it (m/s); slower, it keeps the last one. */
const PITCH_FROM = 1;
/** A jump in position this big in one frame is a teleport, not a hill (m). */
const TELEPORT_STEP = 3;
/** The steepest the body pitches, and the most it leans into a turn (radians). */
const MAX_PITCH = 0.6;
const MAX_LEAN = 0.2;
/** Lean per m/s² of cornering (radians), and how quickly the body settles into its tilt (1/s). */
const LEAN_PER_ACCEL = 0.008;
const TILT_RATE = 9;

/** How far the nose rises for a move of `rise` over `run` of ground (radians). */
export function slopePitch(rise: number, run: number): number {
  return THREE.MathUtils.clamp(Math.atan2(rise, run), -MAX_PITCH, MAX_PITCH);
}

/** The body's roll into a turn, in three's sense: a left turn (yaw growing) rolls negative. */
export function turnLean(speed: number, yawRate: number): number {
  return THREE.MathUtils.clamp(-speed * yawRate * LEAN_PER_ACCEL, -MAX_LEAN, MAX_LEAN);
}

export type MountGait = 'idle' | 'walk' | 'run' | 'gallop';

/** Each gait's clip, the ground speed it is authored for (m/s), and how far its rate may stretch. */
const GAITS: Record<Exclude<MountGait, 'idle'>, { clip: string; speed: number; minRate: number; maxRate: number }> = {
  walk: { clip: 'follow_walk', speed: 2.6, minRate: 0.5, maxRate: 2.1 },
  run: { clip: 'follow_run', speed: 9.5, minRate: 0.5, maxRate: 1.35 },
  gallop: { clip: 'gallop', speed: 17, minRate: 0.65, maxRate: 1.25 },
};

/** The gait for a ground speed, given the gait the bull is in now. */
export function mountGait(speed: number, current: MountGait): MountGait {
  const rank = ['idle', 'walk', 'run', 'gallop'].indexOf(current);
  // The margin never reaches zero speed: a bull that has stopped must always stand.
  const limit = (edge: number, gaitAbove: number) => edge + (rank >= gaitAbove ? -1 : 1) * Math.min(GAIT_MARGIN, edge / 2);
  if (speed >= limit(GALLOP_FROM, 3)) return 'gallop';
  if (speed >= limit(RUN_FROM, 2)) return 'run';
  return speed >= limit(WALK_FROM, 1) ? 'walk' : 'idle';
}

/** The clip rate that keeps a planted hoof still on the ground at this speed. */
export function mountClipRate(gait: Exclude<MountGait, 'idle'>, speed: number): number {
  const g = GAITS[gait];
  return THREE.MathUtils.clamp(speed / g.speed, g.minRate, g.maxRate);
}

/** A measured loop's height at a phase, where 1 is back at the start. */
function saddleAt(path: Float32Array, phase: number): number {
  const at = (((phase % 1) + 1) % 1) * path.length;
  const i = Math.floor(at) % path.length;
  return THREE.MathUtils.lerp(path[i]!, path[(i + 1) % path.length]!, at - Math.floor(at));
}

/** The Pepe Bull: the hub's model with its idle and three gaits, driven by the sim's speed. */
export class MountView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1.7;
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  private clips: readonly THREE.AnimationClip[] = [];
  private gait: MountGait = 'idle';
  private disposed = false;
  /** The spine bone under the saddle, and its height above the bull's feet when standing idle. */
  private spine: THREE.Object3D | null = null;
  private spineRest = 0;
  private readonly scratch = new THREE.Vector3();
  /** Each gait clip's saddle height around its loop (m), to tell where the saddle is going next. */
  private readonly saddlePath = new Map<string, Float32Array>();
  /**
   * How far the saddle has risen (m) from its idle height: the back dips as the bull runs. The rider
   * is drawn before the bull, so this is where the saddle will be on the frame the rider reads it.
   */
  saddleLift = 0;
  /** The body's tilt this frame: nose up on a climb, rolled into a turn (radians). The rider shares it. */
  readonly tilt = { pitch: 0, roll: 0 };
  private pitchGoal = 0;
  private readonly last = new THREE.Vector3();
  private lastYaw = 0;
  private placed = false;

  constructor(assets: AssetLoader) {
    void assets.instance('pepe_bull').then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      m.root.position.z = SADDLE_BACK;
      this.root.add(m.root);
      this.model = m;
      this.animator = new Animator(m.root, m.clips);
      this.clips = m.clips;
      m.root.traverse((o) => {
        if (!this.spine && (o as THREE.Bone).isBone && o.name.includes('Spine_0')) this.spine = o;
      });
      this.measureSaddle(this.animator);
      this.animator.loop('idle', 1, 0);
      this.animator.update(0);
      this.spineRest = this.spineHeight();
    });
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    const speed = e.mount?.speed ?? 0;
    this.tiltBody(speed, dt);
    const a = this.animator;
    if (!a) return;
    this.playGait(a, mountGait(speed, this.gait), speed);
    a.update(dt);
    this.saddleLift = this.spine ? this.spineHeight() - this.spineRest + this.saddleStep(a, dt) : 0;
  }

  /** Pitch the body to the slope it is running on and lean it into its turns. */
  private tiltBody(speed: number, dt: number): void {
    const p = this.root.position;
    if (this.placed && dt > 0) {
      const run = Math.hypot(p.x - this.last.x, p.z - this.last.z);
      if (run < TELEPORT_STEP && run / dt > PITCH_FROM) this.pitchGoal = slopePitch(p.y - this.last.y, run);
      const turned = Math.atan2(Math.sin(this.root.rotation.y - this.lastYaw), Math.cos(this.root.rotation.y - this.lastYaw));
      this.tilt.pitch = THREE.MathUtils.damp(this.tilt.pitch, this.pitchGoal, TILT_RATE, dt);
      this.tilt.roll = THREE.MathUtils.damp(this.tilt.roll, turnLean(speed, turned / dt), TILT_RATE, dt);
    }
    this.last.copy(p);
    this.lastYaw = this.root.rotation.y;
    this.placed = true;
    this.root.rotation.order = 'YXZ';
    this.root.rotation.x = -this.tilt.pitch;
    this.root.rotation.z = this.tilt.roll;
  }

  /** Walk each gait's loop once at load, so the saddle's path is known without posing the bull twice. */
  private measureSaddle(a: Animator): void {
    if (!this.spine) return;
    for (const { clip: name } of Object.values(GAITS)) {
      const clip = this.clips.find((c) => c.name === name);
      if (!clip) continue;
      const action = a.mixer.clipAction(clip);
      action.reset().play();
      const path = new Float32Array(SADDLE_SAMPLES);
      for (let i = 0; i < SADDLE_SAMPLES; i++) {
        action.time = (i / SADDLE_SAMPLES) * clip.duration;
        a.mixer.update(0);
        path[i] = this.spineHeight();
      }
      action.stop();
      this.saddlePath.set(name, path);
    }
  }

  /** How far the saddle will move over one more frame like this one (m). */
  private saddleStep(a: Animator, dt: number): number {
    if (this.gait === 'idle') return 0;
    const name = GAITS[this.gait].clip;
    const path = this.saddlePath.get(name);
    const clip = this.clips.find((c) => c.name === name);
    if (!path || !clip) return 0;
    const action = a.mixer.clipAction(clip);
    const phase = action.time / clip.duration;
    const next = phase + (action.timeScale * dt) / clip.duration;
    return (saddleAt(path, next) - saddleAt(path, phase)) * action.getEffectiveWeight();
  }

  /** Every gait starts its loop on the same hoof, so changing gait carries on from the same step. */
  private playGait(a: Animator, gait: MountGait, speed: number): void {
    const from = this.gait;
    this.gait = gait;
    if (gait === 'idle') {
      a.loop('idle', 1, GAIT_FADE);
      return;
    }
    const clip = GAITS[gait].clip;
    const phase = from !== gait && from !== 'idle' ? this.phaseOf(a, GAITS[from].clip) : null;
    a.loop(clip, mountClipRate(gait, speed), GAIT_FADE);
    if (phase === null) return;
    const next = this.clips.find((c) => c.name === clip);
    if (next) a.mixer.clipAction(next).time = phase * next.duration;
  }

  /** How far through its loop a clip is, from 0 to 1. */
  private phaseOf(a: Animator, name: string): number {
    const clip = this.clips.find((c) => c.name === name);
    return clip && clip.duration > 0 ? (a.mixer.clipAction(clip).time / clip.duration) % 1 : 0;
  }

  private spineHeight(): number {
    this.root.updateMatrixWorld(true);
    return this.spine!.getWorldPosition(this.scratch).y - this.root.position.y;
  }

  dispose(): void {
    this.disposed = true;
    this.animator?.dispose();
    this.model?.dispose();
    this.root.removeFromParent();
  }
}
