import { POWER } from '../../../content/packs/c3';
import { BTN, type InputCommand } from '../../commands';
import type { Entity } from '../../entity';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { angleTo, flatDist } from '../geometry';
import { resolveHit } from '../hits';
import type { CombatCtx } from '../playerCombat';
import { spellPower } from '../spells';
import { applyStatus } from '../statuses';
import { alive, chestOf, clearLine, hostile, powerHit } from './common';

const E = POWER.ember;
const SLOT_BUTTONS = [BTN.spell1, BTN.spell2, BTN.spell3, BTN.spell4] as const;

/** The cast's release turns into a channel: the action stays a cast until the breath ends. */
export function startChannel(ctx: CombatCtx, p: Entity): void {
  const a = p.combat!.action;
  if (a?.kind !== 'cast') return;
  a.channel = { t: 0, dur: E.ticks };
  ctx.events.push({ type: 'power', fx: 'emberStart', entity: p.id, pos: chestOf(p) });
}

/** The button of the slot the channelled spell sits in is still down (LT + face on a pad, the key on a keyboard). */
function held(p: Entity, cmd: InputCommand, spell: string): boolean {
  const slot = p.progress?.loadout.findIndex((s) => s === spell) ?? -1;
  return slot >= 0 && (cmd.held & SLOT_BUTTONS[slot]) !== 0;
}

/** One tick of the breath. It ends at full length, on letting go (after a short minimum), or on a dodge. */
export function advanceChannel(ctx: CombatCtx, p: Entity, cmd: InputCommand, physics: PhysicsWorld): void {
  const c = p.combat!;
  const a = c.action;
  if (a?.kind !== 'cast' || !a.channel) return;
  const ch = a.channel;
  if (ch.t % E.pulseTicks === 0) pulse(ctx, p, spellPower(a.spell, a.woven, p), physics);
  ch.t++;
  const letGo = ch.t >= E.minTicks && !held(p, cmd, a.spell);
  if (ch.t >= ch.dur || letGo || (cmd.pressed & BTN.dodge) !== 0) c.action = null;
}

/** Everyone in the cone with a clear line takes the pulse and catches fire. */
function pulse(ctx: CombatCtx, p: Entity, power: number, physics: PhysicsWorld): void {
  const mouth = chestOf(p);
  ctx.events.push({ type: 'power', fx: 'emberPulse', entity: p.id, pos: mouth });
  for (const e of ctx.entities) {
    if (!hostile(p, e) || Math.abs(e.tf.pos.y - p.tf.pos.y) > 3) continue;
    const gap = flatDist(p.tf.pos, e.tf.pos) - e.body!.radius;
    if (gap > E.range || (gap > 0.9 && angleTo(p.tf.pos, p.tf.yaw, e.tf.pos) > E.halfAngle)) continue;
    if (!clearLine(physics, mouth, chestOf(e))) continue;
    const out = resolveHit(ctx, p, e, powerHit('emberBreath', power, { ...p.tf.pos }, { hitstun: 12, pushback: 0.1 }));
    if (out === 'hit' && alive(e)) applyStatus(ctx, e, 'burn', 1, p.id);
  }
}
