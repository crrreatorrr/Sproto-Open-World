import { BLOCK } from '../../content/combat';
import { ENEMIES } from '../../content/enemies';
import { DT } from '../../content/tuning';
import type { Entity } from '../entity';

/** Re-read after a hit (TypeScript narrowed the action before resolveHit changed it). */
const isDead = (e: Entity) => e.combat?.action?.kind === 'dead';
import type { Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { bodySegment, flatDist, segmentSegmentDistSq } from './geometry';
import { resolveHit, type HitInfo } from './hits';
import { turnstoneReady, turnstoneSpent } from '../systems/relics';
import type { CombatCtx } from './playerCombat';
import { wardProjectile } from './powers/mirrorWard';
import { snareHit } from './powers/snare';
import { applyStatus } from './statuses';

/** The share of its speed a bouncing round keeps. */
const BOUNCE_KEEP = 0.6;

/**
 * Projectiles fly straight (homing ones turn toward their target), stop on world geometry, and
 * hit bodies of the other team. A parried projectile is reflected back at its shooter, 1.5×
 * faster and harder, keeping its damage kind (plan §4.3, §4.6). Spell projectiles apply their
 * status; Blast's orb explodes on impact or at the end of its range. Returns the ids to remove.
 */
export function stepProjectiles(ctx: CombatCtx, physics: PhysicsWorld): number[] {
  const dead: number[] = [];
  for (const e of ctx.entities) {
    const pr = e.projectile;
    if (!pr) continue;
    if (ctx.frozen.has(e.id)) continue;
    if (pr.homing && pr.target !== undefined) steer(e, ctx.get(pr.target));
    if (pr.gravity) e.tf.vel.y -= pr.gravity * DT;
    const from = { ...e.tf.pos };
    const to = { x: from.x + e.tf.vel.x * DT, y: from.y + e.tf.vel.y * DT, z: from.z + e.tf.vel.z * DT };
    const ward = pr.unstoppable ? null : wardProjectile(ctx, e, from, to);
    if (ward === 'reflected') continue;
    if (ward === 'blocked') {
      dead.push(e.id);
      continue;
    }
    // Turnstone turns one shot, and stays quiet while Mirror Ward is already doing it.
    if (!pr.reflected && pr.team === 'enemy' && !ward && !pr.unstoppable) {
      const stone = turnstoneReady(ctx.entities, from, ctx.now, false);
      if (stone) {
        const coop = ctx.entities.filter((p) => p.kind === 'player').length > 1;
        turnstoneSpent(stone, ctx.now, coop);
        reflect(e, stone, ctx);
        continue;
      }
    }
    const seg = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const segLen = Math.hypot(seg.x, seg.y, seg.z);
    const wall = segLen > 1e-6 ? physics.raycast(from, seg, segLen + pr.radius) : null;

    let consumed = false;
    let reflected = false;
    for (const tgt of ctx.entities) {
      if (!tgt.combat || !tgt.body || tgt.combat.team === pr.team || tgt.combat.action?.kind === 'dead') continue;
      if (pr.struck?.includes(tgt.id)) continue;
      const [b0, b1] = bodySegment(tgt.tf.pos, tgt.body.radius, tgt.body.height);
      const r = pr.radius + tgt.body.radius;
      if (segmentSegmentDistSq(from, to, b0, b1) > r * r) continue;
      const owner = ctx.get(pr.owner) ?? e;
      if (pr.explode && pr.splash) {
        // A gun round: the body it strikes takes the round itself, the blast takes the rest.
        const out = resolveHit(ctx, owner, tgt, info(e, from));
        if (out === 'hit' && pr.status && !isDead(tgt)) applyStatus(ctx, tgt, pr.status.id, pr.status.stacks, owner.id);
        explode(ctx, e, owner, from, tgt.id);
        if ((pr.pierce ?? 0) > 0) {
          pr.pierce!--;
          (pr.struck ??= []).push(tgt.id);
          continue;
        }
        consumed = true;
        break;
      }
      if (pr.explode) {
        explode(ctx, e, owner, from);
        consumed = true;
        break;
      }
      // A parried Scrap Throw back into its shooter: a fixed share of its health, and a stagger.
      const bonus = pr.reflected && pr.reflectBonus?.shooter === tgt.id ? pr.reflectBonus : null;
      const hit = info(e, from);
      if (bonus?.hpFrac) hit.fixedDamage = tgt.vitals!.hpMax * bonus.hpFrac;
      // The Edge Warden's fire: a share of the health bar, and its burn can't be guarded.
      if (pr.hpFrac && !pr.reflected) hit.fixedDamage = tgt.vitals!.hpMax * pr.hpFrac;
      if (pr.unstoppable) hit.unblockable = true;
      // A reflected fireball breaks the Drake's stance (expansion plan §3.5).
      if (bonus?.poiseFrac) hit.poise = tgt.combat.poiseMax * bonus.poiseFrac;
      const out = resolveHit(ctx, owner, tgt, hit);
      if (out === 'hit' && bonus && bonus.stagger > 0 && !isDead(tgt)) {
        tgt.combat.action = { kind: 'stagger', t: 0, dur: bonus.stagger };
        ctx.events.push({ type: 'stagger', entity: tgt.id, ticks: bonus.stagger });
      }
      if (out === 'hit' && bonus && e.view.model === 'burn_glob') ctx.events.push({ type: 'cue', cue: 'sizzle', entity: tgt.id, pos: { ...tgt.tf.pos } });
      if (out === 'hit' && bonus && tgt.brain && ENEMIES[tgt.brain.def]?.drake) ctx.events.push({ type: 'cue', cue: 'crack', entity: tgt.id });
      if (pr.reflected && isDead(tgt)) {
        const def = tgt.brain ? ENEMIES[tgt.brain.def] : undefined;
        if (def?.id === 'slinger' || def?.tags?.includes('slinger')) ctx.events.push({ type: 'cue', cue: 'coinRing', entity: tgt.id });
      }
      if (out === 'dodged') continue; // flies on through the roll
      if (out === 'parried') {
        reflect(e, tgt, ctx);
        reflected = true;
        break;
      }
      if (out === 'hit' && pr.status && !isDead(tgt)) applyStatus(ctx, tgt, pr.status.id, pr.status.stacks, owner.id);
      if (out === 'hit' && pr.spell === 'staticSnare') snareHit(ctx, tgt, owner.id);
      consumed = true;
      break;
    }

    if (reflected) continue; // turned round at the parry: it starts its way back next tick
    if (!consumed && wall && wall.distance <= segLen) {
      if ((pr.bounces ?? 0) > 0) {
        // Off the surface, with most of its speed, from just clear of it.
        pr.bounces!--;
        const n = wall.normal, v = e.tf.vel;
        const into = v.x * n.x + v.y * n.y + v.z * n.z;
        e.tf.vel = { x: (v.x - 2 * into * n.x) * BOUNCE_KEEP, y: (v.y - 2 * into * n.y) * BOUNCE_KEEP, z: (v.z - 2 * into * n.z) * BOUNCE_KEEP };
        e.tf.pos = { x: wall.point.x + n.x * pr.radius, y: wall.point.y + n.y * pr.radius, z: wall.point.z + n.z * pr.radius };
        if (--pr.life <= 0) {
          if (pr.explode) explode(ctx, e, ctx.get(pr.owner) ?? e, e.tf.pos);
          dead.push(e.id);
        }
        continue;
      }
      if (pr.explode) explode(ctx, e, ctx.get(pr.owner) ?? e, from);
      consumed = true;
    }
    if (consumed) {
      dead.push(e.id);
      continue;
    }
    e.tf.pos = to;
    if (--pr.life <= 0) {
      if (pr.explode) explode(ctx, e, ctx.get(pr.owner) ?? e, to);
      dead.push(e.id);
    }
  }
  return dead;
}

function info(e: Entity, from: Vec3): HitInfo {
  const pr = e.projectile!;
  return {
    move: pr.spell ?? 'projectile', base: pr.damage, kind: pr.kind, poise: pr.poise, hitstun: pr.knockdown ? 45 : 18, knockdown: !!pr.knockdown,
    pushback: pr.knockdown ? 1.5 : 0.4, hitstop: pr.spell ? 0 : 3, unblockable: !!pr.spell, heavy: !!pr.explode, crit: false, mana: 0, from, projectile: true,
    reflected: pr.reflected, sourceMove: pr.sourceMove,
  };
}

/** Blast: everyone of the other team within the radius takes the hit and the status. */
function explode(ctx: CombatCtx, e: Entity, owner: Entity, at: Vec3, struck?: number): void {
  const pr = e.projectile!;
  const radius = pr.explode!;
  // A gun round's own shooter, caught in the blast, takes a share of it.
  const self = pr.splash?.selfMult ?? 0;
  if (self > 0 && owner !== e && owner.combat && owner.body && owner.combat.action?.kind !== 'dead'
    && flatDist(at, owner.tf.pos) <= radius + owner.body.radius && Math.abs(owner.tf.pos.y - at.y) <= radius + owner.body.height) {
    const near = Math.max(0, flatDist(at, owner.tf.pos) - owner.body.radius) / radius;
    const base = pr.splash!.damage * (1 - (1 - pr.splash!.minFalloff) * Math.min(1, near)) * self;
    resolveHit(ctx, e, owner, { ...info(e, at), from: at, base, fixedDamage: Math.max(1, Math.round(base)), unblockable: true });
  }
  ctx.events.push({ type: 'explode', entity: owner.id, spell: pr.spell ?? null, pos: { ...at }, radius });
  for (const tgt of ctx.entities) {
    if (!tgt.combat || !tgt.body || tgt.combat.team === pr.team || tgt.combat.action?.kind === 'dead') continue;
    if (flatDist(at, tgt.tf.pos) > radius + tgt.body.radius || Math.abs(tgt.tf.pos.y - at.y) > radius + tgt.body.height) continue;
    if (tgt.id === struck) continue;
    const hit = { ...info(e, at), from: at };
    if (pr.splash) {
      const near = Math.max(0, flatDist(at, tgt.tf.pos) - tgt.body.radius) / radius;
      hit.base = pr.splash.damage * (1 - (1 - pr.splash.minFalloff) * Math.min(1, near));
    }
    const out = resolveHit(ctx, owner, tgt, hit);
    if (out === 'hit' && pr.status && !isDead(tgt)) applyStatus(ctx, tgt, pr.status.id, pr.status.stacks, owner.id);
  }
}

/** Turn a homing projectile's velocity toward its target's chest by at most homing·DT radians. */
function steer(e: Entity, target: Entity | undefined): void {
  const pr = e.projectile!;
  // Reflected shots fly straight, unless they were made to chase a flier home.
  if (!target?.body || target.combat?.action?.kind === 'dead' || (pr.reflected && !pr.reflectBonus?.homing)) return;
  const v = e.tf.vel;
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 1e-6) return;
  const aim = { x: target.tf.pos.x - e.tf.pos.x, y: target.tf.pos.y + target.body.height * 0.55 - e.tf.pos.y, z: target.tf.pos.z - e.tf.pos.z };
  const al = Math.hypot(aim.x, aim.y, aim.z);
  if (al < 1e-6) return;
  const cur = { x: v.x / speed, y: v.y / speed, z: v.z / speed };
  const want = { x: aim.x / al, y: aim.y / al, z: aim.z / al };
  const dot = Math.max(-1, Math.min(1, cur.x * want.x + cur.y * want.y + cur.z * want.z));
  const ang = Math.acos(dot);
  const max = pr.homing! * DT;
  const t = ang <= max || ang < 1e-6 ? 1 : max / ang;
  const nx = cur.x + (want.x - cur.x) * t, ny = cur.y + (want.y - cur.y) * t, nz = cur.z + (want.z - cur.z) * t;
  const nl = Math.hypot(nx, ny, nz) || 1;
  e.tf.vel = { x: (nx / nl) * speed, y: (ny / nl) * speed, z: (nz / nl) * speed };
}

export function reflect(e: Entity, parrier: Entity, ctx: CombatCtx): void {
  const pr = e.projectile!;
  const shooter = ctx.get(pr.owner);
  const speed = Math.hypot(e.tf.vel.x, e.tf.vel.y, e.tf.vel.z) * BLOCK.reflect;
  const aim: Vec3 = shooter?.body
    ? { x: shooter.tf.pos.x, y: shooter.tf.pos.y + shooter.body.height * 0.55, z: shooter.tf.pos.z }
    : { x: e.tf.pos.x - e.tf.vel.x, y: e.tf.pos.y, z: e.tf.pos.z - e.tf.vel.z };
  const d = { x: aim.x - e.tf.pos.x, y: aim.y - e.tf.pos.y, z: aim.z - e.tf.pos.z };
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  e.tf.vel = { x: (d.x / len) * speed, y: (d.y / len) * speed, z: (d.z / len) * speed };
  pr.team = parrier.combat!.team;
  pr.owner = parrier.id;
  pr.damage *= BLOCK.reflect;
  pr.reflected = true;
  // A reflected hex flies straight back; a fireball sent back at the Drake chases it through the air.
  pr.homing = pr.reflectBonus?.homing;
  if (pr.homing && shooter) pr.target = shooter.id;
  pr.life = Math.max(pr.life, Math.ceil(len / (speed * DT)) + (pr.homing ? 90 : 30));
}
