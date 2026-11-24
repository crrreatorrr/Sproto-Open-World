import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../src/content/combat';
import { ENEMIES } from '../../src/content/enemies';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, cmd, step } from './combatHelpers';
import { bossWorld, moveOf, startFight, until } from './bossHelpers';

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

  it('each shot of a volley can be parried in turn: a press after a parry has the whole window', async () => {
    const { w, p, boss } = await bossWorld('skyfire_drake');
    startFight(w, p, boss);
    let best = 0;
    const windows: number[] = [];
    for (let v = 0; v < 6 && best < 3; v++) {
      until(w, p, () => moveOf(boss) === 'volley', 6000, 'a volley');
      let parries = 0, release = false;
      for (let i = 0; i < 260; i++) {
        p.vitals!.hp = p.vitals!.hpMax;
        const shots = w.entities.filter((e) => e.projectile && e.projectile.team === 'enemy');
        const d = Math.min(...shots.map((s) => Math.hypot(s.tf.pos.x - p.tf.pos.x, s.tf.pos.y - p.tf.pos.y - 1, s.tf.pos.z - p.tf.pos.z)));
        p.tf.yaw = p.tf.prevYaw = Math.atan2(boss.tf.pos.x - p.tf.pos.x, boss.tf.pos.z - p.tf.pos.z);
        // Tap: down when a shot is about 7 ticks out, up again the tick after it is parried.
        const down = !release && d < 2.9;
        const ev = step(w, down ? cmd({ camYaw: p.tf.yaw, ...(p.combat!.blockHeld ? { hold: BTN.block } : { press: BTN.block }) }) : cmd({ camYaw: p.tf.yaw }));
        const n = ev.filter((e) => e.type === 'parry').length;
        // A press that follows a parry inside the mash window is not a mash.
        if (down && parries > 0 && p.combat!.lastBlockTick === w.now - 1) windows.push(p.combat!.blockPressTicks);
        parries += n;
        release = n > 0;
      }
      best = Math.max(best, parries);
    }
    expect(best).toBe(3);
    expect(windows.length).toBeGreaterThan(0);
    expect(Math.min(...windows)).toBe(BLOCK.parryTicks);
    w.dispose();
  }, 120000);

  it('a Mirror Ward raised as a fireball arrives sends it back, for the same 3% and stance damage', async () => {
    const { w, p, boss } = await bossWorld('skyfire_drake');
    p.progress!.spells = ['mirrorWard'];
    p.progress!.loadout = ['mirrorWard'];
    startFight(w, p, boss);
    const hp0 = boss.vitals!.hp;
    let reflected = 0;
    for (let i = 0; i < 6000 && boss.vitals!.hp >= hp0; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      p.vitals!.mana = p.vitals!.manaMax;
      const shots = w.entities.filter((e) => e.projectile && e.projectile.team === 'enemy');
      const d = Math.min(...shots.map((s) => Math.hypot(s.tf.pos.x - p.tf.pos.x, s.tf.pos.y - p.tf.pos.y - 1, s.tf.pos.z - p.tf.pos.z)));
      const ev = step(w, d < 4 && !p.combat!.action ? cmd({ camYaw: p.tf.yaw, press: BTN.spell1 }) : cmd({ camYaw: p.tf.yaw }));
      reflected += ev.filter((e) => e.type === 'power' && e.fx === 'wardReflect').length;
    }
    expect(reflected).toBeGreaterThanOrEqual(1);
    expect(hp0 - boss.vitals!.hp).toBeGreaterThanOrEqual(boss.vitals!.hpMax * 0.03);
    expect(boss.combat!.poise).toBeLessThan(ENEMIES.skyfire_drake.poise);
    w.dispose();
  }, 120000);
});
