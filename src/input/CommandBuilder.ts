import { BTN, type ButtonName, type InputCommand, type UiAction } from '../sim/commands';
import { GAMEPAD, KEYS, PAD } from './bindings';
import { shapeStick } from './Gamepad';
import type { Input } from './Input';

const SPELL_FACE = { spell1: 'x', spell2: 'y', spell3: 'b', spell4: 'a' } as const;

/**
 * Hard-lock target switching (plan §4.1): a horizontal mouse flick over `flickPxPerSec`, or the
 * right stick past `stickOn`. Each fires once, then re-arms when the mouse slows under
 * `rearmPxPerSec` or the stick comes back under `stickOff`. Stick values are raw travel.
 */
export const LOCK_SWITCH = { flickPxPerSec: 300, rearmPxPerSec: 100, stickOn: 0.7, stickOff: 0.3 } as const;

/** What the lock switch reads each frame (App passes it; nothing switches while not locked). */
export interface LockLook {
  locked: boolean;
  /** Raw horizontal mouse movement this frame (px). */
  mouseDx: number;
  /** Frame time (s). */
  dt: number;
}

const shaped = { x: 0, y: 0 };
/** The pad's look stick is reported shaped (deadzone + curve): the same shaping, applied to a raw travel. */
const lookShaped = (raw: number) => shapeStick(raw, 0, GAMEPAD.deadzone.look, GAMEPAD.curve.look, shaped);

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
  private switchLatched = 0;
  private mouseArmed = true;
  private stickArmed = true;
  /** Menu intents waiting for the next tick (plan §2.2: menus change the sim only through commands). */
  private ui: UiAction[] = [];
  /** QA hooks (dev and QA builds): a press was latched; a tick took latched presses. */
  onLatch: ((pressed: number) => void) | null = null;
  onTake: ((cmd: InputCommand) => void) | null = null;

  constructor(private readonly input: Input) {}

  frame(look?: LockLook): void {
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
    if (pressed) this.onLatch?.(pressed);
    this.lockSwitch(look);

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

  /** Latch a lock switch from a mouse flick or a right-stick push (only while locked). */
  private lockSwitch(look: LockLook | undefined): void {
    if (!look?.locked) {
      this.mouseArmed = this.stickArmed = true;
      return;
    }
    const L = LOCK_SWITCH;
    const speed = look.mouseDx / Math.max(1 / 240, look.dt);
    if (Math.abs(speed) < L.rearmPxPerSec) this.mouseArmed = true;
    else if (this.mouseArmed && Math.abs(speed) > L.flickPxPerSec) {
      this.mouseArmed = false;
      this.switchLatched = Math.sign(speed);
    }
    const sx = this.input.pad.look.x;
    if (Math.abs(sx) < lookShaped(L.stickOff)) this.stickArmed = true;
    else if (this.stickArmed && Math.abs(sx) > lookShaped(L.stickOn)) {
      this.stickArmed = false;
      this.switchLatched = Math.sign(sx);
    }
  }

  /**
   * Queue a menu intent (dialogue choice, buy, equip…). It rides on the next `take()`, exactly
   * once, in the order queued; the sim validates it.
   */
  queueUi(action: UiAction): void {
    this.ui.push(action);
  }

  /** Menu intents are waiting for a tick. */
  get hasUi(): boolean {
    return this.ui.length > 0;
  }

  /** The command for the next tick. Latched presses, a lock switch and queued menu intents go to this tick only. */
  take(camYaw: number): InputCommand {
    const cmd: InputCommand = { kind: 'input', move: { ...this.move }, camYaw, held: this.held | this.latched, pressed: this.latched, lockSwitch: this.switchLatched };
    if (this.ui.length) {
      cmd.ui = this.ui;
      this.ui = [];
    }
    this.latched = 0;
    this.switchLatched = 0;
    if (cmd.pressed) this.onTake?.(cmd);
    return cmd;
  }

  /** Forget queued menu intents (a new session starts: they belong to the old sim). */
  clearUi(): void {
    this.ui = [];
  }

  /**
   * Drop device state (pausing, menus opening). Queued menu intents survive it: an equip chosen in
   * the pause menu must still reach the sim.
   */
  clear(): void {
    this.held = 0;
    this.latched = 0;
    this.switchLatched = 0;
    this.mouseArmed = this.stickArmed = true;
    this.move = { x: 0, y: 0 };
  }
}

