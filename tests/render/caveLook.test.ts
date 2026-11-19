import { describe, expect, it } from 'vitest';
import { lookFor, sunCastsShadow } from '../../src/render/caveLook';

describe('cave look', () => {
  it('turns the sun off and lights the torch in the cave', () => {
    expect(lookFor(true)).toMatchObject({ sunIntensity: 0, sunShadow: false, torchIntensity: 30, hemiIntensity: 0.45, fogNear: 6, fogFar: 46, farPlane: 140 });
  });

  it('restores daylight on the surface, with the torch dark', () => {
    expect(lookFor(false)).toMatchObject({ sunIntensity: 2.8, sunShadow: true, torchIntensity: 0, hemiIntensity: 1.3 });
  });

  it('keeps sun shadows off on Low graphics, on the surface and in the cave', () => {
    expect(sunCastsShadow(false, false)).toBe(false);
    expect(sunCastsShadow(false, true)).toBe(false);
  });

  it('casts sun shadows on the surface only when the graphics quality wants them', () => {
    expect(sunCastsShadow(true, false)).toBe(true);
    expect(sunCastsShadow(true, true)).toBe(false);
  });
});
