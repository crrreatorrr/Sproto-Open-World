import type * as THREE from 'three';
import { spring } from '../views/interp';

type Flat = { x: number; z: number };

/** Springs of the body's tilt (stiff, quick to settle) and its shove along the ground. */
const TILT = { k: 170, damping: 15 };
const SHOVE = { k: 120, damping: 16 };
/** Impulses of a light hit; a heavy one is this many times stronger. */
const PITCH = 1.7;
const ROLL = 1.3;
const TWIST = 1.1;
const PUSH = 0.9;
const HEAVY = 1.8;
/** A broken poise throws the body back on top of the hit that broke it. */
const LURCH = 3.2;

/**
 * The procedural part of a flinch: the body tips, turns and slides away from the blow, whichever way
 * it came from, and springs back. It sits on a pivot over the animated model, so it adds to any clip
 * and needs none of its own. `strength` makes big bodies harder to move.
 */
export class HitReaction {
  private readonly pitch = { x: 0, v: 0 };
  private readonly roll = { x: 0, v: 0 };
  private readonly twist = { x: 0, v: 0 };
  private readonly forward = { x: 0, v: 0 };
  private readonly right = { x: 0, v: 0 };

  constructor(private readonly strength = 1) {}

  /** A blow from `from` on a body at `at` facing `yaw`. */
  hit(from: Flat, at: Flat, yaw: number, heavy: boolean, scale = 1): void {
    let dx = at.x - from.x, dz = at.z - from.z;
    const d = Math.hypot(dx, dz);
    const s = Math.sin(yaw), c = Math.cos(yaw);
    // No direction to speak of (a blast on top of it): straight back.
    if (d < 1e-3) [dx, dz] = [-s, -c];
    else [dx, dz] = [dx / d, dz / d];
    // The push in the body's own frame: + is toward its front, and toward its right.
    const f = dx * s + dz * c;
    const r = -dx * c + dz * s;
    const k = this.strength * scale * (heavy ? HEAVY : 1);
    this.pitch.v += f * PITCH * k;
    this.roll.v += r * ROLL * k;
    this.twist.v += r * TWIST * k;
    this.forward.v += f * PUSH * k;
    this.right.v += r * PUSH * k;
  }

  /** Poise broke: reel backward. */
  lurch(): void {
    this.pitch.v -= LURCH * this.strength;
    this.forward.v -= PUSH * this.strength;
  }

  update(dt: number): void {
    for (const s of [this.pitch, this.roll, this.twist]) spring(s, TILT.k, TILT.damping, dt);
    for (const s of [this.forward, this.right]) spring(s, SHOVE.k, SHOVE.damping, dt);
  }

  /** Pose the pivot; `lean` is the view's own forward lean. Its height stays the view's. */
  apply(pivot: THREE.Object3D, lean = 0): void {
    pivot.rotation.set(lean + this.pitch.x, this.twist.x, this.roll.x);
    // A body faces +Z, so its right hand is toward -X.
    pivot.position.x = -this.right.x;
    pivot.position.z = this.forward.x;
  }
}
