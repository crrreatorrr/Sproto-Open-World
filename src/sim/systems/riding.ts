import { MOUNT } from '../../content/mounts';
import { DT, MOVE } from '../../content/tuning';
import type { CombatCtx } from '../combat/playerCombat';
import { BTN, type InputCommand } from '../commands';
import type { Entity } from '../entity';
import type { SimEvent } from '../events';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { approach, clamp, turnToward, wrapAngle, type Vec3 } from '../math';

/** Stick travel that counts as asking the bull to move. */
const STICK_MOVING = 0.1;

/**
 * Riding the Pepe Bull. The rider keeps their own capsule, so collisions, hits and lock-on work as
 * they do on foot; the bull has no body and follows the rider. Getting on and off are combat actions
 * (`mounting`), so a hit interrupts them like any other action.
 */
export function startMount(events: SimEvent[], rider: Entity, bull: Entity): void {
  if (rider.riding || rider.combat?.action || !bull.mount || bull.mount.rider !== null) return;
  bull.mount.rider = rider.id;
  if (bull.mount.call && !bull.mount.call.grounded) bull.settle = true;
  delete bull.mount.call;
  bull.mount.speed = 0;
  rider.riding = { mount: bull.id, state: 'mounting', dir: { x: 0, z: 0 }, gallop: false, holdSpent: false };
  rider.combat!.action = { kind: 'mounting', t: 0, dur: MOUNT.mountTicks };
  events.push({ type: 'mount', entity: rider.id, mount: bull.id, phase: 'start' });
}

export function startDismount(events: SimEvent[], rider: Entity, bull: Entity): void {
  const r = rider.riding;
  if (r?.state !== 'riding' || r.flight || rider.combat?.action) return;
  r.state = 'dismounting';
  r.gallop = false;
  // Off to the bull's left.
  r.dir = { x: -Math.cos(rider.tf.yaw), z: Math.sin(rider.tf.yaw) };
  bull.mount!.rider = null;
  bull.mount!.speed = 0;
  rider.combat!.action = { kind: 'mounting', t: 0, dur: MOUNT.dismountTicks };
  events.push({ type: 'mount', entity: rider.id, mount: bull.id, phase: 'dismount' });
}

function release(rider: Entity, bull: Entity | undefined): void {
  if (bull?.mount?.rider === rider.id) {
    bull.mount.rider = null;
    bull.mount.speed = 0;
  }
  delete rider.riding;
}

/** Called off mid-climb (a teleport): otherwise the rider would be pulled all the way back to the bull. */
export function cancelMount(rider: Entity, bull: Entity | undefined): void {
  if (rider.riding?.state !== 'mounting') return;
  if (rider.combat?.action?.kind === 'mounting') rider.combat.action = null;
  release(rider, bull);
}

/** After the combat system: run getting on and off, and let the bull move through the rider's actions. */
export function ridingMotion(ctx: CombatCtx): void {
  for (const p of ctx.entities) {
    const r = p.riding;
    if (!r) continue;
    const bull = ctx.get(r.mount);
    const a = p.combat?.action;
    if (a?.kind === 'dead') {
      release(p, bull);
      continue;
    }
    if (r.state !== 'riding') {
      // Interrupted (a hit took over the action): a mount is cancelled, a dismount is already off.
      if (a?.kind !== 'mounting') {
        release(p, bull);
        continue;
      }
      if (ctx.frozen.has(p.id)) continue;
      a.t++;
      const left = MOUNT.travelTicks - a.t + 1;
      let vx = 0, vz = 0;
      if (r.state === 'mounting' && bull) {
        if (left > 0) {
          vx = (bull.tf.pos.x - p.tf.pos.x) / (left * DT);
          vz = (bull.tf.pos.z - p.tf.pos.z) / (left * DT);
        }
        p.tf.yaw = turnToward(p.tf.yaw, bull.tf.yaw, MOVE.turnRate * DT);
      } else if (left > 0) {
        const speed = MOUNT.dismountSide / (MOUNT.travelTicks * DT);
        vx = r.dir.x * speed;
        vz = r.dir.z * speed;
      }
      ctx.motion.set(p.id, { vx, vz, inputScale: 0 });
      if (a.t >= a.dur) {
        p.combat!.action = null;
        if (r.state === 'mounting') {
          r.state = 'riding';
          p.tf.pos.y += MOUNT.seatLift;
          ctx.events.push({ type: 'mount', entity: p.id, mount: r.mount, phase: 'seated' });
        } else {
          delete p.riding;
          ctx.events.push({ type: 'mount', entity: p.id, mount: r.mount, phase: 'off' });
        }
      }
      continue;
    }
    if (ctx.frozen.has(p.id)) continue;
    const m = ctx.motion.get(p.id);
    if (!m) continue;
    if (a?.kind !== 'dodge') delete r.carry;
    switch (a?.kind) {
      case undefined:
        // The bull runs where you steer: no strafing sideways when locked on.
        m.faceYaw = undefined;
        break;
      case 'attack':
      case 'cast':
      case 'block':
      case 'drink':
        // Melee and magic from the saddle: the bull keeps moving, turning toward the action.
        ctx.motion.set(p.id, { vx: 0, vz: 0, inputScale: MOUNT.actionMove, faceYaw: m.faceYaw ?? p.tf.yaw });
        break;
      case 'dodge': {
        // The charge adds to the speed the bull already has: a dodge at a gallop swerves, it doesn't stop dead.
        r.carry ??= { x: p.tf.vel.x, z: p.tf.vel.z };
        const had = Math.hypot(r.carry.x, r.carry.z);
        const left = Math.max(0, had - MOUNT.dodgeBrake * DT);
        const keep = had > 1e-6 ? left / had : 0;
        r.carry.x *= keep;
        r.carry.z *= keep;
        const cap = Math.max(Math.hypot(m.vx, m.vz), left) * MOUNT.dodgeScale;
        const vx = m.vx * MOUNT.dodgeScale + r.carry.x, vz = m.vz * MOUNT.dodgeScale + r.carry.z;
        const fit = Math.min(1, cap / Math.max(1e-6, Math.hypot(vx, vz)));
        m.vx = vx * fit;
        m.vz = vz * fit;
        break;
      }
    }
  }
}

/**
 * The sprint button in the saddle: a press starts the gallop and it stays on with nothing held; the
 * next press, or coming to a stop, ends it. Holding the button gallops too, including when the bull
 * sets off again under a held button. Stamina plays no part. Runs even in hit-stop, so no press is lost.
 */
export function gallopInput(rider: Entity, cmd: InputCommand, stick: number): void {
  const r = rider.riding;
  if (r?.state !== 'riding') return;
  const pressed = (cmd.pressed & BTN.sprint) !== 0;
  const held = pressed || (cmd.held & BTN.sprint) !== 0;
  if (!held) r.holdSpent = false;
  const moving = stick >= STICK_MOVING || (rider.loco?.speed ?? 0) >= MOUNT.stopSpeed;
  if (pressed && r.gallop) {
    r.gallop = false;
    r.holdSpent = true;
  } else if (!moving) r.gallop = false;
  else if (held && !r.holdSpent) r.gallop = true;
}

/**
 * The bull's weight, in place of the on-foot acceleration: its speed builds and brakes slowly, and
 * its line bends only as fast as its grip allows, so a turn at a gallop is a wide arc. Steering
 * hard across that line scrubs speed off, which tightens a hairpin. `ground` scales it all in the air.
 */
export function steerBull(vel: { x: number; z: number }, wish: { x: number; z: number; mag: number }, top: number, ground: number): void {
  const speed = Math.hypot(vel.x, vel.z);
  if (wish.mag <= 1e-4) {
    const left = Math.max(0, speed - MOUNT.brake * ground * DT);
    const keep = speed > 1e-6 ? left / speed : 0;
    vel.x *= keep;
    vel.z *= keep;
    return;
  }
  const goal = Math.atan2(wish.x, wish.z);
  const want = wish.mag * top;
  const change = (target: number) => approach(speed, target, (target > speed ? MOUNT.accel : MOUNT.brake) * ground * DT);
  if (speed < MOUNT.pivotSpeed) {
    const next = change(want);
    vel.x = Math.sin(goal) * next;
    vel.z = Math.cos(goal) * next;
    return;
  }
  const line = Math.atan2(vel.x, vel.z);
  const off = wrapAngle(goal - line);
  const bend = ((MOUNT.grip * ground) / speed) * DT;
  const heading = line + clamp(off, -bend, bend);
  const hard = clamp((Math.abs(off) - MOUNT.scrubFrom) / (MOUNT.scrubTo - MOUNT.scrubFrom), 0, 1);
  const next = change(want * (1 - (1 - MOUNT.scrubKeep) * hard));
  vel.x = Math.sin(heading) * next;
  vel.z = Math.cos(heading) * next;
}

/** Less of a step than this share of what the slope alone would allow means something else is in the way. */
const SLOPE_ONLY = 0.9;

/**
 * A slope shortens each step, and a rider's speed is read back from how far they really moved, so a
 * hill would drain the bull's speed faster than it can gather it. Speed lost to the slope alone is
 * handed back; a wall or a rock still stops it. `asked` is the speed it set out at this tick (m/s).
 */
export function holdPaceUphill(vel: { x: number; z: number }, asked: number, moved: Readonly<Vec3>): void {
  const run = Math.hypot(moved.x, moved.z);
  const speed = Math.hypot(vel.x, vel.z);
  if (moved.y <= 0 || run < 1e-6 || speed < 1e-6 || asked <= speed) return;
  const cos = run / Math.hypot(run, moved.y);
  if (Math.hypot(run, moved.y) / DT < asked * cos * SLOPE_ONLY) return;
  vel.x *= asked / speed;
  vel.z *= asked / speed;
}

/** The bull's body follows the line it is running, or the stick when it is standing. */
export function faceBull(tf: Entity['tf'], wish: { x: number; z: number; mag: number }): void {
  const running = Math.hypot(tf.vel.x, tf.vel.z) > 0.5;
  if (!running && wish.mag <= STICK_MOVING) return;
  const to = running ? Math.atan2(tf.vel.x, tf.vel.z) : Math.atan2(wish.x, wish.z);
  tf.yaw = turnToward(tf.yaw, to, MOUNT.yawRate * DT);
}

/** After physics: a ridden bull is where its rider is, and shows their speed. */
export function followRiders(entities: readonly Entity[], get: (id: number) => Entity | undefined): void {
  for (const p of entities) {
    if (p.riding?.state !== 'riding') continue;
    const bull = get(p.riding.mount);
    if (!bull?.mount) continue;
    bull.tf.pos = { ...p.tf.pos };
    bull.tf.yaw = p.tf.yaw;
    bull.mount.speed = p.loco?.speed ?? 0;
    const f = p.riding.flight;
    if (f) bull.mount.fly = { pitch: f.pitch, bank: f.bank };
    else delete bull.mount.fly;
  }
}

/** A surface facing up this much or more is ground the bull runs up, not a wall in front of its nose. */
const NOSE_GROUND_NORMAL = 0.6;

/**
 * Take back the part of a ridden bull's move this tick that would put its nose into a wall. Only
 * the forward part is checked: sideways, and turning, the round collider is what keeps it clear.
 */
export function noseStop(physics: PhysicsWorld, tf: Readonly<Entity['tf']>, want: Vec3): void {
  const fx = Math.sin(tf.yaw), fz = Math.cos(tf.yaw);
  const ahead = want.x * fx + want.z * fz;
  if (ahead <= 1e-6) return;
  const clear = MOUNT.bodyHalfLength - MOUNT.noseRadius;
  const origin = { x: tf.pos.x, y: tf.pos.y + MOUNT.noseHeight, z: tf.pos.z };
  const hit = physics.sphereCastNormal(origin, { x: fx * (clear + ahead), y: 0, z: fz * (clear + ahead) }, MOUNT.noseRadius);
  if (!hit || hit.normal.y >= NOSE_GROUND_NORMAL) return;
  const cut = ahead - Math.max(0, hit.distance - clear);
  if (cut <= 0) return;
  want.x -= fx * cut;
  want.z -= fz * cut;
}

/**
 * Count the rider's jump presses: three in a quick run take the bull up into flight, or, flying,
 * drop it out of the air. Runs every tick in the saddle (in hit-stop too, so no press is lost).
 * The first press on the ground is still an ordinary jump.
 */
export function flightJumps(rider: Entity, cmd: InputCommand, events: SimEvent[]): void {
  const r = rider.riding;
  if (r?.state !== 'riding') return;
  if (r.jumps && --r.jumps.window <= 0) delete r.jumps;
  if ((cmd.pressed & BTN.jump) === 0) return;
  const j = (r.jumps ??= { count: 0, window: 0 });
  j.count++;
  j.window = MOUNT.fly.jumpWindow;
  if (j.count < 3) return;
  delete r.jumps;
  if (r.flight) {
    delete r.flight;
    events.push({ type: 'mountFlight', entity: rider.id, mount: r.mount, phase: 'dropped' });
    return;
  }
  const tf = rider.tf;
  r.flight = { pitch: MOUNT.fly.takeoffPitch, bank: 0, speed: Math.max(Math.hypot(tf.vel.x, tf.vel.z), MOUNT.fly.cruise * 0.75), age: 0 };
  events.push({ type: 'mountFlight', entity: rider.id, mount: r.mount, phase: 'takeoff' });
}

/**
 * One tick of flight, flown like a plane: the stick's forward pushes the nose down and its back
 * lifts it, its sides bank, and a bank turns it; let go and it levels out. The gallop button is the
 * throttle (drag bleeds off speed above it), and a dive trades height for speed. Take-off climbs
 * clear of the ground before the stick has the nose. Touching the ground lands it.
 */
export function flyBull(
  e: Entity,
  cmd: InputCommand,
  physics: PhysicsWorld,
  hasGround: (x: number, z: number) => boolean,
  events: SimEvent[],
): void {
  const r = e.riding!, f = r.flight!, tf = e.tf, loco = e.loco!, F = MOUNT.fly;
  f.age++;
  const sx = clamp(cmd.move.x, -1, 1), sy = clamp(cmd.move.y, -1, 1);
  const climbOut = f.age <= F.takeoffTicks ? F.takeoffPitch : -Infinity;
  f.pitch = approach(f.pitch, Math.max(-sy * F.pitchMax, climbOut), F.pitchRate * DT);
  f.bank = approach(f.bank, sx * F.bankMax, F.bankRate * DT);
  // Banked right, it turns right: the stick's right is the bull's right, which is toward lower yaw.
  tf.yaw = wrapAngle(tf.yaw - f.bank * F.turnPerBank * DT);
  const goal = r.gallop ? F.boost : F.cruise;
  f.speed = approach(f.speed, goal, (f.speed < goal ? F.throttle : F.drag) * DT) - Math.sin(f.pitch) * F.dive * DT;
  f.speed = clamp(f.speed, F.slowest, F.boost * 1.25);
  const flat = Math.cos(f.pitch) * f.speed;
  const want = { x: Math.sin(tf.yaw) * flat * DT, y: Math.sin(f.pitch) * f.speed * DT, z: Math.cos(tf.yaw) * flat * DT };
  if (tf.pos.y + want.y > F.ceiling) want.y = Math.min(want.y, Math.max(0, F.ceiling - tf.pos.y));
  noseStop(physics, tf, want);
  const lead = MOUNT.rideRadius;
  const out = (d: number) => d + Math.sign(d) * lead;
  if (!hasGround(tf.pos.x + out(want.x), tf.pos.z)) want.x = 0;
  if (!hasGround(tf.pos.x + out(want.x), tf.pos.z + out(want.z))) want.z = 0;
  const res = physics.moveCharacter(e.id, tf.pos, want);
  tf.pos.x += res.moved.x;
  tf.pos.y += res.moved.y;
  tf.pos.z += res.moved.z;
  tf.vel = { x: res.moved.x / DT, y: res.moved.y / DT, z: res.moved.z / DT };
  loco.speed = Math.hypot(res.moved.x, res.moved.y, res.moved.z) / DT;
  loco.sprinting = r.gallop;
  loco.jumpBuffer = 0;
  loco.coyote = 0;
  loco.landedTicks = 0;
  loco.grounded = false;
  if (!res.grounded || f.age <= F.takeoffTicks) return;
  // Down on the ground: running again, at the speed it came in with.
  delete r.flight;
  loco.grounded = true;
  loco.landedTicks = 1;
  loco.coyote = MOVE.coyoteTicks;
  const fall = -Math.min(0, tf.vel.y);
  tf.vel.y = 0;
  events.push({ type: 'land', entity: e.id, fallSpeed: fall, pos: { ...tf.pos } });
  events.push({ type: 'mountFlight', entity: e.id, mount: r.mount, phase: 'landed' });
}
