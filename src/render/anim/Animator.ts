import * as THREE from 'three';

/** Speed (m/s) at which the run clip plays at its authored rate. */
const RUN_CLIP_SPEED = 5.2;
/** Locomotion crossfades (idle, run, jump, strafes). */
export const LOCO_FADE = 0.16;
/** Combat entries crossfade over 4 ticks (plan §4.2: combo heavy and riposte enter mid-clip). */
export const ENTRY_FADE = 4 / 60;

export interface LocomotionPose {
  grounded: boolean;
  /** Planar speed (m/s). */
  speed: number;
  sprinting: boolean;
  /**
   * Locked on and not sprinting: the body keeps facing the target, so the legs follow the
   * velocity relative to facing (strafe_l / strafe_r / run_back / run). Local velocity, m/s:
   * x = right, z = forward.
   */
  strafe?: { x: number; z: number };
}

/**
 * Plays a rigged character's clips from sim state (plan §4.2). One clip is "current" at full
 * weight; switching crossfades from whatever is current. Two kinds of clip:
 *
 * - free-running (locomotion): the mixer advances them, at a rate that follows ground speed;
 * - scrubbed (every combat action): the action is paused and its time is set from the sim's tick
 *   counter every frame, so the pose is the frame data. Hit-stop needs nothing special: the sim's
 *   counter stops, so the pose holds.
 *
 * The debug clip viewer's one-shot clips sit on top of both until they finish.
 */
export class Animator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private oneShot: THREE.AnimationAction | null = null;

  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.mixer.addEventListener('finished', (e) => {
      // The next state call crossfades out of it (it stays `current` until then).
      if (e.action === this.oneShot) this.oneShot = null;
    });
  }

  get clipNames(): string[] {
    return [...this.actions.keys()];
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  /** Clip length in seconds (0 if the clip is missing). */
  duration(name: string): number {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }

  /** The current clip's name (the one at full weight, or fading in). */
  get currentClip(): string | null {
    return this.current?.getClip().name ?? null;
  }

  /** A debug one-shot is playing over the sim-driven state. */
  get overridden(): boolean {
    return this.oneShot !== null;
  }

  /** Play a clip once over everything (the debug clip viewer); hands back to the state when done. */
  playOnce(name: string): boolean {
    const a = this.actions.get(name);
    if (!a) return false;
    this.oneShot = null;
    this.enter(a, LOCO_FADE * 0.5, true);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1;
    this.oneShot = a;
    return true;
  }

  /**
   * Show a clip at an exact time (seconds), paused: the sim's tick counter drives it. Entering a
   * new clip crossfades over `fade`. Returns false if the clip is missing or a one-shot covers it.
   */
  scrub(name: string, time: number, fade = ENTRY_FADE): boolean {
    if (this.oneShot) return false;
    const a = this.actions.get(name);
    if (!a) return false;
    this.enter(a, fade);
    a.paused = true;
    const d = a.getClip().duration;
    a.time = Math.min(Math.max(0, time), Math.max(0, d - 1e-4));
    return true;
  }

  /** Free-run a clip (locomotion). `once` clamps on the last frame (jump). */
  loop(name: string, timeScale = 1, fade = LOCO_FADE, once = false): boolean {
    if (this.oneShot) return false;
    const a = this.actions.get(name);
    if (!a) return false;
    if (this.enter(a, fade)) {
      a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = once;
    }
    a.paused = false;
    a.timeScale = timeScale;
    return true;
  }

  /** Idle / run / jump, or the lock-on strafes, from the sim's locomotion state. */
  locomotion(pose: LocomotionPose): void {
    if (!pose.grounded) {
      this.loop('jump', 1, LOCO_FADE, true);
      return;
    }
    if (pose.speed <= 0.35) {
      this.loop('idle');
      return;
    }
    const scale = Math.min(1.6, Math.max(0.55, pose.speed / RUN_CLIP_SPEED));
    let clip = 'run';
    const s = pose.strafe;
    if (s && !pose.sprinting) {
      if (Math.abs(s.z) >= Math.abs(s.x)) clip = s.z >= 0 ? 'run' : 'run_back';
      else clip = s.x >= 0 ? 'strafe_r' : 'strafe_l';
      if (!this.has(clip)) clip = 'run';
    }
    this.loop(clip, scale);
  }

  /** Advance fades and free-running clips. */
  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** Make `a` current, crossfading out of the old one. Returns true if it changed. */
  private enter(a: THREE.AnimationAction, fade: number, force = false): boolean {
    if (a === this.current && !force) return false;
    const old = this.current;
    a.reset();
    a.setEffectiveWeight(1);
    if (old && old !== a) {
      a.fadeIn(fade);
      old.fadeOut(fade);
    }
    a.play();
    this.current = a;
    return true;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
