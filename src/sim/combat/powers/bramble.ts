import { POWER } from '../../../content/packs/c3';
import { protectionMult } from '../../../content/progression';
import type { Entity } from '../../entity';
import type { Vec3 } from '../../math';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { resolveHit } from '../hits';
import type { CombatCtx } from '../playerCombat';
import type { SpawnSpellProjectile } from '../spells';
import { alive, chestOf, hostile, powerHit } from './common';
import type { WallArea } from './state';

const W = POWER.wall;
const PUSH_TICKS = 6;

/** The solid box of a wall entity (SimWorld builds its collider from this, also after a restore). */
export function wallBarrier(e: Readonly<Entity>): { centre: Vec3; half: readonly [number, number, number]; yaw: number } {
  const halfY = (W.height + W.sink) / 2;
  return {
    centre: { x: e.tf.pos.x, y: e.tf.pos.y + W.height - halfY, z: e.tf.pos.z },
    half: [W.length / 2, halfY, W.thickness / 2],
    yaw: e.tf.yaw,
  };
}

/** A point in the wall's frame: `along` its length, `across` its thickness (+ is the caster's far side). */
function local(w: Entity, p: Vec3): { along: number; across: number } {
  const dx = p.x - w.tf.pos.x, dz = p.z - w.tf.pos.z;
  const s = Math.sin(w.tf.yaw), c = Math.cos(w.tf.yaw);
  return { along: dx * c - dz * s, across: dx * s + dz * c };
}

/** Gap between a body and the wall's surface (m); negative when they overlap. */
function gapTo(w: Entity, e: Entity): number {
  const l = local(w, e.tf.pos);
  const ex = Math.max(0, Math.abs(l.along) - W.length / 2), ez = Math.max(0, Math.abs(l.across) - W.thickness / 2);
  return Math.hypot(ex, ez) - e.body!.radius;
}

/** Grow the wall ahead of the caster, set down on the ground and short of any cliff in the way. */
export function growWall(ctx: CombatCtx, p: Entity, power: number, physics: PhysicsWorld, spawn: SpawnSpellProjectile): void {
  const k = protectionMult(p.progress?.skills);
  const yaw = p.tf.yaw;
  const dir = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  const block = physics.raycast({ x: p.tf.pos.x, y: p.tf.pos.y + 1.2, z: p.tf.pos.z }, dir, W.distance + 0.6);
  const dist = block ? Math.max(W.minDistance, block.distance - 0.6) : W.distance;
  const at = { x: p.tf.pos.x + dir.x * dist, y: p.tf.pos.y, z: p.tf.pos.z + dir.z * dist };
  const ground = physics.raycast({ x: at.x, y: at.y + 3, z: at.z }, { x: 0, y: -1, z: 0 }, 7);
  if (ground) at.y = ground.point.y;
  const wall = spawn({
    kind: 'area',
    tf: { pos: at, prevPos: { ...at }, yaw, prevYaw: yaw, vel: { x: 0, y: 0, z: 0 } },
    powerArea: { kind: 'wall', owner: p.id, age: 0, life: Math.round(W.ticks * k), pulse: W.pulseTicks, thorns: power * k },
    view: { model: 'brambleWall' },
  });
  // The character controller ignores a surface it starts inside: shove anyone caught in the wall out.
  for (const e of ctx.entities) {
    if (!hostile(p, e) || gapTo(wall, e) >= 0) continue;
    const across = local(wall, e.tf.pos).across;
    const side = across >= 0 ? 1 : -1;
    const need = W.thickness / 2 + e.body!.radius + W.touch - Math.abs(across);
    e.combat!.push = { x: (dir.x * side * need) / PUSH_TICKS, z: (dir.z * side * need) / PUSH_TICKS, ticks: PUSH_TICKS };
  }
  ctx.events.push({ type: 'power', fx: 'wall', entity: p.id, pos: { ...at } });
}

/** Attacking and moving at charge speed toward the wall (a Grunt's leap, a boss's rush). */
function charging(ctx: CombatCtx, w: Entity, e: Entity): boolean {
  if (e.combat?.action?.kind !== 'attack') return false;
  const m = ctx.motion.get(e.id);
  if (!m || Math.hypot(m.vx, m.vz) < W.chargeSpeed) return false;
  const side = local(w, e.tf.pos).across >= 0 ? 1 : -1;
  return (m.vx * Math.sin(w.tf.yaw) + m.vz * Math.cos(w.tf.yaw)) * side < 0;
}

/** Thorns bite whoever touches the wall; a charge into it stuns the charger. True when it withers. */
export function stepWall(ctx: CombatCtx, w: Entity): boolean {
  const a = w.powerArea as WallArea;
  if (++a.age >= a.life) {
    ctx.events.push({ type: 'power', fx: 'wallEnd', entity: a.owner, pos: { ...w.tf.pos } });
    return true;
  }
  const owner = ctx.get(a.owner);
  if (!owner) return true;
  const pulse = --a.pulse <= 0;
  if (pulse) a.pulse = W.pulseTicks;
  const from = { ...w.tf.pos };
  for (const e of ctx.entities) {
    if (!hostile(owner, e) || Math.abs(e.tf.pos.y - w.tf.pos.y) > W.height + 0.5 || gapTo(w, e) > W.touch) continue;
    if (charging(ctx, w, e)) {
      resolveHit(ctx, owner, e, powerHit('brambleWall', a.thorns * W.impactPulses, from, { heavy: true }));
      if (!alive(e)) continue;
      e.combat!.action = { kind: 'stagger', t: 0, dur: W.stunTicks };
      ctx.events.push({ type: 'stagger', entity: e.id, ticks: W.stunTicks });
      ctx.events.push({ type: 'power', fx: 'wallStun', entity: e.id, pos: chestOf(e) });
    } else if (pulse) resolveHit(ctx, owner, e, powerHit('brambleWall', a.thorns, from, { hitstun: 10, pushback: 0.5 }));
  }
  return false;
}
