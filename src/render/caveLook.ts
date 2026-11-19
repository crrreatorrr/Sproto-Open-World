/**
 * Daylight and the Rootdeep's torch-lit dark, as plain numbers. No three.js: the tests import this,
 * and `Renderer.setCave` is what turns the numbers into lights. Surface fog here is only the
 * daylight default. The renderer puts back the fog band `worldLook` was given.
 */
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
