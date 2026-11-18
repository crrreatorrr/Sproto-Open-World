import { POWER } from '../../../content/packs/c3';
import { protectionMult } from '../../../content/progression';
import { DT } from '../../../content/tuning';
import type { Entity } from '../../entity';
import { flatDist } from '../geometry';
import type { CombatCtx } from '../playerCombat';
import type { SpawnSpellProjectile } from '../spells';
import { alive } from './common';
import type { BloomArea } from './state';

const B = POWER.bloom;

/** Plant the flower patch at the caster's feet. A new patch replaces the last one. */
export function plantBloom(ctx: CombatCtx, p: Entity, spawn: SpawnSpellProjectile): void {
  for (const e of ctx.entities) if (e.powerArea?.kind === 'bloom' && e.powerArea.owner === p.id) e.powerArea.age = e.powerArea.life;
  const at = { ...p.tf.pos };
  spawn({
    kind: 'area',
    tf: { pos: at, prevPos: { ...at }, yaw: p.tf.yaw, prevYaw: p.tf.yaw, vel: { x: 0, y: 0, z: 0 } },
    powerArea: { kind: 'bloom', owner: p.id, age: 0, life: B.ticks, healPerTick: B.healPerSecond * DT * protectionMult(p.progress?.skills), pause: 0 },
    view: { model: 'healingBloom' },
  });
  ctx.events.push({ type: 'power', fx: 'bloom', entity: p.id, pos: { ...at }, radius: B.radius });
}

/** Heal the owner while they stand in the patch; casting pauses it. True when it fades. */
export function stepBloom(ctx: CombatCtx, b: Entity): boolean {
  const a = b.powerArea as BloomArea;
  if (++a.age >= a.life) return true;
  const owner = ctx.get(a.owner);
  const v = owner?.vitals;
  if (!owner || !alive(owner)) return true; // a patch fades with its caster
  if (!v) return false;
  if (owner.combat?.action?.kind === 'cast') a.pause = B.castPause;
  else if (a.pause > 0) a.pause--;
  if (a.pause > 0 || flatDist(owner.tf.pos, b.tf.pos) > B.radius || Math.abs(owner.tf.pos.y - b.tf.pos.y) > 2) return false;
  v.hp = Math.min(v.hpMax, v.hp + v.hpMax * a.healPerTick);
  return false;
}
