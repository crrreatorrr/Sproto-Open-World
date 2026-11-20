import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HubApi, HubLink } from '../../src/hub/link';
import {
  ACCOUNT_SAVE_VERSION, accountSaveCloudBody, emptyAccountSave, mergeAccountSave, nextAccountSave, normalizeAccountSave,
  type AccountSave,
} from '../../src/save/accountSave';
import { ACCOUNT_KEY, createSaveSlot, holdForHubVisit } from '../../src/save/slot';
import { SAVE_KEY, SAVE_SCHEMA, type SaveFile } from '../../src/save/schema';

/** The hub account's save (src/save/accountSave.ts) and whose save the game uses (src/save/slot.ts). */

class FakeStorage {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v));
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

const fixture = (): SaveFile => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `save-v${SAVE_SCHEMA}.json`), 'utf8'));
const saveWith = (sprouts: number, savedAt = '2026-11-20T10:00:00.000Z'): SaveFile => ({ ...fixture(), savedAt, player: { ...fixture().player, sprouts } });
const copy = (seq: number, sprouts: number, savedAt?: string): AccountSave => ({ seq, save: saveWith(sprouts, savedAt) });

/** A hub account's cloud save, as `save.get` / `save.put` keep it. */
function fakeCloud() {
  const cloud = { data: null as Record<string, unknown> | null, puts: [] as Array<{ data: Record<string, unknown>; keepalive: boolean }>, fail: null as Error | null };
  const api: HubApi = {
    init: () => Promise.resolve({} as never),
    exit: () => {},
    getSession: () => null,
    loadSave: () => (cloud.fail ? Promise.reject(cloud.fail) : Promise.resolve({ data: cloud.data, updatedAt: cloud.data ? 1 : 0 })),
    writeSave: (data, opts) => {
      if (cloud.fail) return Promise.reject(cloud.fail);
      cloud.data = JSON.parse(JSON.stringify(data));
      cloud.puts.push({ data: cloud.data!, keepalive: !!opts?.keepalive });
      return Promise.resolve({ data: cloud.data, updatedAt: 2 });
    },
  };
  return { cloud, api };
}

const account = (api: HubApi, playerId = 'player-1') =>
  ({ api, bankable: true, playerId, noteSessionError: vi.fn(() => false) }) as unknown as HubLink;

describe('the account save model', () => {
  it('merges to the same winner in any order, and merging a copy with itself changes nothing', () => {
    const copies = [emptyAccountSave(), copy(1, 10), copy(2, 5), copy(2, 7, '2026-11-20T11:00:00.000Z'), copy(3, 1, '2026-01-01T00:00:00.000Z')];
    for (const a of copies) {
      expect(mergeAccountSave(a, a)).toBe(a);
      for (const b of copies) {
        expect(mergeAccountSave(a, b)).toEqual(mergeAccountSave(b, a));
        for (const c of copies) expect(mergeAccountSave(mergeAccountSave(a, b), c)).toEqual(mergeAccountSave(a, mergeAccountSave(b, c)));
      }
    }
  });

  it('the newer write on the line wins, even from a device whose clock is behind', () => {
    const cloud = copy(4, 100, '2026-11-20T12:00:00.000Z');
    const playedOn = nextAccountSave(cloud, saveWith(140, '2026-11-20T09:00:00.000Z'));
    expect(playedOn.seq).toBe(5);
    expect(mergeAccountSave(cloud, playedOn).save!.player.sprouts).toBe(140);
    // No save loses to any save.
    expect(mergeAccountSave({ seq: 9, save: null }, copy(1, 3)).save!.player.sprouts).toBe(3);
  });

  it('reads damaged copies as no save, and keeps a newer build’s save without loading it', () => {
    expect(normalizeAccountSave(null)).toEqual(emptyAccountSave());
    expect(normalizeAccountSave({ seq: 3, save: { schema: 4, player: {} } })).toEqual({ seq: 3, save: null });
    expect(normalizeAccountSave({ seq: -2, save: 'x' })).toEqual({ seq: 0, save: null });
    const future = { schema: SAVE_SCHEMA + 1, savedAt: '2027-01-01T00:00:00.000Z' };
    const kept = normalizeAccountSave({ seq: 6, save: future });
    expect(kept).toEqual({ seq: 6, save: null, future });
    // It survives a round trip through local storage and the cloud, and is not merged away by an older save.
    expect(normalizeAccountSave(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(normalizeAccountSave(accountSaveCloudBody(kept))).toEqual(kept);
    expect(mergeAccountSave(kept, copy(5, 1))).toBe(kept);
  });

  it('the cloud body is small and versioned', () => {
    const body = accountSaveCloudBody(copy(2, 9));
    expect(body.v).toBe(ACCOUNT_SAVE_VERSION);
    expect(body.seq).toBe(2);
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThan(16384);
    expect(accountSaveCloudBody(emptyAccountSave())).toEqual({ v: ACCOUNT_SAVE_VERSION, seq: 0 });
  });
});

describe('the save slot', () => {
  it('outside the hub, is the browser’s own save (sow.save, as before)', () => {
    const storage = new FakeStorage();
    const slot = createSaveSlot({ storage });
    expect(slot.owner()).toBe('device');
    expect(slot.writeSave(saveWith(12))).toBe(true);
    expect(JSON.parse(storage.getItem(SAVE_KEY)!).player.sprouts).toBe(12);
    expect(slot.loadSave().save!.player.sprouts).toBe(12);
    expect(slot.sync()).toBe('local');
    expect(slot.flushOnExit()).toBe(false);
  });

  it('a hub visit loads the account’s cloud save on a new device, and never the browser’s', async () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(saveWith(1)));
    const { cloud, api } = fakeCloud();
    cloud.data = accountSaveCloudBody(copy(7, 250));
    const slot = createSaveSlot({ storage, pushDelayMs: 0 });
    slot.hold();
    expect(slot.owner()).toBe('pending');
    expect(slot.loadSave().save).toBeNull();
    await slot.followHub(account(api));
    expect(slot.owner()).toBe('account');
    expect(slot.sync()).toBe('synced');
    expect(slot.loadSave().save!.player.sprouts).toBe(250);
    // Kept in this browser under the player's own key; the browser save is untouched.
    expect(normalizeAccountSave(JSON.parse(storage.getItem(`${ACCOUNT_KEY}@player-1`)!)).seq).toBe(7);
    expect(JSON.parse(storage.getItem(SAVE_KEY)!).player.sprouts).toBe(1);
  });

  it('writes go to the account and reach the cloud; another account sees none of it', async () => {
    const storage = new FakeStorage();
    const { cloud, api } = fakeCloud();
    const slot = createSaveSlot({ storage, pushDelayMs: 0 });
    await slot.followHub(account(api));
    expect(slot.loadSave().save).toBeNull();
    expect(slot.writeSave(saveWith(33))).toBe(true);
    await vi.waitFor(() => expect(cloud.puts.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(slot.sync()).toBe('synced'));
    const body = normalizeAccountSave(cloud.data);
    expect(body.seq).toBe(1);
    expect(body.save!.player.sprouts).toBe(33);
    expect(storage.getItem(SAVE_KEY)).toBeNull();

    const other = createSaveSlot({ storage, pushDelayMs: 0 });
    await other.followHub(account(fakeCloud().api, 'player-2'));
    expect(other.loadSave().save).toBeNull();
  });

  it('a save written while signing in goes to the account, or to the browser when the visit is standalone', async () => {
    const storage = new FakeStorage();
    const { cloud, api } = fakeCloud();
    const slot = createSaveSlot({ storage, pushDelayMs: 0 });
    slot.hold();
    slot.writeSave(saveWith(8));
    await slot.followHub(account(api));
    expect(slot.loadSave().save!.player.sprouts).toBe(8);
    await vi.waitFor(() => expect(normalizeAccountSave(cloud.data).save?.player.sprouts).toBe(8));

    const standalone = createSaveSlot({ storage });
    standalone.hold();
    standalone.writeSave(saveWith(9));
    await standalone.followHub(null);
    expect(standalone.owner()).toBe('device');
    expect(JSON.parse(storage.getItem(SAVE_KEY)!).player.sprouts).toBe(9);
  });

  it('an offline cloud keeps the save locally and retries; page exit sends it once with keepalive', async () => {
    const storage = new FakeStorage();
    const { cloud, api } = fakeCloud();
    cloud.fail = Object.assign(new Error('network'), { code: 'network' });
    const slot = createSaveSlot({ storage, pushDelayMs: 0, retryDelayMs: 60_000 });
    const link = account(api);
    await slot.followHub(link);
    expect(slot.sync()).toBe('offline');
    expect(slot.writeSave(saveWith(41))).toBe(true);
    expect(slot.loadSave().save!.player.sprouts).toBe(41);
    expect(link.noteSessionError).toHaveBeenCalled();
    cloud.fail = null;
    expect(slot.flushOnExit()).toBe(true);
    expect(slot.flushOnExit()).toBe(false);
    await vi.waitFor(() => expect(cloud.puts.at(-1)?.keepalive).toBe(true));
    expect(normalizeAccountSave(cloud.data).save!.player.sprouts).toBe(41);
    slot.pageShown();
    // Nothing new is unsynced only after a normal push clears the mark; keepalive leaves it set.
    expect(slot.flushOnExit()).toBe(true);
  });

  it('holds only for a portal ticket or a cached hub session', () => {
    const slot = createSaveSlot({ storage: new FakeStorage() });
    expect(holdForHubVisit(slot, '')).toBe(false);
    expect(slot.owner()).toBe('device');
    expect(holdForHubVisit(slot, '#t=abc')).toBe(true);
    expect(slot.owner()).toBe('pending');
  });
});
