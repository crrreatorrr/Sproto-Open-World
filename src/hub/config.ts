/**
 * Hub identity for Sproto Open World. The hub's game id, its plaza slug and the `#from=` value are
 * the same string in the other Sproto games. The vendored hub SDK (0.9.0) does not list this id
 * yet: until metaverse-hub registers it (GAME_IDS and the server), every visit is standalone and
 * the feedback window says feedback needs a signed-in hub visit, as the other games do on their own.
 */
export const HUB_GAME_ID: string = 'sproto-open-world';
