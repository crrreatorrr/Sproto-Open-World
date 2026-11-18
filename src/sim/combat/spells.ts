import { STAFFS } from '../../content/combat';
import { PERK_EFFECT, PROTECTION_SPELLS, SKILL_EFFECT, hasPerk, protectionMult } from '../../content/progression';
import { charmOf, knowsSpell, staffOf } from '../systems/rpg';
import { ENEMIES } from '../../content/enemies';
import { SPELL_BASE, SPELLS, WOVEN, type SpellId } from '../../content/spells';
import { DT } from '../../content/tuning';
import { idleInput, type InputCommand } from '../commands';
import type { Entity } from '../entity';
import type { Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { resolveAim } from './aim';
import { angleTo, flatDist, toWorld, yawTo } from './geometry';
import { resolveHit, type HitInfo } from './hits';
import type { CombatCtx } from './playerCombat';
import { wishDir } from './playerCombat';
import { applyStatus } from './statuses';

/** Spawns a projectile entity (SimWorld owns ids). */
export type SpawnSpellProjectile = (e: Omit<Entity, 'id'>) => Entity;

const SPELL_TARGET_RANGE = 25;
const SPELL_CONE = (60 * Math.PI) / 180;

const chest = (e: Entity): Vec3 => ({ x: e.tf.pos.x, y: e.tf.pos.y + (e.body?.height ?? 1.8) * 0.55, z: e.tf.pos.z });
const enemyOf = (p: Entity, e: Entity) => !!e.combat && !!e.body && e.combat.team !== p.combat!.team && e.combat.action?.kind !== 'dead';

/** Spell power: SPELL_BASE × the staff's spellPower × (1 + 0.04 · Spell Power) × MV, ×1.2 when woven (more with Scholar's Knot). */
export function spellPower(id: SpellId, woven: boolean, caster?: Entity): number {
  const p = caster?.progress;
  const staff = p ? staffOf(p) : STAFFS.staff_sproto;
  const skill = 1 + SKILL_EFFECT.spellPower * (p?.skills.spellPower ?? 0);
  const wovenMult = WOVEN.damage + (p ? (charmOf(p)?.wovenBonus ?? 0) : 0);
  return SPELL_BASE * staff.spellPower * skill * SPELLS[id].mv * (woven ? wovenMult : 1);
}

/**
 * Start a cast if it's off cooldown and affordable (plan §4.4). Woven when cast within
 * WOVEN.window ticks of landing a melee hit: half the release time, +20% damage.
 */
export function startCast(ctx: CombatCtx, p: Entity, id: SpellId): boolean {
  const c = p.combat!;
  const v = p.vitals!;
  const def = SPELLS[id];
  if (!knowsSpell(p, id)) {
    ctx.events.push({ type: 'refused', entity: p.id, action: 'cast', reason: `You haven't learned ${def.name} yet.` });
    return false;
  }
  if ((c.cooldowns[id] ?? 0) > 0) {
    ctx.events.push({ type: 'cooldown', entity: p.id, spell: id });
    return false;
  }
  const woven = ctx.now - c.lastHitTick <= WOVEN.window;
  const cost = spellCost(p, id, woven);
  if (v.mana < cost) {
    ctx.events.push({ type: 'noMana', entity: p.id, spell: id });
    return false;
  }
  v.mana -= cost;
  const release = woven ? def.wovenRelease : def.release;
  c.action = { kind: 'cast', spell: id, t: 0, release, woven, released: false };
  ctx.events.push({ type: 'castStart', entity: p.id, spell: id, release, woven });
  return true;
}

/** Mana for a cast: the spell's cost, 15% less for a woven cast with the Magic 10 perk. */
export function spellCost(p: Entity, id: SpellId, woven: boolean): number {
  const cost = SPELLS[id].cost;
  return woven && hasPerk(p.progress?.skills, 'magic10') ? cost * PERK_EFFECT.wovenCost : cost;
}

/** Magic 20: a protection spell also cleanses one status from its caster (Burn, then Chill, then Shock). */
function cleanse(ctx: CombatCtx, p: Entity, id: SpellId): void {
  if (!PROTECTION_SPELLS.includes(id) || !hasPerk(p.progress?.skills, 'magic20') || !p.statuses) return;
  const s = p.statuses;
  const which = s.burn ? 'burn' : s.chill ? 'chill' : s.shock ? 'shock' : null;
  if (!which) return;
  delete s[which];
  ctx.events.push({ type: 'statusEnd', entity: p.id, status: which });
  ctx.events.push({ type: 'cleanse', entity: p.id, status: which });
}

/** The enemy a spell goes for: the lock, else the best in a cone of the input (or facing) within range. */
export function spellTarget(ctx: CombatCtx, p: Entity, cmd: InputCommand, range = SPELL_TARGET_RANGE): Entity | null {
  const c = p.combat!;
  if (c.lock !== null) {
    const t = ctx.get(c.lock);
    if (t && enemyOf(p, t) && flatDist(p.tf.pos, t.tf.pos) <= range) return t;
  }
  const w = wishDir(cmd);
  const yaw = w.mag > 0.2 ? Math.atan2(w.x, w.z) : p.tf.yaw;
  let best: Entity | null = null;
  let bestScore = Infinity;
  for (const e of ctx.entities) {
    if (!enemyOf(p, e)) continue;
    const d = flatDist(p.tf.pos, e.tf.pos);
    if (d > range) continue;
    const ang = angleTo(p.tf.pos, yaw, e.tf.pos);
    if (ang > SPELL_CONE / 2) continue;
    const score = ang * 8 + d;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** Where a released spell goes: the lock, else the centre of the screen, else the old soft target. */
function spellAim(ctx: CombatCtx, p: Entity, cmd: InputCommand, physics: PhysicsWorld, range: number): { target: Entity | null; point?: Vec3 } {
  const lock = p.combat!.lock !== null ? ctx.get(p.combat!.lock) : undefined;
  if (!cmd.aim || (lock && enemyOf(p, lock) && flatDist(p.tf.pos, lock.tf.pos) <= range)) return { target: spellTarget(ctx, p, cmd, range) };
  const r = resolveAim(ctx.entities, physics, p, cmd.aim);
  return { target: r.target && flatDist(p.tf.pos, r.target.tf.pos) <= range ? r.target : null, point: r.point };
}

/** Advance a cast; on the release tick the spell happens. Returns false when the cast is over. */
export function advanceCast(ctx: CombatCtx, p: Entity, cmd: InputCommand, physics: PhysicsWorld, spawn: SpawnSpellProjectile): void {
  const c = p.combat!;
  const a = c.action;
  if (a?.kind !== 'cast') return;
  const def = SPELLS[a.spell];
  a.t++;
  if (!a.released && a.t >= a.release) {
    a.released = true;
    c.cooldowns[a.spell] = def.cooldown;
    ctx.events.push({ type: 'cast', entity: p.id, spell: a.spell, woven: a.woven });
    const { target, point } = spellAim(ctx, p, cmd ?? idleInput(p.tf.yaw), physics, def.chain?.range ?? SPELL_TARGET_RANGE);
    fire(ctx, p, a.spell, a.woven, target, physics, spawn, point);
    cleanse(ctx, p, a.spell);
  }
  if (a.t >= a.release + def.recovery) c.action = null;
}

function spellInfo(id: SpellId, base: number, from: Vec3): HitInfo {
  const def = SPELLS[id];
  return {
    move: id, base, kind: 'arcane', poise: def.poise, hitstun: def.knockdown ? 45 : 20, knockdown: !!def.knockdown, pushback: def.knockdown ? 1.5 : 0.3,
    hitstop: 0, unblockable: true, heavy: id === 'blast', crit: false, mana: 0, from, projectile: true,
  };
}

function fire(ctx: CombatCtx, p: Entity, id: SpellId, woven: boolean, target: Entity | null, physics: PhysicsWorld, spawn: SpawnSpellProjectile, point?: Vec3): void {
  const def = SPELLS[id];
  const power = spellPower(id, woven, p);
  // Cast from the hand, but toward what the screen's centre is on, so the shot lands under it.
  if (point && flatDist(p.tf.pos, point) > 1) p.tf.yaw = yawTo(p.tf.pos, point);
  if (def.projectile) {
    const from = toWorld(p.tf.pos, p.tf.yaw, [0, 1.35, 0.6]);
    const aim = point ?? (target ? chest(target) : toWorld(p.tf.pos, p.tf.yaw, [0, 1.35, 10]));
    const d = { x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const sp = def.projectile.speed;
    spawn({
      kind: 'projectile',
      tf: { pos: from, prevPos: { ...from }, yaw: p.tf.yaw, prevYaw: p.tf.yaw, vel: { x: (d.x / len) * sp, y: (d.y / len) * sp, z: (d.z / len) * sp } },
      projectile: {
        owner: p.id, team: p.combat!.team, kind: 'arcane', damage: power, poise: def.poise, radius: def.projectile.radius,
        life: Math.ceil(def.projectile.range / (sp * DT)), reflected: false, spell: id, explode: def.projectile.explodeRadius,
        status: def.status, interrupts: def.interruptsRanged, knockdown: def.knockdown, woven,
      },
      view: { model: id === 'blast' ? 'blastOrb' : 'bolt' },
    });
    return;
  }
  if (def.nova) {
    const at = { ...p.tf.pos };
    // Protection scales the push (a protection spell's strength).
    const push = def.nova.push * protectionMult(p.progress?.skills);
    ctx.events.push({ type: 'nova', entity: p.id, pos: at, radius: def.nova.radius });
    for (const e of ctx.entities) {
      if (!enemyOf(p, e) || flatDist(at, e.tf.pos) > def.nova.radius + (e.body?.radius ?? 0)) continue;
      const out = resolveHit(ctx, p, e, spellInfo(id, power, at));
      if (out !== 'hit') continue;
      if (def.status && e.combat?.action?.kind !== 'dead') applyStatus(ctx, e, def.status.id, def.status.stacks, p.id);
      const dx = e.tf.pos.x - at.x, dz = e.tf.pos.z - at.z;
      const dl = Math.hypot(dx, dz) || 1;
      const isDummy = !!(e.brain && ENEMIES[e.brain.def].dummy);
      if (e.combat && e.combat.action?.kind !== 'dead' && !isDummy) e.combat.push = { x: (dx / dl) * (push / 6), z: (dz / dl) * (push / 6), ticks: 6 };
    }
    return;
  }
  if (def.chain) {
    const hand = toWorld(p.tf.pos, p.tf.yaw, [0, 1.35, 0.6]);
    const points: Vec3[] = [hand];
    const hit: number[] = [];
    let cur = target && visible(physics, hand, chest(target)) ? target : null;
    let mult = 1;
    for (let i = 0; cur && i <= def.chain.jumps; i++) {
      points.push(chest(cur));
      hit.push(cur.id);
      const out = resolveHit(ctx, p, cur, spellInfo(id, power * mult, points[points.length - 2]));
      if (out === 'hit' && def.status && cur.combat?.action?.kind !== 'dead') applyStatus(ctx, cur, def.status.id, def.status.stacks, p.id);
      mult *= def.chain.falloff;
      const from: Entity = cur;
      let next: Entity | null = null;
      let best = def.chain.jumpRange;
      for (const e of ctx.entities) {
        if (!enemyOf(p, e) || hit.includes(e.id)) continue;
        const d = flatDist(from.tf.pos, e.tf.pos);
        if (d <= best && visible(physics, chest(from), chest(e))) {
          best = d;
          next = e;
        }
      }
      cur = next;
    }
    if (hit.length === 0) points.push(toWorld(p.tf.pos, p.tf.yaw, [0, 1.35, 6]));
    ctx.events.push({ type: 'zap', entity: p.id, points, targets: hit });
  }
}

function visible(physics: PhysicsWorld, a: Vec3, b: Vec3): boolean {
  const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const dist = Math.hypot(dir.x, dir.y, dir.z);
  if (dist < 0.3) return true;
  const h = physics.raycast(a, dir, dist);
  return !h || h.distance >= dist - 0.3;
}

/** Face the spell's target while winding up (spells are aimed, not swung). */
export function castFacing(ctx: CombatCtx, p: Entity, cmd: InputCommand): number | undefined {
  const a = p.combat?.action;
  if (a?.kind !== 'cast' || a.released) return undefined;
  if (cmd.aim && p.combat!.lock === null && Math.hypot(cmd.aim.dir.x, cmd.aim.dir.z) > 1e-3) return Math.atan2(cmd.aim.dir.x, cmd.aim.dir.z);
  const t = spellTarget(ctx, p, cmd);
  return t ? yawTo(p.tf.pos, t.tf.pos) : undefined;
}
