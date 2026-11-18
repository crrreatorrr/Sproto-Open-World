import { describe, expect, it } from 'vitest';
import { AI_STYLES } from '../../src/content/packs/aiStyles';
import { ENEMIES } from '../../src/content/enemies';
import { flatDist } from '../../src/sim/combat/geometry';
import type { InputCommand } from '../../src/sim/commands';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, cmd, combatWorld, idle, step } from './combatHelpers';
import { OPEN, immortal } from './aiHelpers';

/** The same seed and inputs give the same fight, through a snapshot too; styles are complete, valid data. */

const CAMP = ['grunt', 'grunt_vet', 'brute', 'slinger', 'wisp', 'gatekeeper'];

async function camp(seed: number) {
  const { w, p } = await combatWorld({ pos: OPEN, seed });
  CAMP.forEach((d, i) => {
    const a = (i / CAMP.length) * Math.PI * 2;
    w.spawnEnemy(d, { x: OPEN.x + Math.sin(a) * 7, y: 0, z: OPEN.z + Math.cos(a) * 7 }, a + Math.PI);
  });
  return { w, p };
}

const input = (t: number): InputCommand =>
  cmd({ camYaw: t / 140, move: { x: Math.sin(t / 60), y: t % 400 < 240 ? 1 : 0 }, press: t % 53 === 0 ? BTN.light : t % 211 === 0 ? BTN.dodge : t % 701 === 0 ? BTN.potion : 0 });

function run(w: SimWorld, from: number, to: number): string[] {
  const hashes: string[] = [];
  for (let t = from; t < to; t++) {
    const p = w.playerEntity(0)!;
    immortal(p);
    for (const e of w.entities) if (e.brain && e.combat?.action?.kind !== 'dead') e.vitals!.hp = e.vitals!.hpMax;
    step(w, input(t));
    if (t % 50 === 0) hashes.push(String(w.hash()));
  }
  return hashes;
}

describe('determinism', () => {
  it('the same seed plays the same fight, tick for tick', async () => {
    const a = await camp(5);
    const b = await camp(5);
    expect(run(a.w, 0, 2500)).toEqual(run(b.w, 0, 2500));
    a.w.dispose();
    b.w.dispose();
  }, 30_000);

  it('another seed plays a different fight', async () => {
    const a = await camp(5);
    const b = await camp(6);
    expect(run(a.w, 0, 800)).not.toEqual(run(b.w, 0, 800));
    a.w.dispose();
    b.w.dispose();
  }, 30_000);

  it('a snapshot taken mid-fight replays exactly', async () => {
    const { w } = await camp(9);
    run(w, 0, 900);
    const snap = w.snapshot();
    const first = run(w, 900, 1800);
    w.restore(snap);
    expect(run(w, 900, 1800)).toEqual(first);
    w.dispose();
  }, 30_000);

  it('fight state is plain data', async () => {
    const { w } = await camp(3);
    run(w, 0, 300);
    const fighters = w.entities.filter((e) => e.brain?.fight);
    expect(fighters.length).toBeGreaterThan(3);
    for (const e of fighters) expect(JSON.parse(JSON.stringify(e.brain!.fight))).toEqual(e.brain!.fight);
    w.dispose();
  });
});

describe('bosses keep their script', () => {
  it('a boss sidesteps between its moves and stays in its arena', async () => {
    const { w, p } = await combatWorld({ pos: OPEN });
    const boss = w.spawnEnemy('scrapjaw', { x: OPEN.x, y: 0, z: OPEN.z + 6 }, Math.PI);
    boss.boss!.state = 'fight';
    boss.brain!.state = 'engage';
    const arena = ENEMIES.scrapjaw.boss!.arenaRadius;
    let sidestepped = 0;
    for (let t = 0; t < 1500; t++) {
      immortal(p);
      step(w, idle());
      expect(flatDist(boss.tf.pos, boss.brain!.home), `tick ${t}`).toBeLessThanOrEqual(arena);
      if (boss.brain!.timer > 0 && boss.combat!.action === null && Math.hypot(boss.tf.vel.x, boss.tf.vel.z) > 0.2) sidestepped++;
    }
    expect(sidestepped).toBeGreaterThan(20);
    expect(boss.brain!.fight).toBeUndefined();
    w.dispose();
  });
});

describe('AI styles', () => {
  const fighters = Object.values(ENEMIES).filter((d) => !d.dummy && !d.boss && !d.drake);

  it('every fighter has a style of its own', () => {
    expect(fighters.length).toBeGreaterThan(10);
    for (const d of fighters) expect(AI_STYLES[d.id], d.id).toBeDefined();
  });

  it('every style key is a real enemy', () => {
    for (const id of Object.keys(AI_STYLES)) expect(ENEMIES[id], id).toBeDefined();
  });

  it('the numbers make sense', () => {
    for (const [id, s] of Object.entries(AI_STYLES)) {
      expect(s.band[0], id).toBeLessThanOrEqual(s.band[1]);
      expect(s.beat[0], id).toBeGreaterThan(0);
      expect(s.beat[0], id).toBeLessThanOrEqual(s.beat[1]);
      expect(s.pause[0], id).toBeLessThanOrEqual(s.pause[1]);
      expect(s.feet.strafe + s.feet.in + s.feet.out + s.feet.hold, id).toBeGreaterThan(0);
      for (const chance of [s.delay.chance, s.feint, s.punish.heal, s.punish.whiff, s.press, s.flank]) {
        expect(chance, id).toBeGreaterThanOrEqual(0);
        expect(chance, id).toBeLessThanOrEqual(1);
      }
      expect(s.delay.ticks[0], id).toBeLessThanOrEqual(s.delay.ticks[1]);
      // A delay stays short enough to read as a held swing, not a stalled enemy.
      expect(s.delay.ticks[1], id).toBeLessThanOrEqual(30);
    }
  });

  it('ranged enemies never lunge, feint or hold a swing', () => {
    for (const d of fighters.filter((x) => x.keepRange)) {
      const s = AI_STYLES[d.id];
      expect(s.lunge, d.id).toBeNull();
      expect(s.feint, d.id).toBe(0);
      expect(s.delay.chance, d.id).toBe(0);
    }
  });
});
