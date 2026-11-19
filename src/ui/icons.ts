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

const keep = (body: string) => svg(body);
const kLine = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** 24×24 silhouettes for the 18 keepsakes. 128 px colour art is a separate master. */
export const KEEPSAKE_ICONS: Record<string, string> = {
  relic_drowned_coins: keep(`<circle cx="8" cy="14" r="3.2" ${kLine}/><circle cx="12.2" cy="10.5" r="3.2" ${kLine}/><circle cx="16" cy="14.5" r="3.2" ${kLine}/>`),
  relic_gatekeepers_grip: keep(`<path d="M7 16c0-4 2-6 5-6s5 2 5 6v3H7z" ${kLine}/><path d="M8 10V8M12 10V7M16 10V8" ${kLine}/>`),
  relic_hopeglass: keep(`<path d="M8 3h8M8 21h8M9 4l3 7-3 7M15 4l-3 7 3 7" ${kLine}/>`),
  relic_sprotos_stride: keep(`<ellipse cx="8" cy="14" rx="3" ry="5" ${kLine}/><ellipse cx="16" cy="14" rx="3" ry="5" ${kLine}/>`),
  relic_tinubus_broken_seal: keep(`<circle cx="11" cy="11" r="5" ${kLine}/><path d="M8 14l6-6M14 16l6 4" ${kLine}/>`),
  relic_oracles_eye: keep(`<circle cx="12" cy="12" r="7" ${kLine}/><circle cx="12" cy="12" r="3" ${kLine}/>`),
  relic_deepbreath_bellows: keep(`<path d="M6 16c0-6 4-10 8-10 3 4 2 8 0 10H6z" ${kLine}/><path d="M14 8c3 1 5 2 6 4" ${kLine}/>`),
  relic_elder_iron_rivet: keep(`<path d="M12 4l3 3-3 2-3-2zM12 9v10" ${kLine}/><path d="M9 19h6" ${kLine}/>`),
  relic_surgebriar: keep(`<path d="M7 18c2-6 8-6 10 0" ${kLine}/><path d="M8 12l-2-3M12 10V6M16 12l2-3" ${kLine}/>`),
  relic_drakeplume: keep(`<path d="M6 20c4-2 8-8 12-16-4 2-8 8-12 16z" ${kLine}/>`),
  totem_elders_hearth: keep(`<ellipse cx="12" cy="15" rx="7" ry="3.5" ${kLine}/><circle cx="12" cy="14" r="1.6" fill="currentColor"/>`),
  totem_field_warden: keep(`<path d="M6 9h12l-2 3H8zM12 12v8M9 20h6" ${kLine}/>`),
  totem_seekers_lantern: keep(`<path d="M9 6h6l1 3H8zM8 9h8v8l-4 3-4-3zM12 3v3" ${kLine}/>`),
  totem_turnstone: keep(`<path d="M9 20V7l3-3 3 3v13" ${kLine}/>`),
  totem_elders_seed: keep(`<circle cx="12" cy="14" r="4" ${kLine}/><path d="M12 10V5M12 6c2-1 3-2 3-3" ${kLine}/>`),
  totem_earthspeaker_stake: keep(`<path d="M12 3v14M8 20h8M7 16c2 1 3 1 5 0s3-1 5 0" ${kLine}/>`),
  totem_ember_quench_pail: keep(`<path d="M8 8h8l-1 12H9zM7 8h10" ${kLine}/>`),
  totem_skylure_post: keep(`<path d="M12 21V6M12 8c4-1 6-1 7 1M12 12c-4 0-6 1-7 2" ${kLine}/>`),
};

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
