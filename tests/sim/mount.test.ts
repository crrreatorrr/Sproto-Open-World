import { describe, expect, it } from 'vitest';
import { MOUNT } from '../../src/content/mounts';
import { MOVE } from '../../src/content/tuning';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { interactTarget } from '../../src/sim/systems/rpg';
import type { SimWorld } from '../../src/sim/SimWorld';
import { step, stepN } from './combatHelpers';
import { interact, standBy, ui, VILLAGE_Y } from './m3Helpers';
import { flatSproutvale, standAt } from './m4Helpers';

/** Riding the Pepe Bull: getting on and off, speed, and fighting with staff and spells from the saddle. */
const bullOf = (w: SimWorld) => w.entities.find((e) => e.mount)!;

function mountUp(w: SimWorld): Entity {
  const bull = bullOf(w);
  standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
  step(w, interact());
  stepN(w, MOUNT.mountTicks + 1);
  return bull;
}

/** Run forward (world +Z with the camera at yaw 0) with these extra buttons on chosen ticks. */
function ride(w: SimWorld, ticks: number, buttons: (i: number) => number = () => 0, held = 0): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const c: InputCommand = idleInput(0);
    c.move = { x: 0, y: 1 };
    c.pressed = buttons(i);
    c.held = c.pressed | held;
    out.push(...step(w, c));
  }
  return out;
}

describe('getting on and off the Pepe Bull', () => {
  it('stands in the village and offers a ride in reach', async () => {
    const { w, p } = await flatSproutvale();
    const bull = bullOf(w);
    expect(bull.tf.pos.y).toBeCloseTo(VILLAGE_Y, 1);
    standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
    expect(interactTarget(p, w.entities)).toMatchObject({ kind: 'mount', name: 'Ride Pepe Bull' });
    standAt(w, bull.tf.pos.x - 8, bull.tf.pos.z, bull.tf.pos);
    expect(interactTarget(p, w.entities)).toBeNull();
    w.dispose();
  });

  it('mounting takes the clip\'s length and ends in the saddle', async () => {
    const { w, p } = await flatSproutvale();
    const bull = bullOf(w);
    standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
    const start = step(w, interact());
    expect(start.some((e) => e.type === 'mount' && e.phase === 'start')).toBe(true);
    expect(p.riding?.state).toBe('mounting');
    stepN(w, MOUNT.mountTicks - 2);
    expect(p.riding?.state).toBe('mounting');
    const seated = stepN(w, 2).map((x) => x.ev);
    expect(seated.some((e) => e.type === 'mount' && e.phase === 'seated')).toBe(true);
    expect(p.riding?.state).toBe('riding');
    expect(p.combat!.action).toBeNull();
    expect(Math.hypot(p.tf.pos.x - bull.tf.pos.x, p.tf.pos.z - bull.tf.pos.z)).toBeLessThan(0.05);
    w.dispose();
  });

  it('the same button dismounts, to the bull\'s left, and the bull stays put', async () => {
    const { w, p } = await flatSproutvale();
    const bull = mountUp(w);
    ride(w, 60);
    stepN(w, 40); // come to a stop away from the village's other interactables
    const at = { ...bull.tf.pos };
    expect(interactTarget(p, w.entities)).toMatchObject({ kind: 'mount', name: 'Dismount' });
    step(w, interact());
    expect(p.riding?.state).toBe('dismounting');
    expect(bull.mount!.rider).toBeNull();
    const off = stepN(w, MOUNT.dismountTicks + 1).map((x) => x.ev);
    expect(off.some((e) => e.type === 'mount' && e.phase === 'off')).toBe(true);
    expect(p.riding).toBeUndefined();
    expect(bull.tf.pos).toEqual(at);
    expect(Math.hypot(p.tf.pos.x - at.x, p.tf.pos.z - at.z)).toBeCloseTo(MOUNT.dismountSide, 0);
    w.dispose();
  });

  it('a hit while climbing on cancels the mount', async () => {
    const { w, p } = await flatSproutvale();
    const bull = bullOf(w);
    standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
    step(w, interact());
    stepN(w, 5);
    p.combat!.action = { kind: 'hitstun', t: 0, dur: 20, knockdown: false };
    step(w);
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    w.dispose();
  });
});

describe('riding', () => {
  it('runs and sprints faster than on foot, and the bull goes with you', async () => {
    const { w, p } = await flatSproutvale();
    const bull = mountUp(w);
    ride(w, 40);
    expect(p.loco!.speed).toBeCloseTo(MOVE.runSpeed * MOUNT.runScale, 0);
    const stamina = p.vitals!.stamina;
    ride(w, 40, () => 0, BTN.sprint);
    expect(p.loco!.speed).toBeCloseTo(MOVE.sprintSpeed * MOUNT.sprintScale, 0);
    expect(p.vitals!.stamina).toBeGreaterThanOrEqual(stamina);
    expect(bull.tf.pos).toEqual(p.tf.pos);
    expect(bull.mount!.speed).toBeCloseTo(p.loco!.speed, 3);
    w.dispose();
  });

  it('melee from the saddle lands and the bull keeps moving through the swing', async () => {
    const { w, p } = await flatSproutvale();
    mountUp(w);
    ride(w, 30);
    // Just off the bull's path, so it rides past while the rider swings at it.
    const dummy = w.spawnEnemy('dummy_passive', { x: p.tf.pos.x + 1.2, y: VILLAGE_Y, z: p.tf.pos.z + 2.2 }, Math.PI);
    delete dummy.settle;
    const z0 = p.tf.pos.z;
    const ev = ride(w, 34, (i) => (i === 0 ? BTN.light : 0));
    expect(p.riding?.state).toBe('riding');
    expect(ev.some((e) => e.type === 'hit' && e.attacker === p.id && e.target === dummy.id)).toBe(true);
    expect(p.tf.pos.z - z0).toBeGreaterThan(2);
    w.dispose();
  });

  it('magic from the saddle casts and the bull keeps moving', async () => {
    const { w, p } = await flatSproutvale();
    mountUp(w);
    ride(w, 30);
    const z0 = p.tf.pos.z;
    const ev = ride(w, 30, (i) => (i === 0 ? BTN.spell1 : 0));
    expect(ev.some((e) => e.type === 'cast' && e.entity === p.id && e.spell === 'bolt')).toBe(true);
    expect(p.riding?.state).toBe('riding');
    expect(p.tf.pos.z - z0).toBeGreaterThan(2.5);
    w.dispose();
  });

  it('the Momentum staff\'s blink stays a dodge in the saddle: the rider can\'t teleport off the bull', async () => {
    const { w, p } = await flatSproutvale();
    const bull = mountUp(w);
    p.progress!.equipment.staff = 'staff_momentum';
    ride(w, 20, (i) => (i === 10 ? BTN.dodge : 0), BTN.sprint);
    expect(p.riding?.state).toBe('riding');
    expect(bull.tf.pos).toEqual(p.tf.pos);
    const ev = ride(w, 2, () => BTN.dodge, BTN.sprint);
    expect(ev.some((e) => e.type === 'blink')).toBe(false);
    w.dispose();
  });

  it('dying takes you off the bull, and it waits at the shrine you wake at', async () => {
    const { w, p } = await flatSproutvale();
    const bull = mountUp(w);
    standBy(w, 'shrine_first_light');
    step(w, interact());
    step(w, ui([{ kind: 'rest' }]));
    step(w, ui([{ kind: 'closeMenu' }]));
    standAt(w, 100, 300);
    stepN(w, 3);
    expect(bull.tf.pos.x).toBeCloseTo(100, 0);
    p.vitals!.hp = 0;
    p.combat!.action = { kind: 'dead', t: 0 };
    stepN(w, 200);
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    const shrine = w.locate('shrine_first_light')!;
    expect(Math.hypot(bull.tf.pos.x - shrine.x, bull.tf.pos.z - shrine.z)).toBeLessThan(6);
    w.dispose();
  });

  it('riding replays the same and survives a snapshot', async () => {
    const play = async () => {
      const { w } = await flatSproutvale(9);
      mountUp(w);
      ride(w, 90, (i) => (i % 40 === 5 ? BTN.light : i % 40 === 25 ? BTN.spell1 : 0));
      return w;
    };
    const a = await play();
    const b = await play();
    expect(a.hash()).toBe(b.hash());
    const snap = a.snapshot();
    const h = a.hash();
    ride(a, 30);
    a.restore(snap);
    expect(a.hash()).toBe(h);
    a.dispose();
    b.dispose();
  });
});
