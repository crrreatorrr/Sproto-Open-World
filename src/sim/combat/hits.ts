import {
  BLOCK, CHARGED_HEAVY, HITSTOP_CAP, MANA, PLAYER_MOVES, PLAYER_STATS, ROLL, STAFFS, clipTiming, type DamageKind, type PlayerMoveId,
} from '../../content/combat';
import { PLAYER_HITBOXES, STAFF_CAPSULE_RADIUS } from '../../content/generated/playerHitboxes';
import { AFFINITY_MULT, ENEMIES, type Affinity, type EnemyMoveDef } from '../../content/enemies';
import type { Entity } from '../entity';
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
  return def ? def.profile.damage[kind] : 'normal';
}

/** Plan §4.6 damage formula (no random variance, no random crits). */
export function computeDamage(attacker: Entity, target: Entity, info: HitInfo): { damage: number; crit: boolean; affinity: Affinity } {
  const tc = target.combat!;
  const crit = info.crit;
  const affinity = affinityOf(target, info.kind);
  const mitig = (info.base * 100) / (100 + tc.defense[info.kind]);
  // "Stunned" is the Stun / Frozen statuses (M1b), not a stagger: a riposte on a parried enemy is
  // the table's 75, not 75 × 1.25.
  const stunned = false;
  const lv = Math.max(0.8, Math.min(1.2, 1 + 0.05 * ((attacker.combat?.level ?? 1) - tc.level)));
  const mult = (crit ? 1.5 : 1) * (stunned ? 1.25 : 1) * lv * AFFINITY_MULT[affinity];
  return { damage: Math.max(1, Math.round(mitig * mult)), crit, affinity };
}

/**
 * One attack or projectile connecting with one target: dodge, parry, block, or damage with poise,
 * hitstun, pushback, hit-stop and death (plan §4.2–4.6).
 */
export function resolveHit(ctx: CombatCtx, attacker: Entity, target: Entity, info: HitInfo): HitOutcome {
  const tc = target.combat!;
  const tv = target.vitals!;
  const ta = tc.action;
  const chest = { x: target.tf.pos.x, y: target.tf.pos.y + (target.body?.height ?? 1.8) * 0.6, z: target.tf.pos.z };

  // Roll i-frames; a hit early in them is a perfect dodge.
  if (ta?.kind === 'dodge' && ta.t >= ROLL.iframeStart && ta.t <= ROLL.iframeEnd) {
    if (ta.t <= ROLL.perfectEnd) {
      tv.stamina = Math.min(tv.staminaMax, tv.stamina + ROLL.stamina);
      tv.mana = Math.min(tv.manaMax, tv.mana + MANA.perfectDodge);
      tc.critNext = true;
      ctx.events.push({ type: 'dodgePerfect', entity: target.id, attacker: attacker.id });
    }
    return 'dodged';
  }

  // Block (150° frontal arc) and parry (its first ticks).
  const facing = angleTo(target.tf.pos, target.tf.yaw, info.from) <= ((BLOCK.arcDeg / 2) * Math.PI) / 180;
  if (ta?.kind === 'block' && facing && !info.unblockable) {
    if (ta.t < ta.parryTicks) {
      tv.mana = Math.min(tv.manaMax, tv.mana + BLOCK.parryMana);
      tc.riposteUntil = ctx.now + BLOCK.riposteWindow;
      addHitstop(target, BLOCK.parryHitstop);
      if (!info.projectile && attacker.combat) {
        const def = attacker.brain ? ENEMIES[attacker.brain.def] : undefined;
        attacker.combat.action = { kind: 'stagger', t: 0, dur: BLOCK.parryStagger };
        if (def?.elite) attacker.combat.poise = Math.max(0, attacker.combat.poise - attacker.combat.poiseMax * 0.35);
        addHitstop(attacker, BLOCK.parryHitstop);
      }
      ctx.events.push({ type: 'parry', attacker: attacker.id, target: target.id, projectile: info.projectile, pos: chest });
      return 'parried';
    }
    const { damage } = computeDamage(attacker, target, info);
    const chip = Math.max(1, Math.round(damage * BLOCK.chip));
    tv.hp -= chip;
    tv.stamina -= info.poise / 2;
    tv.staminaDelay = PLAYER_STATS.staminaDelay;
    const guardBreak = tv.stamina <= 0;
    if (guardBreak) {
      tv.stamina = 0;
      tc.action = { kind: 'stagger', t: 0, dur: BLOCK.guardBreakTicks };
    }
    addHitstop(target, BLOCK_HITSTOP);
    if (!info.projectile) addHitstop(attacker, BLOCK_HITSTOP);
    ctx.events.push({ type: 'block', attacker: attacker.id, target: target.id, damage: chip, guardBreak, pos: chest });
    if (tv.hp <= 0) kill(ctx, target, attacker);
    return 'blocked';
  }

  const ac = attacker.combat;
  const crit = info.crit || (!info.projectile && !!ac?.critNext);
  if (ac && crit && ac.critNext) ac.critNext = false;
  const { damage, affinity } = computeDamage(attacker, target, { ...info, crit });
  tv.hp -= damage;
  const poiseDmg = info.poise * (crit ? 1.5 : 1) * AFFINITY_MULT[affinity];
  tc.poise -= poiseDmg;
  tc.poiseDelay = POISE_REGEN_DELAY;
  if (ac && !info.projectile) {
    ac.lastHitTick = ctx.now;
    if (attacker.vitals) attacker.vitals.mana = Math.min(attacker.vitals.manaMax, attacker.vitals.mana + info.mana);
    addHitstop(attacker, info.hitstop);
  }
  addHitstop(target, info.hitstop);
  ctx.events.push({
    type: 'hit', attacker: attacker.id, target: target.id, move: info.move, damage, kind: info.kind, affinity, crit, heavy: info.heavy, pos: chest, hitstop: info.hitstop,
  });

  if (tv.hp <= 0) {
    kill(ctx, target, attacker);
    return 'hit';
  }

  // Reactions: a poise break staggers anyone; otherwise hitstun unless elite or armored.
  const def = target.brain ? ENEMIES[target.brain.def] : undefined;
  const armored = hasArmor(target);
  let pushed = false;
  // The player has no poise: every normal hit is the plan's fixed 18-tick hitstun.
  if (tc.poise <= 0 && target.kind !== 'player') {
    tc.poise = tc.poiseMax;
    const ticks = def?.staggerTicks ?? 40;
    tc.action = { kind: 'stagger', t: 0, dur: ticks };
    ctx.events.push({ type: 'stagger', entity: target.id, ticks });
    pushed = true;
  } else if (target.kind === 'player' && !armored) {
    tc.action = { kind: 'hitstun', t: 0, dur: PLAYER_STATS.hitstun, knockdown: false };
    tc.buffer = null;
    pushed = true;
  } else if (!def?.elite && !armored) {
    tc.action = { kind: 'hitstun', t: 0, dur: info.hitstun, knockdown: info.knockdown };
    pushed = true;
  }
  if (pushed && info.pushback > 0 && target.body && (!def || !def.dummy)) {
    const dx = target.tf.pos.x - info.from.x, dz = target.tf.pos.z - info.from.z;
    const d = Math.hypot(dx, dz) || 1;
    tc.push = { x: (dx / d) * (info.pushback / PUSH_TICKS), z: (dz / d) * (info.pushback / PUSH_TICKS), ticks: PUSH_TICKS };
  }
  return 'hit';
}

function hasArmor(e: Entity): boolean {
  const a = e.combat?.action;
  if (a?.kind !== 'attack') return false;
  if (e.kind === 'player') {
    const def = PLAYER_MOVES[a.move as PlayerMoveId];
    return def?.hyperArmorFrom !== undefined && a.clipT >= def.hyperArmorFrom;
  }
  const move = enemyMove(e, a.move);
  return !!move?.hyperArmor;
}

export function enemyMove(e: Entity, id: string): EnemyMoveDef | undefined {
  return e.brain ? ENEMIES[e.brain.def].moves.find((m) => m.id === id) : undefined;
}

function kill(ctx: CombatCtx, target: Entity, killer: Entity): void {
  const def = target.brain ? ENEMIES[target.brain.def] : undefined;
  if (def?.dummy) {
    // Training dummies never die: they refill.
    target.vitals!.hp = target.vitals!.hpMax;
    return;
  }
  target.vitals!.hp = 0;
  target.combat!.action = { kind: 'dead', t: 0 };
  target.combat!.buffer = null;
  target.combat!.push = null;
  ctx.events.push({ type: 'death', entity: target.id, killer: killer.id });
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
      if (segmentSegmentDistSq(shape.a, shape.b, b0, b1) > r * r) continue;
      if (!lineOfSight(physics, att, tgt)) continue;
      a.hit.push(tgt.id);
      resolveHit(ctx, att, tgt, shape.info);
    }
  }
}

function lineOfSight(physics: PhysicsWorld, a: Entity, b: Entity): boolean {
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
  info: HitInfo;
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
    const staff = STAFFS.staff_sproto;
    const charged = a.charged;
    return {
      a: toWorld(e.tf.pos, e.tf.yaw, box.a),
      b: toWorld(e.tf.pos, e.tf.yaw, box.b),
      radius: STAFF_CAPSULE_RADIUS,
      info: {
        move: a.move,
        base: staff.damage * (charged ? CHARGED_HEAVY.mv : def.mv),
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
      },
    };
  }
  const move = enemyMove(e, a.move);
  if (!move || move.projectile) return null;
  if (a.t < move.windup || a.t >= move.windup + move.active) return null;
  const centre = toWorld(e.tf.pos, e.tf.yaw, [0, move.hitbox.up, move.hitbox.forward]);
  return {
    a: centre,
    b: centre,
    radius: move.hitbox.radius,
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
      from: { ...e.tf.pos },
      projectile: false,
    },
  };
}
