/**
 * Daylight, the drake storm and the Rootdeep's torch-lit dark, as plain numbers. No three.js: the
 * tests import this, and the renderer paints `worldLight`. Surface fog here is only the daylight
 * default. The renderer puts back the fog band `worldLook` was given.
 *
 * The cave wins underground, so a storm that turns on or off there does not touch the lights.
 * The storm is applied again on the way out when it is still going. Sun shadows are
 * `sunCastsShadow`: Low never casts, and the cave never casts.
 */
/** Horizon haze the daylight fog fades into. The storm replaces it. The cave does not use it. */
export const DAY_HAZE = 0xcfe3ef;
export interface CaveLook {
  sunIntensity: number;
  sunShadow: boolean;
  torchIntensity: number;
  hemiIntensity: number;
  fogNear: number;
  fogFar: number;
  farPlane: number;
}

const SURFACE: CaveLook = {
  sunIntensity: 2.8, sunShadow: true, torchIntensity: 0, hemiIntensity: 1.3,
  fogNear: 80, fogFar: 180, farPlane: 450,
};

const CAVE: CaveLook = {
  sunIntensity: 0, sunShadow: false, torchIntensity: 30, hemiIntensity: 0.45,
  fogNear: 6, fogFar: 46, farPlane: 140,
};

export function lookFor(cave: boolean): CaveLook {
  return cave ? CAVE : SURFACE;
}

/** Whether the sun casts shadows: the graphics quality must want them, and the cave forbids them. */
export function sunCastsShadow(qualityWants: boolean, cave: boolean): boolean {
  return qualityWants && lookFor(cave).sunShadow;
}

/** The three axes that share the sun, the hemisphere light and the fog. */
export interface LightAxes {
  storm: boolean;
  cave: boolean;
  /** Graphics quality wants sun shadows. Low passes false. */
  shadows: boolean;
}

/** The streamed world's fog band. Storm changes its colour, not these distances. */
export interface SurfaceFog {
  near: number;
  far: number;
  farPlane: number;
}

/** Everything `Renderer` writes when the world look or the cave look is applied. */
export interface ComposedLook {
  sunIntensity: number;
  sunColor: number;
  castShadow: boolean;
  torchIntensity: number;
  hemiIntensity: number;
  hemiColor: number;
  hemiGround: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  farPlane: number;
  background: 'day' | 'cave';
}

const DAY_SUN = 0xfff4e0;
const DAY_HEMI = 0xe8f4ff;
const DAY_GROUND = 0x5a6a3a;
const STORM_SUN = 0xc4b39a;
const STORM_FOG = 0x6a6258;
const STORM_SUN_INTENSITY = 1.15;
const STORM_HEMI_INTENSITY = 0.55;
const CAVE_FOG = 0x050608;
const CAVE_HEMI = 0x6a7a8a;
const CAVE_GROUND = 0x1a1a22;

/**
 * One look for the current storm, cave and quality. Underground the cave wins and the storm is
 * only remembered. On the surface the storm dims the daylight without moving the fog band.
 */
export function worldLight(axes: LightAxes, surfaceFog: SurfaceFog): ComposedLook {
  const castShadow = sunCastsShadow(axes.shadows, axes.cave);
  if (axes.cave) {
    const look = lookFor(true);
    return {
      sunIntensity: look.sunIntensity,
      sunColor: DAY_SUN,
      castShadow,
      torchIntensity: look.torchIntensity,
      hemiIntensity: look.hemiIntensity,
      hemiColor: CAVE_HEMI,
      hemiGround: CAVE_GROUND,
      fogColor: CAVE_FOG,
      fogNear: look.fogNear,
      fogFar: look.fogFar,
      farPlane: look.farPlane,
      background: 'cave',
    };
  }
  const look = lookFor(false);
  const storm = axes.storm;
  return {
    sunIntensity: storm ? STORM_SUN_INTENSITY : look.sunIntensity,
    sunColor: storm ? STORM_SUN : DAY_SUN,
    castShadow,
    torchIntensity: look.torchIntensity,
    hemiIntensity: storm ? STORM_HEMI_INTENSITY : look.hemiIntensity,
    hemiColor: DAY_HEMI,
    hemiGround: DAY_GROUND,
    fogColor: storm ? STORM_FOG : DAY_HAZE,
    fogNear: surfaceFog.near,
    fogFar: surfaceFog.far,
    farPlane: surfaceFog.farPlane,
    background: 'day',
  };
}
