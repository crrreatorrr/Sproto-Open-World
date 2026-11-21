import { beforeEach, describe, expect, it } from 'vitest';
import { GUN_KEYS, GUN_PAD, KEYS, PAD } from '../../src/input/bindings';
import {
  applyControlPrefs, bindGunKey, bindGunPad, bindKey, bindPad, clearGunKey, clearGunPad, clearKey, gunClash, defaultControlPrefs, loadControlPrefs, sanitizeControlPrefs, saveControlPrefs,
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

describe('gun control prefs', () => {
  beforeEach(() => applyControlPrefs(defaultControlPrefs()));

  it('the shipped layout has no key or button doing two things with a gun out', () => {
    expect(gunClash(defaultControlPrefs())).toBeNull();
  });

  it('a gun key rebinds, and one used by another gun action swaps', () => {
    const a = bindGunKey(defaultControlPrefs(), 'melee', 0, 'KeyK');
    expect(a.ok && a.prefs.gunKeys.melee[0] === 'KeyK' && a.swapped === null).toBe(true);
    const b = bindGunKey(defaultControlPrefs(), 'reload', 0, 'KeyQ');
    expect(b.ok && b.prefs.gunKeys.reload[0] === 'KeyQ' && b.prefs.gunKeys.melee[0] === 'KeyR' && b.swapped === 'melee').toBe(true);
  });

  it('a gun action may share a key with a staff-only action, not with one both layouts use', () => {
    // Heavy attack (right mouse) is replaced by the gun layout, so fire may sit on it.
    expect(bindGunKey(defaultControlPrefs(), 'grapple', 1, 'Digit5').ok).toBe(true);
    expect(defaultControlPrefs().keys.spell2).toContain('KeyR');
    const jump = bindGunKey(defaultControlPrefs(), 'reload', 0, 'Space');
    expect(jump.ok).toBe(false);
    if (!jump.ok) expect(jump.reason).toMatch(/Jump/);
    // The other way round: a both-layouts action may not take a gun key.
    expect(bindKey(defaultControlPrefs(), 'jump', 1, 'KeyR').ok).toBe(false);
    expect(bindPad(defaultControlPrefs(), 'jump', 'x').ok).toBe(false);
    // A staff-only action still may.
    expect(bindKey(defaultControlPrefs(), 'block', 1, 'KeyG').ok).toBe(true);
  });

  it('reserved keys are refused, except Tab where it ships', () => {
    expect(bindGunKey(defaultControlPrefs(), 'reload', 0, 'Tab').ok).toBe(false);
    expect(bindGunKey(defaultControlPrefs(), 'swapWeapon', 1, 'KeyU').ok).toBe(true);
    expect(sanitizeControlPrefs({ gunKeys: { swapWeapon: ['Tab', ''] } }).gunKeys.swapWeapon[0]).toBe('Tab');
    expect(clearGunKey(defaultControlPrefs(), 'reload', 0).ok).toBe(false);
  });

  it('gun pad buttons swap, optional ones can be empty, and shared buttons are refused', () => {
    const r = bindGunPad(defaultControlPrefs(), 'fire', 'lt');
    expect(r.ok && r.prefs.gunPad.fire[0] === 'lt' && r.prefs.gunPad.aim[0] === 'rt' && r.swapped === 'aim').toBe(true);
    expect(bindGunPad(defaultControlPrefs(), 'reload', 'a').ok).toBe(false);
    const g = bindGunPad(defaultControlPrefs(), 'grapple', 'l1');
    expect(g.ok).toBe(false);
    const dash = bindGunPad(defaultControlPrefs(), 'dash', 'left');
    expect(dash.ok && dash.prefs.gunPad.dash[0] === 'left').toBe(true);
    if (!dash.ok) return;
    // Taking fire's button for an empty action is refused: fire would have none.
    expect(bindGunPad(defaultControlPrefs(), 'slide', 'rt').ok).toBe(false);
    const cleared = clearGunPad(dash.prefs, 'dash');
    expect(cleared.ok && cleared.prefs.gunPad.dash.length === 0).toBe(true);
    expect(clearGunPad(defaultControlPrefs(), 'fire').ok).toBe(false);
  });

  it('applies in place, survives storage, and keeps a cleared optional button cleared', () => {
    const fire = GUN_KEYS.fire;
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let p = defaultControlPrefs();
    const a = bindGunKey(p, 'fire', 0, 'KeyK');
    if (a.ok) p = a.prefs;
    const b = bindGunPad(p, 'melee', 'left');
    if (b.ok) p = b.prefs;
    saveControlPrefs(p, storage);
    const back = loadControlPrefs(storage);
    applyControlPrefs(back);
    expect(GUN_KEYS.fire).toBe(fire);
    expect(GUN_KEYS.fire).toEqual(['KeyK']);
    expect(GUN_PAD.melee).toEqual(['left']);
    expect(back.gunPad.grapple).toEqual([]);
    expect(GUN_KEYS.toggleView).toEqual(['KeyB']);
  });

  it('an old save with no gun layout gets the shipped one, giving way to its own keys', () => {
    const old = defaultControlPrefs();
    const saved = { keys: { ...old.keys, jump: ['KeyG', ''] }, pad: old.pad };
    const p = sanitizeControlPrefs(saved);
    expect(p.keys.jump[0]).toBe('KeyG');
    expect(p.gunKeys.grapple).toEqual(['', '']);
    expect(p.gunKeys.reload[0]).toBe('KeyR');
    expect(gunClash(p)).toBeNull();
  });
});
