import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { BTN, press, step } from './combatHelpers';
import { bossWorld, tickAlive } from './bossHelpers';
import { standAt } from './m4Helpers';

describe('a boss is only fought inside its arena', () => {
  it('Scrapjaw shot from outside the ring takes nothing away from the fight', async () => {
    const { w, p, boss } = await bossWorld('scrapjaw');
    const home = boss.brain!.home;
    const off = ENEMIES.scrapjaw.boss!.arenaRadius + 3;
    standAt(w, home.x + off, home.z, home);
    const camYaw = Math.atan2(home.x - p.tf.pos.x, home.z - p.tf.pos.z);
    let hits = 0;
    for (let i = 0; i < 240; i++) {
      p.vitals!.mana = p.vitals!.manaMax;
      const ev = step(w, i % 30 === 0 ? press(BTN.spell1, { camYaw }) : press(0, { camYaw }));
      hits += ev.filter((e) => e.type === 'hit' && e.target === boss.id).length;
    }
    expect(hits).toBeGreaterThan(0);
    tickAlive(w, p);
    expect(boss.boss!.state).toBe('idle');
    expect(boss.vitals!.hp).toBe(boss.vitals!.hpMax);
    w.dispose();
  });
});
