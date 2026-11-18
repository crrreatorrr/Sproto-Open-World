import { ENEMIES } from '../../src/content/enemies';
import { SANDBOX } from '../../src/content/sandbox';
import { SPELLS, type SpellId } from '../../src/content/spells';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { grantXp, recompute } from '../../src/sim/systems/rpg';
import { SimWorld } from '../../src/sim/SimWorld';

/**
 * The balance bot (plan §8): plays a fight by commands only, deterministically. It locks on to the
 * nearest enemy, closes in, dodges a wind-up that is about to land, drinks a tonic when low, and
 * picks its damage the way a player who reads the enemy's profile would (melee against physical-weak
 * or arcane-resistant targets, spells against physical-resistant ones). `meleeOnly` never casts:
 * the paired check that proves profiles matter.
 */
export interface BotOpts {
  meleeOnly?: boolean;
  /** Never dodges (the slice's "a bot that never dodges loses" check). */
  noDodge?: boolean;
}

export interface FightResult {
  won: boolean;
  died: boolean;
  /** Sim seconds until the last enemy fell, the player died, or the limit. */
  seconds: number;
  hpLeft: number;
}

const SLOT: Record<string, number> = { bolt: BTN.spell1, blast: BTN.spell2, frostNova: BTN.spell3, chainZap: BTN.spell4 };
const yaw = (a: Entity, b: Entity) => Math.atan2(b.tf.pos.x - a.tf.pos.x, b.tf.pos.z - a.tf.pos.z);
const dist = (a: Entity, b: Entity) => Math.hypot(b.tf.pos.x - a.tf.pos.x, b.tf.pos.z - a.tf.pos.z);
const alive = (e: Entity) => e.combat?.action?.kind !== 'dead';

/** A flat arena with the player at the origin at `level`, and `defs` placed 10 m north as a camp. */
/** `spells`: what the player knows at that point of the game (the main path's order). */
export async function arena(seed: number, level: number, defs: string[], spells: SpellId[]): Promise<{ w: SimWorld; p: Entity; enemies: Entity[] }> {
  await initPhysics();
  const w = new SimWorld({ ...SANDBOX, enemies: [] }, seed);
  const p = w.spawnPlayer(0, { x: 0, y: 0, z: 0 }, 0);
  const prog = p.progress!;
  prog.spells = [...spells];
  if (level > 1) {
    const events: never[] = [];
    // Level up the way the game does (XP), so growth matches play.
    grantXp({ now: 0, entities: w.entities, events, world: w.world, rng: w.rng.stream('loot'), spawnPickup: () => {} }, p, xpNeeded(level));
  }
  recompute(p);
  p.vitals!.hp = p.vitals!.hpMax;
  p.vitals!.mana = p.vitals!.manaMax;
  prog.tonics.charges = prog.tonics.max;
  const enemies = defs.map((d, i) => {
    const a = (i / defs.length) * Math.PI * 2;
    const e = w.spawnEnemy(d, { x: Math.sin(a) * 3, y: 0, z: 10 + Math.cos(a) * 3 }, Math.PI);
    // A camp: it stays down once killed (sandbox enemies would respawn after a few seconds).
    e.brain!.camp = 'arena';
    return e;
  });
  return { w, p, enemies };
}

function xpNeeded(level: number): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += Math.round(60 * Math.pow(l, 1.45));
  return t;
}

/** Fight until every enemy is down, the player dies, or `limitSec` of sim time passes. */
export function fight(w: SimWorld, p: Entity, enemies: Entity[], opts: BotOpts = {}, limitSec = 180): FightResult {
  const limit = limitSec * 60;
  let lastDodge = -999;
  let lastLight = -999;
  for (let t = 0; t < limit; t++) {
    if (!alive(p)) return { won: false, died: true, seconds: t / 60, hpLeft: 0 };
    const living = enemies.filter(alive);
    if (!living.length) return { won: true, died: false, seconds: t / 60, hpLeft: p.vitals!.hp };
    const target = living.reduce((a, b) => (dist(p, a) <= dist(p, b) ? a : b));
    const def = ENEMIES[target.brain!.def];
    const c: InputCommand = idleInput(yaw(p, target));
    const press = (b: number) => {
      c.pressed |= b;
      c.held |= b;
    };
    if (p.combat!.lock !== target.id) {
      // Re-aim the lock at the nearest (the camera faces it, so the cone picks it).
      if (p.combat!.lock !== null) press(BTN.lock);
      else if (t % 2 === 0) press(BTN.lock);
    }
    const d = dist(p, target) - target.body!.radius;
    const prog = p.progress!;
    // The spell a profile-reading player reaches for: the target's status weakness first (Burn →
    // Blast, Shock → Chain Zap), else Bolt against an arcane-weak or physical-resistant target.
    const st = def.profile.status;
    const prefer: SpellId[] = [
      ...(st.burn === 'weak' ? (['blast'] as SpellId[]) : []),
      ...(st.shock === 'weak' ? (['chainZap'] as SpellId[]) : []),
      ...(def.profile.damage.arcane === 'weak' || def.profile.damage.physical === 'resist' ? (['bolt'] as SpellId[]) : []),
    ];
    const castable = opts.meleeOnly ? undefined : prefer.find((s) => prog.spells.includes(s) && (p.combat!.cooldowns?.[s] ?? 0) <= 0 && p.vitals!.mana >= SPELLS[s].cost);
    // Kite with spells only against a physical-resistant target, and only while there is mana;
    // otherwise the staff (which also refills mana).
    const useSpells = !!castable && def.profile.damage.physical === 'resist';
    const want = useSpells ? 9 : 1.2;
    if (d > want) c.move = { x: 0, y: 1 };
    else if (useSpells && d < 5) c.move = { x: 0, y: -1 };

    // Dodge a melee wind-up that is about to land on us.
    if (!opts.noDodge && t - lastDodge > 40) {
      for (const e of living) {
        const a = e.combat!.action;
        if (a?.kind !== 'attack') continue;
        const m = ENEMIES[e.brain!.def].moves.find((x) => x.id === a.move);
        if (!m || m.projectile) continue;
        const reach = m.area ? m.area.radius + 1 : m.range + 1;
        if (a.t >= m.windup - 7 && a.t < m.windup && dist(p, e) - e.body!.radius < reach) {
          c.move = { x: 1, y: -0.3 };
          press(BTN.dodge);
          lastDodge = t;
          break;
        }
      }
    }
    // A tonic when low and not in the middle of something.
    if (p.vitals!.hp < p.vitals!.hpMax * 0.35 && prog.tonics.charges > 0 && !p.combat!.action) press(BTN.potion);

    if (!(c.pressed & (BTN.dodge | BTN.potion))) {
      if (castable && (useSpells || castable !== 'bolt')) press(SLOT[castable]);
      else if (d <= 1.6 && t - lastLight >= 9) {
        press(BTN.light);
        lastLight = t;
      }
    }
    w.tick(new Map([[0, c]]));
  }
  return { won: false, died: false, seconds: limitSec, hpLeft: p.vitals!.hp };
}
