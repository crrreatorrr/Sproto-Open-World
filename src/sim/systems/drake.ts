import type { EnemyDef, EnemyMoveDef } from '../../content/enemies';
import { DT } from '../../content/tuning';
import { flatDist, yawTo } from '../combat/geometry';
import type { CombatCtx } from '../combat/playerCombat';
import type { Action, DrakeFlight, Entity } from '../entity';
import { clamp, turnToward, type Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { next as rngNext, type RngState } from '../rng';
import { bossSpeed, pickMove, type BossHost } from './boss';

/** What the enemy brain lends the Drake: its target pick and its attack runner. */
export interface DrakeHooks {
  target(): Entity | null;
  start(ctx: CombatCtx, e: Entity, move: EnemyMoveDef, target: Entity | null): void;
  run(target: Entity | null): void;
}

type Attack = Extract<Action, { kind: 'attack' }>;
type Stagger = Extract<Action, { kind: 'stagger' }>;
type Held = Extract<Action, { kind: 'stagger' | 'hitstun' | 'frozen' }>;
type Lane = NonNullable<DrakeFlight['lane']>;

/** Before the bait is set it waits this far above the arena (m): no view, no collider in anyone's way. */
const ASLEEP_ABOVE = 240;
/** The intro starts this far above the arena's rim (m). */
const INTRO_HEIGHT = 50;
/** Ground rays start this far above home (m) and reach twice as far. */
const RAY_FROM = 80;
const GROUND_SMOOTH = 0.1;
const DOWN = { x: 0, y: -1, z: 0 };
/** How fast the circle's centre drifts after the player (fraction per tick). */
const CENTRE_FOLLOW = 0.012;
/** Rate of the slow climb and sink between the two cruising heights (radians per tick). */
const ALTITUDE_RATE = 0.012;
/** Off its circle (after a dive) it flies up to this much faster, at this many metres away. */
const CATCH_UP_MAX = 2.6;
const CATCH_UP_DIST = 8;
/** Pace on its circle while it spits fire. */
const DRIFT = 0.3;
/** Ground samples along a dive's lane (the view draws the lane over them). */
const LANE_SAMPLES = 8;
/** Share of a dive spent coming down, and climbing away at the far end. */
const DIVE_EASE = 0.3;
/** Its stance doesn't recover between fireballs: the refill delay is held at this. */
const POISE_HOLD = 60;
const FALL_GRAVITY = 26;
const FALL_MAX = 34;

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smooth = (u: number) => u * u * (3 - 2 * u);

function newFlight(home: Vec3): DrakeFlight {
  return { mode: 'orbit', angle: 0, dir: 1, cx: home.x, cz: home.z, ground: home.y, lane: null, glide: null };
}

/** Put it somewhere: it has no ground movement, so its collider and velocity follow by hand. */
function place(e: Entity, physics: PhysicsWorld, x: number, y: number, z: number): void {
  const p = e.tf.pos;
  e.tf.vel = { x: (x - p.x) / DT, y: (y - p.y) / DT, z: (z - p.z) / DT };
  p.x = x;
  p.y = y;
  p.z = z;
  physics.teleport(e.id, p);
}

function flyToward(e: Entity, physics: PhysicsWorld, x: number, y: number, z: number, speed: number): void {
  const p = e.tf.pos;
  const dx = x - p.x, dy = y - p.y, dz = z - p.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return place(e, physics, x, y, z);
  const step = Math.min(d, speed * DT);
  place(e, physics, p.x + (dx / d) * step, p.y + (dy / d) * step, p.z + (dz / d) * step);
}

function groundAt(e: Entity, physics: PhysicsWorld, x: number, z: number, fallback: number): number {
  const hit = physics.raycast({ x, y: e.brain!.home.y + RAY_FROM, z }, DOWN, RAY_FROM * 2);
  return hit ? hit.point.y : fallback;
}

/** One tick of its circle around the player, high over the field. */
function orbit(ctx: CombatCtx, e: Entity, def: EnemyDef, s: DrakeFlight, target: Entity | null, physics: PhysicsWorld, pace: number, faceFlight: boolean): void {
  const fly = def.drake!;
  const home = e.brain!.home;
  if (target) {
    s.cx += (target.tf.pos.x - s.cx) * CENTRE_FOLLOW;
    s.cz += (target.tf.pos.z - s.cz) * CENTRE_FOLLOW;
    // The circle's centre stays where the whole circle fits inside the arena.
    const room = Math.max(0, def.boss!.arenaRadius - fly.orbitRadius - fly.arenaMargin);
    const dx = s.cx - home.x, dz = s.cz - home.z;
    const d = Math.hypot(dx, dz);
    if (d > room) {
      s.cx = home.x + (dx / d) * room;
      s.cz = home.z + (dz / d) * room;
    }
  }
  const speed = fly.orbitSpeed * bossSpeed(e, def) * pace;
  s.angle += (s.dir * speed * DT) / fly.orbitRadius;
  const x = s.cx + Math.sin(s.angle) * fly.orbitRadius;
  const z = s.cz + Math.cos(s.angle) * fly.orbitRadius;
  const [lo, hi] = fly.altitude;
  const y = s.ground + lerp(lo, hi, 0.5 + 0.5 * Math.sin(ctx.now * ALTITUDE_RATE));
  const p = e.tf.pos;
  const off = Math.hypot(x - p.x, y - p.y, z - p.z);
  flyToward(e, physics, x, y, z, speed * clamp(off / CATCH_UP_DIST, 1, CATCH_UP_MAX));
  if (faceFlight) e.tf.yaw = turnToward(e.tf.yaw, Math.atan2(s.dir * Math.cos(s.angle), -s.dir * Math.sin(s.angle)), def.turnRate * DT);
}

/** How far (up to `want`) a line from `c` runs along (dx, dz) before it leaves the circle. */
function reach(c: Vec3, dx: number, dz: number, home: Vec3, radius: number, want: number): number {
  const ox = c.x - home.x, oz = c.z - home.z;
  const b = ox * dx + oz * dz;
  const disc = b * b - (ox * ox + oz * oz - radius * radius);
  return disc <= 0 ? 0 : clamp(-b + Math.sqrt(disc), 0, want);
}

/** Fix the dive's line through where the player stands now: the telegraph they get to read and leave. */
function planDive(e: Entity, def: EnemyDef, s: DrakeFlight, target: Entity | null, physics: PhysicsWorld, move: EnemyMoveDef): void {
  const home = e.brain!.home;
  const c = target?.tf.pos ?? e.tf.pos;
  const yaw = yawTo(e.tf.pos, c);
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  const half = move.dive!.length / 2;
  const radius = def.boss!.arenaRadius - def.drake!.arenaMargin;
  const back = reach(c, -dx, -dz, home, radius, half);
  const fore = reach(c, dx, dz, home, radius, half);
  const lane: Lane = { ax: c.x - dx * back, az: c.z - dz * back, bx: c.x + dx * fore, bz: c.z + dz * fore, ys: [] };
  for (let i = 0; i <= LANE_SAMPLES; i++) {
    const u = i / LANE_SAMPLES;
    lane.ys.push(groundAt(e, physics, lerp(lane.ax, lane.bx, u), lerp(lane.az, lane.bz, u), s.ground));
  }
  s.lane = lane;
  s.mode = 'dive';
}

/** The ground under a point `u` (0..1) along the lane. */
function laneGround(lane: Lane, u: number): number {
  const f = clamp(u, 0, 1) * (lane.ys.length - 1);
  const i = Math.min(Math.floor(f), lane.ys.length - 2);
  return lerp(lane.ys[i], lane.ys[i + 1], f - i);
}

/** The wind-up climbs to the head of the lane; the active ticks sweep down it, skim the middle and climb away. */
function diveFlight(e: Entity, def: EnemyDef, s: DrakeFlight, a: Attack, move: EnemyMoveDef, physics: PhysicsWorld): void {
  const lane = s.lane!;
  const top = def.drake!.altitude[1];
  e.tf.yaw = turnToward(e.tf.yaw, Math.atan2(lane.bx - lane.ax, lane.bz - lane.az), def.turnRate * 3 * DT);
  if (a.t < move.windup) {
    const p = e.tf.pos;
    const y = laneGround(lane, 0) + top;
    const d = Math.hypot(lane.ax - p.x, y - p.y, lane.az - p.z);
    flyToward(e, physics, lane.ax, y, lane.az, d / Math.max(DT, (move.windup - a.t) * DT));
    return;
  }
  const u = clamp((a.t - move.windup) / move.active, 0, 1);
  const k = u < DIVE_EASE ? smooth(u / DIVE_EASE) : u > 1 - DIVE_EASE ? smooth((1 - u) / DIVE_EASE) : 1;
  const low = move.dive!.low;
  place(e, physics, lerp(lane.ax, lane.bx, u), laneGround(lane, u) + lerp(top, low, k), lerp(lane.az, lane.bz, u));
}

/** Phase 3: fire along the lane it just flew. */
function burnLane(e: Entity, def: EnemyDef, s: DrakeFlight, host: BossHost): void {
  const lane = s.lane;
  if (!lane) return;
  const { radius, ticks } = def.boss!.burnPatch;
  for (const u of [0.3, 0.5, 0.7]) {
    host.spawnHazard({ x: lerp(lane.ax, lane.bx, u), y: laneGround(lane, u), z: lerp(lane.az, lane.bz, u) }, { kind: 'burn', owner: e.id, radius, fuse: 0, fuseMax: 0, life: ticks, damage: 0 });
  }
}

function attacking(ctx: CombatCtx, e: Entity, def: EnemyDef, s: DrakeFlight, a: Attack, target: Entity | null, physics: PhysicsWorld, host: BossHost, hooks: DrakeHooks): void {
  const c = e.combat!;
  const move = def.moves.find((m) => m.id === a.move);
  hooks.run(target);
  const now = c.action;
  if (now !== a) {
    if (move?.dive && e.boss!.phase === 3) burnLane(e, def, s, host);
    if (now?.kind === 'attack') {
      // A string: the next dive gets a new lane through where the player is now.
      const next = def.moves.find((m) => m.id === now.move);
      if (next?.dive) planDive(e, def, s, target, physics, next);
    } else e.brain!.timer = def.boss!.gapTicks;
  }
  const cur = c.action;
  const mv = cur?.kind === 'attack' ? def.moves.find((m) => m.id === cur.move) : undefined;
  if (cur?.kind === 'attack' && mv?.dive && s.lane && cur.t < mv.windup + mv.active) diveFlight(e, def, s, cur, mv, physics);
  else orbit(ctx, e, def, s, target, physics, mv && !mv.dive ? DRIFT : 1, !mv || !!mv.dive);
}

/** Broken: it comes down to where the player is, then glides past them, low and slow. */
function glide(e: Entity, def: EnemyDef, s: DrakeFlight, a: Stagger, target: Entity | null, physics: PhysicsWorld): void {
  const g = def.drake!.glide;
  const home = e.brain!.home;
  if (!s.glide) {
    const c = target?.tf.pos ?? e.tf.pos;
    const yaw = yawTo(e.tf.pos, c);
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const len = g.speed * g.ticks * DT;
    const radius = def.boss!.arenaRadius - def.drake!.arenaMargin;
    const back = reach(c, -dx, -dz, home, radius, len * 0.3);
    const fore = reach(c, dx, dz, home, radius, len * 0.7);
    s.glide = { ax: c.x - dx * back, az: c.z - dz * back, bx: c.x + dx * fore, bz: c.z + dz * fore };
  }
  s.mode = 'glide';
  s.lane = null;
  const line = s.glide;
  const y = s.ground + g.height;
  if (a.t < g.descendTicks) {
    const p = e.tf.pos;
    const d = Math.hypot(line.ax - p.x, y - p.y, line.az - p.z);
    flyToward(e, physics, line.ax, y, line.az, d / ((g.descendTicks - a.t) * DT));
  } else {
    const u = Math.min(1, (a.t - g.descendTicks) / g.ticks);
    place(e, physics, lerp(line.ax, line.bx, u), y, lerp(line.az, line.bz, u));
  }
  e.tf.yaw = turnToward(e.tf.yaw, Math.atan2(line.bx - line.ax, line.bz - line.az), def.turnRate * DT);
  if (++a.t >= a.dur) {
    e.combat!.action = null;
    s.glide = null;
    s.mode = 'orbit';
    e.brain!.timer = def.boss!.gapTicks * 2;
  }
}

/** Dead: it falls out of the sky and lies where it lands. */
function fall(e: Entity, s: DrakeFlight, a: Extract<Action, { kind: 'dead' }>, physics: PhysicsWorld): void {
  a.t++;
  const p = e.tf.pos;
  const floor = groundAt(e, physics, p.x, p.z, s.ground);
  const vy = Math.max(-FALL_MAX, e.tf.vel.y - FALL_GRAVITY * DT);
  place(e, physics, p.x, Math.max(floor, p.y + vy * DT), p.z);
}

/**
 * The Skyfire Drake (expansion plan §3.5). Asleep until the bait post is set. Then it circles the
 * player at 12–20 m, spits volleys and dives along lanes it paints on the ground. Fireballs sent back
 * at it break its stance (the poise bar), and Broken it comes down and glides low for the melee
 * window. Everything here is plain state on `boss.flight`, so snapshots and the hash carry it.
 */
export function drakeTick(ctx: CombatCtx, e: Entity, def: EnemyDef, physics: PhysicsWorld, rng: RngState, host: BossHost, hooks: DrakeHooks): void {
  const boss = e.boss!;
  const cfg = def.boss!;
  const fly = def.drake!;
  const b = e.brain!;
  const c = e.combat!;
  const home = b.home;
  const s = (boss.flight ??= newFlight(home));
  const a = c.action;
  if (a?.kind === 'dead') return fall(e, s, a, physics);

  if (boss.state === 'idle') {
    // On the player's team while it sleeps: nothing targets it, nothing hits it.
    c.team = 'player';
    b.state = 'idle';
    b.target = null;
    place(e, physics, home.x, home.y + ASLEEP_ABOVE, home.z);
    const woken = host.flag(fly.wakeFlag) !== 0 ? hooks.target() : null;
    if (!woken || flatDist(woken.tf.pos, home) > cfg.arenaRadius) return;
    boss.state = 'intro';
    boss.t = 0;
    boss.flight = newFlight(home);
    boss.flight.angle = rngNext(rng) * Math.PI * 2;
    boss.flight.dir = rngNext(rng) < 0.5 ? -1 : 1;
    b.state = 'engage';
    c.team = 'enemy';
    const ang = boss.flight.angle;
    place(e, physics, home.x + Math.sin(ang) * cfg.arenaRadius, home.y + INTRO_HEIGHT, home.z + Math.cos(ang) * cfg.arenaRadius);
    e.tf.vel = { x: 0, y: 0, z: 0 };
    e.tf.prevPos = { ...e.tf.pos };
    e.tf.yaw = e.tf.prevYaw = yawTo(e.tf.pos, home);
    ctx.events.push({ type: 'bossIntro', boss: e.id });
    return;
  }

  c.team = 'enemy';
  c.poiseDelay = POISE_HOLD;
  s.ground += (groundAt(e, physics, e.tf.pos.x, e.tf.pos.z, s.ground) - s.ground) * GROUND_SMOOTH;
  const target = hooks.target();
  b.target = target?.id ?? null;

  if (boss.state === 'intro') {
    orbit(ctx, e, def, s, target, physics, 1, true);
    if (++boss.t >= cfg.introTicks) {
      boss.state = 'fight';
      b.timer = cfg.gapTicks;
    }
    return;
  }
  if (boss.state !== 'fight') return;

  if (a?.kind === 'stagger' && a.reason === 'broken') return glide(e, def, s, a, target, physics);
  if (a?.kind === 'stagger' || a?.kind === 'hitstun' || a?.kind === 'frozen') return held(e, s, a, physics);
  if (a?.kind === 'attack') return attacking(ctx, e, def, s, a, target, physics, host, hooks);

  s.mode = 'orbit';
  s.lane = null;
  s.glide = null;
  const hp = e.vitals!.hp / e.vitals!.hpMax;
  const phase = hp <= cfg.phase3 ? 3 : hp <= cfg.phase2 ? 2 : 1;
  const roar = def.moves.find((m) => m.id === cfg.roar);
  if (target && phase > boss.phase && roar) {
    boss.phase = phase;
    ctx.events.push({ type: 'bossPhase', boss: e.id, phase });
    hooks.start(ctx, e, roar, target);
  } else if (b.timer > 0) b.timer--;
  else if (target) {
    const pick = pickMove(ctx, e, def, flatDist(e.tf.pos, target.tf.pos), rng);
    if (pick) {
      hooks.start(ctx, e, pick, target);
      if (pick.dive) planDive(e, def, s, target, physics, pick);
    }
  }
  orbit(ctx, e, def, s, target, physics, 1, true);
}

/** A snare or a stagger holds it where it is for a moment; a dive it was on is lost. */
function held(e: Entity, s: DrakeFlight, a: Held, physics: PhysicsWorld): void {
  s.mode = 'stall';
  s.lane = null;
  const p = e.tf.pos;
  place(e, physics, p.x, p.y, p.z);
  if (++a.t >= a.dur) e.combat!.action = null;
}
