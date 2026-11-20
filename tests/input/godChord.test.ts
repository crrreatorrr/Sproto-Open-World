import { describe, expect, it } from 'vitest';
import { KEYS, PAD } from '../../src/input/bindings';
import { RESERVED_KEYS, bindKey, defaultControlPrefs, reservedReason } from '../../src/input/controlPrefs';
import { GOD_MODE_CHORD_MS, freshDigitChord, godChordPressed, isTypingTarget, type GodKey } from '../../src/input/godChord';

const key = (code: string, over: Partial<GodKey> = {}): GodKey => ({ code, ...over });

describe('99 God Mode chord', () => {
  it('leaves Digit9 and Numpad9 off every gameplay binding, and reserved like N', () => {
    for (const codes of Object.values(KEYS)) {
      expect(codes).not.toContain('Digit9');
      expect(codes).not.toContain('Numpad9');
    }
    for (const codes of Object.values(PAD)) expect(codes.join(' ')).not.toMatch(/\b9\b/);
    expect(RESERVED_KEYS.has('Digit9')).toBe(true);
    expect(RESERVED_KEYS.has('Numpad9')).toBe(true);
    expect(reservedReason('Digit9')).toBe('9 twice toggles god mode');
    expect(bindKey(defaultControlPrefs(), 'jump', 1, 'Digit9').ok).toBe(false);
    expect(bindKey(defaultControlPrefs(), 'spell1', 1, 'Numpad9').ok).toBe(false);
  });

  it('fires on the second 9 inside the window, including a mixed numpad pair, and not on one 9', () => {
    const s = freshDigitChord();
    expect(godChordPressed(s, key('Digit9'), 1_000)).toBe(false);
    expect(godChordPressed(s, key('Numpad9'), 1_000 + GOD_MODE_CHORD_MS)).toBe(true);
    expect(s.armedAt).toBeNull();
  });

  it('a 9 just outside the window starts a new pair instead of firing', () => {
    const s = freshDigitChord();
    expect(godChordPressed(s, key('Digit9'), 0)).toBe(false);
    expect(godChordPressed(s, key('Digit9'), GOD_MODE_CHORD_MS + 1)).toBe(false);
    expect(godChordPressed(s, key('Digit9'), GOD_MODE_CHORD_MS + 1 + 100)).toBe(true);
  });

  it('three quick 9s are one pair, and a fourth completes the next', () => {
    const s = freshDigitChord();
    expect(godChordPressed(s, key('Digit9'), 0)).toBe(false);
    expect(godChordPressed(s, key('Digit9'), 100)).toBe(true);
    expect(godChordPressed(s, key('Digit9'), 150)).toBe(false);
    expect(godChordPressed(s, key('Digit9'), 200)).toBe(true);
  });

  it('holding 9 does not complete the pair, and another key between the two 9s cancels it', () => {
    const held = freshDigitChord();
    expect(godChordPressed(held, key('Digit9'), 0)).toBe(false);
    expect(godChordPressed(held, key('Digit9', { repeat: true }), 40)).toBe(false);
    expect(godChordPressed(held, key('Digit9', { repeat: true }), 80)).toBe(false);
    expect(godChordPressed(held, key('Digit9'), 120)).toBe(true);

    const walk = freshDigitChord();
    expect(godChordPressed(walk, key('Digit9'), 0)).toBe(false);
    expect(godChordPressed(walk, key('KeyW'), 50)).toBe(false);
    expect(godChordPressed(walk, key('Digit9'), 80)).toBe(false);
    expect(godChordPressed(walk, key('Digit9'), 100)).toBe(true);
  });

  it('ignores 9s while typing, with a modifier, or while a rebind is capturing keys', () => {
    const input = { tagName: 'INPUT' };
    const area = { tagName: 'textarea' };
    const editable = { isContentEditable: true };
    const button = { tagName: 'BUTTON' };
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget({ contentEditable: 'true' })).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);

    const typing = freshDigitChord();
    expect(godChordPressed(typing, key('Digit9'), 0)).toBe(false);
    expect(godChordPressed(typing, key('Digit9', { target: input }), 100)).toBe(false);
    expect(godChordPressed(typing, key('Digit9'), 150)).toBe(false);

    const shifted = freshDigitChord();
    expect(godChordPressed(shifted, key('Digit9', { shiftKey: true }), 0)).toBe(false);
    expect(godChordPressed(shifted, key('Digit9'), 50)).toBe(false);

    const captured = freshDigitChord();
    expect(godChordPressed(captured, key('Digit9'), 0, true)).toBe(false);
    expect(godChordPressed(captured, key('Digit9'), 40, true)).toBe(false);
    expect(captured.armedAt).toBeNull();
    expect(godChordPressed(captured, key('Digit9', { target: button }), 0)).toBe(false);
    expect(godChordPressed(captured, key('Digit9', { target: button }), 40)).toBe(true);
  });
});
