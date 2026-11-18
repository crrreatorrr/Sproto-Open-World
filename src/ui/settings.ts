/** Player settings (not controls; see input/controlPrefs.ts), saved in localStorage `sow.settings`. */
export interface Settings {
  /** Mouse look multiplier. */
  mouseSensitivity: number;
  /** Right-stick look multiplier. */
  padSensitivity: number;
  invertY: boolean;
  rumble: boolean;
  /** Camera shake and screen flash (off for motion sensitivity). */
  shake: boolean;
}

export const SETTINGS_KEY = 'sow.settings';

export const DEFAULT_SETTINGS: Settings = { mouseSensitivity: 1, padSensitivity: 1, invertY: false, rumble: true, shake: true };

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  return {
    mouseSensitivity: clamp(r.mouseSensitivity, 0.2, 3, d.mouseSensitivity),
    padSensitivity: clamp(r.padSensitivity, 0.2, 3, d.padSensitivity),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    rumble: typeof r.rumble === 'boolean' ? r.rumble : d.rumble,
    shake: typeof r.shake === 'boolean' ? r.shake : d.shake,
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
