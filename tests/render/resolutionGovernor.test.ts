import { describe, expect, it } from 'vitest';
import { ResolutionGovernor, RES_MIN_SCALE } from '../../src/render/resolutionGovernor';

/** Feed `seconds` of frames, each `ms` long. Returns the scale at the end. */
function run(g: ResolutionGovernor, ms: number, seconds: number): number {
  let s = g.scale;
  for (let t = 0; t < seconds * 1000; t += ms) s = g.sample(ms);
  return s;
}

describe('the resolution follows the frame rate, to hold the 30 fps floor', () => {
  it('leaves a machine that keeps up alone', () => {
    const g = new ResolutionGovernor();
    expect(run(g, 16.7, 30)).toBe(1);
    expect(run(new ResolutionGovernor(), 8.3, 30)).toBe(1);
  });

  it('steps the resolution down when frames run long, and stops at the floor', () => {
    const g = new ResolutionGovernor();
    const after = run(g, 40, 4);
    expect(after).toBeLessThan(1);
    expect(run(g, 40, 120)).toBe(RES_MIN_SCALE);
  });

  it('does not react to a single freeze or a tab switch', () => {
    const g = new ResolutionGovernor();
    run(g, 16.7, 5);
    g.sample(250);
    g.sample(100);
    expect(run(g, 16.7, 5)).toBe(1);
  });

  it('comes back up when there is headroom again', () => {
    const g = new ResolutionGovernor();
    run(g, 45, 20);
    const low = g.scale;
    expect(low).toBeLessThan(1);
    expect(run(g, 16.7, 120)).toBeGreaterThan(low);
  });

  it('does not bounce: after a step up brings long frames back, it waits longer before trying again', () => {
    const g = new ResolutionGovernor();
    run(g, 45, 10);
    // A machine that only keeps up at the lower resolution: fast when low, slow when one step higher.
    const slowAbove = g.scale;
    let ups = 0, last = g.scale;
    for (let t = 0; t < 180_000; ) {
      const ms = g.scale > slowAbove ? 45 : 16.7;
      const s = g.sample(ms);
      if (s > last) ups++;
      last = s;
      t += ms;
    }
    // Three minutes: a handful of tries, not one every few seconds.
    expect(ups).toBeLessThanOrEqual(5);
    expect(ups).toBeGreaterThan(0);
  });
});
