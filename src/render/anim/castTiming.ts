import { TICK_HZ } from '../../content/tuning';

export type CastClip = 'cast' | 'cast_big';

/**
 * Seconds into `cast` / `cast_big` where the hand is furthest forward: the release. The library's
 * defaults (duel's wizard rig: the player and the Wisp) and duel's measured peaks for the rigs
 * whose throws are their own clips (The Midget → Grunt, Bitcoin Obama → Slinger).
 */
export type CastPeaks = Readonly<Record<CastClip, number>>;
export const LIBRARY_CAST_PEAKS: CastPeaks = { cast: 0.45, cast_big: 0.62 };
export const CAST_PEAKS: Readonly<Record<string, CastPeaks>> = {
  player: LIBRARY_CAST_PEAKS,
  wisp: LIBRARY_CAST_PEAKS,
  grunt: { cast: 0.733, cast_big: 0.9 },
  slinger: { cast: 0.667, cast_big: 0.933 },
  // M4: the veterans' stage-2 rigs carry the same cast clips as stage 1 (same lengths and keys).
  grunt_vet: { cast: 0.733, cast_big: 0.9 },
  slinger_vet: { cast: 0.667, cast_big: 0.933 },
  big_coin: { cast: 0.667, cast_big: 0.933 },
  // The third stages (duel's measured peaks for Bitcoin Obama and The Midget).
  obama_stage3: { cast: 0.667, cast_big: 0.9 },
  midget_stage3: { cast: 0.733, cast_big: 0.867 },
};

/** A wind-up may compress the clip's anticipation up to this much to fit it before the release (duel). */
const MAX_WINDUP_RATE = 2;
/** The follow-through after the release (s of clip) plays within the recovery, up to this much faster. */
const FOLLOW: Record<CastClip, number> = { cast: 0.36, cast_big: 0.6 };
const MAX_FOLLOW_RATE = 3;

/**
 * Clip time (s) of a cast scrubbed from the sim's tick counter (plan §4.4): the hand reaches its
 * peak exactly on the release tick, whatever the release (a woven cast halves it), and the
 * follow-through plays out over the recovery. Hit-stop needs nothing: `t` stops.
 */
export function castClipTime(peaks: CastPeaks, clip: CastClip, t: number, release: number, recovery: number): number {
  const peak = peaks[clip];
  const windup = Math.max(1, release) / TICK_HZ;
  if (t < release) {
    const rate = Math.min(MAX_WINDUP_RATE, Math.max(1, peak / windup));
    return Math.max(0, peak - (windup - t / TICK_HZ) * rate);
  }
  const rate = Math.min(MAX_FOLLOW_RATE, Math.max(1, FOLLOW[clip] / (Math.max(1, recovery) / TICK_HZ)));
  return peak + ((t - release) / TICK_HZ) * rate;
}

export const isCastClip = (clip: string | undefined): clip is CastClip => clip === 'cast' || clip === 'cast_big';
