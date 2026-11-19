import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import { aiStyle, type AiStyle } from '../../content/packs/aiStyles';
import { DT } from '../../content/tuning';
import { flatDist, toWorld, yawTo } from '../combat/geometry';
import type { CombatCtx } from '../combat/playerCombat';
import { clockTicks, moveScale } from '../combat/statuses';
import type { Entity, EntityId } from '../entity';
import { affixSpeed } from '../systems/affixes';
import { turnToward, wrapAngle } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { next as rngNext, range as rngRange, type RngState } from '../rng';
import { bossAttackTick, bossEngaged, bossPreTick, bossSpeed, bossThink, type BossHost } from '../systems/boss';
import { drakeTick } from '../systems/drake';
import { drive, fightClock, groundAt, lookForTarget, newFight, nextBeat, readTarget, ringSlots, slotPull } from './tactics';

/** Spawns one projectile for an enemy's ranged move (provided by SimWorld). `angle` fans it out. */
export type SpawnProjectile = (owner: Entity, move: EnemyMoveDef, target: Entity, angle: number) => void;

/** Attack tokens per target player (plan §4.8): at most this many melee and ranged wind-ups at once. */
export const TOKENS = { melee: 2, ranged: 1 } as const;

/** Strafe speed while circling (m/s), and the band a token-less melee enemy circles in (m). */
const CIRCLE_SPEED = 1.7;
const WAIT_BAND: [number, number] = [4, 7];
const MIN_GAP = 0.6;
/** A player moving away faster than this (m/s) is retreating. */
const RETREAT_SPEED = 1.5;
/** How long a punish or the end of a lunge keeps its next attack immediate (ticks). */
const EAGER_TICKS = 30;
/** It weighs up punishing a mistake once in this many ticks. */
const PUNISH_COOLDOWN = 90;
/** A feint breaks off this far through the wind-up, and the real attack follows this soon (ticks). */
const FEINT_AT = 0.55;
const FEINT_REST: [number, number] = [12, 22];
/** Ranged: with no clear shot for this long it stops sidestepping and walks in (ticks). */
const BLIND_LIMIT = 180;
/** A walk home gets this many times the ticks it should take (plus a moment), then the enemy is put back there. */
const LEASH_PATIENCE = 3;
const LEASH_GRACE = 60;
/** A blink looks for the ground this far above where it starts (m), and twice as far down. */
const BLINK_GROUND_RAY = 5;

/**
 * Enemy brains (plan §4.8). Dummies run fixed timers. Fighters approach (melee) or hold a distance
 * band (ranged), take an attack token before winding up so a group never all swings at once,
 * pick an attack by distance band and weight (never one move three times running), keep their feet
 * moving between attacks in the style of their type (`content/packs/aiStyles.ts`), react to what the
 * player does, and leash home if pulled too far. Chill slows their clock and feet.
 */
export function enemyBrains(ctx: CombatCtx, rng: RngState, physics: PhysicsWorld, spawnProjectile: SpawnProjectile, bossHost?: BossHost): void {
  const slots = ringSlots(ctx);
  const duels = ctx.entities.filter((e) => bossEngaged(e));
  for (const e of ctx.entities) {
    const b = e.brain;
    const c = e.combat;
    if (!b || !c) continue;
    const def = ENEMIES[b.def];
    for (const k of Object.keys(b.cooldowns)) if (b.cooldowns[k] > 0) b.cooldowns[k]--;
    fightClock(e);
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
      if (b.fight) b.fight.burst = null;
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
    else fighterThink(ctx, e, def, target, rng, physics, slots);
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
  // Hurt by someone beyond its sight: it comes for them, anywhere inside its leash.
  let bestD = !def.dummy && e.vitals!.hp < e.vitals!.hpMax ? Infinity : def.aggroRange;
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

/** The tick a delayed swing waits on: late in the wind-up, while it can still turn to follow the player. */
const holdTick = (move: EnemyMoveDef) => Math.max(1, Math.floor(move.windup * Math.min(move.trackUntil, 0.6)) - 1);

/** `hold`: extra ticks the wind-up waits at its peak. The telegraph counts them. */
function startAttack(ctx: CombatCtx, e: Entity, move: EnemyMoveDef, target: Entity | null, hold = 0): void {
  const c = e.combat!;
  const f = e.brain!.fight;
  if (f) {
    f.hold = hold;
    f.holdAt = holdTick(move);
    f.feintAt = -1;
    f.vx = f.vz = 0;
  }
  const aim = move.area && target ? { ...target.tf.pos } : undefined;
  c.action = { kind: 'attack', move: move.id, t: 0, clipT: 0, charge: 0, charging: false, charged: false, hit: [], lunge: 0, lungeDir: { x: 0, z: 0 }, fired: 0, aim };
  e.brain!.cooldowns[move.id] = move.cooldown;
  const recent = e.brain!.recent;
  recent.push(move.id);
  if (recent.length > 2) recent.shift();
  ctx.events.push({
    type: 'telegraph', entity: e.id, move: move.id, ticks: move.windup + hold, unblockable: !!move.unblockable, decal: move.decal,
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
  const f = e.brain!.fight;
  if (ticks) {
    if (f && f.hold > 0 && a.t === f.holdAt) f.hold--;
    else a.t++;
  }
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
  if (f && f.feintAt >= 0 && a.t >= f.feintAt) {
    breakOff(e, move, rng);
    return;
  }
  if (a.t >= move.windup + move.active + move.recovery) {
    e.combat!.action = null;
    // A string (the Gatekeeper's 3-hit): the next move starts at once, still holding its token.
    const next = move.followUp ? def.moves.find((m) => m.id === move.followUp) : undefined;
    if (next && target) {
      startAttack(ctx, e, next, target);
      return;
    }
    // A rest before the next attack, as long as its type likes, on its feet.
    if (!def.dummy) {
      const [lo, hi] = aiStyle(def.id).pause;
      e.brain!.circle = rngRange(rng, lo, hi);
      e.brain!.circleDir = rngNext(rng) < 0.5 ? -1 : 1;
    }
  }
}

/** A feint: the wind-up stops short and nothing swings. Its cooldown is refunded, and the next attack is real. */
function breakOff(e: Entity, move: EnemyMoveDef, rng: RngState): void {
  const b = e.brain!;
  const f = b.fight!;
  e.combat!.action = null;
  f.feintAt = -1;
  f.feinted = true;
  b.cooldowns[move.id] = 0;
  b.circle = rngRange(rng, FEINT_REST[0], FEINT_REST[1]);
}

/** Starts a fighter's chosen attack, deciding whether this one is held back or is a feint. */
function swing(ctx: CombatCtx, e: Entity, def: EnemyDef, style: AiStyle, move: EnemyMoveDef, target: Entity, gap: number, rng: RngState): void {
  const f = e.brain!.fight!;
  // Only a plain melee swing plays with its timing: anything with a marked circle lands when it says.
  const plain = !move.area && !move.leap && !move.decal && !move.projectile && !move.charge && !move.unblockable;
  let hold = 0, feintAt = -1;
  if (plain && f.eager <= 0 && !f.feinted) {
    // No feint on the move it just used while it has another to hand: with the real swing after it,
    // that would read as three in a row.
    const repeat = e.brain!.recent[e.brain!.recent.length - 1] === move.id;
    const other = def.moves.some((m) => m !== move && !m.chainOnly && gap <= m.range && gap >= (m.minRange ?? 0));
    if (!(repeat && other) && rngNext(rng) < style.feint) feintAt = Math.max(1, Math.floor(move.windup * FEINT_AT));
    else if (rngNext(rng) < style.delay.chance) hold = rngRange(rng, style.delay.ticks[0], style.delay.ticks[1]);
  }
  f.feinted = false;
  f.eager = 0;
  startAttack(ctx, e, move, target, hold);
  f.feintAt = feintAt;
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

function fighterThink(ctx: CombatCtx, e: Entity, def: EnemyDef, target: Entity | null, rng: RngState, physics: PhysicsWorld, slots: ReadonlyMap<EntityId, number>): void {
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

  // Leash: pulled too far from home, or the player it was fighting got away: walk back fast,
  // healing, ignoring the player.
  if (b.state !== 'leash' && ((!target && b.state === 'engage' && fromHome > 1) || fromHome > def.leashRange)) {
    b.state = 'leash';
    b.timer = Math.ceil(fromHome / (def.moveSpeed * 2 * DT)) * LEASH_PATIENCE + LEASH_GRACE;
  }
  if (b.state === 'leash') {
    e.vitals!.hp = Math.min(e.vitals!.hpMax, e.vitals!.hp + e.vitals!.hpMax * 0.02);
    if (fromHome >= 1 && --b.timer > 0) {
      go(home.x, home.z, def.moveSpeed * 2);
      return;
    }
    // Home, or something stands in the way of the straight walk there: it mustn't run at it forever.
    if (fromHome >= 1) {
      e.tf.pos = { ...home };
      e.tf.prevPos = { ...home };
      e.tf.vel = { x: 0, y: 0, z: 0 };
      physics.teleport(e.id, e.tf.pos);
    }
    b.state = 'idle';
    e.vitals!.hp = e.vitals!.hpMax;
    ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
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
  if (b.state !== 'engage' || !b.fight) b.fight = newFight(e);
  b.state = 'engage';
  const f = b.fight;
  const style = aiStyle(def.id);
  const speed = def.moveSpeed;
  const gap = flatDist(e.tf.pos, target.tf.pos) - (target.body?.radius ?? 0.35);
  const reach = Math.min(...picks.map((m) => m.range));

  /** Move around the target while facing it: `lateral` m/s sideways, `radial` m/s toward it (− away). */
  const orbit = (lateral: number, radial: number, ease?: number) => {
    const yaw = yawTo(e.tf.pos, target.tf.pos);
    e.tf.yaw = turnToward(e.tf.yaw, yaw, def.turnRate * DT);
    drive(ctx, e, def, physics, Math.cos(yaw) * lateral + Math.sin(yaw) * radial, -Math.sin(yaw) * lateral + Math.cos(yaw) * radial, ease);
  };
  const pull = slotPull(e, target, slots) * style.flank;
  const read = readTarget(target, e);
  const pressing = read.tired || read.retreat > RETREAT_SPEED;

  /** Its feet between attacks: circling, stepping in and back, holding its ground, as its type likes. */
  const feet = () => {
    nextBeat(f, e, style, rng);
    const lateral = (f.foot === 'hold' ? 0 : b.circleDir * speed * style.strafe) + pull * speed * 0.5;
    if (def.keepRange) {
      const [lo, hi] = def.keepRange;
      const radial = gap < lo - style.kite ? -speed * 0.6 : gap > hi - 1 ? speed * 0.4 : Math.sin((ctx.now + e.id * 37) / 40) * style.sway;
      orbit(lateral, radial);
      return;
    }
    const near = reach + style.band[0], far = reach + style.band[1];
    let radial = 0;
    if (gap < near) radial = -speed * 0.6;
    else if (gap > far) radial = speed * (gap > far + 2 ? 1 : 0.6);
    else if (f.foot === 'in' || pressing) radial = speed * 0.35;
    else if (f.foot === 'out') radial = -speed * 0.35;
    orbit(lateral, radial);
  };
  const startLunge = (lunge: NonNullable<AiStyle['lunge']>) => {
    f.burst = 'lunge';
    f.burstT = lunge.ticks;
    f.burstSpeed = speed * lunge.speed;
    f.lungeCd = lunge.cooldown;
    f.cornered = 0;
    orbit(0, f.burstSpeed, 1);
  };

  // A burst of speed runs its course first.
  if (f.burst === 'lunge') {
    if (--f.burstT > 0 && gap > reach - 0.15 && f.cornered <= 0) {
      orbit(0, f.burstSpeed, 1);
      return;
    }
    f.burst = null;
    f.eager = EAGER_TICKS;
    b.circle = 0;
  } else if (f.burst === 'evade') {
    if (--f.burstT > 0 && f.cornered <= 0) {
      e.tf.yaw = turnToward(e.tf.yaw, yawTo(e.tf.pos, target.tf.pos), def.turnRate * DT);
      drive(ctx, e, def, physics, f.burstX * f.burstSpeed, f.burstZ * f.burstSpeed, 1);
      return;
    }
    f.burst = null;
  }

  // Hit too often: step out of it, backward or to the side.
  const evade = style.evade;
  if (evade && f.hits >= evade.hits && f.evadeCd <= 0) {
    const yaw = yawTo(e.tf.pos, target.tf.pos);
    const side = rngNext(rng) < 0.5 ? 1 : -1;
    const back = rngNext(rng) < evade.back;
    f.burst = 'evade';
    f.burstT = evade.ticks;
    f.burstX = back ? -Math.sin(yaw) : Math.cos(yaw) * side;
    f.burstZ = back ? -Math.cos(yaw) : -Math.sin(yaw) * side;
    f.burstSpeed = speed * evade.speed;
    f.hits = 0;
    f.evadeCd = evade.cooldown;
    f.cornered = 0;
    b.circle = Math.max(b.circle, 20);
    drive(ctx, e, def, physics, f.burstX * f.burstSpeed, f.burstZ * f.burstSpeed, 1);
    return;
  }

  const hasTokenFor = picks.some((m) => hasToken(ctx, e, def, m, target));

  // A tonic or a whiffed swing nearby is an opening: drop the rest and go.
  if (f.punishCd <= 0 && (read.drinking || read.whiffing)) {
    f.punishCd = PUNISH_COOLDOWN;
    const chance = read.drinking ? style.punish.heal : style.punish.whiff;
    if (gap <= style.punish.range && hasTokenFor && rngNext(rng) < chance) {
      b.circle = 0;
      f.eager = EAGER_TICKS;
      if (!def.keepRange && style.lunge && gap > reach) {
        startLunge(style.lunge);
        return;
      }
    }
  }
  // A player backing away gets chased down.
  const lunge = style.lunge;
  if (lunge && !def.keepRange && f.lungeCd <= 0 && read.retreat > RETREAT_SPEED && hasTokenFor && gap >= reach + lunge.from && gap <= reach + lunge.to) {
    startLunge(lunge);
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
  // §4.8), instead of standing in your face waiting for a slot. The ring spreads them around you.
  if (!def.keepRange && def.usesTokens && !hasTokenFor) {
    const [lo, hi] = WAIT_BAND;
    const radial = gap < lo ? -speed * 0.7 : gap > hi ? speed * 0.7 : Math.sin((ctx.now + e.id * 37) / 25) * 1.2;
    orbit(b.circleDir * CIRCLE_SPEED + pull * speed * 0.5, radial);
    return;
  }
  // Ranged fighters hold their band: back off when crowded (so melee them!), close in when too far,
  // and move to find a clear line of fire. Cornered, they stand and shoot.
  if (def.keepRange) {
    lookForTarget(ctx, e, target, physics);
    const [lo, hi] = def.keepRange;
    if (gap < lo - 3 && f.cornered <= 0) {
      orbit(b.circleDir * CIRCLE_SPEED * 0.5, -speed * 0.85, 1);
      return;
    }
    if (gap > hi || f.blind > BLIND_LIMIT) {
      orbit(0, speed, 1);
      return;
    }
    if (!f.sight) {
      orbit(b.circleDir * speed * 0.8, 0);
      return;
    }
  }
  // The rest after an attack. A tired or retreating player cuts it short.
  if (b.circle > 0) {
    b.circle -= pressing ? 1 + Math.round(style.press * 2) : 1;
    feet();
    return;
  }
  // Sometimes step in for a shorter-reach move instead of always swinging from the longest reach,
  // so a player who stands still still sees the whole moveset.
  if (!def.keepRange && b.stepIn === undefined && picks.length > 1) {
    const shortest = picks.reduce((m, x) => (x.range < m.range ? x : m));
    b.stepIn = ready(shortest) && gap > shortest.range && rngNext(rng) < 0.35 ? shortest.range - 0.2 : 0;
  }
  if (b.stepIn && gap > b.stepIn) {
    orbit(pull * speed * 0.5, speed, 1);
    return;
  }
  const yawToTarget = yawTo(e.tf.pos, target.tf.pos);
  // No leap onto ground that isn't there.
  const usable = (m: EnemyMoveDef) => !m.leap || groundAt(e, physics, e.tf.pos.x + Math.sin(yawToTarget) * m.leap.distance, e.tf.pos.z + Math.cos(yawToTarget) * m.leap.distance);
  const options = picks.filter((m) => inRange(m) && ready(m) && usable(m));
  const facing = Math.abs(wrapAngle(yawToTarget - e.tf.yaw)) < 0.6;
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
    swing(ctx, e, def, style, pick, target, gap, rng);
    b.stepIn = undefined;
    ctx.motion.set(e.id, { vx: 0, vz: 0, inputScale: 0 });
    return;
  }
  // Something to swing but out of reach: close in, fanning out toward its place in the ring.
  if (!def.keepRange && picks.some(ready) && gap > reach - MIN_GAP) {
    const lateral = pull * speed * 0.5;
    const k = speed / Math.hypot(lateral, speed);
    orbit(lateral * k, speed * k, 1);
    return;
  }
  feet();
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
    const x = from.x + dir.x * dist, z = from.z + dir.z * dist;
    // On the ground there: uphill, its old height is inside the hill, and a body inside the ground falls through it.
    const ground = physics.raycast({ x, y: from.y + BLINK_GROUND_RAY, z }, { x: 0, y: -1, z: 0 }, BLINK_GROUND_RAY * 2);
    if (!ground) continue;
    e.tf.pos = { x, y: ground.point.y + 0.02, z };
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
