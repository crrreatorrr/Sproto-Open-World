/**
 * The 99 chord: press 9 twice quickly (`Digit9` or `Numpad9`).
 * App listens and, when this returns true, sends the same `godMode` command as Settings → God mode.
 * The sim never sees the keyboard. Digit9 and Numpad9 are reserved, the way N is for feedback.
 */

/** The second 9 must land within this many milliseconds of the first. */
export const GOD_MODE_CHORD_MS = 450;

export interface DigitChord {
  /** Time of an unmatched first 9, or null. */
  armedAt: number | null;
}

export const freshDigitChord = (): DigitChord => ({ armedAt: null });

/** The fields of a keydown this chord reads. A real KeyboardEvent satisfies it. */
export interface GodKey {
  code: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

/**
 * True when focus is in a field the player is typing in. Those 9s are text, not the chord.
 * Duck-typed so tests can pass a plain object.
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: boolean; contentEditable?: string };
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable === true || el.contentEditable === 'true';
}

/**
 * Note one keydown. True only for the second 9 of a quick pair.
 * A repeat, a modifier, a key that is not 9, or a typing target never completes the pair.
 * Any other key cancels a waiting first 9, so walking between two 9s does not toggle.
 * `blocked` (a controls rebind is capturing the keyboard) ignores the press and leaves the pair alone.
 */
export function godChordPressed(state: DigitChord, key: GodKey, nowMs: number, blocked = false): boolean {
  if (blocked) return false;
  const nine = key.code === 'Digit9' || key.code === 'Numpad9';
  if (key.repeat) {
    if (!nine) state.armedAt = null;
    return false;
  }
  if (isTypingTarget(key.target)) {
    state.armedAt = null;
    return false;
  }
  const modified = !!(key.ctrlKey || key.metaKey || key.altKey || key.shiftKey);
  if (!nine || modified) {
    state.armedAt = null;
    return false;
  }
  const armed = state.armedAt;
  if (armed !== null && nowMs >= armed && nowMs - armed <= GOD_MODE_CHORD_MS) {
    state.armedAt = null;
    return true;
  }
  state.armedAt = nowMs;
  return false;
}
