import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { SANDBOX, type LevelDef } from '../../src/content/sandbox';
import { flatDist } from '../../src/sim/combat/geometry';
import type { InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, cmd, combatWorld, idle, step, stepN } from './combatHelpers';
import { duel, gapOf, immortal, planarSpeed } from './aiHelpers';

/** Enemies read the player: mistakes get punished, runners get chased, and a beating gets avoided. */

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** A Grunt close by, already in the fight and resting for a long time. */
async function resting(seed: number, def = 'grunt', dist = 3): Promise<{ w: SimWorld; p: Entity; e: Entity }> {
  const d = await duel(def, dist, 0, seed);
  // Nothing in range to start with: it must be free when its rest begins.
  for (const m of ENEMIES[def].moves) d.e.brain!.cooldowns[m.id] = 3;
  stepN(d.w, 2);
  expect(d.e.combat!.action).toBeNull();
  d.e.brain!.circle = 400;
  return d;
}

/** Ticks until the enemy's next telegraph (null: none within `max`). */
function untilAttack(w: SimWorld, p: Entity, e: Entity, max: number, input: (t: number) => InputCommand = idle): number | null {
  for (let t = 0; t < max; t++) {
    immortal(p);
    if (step(w, input(t)).some((ev) => ev.type === 'telegraph' && ev.entity === e.id)) return t;
  }
  return null;
}

describe('punishing mistakes', () => {
  it('without a mistake, a resting Grunt keeps resting', async () => {
    const { w, p, e } = await resting(1);
    expect(untilAttack(w, p, e, 240)).toBeNull();
    w.dispose();
  });

  it('drinking a tonic nearby gets you attacked', async () => {
    let punished = 0;
    for (const seed of SEEDS) {
      const { w, p, e } = await resting(seed);
      p.vitals!.hp = p.vitals!.hpMax * 0.5;
      const t = untilAttack(w, p, e, 120, (i) => (i === 0 ? cmd({ press: BTN.potion }) : idle()));
      if (t !== null) punished++;
      w.dispose();
    }
    expect(punished).toBeGreaterThanOrEqual(6);
  });

  it('a swing at thin air nearby gets you attacked', async () => {
    let punished = 0;
    for (const seed of SEEDS) {
      // Far enough off that the swing can't reach it, close enough to make the most of the miss.
      const { w, p, e } = await resting(seed, 'grunt', 5.5);
      // The swing carries the player away from it: that mustn't count as a retreat here.
      e.brain!.fight!.lungeCd = 9999;
      const t = untilAttack(w, p, e, 120, (i) => (i === 0 ? cmd({ camYaw: Math.PI, press: BTN.light }) : idle()));
      if (t !== null) punished++;
      w.dispose();
    }
    expect(punished).toBeGreaterThanOrEqual(4);
  });

  it('a swing that connects is not a mistake', async () => {
    let punished = 0;
    for (const seed of SEEDS) {
      const { w, p, e } = await resting(seed, 'brute', 2.2);
      e.brain!.fight!.lungeCd = 9999;
      if (untilAttack(w, p, e, 60, (i) => (i === 0 ? cmd({ press: BTN.light }) : idle())) !== null) punished++;
      w.dispose();
    }
    expect(punished).toBe(0);
  });

  it('a punish is a plain attack: full wind-up, never delayed or feinted', async () => {
    const { w, p, e } = await resting(1);
    p.vitals!.hp = p.vitals!.hpMax * 0.5;
    let ticks = 0;
    for (let t = 0; t < 120 && !ticks; t++) {
      immortal(p);
      p.vitals!.hp = p.vitals!.hpMax * 0.5;
      for (const ev of step(w, t === 0 ? cmd({ press: BTN.potion }) : idle())) if (ev.type === 'telegraph' && ev.entity === e.id) ticks = ev.ticks;
    }
    expect(ticks).toBe(ENEMIES.grunt.moves.find((m) => m.id === 'swipe')!.windup);
    w.dispose();
  });
});

describe('taking hits', () => {
  /** Three hits land, as the brain sees them (the poise drops). */
  function batter(w: SimWorld, e: Entity): void {
    for (let i = 0; i < 3; i++) {
      e.combat!.poise -= 2;
      e.combat!.poiseDelay = 999;
      stepN(w, 2);
    }
  }

  it('a Grunt hit again and again gets out of there', async () => {
    const { w, p, e } = await resting(1);
    stepN(w, 5);
    const from = { ...e.tf.pos };
    batter(w, e);
    expect(e.brain!.fight!.burst).toBe('evade');
    let fastest = 0;
    for (let i = 0; i < 14; i++) {
      immortal(p);
      step(w, idle());
      fastest = Math.max(fastest, planarSpeed(e));
    }
    expect(fastest).toBeGreaterThan(ENEMIES.grunt.moveSpeed * 1.3);
    expect(flatDist(e.tf.pos, from)).toBeGreaterThan(1);
    w.dispose();
  });

  it('it can only do that every so often', async () => {
    const { w, e } = await resting(1);
    batter(w, e);
    expect(e.brain!.fight!.evadeCd).toBeGreaterThan(0);
    stepN(w, 30);
    batter(w, e);
    expect(e.brain!.fight!.burst).not.toBe('evade');
    w.dispose();
  });

  it('a Brute stands and takes it', async () => {
    const { w, e } = await resting(1, 'brute');
    batter(w, e);
    expect(e.brain!.fight!.burst).toBeNull();
    w.dispose();
  });
});

describe('pressing the advantage', () => {
  it('a tired player is attacked more often than a fresh one', async () => {
    const count = async (stamina: number) => {
      let n = 0;
      for (const seed of [1, 2, 3]) {
        const { w, p, e } = await duel('grunt', 3, 0, seed);
        for (let t = 0; t < 2400; t++) {
          immortal(p);
          p.vitals!.stamina = stamina;
          for (const ev of step(w, idle())) if (ev.type === 'telegraph' && ev.entity === e.id) n++;
        }
        w.dispose();
      }
      return n;
    };
    const fresh = await count(100);
    const tired = await count(5);
    expect(tired).toBeGreaterThan(fresh * 1.1);
  });
});

describe('gap closers', () => {
  /** Walk straight away from an enemy at bearing 0 (it stands on +Z). */
  const backAway = () => cmd({ camYaw: Math.PI, move: { x: 0, y: 1 } });

  for (const id of ['grunt', 'brute']) {
    it(`${id} lunges after a player who backs away`, async () => {
      const { w, p, e } = await duel(id, 6);
      stepN(w, 2);
      let fastest = 0;
      for (let t = 0; t < 120; t++) {
        immortal(p);
        step(w, backAway());
        if (e.combat!.action === null) fastest = Math.max(fastest, planarSpeed(e));
      }
      expect(fastest).toBeGreaterThan(ENEMIES[id].moveSpeed * 1.4);
      w.dispose();
    });
  }

  it('without a retreat there is no lunge', async () => {
    const { w, p, e } = await duel('grunt', 6);
    e.brain!.cooldowns.leap = 9999; // walks in
    let fastest = 0;
    for (let t = 0; t < 60; t++) {
      immortal(p);
      step(w, idle());
      fastest = Math.max(fastest, planarSpeed(e));
    }
    expect(fastest).toBeLessThanOrEqual(ENEMIES.grunt.moveSpeed * 1.15);
    w.dispose();
  });

  it('a Slinger does not lunge: it keeps its distance', async () => {
    const { w, p, e } = await duel('slinger', 12);
    let fastest = 0;
    for (let t = 0; t < 300; t++) {
      immortal(p);
      step(w, backAway());
      if (e.brain!.state === 'engage') fastest = Math.max(fastest, planarSpeed(e));
    }
    expect(fastest).toBeLessThanOrEqual(ENEMIES.slinger.moveSpeed * 1.15);
    w.dispose();
  });
});

describe('ranged repositioning', () => {
  /** A wall between the player and the shooter. */
  const WALL: LevelDef = { ...SANDBOX, enemies: [], shapes: [{ kind: 'box', pos: [0, 2, -44], half: [3, 2, 0.4] }] };

  it('a Slinger with no line of fire moves until it has one, then shoots', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: -50 }, level: WALL });
    const e = w.spawnEnemy('slinger', { x: 0, y: 0, z: -38 }, Math.PI);
    let fired = -1;
    for (let t = 0; t < 900 && fired < 0; t++) {
      immortal(p);
      if (step(w, idle()).some((ev) => ev.type === 'fire' && ev.entity === e.id)) fired = t;
    }
    expect(fired).toBeGreaterThanOrEqual(0);
    // It stepped out from behind the wall to take the shot.
    expect(Math.abs(e.tf.pos.x)).toBeGreaterThan(2);
    w.dispose();
  });

  it('with no way to get a shot from where it is, it walks in', async () => {
    const LONG: LevelDef = { ...SANDBOX, enemies: [], shapes: [{ kind: 'box', pos: [0, 2, -44], half: [14, 2, 0.4] }] };
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: -50 }, level: LONG });
    const e = w.spawnEnemy('slinger', { x: 0, y: 0, z: -38 }, Math.PI);
    e.brain!.cooldowns.coinBurst = e.brain!.cooldowns.coinBomb = 9999;
    stepN(w, 2);
    e.brain!.fight!.sight = false;
    e.brain!.fight!.blind = 9999;
    const before = gapOf(e, p);
    stepN(w, 30);
    expect(before - gapOf(e, p)).toBeGreaterThan(1);
    w.dispose();
  });

  it('it never fires a coin into the wall', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: -50 }, level: WALL });
    const e = w.spawnEnemy('slinger', { x: 0, y: 0, z: -41 }, Math.PI);
    // Hold it dead centre behind the wall: it has no shot from here.
    for (let t = 0; t < 120; t++) {
      immortal(p);
      e.tf.pos.x = 0;
      e.tf.pos.z = -41;
      w.physics.teleport(e.id, e.tf.pos);
      for (const ev of step(w, idle())) expect(ev.type === 'telegraph' && ev.entity === e.id && ev.move === 'coinBurst', `tick ${t}`).toBe(false);
    }
    w.dispose();
  });

  it('a Wisp drifts: it keeps sliding sideways while it holds its band', async () => {
    const { w, p, e } = await duel('wisp', 10);
    const [lo, hi] = ENEMIES.wisp.keepRange!;
    let path = 0;
    let last = { ...e.tf.pos };
    for (let t = 0; t < 900; t++) {
      immortal(p);
      step(w, idle());
      path += flatDist(e.tf.pos, last);
      last = { ...e.tf.pos };
      if (t > 120) {
        expect(gapOf(e, p), `tick ${t}`).toBeGreaterThan(lo - 3.5);
        expect(gapOf(e, p), `tick ${t}`).toBeLessThan(hi + 2);
      }
    }
    expect(path).toBeGreaterThan(3);
    w.dispose();
  });
});
