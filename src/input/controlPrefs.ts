import { GAMEPAD, KEYS, PAD } from './bindings';
import { PAD_BUTTONS, type PadButton } from './Gamepad';
import { keyLabel } from './glyphs';

/**
 * Controller settings, ported from sproto-duel `src/input/controlPrefs.ts`: the player's keyboard
 * and gamepad bindings and the left-stick dead zone, saved per browser and applied to the input
 * layer only (input/bindings.ts, in place). The sim never reads them; it only gets commands.
 */

export const KEY_ACTIONS = Object.keys(KEYS) as (keyof typeof KEYS)[];
export const PAD_ACTIONS = Object.keys(PAD) as (keyof typeof PAD)[];
export type KeyAction = keyof typeof KEYS;
export type PadAction = keyof typeof PAD;
export type ControlAction = KeyAction | PadAction;

/** Names on the controls screen. */
export const ACTION_LABELS: Record<ControlAction, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  sprint: 'Sprint',
  jump: 'Jump',
  dodge: 'Dodge roll',
  light: 'Light attack',
  heavy: 'Heavy attack',
  block: 'Block / parry',
  lock: 'Lock on',
  spell1: 'Spell 1',
  spell2: 'Spell 2',
  spell3: 'Spell 3',
  spell4: 'Spell 4',
  spellModifier: 'Spell modifier (hold)',
  interact: 'Interact',
  potion: 'Potion',
  callMount: 'Call the Pepe Bull',
  questLog: 'Quest log',
  inventory: 'Gear',
  pause: 'Pause',
};

/** Keyboard slots per action: a main key and an alternate. */
export const KEY_SLOTS = 2;


/**
 * Keys that keep a fixed job and cannot be bound: Esc (pause, back), Enter (menus), ` (debug
 * overlay), N (N twice opens the hub feedback window, which takes the key from the game) and the
 * browser's own keys.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'Escape', 'Enter', 'NumpadEnter', 'Backquote', 'KeyN', 'Tab', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu', 'CapsLock',
]);
/** Why a reserved key is reserved, for the controls screen's note. */
export function reservedReason(code: string): string {
  switch (code) {
    case 'Escape': return 'Esc pauses and backs out of menus';
    case 'Enter': case 'NumpadEnter': return 'Enter is the menu key';
    case 'Backquote': return '` opens the debug overlay';
    case 'KeyN': return 'N twice sends feedback';
    default: return 'the browser uses it';
  }
}
/** Pad buttons that can be bound (Home belongs to the system). */
export const BINDABLE_PAD: readonly PadButton[] = PAD_BUTTONS.filter((b) => b !== 'home');
/** The pause action's first key is always Esc (shown, never rebound). */
const LOCKED_KEY: Partial<Record<KeyAction, string>> = { pause: 'Escape' };

/** Left-stick dead zone range on the slider. */
export const DEADZONE_MIN = 0.05;
export const DEADZONE_MAX = 0.4;

export interface ControlPrefs {
  /** Per action: slot 0 is the main key, slot 1 the alternate ('' = empty). Always KEY_SLOTS long. */
  keys: Record<KeyAction, string[]>;
  /** Per action: the pad button(s). */
  pad: Record<PadAction, string[]>;
  /** Left-stick radial dead zone (GAMEPAD.deadzone.move). */
  moveDeadzone: number;
}

export const CONTROLS_STORAGE_KEY = 'sow.controls';

const controlsTable = KEYS as Record<KeyAction, string[]>;
const padTable = PAD as Record<PadAction, string[]>;

// The shipped layout, copied before any saved prefs are applied.
const DEFAULT_KEYS = Object.fromEntries(KEY_ACTIONS.map((a) => [a, [...controlsTable[a]]])) as Record<KeyAction, string[]>;
const DEFAULT_PAD = Object.fromEntries(PAD_ACTIONS.map((a) => [a, [...padTable[a]]])) as Record<PadAction, string[]>;
const DEFAULT_DEADZONE = GAMEPAD.deadzone.move;

const slots = (codes: readonly string[]): string[] => Array.from({ length: KEY_SLOTS }, (_, i) => codes[i] ?? '');

export function defaultControlPrefs(): ControlPrefs {
  return {
    keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a, slots(DEFAULT_KEYS[a])])) as Record<KeyAction, string[]>,
    pad: Object.fromEntries(PAD_ACTIONS.map((a) => [a, [...DEFAULT_PAD[a]]])) as Record<PadAction, string[]>,
    moveDeadzone: DEFAULT_DEADZONE,
  };
}

export function cloneControlPrefs(p: ControlPrefs): ControlPrefs {
  return {
    keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a, [...p.keys[a]]])) as Record<KeyAction, string[]>,
    pad: Object.fromEntries(PAD_ACTIONS.map((a) => [a, [...p.pad[a]]])) as Record<PadAction, string[]>,
    moveDeadzone: p.moveDeadzone,
  };
}

const clampDeadzone = (v: number) => Math.min(DEADZONE_MAX, Math.max(DEADZONE_MIN, v));
const isKeyCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(c);

/**
 * Turn whatever was saved into valid prefs: unknown actions and malformed codes are dropped, a
 * key or button used twice keeps its first action, an action left with nothing falls back to its
 * default (when that is free), and Esc stays on pause.
 */
export function sanitizeControlPrefs(raw: unknown): ControlPrefs {
  const out = defaultControlPrefs();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { keys?: unknown; pad?: unknown; moveDeadzone?: unknown };
  if (r.keys && typeof r.keys === 'object') {
    const seen = new Set<string>();
    const saved = r.keys as Record<string, unknown>;
    for (const a of KEY_ACTIONS) {
      const list = Array.isArray(saved[a]) ? (saved[a] as unknown[]) : null;
      if (!list) {
        out.keys[a] = slots(DEFAULT_KEYS[a]);
      } else {
        out.keys[a] = slots(list.slice(0, KEY_SLOTS).map((c) => (isKeyCode(c) && !RESERVED_KEYS.has(c) ? c : '')));
      }
      const locked = LOCKED_KEY[a];
      if (locked) out.keys[a][0] = locked;
      out.keys[a] = out.keys[a].map((c) => {
        if (!c || c === locked) return c;
        if (seen.has(c)) return '';
        seen.add(c);
        return c;
      });
    }
    // Nothing left on an action: its default keys, where nobody took them.
    for (const a of KEY_ACTIONS) {
      if (out.keys[a].some(Boolean)) continue;
      const free = DEFAULT_KEYS[a].filter((c) => !seen.has(c));
      free.forEach((c) => seen.add(c));
      out.keys[a] = slots(free);
    }
  }
  if (r.pad && typeof r.pad === 'object') {
    const seen = new Set<string>();
    const saved = r.pad as Record<string, unknown>;
    for (const a of PAD_ACTIONS) {
      const list = Array.isArray(saved[a]) ? (saved[a] as unknown[]) : DEFAULT_PAD[a];
      out.pad[a] = list.filter((b): b is string => typeof b === 'string' && (BINDABLE_PAD as readonly string[]).includes(b) && !seen.has(b)).slice(0, 2);
      out.pad[a].forEach((b) => seen.add(b));
    }
    for (const a of PAD_ACTIONS) {
      if (out.pad[a].length) continue;
      out.pad[a] = DEFAULT_PAD[a].filter((b) => !seen.has(b));
      out.pad[a].forEach((b) => seen.add(b));
    }
  }
  if (typeof r.moveDeadzone === 'number' && Number.isFinite(r.moveDeadzone)) out.moveDeadzone = clampDeadzone(r.moveDeadzone);
  return out;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadControlPrefs(storage: StorageLike | null = defaultStorage()): ControlPrefs {
  try {
    const raw = storage?.getItem(CONTROLS_STORAGE_KEY);
    if (raw) return sanitizeControlPrefs(JSON.parse(raw));
  } catch {
    // Blocked storage or a broken save: the shipped layout.
  }
  return defaultControlPrefs();
}

export function saveControlPrefs(p: ControlPrefs, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(CONTROLS_STORAGE_KEY, JSON.stringify({ v: 1, ...p }));
  } catch {
    // Not critical: the change still applies for this visit.
  }
}

/** Replace an array's contents, keeping the array (modules hold references to the binding arrays). */
function fill(target: string[], values: readonly string[]): void {
  target.length = 0;
  target.push(...values);
}

/** Make `p` the live layout (input layer only; see the top of this file). */
export function applyControlPrefs(p: ControlPrefs): void {
  for (const a of KEY_ACTIONS) fill(controlsTable[a], p.keys[a].filter(Boolean));
  for (const a of PAD_ACTIONS) fill(padTable[a], p.pad[a]);
  GAMEPAD.deadzone.move = clampDeadzone(p.moveDeadzone);
}

export type BindResult =
  | { ok: true; prefs: ControlPrefs; swapped: ControlAction | null }
  | { ok: false; reason: string };

/**
 * Put key `code` on `action`'s keyboard slot `slot`. When another action already uses the key, the
 * two swap: it takes the key this slot had. If this slot was empty, the other action just loses
 * that key, unless it was its only one (then nothing changes and the result says why).
 */
export function bindKey(p: ControlPrefs, action: KeyAction, slot: number, code: string): BindResult {
  if (slot < 0 || slot >= KEY_SLOTS) return { ok: false, reason: 'No such slot.' };
  if (LOCKED_KEY[action] && slot === 0) return { ok: false, reason: `${keyLabel(LOCKED_KEY[action]!)} always pauses.` };
  if (RESERVED_KEYS.has(code)) return { ok: false, reason: `${keyLabel(code)} can't be bound: ${reservedReason(code)}.` };
  if (!isKeyCode(code)) return { ok: false, reason: 'That key cannot be bound.' };
  const next = cloneControlPrefs(p);
  const old = next.keys[action][slot];
  if (old === code) return { ok: true, prefs: next, swapped: null };
  let swapped: ControlAction | null = null;
  for (const other of KEY_ACTIONS) {
    const j = next.keys[other].indexOf(code);
    if (j < 0) continue;
    if (other === action) {
      // The key is on this action's other slot: swap the two slots.
      next.keys[action][j] = old;
    } else if (old) {
      next.keys[other][j] = old;
      swapped = other;
    } else {
      if (next.keys[other].filter(Boolean).length <= 1) {
        return { ok: false, reason: `${keyLabel(code)} is ${ACTION_LABELS[other]}'s only key. Give ${ACTION_LABELS[other]} another key first.` };
      }
      next.keys[other][j] = '';
      swapped = other;
    }
    break;
  }
  next.keys[action][slot] = code;
  return { ok: true, prefs: next, swapped };
}

/** Empty `action`'s keyboard slot. Refused when it is the action's last key or the locked Esc. */
export function clearKey(p: ControlPrefs, action: KeyAction, slot: number): BindResult {
  if (LOCKED_KEY[action] && slot === 0) return { ok: false, reason: 'Esc always pauses.' };
  const next = cloneControlPrefs(p);
  if (!next.keys[action][slot]) return { ok: true, prefs: next, swapped: null };
  if (next.keys[action].filter(Boolean).length <= 1) return { ok: false, reason: `${ACTION_LABELS[action]} needs at least one key.` };
  next.keys[action][slot] = '';
  return { ok: true, prefs: next, swapped: null };
}

/** Put pad button `button` on `action`. Another action using it swaps: it takes this action's old button. */
export function bindPad(p: ControlPrefs, action: PadAction, button: string): BindResult {
  if (!(BINDABLE_PAD as readonly string[]).includes(button)) return { ok: false, reason: 'That button cannot be bound.' };
  const next = cloneControlPrefs(p);
  const old = next.pad[action];
  if (old.length === 1 && old[0] === button) return { ok: true, prefs: next, swapped: null };
  let swapped: ControlAction | null = null;
  for (const other of PAD_ACTIONS) {
    if (other === action || !next.pad[other].includes(button)) continue;
    const rest = next.pad[other].filter((b) => b !== button);
    next.pad[other] = rest.length ? rest : [...old];
    swapped = other;
  }
  next.pad[action] = [button];
  return { ok: true, prefs: next, swapped };
}
