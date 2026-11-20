import { createProgressStore, hubVisitStarting } from '@metaverse/hub-sdk/progress';
import type { KeyValue, ProgressStore, ProgressSync } from '@metaverse/hub-sdk/core';
import { HUB_GAME_ID } from '../hub/config';
import type { HubLink } from '../hub/link';
import { ACCOUNT_SAVE_MODEL, nextAccountSave, type AccountSave } from './accountSave';
import * as device from './SaveStore';
import type { SaveFile } from './schema';

/**
 * Whose save the game loads and writes (plan §2.8), as Sproto Shooter keeps its progress
 * (`src/save/progress.js` there):
 * - play without a hub session: this browser's own slot, `sow.save` with its `.bak` (SaveStore.ts);
 * - a hub visit: that hub account's slot, `sow.account@<playerId>` in this browser plus the
 *   account's cloud save (`save.get` / `save.put`), so the save follows the hub login to any device;
 * - while the visit is still signing in: nothing is loaded, and a write waits in memory for the
 *   account (or goes to the browser slot if the visit turns out standalone).
 *
 * A save never crosses owners: one account's save never shows in another, and the browser's save
 * never moves into an account.
 */
export type SlotOwner = 'device' | 'pending' | 'account';
export type SlotSync = ProgressSync;
export type LoadResult = device.LoadResult;

/** Key of the account copies (`${ACCOUNT_KEY}@<playerId>`); the bare key itself is never written. */
export const ACCOUNT_KEY = 'sow.account';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface SaveSlot {
  owner(): SlotOwner;
  /** The cloud state of an account's save; `local` otherwise. */
  sync(): SlotSync;
  loadSave(): LoadResult;
  writeSave(save: SaveFile): boolean;
  /** A hub visit is starting: hold saves until it settles. */
  hold(): void;
  /** Follow the settled visit: an account's own save, or (null, or no session) the browser's. */
  followHub(link: Pick<HubLink, 'api' | 'bankable' | 'playerId' | 'noteSessionError'> | null): Promise<void>;
  /**
   * Page exit (`pagehide`, Return to Hub): send an unsynced account save once, with `keepalive`
   * (hub-sdk 0.9.0 `flushKeepalive`), until `pageShown` says the page came back from the cache.
   */
  flushOnExit(): boolean;
  pageShown(): void;
  subscribe(fn: () => void): () => void;
}

export function createSaveSlot(opts: { storage?: StorageLike | null; pushDelayMs?: number; retryDelayMs?: number } = {}): SaveSlot {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  let owner: SlotOwner = 'device';
  let held: SaveFile | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  let onSyncError: ((err: unknown) => void) | null = null;
  let exitFlushed = false;

  const kv: KeyValue | null = storage
    ? {
        getItem: (k) => storage.getItem(k),
        setItem: (k, v) => storage.setItem(k, v),
        removeItem: (k) => storage.removeItem?.(k),
      }
    : null;
  const store: ProgressStore<AccountSave> = createProgressStore<AccountSave>({
    key: ACCOUNT_KEY,
    model: ACCOUNT_SAVE_MODEL,
    storage: kv,
    pushDelayMs: opts.pushDelayMs,
    retryDelayMs: opts.retryDelayMs,
    onError: (err) => {
      console.warn('[save] cloud save failed:', (err as { code?: string })?.code ?? err);
      try {
        onSyncError?.(err);
      } catch {
        /* the store retries on its own */
      }
    },
  });
  store.subscribe(emit);

  function toAccount(save: SaveFile): boolean {
    store.update((current) => nextAccountSave(current, save));
    // Blocked storage still has the cloud copy, unless the cloud refused it for good.
    return store.persistent() || store.sync() !== 'error';
  }

  return {
    owner: () => owner,
    sync: () => (owner === 'account' ? store.sync() : 'local'),

    loadSave() {
      if (owner === 'device') return device.loadSave(storage);
      if (owner === 'pending') return { save: held, fromBackup: false, error: null };
      const v = store.get();
      if (v.future) return { save: null, fromBackup: false, error: 'save made by a newer build' };
      return { save: v.save, fromBackup: false, error: null };
    },

    writeSave(save) {
      if (owner === 'device') return device.writeSave(save, storage);
      if (owner === 'pending') {
        held = save;
        return true;
      }
      return toAccount(save);
    },

    hold() {
      if (owner !== 'device') return;
      owner = 'pending';
      held = null;
      emit();
    },

    async followHub(link) {
      const api = link?.api;
      if (link && link.bankable && link.playerId && api?.loadSave && api.writeSave) {
        onSyncError = (err) => link.noteSessionError(err);
        try {
          await store.attach({ loadSave: () => api.loadSave!(), writeSave: (d, o) => api.writeSave!(d, o) }, link.playerId);
          owner = 'account';
          if (held) toAccount(held);
          held = null;
          emit();
          return;
        } catch (err) {
          console.warn('[save] could not attach the hub account:', err);
        }
      }
      onSyncError = null;
      const wasHeld = held;
      owner = 'device';
      held = null;
      if (wasHeld) device.writeSave(wasHeld, storage);
      emit();
    },

    flushOnExit() {
      if (exitFlushed || owner !== 'account') return false;
      exitFlushed = true;
      return store.flushKeepalive();
    },

    pageShown() {
      exitFlushed = false;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** This page's save slot. */
export const saveSlot: SaveSlot = createSaveSlot();

/** Load from whoever owns the save now (App's title and Continue). */
export function loadSave(): LoadResult {
  return saveSlot.loadSave();
}

/** Write to whoever owns the save now (App's autosave). */
export function writeSave(save: SaveFile): boolean {
  return saveSlot.writeSave(save);
}

/**
 * Boot, before the title reads a save: with a portal ticket in the address or a hub session cached
 * in this tab, hold the save until the visit settles, so the title never offers the browser's save
 * (or a New game over it) to someone who came from the hub.
 */
export function holdForHubVisit(slot: SaveSlot = saveSlot, hash?: string): boolean {
  let starting: boolean;
  try {
    starting = hubVisitStarting(HUB_GAME_ID, hash);
  } catch {
    starting = false;
  }
  if (starting) slot.hold();
  return starting;
}
