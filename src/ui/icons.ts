/**
 * Small inline SVG icons for the HUD (no files to load), drawn in `currentColor` so CSS tints them:
 * the damage kinds (a sword for the staff, a rune for spells), the three statuses, and the four
 * spells. 24 × 24 view box.
 */
const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

const SWORD = svg('<path d="M19 3l2 0 0 2-9.5 9.5-2-2z" fill="currentColor"/><path d="M6 13l5 5M8 16l-4 4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>');
const RUNE = svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5l5 11H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>');
const FLAME = svg('<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z" fill="currentColor"/>');
const FLAKE = svg('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');
const BOLT = svg('<path d="M14 2L4 14h7l-2 8 11-13h-7z" fill="currentColor"/>');
const ORB = svg('<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M4.2 19.8L7 17M17 7l2.8-2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');
const DART = svg('<path d="M3 12l12-6-3 6 3 6z" fill="currentColor"/><path d="M15 12h7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>');

export const ICONS = {
  physical: SWORD,
  arcane: RUNE,
  burn: FLAME,
  chill: FLAKE,
  shock: BOLT,
  frozen: FLAKE,
  bolt: DART,
  blast: ORB,
  frostNova: FLAKE,
  chainZap: BOLT,
} as const;
export type IconId = keyof typeof ICONS;
