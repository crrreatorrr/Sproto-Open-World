import { POWER } from '../../../content/packs/c3';
import type { Entity, EntityId } from '../../entity';
import type { CombatCtx } from '../playerCombat';
import { alive, chestOf, isBoss, powersOf } from './common';

const S = POWER.snare;

/** Static Snare landed: the target stops where it stands, cutting off whatever it was winding up. */
export function snareHit(ctx: CombatCtx, target: Entity, source: EntityId): void {
  const c = target.combat;
  if (!c || !alive(target)) return;
  const ticks = isBoss(target) ? S.bossRootTicks : S.rootTicks;
  powersOf(target).rooted = ticks;
  if (c.action?.kind === 'attack') ctx.events.push({ type: 'interrupt', entity: target.id, by: source });
  if (c.action?.kind !== 'frozen') c.action = { kind: 'stagger', t: 0, dur: ticks };
  ctx.events.push({ type: 'power', fx: 'snareRoot', entity: target.id, pos: chestOf(target) });
}

/** Count the root down. A hit's hitstun may replace the stagger: when it ends, the root still holds. */
export function stepRoot(e: Entity): void {
  const pw = e.powers;
  const c = e.combat;
  if (!pw || pw.rooted === undefined || !c) return;
  pw.rooted--;
  if (pw.rooted <= 0 || !alive(e)) {
    delete pw.rooted;
    return;
  }
  if (!c.action || c.action.kind === 'attack') c.action = { kind: 'stagger', t: 0, dur: pw.rooted };
}

/** Damage multiplier on a rooted target. */
export const rootedMult = (target: Entity): number => (target.powers?.rooted ? S.damageTaken : 1);
