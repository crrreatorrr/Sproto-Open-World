import type { Motion } from '../combat/playerCombat';
import type { Entity } from '../entity';

/** Around every shrine, this far out (m): enemies do not come in, target anyone inside, or hurt them. */
export const SANCTUARY_RADIUS = 8;
/** An enemy stops walking inward this far before the edge (m), so it does not shuffle on the line. */
const EDGE = 0.5;

export interface Spot {
  x: number;
  z: number;
}

/** Where the shrines are this tick. */
export function sanctuaries(entities: readonly Entity[]): Spot[] {
  const out: Spot[] = [];
  for (const e of entities) if (e.interactable?.kind === 'shrine') out.push({ x: e.tf.pos.x, z: e.tf.pos.z });
  return out;
}

export function inSanctuary(pos: Spot, spots: readonly Spot[], radius = SANCTUARY_RADIUS): boolean {
  for (const s of spots) if (Math.hypot(pos.x - s.x, pos.z - s.z) <= radius) return true;
  return false;
}

/** A hit that a shrine's ground refuses: an enemy's blow, shot or hazard on a player standing inside. */
export function sanctuaryBlocks(entities: readonly Entity[], attacker: Entity, target: Entity): boolean {
  if ((!attacker.brain && !attacker.warden) || target.kind !== 'player') return false;
  return inSanctuary(target.tf.pos, sanctuaries(entities));
}

/**
 * Keep an enemy off a shrine's ground: its walk loses the part that heads inward, and one already
 * inside is walked straight out. An enemy whose home is inside stays as it is (it lives there).
 */
export function keepOut(e: Entity, spots: readonly Spot[], motion: Map<number, Motion>, speed: number): void {
  const home = e.brain!.home;
  for (const s of spots) {
    const dx = e.tf.pos.x - s.x, dz = e.tf.pos.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d >= SANCTUARY_RADIUS + EDGE) continue;
    if (Math.hypot(home.x - s.x, home.z - s.z) < SANCTUARY_RADIUS + EDGE) continue;
    const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
    const m = motion.get(e.id) ?? { vx: 0, vz: 0, inputScale: 0 };
    const inward = m.vx * nx + m.vz * nz;
    if (inward < 0) {
      m.vx -= inward * nx;
      m.vz -= inward * nz;
    }
    if (d < SANCTUARY_RADIUS) {
      m.vx += nx * speed;
      m.vz += nz * speed;
    }
    motion.set(e.id, m);
  }
}
