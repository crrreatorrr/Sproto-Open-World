import { MOUNT } from '../../content/mounts';
import { DT, MOVE } from '../../content/tuning';
import type { CombatCtx } from '../combat/playerCombat';
import type { Entity } from '../entity';
import type { SimEvent } from '../events';
import { turnToward } from '../math';

/**
 * Riding the Pepe Bull. The rider keeps their own capsule, so collisions, hits and lock-on work as
 * they do on foot; the bull has no body and follows the rider. Getting on and off are combat actions
 * (`mounting`), so a hit interrupts them like any other action.
 */
export function startMount(events: SimEvent[], rider: Entity, bull: Entity): void {
  if (rider.riding || rider.combat?.action || !bull.mount || bull.mount.rider !== null) return;
  bull.mount.rider = rider.id;
  rider.riding = { mount: bull.id, state: 'mounting', dir: { x: 0, z: 0 } };
  rider.combat!.action = { kind: 'mounting', t: 0, dur: MOUNT.mountTicks };
  events.push({ type: 'mount', entity: rider.id, mount: bull.id, phase: 'start' });
}

export function startDismount(events: SimEvent[], rider: Entity, bull: Entity): void {
  const r = rider.riding;
  if (r?.state !== 'riding' || rider.combat?.action) return;
  r.state = 'dismounting';
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
      case 'dodge':
        m.vx *= MOUNT.dodgeScale;
        m.vz *= MOUNT.dodgeScale;
        break;
    }
  }
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
  }
}
