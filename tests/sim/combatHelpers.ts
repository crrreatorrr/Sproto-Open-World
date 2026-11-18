import { SANDBOX, type LevelDef } from '../../src/content/sandbox';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Action, Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import type { Vec3 } from '../../src/sim/math';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';

/** Combat test helpers: small explicit worlds, one scripted command per tick, events per tick. */

export interface CombatWorld {
  w: SimWorld;
  /** Player 0's entity. */
  p: Entity;
}

/** A sandbox world (no populate) with player 0 at `pos` facing `yaw`. */
export async function combatWorld(opts: { pos?: Vec3; yaw?: number; seed?: number; level?: LevelDef } = {}): Promise<CombatWorld> {
  await initPhysics();
  const w = new SimWorld(opts.level ?? SANDBOX, opts.seed ?? 1);
  const p = w.spawnPlayer(0, opts.pos ?? { x: 0, y: 0, z: 0 }, opts.yaw ?? 0);
  return { w, p };
}

export interface CmdOpts {
  /** Buttons that go down this tick (they are also held). */
  press?: number;
  /** Buttons held this tick. */
  hold?: number;
  move?: { x: number; y: number };
  camYaw?: number;
  lockSwitch?: number;
}

export function cmd(o: CmdOpts = {}): InputCommand {
  const c = idleInput(o.camYaw ?? 0);
  c.pressed = o.press ?? 0;
  c.held = (o.hold ?? 0) | c.pressed;
  if (o.move) c.move = { ...o.move };
  c.lockSwitch = o.lockSwitch ?? 0;
  return c;
}

export const press = (b: number, extra: CmdOpts = {}): InputCommand => cmd({ ...extra, press: b });
export const hold = (b: number, extra: CmdOpts = {}): InputCommand => cmd({ ...extra, hold: b });
export const idle = (): InputCommand => cmd();
export { BTN };

/** Advance one tick with player 0's command; returns that tick's events. */
export function step(w: SimWorld, c: InputCommand = idle()): SimEvent[] {
  w.tick(new Map([[0, c]]));
  return w.events;
}

export interface TickEvents {
  /** World tick the event happened on (`w.now` before the tick). */
  tick: number;
  ev: SimEvent;
}

/** Advance `n` ticks; `input(i)` gives the command for the i-th of them. Returns all events. */
export function stepN(w: SimWorld, n: number, input: (i: number) => InputCommand = idle): TickEvents[] {
  const out: TickEvents[] = [];
  for (let i = 0; i < n; i++) {
    const tick = w.now;
    for (const ev of step(w, input(i))) out.push({ tick, ev });
  }
  return out;
}

/**
 * Advance until `pred` holds after a tick (at most `max` ticks). Returns the tick it held on
 * (`w.now - 1`), or throws.
 */
export function stepUntil(w: SimWorld, pred: (events: SimEvent[]) => boolean, max = 600, input: (i: number) => InputCommand = idle): number {
  for (let i = 0; i < max; i++) {
    const ev = step(w, input(i));
    if (pred(ev)) return w.now - 1;
  }
  throw new Error(`condition not met within ${max} ticks`);
}

/** Find the first future tick (relative to now) where `pred` holds, then rewind the world. */
export function lookahead(w: SimWorld, pred: (events: SimEvent[]) => boolean, max = 600, input: (i: number) => InputCommand = idle): number {
  const snap = w.snapshot();
  const start = w.now;
  try {
    return stepUntil(w, pred, max, input) - start;
  } finally {
    w.restore(snap);
  }
}

export type AttackAction = Extract<Action, { kind: 'attack' }>;

export function attack(e: Entity): AttackAction | null {
  const a = e.combat!.action;
  return a?.kind === 'attack' ? a : null;
}

/** Re-fetch an entity after a restore (restore replaces entity objects). */
export function ent(w: SimWorld, id: number): Entity {
  const e = w.get(id);
  if (!e) throw new Error(`no entity ${id}`);
  return e;
}

export function player(w: SimWorld): Entity {
  return w.playerEntity(0)!;
}

/** Move an entity and its Rapier capsule (test setup only). */
export function teleport(w: SimWorld, e: Entity, pos: Vec3): void {
  e.tf.pos = { ...pos };
  e.tf.prevPos = { ...pos };
  w.physics.teleport(e.id, pos);
}

/** Put an enemy straight into one of its moves (test setup only: skips the AI's pick). */
export function forceEnemyAttack(e: Entity, move: string): void {
  e.combat!.action = { kind: 'attack', move, t: 0, clipT: 0, charge: 0, charging: false, charged: false, hit: [], lunge: 0, lungeDir: { x: 0, z: 0 } };
}

export const hitsOn = (events: readonly TickEvents[], target: number) =>
  events.filter((x): x is TickEvents & { ev: Extract<SimEvent, { type: 'hit' }> } => x.ev.type === 'hit' && x.ev.target === target);

export const ofType = <T extends SimEvent['type']>(events: readonly TickEvents[], type: T) =>
  events.filter((x): x is TickEvents & { ev: Extract<SimEvent, { type: T }> } => x.ev.type === type);

/** Unit vector position at `deg` degrees of yaw (0 = +Z, +90 = +X, which is to the left) and `dist` m. */
export function atYaw(deg: number, dist: number): Vec3 {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r) * dist, y: 0, z: Math.cos(r) * dist };
}
