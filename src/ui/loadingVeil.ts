import { regionAt } from '../content/world/regions';

/**
 * The loading veil's line names the region being entered, article included, so one sentence fits
 * every place: "Loading Sproutvale…", "Loading the Rootdeep…", "Loading the Willowrun…".
 */
export function loadingVeilText(x: number, z = 0): string {
  return `Loading ${regionAt(x, z).name}…`;
}
