import { describe, expect, it } from 'vitest';
import { FixedLoop, MAX_TICKS_PER_FRAME } from '../src/app/loop';

describe('fixed-step loop', () => {
  it('runs one tick per 60 Hz frame and keeps the remainder as alpha', () => {
    const l = new FixedLoop();
    expect(l.advance(1 / 60)).toBe(1);
    expect(l.advance(1 / 120)).toBe(0);
    expect(l.alpha).toBeCloseTo(0.5, 5);
    expect(l.advance(1 / 120)).toBe(1);
  });

  it('runs 2 ticks per frame at 30 fps and 1 every other frame at 120 fps', () => {
    const l = new FixedLoop();
    expect(l.advance(1 / 30)).toBe(2);
    let total = 0;
    for (let i = 0; i < 120; i++) total += l.advance(1 / 120);
    expect(total).toBe(60);
  });

  it('caps catch-up after a long stall instead of spiralling', () => {
    const l = new FixedLoop();
    expect(l.advance(3)).toBe(MAX_TICKS_PER_FRAME);
    expect(l.advance(1 / 60)).toBe(1);
  });
});
