import { AFFINITY_MULT, ENEMIES, type Affinity } from '../../content/enemies';
import { STATUS, type StatusId } from '../../content/statuses';
import type { Entity, EntityId } from '../entity';
import type { CombatCtx } from './playerCombat';

/** A target's affinity for a status (players have none: normal). */
export function statusAffinity(e: Entity, id: StatusId): Affinity {
  return e.brain ? ENEMIES[e.brain.def].profile.status[id] : 'normal';
}

/**
 * Apply a status (plan §4.7): weak ×1.5 duration and potency, resist ×0.5, never immune. Chill
 * stacks; a chill-weak target takes one extra stack (Frost Nova's 3 instead of 2); three stacks
 * freeze it. Shock interrupts a wind-up that is less than half done.
 */
export function applyStatus(ctx: CombatCtx, target: Entity, id: StatusId, stacks: number, source: EntityId): void {
  const c = target.combat;
  const v = target.vitals;
  if (!c || !v || c.action?.kind === 'dead') return;
  const affinity = statusAffinity(target, id);
  const k = AFFINITY_MULT[affinity];
  const st = (target.statuses ??= {});
  switch (id) {
    case 'burn':
      st.burn = { ticks: Math.round(STATUS.burn.ticks * k), perTick: (STATUS.burn.dps * v.hpMax * k) / 60, source };
      break;
    case 'chill': {
      const add = stacks + (affinity === 'weak' ? 1 : 0);
      const now = Math.min(STATUS.chill.maxStacks, (st.chill?.stacks ?? 0) + add);
      st.chill = { ticks: Math.round(STATUS.chill.ticks * k), stacks: now };
      if (now >= STATUS.chill.maxStacks && target.kind !== 'player') {
        const ticks = Math.round(STATUS.chill.frozenTicks * k);
        c.action = { kind: 'frozen', t: 0, dur: ticks };
        c.buffer = null;
        delete st.chill;
        st.slowAcc = 0;
        ctx.events.push({ type: 'frozen', entity: target.id, ticks });
        return;
      }
      break;
    }
    case 'shock': {
      st.shock = { ticks: Math.round(STATUS.shock.ticks * k) };
      const a = c.action;
      const move = a?.kind === 'attack' && target.brain ? ENEMIES[target.brain.def].moves.find((m) => m.id === a.move) : undefined;
      if (a?.kind === 'attack' && move && a.t < move.windup * STATUS.shock.interruptBefore && !move.hyperArmor) {
        c.action = { kind: 'hitstun', t: 0, dur: 20, knockdown: false };
        ctx.events.push({ type: 'interrupt', entity: target.id, by: source });
      }
      break;
    }
  }
  ctx.events.push({ type: 'status', entity: target.id, status: id, stacks: id === 'chill' ? (st.chill?.stacks ?? 0) : 1, affinity });
}

/** Burn damage, durations, and the end of each status. Returns entities burned to death. */
export function tickStatuses(ctx: CombatCtx): { entity: Entity; source: EntityId }[] {
  const killed: { entity: Entity; source: EntityId }[] = [];
  for (const e of ctx.entities) {
    const st = e.statuses;
    if (!st || ctx.frozen.has(e.id)) continue;
    if (e.combat?.action?.kind === 'dead') {
      delete e.statuses;
      continue;
    }
    if (st.burn) {
      const v = e.vitals!;
      v.hp -= st.burn.perTick;
      if (v.hp <= 0) killed.push({ entity: e, source: st.burn.source });
      if (--st.burn.ticks <= 0) {
        delete st.burn;
        ctx.events.push({ type: 'statusEnd', entity: e.id, status: 'burn' });
      }
    }
    if (st.chill && --st.chill.ticks <= 0) {
      delete st.chill;
      ctx.events.push({ type: 'statusEnd', entity: e.id, status: 'chill' });
    }
    if (st.shock && --st.shock.ticks <= 0) {
      delete st.shock;
      ctx.events.push({ type: 'statusEnd', entity: e.id, status: 'shock' });
    }
  }
  return killed;
}

/** Chill's slow factor: −30% per stack, ×1.5 on a chill-weak target, ×0.5 on a resistant one (§4.6). */
function chillSpeed(e: Entity): number {
  const stacks = e.statuses?.chill?.stacks ?? 0;
  if (!stacks) return 1;
  return Math.max(0.1, 1 - STATUS.chill.slowPerStack * stacks * AFFINITY_MULT[statusAffinity(e, 'chill')]);
}

/** Chill's slow: whether this entity's action clock advances this tick. */
export function clockTicks(e: Entity): boolean {
  const speed = chillSpeed(e);
  if (speed >= 1) return true;
  const st = e.statuses!;
  st.slowAcc = (st.slowAcc ?? 0) + speed;
  if (st.slowAcc >= 1) {
    st.slowAcc -= 1;
    return true;
  }
  return false;
}

/** Movement speed multiplier from chill. */
export function moveScale(e: Entity): number {
  return chillSpeed(e);
}

/** How fast poise's refill delay counts down: shock halves it, ×1.5 / ×0.5 by affinity (§4.6). */
export function poiseRegenRate(e: Entity): number {
  if (!e.statuses?.shock) return 1;
  return Math.max(0.1, 1 - STATUS.shock.poiseRegenPenalty * AFFINITY_MULT[statusAffinity(e, 'shock')]);
}
