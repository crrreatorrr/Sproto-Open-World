import { describe, expect, it } from 'vitest';
import { mountClipRate, mountGait, slopePitch, turnLean } from '../../src/render/views/MountView';

describe('the bull picks its gait from its speed', () => {
  it('stands, walks, runs and gallops as it speeds up', () => {
    expect(mountGait(0, 'idle')).toBe('idle');
    expect(mountGait(2.6, 'idle')).toBe('walk');
    expect(mountGait(9.5, 'walk')).toBe('run');
    expect(mountGait(17, 'run')).toBe('gallop');
  });

  it('holds a gait across the line, so a steady speed cannot flicker', () => {
    expect(mountGait(12, 'run')).toBe('run');
    expect(mountGait(12, 'gallop')).toBe('gallop');
    expect(mountGait(5, 'walk')).toBe('walk');
    expect(mountGait(5, 'run')).toBe('run');
  });

  it('drops straight to the right gait when it slows hard', () => {
    expect(mountGait(0, 'gallop')).toBe('idle');
    expect(mountGait(3, 'gallop')).toBe('walk');
  });

  it('plays each clip at the rate that keeps planted hooves still', () => {
    expect(mountClipRate('walk', 2.6)).toBeCloseTo(1);
    expect(mountClipRate('run', 9.5)).toBeCloseTo(1);
    expect(mountClipRate('gallop', 17)).toBeCloseTo(1);
    expect(mountClipRate('gallop', 12)).toBeCloseTo(12 / 17);
  });
});

describe('the bull\'s body follows the ground and the turn', () => {
  it('raises its nose on a climb and lowers it going down, within limits', () => {
    expect(slopePitch(0, 5)).toBe(0);
    expect(slopePitch(1, 1)).toBeCloseTo(0.6);
    expect(slopePitch(0.2, 1)).toBeCloseTo(Math.atan(0.2));
    expect(slopePitch(-0.2, 1)).toBeCloseTo(-Math.atan(0.2));
    expect(slopePitch(10, 1)).toBeLessThanOrEqual(0.6);
  });

  it('leans into a turn, harder the faster it goes, and stands level on a straight', () => {
    expect(turnLean(17, 0)).toBeCloseTo(0);
    expect(turnLean(10, 1)).toBeLessThan(0);
    expect(turnLean(10, -1)).toBeGreaterThan(0);
    expect(Math.abs(turnLean(10, 1))).toBeGreaterThan(Math.abs(turnLean(5, 1)));
    expect(Math.abs(turnLean(17, 8))).toBeLessThanOrEqual(0.2);
  });
});
