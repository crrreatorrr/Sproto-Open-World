import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSave, writeSave } from '../../src/save/SaveStore';
import { SAVE_BAK_KEY, SAVE_KEY, type SaveFile } from '../../src/save/schema';

/** M3 acceptance 3 (plan §2.8): one slot, `.bak` keeps the previous good write, corrupt-save fallback. */

/** A Storage stand-in (getItem / setItem over a Map). */
class FakeStorage {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.writes++;
    this.data.set(k, String(v));
  }
}

const v2 = (): SaveFile => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'save-v2.json'), 'utf8'));
const withSprouts = (n: number): SaveFile => {
  const s = v2();
  s.player.sprouts = n;
  return s;
};

describe('SaveStore (M3 acceptance 3)', () => {
  it('round trip: write then load gives the same save, not from the backup', () => {
    const st = new FakeStorage();
    expect(writeSave(v2(), st)).toBe(true);
    expect(loadSave(st)).toEqual({ save: v2(), fromBackup: false, error: null });
  });

  it('the first write has no backup; the second keeps the first as .bak', () => {
    const st = new FakeStorage();
    writeSave(withSprouts(1), st);
    expect(st.getItem(SAVE_BAK_KEY)).toBeNull();
    writeSave(withSprouts(2), st);
    expect(JSON.parse(st.getItem(SAVE_KEY)!).player.sprouts).toBe(2);
    expect(JSON.parse(st.getItem(SAVE_BAK_KEY)!).player.sprouts).toBe(1);
    writeSave(withSprouts(3), st);
    expect(JSON.parse(st.getItem(SAVE_BAK_KEY)!).player.sprouts).toBe(2);
  });

  it('a damaged main save is not copied over a good backup', () => {
    const st = new FakeStorage();
    writeSave(withSprouts(1), st);
    writeSave(withSprouts(2), st);
    st.setItem(SAVE_KEY, '{"schema": 2, "pla');
    writeSave(withSprouts(3), st);
    expect(JSON.parse(st.getItem(SAVE_BAK_KEY)!).player.sprouts).toBe(1);
    expect(JSON.parse(st.getItem(SAVE_KEY)!).player.sprouts).toBe(3);
  });

  const corruptions: [string, string, RegExp][] = [
    ['bad JSON', '{"schema": 2, "player": {', /not valid JSON/],
    ['missing fields', JSON.stringify({ schema: 2, savedAt: 'x', build: 'b', region: 'r', player: { level: 1 }, world: {} }), /missing fields/],
    ['not an object', '"hello"', /not an object/],
    ['no schema', JSON.stringify({ player: {}, world: {} }), /schema/],
    ['a newer build', JSON.stringify({ ...v2(), schema: 99 }), /newer/],
  ];
  for (const [name, raw, why] of corruptions) {
    it(`corrupt main (${name}) → loads .bak with fromBackup and an error message`, () => {
      const st = new FakeStorage();
      writeSave(withSprouts(1), st);
      writeSave(withSprouts(2), st);
      st.setItem(SAVE_KEY, raw);
      const r = loadSave(st);
      expect(r.fromBackup).toBe(true);
      expect(r.save!.player.sprouts).toBe(1);
      expect(r.error).toMatch(/damaged/);
      expect(r.error).toMatch(why);
    });
  }

  it('a v1 backup is migrated when it is the one used', () => {
    const st = new FakeStorage();
    st.setItem(SAVE_BAK_KEY, fs.readFileSync(path.join(__dirname, 'fixtures', 'save-v1.json'), 'utf8'));
    st.setItem(SAVE_KEY, 'garbage');
    const r = loadSave(st);
    expect(r.fromBackup).toBe(true);
    expect(r.save!.schema).toBe(2);
    expect(r.save!.player.tonics).toEqual({ charges: 2, max: 3 });
  });

  it('main and backup both bad → null, with an error naming both', () => {
    const st = new FakeStorage();
    st.setItem(SAVE_KEY, '{oops');
    st.setItem(SAVE_BAK_KEY, JSON.stringify({ schema: 2 }));
    const r = loadSave(st);
    expect(r.save).toBeNull();
    expect(r.fromBackup).toBe(false);
    expect(r.error).toMatch(/not valid JSON/);
    expect(r.error).toMatch(/backup unusable/);
  });

  it('damaged main and no backup → null, with an error', () => {
    const st = new FakeStorage();
    st.setItem(SAVE_KEY, '{oops');
    const r = loadSave(st);
    expect(r.save).toBeNull();
    expect(r.error).toMatch(/damaged/);
  });

  it('no save at all → null without an error (a new game)', () => {
    expect(loadSave(new FakeStorage())).toEqual({ save: null, fromBackup: false, error: null });
  });

  it('blocked storage (null) → no crash: load returns nothing, write is skipped', () => {
    expect(loadSave(null)).toEqual({ save: null, fromBackup: false, error: null });
    expect(writeSave(v2(), null)).toBe(false);
  });

  it('storage that throws on write (full or private mode) → writeSave returns false, no crash', () => {
    const st = new FakeStorage();
    writeSave(withSprouts(1), st);
    st.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(writeSave(withSprouts(2), st)).toBe(false);
    expect(loadSave(st).save!.player.sprouts).toBe(1);
  });

  /**
   * SIM/SAVE BUG (minor; SaveStore.ts doc + plan §2.8: "Storage can be blocked (private mode):
   * loading then returns nothing"): loadSave catches a throwing getItem inside read(), then calls
   * storage.getItem(SAVE_KEY) again outside any try to decide `hadMain`, so a storage whose reads
   * throw (a SecurityError) crashes the load instead of returning nothing.
   */
  it('storage that throws on read → loadSave returns nothing, no crash', () => {
    const st = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(() => loadSave(st)).not.toThrow();
    expect(loadSave(st).save).toBeNull();
  });

  it('a save survives a JSON round trip unchanged (what the sim writes is what it reads)', () => {
    const st = new FakeStorage();
    const s = v2();
    writeSave(s, st);
    writeSave(s, st);
    expect(loadSave(st).save).toEqual(s);
    expect(JSON.parse(st.getItem(SAVE_BAK_KEY)!)).toEqual(s);
  });
});
