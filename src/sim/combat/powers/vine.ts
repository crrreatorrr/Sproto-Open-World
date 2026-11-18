import { ENEMIES } from '../../../content/enemies';
import { POWER } from '../../../content/packs/c3';
import { idleInput } from '../../commands';
import type { Entity } from '../../entity';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { flatDist, toWorld } from '../geometry';
import { resolveHit } from '../hits';
import type { CombatCtx } from '../playerCombat';
import { spellTarget } from '../spells';
import { alive, chestOf, clearLine, powerHit } from './common';

const V = POWER.vine;

/** Who the vine goes for: the lock, else the best enemy ahead. */
export const vineTarget = (ctx: CombatCtx, p: Entity): Entity | null => spellTarget(ctx, p, idleInput(p.tf.yaw), V.range);

/** Elites, dummies and wide bodies stay put: the vine pulls you to them. */
function heavy(e: Entity): boolean {
  const def = e.brain ? ENEMIES[e.brain.def] : undefined;
  return !!def?.elite || !!def?.dummy || (e.body?.radius ?? 0) >= V.heavyRadius;
}

/** Lash the target and reel it in, or reel yourself in to a heavy one. Terrain in the way stops the vine. */
export function throwVine(ctx: CombatCtx, p: Entity, power: number, physics: PhysicsWorld): void {
  const hand = toWorld(p.tf.pos, p.tf.yaw, [0, 1.35, 0.6]);
  const t = vineTarget(ctx, p);
  if (!t || !clearLine(physics, hand, chestOf(t))) {
    ctx.events.push({ type: 'power', fx: 'vine', entity: p.id, pos: hand, to: toWorld(p.tf.pos, p.tf.yaw, [0, 1.35, V.range / 2]) });
    return;
  }
  ctx.events.push({ type: 'power', fx: 'vine', entity: p.id, pos: hand, to: chestOf(t), target: t.id });
  const out = resolveHit(ctx, p, t, powerHit('vinePull', power, hand));
  const d = flatDist(p.tf.pos, t.tf.pos);
  const gap = d - (t.body?.radius ?? 0) - (p.body?.radius ?? 0) - V.stopGap;
  if (gap <= 0 || !alive(t)) return;
  const ticks = Math.max(4, Math.ceil(gap / V.speed));
  const x = ((t.tf.pos.x - p.tf.pos.x) / d) * (gap / ticks), z = ((t.tf.pos.z - p.tf.pos.z) / d) * (gap / ticks);
  if (heavy(t)) p.combat!.push = { x, z, ticks };
  else if (out === 'hit') {
    t.combat!.push = { x: -x, z: -z, ticks };
    t.combat!.action = { kind: 'hitstun', t: 0, dur: ticks + 10, knockdown: false };
  }
}
