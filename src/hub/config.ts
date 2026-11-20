import type { GameId } from '@metaverse/hub-sdk/core';

/**
 * Hub identity for Sproto Open World. The hub's game id, its plaza slug and the `#from=` value are
 * the same string, as in the other Sproto games. The hub lists it from hub-sdk 0.10.0 on (its ring
 * stands beside Sproto Shooter's in the plaza). It has no Relic and reports no events.
 */
export const HUB_GAME_ID = 'sproto-open-world' satisfies GameId;
