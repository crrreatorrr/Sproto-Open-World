import { beforeEach, describe, expect, it } from 'vitest';
import { KEYS, PAD } from '../../src/input/bindings';
import {
  applyControlPrefs, bindKey, bindPad, clearKey, defaultControlPrefs, loadControlPrefs, sanitizeControlPrefs, saveControlPrefs,
} from '../../src/input/controlPrefs';

describe('control prefs', () => {
  beforeEach(() => applyControlPrefs(defaultControlPrefs()));

  it('rebinding a key used elsewhere swaps the two', () => {
    const r = bindKey(defaultControlPrefs(), 'jump', 0, 'KeyC');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prefs.keys.jump[0]).toBe('KeyC');
    expect(r.prefs.keys.dodge[0]).toBe('Space');
    expect(r.swapped).toBe('dodge');
  });

  it('mouse buttons bind like keys', () => {
    const r = bindKey(defaultControlPrefs(), 'block', 1, 'Mouse1');
    expect(r.ok).toBe(true);
  });

  it('refuses reserved keys and keeps Esc on pause', () => {
    expect(bindKey(defaultControlPrefs(), 'jump', 0, 'Backquote').ok).toBe(false);
    expect(bindKey(defaultControlPrefs(), 'pause', 0, 'KeyP').ok).toBe(false);
    expect(clearKey(defaultControlPrefs(), 'pause', 0).ok).toBe(false);
  });

  it('pad rebinds swap too', () => {
    const r = bindPad(defaultControlPrefs(), 'jump', 'b');
    expect(r.ok && r.prefs.pad.jump[0] === 'b' && r.prefs.pad.dodge[0] === 'a').toBe(true);
  });

  it('apply writes into the live tables in place', () => {
    const jump = KEYS.jump;
    const r = bindKey(defaultControlPrefs(), 'jump', 0, 'KeyJ');
    if (r.ok) applyControlPrefs(r.prefs);
    expect(KEYS.jump).toBe(jump);
    expect(KEYS.jump[0]).toBe('KeyJ');
    expect(PAD.jump).toEqual(['a']);
  });

  it('sanitizes junk and round-trips through storage', () => {
    expect(sanitizeControlPrefs({ keys: { jump: [42, 'Escape'] }, pad: 'x', moveDeadzone: 9 }).moveDeadzone).toBeLessThanOrEqual(0.4);
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const r = bindKey(defaultControlPrefs(), 'light', 1, 'KeyK');
    if (r.ok) saveControlPrefs(r.prefs, storage);
    expect(loadControlPrefs(storage).keys.light[1]).toBe('KeyK');
  });
});
