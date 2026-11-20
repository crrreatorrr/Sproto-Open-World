import { PLAYER_STATS, STAFFS } from '../../content/combat';
import { PLUNGE } from '../../content/packs/m7';
import { SKILL_EFFECT } from '../../content/progression';
import { DT, MOVE } from '../../content/tuning';
import { plungeRecoveryOf } from '../systems/relics';
import { staffOf } from '../systems/rpg';
import type { Action, Entity } from '../entity';
import { turnToward } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { flatDist } from './geometry';
import { resolveHit, type HitInfo } from './hits';
import type { CombatCtx, Motion } from './playerCombat';

type PlungeAction = Extract<Action, { kind: 'plunge' }>;

/**
 * The plunge attack (M7): a heavy pressed while falling from a height dives at the ground and slams
 * everything around the landing, harder the further it fell. It ends in a recovery a dodge or an
 * attack can cut short. Called from playerCombat. Pure.
 */

/** Start a plunge if the player is high enough in the air. False: the press is an ordinary heavy. */
export function tryPlunge(ctx: CombatCtx, p: Entity, physics: PhysicsWorld): boolean {
  const c = p.combat!;
  const v = p.vitals!;
  if (!p.loco || p.loco.grounded || p.tf.vel.y > PLUNGE.maxRise) return false;
  const feet = { x: p.tf.pos.x, y: p.tf.pos.y + 0.1, z: p.tf.pos.z };
  if (physics.raycast(feet, { x: 0, y: -1, z: 0 }, PLUNGE.minHeight + 0.1)) return false;
  if (v.stamina <= 0) {
    ctx.events.push({ type: 'noStamina', entity: p.id });
    return true;
  }
  v.stamina = Math.max(0, v.stamina - PLUNGE.stamina);
  v.staminaDelay = PLAYER_STATS.staminaDelay;
  p.tf.vel.y = Math.min(p.tf.vel.y, -PLUNGE.diveSpeed);
  c.action = { kind: 'plunge', t: 0, fromY: p.tf.pos.y, landT: -1 };
  ctx.events.push({ type: 'swing', entity: p.id, move: 'plunge', heavy: true });
  return true;
}

/** One tick of a plunge: wait for the ground, slam once on touching it, then recover. */
export function advancePlunge(ctx: CombatCtx, p: Entity, physics: PhysicsWorld): void {
  const c = p.combat!;
  const a = c.action as PlungeAction;
  a.t++;
  if (a.landT < 0) {
    if (!p.loco?.grounded) return;
    a.landT = 0;
    slam(ctx, p, a, physics);
    return;
  }
  a.landT++;
  if (a.landT >= plungeRecoveryOf(p)) c.action = null;
}

/** The recovery can be cut short from here on. */
export const plungeCancels = (a: PlungeAction): boolean => a.landT >= PLUNGE.cancelFrom;

/** Steer the dive with the stick (facing the lock, if any); stand still while recovering. */
export function plungeMotion(p: Entity, a: PlungeAction, wish: { x: number; z: number; mag: number }, faceLock: number | undefined): Motion {
  if (a.landT >= 0) return { vx: 0, vz: 0, inputScale: 0 };
  const face = faceLock ?? (wish.mag > 0.2 ? Math.atan2(wish.x, wish.z) : p.tf.yaw);
  p.tf.yaw = turnToward(p.tf.yaw, face, MOVE.turnRate * DT);
  return { vx: wish.x * PLUNGE.drift, vz: wish.z * PLUNGE.drift, inputScale: 0 };
}

function slam(ctx: CombatCtx, p: Entity, a: PlungeAction, physics: PhysicsWorld): void {
  const fell = Math.max(0, a.fromY - p.tf.pos.y);
  const staff = p.progress ? staffOf(p.progress) : STAFFS.staff_sproto;
  const power = staff.damage * (1 + SKILL_EFFECT.attack * (p.progress?.skills.attack ?? 0));
  const info: HitInfo = {
    move: 'plunge',
    base: power * Math.min(PLUNGE.mvMax, PLUNGE.mv + PLUNGE.mvPerMetre * fell),
    kind: 'physical',
    poise: PLUNGE.poise,
    hitstun: PLUNGE.hitstun,
    knockdown: true,
    pushback: PLUNGE.pushback,
    hitstop: PLUNGE.hitstop,
    unblockable: false,
    heavy: true,
    crit: false,
    mana: PLUNGE.mana,
    from: { ...p.tf.pos },
    projectile: false,
  };
  let hits = 0;
  for (const t of ctx.entities) {
    if (t === p || !t.combat || !t.body || !t.vitals || t.combat.team === p.combat!.team || t.combat.action?.kind === 'dead') continue;
    const dy = t.tf.pos.y - p.tf.pos.y;
    if (dy > PLUNGE.above || dy < -PLUNGE.below) continue;
    if (flatDist(p.tf.pos, t.tf.pos) - t.body.radius > PLUNGE.radius || !clearPath(physics, p, t)) continue;
    resolveHit(ctx, p, t, info);
    hits++;
  }
  ctx.events.push({ type: 'plunge', entity: p.id, pos: { ...p.tf.pos }, radius: PLUNGE.radius, hits });
}

/** No wall between the landing and the target's chest. */
function clearPath(physics: PhysicsWorld, p: Entity, t: Entity): boolean {
  const from = { x: p.tf.pos.x, y: p.tf.pos.y + 1, z: p.tf.pos.z };
  const dir = { x: t.tf.pos.x - from.x, y: t.tf.pos.y + (t.body?.height ?? 1.8) * 0.5 - from.y, z: t.tf.pos.z - from.z };
  const dist = Math.hypot(dir.x, dir.y, dir.z);
  if (dist < 0.3) return true;
  const hit = physics.raycast(from, dir, dist);
  return !hit || hit.distance >= dist - 0.3;
}
