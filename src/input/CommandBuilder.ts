import { BTN, type AimRay, type ButtonName, type InputCommand, type UiAction } from '../sim/commands';
import { GAMEPAD, GUN_KEYS, GUN_PAD, KEYS, PAD } from './bindings';
import { shapeStick } from './Gamepad';
import type { Input } from './Input';

const SPELL_FACE = { spell1: 'x', spell2: 'y', spell3: 'b', spell4: 'a' } as const;
const WEAPON_SLOT_KEYS = ['slot1', 'slot2', 'slot3', 'slot4'] as const;

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
  private weaponSlotLatched: number | undefined = undefined;
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
    for (const name of ['jump', 'sprint', 'dodge', 'light', 'heavy', 'block', 'lock', 'interact', 'potion', 'callMount', 'spell1', 'spell2', 'spell3', 'spell4'] as const) {
      btn(name, inp.isDown(KEYS[name]), inp.wasPressed(KEYS[name]));
    }
    // Gunplay & movement-tech keyboard bindings.
    for (const name of ['reload', 'swapWeapon', 'grapple', 'toggleView', 'slide', 'dash'] as const) {
      btn(name, inp.isDown(GUN_KEYS[name]), inp.wasPressed(GUN_KEYS[name]));
    }
    // Direct 1–4 weapon bar slot selection (keyboard).
    for (let i = 0; i < WEAPON_SLOT_KEYS.length; i++) {
      if (inp.wasPressed(GUN_KEYS[WEAPON_SLOT_KEYS[i]])) this.weaponSlotLatched = i;
    }
    // Pad: face buttons are spells while the modifier is held, their own action otherwise.
    this.spellMode = pad.isDown(PAD.spellModifier);
    for (const name of ['sprint', 'light', 'heavy', 'block', 'lock', 'potion', 'callMount'] as const) {
      btn(name, pad.isDown(PAD[name]), pad.wasPressed(PAD[name]));
    }
    if (this.spellMode) {
      for (const [spell, face] of Object.entries(SPELL_FACE) as [keyof typeof SPELL_FACE, string][]) {
        btn(spell, pad.isDown([face]), pad.wasPressed([face]));
      }
    } else {
      for (const name of ['jump', 'dodge', 'interact'] as const) btn(name, pad.isDown(PAD[name]), pad.wasPressed(PAD[name]));
      btn('reload', pad.isDown(GUN_PAD.reload), pad.wasPressed(GUN_PAD.reload));
    }
    // Non-face gunplay pad actions (D-pad Right = swapWeapon, D-pad Left = toggleView, optional slide/dash).
    for (const name of ['swapWeapon', 'toggleView', 'slide', 'dash'] as const) {
      if (GUN_PAD[name].length) btn(name, pad.isDown(GUN_PAD[name]), pad.wasPressed(GUN_PAD[name]));
    }
    // Grapple: dedicated binding if set, otherwise LB + RB chord.
    if (GUN_PAD.grapple.length) {
      btn('grapple', pad.isDown(GUN_PAD.grapple), pad.wasPressed(GUN_PAD.grapple));
    } else {
      const lbDown = pad.isDown(PAD.block);
      const rbDown = pad.isDown(PAD.light);
      const chordDown = lbDown && rbDown;
      const chordPressed = chordDown && (pad.wasPressed(PAD.block) || pad.wasPressed(PAD.light));
      btn('grapple', chordDown, chordPressed);
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
  take(camYaw: number, aim?: AimRay): InputCommand {
    const cmd: InputCommand = { kind: 'input', move: { ...this.move }, camYaw, held: this.held | this.latched, pressed: this.latched, lockSwitch: this.switchLatched };
    if (this.weaponSlotLatched !== undefined) {
      cmd.weaponSlot = this.weaponSlotLatched;
      this.weaponSlotLatched = undefined;
    }
    if (aim) cmd.aim = aim;
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
    this.weaponSlotLatched = undefined;
    this.mouseArmed = this.stickArmed = true;
    this.move = { x: 0, y: 0 };
  }
}

