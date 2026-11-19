import { isRootdeep } from '../content/packs/rootdeep';

/**
 * What the loading veil calls each streamed region. The article is part of the cave's name, so
 * one sentence covers both places: "Loading Sproutvale…" on the surface, "Loading the Rootdeep…"
 * once the destination is inside the cave.
 */
const DISPLAY_NAME = {
  sproutvale: 'Sproutvale',
  rootdeep: 'the Rootdeep',
} as const;

type RegionId = keyof typeof DISPLAY_NAME;

/** The baked region a destination world-x belongs to. The cave is every x at or past its origin. */
function regionAt(x: number): RegionId {
  return isRootdeep(x) ? 'rootdeep' : 'sproutvale';
}

/** The veil's line for the region the player is entering. */
export function loadingVeilText(x: number): string {
  return `Loading ${DISPLAY_NAME[regionAt(x)]}…`;
}
