import { DATA_EPOCH_SCHEMA } from './dataEpoch';
import { SaveError, migrate } from './migrations';
import type { SaveFile } from './schema';

/**
 * Local save mode, the browser half (the dev server half is tools/localSavePlugin.ts). On a dev
 * server the save is also kept in one file on disk, so every port, worktree and browser shares the
 * same progress; localStorage stays the save the game reads and writes synchronously, and this
 * keeps the two in step: the newer of the two wins at the title, and every save is written to both.
 */
export const DISK_SAVE_URL = '/__sow/save';

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'headers'>>;

export interface DiskReadResult {
  /** The endpoint answered (false on a build without it: production, `vite preview`). */
  available: boolean;
  save: SaveFile | null;
  /** The file is from a newer build: this one must not overwrite it. */
  newerBuild: boolean;
  /** The main file was damaged and the server sent its backup. */
  fromBackup: boolean;
  error: string | null;
  /** Where the file is, as the server shows it (`~/.sproto-open-world/save.json`). */
  path: string | null;
}

const none = (over: Partial<DiskReadResult>): DiskReadResult => ({
  available: true, save: null, newerBuild: false, fromBackup: false, error: null, path: null, ...over,
});

export async function readDiskSave(fetchFn: FetchLike = fetch): Promise<DiskReadResult> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(DISK_SAVE_URL, { cache: 'no-store' });
  } catch (e) {
    return none({ available: false, error: e instanceof Error ? e.message : String(e) });
  }
  const path = res.headers.get('X-Sow-Save-Path');
  // A server without the endpoint answers without the path header (a 404, or its HTML page).
  if (!path) return none({ available: false });
  if (res.status === 204) return none({ path });
  if (!res.ok) return none({ path, error: `HTTP ${res.status}` });
  const fromBackup = res.headers.get('X-Sow-From-Backup') === '1';
  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    return none({ path, fromBackup, error: 'not valid JSON' });
  }
  // A file from before the data epoch is what the epoch wiped: as good as no file (the next save
  // replaces it).
  const schema = (parsed as { schema?: unknown } | null)?.schema;
  if (typeof schema === 'number' && schema < DATA_EPOCH_SCHEMA) return none({ path, fromBackup });
  try {
    return none({ path, fromBackup, save: migrate(parsed) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return none({ path, fromBackup, error: msg, newerBuild: e instanceof SaveError && msg.includes('newer build') });
  }
}

/** Write the save file. False when the server refused or could not be reached. */
export async function writeDiskSave(save: SaveFile, fetchFn: FetchLike = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(DISK_SAVE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(save),
      // The write still lands when it was started just before the tab closed (a save is ~20 KB).
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Which save to keep: the one written last. Equal times are the same save. */
export function newerSave(local: SaveFile | null, disk: SaveFile | null): 'local' | 'disk' | 'same' {
  if (!disk) return local ? 'local' : 'same';
  if (!local) return 'disk';
  const a = Date.parse(local.savedAt);
  const b = Date.parse(disk.savedAt);
  if (Number.isNaN(b)) return 'local';
  if (Number.isNaN(a)) return 'disk';
  return a === b ? 'same' : a > b ? 'local' : 'disk';
}
