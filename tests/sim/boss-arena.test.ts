import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { stepN } from './combatHelpers';
import { VILLAGE_Y } from './m3Helpers';
import { flatSproutvale } from './m4Helpers';

/** A sealed boss arena holds the player in, unless a teleport takes them out of the fight. */
async function fightOn() {
  const { w, p } = await flatSproutvale();
  const boss = w.entities.find((e) => e.boss && e.brain?.def === 'scrapjaw')!;
  boss.boss!.state = 'fight';
  return { w, p, boss, radius: ENEMIES.scrapjaw.boss!.arenaRadius };
}

describe('leaving a boss fight by teleport', () => {
  it('a teleport out of the arena abandons the fight, and the player stays where they went', async () => {
    const { w, p, boss } = await fightOn();
    w.teleportPlayer(0, { x: 256, y: VILLAGE_Y + 0.05, z: 58 });
    stepN(w, 5);
    expect(boss.boss!.state).toBe('idle');
    expect(Math.hypot(p.tf.pos.x - 256, p.tf.pos.z - 58)).toBeLessThan(0.5);
    w.dispose();
  });

  it('a teleport inside the arena leaves the fight on', async () => {
    const { w, boss, radius } = await fightOn();
    const home = boss.brain!.home;
    w.teleportPlayer(0, { x: home.x + radius / 2, y: VILLAGE_Y + 0.05, z: home.z });
    expect(boss.boss!.state).toBe('fight');
    w.dispose();
  });
});
