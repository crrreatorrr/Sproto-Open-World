/**
 * The Edge Warden (far-view plan §3.10): the dragon that guards the edge of the world. Pure tuning;
 * its brain is `sim/systems/edgeWarden.ts` and its body is the Skyfire Drake's model, three times
 * the size.
 *
 * The plan's bands were 96, 64 and 128 m, on the understanding that nothing is built that close to
 * an edge. Sproutvale is: its village and first shrine sit about 62 m from the south edge, and a
 * camp 36 m from the west one. So the bands here are tighter, and instead the distance is measured
 * from where the player will be in `lookTicks`: a bull flying out at 45 m/s meets the Warden about
 * 120 m from the edge, and someone standing in the village never does.
 */
export const EDGE_WARDEN = {
  /** It appears when a player is this close to the edge (m)... */
  warn: 32,
  /** ...fires inside this (m), once the grace is over... */
  strike: 20,
  /** ...and leaves when they are back past this (m). The gap to `warn` keeps it from flickering. */
  leave: 48,
  /** How far ahead a player's own speed is counted (ticks). */
  lookTicks: 120,
  /** After it appears it only circles for this long (ticks): time to read the warning and turn back. */
  graceTicks: 240,
  /** It circles at `cruise` (m/s) and catches up at `dash`: faster than the bull's dive. */
  cruise: 40,
  dash: 90,
  /** Its circle around the player (m), and how far above them it flies (m, to its feet). */
  orbitRadius: 38,
  height: 20,
  /** It arrives from this far beyond the edge (m) and this far up (m). */
  arrive: { out: 150, up: 70 },
  /** Where its mouth is from its feet (m): forward along its heading, and up (the Drake's, times `scale`). */
  mouth: { fwd: 13.5, up: 6.6 },
  /** The barrage: one fireball every `volleyEvery` ticks (6 a second), each taking `hpFrac` of max health. */
  volleyEvery: 10,
  fireball: { speed: 70, radius: 0.9, range: 240, hpFrac: 0.4, poise: 20, spread: 0.03 },
  /**
   * The burn: every `burnEvery` ticks in the strike band, after `burnTelegraph` ticks of warning. It
   * takes a whole health bar, can't be blocked and Mirror Ward can't turn it. A roll's frames still
   * pass through it, and so does getting behind something.
   */
  burnEvery: 300,
  burnTelegraph: 72,
  burn: { speed: 95, radius: 2.4, range: 300, hpFrac: 1, poise: 60, homing: 2.2 },
  /** Leaving: it flies out past the edge for this long (ticks), then it is gone. */
  leaveTicks: 240,
  /** One for each player at the edge, and no more than this at once. */
  max: 2,
  /** Times the Skyfire Drake's size. */
  scale: 3,
} as const;
