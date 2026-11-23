/**
 * Easing for the camera. Everything the rig moves on its own goes through one of these, so a move
 * starts gently, stops gently and never changes speed in one frame (feedback WORLD-0005).
 */

/**
 * A value on a critically damped spring. It gathers speed toward its goal and slows into it, and
 * does not overshoot a goal that stands still. The step is exact for any frame length.
 */
export class Eased {
  /** Its speed (units a second). */
  v = 0;

  constructor(public x: number) {}

  /** Move toward `goal`. `response` is in 1/s: the value is 95% of the way after about 4.7 / response seconds. */
  to(goal: number, response: number, dt: number): number {
    const d = this.x - goal;
    const k = (this.v + response * d) * dt;
    const e = Math.exp(-response * dt);
    this.v = (this.v - response * k) * e;
    this.x = goal + (d + k) * e;
    return this.x;
  }

  /** The same for an angle (radians), turning the short way round. */
  toAngle(goal: number, response: number, dt: number): number {
    let d = (this.x - goal) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return this.to(this.x - d, response, dt);
  }

  /** Put it at `x`, at rest. */
  set(x: number): void {
    this.x = x;
    this.v = 0;
  }
}

/** 0 at or below 0, 1 at or above 1, and level at both ends. */
export function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Trail `goal` lazily, as a first-order follow at `sharpness` (1/s) would while it is close, but
 * never more than `maxLag` behind: the further behind, the harder the spring pulls (six times as
 * hard at the limit), so the limit is approached smoothly instead of hit. Being a spring, it keeps
 * its speed when the goal steps (a kerb) or stops dead (a landing).
 */
export function trail(e: Eased, goal: number, sharpness: number, maxLag: number, dt: number): number {
  const a = Math.min(1, Math.abs(goal - e.x) / maxLag);
  e.to(goal, 2 * sharpness * (1 + 5 * a * a), dt);
  if (Math.abs(goal - e.x) > maxLag) e.x = goal - Math.sign(goal - e.x) * maxLag;
  return e.x;
}
