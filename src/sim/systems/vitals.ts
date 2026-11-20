import { PLAYER_STATS } from '../../content/combat';
import { SKILL_EFFECT } from '../../content/progression';
import { DT } from '../../content/tuning';
import { poiseRegenRate } from '../combat/statuses';
import type { Entity } from '../entity';
import { lengthenBuffer, sprintDrain, tickTotems } from './relics';

/**
 * Stamina and mana regeneration, sprint drain, poise refill (plan §4.5). Entities frozen in
 * hit-stop don't regenerate that tick.
 */
export function vitals(entities: readonly Entity[], frozen: ReadonlySet<number>, now = 0): void {
  tickTotems(entities, now);
  for (const e of entities) {
    const v = e.vitals;
    const c = e.combat;
    if (!v || frozen.has(e.id) || c?.action?.kind === 'dead') continue;
    // On the bull, the bull does the running.
    if (e.progress) lengthenBuffer(e, now);
    if (e.loco?.sprinting && !e.riding) {
      v.stamina = Math.max(0, v.stamina - (e.progress ? sprintDrain(e) : PLAYER_STATS.sprintCost) * DT);
      v.staminaDelay = PLAYER_STATS.staminaDelay;
    } else if (v.staminaDelay > 0) v.staminaDelay--;
    else if (c?.action?.kind !== 'block') v.stamina = Math.min(v.staminaMax, v.stamina + PLAYER_STATS.staminaRegen * DT);
    // Focus: +3% mana regen per rank.
    v.mana = Math.min(v.manaMax, v.mana + PLAYER_STATS.manaRegen * DT * (1 + SKILL_EFFECT.focusRegen * (e.progress?.skills.focus ?? 0)));
    if (c) {
      // Shock slows poise regen: the refill delay counts down at a reduced rate.
      if (c.poiseDelay > 0) c.poiseDelay = Math.max(0, c.poiseDelay - poiseRegenRate(e));
      else c.poise = c.poiseMax;
    }
  }
}
