import { describe, expect, it } from 'vitest';
import { sunCastsShadow, worldLight, type LightAxes } from '../../src/render/caveLook';

/**
 * Storm (#26) and the cave look (#28) share the sun, the hemisphere and the fog.
 * The cave wins underground. A storm that is still going is painted again on the way out.
 * `sunCastsShadow` still decides `castShadow`: Low never casts, and the cave never casts.
 */
const BAND = { near: 90, far: 200, farPlane: 420 };

const CAVE = {
  sunIntensity: 0,
  sunColor: 0xfff4e0,
  torchIntensity: 30,
  hemiIntensity: 0.45,
  hemiColor: 0x6a7a8a,
  hemiGround: 0x1a1a22,
  fogColor: 0x050608,
  fogNear: 6,
  fogFar: 46,
  farPlane: 140,
  background: 'cave',
};

const STORM = {
  sunIntensity: 1.15,
  sunColor: 0xc4b39a,
  torchIntensity: 0,
  hemiIntensity: 0.55,
  hemiColor: 0xe8f4ff,
  hemiGround: 0x5a6a3a,
  fogColor: 0x6a6258,
  fogNear: BAND.near,
  fogFar: BAND.far,
  farPlane: BAND.farPlane,
  background: 'day',
};

const DAY = {
  sunIntensity: 2.8,
  sunColor: 0xfff4e0,
  torchIntensity: 0,
  hemiIntensity: 1.3,
  hemiColor: 0xe8f4ff,
  hemiGround: 0x5a6a3a,
  fogColor: 0xcfe3ef,
  fogNear: BAND.near,
  fogFar: BAND.far,
  farPlane: BAND.farPlane,
  background: 'day',
};

describe('storm and cave lighting', () => {
  it('keeps the cave look when the storm turns on and off underground', () => {
    const calm = worldLight({ storm: false, cave: true, shadows: true }, BAND);
    expect(calm).toMatchObject({ ...CAVE, castShadow: false });

    const roaring = worldLight({ storm: true, cave: true, shadows: true }, BAND);
    expect(roaring).toEqual(calm);

    const passed = worldLight({ storm: false, cave: true, shadows: true }, BAND);
    expect(passed).toEqual(calm);
  });

  it('puts the storm back when you leave the cave during it', () => {
    expect(worldLight({ storm: true, cave: true, shadows: true }, BAND).sunIntensity).toBe(0);
    expect(worldLight({ storm: true, cave: false, shadows: true }, BAND)).toMatchObject({ ...STORM, castShadow: true });
  });

  it('uses the cave look when you enter during a storm, and the storm is still there on the way out', () => {
    expect(worldLight({ storm: true, cave: false, shadows: true }, BAND)).toMatchObject(STORM);
    expect(worldLight({ storm: true, cave: true, shadows: true }, BAND)).toMatchObject({ ...CAVE, castShadow: false });
    expect(worldLight({ storm: true, cave: false, shadows: true }, BAND)).toMatchObject({ ...STORM, castShadow: true });
  });

  it('keeps sun shadows off on Low through every storm and cave change', () => {
    const steps: LightAxes[] = [
      { storm: false, cave: false, shadows: false },
      { storm: true, cave: false, shadows: false },
      { storm: true, cave: true, shadows: false },
      { storm: false, cave: true, shadows: false },
      { storm: true, cave: true, shadows: false },
      { storm: true, cave: false, shadows: false },
      { storm: false, cave: false, shadows: false },
    ];
    for (const step of steps) {
      const look = worldLight(step, BAND);
      expect(look.castShadow).toBe(false);
      if (step.cave) expect(look).toMatchObject(CAVE);
      else if (step.storm) expect(look).toMatchObject(STORM);
      else expect(look).toMatchObject(DAY);
    }
  });

  it('lets sunCastsShadow decide, so a storm cannot turn shadows on', () => {
    for (const shadows of [false, true]) {
      for (const cave of [false, true]) {
        for (const storm of [false, true]) {
          expect(worldLight({ storm, cave, shadows }, BAND).castShadow).toBe(sunCastsShadow(shadows, cave));
        }
      }
    }
  });
});
