import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import { DT } from '../../content/tuning';
import { flatDist, toWorld, yawTo } from '../combat/geometry';
import type { CombatCtx } from '../combat/playerCombat';
import type { Entity } from '../entity';
import { turnToward } from '../math';
import { range as rngRange, type RngState, next as rngNext } from '../rng';

/** Spawns a projectile for an enemy's ranged move (provided by SimWorld). */
export type SpawnProjectile = (owner: Entity, move: EnemyMoveDef, target: Entity) => void;

/** Strafe speed while circling, and how far apart a Brute likes to stand (m). */
const CIRCLE_SPEED = 1.7;
const MIN_GAP = 0.6;

/**
 * Enemy brains (plan §4.8, M1a subset: no tokens or perception cones yet, since there is one
 * attacker). Dummies run fixed timers; the Brute approaches, picks an attack by distance band and
 * weight (never the same move three times running), sometimes circles after recovering, and
 * leashes home if pulled too far.
 */
export function enemyBrains(ctx: CombatCtx, rng: RngState, spawnProjectile: SpawnProjectile): void {
  for (const e of ctx.entities) {
    const b = e.brain;
    const c = e.combat;
    if (!b || !c) continue;
    const def = ENEMIES[b.def];
    for (const k of Object.keys(b.cooldowns)) if (b.cooldowns[k] > 0) b.cooldowns[k]--;
    if (ctx.frozen.has(e.id)) {
      ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
      continue;
    }

    const a = c.action;
    if (a?.kind === 'dead') {
      a.t++;
      ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
      continue;
    }
    if (a?.kind === 'hitstun' || a?.kind === 'stagger') {
      a.t++;
      if (a.t >= a.dur) c.action = null;
      ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
      continue;
    }

    const target = pickTarget(ctx, e, def);
    b.target = target?.id ?? null;

    if (a?.kind === 'attack') {
      runAttack(ctx, e, def, target, spawnProjectile, rng);
      continue;
    }

    if (def.dummy) dummyThink(ctx, e, def, target);
    else bruteThink(ctx, e, def, target, rng);
  }
}

function pickTarget(ctx: CombatCtx, e: Entity, def: EnemyDef): Entity | null {
  let best: Entity | null = null;
  let bestD = def.aggroRange;
  for (const p of ctx.entities) {
    if (p.kind !== 'player' || p.combat?.action?.kind === 'dead') continue;
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

function startAttack(ctx: CombatCtx, e: Entity, move: EnemyMoveDef): void {
  const c = e.combat!;
  c.action = { kind: 'attack', move: move.id, t: 0, clipT: 0, charge: 0, charging: false, charged: false, hit: [], lunge: 0, lungeDir: { x: 0, z: 0 } };
  e.brain!.cooldowns[move.id] = move.cooldown;
  const recent = e.brain!.recent;
  recent.push(move.id);
  if (recent.length > 2) recent.shift();
  ctx.events.push({ type: 'telegraph', entity: e.id, move: move.id, ticks: move.windup, unblockable: !!move.unblockable, decal: move.decal });
}

function runAttack(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity | null, spawn: SpawnProjectile, rng: RngState): void {
  const a = e.combat!.action;
  if (a?.kind !== 'attack') return;
  const move = def.moves.find((m) => m.id === a.move)!;
  // Track the target during the first part of the wind-up, then commit.
  if (target && a.t < move.windup * move.trackUntil) e.tf.yaw = turnToward(e.tf.yaw, yawTo(e.tf.pos, target.tf.pos), def.turnRate * DT);
  a.t++;
  if (a.t === move.windup) {
    ctx.events.push({ type: 'swing', entity: e.id, move: move.id, heavy: !!move.hyperArmor });
    if (move.projectile && target && !a.fired) {
      a.fired = true;
      spawn(e, move, target);
    }
  }
  ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
  if (a.t >= move.windup + move.active + move.recovery) {
    e.combat!.action = null;
    // After a Brute's attack, sometimes back off and circle for a moment.
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
    startAttack(ctx, e, move);
    b.timer = move.cooldown;
  }
}

function bruteThink(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity | null, rng: RngState): void {
  const b = e.brain!;
  const home = b.home;
  const fromHome = flatDist(e.tf.pos, home);
  const go = (tx: number, tz: number, speed: number) => {
    const dx = tx - e.tf.pos.x, dz = tz - e.tf.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) return ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
    e.tf.yaw = turnToward(e.tf.yaw, Math.atan2(dx, dz), def.turnRate * DT);
    ctx.motion.set(e.id, { vx: (dx / d) * speed, vz: (dz / d) * speed, inputScale: 0 });
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
    const yaw = yawTo(e.tf.pos, target.tf.pos);
    e.tf.yaw = turnToward(e.tf.yaw, yaw, def.turnRate * DT);
    // Strafe around the target (perpendicular to the line between them).
    const sx = Math.cos(yaw) * b.circleDir, sz = -Math.sin(yaw) * b.circleDir;
    ctx.motion.set(e.id, { vx: sx * CIRCLE_SPEED, vz: sz * CIRCLE_SPEED, inputScale: 0 });
    return;
  }

  const ready = (m: EnemyMoveDef) => (b.cooldowns[m.id] ?? 0) <= 0 && !(b.recent.length === 2 && b.recent.every((r) => r === m.id));
  // Sometimes step in for a shorter-reach move (the kick) instead of always swinging from the
  // longest reach, so a player who stands still still sees the whole moveset.
  if (b.stepIn === undefined && def.moves.length > 1) {
    const shortest = def.moves.reduce((m, x) => (x.range < m.range ? x : m));
    b.stepIn = ready(shortest) && gap > shortest.range && rngNext(rng) < 0.35 ? shortest.range - 0.2 : 0;
  }
  if (b.stepIn && gap > b.stepIn) {
    go(target.tf.pos.x, target.tf.pos.z, def.moveSpeed);
    return;
  }
  const options = def.moves.filter((m) => gap <= m.range && ready(m));
  const facing = Math.abs(((yawTo(e.tf.pos, target.tf.pos) - e.tf.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.6;
  if (options.length && facing) {
    let total = 0;
    for (const m of options) total += m.weight;
    let roll = rngNext(rng) * total;
    let pick = options[options.length - 1];
    for (const m of options) {
      roll -= m.weight;
      if (roll <= 0) {
        pick = m;
        break;
      }
    }
    startAttack(ctx, e, pick);
    b.stepIn = undefined;
    ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
    return;
  }
  // Close in until just inside the shortest reach, then turn to face.
  const want = Math.min(...def.moves.map((m) => m.range)) - MIN_GAP;
  if (gap > want) go(target.tf.pos.x, target.tf.pos.z, def.moveSpeed);
  else {
    e.tf.yaw = turnToward(e.tf.yaw, yawTo(e.tf.pos, target.tf.pos), def.turnRate * DT);
    ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
  }
}

/** Where an enemy's projectile leaves from (its move's hitbox point). */
export function muzzle(e: Entity, move: EnemyMoveDef) {
  return toWorld(e.tf.pos, e.tf.yaw, [0, move.hitbox.up, move.hitbox.forward]);
}
