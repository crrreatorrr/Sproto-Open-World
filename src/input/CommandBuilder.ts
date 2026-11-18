import { BTN, type ButtonName, type InputCommand } from '../sim/commands';
import { KEYS, PAD } from './bindings';
import type { Input } from './Input';

const SPELL_FACE = { spell1: 'x', spell2: 'y', spell3: 'b', spell4: 'a' } as const;

/**
 * Turns the devices into per-tick commands. `frame()` runs once per rendered frame and latches
 * every press, so a tap shorter than a tick still reaches the sim; `take()` runs once per tick and
 * hands the latched presses to exactly one tick.
 */
export class CommandBuilder {
  private held = 0;
  private latched = 0;
  private move = { x: 0, y: 0 };
  /** The pad's spell modifier is held: face buttons cast spells 1–4. */
  private spellMode = false;

  constructor(private readonly input: Input) {}

  frame(): void {
    const inp = this.input;
    const pad = inp.pad;
    pad.update();
    let held = 0;
    let pressed = 0;
    const btn = (name: ButtonName, isDown: boolean, wasPressed: boolean) => {
      if (isDown) held |= BTN[name];
      if (wasPressed) pressed |= BTN[name];
    };
    // Keyboard + mouse.
    for (const name of ['jump', 'sprint', 'dodge', 'light', 'heavy', 'block', 'lock', 'interact', 'potion', 'spell1', 'spell2', 'spell3', 'spell4'] as const) {
      btn(name, inp.isDown(KEYS[name]), inp.wasPressed(KEYS[name]));
    }
    // Pad: face buttons are spells while the modifier is held, their own action otherwise.
    this.spellMode = pad.isDown(PAD.spellModifier);
    for (const name of ['sprint', 'light', 'heavy', 'block', 'lock', 'potion'] as const) {
      btn(name, pad.isDown(PAD[name]), pad.wasPressed(PAD[name]));
    }
    if (this.spellMode) {
      for (const [spell, face] of Object.entries(SPELL_FACE) as [keyof typeof SPELL_FACE, string][]) {
        btn(spell, pad.isDown([face]), pad.wasPressed([face]));
      }
    } else {
      for (const name of ['jump', 'dodge', 'interact'] as const) btn(name, pad.isDown(PAD[name]), pad.wasPressed(PAD[name]));
    }
    this.held = held;
    this.latched |= pressed;

    // Movement: keyboard digital, else the left stick (whichever is stronger).
    let kx = 0, ky = 0;
    if (inp.isDown(KEYS.right)) kx += 1;
    if (inp.isDown(KEYS.left)) kx -= 1;
    if (inp.isDown(KEYS.forward)) ky += 1;
    if (inp.isDown(KEYS.back)) ky -= 1;
    const kl = Math.hypot(kx, ky);
    const sx = pad.move.x, sy = -pad.move.y;
    if (kl > 0 && kl >= Math.hypot(sx, sy)) this.move = { x: kx / kl, y: ky / kl };
    else this.move = { x: sx, y: sy };
  }

  /** The command for the next tick. Latched presses go to this tick only. */
  take(camYaw: number): InputCommand {
    const cmd: InputCommand = { kind: 'input', move: { ...this.move }, camYaw, held: this.held | this.latched, pressed: this.latched };
    this.latched = 0;
    return cmd;
  }

  /** Drop everything (pausing, menus opening). */
  clear(): void {
    this.held = 0;
    this.latched = 0;
    this.move = { x: 0, y: 0 };
  }
}

