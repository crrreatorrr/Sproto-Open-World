/**
 * Quest-polish encounter numbers. One place to change them if Ken picks different defaults.
 * Pure data: nothing here imports the registries.
 */

/** Pest Control: the orchard camp fights in this many waves of this many Grunts. */
export const PEST_CAMP = 'orchard_south';
export const PEST_WAVES = 2;
export const PEST_WAVE_SIZE = 4;

/** Big Coin rings the bell at or below this fraction of max HP and calls this many Slingers. */
export const BIG_COIN_ADD_BELOW = 0.5;
export const BIG_COIN_ADD_COUNT = 2;
export const BIG_COIN_ADD_DEF = 'slinger';

/** The Gatekeeper's third swing waits this many extra ticks at the top of its wind-up. */
export const GATEKEEPER_STRING3_HOLD = 18;

/** Scrapjaw's bite: one beat of wind-up, then a second beat of hold, then the snap. */
export const SCRAPJAW_BITE_WINDUP = 24;
export const SCRAPJAW_BITE_HOLD = 24;

/** A reflected charged shot staggers a Gunner for 1 second. */
export const GUNNER_REFLECT_STAGGER = 60;

/** The parry drill's third swing (and every third after) uses this wind-up. */
export const DRILL_FAST_WINDUP = 12;

/** Relic chests shimmer only inside this radius (m) during Lost Relics. */
export const CHEST_SHIMMER_M = 15;

/** Studying the Warden's lens previews wind-up highlights for this many ticks (5 s). */
export const LENS_PREVIEW_TICKS = 300;
/**
 * The world flag holding the tick the lens preview ends. A tick of this session only (the sim's
 * clock starts again at 0 on load), so it is never saved.
 */
export const LENS_PREVIEW_FLAG = 'lens.previewUntil';

/** How many Orchard Grunts wear a pumpkin. */
export const PUMPKIN_CARRIERS = 5;
/** A carrier whose pumpkin is knocked off runs to the nearest Grunt of its own camp this close (m), for at most this long. */
export const PUMPKIN_FLEE_M = 10;
export const PUMPKIN_FLEE_TICKS = 180;

/** Tremors: the quarry rumbles inside this radius (m) of this point while the quest is active. */
export const TREMOR_AT: readonly [number, number] = [400, 430];
export const TREMOR_RADIUS = 120;
/** Ticks between rumbles. */
export const TREMOR_EVERY = 90;

/** Shrines hum inside this radius (m), louder in two closer bands. */
export const SHRINE_HUM_M = 18;

/** Bonus flags workstream B grants items from. The count in progress lives at `${flag}.n`. */
export const BONUS_FLAGS = {
  watchtower: 'bonus.q_watchtower.reflect',
  gallery: 'bonus.q_iron_gallery.reflect',
  giant: 'bonus.q_hollow_giant.dodge',
} as const;

/** The mill lever raises this flag and a `sealDrop` cue. B hooks either to hand over the seal. */
export const SEAL_HOOK = 'hook.tinubu_seal';
