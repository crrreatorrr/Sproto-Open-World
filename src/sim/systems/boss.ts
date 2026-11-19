import { DT } from '../../content/tuning';
import type { EnemyDef, EnemyMoveDef } from '../../content/enemies';
import { flatDist, yawTo } from '../combat/geometry';
import type { CombatCtx } from '../combat/playerCombat';
import type { BossState, Entity, Hazard } from '../entity';
import { turnToward, wrapAngle, type Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { next as rngNext, type RngState } from '../rng';

/** What a boss asks of the world (SimWorld owns ids). */
export interface BossHost {
  spawnAdd(def: string, pos: Vec3, yaw: number): Entity;
  spawnHazard(pos: Vec3, hazard: Hazard): void;
  /** A world flag's value (0 when unset). */
  flag(id: string): number;
  /** The ground's height at (x, z), looking around height `near`. */
  groundY(x: number, z: number, near: number): number;
}

/** Starts one of the boss's moves (the brain's `startAttack`). */
export type StartMove = (ctx: CombatCtx, e: Entity, move: EnemyMoveDef, target: Entity | null) => void;

/** It walks up to this far from its target (m), then only turns to face it. */
const CLOSE_ENOUGH = 3.8;
/** It must face its target this closely (radians) before it starts a move. */
const FACING = 0.5;
/** Adds appear this far from the boss (m). */
const ADD_RING = 6;
/** Shoves spread over this many ticks. */
const SHOVE_TICKS = 12;
/** A charge counts as hitting something only when moving toward it this directly (cosine). */
const INTO = 0.2;
/** Between its moves it sidesteps around its target at this share of its walking speed. */
const SIDESTEP = 0.35;

export const newBossState = (): BossState => ({ state: 'idle', t: 0, phase: 1, rocksUntil: 0, nextRock: 0, summoned: false });

/** Phase 3's extra speed, on the walk and the charge. */
export const bossSpeed = (e: Readonly<Entity>, def: EnemyDef): number => (e.boss?.phase === 3 && def.boss ? def.boss.enrage : 1);

/** The fight is on (or starting): the arena is sealed and the boss bar is up. */
export const bossEngaged = (e: Readonly<Entity>): boolean => e.boss?.state === 'intro' || e.boss?.state === 'fight';

const liveRock = (ctx: CombatCtx) => ctx.entities.some((x) => x.hazard?.kind === 'rock' && x.hazard.fuse > 0);

/**
 * Every tick of a fight, whatever the boss is doing: the falling rocks after the roar. They come one
 * at a time, each on its own decal, so at most one area telegraph is ever on the ground (plan §4.10).
 */
export function bossPreTick(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity | null, rng: RngState, host: BossHost): void {
  const boss = e.boss;
  const cfg = def.boss;
  if (!boss || !cfg || boss.state !== 'fight' || !target) return;
  if (ctx.now >= boss.rocksUntil || ctx.now < boss.nextRock || liveRock(ctx)) return;
  const a = e.combat?.action;
  if (a?.kind === 'attack') {
    const move = def.moves.find((m) => m.id === a.move);
    if (move?.decal && a.t < move.windup) return;
  }
  const ang = rngNext(rng) * Math.PI * 2;
  const off = rngNext(rng) * 2.5;
  const at = { x: target.tf.pos.x + Math.sin(ang) * off, y: target.tf.pos.y, z: target.tf.pos.z + Math.cos(ang) * off };
  const { fuse, radius, damage } = cfg.rocks;
  host.spawnHazard(at, { kind: 'rock', owner: e.id, radius, fuse, fuseMax: fuse, life: fuse + 40, damage });
  boss.nextRock = ctx.now + fuse + 8;
}

/** The boss is free to act: the intro, phase changes, the add wave, then the next move. */
export function bossThink(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity | null, rng: RngState, host: BossHost, start: StartMove): void {
  const boss = e.boss!;
  const cfg = def.boss!;
  const b = e.brain!;
  ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
  const face = (t: Entity) => (e.tf.yaw = turnToward(e.tf.yaw, yawTo(e.tf.pos, t.tf.pos), def.turnRate * DT));

  // Free to act but still under: whatever it was coming up for has gone (its target died mid-burrow).
  if (boss.under && boss.state !== 'idle') delete boss.under;
  if (boss.state === 'idle') {
    // The fight only counts inside the arena: shots from beyond its wall don't wear it down.
    e.vitals!.hp = e.vitals!.hpMax;
    // Dormant: asleep under the ground until its quest wakes it, and nobody's enemy until then.
    if (cfg.wakeFlag && !host.flag(cfg.wakeFlag)) {
      boss.under = true;
      b.target = null;
      return;
    }
    delete boss.under;
    if (!target || flatDist(target.tf.pos, b.home) > cfg.arenaRadius) return;
    boss.state = 'intro';
    boss.t = 0;
    b.state = 'engage';
    ctx.events.push({ type: 'bossIntro', boss: e.id });
    return;
  }
  if (boss.state === 'intro') {
    if (target) face(target);
    if (++boss.t >= cfg.introTicks) {
      boss.state = 'fight';
      b.timer = cfg.gapTicks;
    }
    return;
  }
  if (boss.state !== 'fight' || !target) return;

  const hp = e.vitals!.hp / e.vitals!.hpMax;
  const phase = hp <= cfg.phase3 ? 3 : hp <= cfg.phase2 ? 2 : 1;
  const roar = def.moves.find((m) => m.id === cfg.roar);
  if (phase > boss.phase && roar) {
    // The first phase change brings the rocks down for a while; the last just enrages it.
    if (boss.phase === 1) {
      boss.rocksUntil = ctx.now + roar.windup + cfg.rocks.ticks;
      boss.nextRock = ctx.now + roar.windup;
    }
    boss.phase = phase;
    ctx.events.push({ type: 'bossPhase', boss: e.id, phase });
    start(ctx, e, roar, target);
    return;
  }
  if (!boss.summoned && hp <= cfg.summon.below) {
    boss.summoned = true;
    summonAdds(ctx, e, def, target, host);
  }
  if (b.timer > 0) {
    b.timer--;
    face(target);
    const yaw = yawTo(e.tf.pos, target.tf.pos);
    const step = def.moveSpeed * SIDESTEP * b.circleDir;
    ctx.motion.set(e.id, { vx: Math.cos(yaw) * step, vz: -Math.sin(yaw) * step, inputScale: 0 });
    return;
  }

  const gap = flatDist(e.tf.pos, target.tf.pos) - (target.body?.radius ?? 0.35);
  const facing = Math.abs(wrapAngle(yawTo(e.tf.pos, target.tf.pos) - e.tf.yaw)) < FACING;
  const pick = facing ? pickMove(ctx, e, def, gap, rng) : null;
  if (pick) {
    start(ctx, e, pick, target);
    return;
  }
  face(target);
  if (gap > CLOSE_ENOUGH * (def.size ?? 1)) {
    const speed = def.moveSpeed * bossSpeed(e, def);
    ctx.motion.set(e.id, { vx: Math.sin(e.tf.yaw) * speed, vz: Math.cos(e.tf.yaw) * speed, inputScale: 0 });
  }
}

/** A weighted pick among what's usable from here; no move three times running. */
export function pickMove(ctx: CombatCtx, e: Entity, def: EnemyDef, gap: number, rng: RngState): EnemyMoveDef | null {
  const boss = e.boss!;
  const b = e.brain!;
  const rock = liveRock(ctx);
  const usable = def.moves.filter(
    (m) =>
      !m.chainOnly &&
      (!m.phases || m.phases.includes(boss.phase)) &&
      (b.cooldowns[m.id] ?? 0) <= 0 &&
      gap <= m.range &&
      gap >= (m.minRange ?? 0) &&
      // At most one area telegraph at a time (plan §4.10).
      !(rock && (m.decal || m.area)) &&
      !(b.recent.length === 2 && b.recent.every((r) => r === m.id)),
  );
  if (!usable.length) return null;
  let roll = rngNext(rng) * usable.reduce((n, m) => n + m.weight, 0);
  for (const m of usable) {
    roll -= m.weight;
    if (roll <= 0) return m;
  }
  return usable[usable.length - 1];
}

function summonAdds(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity, host: BossHost): void {
  const { def: add, count } = def.boss!.summon;
  for (let i = 0; i < count; i++) {
    const a = e.tf.yaw + Math.PI / 2 + (i / Math.max(1, count - 1)) * Math.PI;
    const at = { x: e.tf.pos.x + Math.sin(a) * ADD_RING, y: e.tf.pos.y, z: e.tf.pos.z + Math.cos(a) * ADD_RING };
    const g = host.spawnAdd(add, at, yawTo(at, target.tf.pos));
    g.brain!.summoned = true;
    g.brain!.state = 'engage';
    g.brain!.target = target.id;
  }
  ctx.events.push({ type: 'bossSummon', boss: e.id, count });
}

/** After the boss's attack advanced this tick: what its moves do beyond their hitboxes. */
export function bossAttackTick(ctx: CombatCtx, e: Entity, def: EnemyDef, host: BossHost): void {
  const cfg = def.boss!;
  const c = e.combat!;
  const a = c.action;
  // The attack ended: a beat before the next wind-up (plan §4.10).
  if (!a) {
    e.brain!.timer = cfg.gapTicks;
    return;
  }
  if (a.kind !== 'attack') return;
  const move = def.moves.find((m) => m.id === a.move);
  if (!move) return;
  // The moment the wind-up ends (`fired` keeps a chilled boss's slow clock from doing it twice).
  if (a.t === move.windup && !move.projectile && !a.fired) {
    a.fired = 1;
    if (move.burrow === 'sink') e.boss!.under = true;
    if (move.burrow === 'rise' && a.aim) surface(e, a.aim, def, host);
    if (move.shove) shove(ctx, e, move.shove);
    if (move.burnPatch && e.boss?.phase === 3) {
      const { radius, ticks } = cfg.burnPatch;
      host.spawnHazard({ ...e.tf.pos }, { kind: 'burn', owner: e.id, radius, fuse: 0, fuseMax: 0, life: ticks, damage: 0 });
    }
  }
  if (move.charge && a.t >= move.windup && a.t < move.windup + move.active) chargeImpact(ctx, e, def);
}

/** Up out of the ground on the telegraphed circle (kept inside the arena), and solid again. */
function surface(e: Entity, at: Vec3, def: EnemyDef, host: BossHost): void {
  const home = e.brain!.home;
  const room = def.boss!.arenaRadius - (e.body?.radius ?? 1);
  const dx = at.x - home.x, dz = at.z - home.z;
  const d = Math.hypot(dx, dz);
  const k = d > room ? room / d : 1;
  const x = home.x + dx * k, z = home.z + dz * k;
  e.tf.pos = { x, y: host.groundY(x, z, at.y), z };
  e.tf.prevPos = { ...e.tf.pos };
  e.tf.vel = { x: 0, y: 0, z: 0 };
  delete e.boss!.under;
}

function shove(ctx: CombatCtx, e: Entity, s: NonNullable<EnemyMoveDef['shove']>): void {
  for (const p of ctx.entities) {
    if (p.kind !== 'player' || !p.combat || p.combat.action?.kind === 'dead') continue;
    const d = flatDist(p.tf.pos, e.tf.pos);
    if (d > s.radius) continue;
    const yaw = yawTo(e.tf.pos, p.tf.pos);
    const step = s.distance / SHOVE_TICKS;
    p.combat.push = { x: Math.sin(yaw) * step, z: Math.cos(yaw) * step, ticks: SHOVE_TICKS };
  }
}

/** A charge that runs into a pillar (which breaks) or the arena's wall stops dead, stunned. */
function chargeImpact(ctx: CombatCtx, e: Entity, def: EnemyDef): void {
  const cfg = def.boss!;
  const home = e.brain!.home;
  const r = e.body?.radius ?? 1;
  const dir = { x: Math.sin(e.tf.yaw), z: Math.cos(e.tf.yaw) };
  const heading = (to: { x: number; z: number }) => {
    const dx = to.x - e.tf.pos.x, dz = to.z - e.tf.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return (dx * dir.x + dz * dir.z) / len;
  };
  const pillar = ctx.entities.find((o) => {
    const ob = o.obstacle;
    if (!ob?.breakable || ob.broken || ob.shape.kind !== 'cylinder') return false;
    return flatDist(o.tf.pos, e.tf.pos) <= ob.shape.radius + r + 0.3 && heading(o.tf.pos) > INTO;
  });
  // Heading away from the centre, close to the rim.
  const wall = flatDist(e.tf.pos, home) >= cfg.arenaRadius - r - 0.3 && heading(home) < -INTO;
  if (!pillar && !wall) return;
  if (pillar) pillar.obstacle!.broken = true;
  e.combat!.action = { kind: 'stagger', t: 0, dur: cfg.stunTicks, reason: 'stunned' };
  ctx.events.push({ type: 'bossImpact', boss: e.id, pos: { ...e.tf.pos }, pillar: !!pillar });
  ctx.events.push({ type: 'stagger', entity: e.id, ticks: cfg.stunTicks });
}

/**
 * The sealed arena, after everyone has moved: the player can't leave a fight that has started, and
 * the boss stays on the floor. (The wall is drawn by the boss's view.)
 */
export function bossArena(entities: readonly Entity[], physics: PhysicsWorld, defOf: (e: Entity) => EnemyDef | undefined): void {
  for (const e of entities) {
    const cfg = e.boss && bossEngaged(e) ? defOf(e)?.boss : undefined;
    if (!cfg) continue;
    const home = e.brain!.home;
    keepInside(e, home, cfg.arenaRadius - (e.body?.radius ?? 1), physics);
    for (const p of entities) if (p.kind === 'player' && p.combat?.action?.kind !== 'dead') keepInside(p, home, cfg.arenaRadius, physics);
  }
}

function keepInside(e: Entity, home: Vec3, radius: number, physics: PhysicsWorld): void {
  const dx = e.tf.pos.x - home.x, dz = e.tf.pos.z - home.z;
  const d = Math.hypot(dx, dz);
  if (d <= radius) return;
  e.tf.pos.x = home.x + (dx / d) * radius;
  e.tf.pos.z = home.z + (dz / d) * radius;
  physics.teleport(e.id, e.tf.pos);
}
