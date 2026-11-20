import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { MOUNT } from '../../src/content/mounts';
import { DT, MOVE } from '../../src/content/tuning';
import { CELL_RES, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { SPROUTVALE_CONTENT } from '../../src/content/world/sproutvaleContent';
import { KEYS, PAD } from '../../src/input/bindings';
import { promptLabel } from '../../src/input/glyphs';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { gallopLabel } from '../../src/ui/rpgText';
import { step, stepN } from './combatHelpers';
import { interact, VILLAGE_START, VILLAGE_Y } from './m3Helpers';
import { standAt } from './m4Helpers';

/** The Pepe Bull's gallop: top speeds, the press-to-run toggle, no stamina, handling, and replays. */

const FORWARD = { x: 0, y: 1 };
const STILL = { x: 0, y: 0 };

/** All of Sproutvale as an empty flat field: just the player and the bull. */
async function field(seed = 1): Promise<{ w: SimWorld; p: Entity; bull: Entity }> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: VILLAGE_START, yaw: 0 } }), seed);
  w.spawnPlayer(0);
  const flat = (cx: number, cz: number): CellColliders => ({ cx, cz, heights: new Float32Array(CELL_RES * CELL_RES).fill(VILLAGE_Y), shapes: [] });
  for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) w.loadCell(flat(cx, cz));
  step(w);
  w.populateWorld({ ...SPROUTVALE_CONTENT, npcs: [], shrines: [], chests: [], enemies: [], camps: [], objects: [], obstacles: [], triggers: [] });
  stepN(w, 3);
  return { w, p: w.playerEntity(0)!, bull: w.entities.find((e) => e.mount)! };
}

/** In the saddle at the south-west of the field, standing still, facing +Z. */
async function saddled(seed = 1): Promise<{ w: SimWorld; p: Entity; bull: Entity }> {
  const f = await field(seed);
  standAt(f.w, f.bull.tf.pos.x - 2, f.bull.tf.pos.z, f.bull.tf.pos);
  step(f.w, interact());
  stepN(f.w, MOUNT.mountTicks + 1);
  expect(f.p.riding?.state).toBe('riding');
  f.w.teleportPlayer(0, { x: 256, y: VILLAGE_Y + 0.05, z: 20 });
  step(f.w);
  return f;
}

interface Drive {
  move?: { x: number; y: number };
  press?: number;
  hold?: number;
  camYaw?: number;
}

const command = (d: Drive): InputCommand => {
  const c = idleInput(d.camYaw ?? 0);
  c.move = { ...(d.move ?? FORWARD) };
  c.pressed = d.press ?? 0;
  c.held = c.pressed | (d.hold ?? 0);
  return c;
};

function drive(w: SimWorld, ticks: number, d: Drive = {}): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...step(w, command(i === 0 ? d : { ...d, press: 0 })));
  return out;
}

/** One tap of the sprint button: down for a tick, released on the next. */
const tap = (w: SimWorld, d: Drive = {}) => drive(w, 1, { ...d, press: BTN.sprint });

/** Ticks of full gallop from a standstill, with margin. */
const UP_TO_SPEED = Math.ceil((MOUNT.gallopSpeed / MOUNT.accel) * 60) + 10;

describe('the bull\'s top speeds', () => {
  it('are the agreed numbers: the gallop clip is built against them', () => {
    expect(MOUNT.trotSpeed).toBe(9.5);
    expect(MOUNT.gallopSpeed).toBe(17);
  });

  it('trots at 9.5 m/s and gallops at 17 m/s', async () => {
    const { w, p, bull } = await saddled();
    drive(w, UP_TO_SPEED);
    expect(p.loco!.speed).toBeCloseTo(9.5, 2);
    tap(w);
    drive(w, UP_TO_SPEED);
    expect(p.loco!.speed).toBeCloseTo(17, 2);
    expect(bull.mount!.speed).toBeCloseTo(17, 2);
    expect(bull.tf.pos).toEqual(p.tf.pos);
    w.dispose();
  });

  it('a partial stick walks the bull, and never gallops under the on-foot sprint threshold', async () => {
    const { w, p } = await saddled();
    tap(w);
    drive(w, UP_TO_SPEED, { move: { x: 0, y: 0.4 } });
    expect(p.loco!.speed).toBeCloseTo(0.4 * MOUNT.trotSpeed, 1);
    expect(p.riding!.gallop).toBe(true);
    expect(p.loco!.sprinting).toBe(false);
    drive(w, UP_TO_SPEED);
    expect(p.loco!.speed).toBeCloseTo(17, 2);
    w.dispose();
  });
});

describe('press to run', () => {
  it('one press gallops with no button held, and the next press goes back to a trot', async () => {
    const { w, p } = await saddled();
    drive(w, 10);
    tap(w);
    expect(p.riding!.gallop).toBe(true);
    drive(w, UP_TO_SPEED);
    expect(p.riding!.gallop).toBe(true);
    expect(p.loco!.sprinting).toBe(true);
    tap(w);
    expect(p.riding!.gallop).toBe(false);
    drive(w, UP_TO_SPEED);
    expect(p.loco!.speed).toBeCloseTo(MOUNT.trotSpeed, 2);
    w.dispose();
  });

  it('holding the button gallops, and letting go keeps galloping', async () => {
    const { w, p } = await saddled();
    drive(w, 10);
    drive(w, UP_TO_SPEED, { press: BTN.sprint, hold: BTN.sprint });
    // Within a seam in the ground: the bull's round-bottomed collider rides a few millimetres over one.
    expect(p.loco!.speed).toBeCloseTo(17, 1);
    drive(w, 30);
    expect(p.riding!.gallop).toBe(true);
    expect(p.loco!.speed).toBeCloseTo(17, 1);
    w.dispose();
  });

  it('a button already held when the rider sits down, or before the stick moves, still gallops', async () => {
    const { w, p } = await saddled();
    drive(w, 5, { move: STILL, hold: BTN.sprint });
    expect(p.riding!.gallop).toBe(false);
    drive(w, 2, { hold: BTN.sprint });
    expect(p.riding!.gallop).toBe(true);
    w.dispose();
  });

  it('the press that stops the gallop stays stopped while the button is still down', async () => {
    const { w, p } = await saddled();
    drive(w, 10);
    tap(w);
    drive(w, 10);
    drive(w, 40, { press: BTN.sprint, hold: BTN.sprint });
    expect(p.riding!.gallop).toBe(false);
    drive(w, 3); // released
    tap(w);
    expect(p.riding!.gallop).toBe(true);
    w.dispose();
  });

  it('a tap at a standstill with the stick at rest does nothing', async () => {
    const { w, p } = await saddled();
    tap(w, { move: STILL });
    drive(w, 5, { move: STILL });
    expect(p.riding!.gallop).toBe(false);
    drive(w, 30);
    expect(p.loco!.speed).toBeLessThanOrEqual(MOUNT.trotSpeed + 1e-6);
    w.dispose();
  });

  it('coming to a stop ends it; steering through neutral at speed does not', async () => {
    const { w, p } = await saddled();
    drive(w, 10);
    tap(w);
    drive(w, UP_TO_SPEED);
    drive(w, 6, { move: STILL }); // a stick flicked through the centre
    expect(p.riding!.gallop).toBe(true);
    drive(w, 20);
    expect(p.riding!.gallop).toBe(true);
    drive(w, 90, { move: STILL });
    expect(p.loco!.speed).toBeLessThan(0.01);
    expect(p.riding!.gallop).toBe(false);
    drive(w, UP_TO_SPEED);
    expect(p.loco!.speed).toBeCloseTo(MOUNT.trotSpeed, 2);
    w.dispose();
  });

  it('dismounting ends it, and the next ride starts at a trot', async () => {
    const { w, p, bull } = await saddled();
    drive(w, 10);
    tap(w);
    drive(w, 30);
    step(w, { ...command({}), pressed: BTN.interact, held: BTN.interact });
    expect(p.riding?.state).toBe('dismounting');
    expect(p.riding!.gallop).toBe(false);
    stepN(w, MOUNT.dismountTicks + 2);
    expect(p.riding).toBeUndefined();
    expect(p.loco!.sprinting).toBe(false);
    standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
    step(w, interact());
    stepN(w, MOUNT.mountTicks + 1);
    expect(p.riding).toMatchObject({ state: 'riding', gallop: false });
    w.dispose();
  });

  it('dying ends it', async () => {
    const { w, p, bull } = await saddled();
    drive(w, 10);
    tap(w);
    drive(w, 30);
    p.vitals!.hp = 0;
    p.combat!.action = { kind: 'dead', t: 0 };
    step(w);
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    expect(p.loco!.sprinting).toBe(false);
    w.dispose();
  });
});

describe('no energy', () => {
  it('a gallop spends no stamina, and stamina refills in the saddle at the normal rate', async () => {
    const { w, p } = await saddled();
    drive(w, 10);
    tap(w);
    drive(w, UP_TO_SPEED);
    p.vitals!.stamina = 20;
    p.vitals!.staminaDelay = 0;
    drive(w, 60);
    expect(p.loco!.sprinting).toBe(true);
    expect(p.vitals!.stamina).toBeCloseTo(20 + PLAYER_STATS.staminaRegen, 5);
    w.dispose();
  });

  it('gallops indefinitely from 0 stamina: two minutes round the field, never slowing', async () => {
    const { w, p } = await saddled();
    w.teleportPlayer(0, { x: 256, y: VILLAGE_Y + 0.05, z: 86 });
    p.vitals!.stamina = 0;
    p.vitals!.staminaDelay = 1e9; // Stamina stays empty: nothing can come from a refill.
    const radius = 170;
    const yawAt = (i: number) => Math.PI / 2 - (i * DT * MOUNT.gallopSpeed) / radius;
    tap(w, { camYaw: yawAt(0) });
    const total = 7200;
    let covered = 0;
    for (let i = 1; i < total; i++) {
      step(w, command({ camYaw: yawAt(i) }));
      expect(p.vitals!.stamina).toBe(0);
      expect(p.riding!.gallop).toBe(true);
      if (i <= UP_TO_SPEED) continue;
      expect(p.loco!.speed).toBeGreaterThan(16.5);
      covered += p.loco!.speed * DT;
    }
    expect(covered / ((total - 1 - UP_TO_SPEED) * DT)).toBeGreaterThan(16.9);
    w.dispose();
  }, 60_000);

  it('on foot, 0 stamina still means no sprint', async () => {
    const { w, p } = await field();
    w.teleportPlayer(0, { x: 256, y: VILLAGE_Y + 0.05, z: 20 });
    p.vitals!.stamina = 0;
    p.vitals!.staminaDelay = 1e9;
    drive(w, 40, { hold: BTN.sprint });
    expect(p.loco!.sprinting).toBe(false);
    expect(p.loco!.speed).toBeCloseTo(MOVE.runSpeed, 2);
    w.dispose();
  });
});

describe('on foot nothing changed', () => {
  it('runs, sprints and spends stamina as before', async () => {
    const { w, p } = await field();
    w.teleportPlayer(0, { x: 256, y: VILLAGE_Y + 0.05, z: 20 });
    drive(w, 44);
    expect(p.loco!.speed).toBeCloseTo(MOVE.runSpeed, 2);
    const before = p.vitals!.stamina;
    drive(w, 40, { hold: BTN.sprint });
    expect(p.loco!.speed).toBeCloseTo(MOVE.sprintSpeed, 2);
    expect(p.vitals!.stamina).toBeCloseTo(before - (PLAYER_STATS.sprintCost * 40) / 60, 2);
    // A tap is not a toggle on foot.
    drive(w, 40);
    expect(p.loco!.sprinting).toBe(false);
    expect(p.loco!.speed).toBeCloseTo(MOVE.runSpeed, 2);
    w.dispose();
  });
});

describe('fighting from a gallop', () => {
  async function galloping() {
    const f = await saddled();
    drive(f.w, 10);
    tap(f.w);
    drive(f.w, UP_TO_SPEED);
    return f;
  }

  it('melee swings without ending the gallop, at the bull\'s action speed', async () => {
    const { w, p } = await galloping();
    drive(w, 12, { press: BTN.light });
    expect(p.combat!.action?.kind).toBe('attack');
    expect(p.riding!.gallop).toBe(true);
    expect(p.loco!.speed).toBeGreaterThan(MOUNT.gallopSpeed * MOUNT.actionMove - 0.5);
    drive(w, 120);
    expect(p.combat!.action).toBeNull();
    expect(p.loco!.speed).toBeCloseTo(17, 1);
    w.dispose();
  });

  it('magic casts from a gallop', async () => {
    const { w, p } = await galloping();
    const ev = drive(w, 30, { press: BTN.spell1 });
    expect(ev.some((e) => e.type === 'cast' && e.entity === p.id)).toBe(true);
    expect(p.riding!.gallop).toBe(true);
    w.dispose();
  });

  it('block holds the gallop on and lets go back to full speed', async () => {
    const { w, p } = await galloping();
    drive(w, 30, { press: BTN.block, hold: BTN.block });
    expect(p.combat!.action?.kind).toBe('block');
    expect(p.loco!.speed).toBeCloseTo(MOUNT.gallopSpeed * MOUNT.actionMove, 1);
    drive(w, 60);
    expect(p.loco!.speed).toBeCloseTo(17, 1);
    w.dispose();
  });

  it('a dodge swerves with the bull\'s momentum instead of stopping it', async () => {
    const { w, p, bull } = await galloping();
    const z0 = p.tf.pos.z;
    const ev = drive(w, 1, { press: BTN.dodge, move: { x: 1, y: 0 } });
    expect(ev.some((e) => e.type === 'dodge')).toBe(true);
    expect(p.combat!.action?.kind).toBe('dodge');
    let least = Infinity;
    for (let i = 0; i < 60 && p.combat!.action; i++) {
      step(w, command({ move: { x: 1, y: 0 } }));
      least = Math.min(least, Math.hypot(p.tf.vel.x, p.tf.vel.z));
      expect(p.loco!.speed).toBeLessThanOrEqual(MOUNT.gallopSpeed * MOUNT.dodgeScale + 1e-6);
    }
    expect(least).toBeGreaterThan(MOUNT.trotSpeed * 0.8);
    expect(p.tf.pos.z - z0).toBeGreaterThan(3); // it kept going forward through the swerve
    expect(p.riding!.gallop).toBe(true);
    expect(p.riding!.carry).toBeUndefined();
    expect(bull.tf.pos).toEqual(p.tf.pos);
    w.dispose();
  });

  it('a dodge at a standstill is the same side-charge it always was', async () => {
    const { w, p } = await saddled();
    drive(w, 1, { press: BTN.dodge, move: { x: 1, y: 0 } });
    expect(p.combat!.action?.kind).toBe('dodge');
    step(w, command({ move: { x: 1, y: 0 } }));
    expect(p.riding!.carry).toBeDefined();
    expect(p.loco!.speed).toBeGreaterThan(MOVE.sprintSpeed);
    w.dispose();
  });
});

describe('handling at speed', () => {
  const heading = (p: Entity) => Math.atan2(p.tf.vel.x, p.tf.vel.z);

  it('takes over a second to reach a gallop from a standstill: it has weight', async () => {
    const { w, p } = await saddled();
    tap(w);
    let ticks = 1;
    while (p.loco!.speed < 16.9 && ticks < 300) {
      step(w, command({}));
      ticks++;
    }
    expect(ticks * DT).toBeGreaterThan(1);
    expect(ticks * DT).toBeLessThan(1.6);
    w.dispose();
  });

  it('pulls up from a full gallop in under a second and under 8 m', async () => {
    const { w, p } = await saddled();
    tap(w);
    drive(w, UP_TO_SPEED);
    const z0 = p.tf.pos.z;
    let ticks = 0;
    while (p.loco!.speed > 0.01 && ticks < 200) {
      step(w, command({ move: STILL }));
      ticks++;
    }
    expect(ticks * DT).toBeLessThan(1);
    expect(p.tf.pos.z - z0).toBeLessThan(8);
    expect(p.tf.pos.z - z0).toBeGreaterThan(5);
    w.dispose();
  });

  it('carves a 90° turn at a gallop in about a second, on a wide but controllable arc', async () => {
    const { w, p } = await saddled();
    tap(w);
    drive(w, UP_TO_SPEED);
    const x0 = p.tf.pos.x;
    let ticks = 0;
    while (Math.abs(heading(p) - Math.PI / 2) > 0.02 && ticks < 200) {
      step(w, command({ move: { x: -1, y: 0 } })); // Camera right is world -X at yaw 0: steer toward +X.
      ticks++;
    }
    expect(ticks * DT).toBeGreaterThan(0.6);
    expect(ticks * DT).toBeLessThan(1.2);
    expect(p.tf.pos.x - x0).toBeGreaterThan(4); // an arc, not a pivot
    expect(p.tf.pos.x - x0).toBeLessThan(14);
    expect(p.loco!.speed).toBeGreaterThan(9);
    w.dispose();
  });

  it('turns right round from a full gallop within two seconds', async () => {
    const { w, p } = await saddled();
    tap(w);
    drive(w, UP_TO_SPEED);
    let ticks = 0;
    while (!(p.tf.vel.z < -8) && ticks < 240) {
      step(w, command({ move: { x: 0, y: -1 } }));
      ticks++;
    }
    expect(ticks * DT).toBeLessThan(2);
    expect(p.riding!.gallop).toBe(true);
    w.dispose();
  });

  it('the body follows the line it is running', async () => {
    const { w, p } = await saddled();
    tap(w);
    drive(w, UP_TO_SPEED);
    drive(w, 40, { move: { x: -1, y: 0 } });
    expect(Math.abs(Math.sin(p.tf.yaw - heading(p)))).toBeLessThan(0.25);
    w.dispose();
  });
});

describe('a gallop replays and restores', () => {
  const route = (w: SimWorld, n: number) => {
    for (let i = 0; i < n; i++) step(w, command({ camYaw: Math.sin(i / 40) * 0.6, press: i % 170 === 5 ? BTN.sprint : i % 170 === 100 ? BTN.light : 0 }));
  };

  it('the same inputs give the same world', async () => {
    const a = await saddled(5);
    const b = await saddled(5);
    route(a.w, 400);
    route(b.w, 400);
    expect(a.w.hash()).toBe(b.w.hash());
    a.w.dispose();
    b.w.dispose();
  });

  it('the toggle is plain data: a snapshot taken mid-gallop restores it, and the replay matches', async () => {
    const { w, p } = await saddled(3);
    drive(w, 10);
    tap(w);
    drive(w, 40);
    expect(p.riding!.gallop).toBe(true);
    const snap = w.snapshot();
    const hash = w.hash();
    expect(structuredClone(p.riding)).toEqual(p.riding);
    route(w, 150);
    const after = w.hash();
    tap(w); // Change what happened after the snapshot, then rewind it away.
    w.restore(snap);
    expect(w.hash()).toBe(hash);
    const q = w.playerEntity(0)!;
    expect(q.riding).toMatchObject({ state: 'riding', gallop: true });
    route(w, 150);
    expect(w.hash()).toBe(after);
    w.dispose();
  });

  it('the toggle counts toward the world hash', async () => {
    const { w, p } = await saddled(3);
    drive(w, 10);
    const off = w.hash();
    p.riding!.gallop = true;
    expect(w.hash()).not.toBe(off);
    w.dispose();
  });
});

describe('the gallop prompt', () => {
  it('names the button for the device in use', () => {
    expect(promptLabel('kbm', 'xbox', KEYS.sprint, PAD.sprint)).toBe('L Shift');
    expect(promptLabel('gamepad', 'xbox', KEYS.sprint, PAD.sprint)).toBe('LS');
    expect(promptLabel('gamepad', 'playstation', KEYS.sprint, PAD.sprint)).toBe('L3');
  });

  it('says what the button does next', () => {
    expect(gallopLabel(false)).toBe('Gallop');
    expect(gallopLabel(true)).toBe('Slow to a trot');
  });
});
