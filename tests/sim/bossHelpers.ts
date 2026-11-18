import { ENEMIES } from '../../src/content/enemies';
import { DRAKE_WAKE_FLAG } from '../../src/content/packs/c6';
import { idleInput } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { step } from './combatHelpers';
import { flatSproutvale, standAt } from './m4Helpers';

export type BossId = 'scrapjaw' | 'burrowmother' | 'skyfire_drake';
export const BOSSES: BossId[] = ['scrapjaw', 'burrowmother', 'skyfire_drake'];

/** All of Sproutvale, flat, with `id`'s wake flag set and the player well outside its arena. */
export async function bossWorld(id: BossId, seed = 1): Promise<{ w: SimWorld; p: Entity; boss: Entity }> {
  const { w, p } = await flatSproutvale(seed);
  w.world.flags['seam.awake'] = 1;
  w.world.flags[DRAKE_WAKE_FLAG] = 1;
  const boss = w.entities.find((e) => e.brain?.def === id)!;
  return { w, p, boss };
}

/** One tick with the player idle and topped up, so the fight can go on as long as a test wants. */
export function tickAlive(w: SimWorld, p: Entity): SimEvent[] {
  p.vitals!.hp = p.vitals!.hpMax;
  return step(w, idleInput(p.tf.yaw));
}

/** Walk in (by teleport) and wait for the intro to finish. */
export function startFight(w: SimWorld, p: Entity, boss: Entity, off = 8): SimEvent[] {
  const out: SimEvent[] = [];
  const home = boss.brain!.home;
  standAt(w, home.x + off, home.z);
  for (let i = 0; i < 600 && boss.boss!.state !== 'fight'; i++) out.push(...tickAlive(w, p));
  if (boss.boss!.state !== 'fight') throw new Error(`${boss.brain!.def}: the fight did not start`);
  return out;
}

/** Tick until `when` holds (the player kept alive). Throws if it never does. */
export function until(w: SimWorld, p: Entity, when: () => boolean, max = 6000, what = 'condition'): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < max && !when(); i++) out.push(...tickAlive(w, p));
  if (!when()) throw new Error(`never happened: ${what}`);
  return out;
}

/** Into the given phase: HP just under its line, then wait for the roar to play out. */
export function toPhase(w: SimWorld, p: Entity, boss: Entity, phase: 2 | 3): SimEvent[] {
  const cfg = ENEMIES[boss.brain!.def].boss!;
  boss.vitals!.hp = boss.vitals!.hpMax * (phase === 2 ? cfg.phase2 : cfg.phase3) - 1;
  return until(w, p, () => boss.boss!.phase === phase, 1200, `phase ${phase}`);
}

/** What the boss is doing now, by move id ('' when it isn't attacking). */
export const moveOf = (e: Entity): string => (e.combat?.action?.kind === 'attack' ? e.combat.action.move : '');
