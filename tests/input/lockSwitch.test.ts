import { describe, expect, it } from 'vitest';
import { CommandBuilder } from '../../src/input/CommandBuilder';
import type { Input } from '../../src/input/Input';
import { BTN } from '../../src/sim/commands';

/** A stand-in for Input with a right stick (shaped, as GamepadInput reports it) and a pad RB. */
function fakeInput() {
  const pad = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, rb: false, isDown: (b: readonly string[]) => b.includes('rb') && pad.rb, wasPressed: (b: readonly string[]) => b.includes('rb') && pad.rb, update: () => {} };
  const input = { pad, isDown: () => false, wasPressed: () => false } as unknown as Input;
  return { input, pad };
}

const dt = 1 / 60;

describe('lock switch (plan §4.1)', () => {
  it('a mouse flick over 300 px/s switches once, and re-arms when the mouse slows', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);
    b.frame({ locked: true, mouseDx: 4, dt }); // 240 px/s: not a flick
    expect(b.take(0).lockSwitch).toBe(0);
    b.frame({ locked: true, mouseDx: 12, dt }); // 720 px/s right
    expect(b.take(0).lockSwitch).toBe(1);
    b.frame({ locked: true, mouseDx: 14, dt }); // still flicking: not re-armed
    expect(b.take(0).lockSwitch).toBe(0);
    b.frame({ locked: true, mouseDx: 0, dt });
    b.frame({ locked: true, mouseDx: -12, dt });
    expect(b.take(0).lockSwitch).toBe(-1);
  });

  it('the right stick switches past 0.7 and re-arms under 0.3', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);
    f.pad.look.x = 0.9; // shaped: well past raw 0.7
    b.frame({ locked: true, mouseDx: 0, dt });
    expect(b.take(0).lockSwitch).toBe(1);
    b.frame({ locked: true, mouseDx: 0, dt });
    expect(b.take(0).lockSwitch).toBe(0);
    f.pad.look.x = 0;
    b.frame({ locked: true, mouseDx: 0, dt });
    f.pad.look.x = -0.9;
    b.frame({ locked: true, mouseDx: 0, dt });
    expect(b.take(0).lockSwitch).toBe(-1);
  });

  it('nothing switches while not locked, and a switch reaches exactly one tick', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);
    b.frame({ locked: false, mouseDx: 50, dt });
    expect(b.take(0).lockSwitch).toBe(0);
    b.frame({ locked: true, mouseDx: 50, dt });
    expect(b.take(0).lockSwitch).toBe(1);
    expect(b.take(0).lockSwitch).toBe(0);
  });

  it('QA hooks see the press latched and the tick that takes it', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);
    const seen: string[] = [];
    b.onLatch = (p) => seen.push(`latch ${p & BTN.light ? 'light' : '?'}`);
    b.onTake = (c) => seen.push(`take ${c.pressed & BTN.light ? 'light' : '?'}`);
    f.pad.rb = true;
    b.frame();
    f.pad.rb = false;
    b.take(0);
    b.take(0);
    expect(seen).toEqual(['latch light', 'take light']);
  });
});
