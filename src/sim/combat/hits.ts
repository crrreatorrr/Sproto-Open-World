import {
  BACKSTAB, BLOCK, BREAK_CRIT, CHARGED_HEAVY, COUNTER, CRIT_HITSTOP, HITSTOP_CAP, MANA, PLAYER_MOVES, PLAYER_STATS, STAFFS, clipTiming, type DamageKind, type PlayerMoveId,
} from '../../content/combat';
import { dodgeFrames } from '../../content/packs/m7';
import { MOUNT } from '../../content/mounts';
import { PLAYER_HITBOXES, STAFF_CAPSULE_RADIUS } from '../../content/generated/playerHitboxes';
import { AFFINITY_MULT, ENEMIES, type Affinity, type EnemyMoveDef } from '../../content/enemies';
import { affixedMove } from '../../content/enemyScale';
import { PERK_EFFECT, SKILL_EFFECT, hasPerk } from '../../content/progression';
import { STATUS } from '../../content/statuses';
import { affixAffinity, affixElite } from '../systems/affixes';
import { blockStaminaMul, onRelicParry, rollFrames, tryBriar, tryGuardCounter } from '../systems/relics';
import { charmOf, staffOf } from '../systems/rpg';
import { sanctuaryBlocks } from '../systems/sanctuary';
import { rootedMult } from './powers/snare';
import { applyStatus } from './statuses';
import { staffAfterReaction, staffOnHit, staffPoiseMult, staffPushback, staffStaggerBonus } from './staffTraits';
import type { Action, Entity } from '../entity';
import type { MeleeStrike } from '../events';
import type { Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CombatCtx } from './playerCombat';
import { angleTo, bodySegment, segmentSegmentDistSq, toWorld } from './geometry';

/** Everything resolveHit needs to know about one connecting attack or projectile. */
export interface HitInfo {
  move: string;
  /** Damage before defense and multipliers (power × MV, or an enemy move's damage). */
  base: number;
  kind: DamageKind;
  poise: number;
  hitstun: number;
  knockdown: boolean;
  /** Push the target this far (m) over 6 ticks. */
  pushback: number;
  hitstop: number;
  unblockable: boolean;
  heavy: boolean;
  crit: boolean;
  /** Mana the attacker gains. */
  mana: number;
  /** Where the hit comes from (attacker position, or the projectile's). */
  from: Vec3;
  projectile: boolean;
  /** The swing's capsule this tick, for weak spots (default: a small ball at `from`). */
  contact?: { a: Vec3; b: Vec3; radius: number };
  /** Exactly this much damage, whatever the formula says (a parried Scrap Throw). */
  fixedDamage?: number;
  /** A blast on a circle on the ground: its owner may be far away, so parrying it stuns nobody. */
  area?: boolean;
  /** The player's staff swing: only these can be a break critical or a backstab. */
  melee?: boolean;
  /** A shot the player parried back. */
  reflected?: boolean;
  /** The enemy move that fired a projectile. */
  sourceMove?: string;
}

export type HitOutcome = 'dodged' | 'parried' | 'blocked' | 'hit';

const PUSH_TICKS = 6;
/** Hit-stop for a plain block (both sides). */
const BLOCK_HITSTOP = 3;
const POISE_REGEN_DELAY = 180;

export const addHitstop = (e: Entity, ticks: number): void => {
  if (e.combat) e.combat.hitstop = Math.min(HITSTOP_CAP, Math.max(e.combat.hitstop, ticks));
};

function affinityOf(target: Entity, kind: DamageKind): Affinity {
  const def = target.brain ? ENEMIES[target.brain.def] : undefined;
  return def ? affixAffinity(target, def.profile.damage[kind]) : 'normal';
}

/**
 * The best weak spot a hit touches (expansion plan §3.3): spheres in the target's facing frame, its
 * own and those of the move it is doing, checked only here, when damage resolves. 1 = none.
 */
function weakSpotMult(target: Entity, info: HitInfo): number {
  const def = target.brain ? ENEMIES[target.brain.def] : undefined;
  if (!def) return 1;
  const a = target.combat?.action;
  const during = a?.kind === 'attack' ? enemyMove(target, a.move)?.weakSpots : undefined;
  const spots = during ? [...(def.weakSpots ?? []), ...during] : def.weakSpots;
  if (!spots?.length) return 1;
  const c = info.contact ?? { a: info.from, b: info.from, radius: 0.3 };
  let best = 1;
  for (const s of spots) {
    if (s.when === 'stunned' && !(a?.kind === 'stagger' && a.reason === 'stunned')) continue;
    const centre = toWorld(target.tf.pos, target.tf.yaw, [0, s.up, s.forward]);
    const r = s.radius + c.radius;
    if (segmentSegmentDistSq(c.a, c.b, centre, centre) <= r * r) best = Math.max(best, s.mult);
  }
  return best;
}

/** Is this action the stagger of a broken poise? */
const isBroken = (a: Action | null): boolean => a?.kind === 'stagger' && a.reason === 'broken';

const isBoss = (e: Entity): boolean => !!e.boss || e.kind === 'boss';

/**
 * What a swing earned. The first melee hit on a broken enemy is its break critical (one per break);
 * otherwise a melee hit from behind on a non-boss that isn't attacking you is a backstab.
 */
function meleeStrike(attacker: Entity, target: Entity, info: HitInfo): MeleeStrike | null {
  if (!info.melee) return null;
  const ta = target.combat!.action;
  if (ta?.kind === 'stagger' && ta.reason === 'broken' && !ta.critTaken) return 'breakCrit';
  // A riposte has its own bonus: from behind it is no bigger.
  if (isBoss(target) || info.move === 'riposte') return null;
  if (ta?.kind === 'attack' && (target.brain?.target ?? attacker.id) === attacker.id) return null;
  const behind = Math.PI - ((BACKSTAB.arcDeg / 2) * Math.PI) / 180;
  return angleTo(target.tf.pos, target.tf.yaw, info.from) >= behind ? 'backstab' : null;
}

/** The damage multiplier a strike adds. */
function strikeDamage(target: Entity, strike: MeleeStrike | null): number {
  if (strike === 'breakCrit') return isBoss(target) ? BREAK_CRIT.bossDamage : BREAK_CRIT.damage;
  return strike === 'backstab' ? BACKSTAB.damage : 1;
}

/** Plan §4.6 damage formula (no random variance, no random crits). `bonus` multiplies it: a weak spot, a strike. */
export function computeDamage(attacker: Entity, target: Entity, info: HitInfo, bonus = 1): { damage: number; crit: boolean; affinity: Affinity } {
  const tc = target.combat!;
  const crit = info.crit;
  const affinity = affinityOf(target, info.kind);
  if (info.fixedDamage !== undefined) return { damage: Math.max(1, Math.round(info.fixedDamage)), crit, affinity };
  const mitig = (info.base * 100) / (100 + tc.defense[info.kind]);
  // "Stunned" here means frozen (a status), not a stagger.
  const frozen = tc.action?.kind === 'frozen';
  const lv = Math.max(0.8, Math.min(1.2, 1 + 0.05 * ((attacker.combat?.level ?? 1) - tc.level)));
  // A melee hit on a chilled target shatters the chill for ×1.3 (consumed in resolveHit).
  const shatter = !info.projectile && info.kind === 'physical' && !!target.statuses?.chill;
  // Broken (its poise broke): a boss takes more damage until it recovers (plan §4.10).
  const broken = tc.action?.kind === 'stagger' && tc.action.reason === 'broken' && target.brain ? (ENEMIES[target.brain.def].brokenDamage ?? 1) : 1;
  // A riposte on the enemy its parry stunned. On a broken enemy the break critical is the bonus instead.
  const riposte = info.move === 'riposte' && tc.action?.kind === 'stagger' && tc.action.reason === 'parried' ? BLOCK.riposteBonus : 1;
  const mult = riposte * (crit ? 1.5 : 1) * (frozen ? STATUS.chill.frozenDamage : 1) * (shatter ? STATUS.chill.meleeBonus : 1) * rootedMult(target) * lv * AFFINITY_MULT[affinity] * broken * bonus;
  return { damage: Math.max(1, Math.round(mitig * mult)), crit, affinity };
}

/**
 * A parry throws a melee attacker off its blow: the attack is cancelled, and it is stunned for as
 * long as its tier allows. Elites and bosses also lose poise, and a parry can break it. Returns how
 * long it can't act (ticks, not counting the hit-stop).
 */
function stunParried(ctx: CombatCtx, attacker: Entity): number {
  const c = attacker.combat!;
  const def = attacker.brain ? ENEMIES[attacker.brain.def] : undefined;
  const tier = def?.boss ? BLOCK.parryStun.boss : def?.elite || affixElite(attacker) ? BLOCK.parryStun.elite : BLOCK.parryStun.normal;
  addHitstop(attacker, BLOCK.parryHitstop);
  if (tier.poise > 0) {
    c.poise -= c.poiseMax * tier.poise;
    c.poiseDelay = POISE_REGEN_DELAY;
  }
  if (c.poise <= 0) {
    c.poise = c.poiseMax;
    const ticks = def?.staggerTicks ?? 40;
    c.action = { kind: 'stagger', t: 0, dur: ticks, reason: 'broken' };
    ctx.events.push({ type: 'stagger', entity: attacker.id, ticks });
    return ticks;
  }
  c.action = { kind: 'stagger', t: 0, dur: tier.ticks, reason: 'parried' };
  ctx.events.push({ type: 'stagger', entity: attacker.id, ticks: tier.ticks, reason: 'parried' });
  return tier.ticks;
}

/**
 * One attack or projectile connecting with one target: dodge, parry, block, or damage with poise,
 * hitstun, pushback, hit-stop and death (plan §4.2–4.6).
 */
export function resolveHit(ctx: CombatCtx, attacker: Entity, target: Entity, info: HitInfo): HitOutcome {
  const tc = target.combat!;
  const tv = target.vitals!;
  const ta = tc.action;
  // Sparks and numbers show at the chest, or where the blow landed on a body too tall to reach that high.
  const chestY = target.tf.pos.y + (target.body?.height ?? 1.8) * 0.6;
  const reached = target.kind !== 'player' && info.contact ? Math.max(info.contact.a.y, info.contact.b.y) + info.contact.radius : chestY;
  const chest = { x: target.tf.pos.x, y: Math.min(chestY, reached), z: target.tf.pos.z };

  // The Momentum staff's blink can't be touched, and neither can a boss underground or a wave still waiting.
  if (ta?.kind === 'blink' || target.boss?.under || target.brain?.held) return 'dodged';
  // A shrine's ground is safe: nothing an enemy does lands on a player inside it.
  if (sanctuaryBlocks(ctx.entities, attacker, target)) return 'dodged';

  // Roll and backstep i-frames; a hit early in them is a perfect dodge. Sproto's Stride lengthens a roll.
  const frames = ta?.kind === 'dodge' ? rollFrames(target, ta) : null;
  if (ta?.kind === 'dodge' && frames && ta.t >= frames.iframeStart && ta.t <= frames.iframeEnd) {
    if (ta.t <= frames.perfectEnd) {
      tv.stamina = Math.min(tv.staminaMax, tv.stamina + dodgeFrames(ta).stamina);
      tv.mana = Math.min(tv.manaMax, tv.mana + MANA.perfectDodge);
      tc.critNext = true;
      tc.counterUntil = ctx.now + COUNTER.window;
      ctx.events.push({ type: 'dodgePerfect', entity: target.id, attacker: attacker.id });
    }
    return 'dodged';
  }

  // Block (150° frontal arc) and parry (its first ticks).
  const facing = angleTo(target.tf.pos, target.tf.yaw, info.from) <= ((BLOCK.arcDeg / 2) * Math.PI) / 180;
  if (ta?.kind === 'block' && facing && !info.unblockable) {
    // The block's parryTicks already include Coins and the Grip (playerCombat.updateBlock).
    if (ta.t < ta.parryTicks) {
      tv.mana = Math.min(tv.manaMax, tv.mana + BLOCK.parryMana);
      // A parry that landed was timed, not mashed: the next press gets the whole window again.
      tc.lastBlockTick = ctx.now - BLOCK.spamWindow;
      addHitstop(target, BLOCK.parryHitstop);
      const stun = !info.projectile && !info.area && attacker.combat ? stunParried(ctx, attacker) : 0;
      if (stun > 0) {
        // Open for as long as a riposte started now still lands inside the stun.
        tc.riposteUntil = ctx.now + BLOCK.parryHitstop + Math.max(0, stun - BLOCK.riposteStartup);
        tc.riposteTarget = attacker.id;
      }
      ctx.events.push({ type: 'parry', attacker: attacker.id, target: target.id, projectile: info.projectile, pos: chest, ...(stun > 0 ? { stun } : {}) });
      // Combat 10: a parry restores 5% HP.
      if (hasPerk(target.progress?.skills, 'combat10')) tv.hp = Math.min(tv.hpMax, tv.hp + tv.hpMax * PERK_EFFECT.parryHeal);
      if (!info.projectile && target.progress && charmOf(target.progress)?.burnOnParry && attacker.combat) applyStatus(ctx, attacker, 'burn', 1, target.id);
      if (target.progress) onRelicParry(ctx, target);
      return 'parried';
    }
    const { damage } = computeDamage(attacker, target, info);
    const chip = Math.max(1, Math.round(damage * BLOCK.chip));
    tv.hp -= chip;
    tv.stamina -= (info.poise / 2) * blockStaminaMul(target);
    tv.staminaDelay = PLAYER_STATS.staminaDelay;
    const guardBreak = tv.stamina <= 0;
    if (guardBreak) {
      tv.stamina = 0;
      tc.action = { kind: 'stagger', t: 0, dur: BLOCK.guardBreakTicks };
    } else if (!info.projectile && !info.area) {
      tc.guardCounterUntil = ctx.now + BLOCK_HITSTOP + BLOCK.guardCounterWindow;
      if (target.progress) tryGuardCounter(ctx, target, attacker, true);
    }
    addHitstop(target, BLOCK_HITSTOP);
    if (!info.projectile) addHitstop(attacker, BLOCK_HITSTOP);
    ctx.events.push({ type: 'block', attacker: attacker.id, target: target.id, damage: chip, guardBreak, pos: chest });
    if (tv.hp <= 0) kill(ctx, target, attacker);
    return 'blocked';
  }

  const ac = attacker.combat;
  const strike = meleeStrike(attacker, target, info);
  // A break critical is its own reward: a perfect dodge's critical waits for the next hit.
  const earned = !info.projectile && !!ac?.critNext && strike !== 'breakCrit';
  const crit = info.crit || earned || strike === 'breakCrit';
  if (ac && crit && ac.critNext && strike !== 'breakCrit') ac.critNext = false;
  if (strike === 'breakCrit' && ta?.kind === 'stagger') ta.critTaken = true;
  const weakSpot = weakSpotMult(target, info);
  const rolled = computeDamage(attacker, target, { ...info, crit }, weakSpot * strikeDamage(target, strike));
  let damage = rolled.damage;
  const affinity = rolled.affinity;
  // Surgebriar: an unguarded hit from anything but a boss can fall to block chip. Never an unblockable.
  if (target.progress && tryBriar(ctx, target, !!info.unblockable, attacker.kind === 'boss' || !!attacker.boss)) {
    damage = Math.max(1, Math.round(damage * BLOCK.chip));
  }
  if (!info.projectile && info.kind === 'physical' && target.statuses?.chill) {
    delete target.statuses.chill;
    ctx.events.push({ type: 'statusEnd', entity: target.id, status: 'chill' });
  }
  tv.hp -= damage;
  // Poise that just broke can't break again until the stagger is over.
  const wasBroken = isBroken(ta);
  const wasParried = ta?.kind === 'stagger' && ta.reason === 'parried';
  const poiseDmg = wasBroken ? 0 : info.poise * (crit ? 1.5 : 1) * (strike === 'backstab' ? BACKSTAB.poise : 1) * AFFINITY_MULT[affinity] * staffPoiseMult(attacker);
  tc.poise -= poiseDmg;
  tc.poiseDelay = POISE_REGEN_DELAY;
  const hitstop = Math.min(HITSTOP_CAP, strike === 'breakCrit' ? Math.max(info.hitstop, BREAK_CRIT.hitstop) : strike === 'backstab' ? Math.max(info.hitstop, BACKSTAB.hitstop) : earned ? info.hitstop + CRIT_HITSTOP : info.hitstop);
  if (ac && !info.projectile) {
    ac.lastHitTick = ctx.now;
    const bonus = attacker.progress ? (charmOf(attacker.progress)?.manaPerHit ?? 0) : 0;
    if (attacker.vitals) attacker.vitals.mana = Math.min(attacker.vitals.manaMax, attacker.vitals.mana + info.mana + bonus);
    addHitstop(attacker, hitstop);
  }
  addHitstop(target, hitstop);
  ctx.events.push({
    type: 'hit', attacker: attacker.id, target: target.id, move: info.move, damage, kind: info.kind, affinity, crit, heavy: info.heavy, pos: chest, hitstop,
    ...(weakSpot > 1 ? { weakSpot: true } : {}),
    ...(strike ? { strike } : {}),
    ...(info.reflected ? { reflected: true } : {}),
    ...(info.sourceMove ? { sourceMove: info.sourceMove } : {}),
  });

  if (tv.hp <= 0) {
    if (target.brain && (tc.poise <= 0 || wasBroken || ta?.kind === 'stagger')) target.brain.wasStaggered = true;
    kill(ctx, target, attacker);
    return 'hit';
  }

  staffOnHit(ctx, attacker, target, info);

  // Reactions: a poise break staggers anyone; otherwise hitstun unless elite or armored. A frozen
  // target stays frozen (the hit lands, it doesn't flinch).
  const def = target.brain ? ENEMIES[target.brain.def] : undefined;
  if (tc.action?.kind === 'frozen') return 'hit';
  if (def?.blink && !info.projectile && info.kind === 'physical' && target.brain) target.brain.meleeHitsTaken++;
  const armored = hasArmor(target);
  const wasWindingUp = tc.action?.kind === 'attack' && !!enemyMove(target, tc.action.move) && tc.action.t < enemyMove(target, tc.action.move)!.windup;
  let pushed = false;
  // The player has no poise: every normal hit is the plan's fixed 18-tick hitstun.
  if (tc.poise <= 0 && target.kind !== 'player') {
    tc.poise = tc.poiseMax;
    const ticks = (def?.staggerTicks ?? 40) + staffStaggerBonus(attacker, info);
    tc.action = { kind: 'stagger', t: 0, dur: ticks, reason: 'broken' };
    ctx.events.push({ type: 'stagger', entity: target.id, ticks });
    pushed = true;
  } else if (target.kind === 'player' && !armored) {
    tc.action = { kind: 'hitstun', t: 0, dur: PLAYER_STATS.hitstun, knockdown: false };
    tc.buffer = null;
    pushed = true;
  } else if (wasBroken || wasParried) {
    // A break or a parry stun runs its full length: blows that land on it shove the body but never cut it short.
    pushed = true;
  } else if (!def?.elite && !affixElite(target) && !armored) {
    tc.action = { kind: 'hitstun', t: 0, dur: strike === 'backstab' ? Math.max(info.hitstun, BACKSTAB.hitstun) : info.hitstun, knockdown: info.knockdown };
    pushed = true;
  }
  if (wasWindingUp && tc.action?.kind !== 'attack') ctx.events.push({ type: 'interrupt', entity: target.id, by: attacker.id });
  const pushback = staffPushback(attacker, target, info);
  if (pushed && pushback > 0 && target.body && (!def || !def.dummy)) {
    const dx = target.tf.pos.x - info.from.x, dz = target.tf.pos.z - info.from.z;
    const d = Math.hypot(dx, dz) || 1;
    tc.push = { x: (dx / d) * (pushback / PUSH_TICKS), z: (dz / d) * (pushback / PUSH_TICKS), ticks: PUSH_TICKS };
  }
  staffAfterReaction(ctx, attacker, target, info);
  return 'hit';
}

function hasArmor(e: Entity): boolean {
  const a = e.combat?.action;
  if (a?.kind !== 'attack') return false;
  if (e.kind === 'player') {
    // Combat 20: you can't be knocked out of your attacks.
    if (hasPerk(e.progress?.skills, 'combat20')) return true;
    const def = PLAYER_MOVES[a.move as PlayerMoveId];
    return def?.hyperArmorFrom !== undefined && a.clipT >= def.hyperArmorFrom;
  }
  const move = enemyMove(e, a.move);
  return !!move?.hyperArmor;
}

export function enemyMove(e: Entity, id: string): EnemyMoveDef | undefined {
  return e.brain ? ENEMIES[e.brain.def].moves.find((m) => m.id === id) : undefined;
}

export function kill(ctx: CombatCtx, target: Entity, killer: Entity | null): void {
  if (target.brain?.held) return;
  // God mode (testing): never dies.
  if (target.progress?.god) {
    target.vitals!.hp = target.vitals!.hpMax;
    return;
  }
  if (target.brain && target.combat?.action?.kind === 'stagger') target.brain.wasStaggered = true;
  const def = target.brain ? ENEMIES[target.brain.def] : undefined;
  if (def?.dummy && !def.breakable) {
    // Training dummies never die: they refill.
    target.vitals!.hp = target.vitals!.hpMax;
    return;
  }
  target.vitals!.hp = 0;
  target.combat!.action = { kind: 'dead', t: 0 };
  target.combat!.buffer = null;
  target.combat!.push = null;
  delete target.statuses;
  ctx.events.push({ type: 'death', entity: target.id, killer: killer?.id ?? null });
}

/** Test every active attack this tick against the bodies of the other team. */
export function resolveAttacks(ctx: CombatCtx, physics: PhysicsWorld): void {
  for (const att of ctx.entities) {
    const c = att.combat;
    const a = c?.action;
    if (!c || a?.kind !== 'attack' || ctx.frozen.has(att.id)) continue;
    const shape = attackShape(att);
    if (!shape) continue;
    for (const tgt of ctx.entities) {
      if (tgt === att || !tgt.combat || !tgt.body || tgt.combat.team === c.team) continue;
      if (tgt.combat.action?.kind === 'dead' || a.hit.includes(tgt.id)) continue;
      const [b0, b1] = bodySegment(tgt.tf.pos, tgt.body.radius, tgt.body.height);
      const r = shape.radius + tgt.body.radius;
      if (!shapeTouches(shape, b0, b1, r)) continue;
      // An area attack lands where its circle is: a pillar between the caster and you doesn't save you.
      if (!shape.area && !lineOfSight(physics, att, tgt)) continue;
      a.hit.push(tgt.id);
      const outcome = resolveHit(ctx, att, tgt, { ...shape.info, contact: { a: shape.a, b: shape.b, radius: shape.radius } });
      if (outcome === 'hit' && att.kind === 'player') a.connected = true;
      // Parried: the blow is over, for everyone else it was about to reach too.
      if (c.action !== a) break;
    }
  }
}

/** True when no world collider (rock, a gate, a pillar) stands between the two bodies. */
export function lineOfSight(physics: PhysicsWorld, a: Entity, b: Entity): boolean {
  const from = { x: a.tf.pos.x, y: a.tf.pos.y + 1.2, z: a.tf.pos.z };
  const to = { x: b.tf.pos.x, y: b.tf.pos.y + (b.body?.height ?? 1.8) * 0.5, z: b.tf.pos.z };
  const dir = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const dist = Math.hypot(dir.x, dir.y, dir.z);
  if (dist < 0.3) return true;
  const hit = physics.raycast(from, dir, dist);
  return !hit || hit.distance >= dist - 0.3;
}

interface AttackShape {
  a: Vec3;
  b: Vec3;
  radius: number;
  area?: boolean;
  /** Also tested this far (m) below where it is: a swing from a flying bull reaches what it passes over. */
  reachDown?: number;
  info: HitInfo;
}

/** Does this attack's shape touch that body, where it is or (from the air) as far below as it reaches? */
function shapeTouches(shape: AttackShape, b0: Vec3, b1: Vec3, r: number): boolean {
  if (segmentSegmentDistSq(shape.a, shape.b, b0, b1) <= r * r) return true;
  const down = shape.reachDown;
  if (!down) return false;
  const lower = (v: Vec3) => ({ x: v.x, y: v.y - down, z: v.z });
  return segmentSegmentDistSq(lower(shape.a), lower(shape.b), b0, b1) <= r * r;
}

/**
 * A staff hitbox point, in the rider's frame, from the saddle: the swing's arc across the ground is
 * `MOUNT.saddleReach` times as wide, so it clears a bigger bull's flank and nose as it does the hub-sized bull's.
 */
export function saddleReach(local: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = local;
  return [x * MOUNT.saddleReach, y, z * MOUNT.saddleReach];
}

/** The hitbox of an attack on its current tick, or null outside its active window. */
function attackShape(e: Entity): AttackShape | null {
  const a = e.combat!.action;
  if (a?.kind !== 'attack') return null;
  if (e.kind === 'player') {
    const def = PLAYER_MOVES[a.move as PlayerMoveId];
    const tm = clipTiming(def.clip);
    if (a.clipT < tm.activeStart || a.clipT >= tm.activeEnd) return null;
    const box = PLAYER_HITBOXES[def.clip]?.find((h) => h.tick === a.clipT);
    if (!box) return null;
    const staff = e.progress ? staffOf(e.progress) : STAFFS.staff_sproto;
    // Melee power: the staff's damage × (1 + 0.04 · Attack) (expansion plan §7.2).
    const power = staff.damage * (1 + SKILL_EFFECT.attack * (e.progress?.skills.attack ?? 0));
    const charged = a.charged;
    const seated = e.riding?.state === 'riding';
    return {
      a: toWorld(e.tf.pos, e.tf.yaw, seated ? saddleReach(box.a) : box.a),
      b: toWorld(e.tf.pos, e.tf.yaw, seated ? saddleReach(box.b) : box.b),
      radius: STAFF_CAPSULE_RADIUS + (seated ? MOUNT.saddleStaffPad : 0),
      reachDown: e.riding?.flight ? MOUNT.fly.reachDown : undefined,
      info: {
        move: a.move,
        base: power * (charged ? CHARGED_HEAVY.mv : def.mv),
        kind: 'physical',
        poise: charged ? CHARGED_HEAVY.poise : def.poise,
        hitstun: charged ? CHARGED_HEAVY.hitstun : def.hitstun,
        knockdown: !!def.knockdown || charged,
        pushback: charged ? CHARGED_HEAVY.pushback : def.pushback,
        hitstop: charged ? CHARGED_HEAVY.hitstop : def.hitstop,
        unblockable: false,
        heavy: def.mv >= 2 || charged,
        crit: !!def.crit,
        mana: def.mana,
        from: { ...e.tf.pos },
        projectile: false,
        melee: true,
      },
    };
  }
  const base = enemyMove(e, a.move);
  if (!base || base.projectile || base.noHit) return null;
  const move = affixedMove(base, e.view.scale ?? 1);
  if (a.t < move.windup || a.t >= move.windup + move.active) return null;
  // An area attack is a short upright capsule on the circle placed at wind-up start.
  const area = move.area && a.aim;
  // A big swing sweeps its sphere along a short path over the active ticks (expansion plan §3.3).
  const along = (t: number): readonly [number, number, number] => {
    const s = move.sweep;
    const u = Math.min(1, t / Math.max(1, move.active));
    return s ? [0, move.hitbox.up + (s.up - move.hitbox.up) * u, move.hitbox.forward + (s.forward - move.hitbox.forward) * u] : [0, move.hitbox.up, move.hitbox.forward];
  };
  const swing = a.t - move.windup;
  const centre = area ? { x: a.aim!.x, y: a.aim!.y + 0.2, z: a.aim!.z } : toWorld(e.tf.pos, e.tf.yaw, along(swing));
  const top = area ? { x: centre.x, y: centre.y + 1.2, z: centre.z } : toWorld(e.tf.pos, e.tf.yaw, along(swing + 1));
  return {
    a: centre,
    b: top,
    radius: area ? move.area!.radius : move.hitbox.radius,
    area: !!area,
    info: {
      move: move.id,
      base: move.damage,
      kind: move.kind,
      poise: move.poise,
      hitstun: PLAYER_STATS.hitstun,
      knockdown: false,
      pushback: move.knockback ?? 0.5,
      hitstop: move.hitstop,
      unblockable: !!move.unblockable,
      heavy: !!move.hyperArmor,
      crit: false,
      mana: 0,
      from: area ? { ...a.aim! } : { ...e.tf.pos },
      projectile: false,
      area: !!area,
    },
  };
}
