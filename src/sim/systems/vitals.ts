import { PLAYER_STATS } from '../../content/combat';
import { DT } from '../../content/tuning';
import type { Entity } from '../entity';

/**
 * Stamina and mana regeneration, sprint drain, poise refill (plan §4.5). Entities frozen in
 * hit-stop don't regenerate that tick.
 */
export function vitals(entities: readonly Entity[], frozen: ReadonlySet<number>): void {
  for (const e of entities) {
    const v = e.vitals;
    const c = e.combat;
    if (!v || frozen.has(e.id) || c?.action?.kind === 'dead') continue;
    if (e.loco?.sprinting) {
      v.stamina = Math.max(0, v.stamina - PLAYER_STATS.sprintCost * DT);
      v.staminaDelay = PLAYER_STATS.staminaDelay;
    } else if (v.staminaDelay > 0) v.staminaDelay--;
    else if (c?.action?.kind !== 'block') v.stamina = Math.min(v.staminaMax, v.stamina + PLAYER_STATS.staminaRegen * DT);
    v.mana = Math.min(v.manaMax, v.mana + PLAYER_STATS.manaRegen * DT);
    if (c) {
      if (c.poiseDelay > 0) c.poiseDelay--;
      else c.poise = c.poiseMax;
    }
  }
}
