import { CELL_RES, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { SPROUTVALE_CONTENT, type RegionContent } from '../../src/content/world/sproutvaleContent';
import { BTN, idleInput, type InputCommand, type UiAction } from '../../src/sim/commands';
import type { Entity, Progress } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import type { RpgCtx } from '../../src/sim/systems/rpg';
import { SimWorld } from '../../src/sim/SimWorld';
import { step, stepN, type TickEvents } from './combatHelpers';

/** M3 test helpers: the Sproutvale village run headlessly on flat cells, driven by commands. */

export const VILLAGE_Y = 13.5;
export const VILLAGE_START: [number, number, number] = [256, VILLAGE_Y, 58];

function flatCell(cx: number, cz: number, h: number): CellColliders {
  return { cx, cz, heights: new Float32Array(CELL_RES * CELL_RES).fill(h), shapes: [] };
}

export interface Village {
  w: SimWorld;
  p: Entity;
  /** Player 0's progress (re-read after applySave / restore: those replace it). */
  prog(): Progress;
}

/**
 * The village: a streamed world with flat ground at y 13.5 over cells cx 3–4, cz 0–1 (x 192–320,
 * z 0–128), built, then the region content populated. `content` defaults to SPROUTVALE_CONTENT.
 */
export async function village(opts: { seed?: number; content?: RegionContent; populate?: boolean } = {}): Promise<Village> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: VILLAGE_START, yaw: 0 } }), opts.seed ?? 1);
  w.spawnPlayer(0);
  for (let cx = 3; cx <= 4; cx++) for (let cz = 0; cz <= 1; cz++) w.loadCell(flatCell(cx, cz, VILLAGE_Y));
  for (let i = 0; i < 3; i++) w.tick(new Map([[0, idleInput(0)]]));
  if (opts.populate !== false) w.populateWorld(opts.content ?? SPROUTVALE_CONTENT);
  const p = w.playerEntity(0)!;
  return { w, p, prog: () => w.playerEntity(0)!.progress! };
}

/** Yaw that faces from (x0, z0) toward (x1, z1) (0 = +Z, +π/2 = +X). */
export const yawTo = (x0: number, z0: number, x1: number, z1: number) => Math.atan2(x1 - x0, z1 - z0);

/** Teleport player 0 to (x, z) on the plateau facing (tx, tz) (test setup, like the QA teleport). */
export function stand(w: SimWorld, x: number, z: number, face?: { x: number; z: number }): void {
  w.teleportPlayer(0, { x, y: VILLAGE_Y + 0.05, z });
  const e = w.playerEntity(0)!;
  if (face) e.tf.yaw = e.tf.prevYaw = yawTo(x, z, face.x, face.z);
}

/** Stand `dist` m south (−Z) of a content id's position, facing it. */
export function standBy(w: SimWorld, id: string, dist = 1.5): void {
  const at = w.locate(id);
  if (!at) throw new Error(`nothing called ${id}`);
  stand(w, at.x, at.z - dist, { x: at.x, z: at.z });
}

/** A command with menu intents (and optional pressed buttons). */
export function ui(actions: UiAction[], pressed = 0): InputCommand {
  const c = idleInput(0);
  c.ui = actions;
  c.pressed = pressed;
  c.held = pressed;
  return c;
}

export const interact = (): InputCommand => ui([], BTN.interact);
export const choose = (choice: number): InputCommand => ui([{ kind: 'dialogueChoose', choice }]);

/** One tick with this command; returns the tick's events. */
export const tick1 = (w: SimWorld, c: InputCommand = idleInput(0)): SimEvent[] => step(w, c);

export const evs = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

export const flat = (t: readonly TickEvents[]) => t.map((x) => x.ev);

/** Quest events (started / progress / step / complete) reduced to comparable tuples. */
export function questTrail(events: readonly SimEvent[]): (string | number | number[])[][] {
  const out: (string | number | number[])[][] = [];
  for (const e of events) {
    if (e.type === 'questStarted') out.push(['started', e.quest]);
    else if (e.type === 'questProgress') out.push(['progress', e.quest, e.step, e.progress]);
    else if (e.type === 'questStep') out.push(['step', e.quest, e.step]);
    else if (e.type === 'questComplete') out.push(['complete', e.quest]);
  }
  return out;
}

/** A light combo on whatever is in front, until `target` dies (at most `max` ticks). Returns the events. */
export function breakIt(w: SimWorld, target: Entity, max = 240): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    const c = idleInput(0);
    if (i % 24 === 0) {
      c.pressed = BTN.light;
      c.held = BTN.light;
    }
    out.push(...step(w, c));
    if (target.combat?.action?.kind === 'dead') {
      out.push(...settle(w));
      return out;
    }
  }
  throw new Error(`entity ${target.id} still standing after ${max} ticks`);
}

/** Idle until player 0 is free (no action, no hit-stop): its presses would be dropped while frozen. */
export function settle(w: SimWorld, max = 120): SimEvent[] {
  const p = w.playerEntity(0)!;
  const out: SimEvent[] = [];
  for (let i = 0; i < max && (p.combat!.action || p.combat!.hitstop > 0); i++) out.push(...step(w));
  return out;
}

export const runIdle = (w: SimWorld, n: number) => flat(stepN(w, n));

/** An RpgCtx over the world as it is between ticks (for calling rpg functions directly in unit tests). */
export function rpgCtx(w: SimWorld, events: SimEvent[] = []): RpgCtx & { spawned: { pos: { x: number; y: number; z: number }; pickup: NonNullable<Entity['pickup']> }[] } {
  const spawned: { pos: { x: number; y: number; z: number }; pickup: NonNullable<Entity['pickup']> }[] = [];
  return {
    now: w.now, entities: w.entities, events, world: w.world, rng: w.rng.stream('loot'),
    spawnPickup: (pos, pickup) => spawned.push({ pos: { ...pos }, pickup: { ...pickup } }),
    spawned,
  };
}

/** The dummies of the training yard, in content order. */
export const dummies = (w: SimWorld) => w.entities.filter((e) => e.brain?.def === 'dummy_straw');

/**
 * Play q_wake_up from the start to the shrine rest by commands (the acceptance-1 route, without the
 * assertions). Leaves the player at the shrine with its menu open. Returns every event.
 */
export function playWakeUp(w: SimWorld, upTo: 'accepted' | 'yard' | 'dummies' | 'chest' | 'seed' | 'done' = 'done'): SimEvent[] {
  const out: SimEvent[] = [];
  const t = (c?: InputCommand) => out.push(...step(w, c));
  standBy(w, 'elder_pepe');
  t(interact());
  t(choose(0));
  t(choose(0));
  if (upTo === 'accepted') return out;
  const yard = w.locate('training_yard')!;
  stand(w, yard.x, yard.z - 5);
  t();
  if (upTo === 'yard') return out;
  for (const d of dummies(w)) {
    stand(w, d.tf.pos.x, d.tf.pos.z - 1.5, { x: d.tf.pos.x, z: d.tf.pos.z });
    out.push(...breakIt(w, d));
  }
  if (upTo === 'dummies') return out;
  standBy(w, 'chest_training');
  t(interact());
  if (upTo === 'chest') return out;
  standBy(w, 'elder_pepe');
  t(interact());
  t(choose(0));
  t(choose(0));
  if (upTo === 'seed') return out;
  standBy(w, 'shrine_first_light');
  t(interact());
  t(ui([{ kind: 'rest' }]));
  return out;
}
