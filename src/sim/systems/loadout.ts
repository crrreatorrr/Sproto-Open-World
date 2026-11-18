import { ENEMIES } from '../../content/enemies';
import {
  GEAR_LOCK_TICKS, PERK_IDS, PERKS, RESPEC_SPROUTS_PER_LEVEL, SKILL_IDS, SKILL_MAX_RANK, hasPerk, noSkills, ranksSpent, type SkillId,
} from '../../content/progression';
import { LOADOUT_SLOTS, SPELLS, SPELL_BY_SLOT, SWAP_MIN_COOLDOWN, type SpellId } from '../../content/spells';
import type { Entity, Progress } from '../entity';
import type { SimEvent } from '../events';
import { recompute } from './rpg';

/**
 * The loadout and the skill tree (expansion plan §1.1, §1.4, §7): the rules for swapping spells,
 * the gear lock, spending and refunding skill points. Every rule is checked here, in the sim, so it
 * holds while the app is paused (its intents ride a tick) and in co-op. Pure.
 */

interface Ctx {
  now: number;
  events: SimEvent[];
}

const refuse = (ctx: Ctx, e: Entity, action: string, reason: string): void => {
  ctx.events.push({ type: 'refused', entity: e.id, action, reason });
};

// ---------------------------------------------------------------- the loadout

/** The spell in loadout slot `slot` (0–3). An entity without progress casts every spell from its home slot. */
export function slotSpell(e: Entity, slot: number): SpellId | null {
  if (!e.progress) return SPELL_BY_SLOT[(slot + 1) as 1 | 2 | 3 | 4] ?? null;
  return e.progress.loadout[slot] ?? null;
}

/** A newly learned spell goes to its home slot if that's free, else the first free slot, else nowhere. */
export function learnIntoLoadout(p: Progress, spell: SpellId): void {
  if (p.loadout.includes(spell)) return;
  const home = SPELLS[spell].slot - 1;
  const at = p.loadout[home] === null ? home : p.loadout.indexOf(null);
  if (at >= 0) p.loadout[at] = spell;
}

/**
 * Put a known spell (or nothing) in a slot. Refused when dead, mid-cast, or for a spell you don't
 * know. A spell already in another slot moves there (that slot is emptied). A spell new to the
 * loadout gets cooldown max(remaining, max(full, SWAP_MIN_COOLDOWN)), so a swap never shortens a
 * cooldown; at a shrine the swap is free.
 */
export function equipSpell(ctx: Ctx, e: Entity, slot: number, spell: SpellId | null): void {
  const p = e.progress!;
  const c = e.combat;
  if (!Number.isInteger(slot) || slot < 0 || slot >= LOADOUT_SLOTS) return refuse(ctx, e, 'equipSpell', 'There is no such slot.');
  if (spell !== null && !Object.hasOwn(SPELLS, spell)) return refuse(ctx, e, 'equipSpell', 'There is no such power.');
  if (c?.action?.kind === 'dead') return refuse(ctx, e, 'equipSpell', "You can't change powers now.");
  if (c?.action?.kind === 'cast') return refuse(ctx, e, 'equipSpell', 'Finish casting first.');
  if (spell !== null && !p.spells.includes(spell)) return refuse(ctx, e, 'equipSpell', `You haven't learned ${SPELLS[spell].name} yet.`);
  if (p.loadout[slot] === spell) return;
  const wasIn = spell === null ? -1 : p.loadout.indexOf(spell);
  if (wasIn >= 0) p.loadout[wasIn] = null;
  p.loadout[slot] = spell;
  const free = !!p.atShrine;
  let cooldown = 0;
  if (spell !== null && c) {
    const remaining = c.cooldowns[spell] ?? 0;
    // Moving a spell between slots keeps its cooldown; one brought into the loadout waits.
    cooldown = wasIn >= 0 || free ? remaining : Math.max(remaining, Math.max(SPELLS[spell].cooldown, SWAP_MIN_COOLDOWN));
    if (cooldown > 0) c.cooldowns[spell] = cooldown;
  }
  ctx.events.push({ type: 'spellEquipped', entity: e.id, slot, spell, cooldown, free });
}

// ---------------------------------------------------------------- the gear lock

/** A real enemy (no training dummy, not even one that swings) has the player as its target this tick. */
export function markTargeted(entities: readonly Entity[], now: number, get: (id: number) => Entity | undefined): void {
  for (const e of entities) {
    const b = e.brain;
    if (!b || b.target === null || e.combat?.action?.kind === 'dead' || !ENEMIES[b.def]?.moves.length || ENEMIES[b.def].dummy) continue;
    const t = get(b.target);
    if (t?.combat && t.progress) t.combat.targetedAt = now;
  }
}

/** In combat: an enemy targeted this player within the last GEAR_LOCK_TICKS (5 s). */
export const inCombat = (e: Readonly<Entity>, now: number): boolean => !!e.combat && now - e.combat.targetedAt < GEAR_LOCK_TICKS;

/** Gear changes are locked in combat, except at a shrine. */
export const gearLocked = (e: Readonly<Entity>, now: number): boolean => inCombat(e, now) && !e.progress?.atShrine;

// ---------------------------------------------------------------- the skill tree

function perksReached(before: readonly string[], e: Entity, ctx: Ctx): void {
  for (const k of PERK_IDS) if (!before.includes(k) && hasPerk(e.progress!.skills, k)) ctx.events.push({ type: 'perk', entity: e.id, perk: PERKS[k].id });
}

/** Spend a point on a skill (anywhere): refused with no point to spend or at rank 10. */
export function spendSkill(ctx: Ctx, e: Entity, skill: SkillId): void {
  const p = e.progress!;
  if (!SKILL_IDS.includes(skill)) return refuse(ctx, e, 'spendSkill', 'There is no such skill.');
  if (p.points <= 0) return refuse(ctx, e, 'spendSkill', 'No skill points to spend.');
  if (p.skills[skill] >= SKILL_MAX_RANK) return refuse(ctx, e, 'spendSkill', 'That skill is at its highest rank.');
  const before = PERK_IDS.filter((k) => hasPerk(p.skills, k));
  p.points--;
  p.skills[skill]++;
  recompute(e);
  ctx.events.push({ type: 'skillSpent', entity: e.id, skill, rank: p.skills[skill] });
  perksReached(before, e, ctx);
}

export const respecCost = (p: Readonly<Progress>): number => RESPEC_SPROUTS_PER_LEVEL * p.level;

/** Refund every rank into points for 100 × level Sprouts. Only at a shrine. */
export function respecSkills(ctx: Ctx, e: Entity): void {
  const p = e.progress!;
  if (!p.atShrine) return refuse(ctx, e, 'respecSkills', 'Reset your skills at a shrine.');
  const spent = ranksSpent(p.skills);
  if (spent === 0) return refuse(ctx, e, 'respecSkills', 'No skill points spent yet.');
  const cost = respecCost(p);
  if (p.sprouts < cost) return refuse(ctx, e, 'respecSkills', `Resetting costs ${cost} Sprouts.`);
  p.sprouts -= cost;
  p.skills = noSkills();
  p.points += spent;
  recompute(e);
  ctx.events.push({ type: 'currency', entity: e.id, amount: -cost, total: p.sprouts });
  ctx.events.push({ type: 'skillsReset', entity: e.id, refunded: spent, cost });
}

/** Skill points from content (a boss's reward). */
export function grantSkillPoints(ctx: Ctx, e: Entity, amount: number): void {
  const p = e.progress!;
  if (amount <= 0) return;
  p.points += amount;
  ctx.events.push({ type: 'skillPoints', entity: e.id, amount, total: p.points });
}
