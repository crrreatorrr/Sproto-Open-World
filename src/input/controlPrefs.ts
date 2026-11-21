import { GAMEPAD, GUN_KEYS, GUN_PAD, KEYS, PAD } from './bindings';
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

/**
 * The gun layout's own actions (bindings.ts `GUN_KEYS` / `GUN_PAD`), shown under their own heading
 * on the controls screen. The first-person toggle is left out: the game is third person only.
 */
export type GunKeyAction = Exclude<keyof typeof GUN_KEYS, 'toggleView'>;
export type GunPadAction = Exclude<keyof typeof GUN_PAD, 'toggleView'>;
export const GUN_KEY_ACTIONS = (Object.keys(GUN_KEYS) as (keyof typeof GUN_KEYS)[]).filter((a): a is GunKeyAction => a !== 'toggleView');
export const GUN_PAD_ACTIONS = (Object.keys(GUN_PAD) as (keyof typeof GUN_PAD)[]).filter((a): a is GunPadAction => a !== 'toggleView');
export type GunAction = GunKeyAction | GunPadAction;

export const GUN_ACTION_LABELS: Record<GunAction, string> = {
  fire: 'Fire (two guns: left gun)',
  aim: 'Zoom (two guns: right gun)',
  melee: 'Melee (hold: heavy)',
  spell1: 'Spell 1',
  spell2: 'Spell 2',
  spell3: 'Spell 3',
  spell4: 'Spell 4',
  spellModifier: 'Spell modifier (hold)',
  reload: 'Reload',
  swapWeapon: 'Next weapon',
  grapple: 'Grapple',
  slide: 'Slide',
  dash: 'Dash',
  slot1: 'Weapon slot 1',
  slot2: 'Weapon slot 2',
  slot3: 'Weapon slot 3',
  slot4: 'Weapon slot 4',
};

/**
 * The staff layout's actions that the gun layout replaces. Only these may share a key or button
 * with a gun action: everything else works in both layouts, so it must not.
 */
const STAFF_ONLY_KEYS: ReadonlySet<string> = new Set(['light', 'heavy', 'block', 'spell1', 'spell2', 'spell3', 'spell4']);
const STAFF_ONLY_PAD: ReadonlySet<string> = new Set(['light', 'heavy', 'block', 'spellModifier']);
/** Gun pad actions that may have no button (grapple then falls back to modifier + melee). */
export const GUN_PAD_OPTIONAL: ReadonlySet<GunPadAction> = new Set<GunPadAction>(['grapple', 'slide', 'dash']);

/** Keyboard slots per action: a main key and an alternate. */
export const KEY_SLOTS = 2;


/**
 * Keys that keep a fixed job and cannot be bound: Esc (pause, back), Enter (menus), ` (debug
 * overlay), N (N twice opens the hub feedback window, which takes the key from the game), 9 (9 twice
 * toggles testing God Mode) and the browser's own keys.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'Escape', 'Enter', 'NumpadEnter', 'Backquote', 'KeyN', 'Digit9', 'Numpad9', 'Tab', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu', 'CapsLock',
]);
/** Why a reserved key is reserved, for the controls screen's note. */
export function reservedReason(code: string): string {
  switch (code) {
    case 'Escape': return 'Esc pauses and backs out of menus';
    case 'Enter': case 'NumpadEnter': return 'Enter is the menu key';
    case 'Backquote': return '` opens the debug overlay';
    case 'KeyN': return 'N twice sends feedback';
    case 'Digit9': case 'Numpad9': return '9 twice toggles god mode';
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
  /** The gun layout's keys, in the same two slots. */
  gunKeys: Record<GunKeyAction, string[]>;
  /** The gun layout's pad buttons (the optional ones may be empty). */
  gunPad: Record<GunPadAction, string[]>;
  /** Left-stick radial dead zone (GAMEPAD.deadzone.move). */
  moveDeadzone: number;
}

export const CONTROLS_STORAGE_KEY = 'sow.controls';

const controlsTable = KEYS as Record<KeyAction, string[]>;
const padTable = PAD as Record<PadAction, string[]>;

// The shipped layout, copied before any saved prefs are applied.
const DEFAULT_KEYS = Object.fromEntries(KEY_ACTIONS.map((a) => [a, [...controlsTable[a]]])) as Record<KeyAction, string[]>;
const DEFAULT_PAD = Object.fromEntries(PAD_ACTIONS.map((a) => [a, [...padTable[a]]])) as Record<PadAction, string[]>;
const gunKeyTable = GUN_KEYS as Record<GunKeyAction, string[]>;
const gunPadTable = GUN_PAD as Record<GunPadAction, string[]>;
const DEFAULT_GUN_KEYS = Object.fromEntries(GUN_KEY_ACTIONS.map((a) => [a, [...gunKeyTable[a]]])) as Record<GunKeyAction, string[]>;
const DEFAULT_GUN_PAD = Object.fromEntries(GUN_PAD_ACTIONS.map((a) => [a, [...gunPadTable[a]]])) as Record<GunPadAction, string[]>;
const DEFAULT_DEADZONE = GAMEPAD.deadzone.move;

const slots = (codes: readonly string[]): string[] => Array.from({ length: KEY_SLOTS }, (_, i) => codes[i] ?? '');

export function defaultControlPrefs(): ControlPrefs {
  return {
    keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a, slots(DEFAULT_KEYS[a])])) as Record<KeyAction, string[]>,
    pad: Object.fromEntries(PAD_ACTIONS.map((a) => [a, [...DEFAULT_PAD[a]]])) as Record<PadAction, string[]>,
    gunKeys: Object.fromEntries(GUN_KEY_ACTIONS.map((a) => [a, slots(DEFAULT_GUN_KEYS[a])])) as Record<GunKeyAction, string[]>,
    gunPad: Object.fromEntries(GUN_PAD_ACTIONS.map((a) => [a, [...DEFAULT_GUN_PAD[a]]])) as Record<GunPadAction, string[]>,
    moveDeadzone: DEFAULT_DEADZONE,
  };
}

export function cloneControlPrefs(p: ControlPrefs): ControlPrefs {
  return {
    keys: Object.fromEntries(KEY_ACTIONS.map((a) => [a, [...p.keys[a]]])) as Record<KeyAction, string[]>,
    pad: Object.fromEntries(PAD_ACTIONS.map((a) => [a, [...p.pad[a]]])) as Record<PadAction, string[]>,
    gunKeys: Object.fromEntries(GUN_KEY_ACTIONS.map((a) => [a, [...p.gunKeys[a]]])) as Record<GunKeyAction, string[]>,
    gunPad: Object.fromEntries(GUN_PAD_ACTIONS.map((a) => [a, [...p.gunPad[a]]])) as Record<GunPadAction, string[]>,
    moveDeadzone: p.moveDeadzone,
  };
}

const clampDeadzone = (v: number) => Math.min(DEADZONE_MAX, Math.max(DEADZONE_MIN, v));
const isKeyCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(c);
/** A reserved key is still fine where the shipped gun layout puts it (Tab on Next weapon). */
const gunKeyAllowed = (a: GunKeyAction, c: string) => !RESERVED_KEYS.has(c) || DEFAULT_GUN_KEYS[a].includes(c);

/** Keys and buttons of the actions that work in both layouts: a gun action may not take them. */
function sharedKeys(p: ControlPrefs): Map<string, KeyAction> {
  const m = new Map<string, KeyAction>();
  for (const a of KEY_ACTIONS) if (!STAFF_ONLY_KEYS.has(a)) for (const c of p.keys[a]) if (c) m.set(c, a);
  return m;
}
function sharedPad(p: ControlPrefs): Map<string, PadAction> {
  const m = new Map<string, PadAction>();
  for (const a of PAD_ACTIONS) if (!STAFF_ONLY_PAD.has(a)) for (const b of p.pad[a]) m.set(b, a);
  return m;
}

/**
 * Why `p` cannot be used: a key or button would do two things at once with a gun in hand. Null when
 * the layout is fine.
 */
export function gunClash(p: ControlPrefs): string | null {
  const keys = sharedKeys(p);
  for (const g of GUN_KEY_ACTIONS) {
    for (const c of p.gunKeys[g]) {
      const a = c ? keys.get(c) : undefined;
      if (a) return `${keyLabel(c)} would be both ${ACTION_LABELS[a]} and ${GUN_ACTION_LABELS[g]} with a gun in hand. Move one of them first.`;
    }
  }
  const pad = sharedPad(p);
  for (const g of GUN_PAD_ACTIONS) {
    for (const b of p.gunPad[g]) {
      const a = pad.get(b);
      if (a) return `${b.toUpperCase()} would be both ${ACTION_LABELS[a]} and ${GUN_ACTION_LABELS[g]} with a gun in hand. Move one of them first.`;
    }
  }
  return null;
}

/**
 * Turn whatever was saved into valid prefs: unknown actions and malformed codes are dropped, a
 * key or button used twice keeps its first action, an action left with nothing falls back to its
 * default (when that is free), and Esc stays on pause.
 */
export function sanitizeControlPrefs(raw: unknown): ControlPrefs {
  const out = defaultControlPrefs();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { keys?: unknown; pad?: unknown; gunKeys?: unknown; gunPad?: unknown; moveDeadzone?: unknown };
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
  // The gun layout: the same cleaning, and it gives way to the keys and buttons both layouts use.
  {
    const taken = sharedKeys(out);
    const seen = new Set<string>();
    const saved = (r.gunKeys && typeof r.gunKeys === 'object' ? r.gunKeys : {}) as Record<string, unknown>;
    for (const a of GUN_KEY_ACTIONS) {
      const list = Array.isArray(saved[a]) ? (saved[a] as unknown[]).slice(0, KEY_SLOTS) : DEFAULT_GUN_KEYS[a];
      out.gunKeys[a] = slots(list.map((c) => {
        if (!isKeyCode(c) || !gunKeyAllowed(a, c) || taken.has(c) || seen.has(c)) return '';
        seen.add(c);
        return c;
      }));
    }
    for (const a of GUN_KEY_ACTIONS) {
      if (out.gunKeys[a].some(Boolean)) continue;
      const free = DEFAULT_GUN_KEYS[a].filter((c) => !seen.has(c) && !taken.has(c));
      free.forEach((c) => seen.add(c));
      out.gunKeys[a] = slots(free);
    }
  }
  {
    const taken = sharedPad(out);
    const seen = new Set<string>();
    const saved = (r.gunPad && typeof r.gunPad === 'object' ? r.gunPad : {}) as Record<string, unknown>;
    const given = new Set<GunPadAction>();
    for (const a of GUN_PAD_ACTIONS) {
      if (Array.isArray(saved[a])) given.add(a);
      const list = Array.isArray(saved[a]) ? (saved[a] as unknown[]) : DEFAULT_GUN_PAD[a];
      out.gunPad[a] = list.filter((b): b is string => typeof b === 'string' && (BINDABLE_PAD as readonly string[]).includes(b) && !taken.has(b) && !seen.has(b)).slice(0, 2);
      out.gunPad[a].forEach((b) => seen.add(b));
    }
    for (const a of GUN_PAD_ACTIONS) {
      if (out.gunPad[a].length || (GUN_PAD_OPTIONAL.has(a) && given.has(a))) continue;
      out.gunPad[a] = DEFAULT_GUN_PAD[a].filter((b) => !seen.has(b) && !taken.has(b));
      out.gunPad[a].forEach((b) => seen.add(b));
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
  for (const a of GUN_KEY_ACTIONS) fill(gunKeyTable[a], p.gunKeys[a].filter(Boolean));
  for (const a of GUN_PAD_ACTIONS) fill(gunPadTable[a], p.gunPad[a]);
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
  const clash = gunClash(next);
  if (clash) return { ok: false, reason: clash };
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
  const clash = gunClash(next);
  if (clash) return { ok: false, reason: clash };
  return { ok: true, prefs: next, swapped };
}

export type GunBindResult =
  | { ok: true; prefs: ControlPrefs; swapped: GunAction | null }
  | { ok: false; reason: string };

/** `bindKey` for the gun layout: keys swap among the gun actions, and may not take a key both layouts use. */
export function bindGunKey(p: ControlPrefs, action: GunKeyAction, slot: number, code: string): GunBindResult {
  if (slot < 0 || slot >= KEY_SLOTS) return { ok: false, reason: 'No such slot.' };
  if (!gunKeyAllowed(action, code)) return { ok: false, reason: `${keyLabel(code)} can't be bound: ${reservedReason(code)}.` };
  if (!isKeyCode(code)) return { ok: false, reason: 'That key cannot be bound.' };
  const next = cloneControlPrefs(p);
  const old = next.gunKeys[action][slot];
  if (old === code) return { ok: true, prefs: next, swapped: null };
  let swapped: GunAction | null = null;
  for (const other of GUN_KEY_ACTIONS) {
    const j = next.gunKeys[other].indexOf(code);
    if (j < 0) continue;
    if (other === action) next.gunKeys[action][j] = old;
    else if (old && gunKeyAllowed(other, old)) {
      next.gunKeys[other][j] = old;
      swapped = other;
    } else {
      if (next.gunKeys[other].filter(Boolean).length <= 1) {
        return { ok: false, reason: `${keyLabel(code)} is ${GUN_ACTION_LABELS[other]}'s only key. Give ${GUN_ACTION_LABELS[other]} another key first.` };
      }
      next.gunKeys[other][j] = '';
      swapped = other;
    }
    break;
  }
  next.gunKeys[action][slot] = code;
  const clash = gunClash(next);
  if (clash) return { ok: false, reason: clash };
  return { ok: true, prefs: next, swapped };
}

/** Empty a gun action's keyboard slot. Refused when it is the action's last key. */
export function clearGunKey(p: ControlPrefs, action: GunKeyAction, slot: number): GunBindResult {
  const next = cloneControlPrefs(p);
  if (!next.gunKeys[action][slot]) return { ok: true, prefs: next, swapped: null };
  if (next.gunKeys[action].filter(Boolean).length <= 1) return { ok: false, reason: `${GUN_ACTION_LABELS[action]} needs at least one key.` };
  next.gunKeys[action][slot] = '';
  return { ok: true, prefs: next, swapped: null };
}

/** `bindPad` for the gun layout. Another gun action using the button takes this action's old one. */
export function bindGunPad(p: ControlPrefs, action: GunPadAction, button: string): GunBindResult {
  if (!(BINDABLE_PAD as readonly string[]).includes(button)) return { ok: false, reason: 'That button cannot be bound.' };
  const next = cloneControlPrefs(p);
  const old = next.gunPad[action];
  if (old.length === 1 && old[0] === button) return { ok: true, prefs: next, swapped: null };
  let swapped: GunAction | null = null;
  for (const other of GUN_PAD_ACTIONS) {
    if (other === action || !next.gunPad[other].includes(button)) continue;
    const rest = next.gunPad[other].filter((b) => b !== button);
    if (!rest.length && !old.length && !GUN_PAD_OPTIONAL.has(other)) {
      return { ok: false, reason: `${button.toUpperCase()} is ${GUN_ACTION_LABELS[other]}'s only button. Give ${GUN_ACTION_LABELS[other]} another button first.` };
    }
    next.gunPad[other] = rest.length ? rest : [...old];
    swapped = other;
  }
  next.gunPad[action] = [button];
  const clash = gunClash(next);
  if (clash) return { ok: false, reason: clash };
  return { ok: true, prefs: next, swapped };
}

/** Take the button off an optional gun action (grapple, slide, dash). */
export function clearGunPad(p: ControlPrefs, action: GunPadAction): GunBindResult {
  if (!GUN_PAD_OPTIONAL.has(action)) return { ok: false, reason: `${GUN_ACTION_LABELS[action]} needs a button.` };
  const next = cloneControlPrefs(p);
  next.gunPad[action] = [];
  return { ok: true, prefs: next, swapped: null };
}
