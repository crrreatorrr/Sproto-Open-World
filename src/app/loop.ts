import { DT } from '../content/tuning';

/** Longest frame we try to catch up on (a tab switch or a debugger pause). */
export const MAX_FRAME = 0.25;
/** At most this many ticks per rendered frame; past that the game slows down instead of spiralling. */
export const MAX_TICKS_PER_FRAME = 5;

/**
 * Fixed-timestep accumulator (plan §2.3, the shooter's loop). `advance(realDt)` returns how many
 * 60 Hz ticks to run this frame; `alpha` is how far the render sits between the last two ticks.
 */
export class FixedLoop {
  private acc = 0;
  alpha = 0;
  /** Multiplies real time (debug slow motion). */
  timeScale = 1;

  advance(realDt: number): number {
    const dt = Math.min(Math.max(0, realDt), MAX_FRAME) * this.timeScale;
    this.acc += dt;
    let ticks = Math.floor(this.acc / DT + 1e-9);
    if (ticks > MAX_TICKS_PER_FRAME) {
      ticks = MAX_TICKS_PER_FRAME;
      this.acc = 0;
    } else {
      this.acc -= ticks * DT;
    }
    this.alpha = Math.min(1, Math.max(0, this.acc / DT));
    return ticks;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 0;
  }
}
