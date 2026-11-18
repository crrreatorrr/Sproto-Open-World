import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import { DT } from '../../content/tuning';
import { flatDist, toWorld, yawTo } from '../combat/geometry';
import type { CombatCtx } from '../combat/playerCombat';
import { clockTicks, moveScale } from '../combat/statuses';
import type { Entity } from '../entity';
import { affixSpeed } from '../systems/affixes';
import { turnToward, wrapAngle } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { next as rngNext, range as rngRange, type RngState } from '../rng';
import { bossAttackTick, bossEngaged, bossPreTick, bossSpeed, bossThink, type BossHost } from '../systems/boss';
import { drakeTick } from '../systems/drake';

/** Spawns one projectile for an enemy's ranged move (provided by SimWorld). `angle` fans it out. */
export type SpawnProjectile = (owner: Entity, move: EnemyMoveDef, target: Entity, angle: number) => void;

/** Attack tokens per target player (plan §4.8): at most this many melee and ranged wind-ups at once. */
export const TOKENS = { melee: 2, ranged: 1 } as const;

/** Strafe speed while circling (m/s), and the band a token-less melee enemy circles in (m). */
const CIRCLE_SPEED = 1.7;
const WAIT_BAND: [number, number] = [4, 7];
const MIN_GAP = 0.6;

/**
 * Enemy brains (plan §4.8). Dummies run fixed timers. Fighters approach (melee) or hold a distance
 * band (ranged), take an attack token before winding up so a group never all swings at once,
 * pick an attack by distance band and weight (never one move three times running), sometimes
 * circle after recovering, and leash home if pulled too far. Chill slows their clock and feet.
 */
export function enemyBrains(ctx: CombatCtx, rng: RngState, physics: PhysicsWorld, spawnProjectile: SpawnProjectile, bossHost?: BossHost): void {
  const duels = ctx.entities.filter((e) => bossEngaged(e));
  for (const e of ctx.entities) {
    const b = e.brain;
    const c = e.combat;
    if (!b || !c) continue;
    const def = ENEMIES[b.def];
    for (const k of Object.keys(b.cooldowns)) if (b.cooldowns[k] > 0) b.cooldowns[k]--;
    const still = () => ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
    if (ctx.frozen.has(e.id)) {
      still();
      continue;
    }

    // The Skyfire Drake flies its whole fight itself (expansion plan §3.5).
    if (def.drake && bossHost) {
      drakeTick(ctx, e, def, physics, rng, bossHost, { target: () => pickTarget(ctx, e, def, duels), start: startAttack, run: (t) => runAttack(ctx, e, def, t, spawnProjectile, rng) });
      continue;
    }

    const a = c.action;
    if (a?.kind === 'dead') {
      a.t++;
      still();
      continue;
    }
    if (a?.kind === 'hitstun' || a?.kind === 'stagger' || a?.kind === 'frozen') {
      a.t++;
      if (a.t >= a.dur) c.action = null;
      still();
      continue;
    }

    // The Hex Wisp blinks away after enough melee hits in a row.
    if (def.blink && b.meleeHitsTaken >= def.blink.hits) {
      b.meleeHitsTaken = 0;
      blink(ctx, e, def, physics);
      still();
      continue;
    }

    const target = pickTarget(ctx, e, def, duels);
    b.target = target?.id ?? null;
    const boss = def.boss && bossHost ? bossHost : null;
    if (boss) bossPreTick(ctx, e, def, target, rng, boss);

    if (a?.kind === 'attack') {
      runAttack(ctx, e, def, target, spawnProjectile, rng);
      if (boss) bossAttackTick(ctx, e, def, boss);
      continue;
    }

    if (def.dummy) dummyThink(ctx, e, def, target);
    else if (boss) bossThink(ctx, e, def, target, rng, boss, startAttack);
    else fighterThink(ctx, e, def, target, rng);
    // Chill slows movement too, and an affix can speed it up or slow it down.
    const m = ctx.motion.get(e.id);
    if (m) {
      const k = moveScale(e) * affixSpeed(e);
      m.vx *= k;
      m.vz *= k;
    }
  }
}

/** A player sealed in with a boss: the fight is between the two of them (and the boss's own adds). */
function inDuel(p: Entity, duels: readonly Entity[]): boolean {
  return duels.some((b) => flatDist(p.tf.pos, b.brain!.home) <= ENEMIES[b.brain!.def].boss!.arenaRadius + 1);
}

function pickTarget(ctx: CombatCtx, e: Entity, def: EnemyDef, duels: readonly Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestD = def.aggroRange;
  const outsider = !e.boss && !e.brain!.summoned;
  for (const p of ctx.entities) {
    if (p.kind !== 'player' || p.combat?.action?.kind === 'dead') continue;
    if (outsider && inDuel(p, duels)) continue;
    const fromHome = flatDist(p.tf.pos, e.brain!.home);
    if (fromHome > def.leashRange) continue;
    const d = flatDist(p.tf.pos, e.tf.pos);
    // Already engaged: keep chasing anywhere inside the leash.
    if (d <= bestD || (e.brain!.target === p.id && e.brain!.state === 'engage')) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Tokens in use against `target` from one pool: summed over enemies currently attacking it. */
export function tokensInUse(ctx: CombatCtx, target: Entity, pool: 'melee' | 'ranged', except?: Entity): number {
  let used = 0;
  for (const e of ctx.entities) {
    if (e === except || !e.brain || e.brain.target !== target.id) continue;
    const a = e.combat?.action;
    if (a?.kind !== 'attack') continue;
    const move = ENEMIES[e.brain.def].moves.find((m) => m.id === a.move);
    if (move?.token?.pool === pool) used += move.token.cost;
  }
  return used;
}

function hasToken(ctx: CombatCtx, e: Entity, def: EnemyDef, move: EnemyMoveDef, target: Entity): boolean {
  if (!def.usesTokens || !move.token) return true;
  const used = tokensInUse(ctx, target, move.token.pool, e);
  // A move that costs the whole pool (a Brute heavy) may still go when nobody else is attacking.
  return used === 0 || used + move.token.cost <= TOKENS[move.token.pool];
}

function startAttack(ctx: CombatCtx, e: Entity, move: EnemyMoveDef, target: Entity | null): void {
  const c = e.combat!;
  const aim = move.area && target ? { ...target.tf.pos } : undefined;
  c.action = { kind: 'attack', move: move.id, t: 0, clipT: 0, charge: 0, charging: false, charged: false, hit: [], lunge: 0, lungeDir: { x: 0, z: 0 }, fired: 0, aim };
  e.brain!.cooldowns[move.id] = move.cooldown;
  const recent = e.brain!.recent;
  recent.push(move.id);
  if (recent.length > 2) recent.shift();
  ctx.events.push({
    type: 'telegraph', entity: e.id, move: move.id, ticks: move.windup, unblockable: !!move.unblockable, decal: move.decal,
    at: aim, radius: move.area?.radius,
  });
}

function runAttack(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity | null, spawn: SpawnProjectile, rng: RngState): void {
  const a = e.combat!.action;
  if (a?.kind !== 'attack') return;
  const move = def.moves.find((m) => m.id === a.move)!;
  // Track the target during the first part of the wind-up, then commit.
  if (target && a.t < move.windup * move.trackUntil) e.tf.yaw = turnToward(e.tf.yaw, yawTo(e.tf.pos, target.tf.pos), def.turnRate * DT);
  const ticks = clockTicks(e); // chill slows the whole attack
  if (ticks) a.t++;
  const motion = { vx: 0, vz: 0, inputScale: 0 };
  if (ticks && a.t === move.windup) ctx.events.push({ type: 'swing', entity: e.id, move: move.id, heavy: !!move.hyperArmor });
  // Volleys: `count` shots, `interval` ticks apart, fanned out.
  if (move.projectile && target && ticks) {
    const count = move.projectile.count ?? 1;
    const k = a.fired ?? 0;
    if (k < count && a.t === move.windup + k * (move.projectile.interval ?? 0)) {
      a.fired = k + 1;
      const spread = move.projectile.spread ?? 0;
      spawn(e, move, target, (k - (count - 1) / 2) * spread);
    }
  }
  // Leaps travel during the active ticks.
  if (move.leap && a.t >= move.windup && a.t < move.windup + move.active) {
    const speed = (move.leap.distance / (move.active * DT)) * moveScale(e);
    motion.vx = Math.sin(e.tf.yaw) * speed;
    motion.vz = Math.cos(e.tf.yaw) * speed;
  }
  // A boss's charge runs straight along its committed facing.
  if (move.charge && a.t >= move.windup && a.t < move.windup + move.active) {
    const speed = move.charge.speed * bossSpeed(e, def) * moveScale(e);
    motion.vx = Math.sin(e.tf.yaw) * speed;
    motion.vz = Math.cos(e.tf.yaw) * speed;
  }
  ctx.motion.set(e.id, motion);
  if (a.t >= move.windup + move.active + move.recovery) {
    e.combat!.action = null;
    // A string (the Gatekeeper's 3-hit): the next move starts at once, still holding its token.
    const next = move.followUp ? def.moves.find((m) => m.id === move.followUp) : undefined;
    if (next && target) {
      startAttack(ctx, e, next, target);
      return;
    }
    // After an attack, sometimes back off and circle for a moment.
    if (!def.dummy && rngNext(rng) < 0.4) {
      e.brain!.circle = rngRange(rng, 30, 70);
      e.brain!.circleDir = rngNext(rng) < 0.5 ? -1 : 1;
    }
  }
}

function dummyThink(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity | null): void {
  const b = e.brain!;
  ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
  if (!target) {
    e.tf.yaw = turnToward(e.tf.yaw, b.homeYaw, def.turnRate * DT);
    return;
  }
  // Dummies turn to face you so you can practise from the front.
  e.tf.yaw = turnToward(e.tf.yaw, yawTo(e.tf.pos, target.tf.pos), def.turnRate * DT);
  const move = def.moves[0];
  if (!move) return;
  if (b.timer > 0) {
    b.timer--;
    return;
  }
  if (flatDist(e.tf.pos, target.tf.pos) <= move.range) {
    startAttack(ctx, e, move, target);
    b.timer = move.cooldown;
  }
}

function fighterThink(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity | null, rng: RngState): void {
  // Moves the AI picks itself (a string's later hits only come as follow-ups).
  const picks = def.moves.filter((m) => !m.chainOnly);
  const b = e.brain!;
  const home = b.home;
  const fromHome = flatDist(e.tf.pos, home);
  const go = (tx: number, tz: number, speed: number) => {
    const dx = tx - e.tf.pos.x, dz = tz - e.tf.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) {
      ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
      return;
    }
    e.tf.yaw = turnToward(e.tf.yaw, Math.atan2(dx, dz), def.turnRate * DT);
    ctx.motion.set(e.id, { vx: (dx / d) * speed, vz: (dz / d) * speed, inputScale: 0 });
  };
  const faceTarget = (t: Entity) => (e.tf.yaw = turnToward(e.tf.yaw, yawTo(e.tf.pos, t.tf.pos), def.turnRate * DT));
  /** Circle `t` (perpendicular to the line between them), plus `radial` m/s toward (+) or away (−). */
  const strafe = (t: Entity, dir: number, speed: number, radial = 0) => {
    const yaw = yawTo(e.tf.pos, t.tf.pos);
    faceTarget(t);
    const sx = Math.cos(yaw) * dir, sz = -Math.sin(yaw) * dir;
    ctx.motion.set(e.id, { vx: sx * speed + Math.sin(yaw) * radial, vz: sz * speed + Math.cos(yaw) * radial, inputScale: 0 });
  };

  // Leash: pulled too far from home, or the player it was fighting got away: walk back fast,
  // healing, ignoring the player.
  if (!target && b.state === 'engage' && fromHome > 1) b.state = 'leash';
  if (b.state === 'leash' || fromHome > def.leashRange) {
    b.state = 'leash';
    e.vitals!.hp = Math.min(e.vitals!.hpMax, e.vitals!.hp + e.vitals!.hpMax * 0.02);
    if (fromHome < 1) {
      b.state = 'idle';
      e.vitals!.hp = e.vitals!.hpMax;
    } else go(home.x, home.z, def.moveSpeed * 2);
    return;
  }
  if (!target) {
    b.state = 'idle';
    if (fromHome > 1) go(home.x, home.z, def.moveSpeed);
    else {
      e.tf.yaw = turnToward(e.tf.yaw, b.homeYaw, def.turnRate * DT);
      ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
    }
    return;
  }
  b.state = 'engage';
  const gap = flatDist(e.tf.pos, target.tf.pos) - (target.body?.radius ?? 0.35);

  if (b.circle > 0) {
    b.circle--;
    strafe(target, b.circleDir, CIRCLE_SPEED);
    return;
  }

  const offCooldown = (m: EnemyMoveDef) => (b.cooldowns[m.id] ?? 0) <= 0;
  const inRange = (m: EnemyMoveDef) => gap <= m.range && gap >= (m.minRange ?? 0);
  const thirdInARow = (m: EnemyMoveDef) => b.recent.length === 2 && b.recent.every((r) => r === m.id);
  // No move three times running, unless nothing else is usable from here (a Grunt too close to
  // leap must still swipe).
  const noRepeat = picks.some((m) => offCooldown(m) && inRange(m) && !thirdInARow(m));
  const ready = (m: EnemyMoveDef) => offCooldown(m) && (!noRepeat || !thirdInARow(m));
  // Token-less melee enemies hang back in the waiting band and circle, feinting in and out (plan
  // §4.8), instead of standing in your face waiting for a slot.
  if (!def.keepRange && def.usesTokens && !picks.some((m) => hasToken(ctx, e, def, m, target))) {
    const [lo, hi] = WAIT_BAND;
    const radial = gap < lo ? -def.moveSpeed * 0.7 : gap > hi ? def.moveSpeed * 0.7 : Math.sin((ctx.now + e.id * 37) / 25) * 1.2;
    strafe(target, b.circleDir, CIRCLE_SPEED, radial);
    return;
  }
  // Ranged fighters hold their band: back off when crowded (so melee them!), close in when too far.
  if (def.keepRange) {
    const [lo, hi] = def.keepRange;
    if (gap < lo - 3) {
      strafe(target, b.circleDir, CIRCLE_SPEED * 0.5, -def.moveSpeed * 0.85);
      return;
    }
    if (gap > hi) {
      go(target.tf.pos.x, target.tf.pos.z, def.moveSpeed);
      return;
    }
  }
  // Sometimes step in for a shorter-reach move instead of always swinging from the longest reach,
  // so a player who stands still still sees the whole moveset.
  if (!def.keepRange && b.stepIn === undefined && picks.length > 1) {
    const shortest = picks.reduce((m, x) => (x.range < m.range ? x : m));
    b.stepIn = ready(shortest) && gap > shortest.range && rngNext(rng) < 0.35 ? shortest.range - 0.2 : 0;
  }
  if (b.stepIn && gap > b.stepIn) {
    go(target.tf.pos.x, target.tf.pos.z, def.moveSpeed);
    return;
  }
  const options = picks.filter((m) => inRange(m) && ready(m));
  const facing = Math.abs(wrapAngle(yawTo(e.tf.pos, target.tf.pos) - e.tf.yaw)) < 0.6;
  const allowed = options.filter((m) => hasToken(ctx, e, def, m, target));
  if (allowed.length && facing) {
    let total = 0;
    for (const m of allowed) total += m.weight;
    let roll = rngNext(rng) * total;
    let pick = allowed[allowed.length - 1];
    for (const m of allowed) {
      roll -= m.weight;
      if (roll <= 0) {
        pick = m;
        break;
      }
    }
    startAttack(ctx, e, pick, target);
    b.stepIn = undefined;
    ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
    return;
  }
  if (def.keepRange) {
    // In the band but nothing to throw yet: drift sideways.
    strafe(target, b.circleDir, CIRCLE_SPEED * 0.7);
    return;
  }
  // Close in until just inside the shortest reach, then turn to face.
  const want = Math.min(...picks.map((m) => m.range)) - MIN_GAP;
  if (gap > want) go(target.tf.pos.x, target.tf.pos.z, def.moveSpeed);
  else {
    faceTarget(target);
    ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
  }
}

/** Teleport away from the target by the blink distance, to the first clear spot. */
function blink(ctx: CombatCtx, e: Entity, def: EnemyDef, physics: PhysicsWorld): void {
  const dist = def.blink!.distance;
  const t = e.brain!.target !== null ? ctx.get(e.brain!.target) : undefined;
  const away = t ? yawTo(t.tf.pos, e.tf.pos) : e.tf.yaw + Math.PI;
  const from = { ...e.tf.pos };
  for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
    const yaw = away + off;
    const dir = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
    if (physics.raycast({ x: from.x, y: from.y + 1, z: from.z }, dir, dist + 0.6)) continue;
    e.tf.pos = { x: from.x + dir.x * dist, y: from.y, z: from.z + dir.z * dist };
    e.tf.prevPos = { ...e.tf.pos };
    physics.teleport(e.id, e.tf.pos);
    ctx.events.push({ type: 'blink', entity: e.id, from, to: { ...e.tf.pos } });
    return;
  }
}

/** Where an enemy's projectile leaves from (its move's hitbox point). */
export function muzzle(e: Entity, move: EnemyMoveDef) {
  return toWorld(e.tf.pos, e.tf.yaw, [0, move.hitbox.up, move.hitbox.forward]);
}
