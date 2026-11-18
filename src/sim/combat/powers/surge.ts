import { POWER } from '../../../content/packs/c3';
import type { Entity } from '../../entity';
import { flatDist } from '../geometry';
import { resolveHit } from '../hits';
import type { CombatCtx } from '../playerCombat';
import type { SpawnSpellProjectile } from '../spells';
import { hostile, powerHit, powersOf } from './common';
import type { WaveArea } from './state';

const S = POWER.surge;

/** Fill the meter (only once Sprout Surge is learned). */
export function addSurge(ctx: CombatCtx, p: Entity, amount: number): void {
  if (!p.progress?.spells.includes('sproutSurge') || amount <= 0) return;
  const pw = powersOf(p);
  const was = pw.surge ?? 0;
  const now = Math.min(S.max, was + amount);
  if (now === was) return;
  pw.surge = now;
  if (now >= S.max) ctx.events.push({ type: 'power', fx: 'surgeReady', entity: p.id, pos: { ...p.tf.pos } });
}

/** Damage dealt and taken this tick feeds the meter. The wave itself doesn't refill it. */
export function surgeFromEvents(ctx: CombatCtx): void {
  for (const ev of ctx.events) {
    if (ev.type === 'hit' && ev.move !== 'sproutSurge') {
      const by = ctx.get(ev.attacker);
      if (by?.kind === 'player') addSurge(ctx, by, ev.damage * S.perDamageDealt);
    }
    if (ev.type === 'hit' || ev.type === 'block') {
      const to = ctx.get(ev.target);
      if (to?.kind === 'player') addSurge(ctx, to, ev.damage * S.perDamageTaken);
    }
  }
}

/** Spend the full meter on a wave spreading from the caster. */
export function releaseSurge(ctx: CombatCtx, p: Entity, damage: number, spawn: SpawnSpellProjectile): void {
  if (p.powers) delete p.powers.surge;
  const at = { ...p.tf.pos };
  spawn({
    kind: 'area',
    tf: { pos: at, prevPos: { ...at }, yaw: p.tf.yaw, prevYaw: p.tf.yaw, vel: { x: 0, y: 0, z: 0 } },
    powerArea: { kind: 'surge', owner: p.id, radius: 0, damage, hit: [] },
    view: { model: 'sproutSurge' },
  });
  ctx.events.push({ type: 'power', fx: 'surge', entity: p.id, pos: { ...at }, radius: S.radius });
}

/** The wave hits each enemy once as it passes. True when it has spent itself. */
export function stepWave(ctx: CombatCtx, w: Entity): boolean {
  const a = w.powerArea as WaveArea;
  a.radius = Math.min(S.radius, a.radius + S.speed);
  const owner = ctx.get(a.owner);
  if (!owner) return true;
  for (const e of ctx.entities) {
    if (!hostile(owner, e) || a.hit.includes(e.id)) continue;
    if (flatDist(w.tf.pos, e.tf.pos) - e.body!.radius > a.radius || Math.abs(e.tf.pos.y - w.tf.pos.y) > 4) continue;
    a.hit.push(e.id);
    resolveHit(ctx, owner, e, powerHit('sproutSurge', a.damage, { ...w.tf.pos }, { pushback: S.pushback, heavy: true }));
  }
  return a.radius >= S.radius;
}
