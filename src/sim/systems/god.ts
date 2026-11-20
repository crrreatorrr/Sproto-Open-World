import { ITEMS } from '../../content/items';
import { KEEPSAKES } from '../../content/relics';
import { SPELLS, type SpellId } from '../../content/spells';
import type { Entity } from '../entity';
import type { SimEvent } from '../events';
import { learnIntoLoadout } from './loadout';
import { relicProgress } from './relics';
import { recompute, refillTonics } from './rpg';

/**
 * God mode, for testing: the player can't die, and turning it on hands out everything at once.
 * It lives on Progress for the session only (SimWorld.toSave drops it). Pure.
 */
export const GOD = {
  level: 99,
  points: 99,
  sprouts: 99_999,
  /** How many of each stacking item. */
  stack: 99,
} as const;

export const isGod = (e: Readonly<Entity> | undefined): boolean => !!e?.progress?.god;

/** Turn god mode on (with every grant) or off (the grants stay for the session). */
export function setGod(events: SimEvent[], e: Entity, on: boolean): void {
  const p = e.progress;
  if (!p) return;
  if (!on) {
    delete p.god;
    events.push({ type: 'godMode', entity: e.id, on: false });
    return;
  }
  p.god = true;
  p.level = Math.max(p.level, GOD.level);
  p.points = Math.max(p.points, GOD.points);
  p.sprouts = Math.max(p.sprouts, GOD.sprouts);
  // Every item except tomes (buying one teaches its spell; the spells come below).
  for (const def of Object.values(ITEMS)) {
    if (def.teaches) continue;
    p.inventory[def.id] = def.stacks ? Math.max(p.inventory[def.id] ?? 0, GOD.stack) : Math.max(p.inventory[def.id] ?? 0, 1);
  }
  for (const id of Object.keys(SPELLS) as SpellId[]) {
    if (!p.spells.includes(id)) p.spells.push(id);
    learnIntoLoadout(p, id);
  }
  const r = relicProgress(e);
  for (const k of KEEPSAKES) if (!r.owned.includes(k.id)) r.owned.push(k.id);
  r.introduced = true;
  recompute(e);
  refillTonics(p.tonics);
  const v = e.vitals;
  if (v && e.combat?.action?.kind !== 'dead') {
    v.hp = v.hpMax;
    v.mana = v.manaMax;
    v.stamina = v.staminaMax;
  }
  events.push({ type: 'godMode', entity: e.id, on: true });
}

/** Keep a god's health full. Runs after this tick's hits, so the bar never moves. */
export function godVitals(entities: readonly Entity[]): void {
  for (const e of entities) {
    if (!e.progress?.god || !e.vitals || e.combat?.action?.kind === 'dead') continue;
    e.vitals.hp = e.vitals.hpMax;
  }
}
