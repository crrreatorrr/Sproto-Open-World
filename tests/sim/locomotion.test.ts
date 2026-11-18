import { describe, expect, it } from 'vitest';
import { MOVE } from '../../src/content/tuning';
import { BTN, idleInput } from '../../src/sim/commands';
import { makeWorld, run } from './helpers';

const forward = (extra = 0) => () => {
  const c = idleInput(0);
  c.move = { x: 0, y: 1 };
  c.held |= extra;
  return c;
};

describe('player locomotion', () => {
  it('stands on the ground at spawn', async () => {
    const w = await makeWorld();
    run(w, 30, () => idleInput(0));
    const p = w.playerEntity(0)!;
    expect(p.loco!.grounded).toBe(true);
    expect(Math.abs(p.tf.pos.y)).toBeLessThan(0.05);
    w.dispose();
  });

  it('runs forward (+Z at camera yaw 0) at run speed, faster when sprinting', async () => {
    const w = await makeWorld();
    run(w, 60, forward());
    const p = w.playerEntity(0)!;
    expect(p.tf.pos.z).toBeGreaterThan(3.5);
    expect(Math.abs(p.tf.pos.x)).toBeLessThan(0.01);
    expect(p.loco!.speed).toBeCloseTo(MOVE.runSpeed, 1);
    run(w, 60, forward(BTN.sprint));
    expect(p.loco!.speed).toBeCloseTo(MOVE.sprintSpeed, 1);
    w.dispose();
  });

  it('jumps to about the tuned height and lands with a land event', async () => {
    const w = await makeWorld();
    run(w, 10, () => idleInput(0));
    let jumped = false;
    let landed = false;
    let top = 0;
    for (let i = 0; i < 90; i++) {
      const c = idleInput(0);
      if (i === 0) c.pressed = c.held = BTN.jump;
      w.tick(new Map([[0, c]]));
      top = Math.max(top, w.playerEntity(0)!.tf.pos.y);
      for (const e of w.events) {
        if (e.type === 'jump') jumped = true;
        if (e.type === 'land') landed = true;
      }
    }
    expect(jumped).toBe(true);
    expect(landed).toBe(true);
    expect(top).toBeGreaterThan(MOVE.jumpHeight * 0.9);
    expect(top).toBeLessThan(MOVE.jumpHeight * 1.1);
    w.dispose();
  });

  it('a jump pressed a few ticks before landing still fires (buffer)', async () => {
    const w = await makeWorld();
    run(w, 10, () => idleInput(0));
    const p = w.playerEntity(0)!;
    // First jump, then press again while still in the air, just before touching down.
    let jumps = 0;
    for (let i = 0; i < 120; i++) {
      const c = idleInput(0);
      const airborneLow = !p.loco!.grounded && p.tf.vel.y < 0 && p.tf.pos.y < 0.25;
      if (i === 0 || (jumps === 1 && airborneLow)) c.pressed = c.held = BTN.jump;
      w.tick(new Map([[0, c]]));
      jumps += w.events.filter((e) => e.type === 'jump').length;
    }
    expect(jumps).toBe(2);
    w.dispose();
  });

  it('steps up a 0.3 m box without jumping and is stopped by a 0.6 m one', async () => {
    const w = await makeWorld();
    const p = w.playerEntity(0)!;
    // The 0.3 m step is centred at (-4, 16); walk at it from the south.
    p.tf.pos = { x: -4, y: 0, z: 12 };
    w.physics.teleport(p.id, p.tf.pos);
    run(w, 60, forward());
    expect(p.tf.pos.y).toBeGreaterThan(0.25);
    // The 0.6 m block at (-1, 16) is above the autostep height: a walk stops at its face.
    p.tf.pos = { x: -1, y: 0, z: 12 };
    w.physics.teleport(p.id, p.tf.pos);
    run(w, 60, forward());
    expect(p.tf.pos.y).toBeLessThan(0.1);
    expect(p.tf.pos.z).toBeLessThan(14.6);
    w.dispose();
  });

  it('turns to face the move direction', async () => {
    const w = await makeWorld();
    run(w, 40, () => {
      const c = idleInput(0);
      c.move = { x: 1, y: 0 }; // camera-right = world -X
      return c;
    });
    const p = w.playerEntity(0)!;
    expect(p.tf.pos.x).toBeLessThan(-1);
    expect(Math.abs(Math.abs(p.tf.yaw) - Math.PI / 2)).toBeLessThan(0.05);
    w.dispose();
  });

  it('keeps its feet on the ground while running (no sinking into the floor)', async () => {
    const w = await makeWorld();
    const p = w.playerEntity(0)!;
    for (let i = 0; i < 120; i++) {
      w.tick(new Map([[0, forward()()]]));
      expect(p.loco!.grounded).toBe(true);
      expect(Math.abs(p.tf.pos.y)).toBeLessThan(0.02); // the controller's skin jitters by ~1 cm, never builds up
    }
    w.dispose();
  });

  it('walks up the 20° ramp onto the platform and back down without leaving the ground', async () => {
    const w = await makeWorld();
    const p = w.playerEntity(0)!;
    p.tf.pos = { x: 16, y: 0, z: -4 };
    w.physics.teleport(p.id, p.tf.pos);
    run(w, 150, forward());
    expect(p.tf.pos.y).toBeGreaterThan(2.3);
    expect(p.tf.pos.z).toBeGreaterThan(6);
    // Turn round (camera yaw π: forward is -Z) and run back down.
    let airborne = 0;
    for (let i = 0; i < 150; i++) {
      const c = idleInput(Math.PI);
      c.move = { x: 0, y: 1 };
      w.tick(new Map([[0, c]]));
      if (!p.loco!.grounded) airborne++;
    }
    expect(p.tf.pos.y).toBeLessThan(0.05);
    expect(airborne).toBeLessThan(4);
    w.dispose();
  });
});

