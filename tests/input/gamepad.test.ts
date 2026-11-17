import { describe, expect, it } from 'vitest';
import { applyLatch, latchHeld, padGlyph, padStyleFromId, shapeStick } from '../../src/input/Gamepad';

describe('gamepad helpers (ported from sproto-duel)', () => {
  it('radial deadzone: drift is zero, full tilt is 1, direction is kept', () => {
    const out = { x: 0, y: 0 };
    expect(shapeStick(0.1, 0.1, 0.2, 1, out)).toBe(0);
    expect(out).toEqual({ x: 0, y: 0 });
    expect(shapeStick(0.94, 0, 0.2, 1, out)).toBeCloseTo(1, 5);
    shapeStick(0, -0.6, 0.2, 1, out);
    expect(out.x).toBe(0);
    expect(out.y).toBeLessThan(0);
  });

  it('a button held when the pad appears is ignored until released', () => {
    const latched = new Uint8Array(4);
    latchHeld([1, 0, 0, 0], latched);
    const down = new Uint8Array([1, 0, 0, 0]);
    applyLatch(down, latched);
    expect(down[0]).toBe(0);
    const released = new Uint8Array([0, 0, 0, 0]);
    applyLatch(released, latched);
    const pressedAgain = new Uint8Array([1, 0, 0, 0]);
    applyLatch(pressedAgain, latched);
    expect(pressedAgain[0]).toBe(1);
  });

  it('glyphs follow the pad family', () => {
    expect(padStyleFromId('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)')).toBe('xbox');
    expect(padStyleFromId('DualSense Wireless Controller (Vendor: 054c)')).toBe('playstation');
    expect(padGlyph('a', 'playstation')).toBe('✕');
    expect(padGlyph('rt', 'xbox')).toBe('RT');
  });
});
