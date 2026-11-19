import * as THREE from 'three';
import { clipHalves } from '../../assets/rig';

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
  /** The slowest the legs may play (default 0.55): a giant's long stride covers its ground slowly. */
  minRate?: number;
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
 *
 * An upper-body layer (spells, plan §4.4) can be laid over the base state: while it is on, the
 * base state plays only the legs half of its clip and the overlay plays only the arms half of its
 * own (assets/rig.ts clipHalves), so the legs keep walking while the arms cast. Switching in and
 * out fades both layers over the same time, so every bone's weights always sum to 1 and nothing
 * blends toward the bind pose.
 */
export class Animator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  /** The base state's clip name (`current` may be its legs half). */
  private currentName: string | null = null;
  private oneShot: THREE.AnimationAction | null = null;
  /** Upper-body overlay action, and whether the base state is split to its legs half. */
  private upperAction: THREE.AnimationAction | null = null;
  private upperName: string | null = null;
  private split = false;
  private readonly halves = new Map<string, THREE.AnimationAction>();
  /** The resting copy of a clip that has been started over while it was showing. */
  private readonly twins = new Map<string, THREE.AnimationAction>();

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
    return this.currentName;
  }

  /** The upper-body overlay's clip, or null when the whole body plays the base state. */
  get upperClip(): string | null {
    return this.upperName;
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
    this.upperOff(LOCO_FADE * 0.5);
    this.enter(a, LOCO_FADE * 0.5, true);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1;
    this.oneShot = a;
    return true;
  }

  /**
   * Show a clip at an exact time (seconds), paused: the sim's tick counter drives it. Entering a
   * new clip crossfades over `fade`; so does `restart`, which starts over the clip already showing.
   * Returns false if the clip is missing or a one-shot covers it.
   */
  scrub(name: string, time: number, fade = ENTRY_FADE, restart = false): boolean {
    if (this.oneShot) return false;
    if (restart) this.swapTwin(name);
    const a = this.resolve(name);
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
    const a = this.resolve(name);
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
    const scale = Math.min(1.6, Math.max(pose.minRate ?? 0.55, pose.speed / RUN_CLIP_SPEED));
    let clip = 'run';
    const s = pose.strafe;
    if (s && !pose.sprinting) {
      if (Math.abs(s.z) >= Math.abs(s.x)) clip = s.z >= 0 ? 'run' : 'run_back';
      else clip = s.x >= 0 ? 'strafe_r' : 'strafe_l';
      if (!this.has(clip)) clip = 'run';
    }
    this.loop(clip, scale);
  }

  /**
   * Show `name`'s upper half at `time` (seconds, paused: the sim drives it) over the base state,
   * which drops to its legs half. Returns false if the clip is missing or a one-shot covers it.
   */
  upper(name: string, time: number, fade = ENTRY_FADE, restart = false): boolean {
    if (this.oneShot) return false;
    if (restart) this.swapTwin(name);
    const full = this.actions.get(name);
    if (!full) return false;
    const a = this.half(full, 'upper');
    if (a !== this.upperAction) {
      a.reset();
      a.setEffectiveWeight(1);
      // Cast straight into another cast: the arms crossfade between the two overlays.
      this.upperAction?.fadeOut(fade);
      a.fadeIn(fade);
      a.play();
      this.upperAction = a;
      this.upperName = name;
      if (!this.split) {
        this.split = true;
        this.rebase(fade);
      }
    }
    a.paused = true;
    a.time = Math.min(Math.max(0, time), Math.max(0, full.getClip().duration - 1e-4));
    return true;
  }

  /** Hand the arms back to the base state (no-op when no overlay is on). */
  upperOff(fade = LOCO_FADE): void {
    if (!this.upperAction) return;
    this.upperAction.fadeOut(fade);
    this.upperAction = null;
    this.upperName = null;
    this.split = false;
    this.rebase(fade);
  }

  /** Advance fades and free-running clips. */
  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** One action can't fade into itself: a second copy of the clip takes over from the first. */
  private swapTwin(name: string): void {
    const a = this.actions.get(name);
    if (!a) return;
    const twin = this.twins.get(name) ?? this.mixer.clipAction(a.getClip().clone());
    this.twins.set(name, a);
    this.actions.set(name, twin);
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
    this.currentName = a.getClip().name.replace(/\|lower$/, '');
    return true;
  }

  /** The base-state action for a clip: the full clip, or its legs half while the overlay is on. */
  private resolve(name: string): THREE.AnimationAction | undefined {
    const a = this.actions.get(name);
    return a && this.split ? this.half(a, 'lower') : a;
  }

  private half(full: THREE.AnimationAction, part: 'upper' | 'lower'): THREE.AnimationAction {
    const key = `${full.getClip().uuid}|${part}`;
    let a = this.halves.get(key);
    if (!a) {
      a = this.mixer.clipAction(clipHalves(full.getClip())[part]);
      this.halves.set(key, a);
    }
    return a;
  }

  /**
   * The overlay came on or went off: swap the base state between its full clip and its legs half,
   * keeping its time, rate and loop mode so the legs don't skip a step.
   */
  private rebase(fade: number): void {
    const old = this.current;
    const name = this.currentName;
    if (!old || !name) return;
    const next = this.resolve(name);
    if (!next || next === old) return;
    next.reset();
    next.setEffectiveWeight(1);
    next.setLoop(old.loop, old.repetitions);
    next.clampWhenFinished = old.clampWhenFinished;
    next.time = old.time;
    next.timeScale = old.timeScale;
    next.paused = old.paused;
    next.fadeIn(fade);
    old.fadeOut(fade);
    next.play();
    this.current = next;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
