import { EDGE_WARDEN as W } from '../../content/packs/edge';
import { DT } from '../../content/tuning';
import type { WorldBounds } from '../../content/world/format';
import type { Entity, EntityId, Warden } from '../entity';
import type { SimEvent } from '../events';
import { turnToward, type Vec3 } from '../math';
import { next as rngNext, type RngState } from '../rng';
import { inSanctuary, sanctuaries } from './sanctuary';

/** What the world lends the Warden. */
export interface WardenHost {
  spawn(e: Omit<Entity, 'id'>): Entity;
  remove(id: EntityId): void;
  /** No Warden now: a dungeon, the wave runner, or the Skyfire Drake's own fight. */
  busy: boolean;
}

export interface WardenCtx {
  now: number;
  entities: readonly Entity[];
  events: SimEvent[];
  get(id: EntityId): Entity | undefined;
  frozen: ReadonlySet<EntityId>;
}

/** Turn rate (rad/s) of its heading. */
const TURN = 5;
/** Off its circle it flies this much faster per metre it is behind (1/s), up to this many times its dash. */
const CATCH_UP = 5;
const CATCH_UP_MAX = 1.3;
/** Leaving, it climbs this fast (m/s). */
const LEAVE_CLIMB = 14;

const inside = (b: WorldBounds, x: number, z: number): number => Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);

/**
 * How close a body is to the edge of the world (m): the nearer of where it is and where its speed
 * takes it in `lookTicks`, so something flying out fast is met early. Infinity outside the rectangle
 * (the Rootdeep is far to the east of it).
 */
export function edgeDistance(b: WorldBounds, pos: Vec3, vel: Vec3): number {
  const here = inside(b, pos.x, pos.z);
  if (here < 0) return Infinity;
  const ahead = W.lookTicks * DT;
  return Math.min(here, Math.max(0, inside(b, pos.x + vel.x * ahead, pos.z + vel.z * ahead)));
}

/** The point on the edge nearest to (x, z), and the way out of the world from there. */
function nearestEdge(b: WorldBounds, x: number, z: number): { x: number; z: number; nx: number; nz: number } {
  const d = [x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z];
  const i = d.indexOf(Math.min(...d));
  if (i === 0) return { x: b.minX, z, nx: -1, nz: 0 };
  if (i === 1) return { x: b.maxX, z, nx: 1, nz: 0 };
  if (i === 2) return { x, z: b.minZ, nx: 0, nz: -1 };
  return { x, z: b.maxZ, nx: 0, nz: 1 };
}

const alive = (e: Entity | undefined): e is Entity => !!e && e.combat?.action?.kind !== 'dead';

function move(e: Entity, x: number, y: number, z: number): void {
  const p = e.tf.pos;
  e.tf.vel = { x: (x - p.x) / DT, y: (y - p.y) / DT, z: (z - p.z) / DT };
  p.x = x;
  p.y = y;
  p.z = z;
}

function mouth(e: Entity): Vec3 {
  return { x: e.tf.pos.x + Math.sin(e.tf.yaw) * W.mouth.fwd, y: e.tf.pos.y + W.mouth.up, z: e.tf.pos.z + Math.cos(e.tf.yaw) * W.mouth.fwd };
}

/** Fire from its mouth at where the target will be. `spread` (radians) scatters the barrage. */
function fire(host: WardenHost, e: Entity, target: Entity, shot: typeof W.fireball | typeof W.burn, rng: RngState): void {
  const from = mouth(e);
  const chest = { x: target.tf.pos.x, y: target.tf.pos.y + (target.body?.height ?? 1.8) * 0.55, z: target.tf.pos.z };
  let aim = chest;
  // Two passes of "how long will it fly" are enough to lead a bull at full speed.
  for (let i = 0; i < 2; i++) {
    const t = Math.hypot(aim.x - from.x, aim.y - from.y, aim.z - from.z) / shot.speed;
    aim = { x: chest.x + target.tf.vel.x * t, y: chest.y + target.tf.vel.y * t, z: chest.z + target.tf.vel.z * t };
  }
  let d = { x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z };
  const burn = 'homing' in shot;
  if (!burn) {
    const a = (rngNext(rng) - 0.5) * 2 * shot.spread;
    const c = Math.cos(a), s = Math.sin(a);
    d = { x: d.x * c + d.z * s, y: d.y + (rngNext(rng) - 0.5) * 2 * shot.spread * Math.hypot(d.x, d.z), z: -d.x * s + d.z * c };
  }
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  // The world announces the shot (its `fire` event) as it does a spell's.
  host.spawn({
    kind: 'projectile',
    tf: { pos: from, prevPos: { ...from }, yaw: e.tf.yaw, prevYaw: e.tf.yaw, vel: { x: (d.x / len) * shot.speed, y: (d.y / len) * shot.speed, z: (d.z / len) * shot.speed } },
    projectile: {
      owner: e.id, team: 'enemy', kind: 'arcane', damage: 1, poise: shot.poise, radius: shot.radius,
      life: Math.ceil(shot.range / (shot.speed * DT)), reflected: false, hpFrac: shot.hpFrac,
      ...(burn ? { unstoppable: true as const, knockdown: true, homing: shot.homing, target: target.id } : {}),
    },
    view: { model: 'fireball' },
  });
}

/** Its circle over the player: it keeps up with anything, a bull in a dive included. */
function circle(e: Entity, s: Warden, target: Entity, facing: boolean): void {
  s.angle += (s.dir * W.cruise * DT) / W.orbitRadius;
  const t = target.tf.pos, p = e.tf.pos;
  const x = t.x + Math.sin(s.angle) * W.orbitRadius, y = t.y + W.height, z = t.z + Math.cos(s.angle) * W.orbitRadius;
  const dx = x - p.x, dy = y - p.y, dz = z - p.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > 1e-6) {
    const step = Math.min(d, Math.min(W.dash * CATCH_UP_MAX, W.cruise + d * CATCH_UP) * DT);
    move(e, p.x + (dx / d) * step, p.y + (dy / d) * step, p.z + (dz / d) * step);
  } else move(e, x, y, z);
  // Firing, it looks at the player; otherwise along its flight.
  const want = facing ? Math.atan2(t.x - p.x, t.z - p.z) : Math.atan2(e.tf.vel.x, e.tf.vel.z);
  e.tf.yaw = turnToward(e.tf.yaw, want, TURN * DT);
}

function leave(ctx: WardenCtx, e: Entity, s: Warden): void {
  if (s.mode === 'leave') return;
  s.mode = 'leave';
  s.t = 0;
  s.burning = -1;
  ctx.events.push({ type: 'edgeWarden', entity: s.target, warden: e.id, phase: 'leave' });
}

/**
 * The Edge Warden (far-view plan §3.10, tuning in `content/packs/edge.ts`). A player who nears the
 * edge of the world brings one in from beyond it. It circles through a short grace, then fires a
 * barrage without stopping and, every few seconds, a burn that takes a whole health bar. It leaves
 * when the player turns back inland. It is a wall with wings: no health, no body, nothing to hit.
 * All of its state is plain data on `entity.warden`, so snapshots and the hash carry it.
 */
export function edgeWardens(ctx: WardenCtx, bounds: WorldBounds | undefined, rng: RngState, host: WardenHost): void {
  const wardens = ctx.entities.filter((e) => e.warden);
  if (!bounds && !wardens.length) return;
  const safe = sanctuaries(ctx.entities);
  const gone: EntityId[] = [];
  const guarded = new Set<EntityId>();

  for (const e of wardens) {
    const s = e.warden!;
    guarded.add(s.target);
    if (ctx.frozen.has(e.id)) continue;
    const found = ctx.get(s.target);
    const target = alive(found) ? found : null;
    const near = target && bounds ? edgeDistance(bounds, target.tf.pos, target.tf.vel) : Infinity;
    if (!target || near > W.leave || host.busy) leave(ctx, e, s);

    if (s.mode === 'leave') {
      // Out past the nearest edge, climbing, and gone.
      const out = bounds ? nearestEdge(bounds, e.tf.pos.x, e.tf.pos.z) : { nx: 1, nz: 0 };
      const p = e.tf.pos;
      move(e, p.x + out.nx * W.dash * DT, p.y + LEAVE_CLIMB * DT, p.z + out.nz * W.dash * DT);
      e.tf.yaw = turnToward(e.tf.yaw, Math.atan2(out.nx, out.nz), TURN * DT);
      if (++s.t >= W.leaveTicks) gone.push(e.id);
      continue;
    }
    if (!target) continue;

    s.t++;
    // It never fires through the grace, at someone talking, or onto a shrine's ground.
    const open = s.t > W.graceTicks && near <= W.strike && !target.progress?.dialogue && !inSanctuary(target.tf.pos, safe);
    if (open && s.mode === 'watch') {
      s.mode = 'strike';
      s.volley = 0;
      s.burn = W.burnEvery;
      s.burning = -1;
      ctx.events.push({ type: 'edgeWarden', entity: target.id, warden: e.id, phase: 'strike' });
    } else if (!open && s.mode === 'strike') {
      s.mode = 'watch';
      s.burning = -1;
    }
    circle(e, s, target, s.mode === 'strike');
    if (s.mode !== 'strike') continue;

    if (s.burning >= 0) {
      // The burn's warning: the barrage stops, so the one shot that matters is easy to read.
      if (++s.burning >= W.burnTelegraph) {
        s.burning = -1;
        s.burn = W.burnEvery;
        s.volley = W.volleyEvery;
        fire(host, e, target, W.burn, rng);
      }
      continue;
    }
    if (--s.burn <= 0) {
      s.burning = 0;
      ctx.events.push({ type: 'edgeWarden', entity: target.id, warden: e.id, phase: 'burn' });
      continue;
    }
    if (--s.volley <= 0) {
      s.volley = W.volleyEvery;
      fire(host, e, target, W.fireball, rng);
    }
  }
  for (const id of gone) host.remove(id);

  if (!bounds || host.busy) return;
  let count = wardens.length - gone.length;
  for (const p of ctx.entities) {
    if (count >= W.max) break;
    if (p.kind !== 'player' || guarded.has(p.id) || !alive(p)) continue;
    if (edgeDistance(bounds, p.tf.pos, p.tf.vel) > W.warn) continue;
    // In from beyond the nearest edge, high up, already heading for them.
    const edge = nearestEdge(bounds, p.tf.pos.x, p.tf.pos.z);
    const pos = { x: edge.x + edge.nx * W.arrive.out, y: p.tf.pos.y + W.arrive.up, z: edge.z + edge.nz * W.arrive.out };
    const yaw = Math.atan2(-edge.nx, -edge.nz);
    const angle = Math.atan2(pos.x - p.tf.pos.x, pos.z - p.tf.pos.z);
    const e = host.spawn({
      kind: 'warden',
      tf: { pos, prevPos: { ...pos }, yaw, prevYaw: yaw, vel: { x: 0, y: 0, z: 0 } },
      warden: { target: p.id, mode: 'watch', t: 0, angle, dir: rngNext(rng) < 0.5 ? -1 : 1, volley: 0, burn: W.burnEvery, burning: -1 },
      view: { model: 'edge_warden', scale: W.scale },
    });
    count++;
    ctx.events.push({ type: 'edgeWarden', entity: p.id, warden: e.id, phase: 'appear' });
    ctx.events.push({ type: 'cue', cue: 'roar', entity: e.id, pos: { ...p.tf.pos } });
  }
}
