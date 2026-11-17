import { DT, MOVE } from '../../content/tuning';
import { BTN, idleInput, type CommandMap } from '../commands';
import type { Entity } from '../entity';
import type { SimEvent } from '../events';
import { turnToward } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

const JUMP_SPEED = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);

/**
 * Player ground and air movement through Rapier's character controller: camera-relative input,
 * acceleration, sprint, turning toward the move direction, jump with buffer and coyote time.
 */
export function locomotion(entities: Entity[], commands: CommandMap, physics: PhysicsWorld, events: SimEvent[]): void {
  for (const e of entities) {
    const loco = e.loco;
    if (!loco || e.owner === undefined) continue;
    const cmd = commands.get(e.owner) ?? idleInput(e.tf.yaw);
    const tf = e.tf;

    // Camera-relative wish direction (yaw 0 faces +Z; right is -X).
    const sy = Math.sin(cmd.camYaw), cy = Math.cos(cmd.camYaw);
    let mx = cmd.move.x, my = cmd.move.y;
    const mag = Math.min(1, Math.hypot(mx, my));
    if (mag > 1e-4) {
      const k = mag / Math.hypot(mx, my);
      mx *= k;
      my *= k;
    }
    const wx = -cy * mx + sy * my;
    const wz = sy * mx + cy * my;

    loco.sprinting = (cmd.held & BTN.sprint) !== 0 && mag >= MOVE.sprintMinStick && (loco.grounded || loco.sprinting);
    const top = loco.sprinting ? MOVE.sprintSpeed : MOVE.runSpeed;
    const tx = wx * top, tz = wz * top;
    const ground = loco.grounded ? 1 : MOVE.airControl;
    const rate = (mag > 1e-4 ? MOVE.accel : MOVE.decel) * ground * DT;
    // Approach the target velocity along the difference vector (no axis-aligned bias).
    const dx = tx - tf.vel.x, dz = tz - tf.vel.z;
    const dl = Math.hypot(dx, dz);
    if (dl <= rate) {
      tf.vel.x = tx;
      tf.vel.z = tz;
    } else {
      tf.vel.x += (dx / dl) * rate;
      tf.vel.z += (dz / dl) * rate;
    }

    if (mag > 0.1) tf.yaw = turnToward(tf.yaw, Math.atan2(wx, wz), MOVE.turnRate * DT);

    // Jump: buffered press, coyote time after a ledge.
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

    if (!loco.grounded) tf.vel.y = Math.max(-MOVE.maxFall, tf.vel.y - MOVE.gravity * DT);
    else tf.vel.y = 0; // snap-to-ground keeps the capsule on slopes; a downward push sinks it into the skin

    const want = { x: tf.vel.x * DT, y: tf.vel.y * DT, z: tf.vel.z * DT };
    const res = physics.moveCharacter(e.id, tf.pos, want);
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
      if (wasGrounded && !rising) {
        // Walked off a ledge: start falling from rest, keep coyote time.
        tf.vel.y = 0;
      } else if (loco.coyote > 0) loco.coyote--;
      // Bumped a ceiling.
      if (rising && res.moved.y < want.y - 1e-4) tf.vel.y = 0;
    }
    // Planar speed is what actually happened (walls stop you; no hidden speed builds up).
    tf.vel.x = res.moved.x / DT;
    tf.vel.z = res.moved.z / DT;
    loco.speed = Math.hypot(tf.vel.x, tf.vel.z);
  }
}
