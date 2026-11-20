/**
 * A one-time wipe of the game's local data. When the build's epoch moves on, everything this game keeps
 * in localStorage (the save and its backup, settings and controls) is deleted once, so every player
 * starts a fresh account. The classes epoch made everyone pick a class.
 */
export const DATA_EPOCH_KEY = 'sow.epoch';
export const DATA_EPOCH = 'classes-1';
/**
 * The first save schema of this epoch. An older save belongs to the data the epoch wiped: local
 * save mode's disk file (src/save/DiskSave.ts) ignores one, so it can't bring a wiped save back.
 */
export const DATA_EPOCH_SCHEMA = 5;
/** Every key the game owns. */
export const GAME_KEYS = ['sow.save', 'sow.save.bak', 'sow.settings', 'sow.controls'] as const;

/** Wipe the game's data if this browser's epoch is older than the build's. Returns true when it did. */
export function enterDataEpoch(storage: Storage | null | undefined = globalThis.localStorage): boolean {
  try {
    if (!storage || storage.getItem(DATA_EPOCH_KEY) === DATA_EPOCH) return false;
    for (const key of GAME_KEYS) storage.removeItem(key);
    storage.setItem(DATA_EPOCH_KEY, DATA_EPOCH);
    return true;
  } catch {
    // Blocked storage: nothing was kept anyway.
    return false;
  }
}
