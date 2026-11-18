import { PLAYER_MOVES, clipTiming, type PlayerMoveId } from '../../content/combat';
import { ENEMIES, type EnemyDef } from '../../content/enemies';
import type { AiStyle } from '../../content/packs/aiStyles';
import { DT } from '../../content/tuning';
import { flatDist, yawTo } from '../combat/geometry';
import type { CombatCtx } from '../combat/playerCombat';
import type { Entity, EntityId, FightState } from '../entity';
import { clamp, wrapAngle } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { next as rngNext, range as rngRange, type RngState } from '../rng';

/** Hits further apart than this (ticks) don't add up. */
const HIT_MEMORY = 150;
/** A player below this share of their stamina is tired. */
const TIRED = 0.25;
/** Only enemies this close to their target take a place in the ring (m). */
const RING_RANGE = 16;
/** Near enough to its place in the ring (radians) that it stops correcting: no twitching on the spot. */
const RING_DEADBAND = 0.12;
/** How quickly footwork reaches the speed it asks for (share per tick). */
const EASE = 0.2;
/** Slower than this share of the speed it asked for, for this many ticks, and it is stuck. */
const STUCK_SHARE = 0.3;
const STUCK_TICKS = 18;
const DETOUR_TICKS = 60;
const DETOUR_ANGLE = 1.2;
/** Still walled off when a detour ends: this many more ticks round the obstacle. */
const DETOUR_EXTEND = 30;
/** The ledge check: a ray from this far above the feet (m), and the deepest drop it will step down. */
const PROBE_UP = 2.5;
const MAX_DROP = 1.6;
const DOWN = { x: 0, y: -1, z: 0 };
/** It stops walking outward this far inside its leash (m), so a fight doesn't end in a walk home. */
const LEASH_MARGIN = 2.5;
/** Stopped by a ledge, a wall or its leash, it counts as cornered for this long (ticks). */
const CORNERED_TICKS = 30;
/** Ranged enemies check their line of fire this often (ticks). */
const SIGHT_EVERY = 12;

export function newFight(e: Readonly<Entity>): FightState {
  return {
    foot: 'strafe', footT: 0,
    burst: null, burstT: 0, burstX: 0, burstZ: 0, burstSpeed: 0,
    lungeCd: 0, evadeCd: 0, punishCd: 0, eager: 0,
    hits: 0, hitAge: 0, poise: e.combat!.poise,
    holdAt: 0, hold: 0, feintAt: -1, feinted: false,
    vx: 0, vz: 0, lastX: e.tf.pos.x, lastZ: e.tf.pos.z, stuck: 0, detour: 0, detourDir: 1, cornered: 0,
    sight: true, blind: 0,
  };
}

/** Every tick, whatever it is doing: its cooldowns run and it notices being hit (its poise dropped). */
export function fightClock(e: Entity): void {
  const f = e.brain!.fight;
  if (!f) return;
  if (f.lungeCd > 0) f.lungeCd--;
  if (f.evadeCd > 0) f.evadeCd--;
  if (f.punishCd > 0) f.punishCd--;
  if (f.eager > 0) f.eager--;
  const poise = e.combat!.poise;
  if (poise < f.poise) {
    f.hits++;
    f.hitAge = 0;
  } else if (f.hits > 0 && ++f.hitAge > HIT_MEMORY) f.hits = 0;
  f.poise = poise;
}

/** What an enemy can see its target doing. `retreat`: how fast it is moving away from this enemy (m/s). */
export interface TargetRead {
  drinking: boolean;
  whiffing: boolean;
  tired: boolean;
  retreat: number;
}

export function readTarget(t: Readonly<Entity>, e: Readonly<Entity>): TargetRead {
  const a = t.combat?.action;
  let whiffing = false;
  if (a?.kind === 'attack' && a.hit.length === 0) {
    const move = PLAYER_MOVES[a.move as PlayerMoveId];
    if (move) whiffing = a.clipT >= clipTiming(move.clip).activeEnd;
  }
  const dx = t.tf.pos.x - e.tf.pos.x, dz = t.tf.pos.z - e.tf.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  return {
    drinking: a?.kind === 'drink',
    whiffing,
    tired: !!t.vitals && t.vitals.stamina < t.vitals.staminaMax * TIRED,
    retreat: (dx * t.tf.vel.x + dz * t.tf.vel.z) / d,
  };
}

/** Moves on to the next footwork beat when this one has run out. */
export function nextBeat(f: FightState, e: Entity, style: AiStyle, rng: RngState): void {
  if (--f.footT > 0) return;
  const { strafe, in: forward, out, hold } = style.feet;
  const roll = rngNext(rng) * (strafe + forward + out + hold);
  f.foot = roll < strafe ? 'strafe' : roll < strafe + forward ? 'in' : roll < strafe + forward + out ? 'out' : 'hold';
  f.footT = rngRange(rng, style.beat[0], style.beat[1]);
  if (f.foot === 'strafe' && rngNext(rng) < 0.35) e.brain!.circleDir = -e.brain!.circleDir;
}

/**
 * Each enemy's place in the ring around its target (a bearing, radians): spaced evenly and handed out
 * in the order they already stand, so nobody has to cross the circle. Melee and ranged form separate rings.
 */
export function ringSlots(ctx: CombatCtx): Map<EntityId, number> {
  const groups = new Map<number, { id: EntityId; bearing: number }[]>();
  for (const e of ctx.entities) {
    const b = e.brain;
    if (!b || b.state !== 'engage' || b.target === null || e.combat?.action?.kind === 'dead') continue;
    const def = ENEMIES[b.def];
    if (def.dummy || def.boss || def.drake) continue;
    const t = ctx.get(b.target);
    if (!t || flatDist(e.tf.pos, t.tf.pos) > RING_RANGE) continue;
    const key = b.target * 2 + (def.keepRange ? 1 : 0);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = []));
    group.push({ id: e.id, bearing: yawTo(t.tf.pos, e.tf.pos) });
  }
  const slots = new Map<EntityId, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.bearing - b.bearing || a.id - b.id);
    const step = (Math.PI * 2) / group.length;
    let s = 0, c = 0;
    group.forEach((m, i) => {
      s += Math.sin(m.bearing - i * step);
      c += Math.cos(m.bearing - i * step);
    });
    const offset = Math.atan2(s, c);
    group.forEach((m, i) => slots.set(m.id, offset + i * step));
  }
  return slots;
}

/** Which way, and how hard (-1..1), to step sideways toward its place in the ring. */
export function slotPull(e: Readonly<Entity>, target: Readonly<Entity>, slots: ReadonlyMap<EntityId, number>): number {
  const slot = slots.get(e.id);
  if (slot === undefined) return 0;
  const err = wrapAngle(slot - yawTo(target.tf.pos, e.tf.pos));
  // A positive sideways step (see `orbit` in the brain) moves it to a smaller bearing.
  return Math.abs(err) < RING_DEADBAND ? 0 : clamp(-err * 1.5, -1, 1);
}

/** Is there ground to stand on at (x, z), no deeper than a step down from its feet? */
export function groundAt(e: Readonly<Entity>, physics: PhysicsWorld, x: number, z: number): boolean {
  return !!physics.raycast({ x, y: e.tf.pos.y + PROBE_UP, z }, DOWN, PROBE_UP + MAX_DROP);
}

/** Is there a wall right in front of it, along (dx, dz)? */
function wallAhead(e: Readonly<Entity>, physics: PhysicsWorld, dx: number, dz: number): boolean {
  const from = { x: e.tf.pos.x, y: e.tf.pos.y + 0.9, z: e.tf.pos.z };
  return !!physics.raycast(from, { x: dx, y: 0, z: dz }, (e.body?.radius ?? 0.4) + 1.5);
}

/**
 * All of a fighter's movement goes through here. It walks round whatever it is stuck on, keeps inside
 * its leash, stops at a ledge, and eases into speed so its feet never twitch.
 */
export function drive(ctx: CombatCtx, e: Entity, def: EnemyDef, physics: PhysicsWorld, wantX: number, wantZ: number, ease = EASE): void {
  const b = e.brain!;
  const f = b.fight!;
  const pos = e.tf.pos;
  let vx = wantX, vz = wantZ;
  const wanted = Math.hypot(vx, vz);

  const asked = Math.hypot(f.vx, f.vz) * DT;
  if (asked > 0.012 && Math.hypot(pos.x - f.lastX, pos.z - f.lastZ) < asked * STUCK_SHARE) {
    if (++f.stuck >= STUCK_TICKS) {
      f.stuck = 0;
      // Stuck again mid-detour: that way is blocked too. Otherwise keep going round the same side.
      if (f.detour > 0) f.detourDir = -f.detourDir;
      f.detour = DETOUR_TICKS;
      b.circleDir = -b.circleDir;
    }
  } else if (f.stuck > 0) f.stuck--;
  f.lastX = pos.x;
  f.lastZ = pos.z;
  if (f.detour > 0) {
    if (f.detour === 1 && wallAhead(e, physics, vx, vz)) f.detour += DETOUR_EXTEND;
    f.detour--;
    const a = DETOUR_ANGLE * f.detourDir;
    const c = Math.cos(a), s = Math.sin(a);
    [vx, vz] = [vx * c + vz * s, -vx * s + vz * c];
  }

  const hx = pos.x - b.home.x, hz = pos.z - b.home.z;
  const fromHome = Math.hypot(hx, hz);
  if (fromHome > def.leashRange - LEASH_MARGIN) {
    const out = (vx * hx + vz * hz) / fromHome;
    if (out > 0) {
      vx -= (hx / fromHome) * out;
      vz -= (hz / fromHome) * out;
    }
  }

  const speed = Math.hypot(vx, vz);
  if (wanted > 0.3 && speed < wanted * 0.4) f.cornered = CORNERED_TICKS;
  else if (f.cornered > 0) f.cornered--;
  if (speed > 0.05) {
    const reach = (e.body?.radius ?? 0.4) + 0.5 + speed * 0.12;
    if (!groundAt(e, physics, pos.x + (vx / speed) * reach, pos.z + (vz / speed) * reach)) {
      f.cornered = CORNERED_TICKS;
      f.vx = f.vz = 0;
      if (f.foot === 'strafe') b.circleDir = -b.circleDir;
      ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
      return;
    }
  }
  f.vx += (vx - f.vx) * ease;
  f.vz += (vz - f.vz) * ease;
  ctx.motion.set(e.id, { vx: f.vx, vz: f.vz, inputScale: 0 });
}

/** A ranged enemy looks down its line of fire every few ticks. */
export function lookForTarget(ctx: CombatCtx, e: Entity, target: Readonly<Entity>, physics: PhysicsWorld): void {
  const f = e.brain!.fight!;
  if ((ctx.now + e.id) % SIGHT_EVERY !== 0) return;
  const from = { x: e.tf.pos.x, y: e.tf.pos.y + (e.body?.height ?? 1.8) * 0.75, z: e.tf.pos.z };
  const dir = { x: target.tf.pos.x - from.x, y: target.tf.pos.y + (target.body?.height ?? 1.8) * 0.55 - from.y, z: target.tf.pos.z - from.z };
  f.sight = !physics.raycast(from, dir, Math.hypot(dir.x, dir.y, dir.z));
  f.blind = f.sight ? 0 : f.blind + SIGHT_EVERY;
}
