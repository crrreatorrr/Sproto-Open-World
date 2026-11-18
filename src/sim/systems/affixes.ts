import { ENEMIES, type Affinity } from '../../content/enemies';
import { AFFIXES, CAMP_AFFIX_POOLS, type AffixDef, type AffixId } from '../../content/packs/c4';
import type { Entity } from '../entity';
import { fnv1a } from '../hash';

/**
 * Stat affixes (expansion plan §3.6). A camp rolls at most one from hash(seed, campId, generation),
 * so the roll doesn't depend on the order cells stream in and comes out the same after a reload.
 * The generation is a saved world flag that goes up with every rest at a shrine. Pure.
 */
export function rollCampAffix(seed: number, campId: string, generation: number): AffixId | null {
  const pool = CAMP_AFFIX_POOLS[campId];
  if (!pool?.length) return null;
  // Half of the rolls leave the camp plain.
  const pick = fnv1a(`${seed}:${campId}:${generation}`) % (pool.length * 2);
  return pick < pool.length ? pool[pick] : null;
}

const affixOf = (e: Readonly<Entity>): AffixDef | undefined => (e.brain?.affix ? AFFIXES[e.brain.affix] : undefined);

/**
 * Put an affix on an enemy (or none), from its definition's base numbers, so applying one over
 * another never compounds. Full health afterwards. Returns true if the body changed size: the caller
 * rebuilds its capsule.
 */
export function applyAffix(e: Entity, affix: AffixId | null): boolean {
  const b = e.brain;
  if (!b || !e.vitals || !e.body) return false;
  const def = ENEMIES[b.def];
  const fx = affix ? AFFIXES[affix] : undefined;
  if (affix) b.affix = affix;
  else delete b.affix;
  e.vitals.hpMax = Math.round(def.hp * (fx?.hp ?? 1));
  e.vitals.hp = e.vitals.hpMax;
  const scale = fx?.scale ?? 1;
  if (scale === 1) delete e.view.scale;
  else e.view.scale = scale;
  const radius = def.body.radius * scale, height = def.body.height * scale;
  if (e.body.radius === radius && e.body.height === height) return false;
  e.body = { radius, height };
  return true;
}

/** Ground speed multiplier. */
export const affixSpeed = (e: Readonly<Entity>): number => affixOf(e)?.speed ?? 1;

/** Kill XP multiplier. */
export const affixXp = (e: Readonly<Entity>): number => affixOf(e)?.xp ?? 1;

/** Counts as an elite (no hitstun until its poise breaks). */
export const affixElite = (e: Readonly<Entity>): boolean => !!affixOf(e)?.elite;

/** Hardy: the enemy's weak element only does normal damage. */
export const affixAffinity = (e: Readonly<Entity>, a: Affinity): Affinity => (a === 'weak' && affixOf(e)?.hardy ? 'normal' : a);
