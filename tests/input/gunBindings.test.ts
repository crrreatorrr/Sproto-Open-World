import { describe, expect, it } from 'vitest';
import { GUN_KEYS, GUN_PAD, KEYS, PAD } from '../../src/input/bindings';
import { CommandBuilder } from '../../src/input/CommandBuilder';
import { GamepadInput, PAD_BUTTONS } from '../../src/input/Gamepad';
import type { Input } from '../../src/input/Input';
import { BTN } from '../../src/sim/commands';

function fakeInput() {
  const down = new Set<string>();
  const pressed = new Set<string>();
  const padDown = new Set<string>();
  const padPressed = new Set<string>();
  const padState = {
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    isDown: (bs: readonly string[]) => bs.some((b) => padDown.has(b)),
    wasPressed: (bs: readonly string[]) => bs.some((b) => padPressed.has(b)),
    update: () => {},
  };
  const input = {
    pad: padState,
    isDown: (c: readonly string[]) => c.some((k) => down.has(k)),
    wasPressed: (c: readonly string[]) => c.some((k) => pressed.has(k)),
  } as unknown as Input;
  return { input, down, pressed, padDown, padPressed };
}

describe('BTN bitmask extensions', () => {
  it('assigns exact high bits 14..19 without colliding with any existing bit', () => {
    expect(BTN.reload).toBe(1 << 14);
    expect(BTN.swapWeapon).toBe(1 << 15);
    expect(BTN.grapple).toBe(1 << 16);
    expect(BTN.toggleView).toBe(1 << 17);
    expect(BTN.slide).toBe(1 << 18);
    expect(BTN.dash).toBe(1 << 19);

    // Every BTN entry must be a unique single-bit power of two.
    const values = Object.values(BTN);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeGreaterThan(0);
      expect(v & (v - 1)).toBe(0);
    }

    // Original bits 0..13 are preserved verbatim.
    expect(BTN.jump).toBe(1 << 0);
    expect(BTN.callMount).toBe(1 << 13);
  });

  it('keeps callMount on KeyV and interact on Y so E2E scripts stay intact', () => {
    expect(KEYS.callMount).toEqual(['KeyV']);
    expect(PAD.interact).toEqual(['y']);
    expect(PAD.callMount).toEqual(['down']);
    expect(GUN_KEYS.toggleView).not.toContain('KeyV');
    expect(GUN_PAD.reload).toEqual(['x']);
    expect(GUN_PAD.swapWeapon).toEqual(['right']);
    expect(GUN_PAD.toggleView).toEqual(['left']);
  });
});

describe('CommandBuilder gunplay bindings', () => {
  it('latches keyboard reload, swapWeapon, grapple, toggleView, slide, and dash', () => {
    const cases: [string, number][] = [
      ['KeyR', BTN.reload],
      ['Tab', BTN.swapWeapon],
      ['KeyG', BTN.grapple],
      ['KeyB', BTN.toggleView],
      ['ControlLeft', BTN.slide],
      ['AltLeft', BTN.dash],
    ];
    for (const [code, bit] of cases) {
      const f = fakeInput();
      const b = new CommandBuilder(f.input);
      f.down.add(code);
      f.pressed.add(code);
      b.frame();
      const first = b.take(0);
      expect(first.pressed & bit, `${code} should set pressed bit`).toBeTruthy();
      expect(first.held & bit, `${code} should set held bit`).toBeTruthy();
      f.down.clear();
      f.pressed.clear();
      b.frame();
      expect(b.take(0).pressed & bit).toBeFalsy();
    }
  });

  it('latches direct 1–4 weaponSlot picks for one tick and clears afterwards', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);
    for (let slot = 0; slot < 4; slot++) {
      f.pressed.clear();
      f.pressed.add(`Digit${slot + 1}`);
      b.frame();
      const cmd = b.take(0);
      expect(cmd.weaponSlot).toBe(slot);
      expect(b.take(0).weaponSlot).toBeUndefined();
    }
  });

  it('wires gamepad X to reload only when spellModifier (LT) is not held', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);

    // Without LT: X triggers reload, not spell1.
    f.padDown.add('x');
    f.padPressed.add('x');
    b.frame();
    const reloadCmd = b.take(0);
    expect(reloadCmd.pressed & BTN.reload).toBeTruthy();
    expect(reloadCmd.pressed & BTN.spell1).toBeFalsy();

    // With LT held: X triggers spell1, not reload.
    f.padDown.add('lt');
    f.padPressed.add('x');
    b.frame();
    const spellCmd = b.take(0);
    expect(spellCmd.pressed & BTN.spell1).toBeTruthy();
    expect(spellCmd.pressed & BTN.reload).toBeFalsy();
  });

  it('wires gamepad D-pad Right to swapWeapon, D-pad Left to toggleView, and LB+RB chord to grapple', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);

    f.padDown.add('right');
    f.padPressed.add('right');
    b.frame();
    expect(b.take(0).pressed & BTN.swapWeapon).toBeTruthy();

    f.padDown.clear();
    f.padPressed.clear();
    f.padDown.add('left');
    f.padPressed.add('left');
    b.frame();
    expect(b.take(0).pressed & BTN.toggleView).toBeTruthy();

    f.padDown.clear();
    f.padPressed.clear();
    f.padDown.add('lb');
    f.padDown.add('rb');
    f.padPressed.add('rb');
    b.frame();
    const grappleCmd = b.take(0);
    expect(grappleCmd.pressed & BTN.grapple).toBeTruthy();
    expect(grappleCmd.held & BTN.grapple).toBeTruthy();
  });

  it('queues the new weapon/gun UiAction variants cleanly', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);
    b.queueUi({ kind: 'selectWeaponSlot', slot: 2 });
    b.queueUi({ kind: 'equipWeaponSlot', slot: 1, weaponId: 'gun_42' });
    b.queueUi({ kind: 'equipOffhand', weaponId: 'gun_99' });
    b.queueUi({ kind: 'dropGun', uid: 'gun_42' });
    const cmd = b.take(0);
    expect(cmd.ui).toEqual([
      { kind: 'selectWeaponSlot', slot: 2 },
      { kind: 'equipWeaponSlot', slot: 1, weaponId: 'gun_42' },
      { kind: 'equipOffhand', weaponId: 'gun_99' },
      { kind: 'dropGun', uid: 'gun_42' },
    ]);
  });
});

describe('GamepadInput holdTime and wasReleased', () => {
  it('tracks continuous hold duration and release edges', () => {
    const xIdx = PAD_BUTTONS.indexOf('x');
    const buttons = PAD_BUTTONS.map(() => ({ pressed: false, touched: false, value: 0 }));
    const mockPad = { index: 0, id: 'Xbox Controller', connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0] };
    const origNav = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => [mockPad] },
    });
    try {
      const pad = new GamepadInput();
      // First frame connects with nothing held.
      pad.update(1000);
      expect(pad.holdTime('x')).toBe(0);

      // Press X.
      buttons[xIdx].pressed = true;
      pad.endFrame();
      pad.update(1050);
      expect(pad.wasPressed(['x'])).toBe(true);
      expect(pad.holdTime('x')).toBe(0);

      // Hold X for 100ms (clamped dt max 0.1s).
      pad.endFrame();
      pad.update(1150);
      expect(pad.holdTime('x')).toBeCloseTo(0.1, 5);

      // Release X.
      buttons[xIdx].pressed = false;
      pad.endFrame();
      pad.update(1200);
      expect(pad.wasReleased(['x'])).toBe(true);
      expect(pad.holdTime('x')).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: origNav });
    }
  });
});
