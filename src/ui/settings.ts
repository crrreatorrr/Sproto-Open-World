import type { QualityLevel } from '../render/quality';

/** How much of an effect to show, for motion sensitivity. */
export type MotionLevel = 'full' | 'reduced' | 'off';

/** Player settings (not controls; see input/controlPrefs.ts), saved in localStorage `sow.settings`. */
export interface Settings {
  /** Mouse look multiplier. */
  mouseSensitivity: number;
  /** Right-stick look multiplier. */
  padSensitivity: number;
  invertY: boolean;
  rumble: boolean;
  /** Camera shake. */
  shake: MotionLevel;
  /** Screen flashes, impact flashes and the white flash on a struck body. */
  flash: MotionLevel;
  quality: QualityLevel;
  /** Volumes, 0..1. */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  /** Instanced grass around the player (off for slower machines). */
  grass: boolean;
}

export const SETTINGS_KEY = 'sow.settings';

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1, padSensitivity: 1, invertY: false, rumble: true,
  shake: 'full', flash: 'full', quality: 'high', grass: true,
  masterVolume: 1, musicVolume: 0.7, sfxVolume: 1, ambienceVolume: 0.7,
};

/** The strength a motion level leaves of an effect. */
export const motionScale = (level: MotionLevel): number => (level === 'full' ? 1 : level === 'reduced' ? 0.4 : 0);

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const MOTION: readonly MotionLevel[] = ['full', 'reduced', 'off'];
const QUALITIES: readonly QualityLevel[] = ['low', 'medium', 'high'];

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  // Older saves held one on/off switch for both shake and flashes.
  const legacy = typeof r.shake === 'boolean' ? (r.shake ? 'full' : 'off') : undefined;
  return {
    mouseSensitivity: clamp(r.mouseSensitivity, 0.2, 3, d.mouseSensitivity),
    padSensitivity: clamp(r.padSensitivity, 0.2, 3, d.padSensitivity),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    rumble: typeof r.rumble === 'boolean' ? r.rumble : d.rumble,
    shake: oneOf(legacy ?? r.shake, MOTION, d.shake),
    flash: oneOf(r.flash ?? legacy, MOTION, d.flash),
    quality: oneOf(r.quality, QUALITIES, d.quality),
    masterVolume: clamp(r.masterVolume, 0, 1, d.masterVolume),
    musicVolume: clamp(r.musicVolume, 0, 1, d.musicVolume),
    sfxVolume: clamp(r.sfxVolume, 0, 1, d.sfxVolume),
    ambienceVolume: clamp(r.ambienceVolume, 0, 1, d.ambienceVolume),
    grass: typeof r.grass === 'boolean' ? r.grass : d.grass,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {
    // Blocked storage or a broken value: defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Not critical: the change still applies for this visit.
  }
}
