import * as THREE from 'three';

/** Speed (m/s) at which the run clip plays at its authored rate. */
const RUN_CLIP_SPEED = 5.2;
const FADE = 0.16;

export interface LocomotionPose {
  grounded: boolean;
  /** Planar speed (m/s). */
  speed: number;
  sprinting: boolean;
}

/**
 * Plays a rigged character's clips (plan §4.2 grows this into the frame-data scrubber in M1a).
 * M0: idle / run / jump from the sim's locomotion state, with crossfades, plus one-shot clips
 * (the debug clip viewer) that return to locomotion when they finish.
 */
export class Animator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private base: THREE.AnimationAction | null = null;
  private oneShot: THREE.AnimationAction | null = null;

  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.oneShot) {
        this.oneShot.fadeOut(FADE);
        this.oneShot = null;
        this.base?.reset().fadeIn(FADE).play();
      }
    });
  }

  get clipNames(): string[] {
    return [...this.actions.keys()];
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  /** Play a clip once over the locomotion layer; it hands back to locomotion when done. */
  playOnce(name: string): boolean {
    const a = this.actions.get(name);
    if (!a) return false;
    this.oneShot?.fadeOut(FADE * 0.5);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1;
    a.fadeIn(FADE * 0.5).play();
    this.base?.fadeOut(FADE * 0.5);
    this.oneShot = a;
    return true;
  }

  update(dt: number, pose: LocomotionPose): void {
    if (!this.oneShot) {
      let want = 'idle';
      let scale = 1;
      if (!pose.grounded) want = 'jump';
      else if (pose.speed > 0.35) {
        want = 'run';
        scale = Math.min(1.6, Math.max(0.55, pose.speed / RUN_CLIP_SPEED));
      }
      const next = this.actions.get(want) ?? this.actions.get('idle') ?? null;
      if (next && next !== this.base) {
        if (want === 'jump') {
          next.setLoop(THREE.LoopOnce, 1);
          next.clampWhenFinished = true;
        }
        next.reset().fadeIn(FADE).play();
        this.base?.fadeOut(FADE);
        this.base = next;
      }
      if (this.base && want === 'run') this.base.timeScale = scale;
    }
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
