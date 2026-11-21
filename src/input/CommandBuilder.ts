import { BTN, type AimRay, type ButtonName, type InputCommand, type UiAction } from '../sim/commands';
import { DUAL_TAP, GAMEPAD, GUN_KEYS, GUN_PAD, KEYS, MELEE_HOLD_HEAVY, PAD } from './bindings';
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
  /**
   * A gun is in hand (the app sets it each frame): the gun layout is read instead of the melee
   * one. Fire, aim and one melee button replace light, heavy and block.
   */
  gunLayout = false;
  /**
   * Two guns are in hand (the app sets it each frame): a trigger and a bumper per gun, as in the
   * early Halo games (bindings.ts, DUAL_TAP).
   */
  dualWield = false;
  /** Dual wield: how long each bumper has been down (s; -1 once the hold was used for something else). */
  private bumperL = 0;
  private bumperR = 0;
  /** How long the gun layout's melee button has been down (s), and whether that hold already went heavy. */
  private meleeHeld = 0;
  private meleeHeavy = false;
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
    if (this.gunLayout) {
      this.gunFrame(look);
      return;
    }
    this.meleeHeld = 0;
    this.meleeHeavy = false;
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
    // The number keys cast spells here; they pick weapon slots only with a gun in hand (gunFrame).
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
    this.finishFrame(held, pressed, look);
  }

  /**
   * The gun layout (gun shooting design §3). Movement, dodge, jump, interact, potion, lock and the
   * mount whistle are where they always are; what changes is the trigger, the zoom, one melee
   * button and where the spells sit.
   */
  private gunFrame(look?: LockLook): void {
    const inp = this.input;
    const pad = inp.pad;
    pad.update();
    let held = 0;
    let pressed = 0;
    const btn = (name: ButtonName, isDown: boolean, wasPressed: boolean) => {
      if (isDown) held |= BTN[name];
      if (wasPressed) pressed |= BTN[name];
    };
    for (const name of ['jump', 'sprint', 'dodge', 'lock', 'interact', 'potion', 'callMount'] as const) {
      btn(name, inp.isDown(KEYS[name]), inp.wasPressed(KEYS[name]));
    }
    const dual = this.dualWield;
    const dtFrame = look?.dt ?? 1 / 60;
    // Two guns: the left mouse button is the left gun (the sim's `aim`), the right one the right gun.
    btn(dual ? 'aim' : 'light', inp.isDown(GUN_KEYS.fire), inp.wasPressed(GUN_KEYS.fire));
    btn(dual ? 'light' : 'aim', inp.isDown(GUN_KEYS.aim), inp.wasPressed(GUN_KEYS.aim));
    for (const name of ['spell1', 'spell2', 'spell3', 'spell4', 'reload', 'swapWeapon', 'grapple', 'slide', 'dash'] as const) {
      btn(name, inp.isDown(GUN_KEYS[name]), inp.wasPressed(GUN_KEYS[name]));
    }
    for (let i = 0; i < WEAPON_SLOT_KEYS.length; i++) {
      if (inp.wasPressed(GUN_KEYS[WEAPON_SLOT_KEYS[i]])) this.weaponSlotLatched = i;
    }
    // Pad: face buttons are spells while the gun layout's modifier is held.
    this.spellMode = pad.isDown(GUN_PAD.spellModifier);
    for (const name of ['sprint', 'lock', 'potion', 'callMount'] as const) btn(name, pad.isDown(PAD[name]), pad.wasPressed(PAD[name]));
    btn('light', pad.isDown(GUN_PAD.fire), pad.wasPressed(GUN_PAD.fire));
    btn('aim', pad.isDown(GUN_PAD.aim), pad.wasPressed(GUN_PAD.aim));
    if (this.spellMode) {
      for (const [spell, face] of Object.entries(SPELL_FACE) as [keyof typeof SPELL_FACE, string][]) {
        btn(spell, pad.isDown([face]), pad.wasPressed([face]));
      }
    } else {
      for (const name of ['jump', 'dodge', 'interact'] as const) btn(name, pad.isDown(PAD[name]), pad.wasPressed(PAD[name]));
      btn('reload', pad.isDown(GUN_PAD.reload), pad.wasPressed(GUN_PAD.reload));
    }
    for (const name of ['swapWeapon', 'slide', 'dash'] as const) {
      if (GUN_PAD[name].length) btn(name, pad.isDown(GUN_PAD[name]), pad.wasPressed(GUN_PAD[name]));
    }
    // Grapple: its own binding if set, otherwise the modifier and the melee button together.
    const chord = !GUN_PAD.grapple.length && pad.isDown(GUN_PAD.spellModifier) && pad.isDown(GUN_PAD.melee);
    if (GUN_PAD.grapple.length) btn('grapple', pad.isDown(GUN_PAD.grapple), pad.wasPressed(GUN_PAD.grapple));
    else btn('grapple', chord, chord && (pad.wasPressed(GUN_PAD.spellModifier) || pad.wasPressed(GUN_PAD.melee)));
    // Two guns: a tap of a bumper reloads that hand's gun. A hold is the bumper's usual job (RB
    // swings, LB is the spell modifier), and so is anything pressed with it.
    const padMelee = !chord && pad.isDown(GUN_PAD.melee);
    if (dual) {
      const tap = (down: boolean, t: number, used: boolean): [number, boolean] => {
        if (down) return [t < 0 || used ? -1 : t + dtFrame, false];
        return [0, t > 0 && t <= DUAL_TAP];
      };
      const faceUsed = Object.values(SPELL_FACE).some((f) => pad.isDown([f]));
      let fire: boolean;
      [this.bumperL, fire] = tap(pad.isDown(GUN_PAD.spellModifier), this.bumperL, chord || faceUsed);
      if (fire) pressed |= BTN.reloadLeft;
      [this.bumperR, fire] = tap(pad.isDown(GUN_PAD.melee), this.bumperR, chord);
      if (fire) pressed |= BTN.reloadRight;
    } else this.bumperL = this.bumperR = 0;
    // Melee: the press swings at once; still down after the hold time, the swing goes heavy. With
    // two guns the pad's melee button only swings once it has been held past a tap.
    const padSwing = padMelee && (!dual || this.bumperR > DUAL_TAP);
    const meleeDown = inp.isDown(GUN_KEYS.melee) || padSwing;
    const meleePressed = inp.wasPressed(GUN_KEYS.melee) || (padSwing && (!dual ? pad.wasPressed(GUN_PAD.melee) : this.meleeHeld === 0));
    if (meleeDown) {
      this.meleeHeld += look?.dt ?? 1 / 60;
      if (this.meleeHeavy) held |= BTN.heavy;
      else {
        held |= BTN.melee;
        if (meleePressed) pressed |= BTN.melee;
        if (this.meleeHeld >= MELEE_HOLD_HEAVY) {
          this.meleeHeavy = true;
          held |= BTN.heavy;
          pressed |= BTN.heavy;
        }
      }
    } else {
      this.meleeHeld = 0;
      this.meleeHeavy = false;
    }
    this.finishFrame(held, pressed, look);
  }

  private finishFrame(held: number, pressed: number, look: LockLook | undefined): void {
    const inp = this.input;
    const pad = inp.pad;
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

