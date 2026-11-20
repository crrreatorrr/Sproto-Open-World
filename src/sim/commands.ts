import type { SkillId } from '../content/progression';
import type { SpellId } from '../content/spells';
import type { PlayerId } from './entity';
import type { Vec3 } from './math';

/** The camera's centre ray: what the crosshair points at (`dir` is a unit vector). */
export interface AimRay {
  from: Vec3;
  dir: Vec3;
}

/** Buttons a player can hold. Bit flags so a command is two small integers. */
export const BTN = {
  jump: 1 << 0,
  sprint: 1 << 1,
  dodge: 1 << 2,
  light: 1 << 3,
  heavy: 1 << 4,
  block: 1 << 5,
  lock: 1 << 6,
  interact: 1 << 7,
  potion: 1 << 8,
  spell1: 1 << 9,
  spell2: 1 << 10,
  spell3: 1 << 11,
  spell4: 1 << 12,
  callMount: 1 << 13,
} as const;
export type ButtonName = keyof typeof BTN;

/**
 * One player's input for one tick. Intents only (plan §2.2): the sim decides what they do.
 * `move` is in camera space (x = right, y = forward, magnitude 0..1); `camYaw` turns it into world
 * space. `pressed` holds the buttons that went down since the previous tick, latched by the
 * client so a tap between two ticks is never lost.
 */
/**
 * Intents from menus (plan §2.2: intents, not effects). The sim validates each: equipping an item
 * you own (out of combat), buying while that merchant's shop is open, equipping a known spell in a
 * slot, spending a skill point, and so on. They ride a tick even while paused (App.pausedTick), so
 * every rule lives in the sim.
 */
export type UiAction =
  | { kind: 'dialogueChoose'; choice: number }
  | { kind: 'buy'; merchant: string; item: string }
  | { kind: 'equip'; item: string }
  /** Put a relic in a socket. With no socket, the first empty one; A on an equipped relic clears it. */
  | { kind: 'equipRelic'; item: string; socket?: number }
  | { kind: 'clearRelic'; socket: number }
  | { kind: 'equipTotem'; item: string }
  /** Put a known spell (or nothing) in loadout slot 0–3. A spell already in another slot moves. */
  | { kind: 'equipSpell'; slot: number; spell: SpellId | null }
  | { kind: 'spendSkill'; skill: SkillId }
  /** Refund every rank for Sprouts; only at a shrine. */
  | { kind: 'respecSkills' }
  | { kind: 'rest' }
  | { kind: 'closeMenu' }
  | { kind: 'track'; quest: string };

export interface InputCommand {
  kind: 'input';
  move: { x: number; y: number };
  camYaw: number;
  held: number;
  pressed: number;
  /** Switch the hard lock to the next target left (-1) or right (+1) of the current one. */
  lockSwitch: number;
  /** Where the crosshair points. Without one (bots, tests), attacks use the stick and facing. */
  aim?: AimRay;
  /** Menu intents for this tick (usually none). */
  ui?: UiAction[];
}

export type Command = InputCommand;

export type CommandMap = ReadonlyMap<PlayerId, Command>;

export const idleInput = (camYaw = 0): InputCommand => ({ kind: 'input', move: { x: 0, y: 0 }, camYaw, held: 0, pressed: 0, lockSwitch: 0 });
