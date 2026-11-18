import { POWER } from '../../../content/packs/c3';
import { protectionMult } from '../../../content/progression';
import type { Entity } from '../../entity';
import type { Vec3 } from '../../math';
import { segmentSegmentDistSq } from '../geometry';
import type { CombatCtx } from '../playerCombat';
import { reflect } from '../projectiles';
import { alive, powersOf } from './common';
import { addSurge } from './surge';

const W = POWER.ward;

/** Raise the bubble. Protection makes it last longer, widens its reflect window and makes reflections hit harder. */
export function raiseWard(ctx: CombatCtx, p: Entity): void {
  powersOf(p).ward = { t: 0, dur: Math.round(W.ticks * protectionMult(p.progress?.skills)) };
  ctx.events.push({ type: 'power', fx: 'ward', entity: p.id, pos: { ...p.tf.pos } });
}

/**
 * A projectile reaching a bubble this tick: reflected back at its shooter during the bubble's first
 * ticks (a perfect ward, which also feeds the Surge meter), stopped after that.
 */
export function wardProjectile(ctx: CombatCtx, e: Entity, from: Vec3, to: Vec3): 'reflected' | 'blocked' | null {
  const pr = e.projectile!;
  for (const w of ctx.entities) {
    const ward = w.powers?.ward;
    if (!ward || !w.combat || w.combat.team === pr.team || !alive(w)) continue;
    const centre = { x: w.tf.pos.x, y: w.tf.pos.y + (w.body?.height ?? 1.8) / 2, z: w.tf.pos.z };
    const r = W.radius + pr.radius;
    if (segmentSegmentDistSq(from, to, centre, centre) > r * r) continue;
    if (ward.t >= Math.round(W.reflectTicks * protectionMult(w.progress?.skills))) {
      ctx.events.push({ type: 'power', fx: 'wardBlock', entity: w.id, pos: { ...from } });
      return 'blocked';
    }
    reflect(e, w, ctx);
    pr.damage *= protectionMult(w.progress?.skills);
    addSurge(ctx, w, POWER.surge.perfectWard);
    ctx.events.push({ type: 'power', fx: 'wardReflect', entity: w.id, pos: { ...from } });
    return 'reflected';
  }
  return null;
}
