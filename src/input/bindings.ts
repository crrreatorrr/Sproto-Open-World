/**
 * The live control layout and controller tuning. Arrays keep their identity: controlPrefs writes
 * into them in place, so every reader sees a rebind on its next frame. The sim never reads this;
 * it only receives commands.
 *
 * Keyboard codes are `KeyboardEvent.code`; mouse buttons are `Mouse0` (left), `Mouse1` (middle)
 * and `Mouse2` (right) so they can be rebound like keys. Pad buttons use the W3C standard layout
 * names (positional: `a` is the bottom face button on every pad).
 */
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft'],
  jump: ['Space'],
  dodge: ['KeyC'],
  light: ['Mouse0'],
  heavy: ['Mouse2'],
  block: ['KeyQ'],
  lock: ['Mouse1', 'KeyT'],
  spell1: ['Digit1', 'KeyE'],
  // Digit9 and Numpad9 stay unbound: pressed twice quickly they toggle testing God Mode.
  spell2: ['Digit2', 'KeyR'],
  spell3: ['Digit3', 'KeyZ'],
  spell4: ['Digit4', 'KeyX'],
  interact: ['KeyF'],
  potion: ['KeyH'],
  /** Whistle for the Pepe Bull. */
  callMount: ['KeyV'],
  /** Straight to the tabbed menu's Quests / Gear tab. */
  questLog: ['KeyJ'],
  inventory: ['KeyI'],
  pause: ['Escape'],
};

export const PAD = {
  sprint: ['l3'],
  jump: ['a'],
  dodge: ['b'],
  light: ['rb'],
  heavy: ['rt'],
  block: ['lb'],
  lock: ['r3'],
  /** Hold this, then a face button, to cast spells 1–4 (x, y, b, a). */
  spellModifier: ['lt'],
  interact: ['y'],
  potion: ['up'],
  /** Whistle for the Pepe Bull. */
  callMount: ['down'],
  /** View / Select: the tabbed menu on its Quests tab. */
  questLog: ['back'],
  pause: ['start'],
};

/**
 * Gunplay, 4-slot weapon bar and movement-tech bindings (rebindable arrays mutated in place like
 * `KEYS`/`PAD`). Kept in a dedicated table so existing RPG `controlPrefs`, `callMount` (`KeyV`),
 * and E2E scripts stay intact without key conflicts.
 */
export const GUN_KEYS = {
  /**
   * The layout while a gun is in hand (gun shooting design §3): the left button fires, the right
   * one steps the zoom, one key swings the gun (tap light, hold for heavy), and spells sit on
   * letters, because R reloads and the number keys pick weapon slots.
   */
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  melee: ['KeyQ'],
  spell1: ['KeyE'],
  spell2: ['KeyY'],
  spell3: ['KeyZ'],
  spell4: ['KeyX'],
  reload: ['KeyR'],
  swapWeapon: ['Tab'],
  grapple: ['KeyG'],
  /** Toggle 3P / 1P camera view (`KeyV` stays on `callMount`). */
  toggleView: ['KeyB'],
  slide: ['ControlLeft'],
  dash: ['AltLeft'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
};

/**
 * Gamepad gunplay bindings. Preserves every existing E2E pad binding:
 * - `y` stays on `interact` (camps, find-quest, mount, rootdeep E2E)
 * - `up` stays on `potion`, `down` stays on `callMount`
 * - `lt` + face buttons stay on spells 1–4
 *
 * Mapping:
 * - `x` (button 2, when `lt` is not held): Reload
 * - `right` (D-pad Right, button 15): Swap weapon slot (next)
 * - `left` (D-pad Left, button 14): Toggle 1P / 3P camera view
 * - `lb` + `rb` chord (when `grapple` is empty): Grapple hook
 * - `slide` / `dash`: empty by default (handled contextually via `b` / Dodge in sim; rebindable)
 */
export const GUN_PAD = {
  /** With a gun in hand: RT fires, LT steps the zoom, RB swings, and LB + a face button casts. */
  fire: ['rt'] as string[],
  aim: ['lt'] as string[],
  melee: ['rb'] as string[],
  spellModifier: ['lb'] as string[],
  reload: ['x'] as string[],
  swapWeapon: ['right'] as string[],
  grapple: [] as string[],
  toggleView: ['left'] as string[],
  slide: [] as string[],
  dash: [] as string[],
};

export const GAMEPAD = {
  /**
   * Radial deadzones (stick magnitude 0..1), rescaled so motion starts smoothly from 0. 0.2 / 0.15
   * is the shared Sproto convention, so a pad feels the same in every game.
   */
  deadzone: { move: 0.2, look: 0.15, trigger: 0.3 },
  /** Stick magnitude treated as full deflection (worn sticks rarely reach 1). */
  outerDeadzone: 0.94,
  /** Response exponent after the deadzone: 1 = linear, 2 = fine control near centre. */
  curve: { move: 1, look: 2 },
  /** Camera turn speed at full right-stick deflection (rad/s), times the Settings slider. */
  sensitivity: { yaw: 3.3, pitch: 2.1 },
  /** Holding the right stick at the edge ramps in extra yaw speed, for fast 180s. */
  acceleration: { threshold: 0.9, delay: 0.12, rampTime: 0.3, extraYaw: 2.2 },
  /** Stick or trigger travel needed before the pad takes over as the active device (ignores drift). */
  activateThreshold: 0.4,
  rumble: {
    enabled: true,
    intensity: 0.8,
    land: { strong: 0.25, weak: 0.1, ms: 70 },
    uiConfirm: { strong: 0, weak: 0.18, ms: 35 },
    fire: { strong: 0.18, weak: 0.28, ms: 45 },
    reload: { strong: 0.08, weak: 0.14, ms: 40 },
    grapple: { strong: 0.22, weak: 0.2, ms: 65 },
  },
};

/**
 * Two guns in hand (dual wield), after the early Halo games: a trigger and a bumper per gun.
 *
 *   Gamepad: RT fires the right gun, LT the left (two guns never zoom, so LT is free). A tap of RB
 *   reloads the right gun, a tap of LB the left, and X both. Holding RB swings (a heavy blow);
 *   holding LB and pressing a face button still casts.
 *   Mouse: the left button fires the left gun, the right button the right one. R reloads both.
 *
 * A bumper counts as a tap when it comes up within `DUAL_TAP` seconds.
 */
export const DUAL_TAP = 0.28;

/** Gun in hand: the melee button held this long (s) turns the swing into a heavy one. */
export const MELEE_HOLD_HEAVY = 0.28;

export const MOUSE = {
  /** Radians per pixel at sensitivity 1. */
  sensitivity: 0.0022,
};
