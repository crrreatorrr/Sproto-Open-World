import { describe, expect, it } from 'vitest';
import { drakeCrackCount } from '../../src/render/views/DrakeViews';
import { trailFades } from '../../src/render/fx/questClues';

/** Ranger Moss to the first giant track, and the last two burning haystacks. */
const RANGER = { x: 246, z: 318 };
const TRACK_1 = { x: 190, z: 345 };
const HAY_4 = { x: 166, z: 152 };
const HAY_5 = { x: 88, z: 176 };

describe('quest clue trails', () => {
  it('shows the prints beside you when the far end is still out of reach', () => {
    const reach = 28;
    const whole = Math.hypot(TRACK_1.x - RANGER.x, TRACK_1.z - RANGER.z);
    expect(whole).toBeGreaterThan(reach);
    const fades = trailFades(RANGER, TRACK_1, RANGER, 8, reach);
    expect(fades[0]).toBeGreaterThan(0.5);
    expect(fades.some((f) => f <= 0.02)).toBe(true);
    // The same trail, read from the far end, is the path you have already walked.
    const there = trailFades(RANGER, TRACK_1, TRACK_1, 8, reach);
    expect(there.at(-1)!).toBeGreaterThan(0.5);
  });

  it('leads on from a doused haystack when the next one is further than the fade', () => {
    const reach = 40;
    expect(Math.hypot(HAY_5.x - HAY_4.x, HAY_5.z - HAY_4.z)).toBeGreaterThan(reach);
    const fades = trailFades(HAY_4, HAY_5, HAY_4, 6, reach);
    expect(fades[0]).toBeGreaterThan(0.5);
    expect(fades.at(-1)).toBe(0);
  });
});

describe('drake scale cracks', () => {
  it('shows one seam per reflected fireball, and all three through the break', () => {
    expect(drakeCrackCount(900, 900, false)).toBe(0);
    expect(drakeCrackCount(900 * 0.66, 900, false)).toBe(1);
    expect(drakeCrackCount(900 * 0.32, 900, false)).toBe(2);
    // The hit that breaks it refills the bar, so the count cannot come from the poise fraction.
    expect(drakeCrackCount(900, 900, true)).toBe(3);
  });
});
