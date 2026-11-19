import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { SANDBOX, type LevelDef } from '../../src/content/sandbox';
import { flatDist } from '../../src/sim/combat/geometry';
import { BTN, cmd, combatWorld, idle, press, step, stepN } from './combatHelpers';
import { OPEN, duel, gapOf, immortal, trace } from './aiHelpers';

/** Between attacks enemies keep their feet moving, each type in its own way, and stay out of trouble. */

describe('footwork', () => {
  it('a Grunt circles the player and steps in and back between its attacks', async () => {
    const { w, p, e } = await duel('grunt', 4);
    const t = trace(w, p, e, 1200);
    expect(t.orbit).toBeGreaterThan(1.5);
    expect(t.moving / t.free).toBeGreaterThan(0.7);
    expect(t.maxGap - t.minGap).toBeGreaterThan(1);
    w.dispose();
  });

  it('each type holds its ground differently', async () => {
    const run = async (id: string, dist: number) => {
      const { w, p, e } = await duel(id, dist);
      const t = trace(w, p, e, 1500);
      w.dispose();
      return t;
    };
    const grunt = await run('grunt', 4);
    const brute = await run('brute', 4);
    const slinger = await run('slinger', 12);
    const warden = await run('lens_warden', 12);
    // A Grunt dances around you; a Brute just comes at you.
    expect(grunt.orbit).toBeGreaterThan(brute.orbit * 2);
    // A Slinger keeps its distance and keeps moving; a Lens Warden is planted.
    expect(slinger.meanGap).toBeGreaterThan(ENEMIES.slinger.keepRange![0] - 3);
    expect(slinger.orbit).toBeGreaterThan(warden.orbit);
  });

  it('a Brute never backs away between attacks; a Grunt does', async () => {
    const backSteps = async (id: string) => {
      const { w, p, e } = await duel(id, 4);
      let n = 0;
      for (let t = 0; t < 1500; t++) {
        immortal(p);
        step(w, idle());
        const d = flatDist(e.tf.pos, p.tf.pos) || 1;
        const away = ((e.tf.pos.x - p.tf.pos.x) * e.tf.vel.x + (e.tf.pos.z - p.tf.pos.z) * e.tf.vel.z) / d;
        if (e.combat!.action === null && away > 1) n++;
      }
      w.dispose();
      return n;
    };
    expect(await backSteps('brute')).toBe(0);
    expect(await backSteps('grunt')).toBeGreaterThan(10);
  });

  for (const [id, dist] of [['grunt', 4], ['grunt_vet', 4], ['brute', 4], ['gatekeeper', 5], ['slinger', 12], ['wisp', 10], ['rivet_gunner', 14]] as const) {
    it(`${id} never jitters on the spot`, async () => {
      const { w, p, e } = await duel(id, dist);
      const t = trace(w, p, e, 1800);
      // At most one turn back every 20 ticks, on average.
      expect(t.reversals, `${t.reversals} reversals`).toBeLessThanOrEqual(90);
      w.dispose();
    });
  }

  it('training dummies never move, even when hit', async () => {
    for (const id of ['dummy_passive', 'dummy_swing', 'dummy_shooter', 'dummy_straw']) {
      const { w, p } = await combatWorld({ pos: OPEN });
      const at = { x: OPEN.x, y: 0, z: OPEN.z + 1.6 };
      const d = w.spawnEnemy(id, at, Math.PI);
      for (let i = 0; i < 600; i++) {
        immortal(p);
        step(w, i % 40 === 0 ? press(BTN.light) : idle());
        d.vitals!.hp = d.vitals!.hpMax;
        expect(flatDist(d.tf.pos, at), `${id} tick ${i}`).toBeLessThan(0.05);
      }
      expect(d.brain!.fight).toBeUndefined();
      w.dispose();
    }
  });
});

describe('the leash', () => {
  it('a fight at the rim never carries an enemy past its leash, and it goes home when the player leaves', async () => {
    for (const id of ['grunt', 'brute', 'slinger']) {
      const leash = ENEMIES[id].leashRange;
      const home = { x: 0, y: 0, z: -70 };
      const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: home.z + leash - 1 } });
      const e = w.spawnEnemy(id, { x: 0, y: 0, z: home.z + leash - 6 }, 0);
      e.brain!.home = home;
      const t = trace(w, p, e, 2000);
      expect(t.maxFromHome, id).toBeLessThanOrEqual(leash + 0.5);
      // The player runs off: the enemy gives up and walks home.
      for (let i = 0; i < 1500; i++) step(w, cmd({ move: { x: 0, y: 1 }, hold: BTN.sprint }));
      for (let i = 0; i < 900 && e.brain!.state !== 'idle'; i++) step(w, idle());
      expect(e.brain!.state, id).toBe('idle');
      expect(flatDist(e.tf.pos, home), id).toBeLessThan(1.5);
      w.dispose();
    }
  });

  it('a Slinger backed toward the edge of its leash stops there and shoots', async () => {
    const leash = ENEMIES.slinger.leashRange;
    const home = { x: 0, y: 0, z: -70 };
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: home.z + leash - 9 } });
    const e = w.spawnEnemy('slinger', { x: 0, y: 0, z: home.z + leash - 4 }, Math.PI);
    e.brain!.home = home;
    let shots = 0, furthest = 0;
    for (let i = 0; i < 1500; i++) {
      immortal(p);
      // The player keeps walking at it, pinning it against its leash.
      const c = gapOf(e, p) > 3 ? cmd({ camYaw: Math.atan2(e.tf.pos.x - p.tf.pos.x, e.tf.pos.z - p.tf.pos.z), move: { x: 0, y: 1 } }) : idle();
      for (const ev of step(w, c)) if (ev.type === 'fire' && ev.entity === e.id) shots++;
      furthest = Math.max(furthest, flatDist(e.tf.pos, home));
    }
    expect(furthest).toBeLessThanOrEqual(leash + 0.5);
    expect(shots).toBeGreaterThan(5);
    w.dispose();
  });
});

describe('ledges and props', () => {
  /** A 4 m high table: its top spans x ±7 and z −47 to −33. */
  const TABLE: LevelDef = { ...SANDBOX, enemies: [], shapes: [{ kind: 'box', pos: [0, 2, -40], half: [7, 2, 7] }] };
  const onTable = (x: number, z: number) => Math.abs(x) <= 7.2 && z >= -47.2 && z <= -32.8;

  for (const id of ['grunt', 'brute', 'slinger', 'wisp']) {
    it(`${id} on a high table won't step off to reach a player on the ground below`, async () => {
      const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: -30 }, level: TABLE });
      const e = w.spawnEnemy(id, { x: 0, y: 4, z: -36 }, 0);
      for (let i = 0; i < 1200; i++) {
        immortal(p);
        step(w, idle());
        expect(e.tf.pos.y, `tick ${i}`).toBeGreaterThan(3.8);
        expect(onTable(e.tf.pos.x, e.tf.pos.z), `tick ${i}`).toBe(true);
      }
      w.dispose();
    });
  }

  it('a Slinger chased to the edge of a table stays on it', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 4, z: -38 }, level: TABLE });
    const e = w.spawnEnemy('slinger', { x: 0, y: 4, z: -35 }, Math.PI);
    for (let i = 0; i < 900; i++) {
      immortal(p);
      step(w, cmd({ move: { x: 0, y: 0.5 } }));
      if (p.tf.pos.z > -34.5) p.tf.pos.z = -34.5;
      expect(e.tf.pos.y, `tick ${i}`).toBeGreaterThan(3.8);
    }
    w.dispose();
  });

  it('a Grunt walks round a wall between it and the player', async () => {
    const WALL: LevelDef = { ...SANDBOX, enemies: [], shapes: [{ kind: 'box', pos: [0, 1.5, -44], half: [4, 1.5, 0.4] }] };
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: -47 }, level: WALL });
    const e = w.spawnEnemy('grunt', { x: 0, y: 0, z: -40 }, Math.PI);
    let reached = false;
    for (let i = 0; i < 900 && !reached; i++) {
      immortal(p);
      step(w, idle());
      reached = e.tf.pos.z < -44.5 && gapOf(e, p) < 4;
    }
    expect(reached).toBe(true);
    w.dispose();
  });

  it('a pack does not stick together on a pillar', async () => {
    const PILLAR: LevelDef = { ...SANDBOX, enemies: [], shapes: [{ kind: 'cylinder', pos: [0, 0, -45], radius: 1.2, height: 4 }] };
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: -50 }, level: PILLAR });
    const es = [-1, 0, 1].map((k) => w.spawnEnemy('grunt', { x: k * 1.2, y: 0, z: -40 }, Math.PI));
    stepN(w, 600, () => {
      immortal(p);
      return idle();
    });
    for (const e of es) expect(flatDist(e.tf.pos, p.tf.pos)).toBeLessThan(9);
    w.dispose();
  });
});
