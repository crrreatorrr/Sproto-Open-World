import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { flatDist } from '../../src/sim/combat/geometry';
import type { Entity } from '../../src/sim/entity';
import { wrapAngle } from '../../src/sim/math';
import { BTN, cmd, combatWorld, forceEnemyAttack, hitsOn, idle, press, step, stepN, stepUntil, teleport } from './combatHelpers';
import { evOf, keepAlive, velYaw } from './m1bHelpers';

/** Plan §4.9 archetype behaviour: Grunt leap, Slinger volley and band, area circles, Wisp hex and blink. */

const move = (id: string, m: string) => ENEMIES[id].moves.find((x) => x.id === m)!;

describe('Sprout Grunt', () => {
  it('Leap travels 5.5 m during its active ticks', async () => {
    const { w } = await combatWorld({ pos: { x: 0, y: 0, z: 0 } });
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 14 }, Math.PI); // facing the player, far enough not to land on them
    const leap = move('grunt', 'leap');
    forceEnemyAttack(g, 'leap');
    stepN(w, leap.windup - 1); // it moves on a.t = windup … windup + active − 1
    const z0 = g.tf.pos.z;
    stepN(w, leap.active);
    expect(z0 - g.tf.pos.z).toBeCloseTo(5.5, 1);
    stepN(w, 5);
    expect(z0 - g.tf.pos.z).toBeCloseTo(5.5, 1); // and stops
    w.dispose();
  });

  it('chooses the Leap from 3–6 m, with a 30-tick circle-decal telegraph, and lands next to the player', async () => {
    let seen = false;
    for (let seed = 1; seed <= 8 && !seen; seed++) {
      const { w, p } = await combatWorld({ seed });
      const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 5.3 }, Math.PI); // gap 4.95 m
      const evs = stepN(w, 80, () => {
        keepAlive(w);
        return idle();
      });
      const tel = evOf(evs, 'telegraph', g.id)[0];
      if (tel?.ev.move === 'leap') {
        seen = true;
        expect(tel.ev).toMatchObject({ ticks: 30, decal: 'circle', unblockable: false });
        expect(hitsOn(evs, p.id).map((x) => [x.tick - tel.tick >= 30, x.ev.move])).toEqual([[true, 'leap']]);
      }
      w.dispose();
    }
    expect(seen).toBe(true);
  });
});

describe('Coin Slinger', () => {
  it('Coin Burst fires 3 coins 5 ticks apart from the end of the wind-up, fanned 0.1 rad apart', async () => {
    const { w } = await combatWorld();
    const s = w.spawnEnemy('slinger', { x: 0, y: 0, z: 12 }, Math.PI);
    forceEnemyAttack(s, 'coinBurst');
    const coins: Entity[] = [];
    const ticks: number[] = [];
    for (let i = 0; i < 40; i++) {
      for (const e of step(w)) {
        if (e.type === 'fire' && e.entity === s.id) {
          ticks.push(i);
          coins.push(w.get(e.projectile)!);
        }
      }
    }
    const wind = move('slinger', 'coinBurst').windup;
    expect(ticks).toEqual([wind - 1, wind + 4, wind + 9]); // a.t = 24, 29, 34
    const yaws = coins.map(velYaw);
    expect(wrapAngle(yaws[1] - yaws[0])).toBeCloseTo(0.1, 6);
    expect(wrapAngle(yaws[2] - yaws[1])).toBeCloseTo(0.1, 6);
    // The middle coin goes straight at the player.
    expect(Math.abs(wrapAngle(yaws[1] - Math.PI))).toBeLessThan(0.01);
    expect(coins.every((c) => c.projectile!.kind === 'physical' && c.projectile!.damage === 6)).toBe(true);
    w.dispose();
  });

  for (const id of ['slinger', 'wisp'] as const) {
    const [lo, hi] = ENEMIES[id].keepRange!;
    it(`${id} backs off inside ${lo - 3} m and closes in beyond ${hi} m`, async () => {
      for (const [gap, dir] of [
        [lo - 3 - 1.5, 1],
        [hi + 2, -1],
      ] as const) {
        // x = 6: a lane clear of the sandbox's step boxes (z 14.5–17.5) and pillars.
        const { w, p } = await combatWorld({ pos: { x: 6, y: 0, z: 0 } });
        const e = w.spawnEnemy(id, { x: 6, y: 0, z: gap + p.body!.radius }, Math.PI);
        const d0 = flatDist(e.tf.pos, p.tf.pos);
        // 20 ticks: it moves (≈ 1 m), it doesn't attack, and it is still outside its band.
        const evs = stepN(w, 20);
        const d1 = flatDist(e.tf.pos, p.tf.pos);
        expect(Math.sign(d1 - d0), `${id} from gap ${gap}`).toBe(dir);
        expect(Math.abs(d1 - d0), `${id} from gap ${gap}`).toBeGreaterThan(0.7);
        expect(evOf(evs, 'telegraph', e.id).length, `${id} from gap ${gap}`).toBe(0);
        w.dispose();
      }
    });
  }
});

describe('area attacks: Coin Bomb and Curse Circle (plan §4.9, enemies.ts `area`)', () => {
  const cases = [
    { id: 'slinger', m: 'coinBomb', other: 'coinBurst', dist: 12, radius: 2.6 },
    { id: 'wisp', m: 'curseCircle', other: 'homingHex', dist: 10, radius: 3 },
  ] as const;
  for (const { id, m, other, dist, radius } of cases) {
    /** The enemy's next attack is `m` (its other move is held on cooldown); run to its telegraph. */
    async function toTelegraph(playerPos = { x: 0, y: 0, z: 0 }) {
      const { w, p } = await combatWorld({ pos: playerPos });
      const e = w.spawnEnemy(id, { x: playerPos.x, y: 0, z: playerPos.z + dist }, Math.PI);
      e.brain!.cooldowns[other] = 99_999;
      let tel: Extract<ReturnType<typeof step>[number], { type: 'telegraph' }> | undefined;
      const tick = stepUntil(w, (ev) => {
        tel = ev.find((x): x is NonNullable<typeof tel> => x.type === 'telegraph' && x.entity === e.id);
        return !!tel;
      }, 300);
      return { w, p, e, tel: tel!, tick };
    }

    it(`${id} ${m}: the circle (r ${radius}) goes on the player's feet at wind-up start; standing in it, it hits on the active tick`, async () => {
      const { w, p, tel, tick } = await toTelegraph();
      expect(tel).toMatchObject({ move: m, decal: 'circle', radius, ticks: move(id, m).windup });
      expect(flatDist(tel.at!, p.tf.pos)).toBeLessThan(1e-6);
      const evs = stepN(w, move(id, m).windup + move(id, m).active + 5);
      expect(hitsOn(evs, p.id).map((x) => [x.tick - tick, x.ev.move])).toEqual([[move(id, m).windup, m]]);
      w.dispose();
    });

    it(`${id} ${m}: stepping out of the circle before the active tick dodges it`, async () => {
      const { w, p, tel } = await toTelegraph();
      const evs = stepN(w, move(id, m).windup + move(id, m).active + 5, () => cmd({ move: { x: 1, y: 0 }, hold: BTN.sprint }));
      expect(flatDist(p.tf.pos, tel.at!)).toBeGreaterThan(radius + p.body!.radius);
      expect(hitsOn(evs, p.id).length).toBe(0);
      w.dispose();
    });

    it(`${id} ${m}: the circle stays where it was placed (a player who walks in later is hit there)`, async () => {
      const { w, p, tel } = await toTelegraph();
      // Leave, then come back before the active tick: the circle didn't follow.
      const windup = move(id, m).windup;
      const evs = stepN(w, windup + move(id, m).active, (i) => (i < 8 ? cmd({ move: { x: 1, y: 0 } }) : i < 16 ? cmd({ move: { x: -1, y: 0 } }) : idle()));
      expect(flatDist(p.tf.pos, tel.at!)).toBeLessThan(radius);
      expect(hitsOn(evs, p.id).map((x) => x.ev.move)).toEqual([m]);
      w.dispose();
    });
  }
});

describe('Hex Wisp', () => {
  it('Homing Hex turns toward the player (at most 1.6 rad/s); a coin does not', async () => {
    for (const [id, m, homing] of [
      ['wisp', 'homingHex', true],
      ['slinger', 'coinBurst', false],
    ] as const) {
      const { w, p } = await combatWorld();
      const e = w.spawnEnemy(id, { x: 0, y: 0, z: 14 }, Math.PI);
      forceEnemyAttack(e, m);
      stepUntil(w, (ev) => ev.some((x) => x.type === 'fire' && x.entity === e.id), 60);
      const shot = w.entities.find((x) => x.projectile?.owner === e.id)!;
      teleport(w, p, { x: 4, y: 0, z: 0 }); // the player steps aside
      const yaw0 = velYaw(shot);
      const off0 = Math.abs(wrapAngle(Math.atan2(p.tf.pos.x - shot.tf.pos.x, p.tf.pos.z - shot.tf.pos.z) - yaw0));
      let prev = { ...shot.tf.vel };
      for (let i = 0; i < 20; i++) {
        step(w);
        const v = shot.tf.vel;
        const cos = (v.x * prev.x + v.y * prev.y + v.z * prev.z) / (Math.hypot(v.x, v.y, v.z) * Math.hypot(prev.x, prev.y, prev.z));
        expect(Math.acos(Math.min(1, cos)), `${id} tick ${i}`).toBeLessThanOrEqual(1.6 / 60 + 1e-6);
        prev = { ...v };
      }
      const off1 = Math.abs(wrapAngle(Math.atan2(p.tf.pos.x - shot.tf.pos.x, p.tf.pos.z - shot.tf.pos.z) - velYaw(shot)));
      if (homing) {
        expect(Math.abs(wrapAngle(velYaw(shot) - yaw0)), id).toBeGreaterThan(0.2);
        expect(off1, id).toBeLessThan(off0);
      } else expect(velYaw(shot), id).toBeCloseTo(yaw0, 9);
      w.dispose();
    }
  });

  it('blinks 6 m away from the player after taking 2 melee hits', async () => {
    const { w, p } = await combatWorld();
    const wisp = w.spawnEnemy('wisp', { x: 0, y: 0, z: 1.6 }, Math.PI);
    // Held in place for the first hit (this close it backs straight off); the hits' hitstun takes over.
    wisp.combat!.action = { kind: 'stagger', t: 0, dur: 9999 };
    const evs = stepN(w, 90, (i) => (i === 0 || i === 22 ? press(BTN.light) : idle()));
    const hits = hitsOn(evs, wisp.id);
    expect(hits.map((x) => x.ev.move)).toEqual(['light1', 'light2']);
    const blinks = evOf(evs, 'blink', wisp.id);
    expect(blinks.length).toBe(1);
    const [b] = blinks;
    expect(b.tick).toBeGreaterThan(hits[1].tick);
    expect(flatDist(b.ev.from, b.ev.to)).toBeCloseTo(6, 6);
    expect(flatDist(b.ev.to, p.tf.pos)).toBeGreaterThan(flatDist(b.ev.from, p.tf.pos) + 5);
    expect(wisp.brain!.meleeHitsTaken).toBe(0);
    w.dispose();
  });

  it('spell hits do not count toward the blink', async () => {
    const { w } = await combatWorld();
    const wisp = w.spawnEnemy('wisp', { x: 0, y: 0, z: 6 }, Math.PI);
    const evs = stepN(w, 60, (i) => (i === 0 || i === 20 ? press(BTN.spell1) : idle()));
    expect(hitsOn(evs, wisp.id).map((x) => x.ev.move)).toEqual(['bolt', 'bolt']);
    expect(evOf(evs, 'blink').length).toBe(0);
    w.dispose();
  });
});
