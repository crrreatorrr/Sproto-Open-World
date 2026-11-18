import { MOUNT } from '../../content/mounts';
import { DT, MOVE } from '../../content/tuning';
import { BTN, idleInput, type CommandMap } from '../commands';
import type { Motion } from '../combat/playerCombat';
import { wishDir } from '../combat/playerCombat';
import type { Entity } from '../entity';
import type { SimEvent } from '../events';
import { turnToward } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { faceBull, gallopInput, steerBull } from './riding';

const JUMP_SPEED = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);

/**
 * Moves every character through Rapier's character controller. Free players steer with their
 * command (camera-relative, acceleration, sprint, jump with buffer and coyote time); an action or
 * a brain sets `motion` instead (roll, lunge, enemy walking). Pushback adds on top. Entities in
 * hit-stop don't move at all.
 */
export function locomotion(
  entities: Entity[],
  commands: CommandMap,
  physics: PhysicsWorld,
  events: SimEvent[],
  motion: ReadonlyMap<number, Motion>,
  frozen: ReadonlySet<number>,
  hasGround: (x: number, z: number) => boolean = () => true,
): void {
  for (const e of entities) {
    const loco = e.loco;
    if (!loco) continue;
    const tf = e.tf;
    const isPlayer = e.owner !== undefined;
    const cmd = isPlayer ? (commands.get(e.owner!) ?? idleInput(tf.yaw)) : idleInput(tf.yaw);
    if (e.riding) gallopInput(e, cmd, wishDir(cmd).mag);
    if (frozen.has(e.id)) continue;
    const m = motion.get(e.id);
    const steer = isPlayer ? (m ? m.inputScale : 1) : 0;

    if (steer > 0) {
      const w = wishDir(cmd);
      const free = steer >= 1;
      const sprintHeld = (cmd.held & BTN.sprint) !== 0;
      const canSprint = free && sprintHeld && w.mag >= MOVE.sprintMinStick && (loco.grounded || loco.sprinting) && (e.vitals ? e.vitals.stamina > 0 : true);
      const riding = e.riding?.state === 'riding';
      // The bull does the running: its gallop is the rider's toggle, whatever their stamina.
      loco.sprinting = riding ? e.riding!.gallop && w.mag >= MOVE.sprintMinStick : canSprint;
      const ground = loco.grounded ? 1 : MOVE.airControl;
      if (riding) {
        steerBull(tf.vel, w, (loco.sprinting ? MOUNT.gallopSpeed : MOUNT.trotSpeed) * steer, ground);
      } else {
        const top = (loco.sprinting ? MOVE.sprintSpeed : MOVE.runSpeed) * steer;
        const tx = w.x * top, tz = w.z * top;
        const rate = (w.mag > 1e-4 ? MOVE.accel : MOVE.decel) * ground * DT;
        const dx = tx - tf.vel.x, dz = tz - tf.vel.z;
        const dl = Math.hypot(dx, dz);
        if (dl <= rate) {
          tf.vel.x = tx;
          tf.vel.z = tz;
        } else {
          tf.vel.x += (dx / dl) * rate;
          tf.vel.z += (dz / dl) * rate;
        }
      }
      if (m?.faceYaw !== undefined) tf.yaw = turnToward(tf.yaw, m.faceYaw, MOVE.turnRate * DT);
      else if (riding) faceBull(tf, w);
      else if (w.mag > 0.1) tf.yaw = turnToward(tf.yaw, Math.atan2(w.x, w.z), MOVE.turnRate * DT);

      // Jump: buffered press, coyote time after a ledge. Only when free.
      if (free) {
        if (cmd.pressed & BTN.jump) loco.jumpBuffer = MOVE.jumpBufferTicks;
        else if (loco.jumpBuffer > 0) loco.jumpBuffer--;
        if (loco.jumpBuffer > 0 && (loco.grounded || loco.coyote > 0)) {
          tf.vel.y = JUMP_SPEED;
          loco.grounded = false;
          loco.coyote = 0;
          loco.jumpBuffer = 0;
          loco.landedTicks = 0;
          events.push({ type: 'jump', entity: e.id });
        }
      }
    } else {
      // A dodge or a stagger in the saddle doesn't end the gallop.
      loco.sprinting = e.riding?.state === 'riding' && e.riding.gallop;
      loco.jumpBuffer = 0;
      tf.vel.x = m?.vx ?? 0;
      tf.vel.z = m?.vz ?? 0;
    }

    // Pushback from hits, spread over a few ticks.
    const push = e.combat?.push;
    let px = 0, pz = 0;
    if (push && push.ticks > 0) {
      px = push.x / DT;
      pz = push.z / DT;
      if (--push.ticks <= 0) e.combat!.push = null;
    }

    if (!loco.grounded) tf.vel.y = Math.max(-MOVE.maxFall, tf.vel.y - MOVE.gravity * DT);
    else tf.vel.y = 0; // snap-to-ground keeps the capsule on slopes; a downward push sinks it into the skin

    const want = { x: (tf.vel.x + px) * DT, y: tf.vel.y * DT, z: (tf.vel.z + pz) * DT };
    // The bull won't leave the built world: it runs along the map's edge, or a cell still loading.
    if (e.riding) {
      if (!hasGround(tf.pos.x + want.x, tf.pos.z)) want.x = 0;
      if (!hasGround(tf.pos.x + want.x, tf.pos.z + want.z)) want.z = 0;
    }
    let res = physics.moveCharacter(e.id, tf.pos, want);
    if (e.riding && !hasGround(tf.pos.x + res.moved.x, tf.pos.z + res.moved.z)) {
      // A slope slid it over the line after all: this tick it stays where it was.
      physics.teleport(e.id, tf.pos);
      res = { moved: { x: 0, y: 0, z: 0 }, grounded: loco.grounded };
    }
    tf.pos.x += res.moved.x;
    tf.pos.y += res.moved.y;
    tf.pos.z += res.moved.z;

    const wasGrounded = loco.grounded;
    const rising = tf.vel.y > 0;
    loco.grounded = res.grounded && !rising;
    if (loco.grounded) {
      if (!wasGrounded) {
        events.push({ type: 'land', entity: e.id, fallSpeed: -tf.vel.y, pos: { ...tf.pos } });
        loco.landedTicks = 0;
      }
      loco.landedTicks++;
      tf.vel.y = 0;
      loco.coyote = MOVE.coyoteTicks;
    } else {
      loco.landedTicks = 0;
      if (wasGrounded && !rising) tf.vel.y = 0;
      else if (loco.coyote > 0) loco.coyote--;
      if (rising && res.moved.y < want.y - 1e-4) tf.vel.y = 0;
    }
    // Planar speed is what actually happened (walls stop you; no hidden speed builds up).
    if (steer > 0) {
      tf.vel.x = (res.moved.x - px * DT) / DT;
      tf.vel.z = (res.moved.z - pz * DT) / DT;
    }
    loco.speed = Math.hypot(res.moved.x, res.moved.z) / DT;
  }
}
