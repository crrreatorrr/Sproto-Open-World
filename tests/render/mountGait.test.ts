import { describe, expect, it } from 'vitest';
import { mountClipRate, mountGait } from '../../src/render/views/MountView';

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
