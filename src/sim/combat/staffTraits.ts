import { ENEMIES } from '../../content/enemies';
import { TRAIT, staffTrait, type StaffTraitId } from '../../content/packs/c2';
import { BTN, type InputCommand } from '../commands';
import type { Action, Entity } from '../entity';
import type { Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { affixElite } from '../systems/affixes';
import { flatDist } from './geometry';
import type { HitInfo } from './hits';
import type { CombatCtx } from './playerCombat';
import { applyStatus } from './statuses';

/**
 * Staff traits (expansion plan §2.1): each staff changes one rule, through the small hooks below,
 * called from playerCombat, spells and hits. The numbers and words are in content/packs/c2.ts.
 * Enemies carry no staff, so every hook leaves them alone. Pure.
 */

const has = (e: Readonly<Entity>, trait: StaffTraitId): boolean => staffTrait(e.progress?.equipment.staff) === trait;

/** Light enemies are the ones a shove or a lift can move: not elites, bosses or training dummies. */
function isLight(e: Readonly<Entity>): boolean {
  const def = e.brain ? ENEMIES[e.brain.def] : undefined;
  return e.kind === 'enemy' && !!def && !def.elite && !def.dummy && !affixElite(e);
}

// ---------------------------------------------------------------- melee and hits

/** Brawler: the third light hit chains into a fourth. */
export const brawlerChains = (p: Readonly<Entity>, move: string): boolean => move === 'light3' && has(p, 'brawler');

/** Crusher: more poise damage from everything the wielder lands. */
export const staffPoiseMult = (attacker: Readonly<Entity>): number => (has(attacker, 'crusher') ? TRAIT.crusher.poise : 1);

/** Crusher: extra stagger ticks when a heavy melee attack breaks poise. */
export const staffStaggerBonus = (attacker: Readonly<Entity>, info: Readonly<HitInfo>): number => (has(attacker, 'crusher') && info.heavy && !info.projectile ? TRAIT.crusher.staggerTicks : 0);

/** Shove: heavy melee attacks and Bolts push light enemies further. */
export function staffPushback(attacker: Readonly<Entity>, target: Readonly<Entity>, info: Readonly<HitInfo>): number {
  if (!has(attacker, 'shove') || !isLight(target)) return info.pushback;
  const shoves = info.move === 'bolt' || (info.heavy && !info.projectile);
  return shoves ? Math.max(info.pushback, TRAIT.shove.pushback) : info.pushback;
}

/** A hit that landed and didn't kill, before the target reacts. Ember Swing: the third light hit burns. */
export function staffOnHit(ctx: CombatCtx, attacker: Entity, target: Entity, info: Readonly<HitInfo>): void {
  if (info.move === 'light3' && has(attacker, 'emberSwing')) applyStatus(ctx, target, 'burn', 1, attacker.id);
}

/** After the target reacted. Abduct: a Bolt holds a light enemy helpless (it doesn't extend a hold). */
export function staffAfterReaction(ctx: CombatCtx, attacker: Entity, target: Entity, info: Readonly<HitInfo>): void {
  const c = target.combat;
  if (!c || info.move !== 'bolt' || !has(attacker, 'abduct') || !isLight(target) || c.action?.kind === 'stagger') return;
  c.action = { kind: 'stagger', t: 0, dur: TRAIT.abduct.ticks };
  c.buffer = null;
  ctx.events.push({ type: 'stagger', entity: target.id, ticks: TRAIT.abduct.ticks });
}

// ---------------------------------------------------------------- Blink

/** The height of the path the blink checks for walls (m above the feet). */
const BLINK_PATH_Y = 1;

/** The furthest clear place to land along `dir`: ground to stand on, no wall on the way, nobody there. */
function blinkSpot(ctx: CombatCtx, p: Entity, dir: { x: number; z: number }, physics: PhysicsWorld): Vec3 | null {
  const { distance, minDistance, step, climb, drop } = TRAIT.blink;
  const feet = p.tf.pos;
  const radius = p.body?.radius ?? 0.4;
  const start = { x: feet.x, y: feet.y + BLINK_PATH_Y, z: feet.z };
  for (let d = distance; d >= minDistance; d -= step) {
    const x = feet.x + dir.x * d, z = feet.z + dir.z * d;
    const ground = physics.raycast({ x, y: feet.y + climb, z }, { x: 0, y: -1, z: 0 }, climb + drop);
    if (!ground || Math.abs(ground.normal.y) < 0.6) continue;
    const y = ground.point.y;
    const path = { x: x - start.x, y: y + BLINK_PATH_Y - start.y, z: z - start.z };
    // A little under the body's radius: standing against a wall must not count as hitting it.
    if (physics.sphereCast(start, path, radius * 0.8)) continue;
    const spot = { x, y, z };
    const taken = ctx.entities.some((e) => e !== p && !!e.body && flatDist(spot, e.tf.pos) < e.body.radius + radius && Math.abs(e.tf.pos.y - y) < e.body.height);
    if (!taken) return { x, y: y + 0.02, z };
  }
  return null;
}

/**
 * Blink: Sprint + Dodge jumps along `dir`, untouchable while it lasts. False (so the dodge rolls)
 * with another staff, without Sprint held, on cooldown, in the saddle, or with nowhere to land.
 */
export function tryBlink(ctx: CombatCtx, p: Entity, cmd: InputCommand, dir: { x: number; z: number }, physics: PhysicsWorld): boolean {
  const c = p.combat!;
  if (p.riding || !has(p, 'blink') || (cmd.held & BTN.sprint) === 0 || ctx.now < (c.blinkReadyAt ?? 0)) return false;
  const to = blinkSpot(ctx, p, dir, physics);
  if (!to) return false;
  const from = { ...p.tf.pos };
  p.tf.pos = to;
  p.tf.prevPos = { ...to };
  p.tf.vel = { x: 0, y: 0, z: 0 };
  physics.teleport(p.id, to);
  c.blinkReadyAt = ctx.now + TRAIT.blink.cooldown;
  c.action = { kind: 'blink', t: 0 };
  ctx.events.push({ type: 'blink', entity: p.id, from, to: { ...to } });
  return true;
}

// ---------------------------------------------------------------- Charged Bolt

const SPELL_BUTTONS = [BTN.spell1, BTN.spell2, BTN.spell3, BTN.spell4] as const;

/**
 * Charged Bolt: while the button of the slot holding Bolt stays down, the cast waits on its last tick
 * before the release and the charge grows, paying the extra mana as it goes. True while it waits. A
 * tap never gets here, so it's a plain Bolt at the plain price. `cost` is this cast's mana.
 */
export function holdChargedBolt(ctx: CombatCtx, p: Entity, cmd: InputCommand, a: Extract<Action, { kind: 'cast' }>, cost: number): boolean {
  if (a.spell !== 'bolt' || a.released || a.t !== a.release - 1 || !has(p, 'chargedBolt')) return false;
  const slot = p.progress!.loadout.indexOf('bolt');
  if (slot < 0 || (cmd.held & SPELL_BUTTONS[slot]) === 0) return false;
  const { ticks, mana, pulseEvery } = TRAIT.chargedBolt;
  const charge = a.charge ?? 0;
  const drain = (cost * (mana - 1)) / ticks;
  const v = p.vitals!;
  if (charge >= ticks || v.mana < drain) return false;
  v.mana -= drain;
  a.charge = charge + 1;
  if (charge % pulseEvery === 0) ctx.events.push({ type: 'boltCharge', entity: p.id, frac: a.charge / ticks });
  return true;
}

/** The damage multiplier of the cast being released: up to ×3 for a full charge. */
export function castChargeMult(p: Readonly<Entity>): number {
  const a = p.combat?.action;
  if (a?.kind !== 'cast' || !a.charge) return 1;
  const { ticks, damage } = TRAIT.chargedBolt;
  return 1 + (damage - 1) * Math.min(1, a.charge / ticks);
}
