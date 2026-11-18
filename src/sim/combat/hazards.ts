import { STATUS } from '../../content/statuses';
import type { Entity } from '../entity';
import { flatDist } from './geometry';
import { resolveHit } from './hits';
import { iframes, type CombatCtx } from './playerCombat';
import { applyStatus } from './statuses';

/** Standing in fire tops the Burn back up once it has burned down to this many ticks. */
const BURN_REFRESH_BELOW = STATUS.burn.ticks - 30;

const inReach = (p: Entity, at: Entity, radius: number) =>
  flatDist(p.tf.pos, at.tf.pos) <= radius + (p.body?.radius ?? 0.35) && Math.abs(p.tf.pos.y - at.tf.pos.y) < 4;

/**
 * Boss hazards on the ground (plan §4.10): a falling rock lands when its fuse runs out and hits once
 * (roll through it, it can't be blocked); a Burn patch keeps whoever stands in it burning. Both go
 * when their life runs out or their boss is gone. Returns the ids to remove.
 */
export function stepHazards(ctx: CombatCtx): number[] {
  const gone: number[] = [];
  for (const e of ctx.entities) {
    const h = e.hazard;
    if (!h) continue;
    const owner = ctx.get(h.owner);
    if (!owner || owner.combat?.action?.kind === 'dead' || --h.life <= 0) {
      gone.push(e.id);
      continue;
    }
    if (h.kind === 'rock') {
      if (h.fuse <= 0) continue;
      if (--h.fuse === 0) land(ctx, e, owner);
      continue;
    }
    for (const p of ctx.entities) {
      if (p.kind !== 'player' || p.combat?.action?.kind === 'dead' || !inReach(p, e, h.radius)) continue;
      if (iframes(p.combat?.action ?? null)) continue;
      const burn = p.statuses?.burn;
      if (!burn || burn.ticks < BURN_REFRESH_BELOW) applyStatus(ctx, p, 'burn', 1, owner.id);
    }
  }
  return gone;
}

function land(ctx: CombatCtx, rock: Entity, owner: Entity): void {
  const h = rock.hazard!;
  ctx.events.push({ type: 'rockLand', pos: { ...rock.tf.pos }, radius: h.radius });
  for (const p of ctx.entities) {
    if (p.kind !== 'player' || p.combat?.action?.kind === 'dead' || !inReach(p, rock, h.radius)) continue;
    resolveHit(ctx, owner, p, {
      move: 'falling_rock', base: h.damage, kind: 'physical', poise: 20, hitstun: 18, knockdown: false, pushback: 1, hitstop: 5,
      unblockable: true, heavy: true, crit: false, mana: 0, from: { ...rock.tf.pos }, projectile: true,
    });
  }
}
