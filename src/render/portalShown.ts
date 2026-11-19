import { DOOR_REVEALED_FLAG, ROOTDEEP_PORTALS, portalOpenFlag } from '../content/packs/rootdeep';

/** What a portal draws. Null means draw nothing, and the caller must not cache a view. */
export type PortalDraw = 'motes' | 'opening' | 'column';

/** Faint motes on the revealed main door only show this close (m). */
const MOTE_RANGE = 5;

/**
 * A sealed mouth draws nothing. Once the Collector's Map reveals the main door it shows motes
 * within 5 m, until that mouth is opened. An open mouth is a dark gap. A cave mouth is a column.
 * `used` is the sim's "hidden" flag.
 */
export function portalShown(
  id: string,
  used: boolean,
  flags: Readonly<Record<string, number>>,
  at: { x: number; z: number },
  player: { x: number; z: number } | undefined,
): PortalDraw | null {
  const def = ROOTDEEP_PORTALS[id];
  if (!def) return null;
  if (def.side === 'cave') return 'column';
  if ((flags[portalOpenFlag(def.key)] ?? 0) !== 0) return 'opening';
  if (def.key === 'hedge_north' && (flags[DOOR_REVEALED_FLAG] ?? 0) !== 0) {
    if (!player) return 'motes';
    const dx = at.x - player.x;
    const dz = at.z - player.z;
    return dx * dx + dz * dz <= MOTE_RANGE * MOTE_RANGE ? 'motes' : null;
  }
  return used ? null : 'opening';
}
