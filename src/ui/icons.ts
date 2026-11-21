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
// The C3 powers.
const line = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const WARD = svg(`<path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z" ${line}/><path d="M8.5 14.5l7-7M9 9.5l2.5-2.5" ${line}/>`);
const SNARE = svg('<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.6"/><path d="M13.5 5.5L7.5 13h4l-1 5.5 6-7.5h-4z" fill="currentColor"/>');
const SWARM = svg(`<circle cx="12" cy="13" r="3" fill="currentColor"/><path d="M3 4c4 .5 6 2.500 7 5.500M21 4c-4 .5-6 2.500-7 5.500M12 22v-5" ${line}/><path d="M3 8V4h4M21 8V4h-4" ${line}/>`);
const BRAMBLE = svg(`<path d="M4 22V9M10 22V4M16 22V4M21 22V9" ${line}/><path d="M4 13l3-2M10 9l3-2M10 16l3-2M16 11l3-2M16 18l3-2" ${line}/>`);
const VINE = svg(`<path d="M3 21c6 0 4-9 9-9s3-9 9-9" ${line}/><path d="M9 8c0-3 2-5 6-5 0 3-2 5-6 5zM15 16c0 3 2 5 6 5 0-3-2-5-6-5z" fill="currentColor"/>`);
const BLOOM = svg(`<circle cx="12" cy="12" r="2.600" fill="currentColor"/><circle cx="12" cy="5.500" r="3" ${line}/><circle cx="18.200" cy="10" r="3" ${line}/><circle cx="15.800" cy="17.300" r="3" ${line}/><circle cx="8.200" cy="17.300" r="3" ${line}/><circle cx="5.800" cy="10" r="3" ${line}/>`);
const BREATH = svg(`<path d="M2 12l9-5.500v11z" fill="currentColor"/><path d="M14 6c2 2 1 4 3 6-2 2-1 4-3 6M19 5c2 4 2 10 0 14" ${line}/>`);
const SURGE = svg(`<path d="M12 21v-9" ${line}/><path d="M12 12c0-4-3-7-8-7 0 4 3 7 8 7zM12 12c0-4 3-7 8-7 0 4-3 7-8 7z" fill="currentColor"/><path d="M2 21h20M6 17.500H3M21 17.500h-3" ${line}/>`);

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
  mirrorWard: WARD,
  staticSnare: SNARE,
  seekerSwarm: SWARM,
  brambleWall: BRAMBLE,
  vinePull: VINE,
  healingBloom: BLOOM,
  emberBreath: BREATH,
  sproutSurge: SURGE,
} as const;
export type IconId = keyof typeof ICONS;
