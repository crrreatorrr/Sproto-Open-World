import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, cmd, step } from './combatHelpers';
import { bossWorld, startFight } from './bossHelpers';

/** Hold block, facing the nearest fireball, just before it lands: a parry sends it back. */
function parryTick(w: SimWorld, p: Entity): SimEvent[] {
  p.vitals!.hp = p.vitals!.hpMax;
  p.vitals!.stamina = p.vitals!.staminaMax;
  const shots = w.entities.filter((e) => e.projectile && e.projectile.team === 'enemy');
  const near = shots.map((s) => ({ s, d: Math.hypot(s.tf.pos.x - p.tf.pos.x, s.tf.pos.y - p.tf.pos.y - 1, s.tf.pos.z - p.tf.pos.z) })).sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > 3.5) return step(w, cmd({ camYaw: p.tf.yaw }));
  const yaw = Math.atan2(near.s.tf.pos.x - p.tf.pos.x, near.s.tf.pos.z - p.tf.pos.z);
  p.tf.yaw = p.tf.prevYaw = yaw;
  return step(w, p.combat!.action?.kind === 'block' ? cmd({ camYaw: yaw, hold: BTN.block }) : cmd({ camYaw: yaw, press: BTN.block }));
}

describe('the Skyfire Drake can be brought down', () => {
  it('parried fireballs break its stance, it comes down to melee height, and it flies again after', async () => {
    const { w, p, boss } = await bossWorld('skyfire_drake');
    startFight(w, p, boss);
    let parries = 0;
    for (let i = 0; i < 20000 && boss.combat!.action?.kind !== 'stagger'; i++) {
      parries += parryTick(w, p).filter((e) => e.type === 'parry').length;
    }
    const a = boss.combat!.action;
    expect(a?.kind === 'stagger' && a.reason).toBe('broken');
    expect(parries).toBeGreaterThanOrEqual(3);

    // The melee window: low enough to reach with the staff, for most of its length.
    const g = ENEMIES.skyfire_drake.drake!.glide;
    let low = 0;
    for (let i = 0; i < g.descendTicks + g.ticks && boss.combat!.action?.kind === 'stagger'; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      step(w);
      if (boss.tf.pos.y - boss.brain!.home.y < 2) low++;
    }
    expect(low).toBeGreaterThan(g.ticks * 0.8);

    // Back up, and still fighting.
    let attacks = 0;
    for (let i = 0; i < 1200; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      attacks += step(w).filter((e) => e.type === 'telegraph' && e.entity === boss.id).length;
    }
    expect(attacks).toBeGreaterThan(0);
    expect(boss.tf.pos.y - boss.brain!.home.y).toBeGreaterThan(5);
    w.dispose();
  }, 120000);
});
