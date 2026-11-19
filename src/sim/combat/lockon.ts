import { LOCK } from '../../content/combat';
import { BTN, idleInput, type CommandMap } from '../commands';
import type { Entity } from '../entity';
import { wrapAngle } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { flatDist, yawTo } from './geometry';
import type { CombatCtx } from './playerCombat';

const DEG = Math.PI / 180;

function chest(e: Entity) {
  return { x: e.tf.pos.x, y: e.tf.pos.y + (e.body?.height ?? 1.8) * 0.55, z: e.tf.pos.z };
}

function visible(physics: PhysicsWorld, from: Entity, to: Entity): boolean {
  const a = chest(from), b = chest(to);
  const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const dist = Math.hypot(dir.x, dir.y, dir.z);
  if (dist < 0.5) return true;
  const hit = physics.raycast(a, dir, dist);
  return !hit || hit.distance >= dist - 0.4;
}

const lockable = (p: Entity, e: Entity) =>
  !!e.combat && !!e.body && e.combat.team !== p.combat!.team && e.combat.action?.kind !== 'dead' && !e.projectile && !e.boss?.under && !e.brain?.held;

/**
 * Hard lock (plan §4.1): acquire the best enemy in a 70° cone of the camera within 20 m with line
 * of sight (lowest angle° + 0.5·distance); switch left or right; break beyond 28 m, after 1 s out
 * of sight, or on death (passing to the nearest enemy within 10 m).
 */
export function lockOn(ctx: CombatCtx, commands: CommandMap, physics: PhysicsWorld): void {
  for (const p of ctx.entities) {
    const c = p.combat;
    if (!c || p.kind !== 'player' || p.owner === undefined) continue;
    const cmd = commands.get(p.owner) ?? idleInput(p.tf.yaw);
    const before = c.lock;

    if (c.action?.kind === 'dead') c.lock = null;
    else if (cmd.pressed & BTN.lock) {
      c.lock = c.lock !== null ? null : acquire(ctx, physics, p, cmd.camYaw);
    } else if (c.lock !== null && cmd.lockSwitch !== 0) {
      c.lock = switchTarget(ctx, physics, p, c.lock, cmd.lockSwitch) ?? c.lock;
    }

    if (c.lock !== null) {
      const t = ctx.get(c.lock);
      if (!t || !lockable(p, t)) {
        c.lock = nearest(ctx, physics, p, LOCK.passRange);
      } else if (flatDist(p.tf.pos, t.tf.pos) > LOCK.breakRange) {
        c.lock = null;
      } else if (!visible(physics, p, t)) {
        if (++c.lockLostTicks > LOCK.losGraceTicks) c.lock = null;
      } else c.lockLostTicks = 0;
    }
    if (c.lock !== before) {
      c.lockLostTicks = 0;
      ctx.events.push({ type: 'lock', entity: p.id, target: c.lock });
    }
  }
}

function acquire(ctx: CombatCtx, physics: PhysicsWorld, p: Entity, camYaw: number): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  for (const e of ctx.entities) {
    if (!lockable(p, e)) continue;
    const d = flatDist(p.tf.pos, e.tf.pos);
    if (d > LOCK.acquireRange) continue;
    const ang = Math.abs(wrapAngle(yawTo(p.tf.pos, e.tf.pos) - camYaw)) / DEG;
    if (ang > LOCK.coneDeg / 2) continue;
    if (!visible(physics, p, e)) continue;
    const score = ang + 0.5 * d;
    if (score < bestScore) {
      bestScore = score;
      best = e.id;
    }
  }
  return best;
}

/** The nearest enemy on the given side (+1 right, -1 left) of the current target, as seen from the player. */
function switchTarget(ctx: CombatCtx, physics: PhysicsWorld, p: Entity, current: number, dir: number): number | null {
  const cur = ctx.get(current);
  if (!cur) return null;
  const base = yawTo(p.tf.pos, cur.tf.pos);
  let best: number | null = null;
  let bestAng = Infinity;
  for (const e of ctx.entities) {
    if (e.id === current || !lockable(p, e)) continue;
    if (flatDist(p.tf.pos, e.tf.pos) > LOCK.acquireRange || !visible(physics, p, e)) continue;
    // Yaw grows to the left (counter-clockwise from above), so "right" is a negative difference.
    const rel = wrapAngle(yawTo(p.tf.pos, e.tf.pos) - base);
    const side = rel < 0 ? 1 : -1;
    if (side !== Math.sign(dir)) continue;
    if (Math.abs(rel) < bestAng) {
      bestAng = Math.abs(rel);
      best = e.id;
    }
  }
  return best;
}

function nearest(ctx: CombatCtx, physics: PhysicsWorld, p: Entity, range: number): number | null {
  let best: number | null = null;
  let bestD = range;
  for (const e of ctx.entities) {
    if (!lockable(p, e)) continue;
    const d = flatDist(p.tf.pos, e.tf.pos);
    if (d <= bestD && visible(physics, p, e)) {
      bestD = d;
      best = e.id;
    }
  }
  return best;
}
