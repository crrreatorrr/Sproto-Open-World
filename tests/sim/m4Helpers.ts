import { ENEMIES } from '../../src/content/enemies';
import { CELL_RES, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { SPROUTVALE_CONTENT } from '../../src/content/world/sproutvaleContent';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { step } from './combatHelpers';
import { VILLAGE_START, VILLAGE_Y, yawTo } from './m3Helpers';

/**
 * M4 test worlds: all of Sproutvale (8 × 8 cells) as flat ground at the village height, with the
 * full region content. Placements settle onto it on the first ticks, so every camp, villager and
 * object stands at y 13.5 and the quest routes can be played by commands with teleports.
 */
export async function flatSproutvale(seed = 1): Promise<{ w: SimWorld; p: Entity }> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: VILLAGE_START, yaw: 0 } }), seed);
  w.spawnPlayer(0);
  const flat = (cx: number, cz: number): CellColliders => ({ cx, cz, heights: new Float32Array(CELL_RES * CELL_RES).fill(VILLAGE_Y), shapes: [] });
  for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) w.loadCell(flat(cx, cz));
  w.tick(new Map([[0, idleInput(0)]]));
  w.populateWorld(SPROUTVALE_CONTENT);
  for (let i = 0; i < 3; i++) w.tick(new Map([[0, idleInput(0)]]));
  return { w, p: w.playerEntity(0)! };
}

/** Put the player at (x, z) on the flat ground, facing (fx, fz) if given. */
export function standAt(w: SimWorld, x: number, z: number, face?: { x: number; z: number }): void {
  w.teleportPlayer(0, { x, y: VILLAGE_Y + 0.05, z });
  const e = w.playerEntity(0)!;
  if (face) e.tf.yaw = e.tf.prevYaw = yawTo(x, z, face.x, face.z);
}

/** Enemies of a camp (alive or not). */
export const campMembers = (w: SimWorld, camp: string) => w.entities.filter((e) => e.brain?.camp === camp);
export const alive = (e: Entity) => e.combat?.action?.kind !== 'dead';

/**
 * Kill `target` by commands: the player steps up in front of it and swings light attacks. Its HP is
 * set to 1 first (these tests are about quests and camps, not the fight; balance has its own
 * checks), and the player is kept topped up. Returns every event.
 */
export function slay(w: SimWorld, target: Entity, max = 400): SimEvent[] {
  const out: SimEvent[] = [];
  const p = w.playerEntity(0)!;
  target.vitals!.hp = 1;
  for (let i = 0; i < max && alive(target); i++) {
    // Stay on it through the swing's wind-up: Slingers back away faster than a light attack reaches.
    if (i % 30 < 14) {
      // Re-approach each swing: it may have moved, blinked or leapt.
      // Close in (ranged enemies back away from you during the swing's wind-up).
      const gap = target.body!.radius + 0.6;
      const a = yawTo(target.tf.pos.x, target.tf.pos.z, p.tf.pos.x, p.tf.pos.z);
      standAt(w, target.tf.pos.x + Math.sin(a) * gap, target.tf.pos.z + Math.cos(a) * gap, target.tf.pos);
      target.vitals!.hp = Math.min(target.vitals!.hp, 1);
    }
    const c: InputCommand = idleInput(p.tf.yaw);
    if (i % 30 === 0) {
      c.pressed = BTN.light;
      c.held = BTN.light;
    }
    out.push(...step(w, c));
    p.vitals!.hp = p.vitals!.hpMax;
    p.vitals!.stamina = p.vitals!.staminaMax;
  }
  if (alive(target)) throw new Error(`could not kill ${target.brain?.def} ${target.id}`);
  return out;
}

/** Kill `n` living enemies matching `pick`, nearest first from (x, z). */
export function slayN(w: SimWorld, n: number, pick: (e: Entity) => boolean): SimEvent[] {
  const out: SimEvent[] = [];
  for (let k = 0; k < n; k++) {
    const p = w.playerEntity(0)!;
    const next = w.entities
      .filter((e) => e.brain && alive(e) && pick(e))
      .sort((a, b) => Math.hypot(a.tf.pos.x - p.tf.pos.x, a.tf.pos.z - p.tf.pos.z) - Math.hypot(b.tf.pos.x - p.tf.pos.x, b.tf.pos.z - p.tf.pos.z))[0];
    if (!next) throw new Error(`only ${k} of ${n} left to kill`);
    out.push(...slay(w, next));
  }
  return out;
}

/** Walk over every pickup on the ground (teleporting onto each), a tick per pickup. */
export function collectPickups(w: SimWorld): SimEvent[] {
  const out: SimEvent[] = [];
  for (const pk of w.entities.filter((e) => e.pickup)) {
    standAt(w, pk.tf.pos.x, pk.tf.pos.z);
    out.push(...step(w));
  }
  return out;
}

/** Hold block so it's a few ticks old when the swinging dummy's swing lands: a parry. */
export function parrySwing(w: SimWorld, dummy: Entity, max = 400): SimEvent[] {
  const out: SimEvent[] = [];
  const move = ENEMIES[dummy.brain!.def].moves[0];
  standAt(w, dummy.tf.pos.x + Math.sin(dummy.tf.yaw) * 1.5, dummy.tf.pos.z + Math.cos(dummy.tf.yaw) * 1.5, dummy.tf.pos);
  for (let i = 0; i < max; i++) {
    const a = dummy.combat!.action;
    const c = idleInput(w.playerEntity(0)!.tf.yaw);
    if (a?.kind === 'attack' && a.t >= move.windup - 3) {
      c.held = BTN.block;
      if (a.t === move.windup - 3) c.pressed = BTN.block;
    }
    const ev = step(w, c);
    out.push(...ev);
    if (ev.some((e) => e.type === 'parry')) return out;
  }
  throw new Error('no parry');
}
