/** The lowest the render resolution goes, as a share of what the graphics quality asks for. */
export const RES_MIN_SCALE = 0.6;
const STEP_DOWN = 0.85;
const STEP_UP = 1 / 0.9;
/**
 * Frames longer than this on average mean the machine is under the 30 fps floor (ms). A steady
 * 33 ms is the floor itself, and often not the machine at all: a 30 Hz display, or a browser saving
 * power, draws that slowly whatever the resolution, and lowering it would cost sharpness for nothing.
 */
const SLOW_MS = 36;
/** Frames shorter than this on average mean there is room to spare (ms). */
const FAST_MS = 19;
/** A frame this long is a freeze or a tab switch, not the machine's steady pace: it isn't counted (ms). */
const OUTLIER_MS = 80;
const DOWN_AFTER_MS = 1500;
const UP_AFTER_MS = 5000;
const UP_AFTER_MAX_MS = 80_000;
/** A step up that is followed by a step down this soon was a mistake (ms). */
const REGRET_MS = 8000;

/**
 * Keeps the game above its frame-rate floor on a machine that can't draw the full resolution: when
 * frames run long for a while it lowers the render resolution a step, and raises it again when there
 * is headroom. It changes nothing on a machine that keeps up. Pure: it is told each frame's length
 * and answers with the scale to draw at.
 *
 * A display's refresh rate hides how much headroom there is (a frame can't be shorter than the
 * refresh), so a step up is a guess. When the guess is wrong, long frames return and the scale steps
 * back down; the governor then waits twice as long before guessing again, so it settles.
 */
export class ResolutionGovernor {
  scale = 1;
  private avg = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private upAfter = UP_AFTER_MS;
  private sinceUp = Infinity;

  /** One rendered frame took `ms`. Returns the scale to draw the next one at (RES_MIN_SCALE to 1). */
  sample(ms: number): number {
    if (!(ms > 0) || ms > OUTLIER_MS) return this.scale;
    this.avg += (ms - this.avg) * 0.1;
    this.sinceUp += ms;
    if (this.avg > SLOW_MS) {
      this.slowFor += ms;
      this.fastFor = 0;
    } else if (this.avg < FAST_MS) {
      this.fastFor += ms;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (this.slowFor >= DOWN_AFTER_MS && this.scale > RES_MIN_SCALE) {
      this.scale = Math.max(RES_MIN_SCALE, this.scale * STEP_DOWN);
      if (this.sinceUp < REGRET_MS) this.upAfter = Math.min(UP_AFTER_MAX_MS, this.upAfter * 2);
      this.slowFor = 0;
    } else if (this.fastFor >= this.upAfter && this.scale < 1) {
      this.scale = Math.min(1, this.scale * STEP_UP);
      this.sinceUp = 0;
      this.fastFor = 0;
    }
    return this.scale;
  }

  /** Start over (a new graphics quality). */
  reset(): void {
    this.scale = 1;
    this.avg = 16.7;
    this.slowFor = this.fastFor = 0;
    this.upAfter = UP_AFTER_MS;
    this.sinceUp = Infinity;
  }
}
