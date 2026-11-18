import type { QualityLevel } from '../render/quality';
import type { MotionLevel, Settings } from './settings';

/** One line of the settings screen: what it shows, and what left / right (or A) does to it. */
export interface SettingRow {
  key: keyof Settings;
  label: string;
  /** The value in words. */
  text(s: Readonly<Settings>): string;
  /** How full the row's meter is (0..1), for the ones that have one. */
  meter?(s: Readonly<Settings>): number;
  /** The settings after one step left or right. `wrap`: A pressed, so a list goes round. */
  step(s: Readonly<Settings>, dir: -1 | 1, wrap: boolean): Settings;
}

type NumberKey = 'mouseSensitivity' | 'padSensitivity' | 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'ambienceVolume';
type ChoiceKey = 'shake' | 'flash' | 'quality';

const sensitivity = (key: NumberKey, label: string): SettingRow => ({
  key,
  label,
  text: (s) => `${s[key].toFixed(1)}×`,
  step: (s, dir) => ({ ...s, [key]: Math.round(Math.min(3, Math.max(0.2, s[key] + dir * 0.1)) * 10) / 10 }),
});

const volume = (key: NumberKey, label: string): SettingRow => ({
  key,
  label,
  text: (s) => `${Math.round(s[key] * 100)}%`,
  meter: (s) => s[key],
  step: (s, dir) => ({ ...s, [key]: Math.round(Math.min(1, Math.max(0, s[key] + dir * 0.1)) * 10) / 10 }),
});

const toggle = (key: 'invertY' | 'rumble' | 'grass', label: string): SettingRow => ({
  key,
  label,
  text: (s) => (s[key] ? 'On' : 'Off'),
  step: (s) => ({ ...s, [key]: !s[key] }),
});

function choice<T extends MotionLevel | QualityLevel>(key: ChoiceKey, label: string, options: readonly (readonly [T, string])[]): SettingRow {
  const at = (s: Readonly<Settings>) => options.findIndex(([v]) => v === s[key]);
  return {
    key,
    label,
    text: (s) => options[at(s)]?.[1] ?? '',
    step: (s, dir, wrap) => {
      const n = options.length;
      const i = wrap ? (at(s) + dir + n) % n : Math.min(n - 1, Math.max(0, at(s) + dir));
      return { ...s, [key]: options[i][0] };
    },
  };
}

const MOTION = [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']] as const;

/** The settings screen, top to bottom. Every row works with up / down and left / right alone. */
export const SETTING_GROUPS: readonly { title: string; rows: readonly SettingRow[] }[] = [
  {
    title: 'Look and feel',
    rows: [
      sensitivity('mouseSensitivity', 'Mouse sensitivity'),
      sensitivity('padSensitivity', 'Stick sensitivity'),
      toggle('invertY', 'Invert look Y'),
      toggle('rumble', 'Rumble'),
    ],
  },
  {
    title: 'Graphics',
    rows: [choice('quality', 'Graphics quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const), toggle('grass', 'Grass')],
  },
  {
    title: 'Motion',
    rows: [choice('shake', 'Camera shake', MOTION), choice('flash', 'Screen flashes', MOTION)],
  },
  {
    title: 'Audio',
    rows: [
      volume('masterVolume', 'Master volume'),
      volume('musicVolume', 'Music'),
      volume('sfxVolume', 'Effects'),
      volume('ambienceVolume', 'Ambience'),
    ],
  },
];

/** The row for a settings key. */
export const settingRow = (key: string): SettingRow | undefined => SETTING_GROUPS.flatMap((g) => g.rows).find((r) => r.key === key);
