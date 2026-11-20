import { MOUNT } from '../../content/mounts';
import { isRootdeep } from '../../content/packs/rootdeep';
import { DT, KCC, MOVE } from '../../content/tuning';
import { flatDist, yawTo } from '../combat/geometry';
import { BTN, type CommandMap } from '../commands';
import type { Body, Entity, EntityId } from '../entity';
import type { SimEvent } from '../events';
import { approach, turnToward, type Vec3 } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/** The capsule a called bull runs on. */
export const MOUNT_RUNNER: Body = { radius: MOUNT.callRadius, height: MOUNT.bodyHeight };

/** How far ahead it looks for something to go round (m), and the bearings it tries (radians). */
const LOOK_AHEAD = 5;
const DETOURS = [0.5, 1, 1.5];
/** Chest height of a looking bull (m). A hit facing up this much is ground, not an obstacle. */
const CHEST = 0.9;
const GROUND_NORMAL = 0.6;
/** Where it can appear: bearings off straight behind the camera (radians), and how far from the caller's height (m). */
const BEHIND = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2];
const APPEAR_CLIMB = 8;
const RAY_FROM = 30;
/** It has only arrived within this height of the caller: as far as the ride prompt reaches (m). */
const LEVEL_WITH = 2.5;
/** Reaching the caller without having landed, it keeps walking at this speed to get off the ledge (m/s). */
const FIND_THE_WAY_DOWN = 3;
/** Nearer the caller than this, it is on top of them (m): its capsule's radius and a person's half-width, 1.2 m on the hub-sized bull. */
const TOO_CLOSE = MOUNT.callRadius + 0.6;
/** Its feet are on the ground if the ground under its middle is this close (m): its capsule can wedge against a cliff above it. */
const FEET_ON_GROUND = 0.35;
/** How far apart it checks the ground on the way in (m), and the most that ground may rise over that distance. */
const RUN_IN_STEP = 3;
const RUN_IN_RISE = RUN_IN_STEP * Math.tan((KCC.maxSlopeDeg * Math.PI) / 180);

type Ground = (x: number, z: number) => boolean;

/** Is the way clear in this direction? Ground rising ahead doesn't count; starting inside its own body doesn't either. */
function clear(physics: PhysicsWorld, from: Readonly<Vec3>, yaw: number, dist: number): boolean {
  const hit = physics.raycast({ x: from.x, y: from.y + CHEST, z: from.z }, { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, dist);
  return !hit || hit.distance < 0.01 || hit.normal.y > GROUND_NORMAL;
}

/** Straight at the caller if it can, otherwise round whatever is in the way, keeping to the side it chose. */
function steer(physics: PhysicsWorld, bull: Entity, to: number): number {
  const call = bull.mount!.call!;
  if (clear(physics, bull.tf.pos, to, LOOK_AHEAD)) return to;
  for (const off of DETOURS) {
    for (const side of [call.side, -call.side]) {
      if (!clear(physics, bull.tf.pos, to + off * side, LOOK_AHEAD)) continue;
      call.side = side;
      return to + off * side;
    }
  }
  return to;
}

/** The ground from here to the caller is loaded and has no cliff to climb. */
function canRunIn(physics: PhysicsWorld, from: Readonly<Vec3>, to: Readonly<Vec3>, ground: Ground): boolean {
  const steps = Math.ceil(flatDist(from, to) / RUN_IN_STEP);
  let last = from.y;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps, z = from.z + ((to.z - from.z) * i) / steps;
    if (!ground(x, z)) return false;
    const hit = physics.raycast({ x, y: Math.max(from.y, to.y) + RAY_FROM, z }, { x: 0, y: -1, z: 0 }, RAY_FROM * 2);
    if (!hit || hit.point.y - last > RUN_IN_RISE) return false;
    last = hit.point.y;
  }
  return true;
}

/** A place near the caller and behind their camera: loaded, level enough, empty, and with a clear run in. */
function arrivalSpot(physics: PhysicsWorld, caller: Entity, camYaw: number, ground: Ground): Vec3 | null {
  const c = caller.tf.pos;
  for (const r of MOUNT.callAppear) {
    for (const off of BEHIND) {
      const bearing = camYaw + Math.PI + off;
      const x = c.x + Math.sin(bearing) * r, z = c.z + Math.cos(bearing) * r;
      if (!ground(x, z)) continue;
      const hit = physics.raycast({ x, y: c.y + RAY_FROM, z }, { x: 0, y: -1, z: 0 }, RAY_FROM * 2);
      if (!hit || hit.normal.y < GROUND_NORMAL || Math.abs(hit.point.y - c.y) > APPEAR_CLIMB) continue;
      // Terrain is a skin with nothing under it: anything solid here is the roof of a prop.
      if (physics.raycast({ x, y: hit.point.y - 0.2, z }, { x: 0, y: -1, z: 0 }, RAY_FROM)) continue;
      if (!physics.spotFree(hit.point, MOUNT_RUNNER)) continue;
      const run = { x: c.x - x, y: c.y - hit.point.y, z: c.z - z };
      const chest = { x, y: hit.point.y + CHEST, z };
      const seen = physics.raycast(chest, run, Math.hypot(run.x, run.y, run.z));
      if (seen && seen.normal.y <= GROUND_NORMAL) continue;
      if (!canRunIn(physics, { x, y: hit.point.y, z }, c, ground)) continue;
      return { x, y: hit.point.y, z };
    }
  }
  return null;
}

/** Is there ground right under its feet? */
function feetDown(physics: PhysicsWorld, at: Readonly<Vec3>): boolean {
  const from = 0.5;
  const hit = physics.raycast({ x: at.x, y: at.y + from, z: at.z }, { x: 0, y: -1, z: 0 }, from + FEET_ON_GROUND);
  return hit !== null;
}

/** Stop the run. A bull in the air is set down on the ground, since nothing moves it once the call is over. */
function endCall(bull: Entity): void {
  if (bull.mount!.call && !bull.mount!.call.grounded) bull.settle = true;
  delete bull.mount!.call;
  bull.mount!.speed = 0;
}

/** Put the bull down near the caller to run the rest of the way, or say it can't reach them. */
function appear(bull: Entity, caller: Entity, camYaw: number, physics: PhysicsWorld, events: SimEvent[], ground: Ground): void {
  const spot = arrivalSpot(physics, caller, camYaw, ground);
  if (!spot) {
    endCall(bull);
    events.push({ type: 'mountCall', entity: caller.id, mount: bull.id, phase: 'failed' });
    return;
  }
  const call = bull.mount!.call!;
  bull.tf.pos = { ...spot };
  bull.tf.prevPos = { ...spot };
  bull.tf.yaw = bull.tf.prevYaw = yawTo(spot, caller.tf.pos);
  delete bull.settle;
  Object.assign(call, { speed: MOUNT.trotSpeed, fall: 0, grounded: false, closest: flatDist(spot, caller.tf.pos), stuck: 0, appeared: true });
  events.push({ type: 'mountCall', entity: caller.id, mount: bull.id, phase: 'appeared' });
}

function answer(caller: Entity, bull: Entity, camYaw: number, physics: PhysicsWorld, events: SimEvent[], ground: Ground): void {
  const m = bull.mount!;
  if (m.call || m.rider !== null) return;
  // Past 80 m the bull appears beside the caller. In the cave that spot is the floor, so a call
  // from the Rootdeep is refused and the bull stays at its surface home.
  if (isRootdeep(caller.tf.pos.x)) {
    events.push({ type: 'mountCall', entity: caller.id, mount: bull.id, phase: 'failed' });
    return;
  }
  const d = flatDist(bull.tf.pos, caller.tf.pos);
  if (!bull.settle && d <= MOUNT.callStop && Math.abs(bull.tf.pos.y - caller.tf.pos.y) <= LEVEL_WITH) return;
  m.call = { caller: caller.id, speed: 0, fall: 0, grounded: false, closest: d, stuck: 0, side: 1, appeared: false };
  // A bull still waiting to be set down is somewhere that hasn't loaded: it can't run from there.
  if (bull.settle || d > MOUNT.callRange || !ground(bull.tf.pos.x, bull.tf.pos.z)) appear(bull, caller, camYaw, physics, events, ground);
  else events.push({ type: 'mountCall', entity: caller.id, mount: bull.id, phase: 'coming' });
}

function run(bull: Entity, caller: Entity, camYaw: number, physics: PhysicsWorld, events: SimEvent[], ground: Ground): void {
  const m = bull.mount!, call = m.call!, tf = bull.tf;
  const d = flatDist(tf.pos, caller.tf.pos);
  const to = yawTo(tf.pos, caller.tf.pos);
  const near = d <= MOUNT.callStop;
  if (near && call.grounded && Math.abs(tf.pos.y - caller.tf.pos.y) <= LEVEL_WITH && feetDown(physics, tf.pos)) {
    endCall(bull);
    tf.yaw = to;
    events.push({ type: 'mountCall', entity: caller.id, mount: bull.id, phase: 'arrived' });
    return;
  }
  if (d < call.closest - MOUNT.callProgress) {
    call.closest = d;
    call.stuck = 0;
  } else if (d > call.closest) call.closest = Math.min(d, call.closest + MOVE.sprintSpeed * DT); // A caller running off isn't the bull failing.
  // The caller has gone far away, or it has stopped getting closer: it can't run this.
  // The ground under it has unloaded too: it can't take another step from here.
  if (d > MOUNT.callRange || !ground(tf.pos.x, tf.pos.z) || ++call.stuck > MOUNT.callStuckTicks) {
    if (call.appeared && d <= MOUNT.callRange) {
      endCall(bull);
      events.push({ type: 'mountCall', entity: caller.id, mount: bull.id, phase: 'failed' });
    } else appear(bull, caller, camYaw, physics, events, ground);
    return;
  }
  // Standing on the caller's head is no arrival: it steps off them.
  const heading = d < TOO_CLOSE ? to + Math.PI : steer(physics, bull, to);
  const top = d > MOUNT.callTrotWithin ? MOUNT.gallopSpeed : MOUNT.trotSpeed;
  // In the air beside the caller it just drops; wedged on a ledge, it walks clear.
  const want = near ? (call.grounded ? FIND_THE_WAY_DOWN : 0) : Math.min(top, Math.sqrt(2 * MOUNT.brake * (d - MOUNT.callStop)));
  call.speed = approach(call.speed, want, (want > call.speed ? MOUNT.accel : MOUNT.brake) * DT);
  const step = { x: Math.sin(heading) * call.speed * DT, y: -call.fall * DT, z: Math.cos(heading) * call.speed * DT };
  if (!ground(tf.pos.x + step.x, tf.pos.z)) step.x = 0;
  if (!ground(tf.pos.x + step.x, tf.pos.z + step.z)) step.z = 0;
  const res = physics.moveMount(bull.id, tf.pos, step);
  tf.pos.x += res.moved.x;
  tf.pos.y += res.moved.y;
  tf.pos.z += res.moved.z;
  call.grounded = res.grounded;
  call.fall = res.grounded ? 0 : Math.min(MOVE.maxFall, call.fall + MOVE.gravity * DT);
  m.speed = Math.hypot(res.moved.x, Math.max(0, res.moved.y), res.moved.z) / DT;
  tf.yaw = turnToward(tf.yaw, heading, MOUNT.yawRate * DT);
}

/**
 * Calling the Pepe Bull. A press sends it running to the caller over the ground; if it is too far
 * away or can't get through, it appears behind their camera a short way off and runs in from there.
 */
export function mountCalls(
  entities: readonly Entity[],
  commands: CommandMap,
  physics: PhysicsWorld,
  events: SimEvent[],
  get: (id: EntityId) => Entity | undefined,
  ground: Ground,
): void {
  const camYaw = (p: Entity) => (p.owner !== undefined ? commands.get(p.owner)?.camYaw : undefined) ?? p.tf.yaw;
  const dead = (p: Entity) => p.combat?.action?.kind === 'dead';
  for (const p of entities) {
    if (p.owner === undefined || !((commands.get(p.owner)?.pressed ?? 0) & BTN.callMount) || p.riding || dead(p)) continue;
    const bull = entities.find((e) => e.mount);
    if (bull) answer(p, bull, camYaw(p), physics, events, ground);
  }
  for (const bull of entities) {
    const call = bull.mount?.call;
    if (!call) continue;
    const caller = get(call.caller);
    if (!caller || dead(caller) || caller.riding) endCall(bull);
    else run(bull, caller, camYaw(caller), physics, events, ground);
  }
}
