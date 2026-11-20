import type { ProgressModel } from '@metaverse/hub-sdk/core';
import { SaveError, migrate } from './migrations';
import { SAVE_SCHEMA, type SaveFile } from './schema';

/**
 * A hub account's save (plan §2.8, hub-sdk `createProgressStore`): the same one slot as the browser
 * save, kept per account and in the account's cloud save, so it follows the hub login to any device.
 *
 * Sproto Shooter's progress is a set of unlocks, so its copies merge by union. Here the save is the
 * whole RPG state (position, gear, quests), which cannot be merged field by field: the copy written
 * last on the save's own line wins. `seq` counts the writes on that line. A device that picks up the
 * cloud save and plays on writes higher numbers than the copy it took, so a device whose clock is
 * behind still wins with newer play. Ties (two devices playing the same save at once) go to the later
 * `savedAt`, then to a fixed order, so every copy agrees on the same winner.
 *
 * The browser's own save (play outside the hub) stays in `sow.save` (SaveStore.ts) and never moves
 * into an account, as in the other games.
 */
export interface AccountSave {
  /** Writes on this save's line: 0 before the first. */
  seq: number;
  save: SaveFile | null;
  /**
   * A save from a newer build, kept as it came so this build cannot destroy it by merging. It is not
   * loaded; a save this build writes (a higher `seq`) replaces it, as a new game replaces any save.
   */
  future?: Record<string, unknown>;
}

/** The cloud body's own version (not the save schema). */
export const ACCOUNT_SAVE_VERSION = 1;
export const MAX_SEQ = 2 ** 40;

const isTable = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function seqOf(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN;
  return Number.isFinite(n) ? Math.min(MAX_SEQ, Math.max(0, n)) : 0;
}

export function emptyAccountSave(): AccountSave {
  return { seq: 0, save: null };
}

/** Anything from storage or the cloud as an AccountSave. A damaged save reads as none. Never throws. */
export function normalizeAccountSave(raw: unknown): AccountSave {
  if (!isTable(raw)) return emptyAccountSave();
  const seq = seqOf(raw.seq);
  // The cloud body carries a newer build's save in `save`; the local copy keeps it in `future`.
  const body = isTable(raw.save) ? raw.save : raw.future;
  if (!isTable(body)) return { seq, save: null };
  if (typeof body.schema === 'number' && body.schema > SAVE_SCHEMA) return { seq, save: null, future: body };
  try {
    return { seq, save: migrate(body) };
  } catch (err) {
    if (!(err instanceof SaveError)) console.warn('[save] account save unreadable', err);
    return { seq, save: null };
  }
}

/** Order: a real save over none, then `seq`, then `savedAt`, then the text itself (for a fixed winner). */
function rank(v: AccountSave): [number, number, string, string] {
  const has = v.save || v.future ? 1 : 0;
  const at = v.save ? v.save.savedAt : typeof v.future?.savedAt === 'string' ? v.future.savedAt : '';
  return [has, v.seq, at, JSON.stringify(v.save ?? v.future ?? null)];
}

function compare(a: AccountSave, b: AccountSave): number {
  const x = rank(a);
  const y = rank(b);
  for (let i = 0; i < x.length; i++) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
}

/** The winning copy. A maximum over a total order: commutative, associative and idempotent. */
export function mergeAccountSave(a: AccountSave, b: AccountSave): AccountSave {
  return compare(a, b) >= 0 ? a : b;
}

/** The cloud body: `{ v, seq, save }`, a few KB (the hub allows 16 KB). */
export function accountSaveCloudBody(value: AccountSave): Record<string, unknown> {
  const save = value.save ?? value.future ?? null;
  return save ? { v: ACCOUNT_SAVE_VERSION, seq: value.seq, save } : { v: ACCOUNT_SAVE_VERSION, seq: value.seq };
}

export const ACCOUNT_SAVE_MODEL: ProgressModel<AccountSave> = Object.freeze({
  empty: emptyAccountSave,
  normalize: normalizeAccountSave,
  merge: mergeAccountSave,
  toCloud: accountSaveCloudBody,
  // The local copy is stored in the same `{ v, seq, save }` form.
});

/** The next copy after writing `save`: one more write on this line. */
export function nextAccountSave(current: AccountSave, save: SaveFile): AccountSave {
  return { seq: Math.min(MAX_SEQ, current.seq + 1), save };
}
