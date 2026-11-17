import type { PlayerId } from './entity';

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
} as const;
export type ButtonName = keyof typeof BTN;

/**
 * One player's input for one tick. Intents only (plan §2.2): the sim decides what they do.
 * `move` is in camera space (x = right, y = forward, magnitude 0..1); `camYaw` turns it into world
 * space. `pressed` holds the buttons that went down since the previous tick, latched by the
 * client so a tap between two ticks is never lost.
 */
export interface InputCommand {
  kind: 'input';
  move: { x: number; y: number };
  camYaw: number;
  held: number;
  pressed: number;
}

export type Command = InputCommand;

export type CommandMap = ReadonlyMap<PlayerId, Command>;

export const idleInput = (camYaw = 0): InputCommand => ({ kind: 'input', move: { x: 0, y: 0 }, camYaw, held: 0, pressed: 0 });
