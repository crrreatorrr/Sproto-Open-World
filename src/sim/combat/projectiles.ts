import { BLOCK } from '../../content/combat';
import { DT } from '../../content/tuning';
import type { Entity } from '../entity';
import type { Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { bodySegment, segmentSegmentDistSq } from './geometry';
import { resolveHit } from './hits';
import type { CombatCtx } from './playerCombat';

/**
 * Projectiles fly straight (no gravity), stop on world geometry, and hit bodies of the other team.
 * A parried projectile is reflected back at its shooter, 1.5× faster and harder, keeping its damage
 * kind (plan §4.3, §4.6). Returns the ids to remove.
 */
export function stepProjectiles(ctx: CombatCtx, physics: PhysicsWorld): number[] {
  const dead: number[] = [];
  for (const e of ctx.entities) {
    const pr = e.projectile;
    if (!pr) continue;
    const from = { ...e.tf.pos };
    const to = { x: from.x + e.tf.vel.x * DT, y: from.y + e.tf.vel.y * DT, z: from.z + e.tf.vel.z * DT };
    const seg = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const segLen = Math.hypot(seg.x, seg.y, seg.z);
    const wall = segLen > 1e-6 ? physics.raycast(from, seg, segLen + pr.radius) : null;

    let consumed = false;
    let reflected = false;
    for (const tgt of ctx.entities) {
      if (!tgt.combat || !tgt.body || tgt.combat.team === pr.team || tgt.combat.action?.kind === 'dead') continue;
      const [b0, b1] = bodySegment(tgt.tf.pos, tgt.body.radius, tgt.body.height);
      const r = pr.radius + tgt.body.radius;
      if (segmentSegmentDistSq(from, to, b0, b1) > r * r) continue;
      const owner = ctx.get(pr.owner) ?? e;
      const out = resolveHit(ctx, owner, tgt, {
        move: 'projectile', base: pr.damage, kind: pr.kind, poise: pr.poise, hitstun: 18, knockdown: false, pushback: 0.4,
        hitstop: 3, unblockable: false, heavy: false, crit: false, mana: 0, from, projectile: true,
      });
      if (out === 'dodged') continue; // flies on through the roll
      if (out === 'parried') {
        reflect(e, tgt, ctx);
        reflected = true;
        break;
      }
      consumed = true;
      break;
    }

    if (reflected) continue; // turned round at the parry: it starts its way back next tick
    if (!consumed && wall && wall.distance <= segLen) consumed = true;
    if (consumed) {
      dead.push(e.id);
      continue;
    }
    e.tf.pos = to;
    if (--pr.life <= 0) dead.push(e.id);
  }
  return dead;
}

function reflect(e: Entity, parrier: Entity, ctx: CombatCtx): void {
  const pr = e.projectile!;
  const shooter = ctx.get(pr.owner);
  const speed = Math.hypot(e.tf.vel.x, e.tf.vel.y, e.tf.vel.z) * BLOCK.reflect;
  const aim: Vec3 = shooter?.body
    ? { x: shooter.tf.pos.x, y: shooter.tf.pos.y + shooter.body.height * 0.55, z: shooter.tf.pos.z }
    : { x: e.tf.pos.x - e.tf.vel.x, y: e.tf.pos.y, z: e.tf.pos.z - e.tf.vel.z };
  const d = { x: aim.x - e.tf.pos.x, y: aim.y - e.tf.pos.y, z: aim.z - e.tf.pos.z };
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  e.tf.vel = { x: (d.x / len) * speed, y: (d.y / len) * speed, z: (d.z / len) * speed };
  pr.team = parrier.combat!.team;
  pr.owner = parrier.id;
  pr.damage *= BLOCK.reflect;
  pr.reflected = true;
  pr.life = Math.max(pr.life, Math.ceil(len / (speed * DT)) + 30);
}
