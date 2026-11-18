import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { kill } from '../../src/sim/combat/hits';
import { BOSSES, bossWorld, moveOf, startFight, tickAlive, toPhase, until, type BossId } from './bossHelpers';
import { VILLAGE_Y } from './m3Helpers';
import { standAt } from './m4Helpers';

/** Burn it down from here: the same way a real kill lands, whatever state the boss is in. */
function burnToDeath(boss: Entity, source: number): void {
  boss.vitals!.hp = 0.5;
  boss.statuses = { burn: { ticks: 60, perTick: 5, source } };
}

function expectFullyReset(boss: Entity, id: BossId): void {
  const def = ENEMIES[id];
  expect(boss.vitals!.hp).toBe(def.hp);
  expect(boss.combat!.poise).toBe(def.poise);
  expect(boss.combat!.action).toBeNull();
  expect(boss.boss!.state).toBe('idle');
  expect(boss.boss!.phase).toBe(1);
  expect(boss.boss!.summoned).toBe(false);
  expect(boss.statuses).toBeUndefined();
}

describe('a boss fight that is abandoned starts over', () => {
  it.each(BOSSES)('%s: a teleport out of the arena leaves it whole and at home', async (id) => {
    const { w, p, boss } = await bossWorld(id);
    startFight(w, p, boss);
    toPhase(w, p, boss, 2);
    boss.vitals!.hp = boss.vitals!.hpMax * 0.4;
    boss.combat!.poise = 1;
    w.teleportPlayer(0, { x: 256, y: VILLAGE_Y + 0.05, z: 58 });
    expectFullyReset(boss, id);
    expect(Math.hypot(boss.tf.pos.x - boss.brain!.home.x, boss.tf.pos.z - boss.brain!.home.z)).toBeLessThan(0.01);
    w.dispose();
  });
});

describe('the player falls: the whole fight resets', () => {
  it.each(BOSSES)('%s', async (id) => {
    const { w, p, boss } = await bossWorld(id);
    startFight(w, p, boss);
    toPhase(w, p, boss, 3);
    const pillars = w.entities.filter((e) => e.obstacle?.breakable);
    for (const o of pillars) o.obstacle!.broken = true;
    kill({ now: w.now, entities: w.entities, get: (x) => w.get(x), events: w.events, motion: new Map(), frozen: new Set() }, p, boss);
    for (let i = 0; i < 400 && p.combat!.action?.kind === 'dead'; i++) w.tick(new Map([[0, { ...tickInput(p) }]]));
    expect(p.combat!.action?.kind).not.toBe('dead');
    expectFullyReset(boss, id);
    expect(w.entities.filter((e) => e.hazard || e.brain?.summoned)).toEqual([]);
    for (const o of pillars) expect(o.obstacle!.broken).toBe(false);
    // Nothing is left over: the fight can be started again.
    tickAlive(w, p);
    startFight(w, p, boss);
    expect(boss.boss!.state).toBe('fight');
    w.dispose();
  });
});

function tickInput(p: Entity) {
  return { move: { x: 0, y: 0 }, camYaw: p.tf.yaw, camPitch: 0, pressed: 0, held: 0, lockSwitch: 0, ui: [] };
}

describe('a boss can die in any state, once', () => {
  const cases: [BossId, string, (ctx: Awaited<ReturnType<typeof bossWorld>>) => void][] = [
    ['scrapjaw', 'its intro', ({ w, p, boss }) => {
      standAt(w, boss.brain!.home.x + 8, boss.brain!.home.z);
      until(w, p, () => boss.boss!.state === 'intro', 300, 'intro');
    }],
    ['scrapjaw', 'a charge', ({ w, p, boss }) => {
      startFight(w, p, boss, 16);
      until(w, p, () => moveOf(boss).startsWith('charge'), 3000, 'charge');
    }],
    ['burrowmother', 'the burrow', ({ w, p, boss }) => {
      startFight(w, p, boss);
      toPhase(w, p, boss, 2);
      until(w, p, () => !!boss.boss!.under, 4000, 'burrow');
    }],
    ['skyfire_drake', 'the air', ({ w, p, boss }) => {
      startFight(w, p, boss);
      until(w, p, () => boss.tf.pos.y > boss.brain!.home.y + 8, 600, 'airborne');
    }],
    ['skyfire_drake', 'a dive', ({ w, p, boss }) => {
      startFight(w, p, boss);
      until(w, p, () => moveOf(boss).startsWith('dive'), 3000, 'dive');
    }],
  ];

  it.each(cases)('%s during %s', async (id, _what, setup) => {
    const ctx = await bossWorld(id);
    const { w, p, boss } = ctx;
    setup(ctx);
    burnToDeath(boss, p.id);
    const seen: SimEvent[] = [];
    for (let i = 0; i < 200; i++) seen.push(...tickAlive(w, p));
    expect(seen.filter((e) => e.type === 'death' && e.entity === boss.id)).toHaveLength(1);
    expect(seen.filter((e) => e.type === 'bossDefeated')).toHaveLength(1);
    expect(boss.boss?.state).toBe('dead');
    expect(boss.boss?.under).toBeUndefined();
    expect(w.world.killedUniques.filter((u) => u === id)).toHaveLength(1);
    // The arena is open again.
    standAt(w, boss.brain!.home.x + 60, boss.brain!.home.z);
    tickAlive(w, p);
    expect(Math.hypot(p.tf.pos.x - boss.brain!.home.x, p.tf.pos.z - boss.brain!.home.z)).toBeGreaterThan(50);
    // The body goes, and stays gone through a death.
    for (let i = 0; i < 200; i++) tickAlive(w, p);
    expect(w.get(boss.id)).toBeUndefined();
    w.dispose();
  });
});

describe('no boss goes quiet for good', () => {
  const spots = [4, 18];
  const cases = BOSSES.flatMap((id) => spots.map((off): [BossId, number] => [id, off]));

  it.each(cases)('%s keeps attacking a player standing %d m from its home, through all three phases', async (id, off) => {
    const { w, p, boss } = await bossWorld(id);
    startFight(w, p, boss, off);
    const stand = () => standAt(w, boss.brain!.home.x + off, boss.brain!.home.z);
    for (const phase of [1, 2, 3] as const) {
      if (phase > 1) toPhase(w, p, boss, phase);
      let quiet = 0, worst = 0, started = 0;
      for (let i = 0; i < 1800; i++) {
        const had = moveOf(boss);
        stand();
        tickAlive(w, p);
        boss.vitals!.hp = Math.max(boss.vitals!.hp, 1);
        if (moveOf(boss) && moveOf(boss) !== had) started++;
        quiet = moveOf(boss) || boss.combat!.action ? 0 : quiet + 1;
        worst = Math.max(worst, quiet);
      }
      expect(started, `phase ${phase}: moves started`).toBeGreaterThan(3);
      expect(worst, `phase ${phase}: longest quiet spell`).toBeLessThan(600);
      expect(boss.boss!.under, `phase ${phase}`).toBeFalsy();
    }
    w.dispose();
  }, 60000);
});
