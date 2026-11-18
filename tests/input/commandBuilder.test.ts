import { describe, expect, it } from 'vitest';
import { CommandBuilder } from '../../src/input/CommandBuilder';
import type { Input } from '../../src/input/Input';
import { BTN } from '../../src/sim/commands';

/** A stand-in for Input: keys held this frame and keys pressed this frame. */
function fakeInput() {
  const down = new Set<string>();
  const pressed = new Set<string>();
  const padState = { move: { x: 0, y: 0 }, isDown: () => false, wasPressed: () => false, update: () => {} };
  const input = {
    pad: padState,
    isDown: (c: readonly string[]) => c.some((k) => down.has(k)),
    wasPressed: (c: readonly string[]) => c.some((k) => pressed.has(k)),
  } as unknown as Input;
  return { input, down, pressed };
}

describe('command builder', () => {
  it('a tap between two ticks reaches exactly one tick', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);
    f.down.add('Space');
    f.pressed.add('Space');
    b.frame();
    f.down.clear();
    f.pressed.clear();
    b.frame(); // released before the tick ran
    const first = b.take(0);
    expect(first.pressed & BTN.jump).toBeTruthy();
    expect(b.take(0).pressed & BTN.jump).toBeFalsy();
  });

  it('keyboard movement is normalized; camera yaw rides along', () => {
    const f = fakeInput();
    const b = new CommandBuilder(f.input);
    f.down.add('KeyW');
    f.down.add('KeyD');
    b.frame();
    const c = b.take(1.25);
    expect(Math.hypot(c.move.x, c.move.y)).toBeCloseTo(1, 5);
    expect(c.camYaw).toBe(1.25);
  });
});
