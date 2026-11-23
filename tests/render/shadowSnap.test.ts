import { describe, expect, it } from 'vitest';
import { snapToShadowTexels } from '../../src/render/shadowSnap';

const OFFSET = { x: 18, y: 30, z: 12 };
const TEXEL = 70 / 2048;

/** A point's coordinates on the shadow map's grid, in texels. */
function texels(p: { x: number; y: number; z: number }): [number, number] {
  const l = Math.hypot(OFFSET.x, OFFSET.y, OFFSET.z);
  const d = { x: OFFSET.x / l, y: OFFSET.y / l, z: OFFSET.z / l };
  // right = up × d, up' = d × right (the light looks along −d with +y up).
  let rx = d.z, rz = -d.x;
  const rl = Math.hypot(rx, rz);
  rx /= rl;
  rz /= rl;
  const ux = d.y * rz, uy = d.z * rx - d.x * rz, uz = -d.y * rx;
  return [(p.x * rx + p.z * rz) / TEXEL, (p.x * ux + p.y * uy + p.z * uz) / TEXEL];
}

describe('the shadow box moves in whole texels', () => {
  it('lands on the texel grid wherever the player stands', () => {
    for (const p of [{ x: 256.123, y: 13.5, z: 58.777 }, { x: -3.01, y: 0, z: 1200.5 }, { x: 900, y: 42.42, z: 250.0001 }]) {
      const [u, v] = texels(snapToShadowTexels(p, OFFSET, TEXEL));
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-6);
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
    }
  });

  it('stays within a texel of the player', () => {
    const p = { x: 256.123, y: 13.5, z: 58.777 };
    const s = snapToShadowTexels(p, OFFSET, TEXEL);
    expect(Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z)).toBeLessThan(TEXEL);
  });

  it('does not move while the player moves less than a texel', () => {
    const a = snapToShadowTexels({ x: 100, y: 5, z: 100 }, OFFSET, TEXEL);
    const [u0, v0] = texels(a);
    let moved = 0;
    for (let i = 1; i <= 200; i++) {
      const [u, v] = texels(snapToShadowTexels({ x: 100 + i * 0.0005, y: 5, z: 100 }, OFFSET, TEXEL));
      // Every step is a whole number of texels from the start.
      expect(Math.abs(u - u0 - Math.round(u - u0))).toBeLessThan(1e-6);
      expect(Math.abs(v - v0 - Math.round(v - v0))).toBeLessThan(1e-6);
      if (Math.round(u - u0) !== 0 || Math.round(v - v0) !== 0) moved++;
    }
    // 10 cm of walking crosses about 3 texels, not 200.
    expect(moved).toBeGreaterThan(0);
  });
});
