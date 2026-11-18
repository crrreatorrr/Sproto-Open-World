import { SaveError, migrate } from './migrations';
import { SAVE_BAK_KEY, SAVE_KEY, type SaveFile } from './schema';

/**
 * The one save slot in localStorage (plan §2.8). Writing keeps the previous good save as `.bak`;
 * loading falls back to it when the main save is missing, unparsable or fails migration, and says
 * so. Storage can be blocked (private mode): loading then returns nothing and writing is skipped.
 */
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(storage: StorageLike, key: string): SaveFile {
  const raw = storage.getItem(key);
  if (raw === null) throw new SaveError('empty');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SaveError('not valid JSON');
  }
  return migrate(parsed);
}

export interface LoadResult {
  save: SaveFile | null;
  /** The main save was damaged and the backup was used. */
  fromBackup: boolean;
  /** Why the main save (and the backup, if that failed too) couldn't be used. Null when fine or when there was simply no save. */
  error: string | null;
}

export function loadSave(storage: StorageLike | null = defaultStorage()): LoadResult {
  if (!storage) return { save: null, fromBackup: false, error: null };
  let mainError: string;
  try {
    return { save: read(storage, SAVE_KEY), fromBackup: false, error: null };
  } catch (e) {
    mainError = e instanceof Error ? e.message : String(e);
  }
  let hadMain = false;
  try {
    hadMain = storage.getItem(SAVE_KEY) !== null;
  } catch {
    return { save: null, fromBackup: false, error: null }; // storage that throws on read: as if blocked
  }
  try {
    const save = read(storage, SAVE_BAK_KEY);
    return { save, fromBackup: true, error: hadMain ? `save damaged (${mainError})` : null };
  } catch (e) {
    if (!hadMain) return { save: null, fromBackup: false, error: null };
    return { save: null, fromBackup: false, error: `save damaged (${mainError}); backup unusable (${e instanceof Error ? e.message : e})` };
  }
}

/** Write a save, keeping the current one (if it is good) as the backup first. */
export function writeSave(save: SaveFile, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    try {
      read(storage, SAVE_KEY);
      storage.setItem(SAVE_BAK_KEY, storage.getItem(SAVE_KEY)!);
    } catch (e) {
      // No good save to keep as a backup (or none yet). One from a newer build is kept anyway,
      // so playing an older build never silently destroys newer progress.
      if (e instanceof Error && e.message.includes('newer build')) storage.setItem(SAVE_BAK_KEY, storage.getItem(SAVE_KEY)!);
    }
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false; // storage full or blocked: the game carries on
  }
}
