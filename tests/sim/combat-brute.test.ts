import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { flatDist, yawTo } from '../../src/sim/combat/geometry';
import { BTN, cmd, combatWorld, forceEnemyAttack, hitsOn, idle, ofType, press, step, stepN, teleport } from './combatHelpers';

/** The Thornwood Brute (plan §4.8–4.9): elite, hyper armor on heavies, leash, move variety. */
const BRUTE = ENEMIES.brute;

describe('Brute', () => {
  it('hyper armor: a player light during the kick or slam wind-up does not interrupt it', async () => {
    for (const move of ['kick', 'slam']) {
      const { w, p } = await combatWorld();
      const b = w.spawnEnemy('brute', { x: 0, y: 0, z: 2.0 }, Math.PI);
      forceEnemyAttack(b, move);
      const def = BRUTE.moves.find((m) => m.id === move)!;
      expect(def.hyperArmor).toBe(true);
      const evs = stepN(w, def.windup + def.active + 5, (i) => (i === 0 ? press(BTN.light) : idle()));
      const [hit] = hitsOn(evs, b.id);
      expect(hit.ev.move, move).toBe('light1');
      expect(hit.tick, move).toBeLessThan(def.windup);
      expect(hit.ev.damage, move).toBe(19); // 20 × 0.95 (level 1 vs 2)
      // Still in its move after the hit, and it lands.
      const swings = ofType(evs, 'swing').filter((x) => x.ev.entity === b.id).map((x) => x.ev.move);
      expect(swings, move).toEqual([move]);
      expect(hitsOn(evs, p.id).map((x) => x.ev.move), move).toEqual([move]);
      w.dispose();
    }
  });

  it('elite: a light during the punch wind-up (no hyper armor) does not cause hitstun', async () => {
    const { w } = await combatWorld();
    const b = w.spawnEnemy('brute', { x: 0, y: 0, z: 2.0 }, Math.PI);
    forceEnemyAttack(b, 'punch');
    const evs = stepN(w, 16, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(evs, b.id).length).toBe(1);
    expect(b.combat!.action).toMatchObject({ kind: 'attack', move: 'punch' });
    expect(b.combat!.poise).toBe(BRUTE.poise - 10);
    w.dispose();
  });

  it('when its poise breaks it staggers (staggerTicks 70) and poise refills', async () => {
    const { w } = await combatWorld();
    const b = w.spawnEnemy('brute', { x: 0, y: 0, z: 2.0 }, Math.PI);
    forceEnemyAttack(b, 'kick'); // even through hyper armor
    b.combat!.poise = 5;
    b.combat!.poiseDelay = 999; // else vitals() refills it at the end of the tick
    const evs = stepN(w, 14, (i) => (i === 0 ? press(BTN.light) : idle()));
    const hit = hitsOn(evs, b.id)[0];
    expect(hit).toBeDefined();
    expect(ofType(evs, 'stagger').map((x) => [x.tick, x.ev.entity, x.ev.ticks])).toEqual([[hit.tick, b.id, BRUTE.staggerTicks]]);
    expect(b.combat!.action).toMatchObject({ kind: 'stagger', dur: 70 });
    expect(b.combat!.poise).toBe(BRUTE.poise);
    w.dispose();
  });

  it('dragged beyond 35 m from home it leashes: walks home at 2× speed, heals, ignores the player', async () => {
    const home = { x: 0, y: 0, z: 30 };
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 70 } });
    const b = w.spawnEnemy('brute', home, Math.PI);
    teleport(w, b, { x: 0, y: 0, z: 68 });
    b.vitals!.hp = 50;
    let telegraphs = 0;
    const startZ = b.tf.pos.z;
    step(w);
    expect(b.brain!.state).toBe('leash');
    const hps: number[] = [];
    for (let i = 0; i < 600 && b.brain!.state === 'leash'; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      const ev = step(w);
      telegraphs += ev.filter((e) => e.type === 'telegraph').length;
      hps.push(b.vitals!.hp);
      if (i === 30) {
        // 2× move speed once turned toward home.
        expect((startZ - b.tf.pos.z) / 31).toBeGreaterThan(((BRUTE.moveSpeed * 2) / 60) * 0.8);
      }
    }
    expect(telegraphs).toBe(0);
    expect(hps[10]).toBeGreaterThan(50);
    expect(b.brain!.state).toBe('idle');
    expect(flatDist(b.tf.pos, home)).toBeLessThan(1);
    expect(b.vitals!.hp).toBe(BRUTE.hp);
    w.dispose();
  });

  it('kited: once the player is beyond the leash it stops chasing and goes home', async () => {
    const home = { x: 6, y: 0, z: 0 }; // x = 6: a lane clear of the step boxes and pillars
    const { w, p } = await combatWorld({ pos: { x: 6, y: 0, z: 5 } });
    const b = w.spawnEnemy('brute', home, 0);
    step(w);
    expect(b.brain!.state).toBe('engage');
    // Sprint straight away (+Z) until well past the leash, then wait.
    const run = cmd({ move: { x: 0, y: 1 }, hold: BTN.sprint });
    let maxFromHome = 0;
    for (let i = 0; i < 900; i++) {
      step(w, p.tf.pos.z < BRUTE.leashRange + 8 ? run : idle());
      maxFromHome = Math.max(maxFromHome, flatDist(b.tf.pos, home));
    }
    expect(p.tf.pos.z).toBeGreaterThan(BRUTE.leashRange);
    expect(b.brain!.state).not.toBe('engage');
    expect(b.brain!.target).toBeNull();
    expect(flatDist(b.tf.pos, home)).toBeLessThan(1.2);
    expect(maxFromHome).toBeGreaterThan(10);
    w.dispose();
  });

  /**
   * Kited: when the player escapes past the leash radius, the Brute switches to Leash (2× speed,
   * heals, ignores the player) rather than strolling home at full damage. (Was a bug: it took the
   * no-target branch and never healed.) Plan §4.8 HFSM.
   */
  it('kited and damaged, it is back to full HP once home', async () => {
    const { w, p } = await combatWorld({ pos: { x: 6, y: 0, z: 5 } });
    const b = w.spawnEnemy('brute', { x: 6, y: 0, z: 0 }, 0);
    b.vitals!.hp = 100;
    const run = cmd({ move: { x: 0, y: 1 }, hold: BTN.sprint });
    for (let i = 0; i < 900; i++) step(w, p.tf.pos.z < BRUTE.leashRange + 8 ? run : idle());
    expect(flatDist(b.tf.pos, b.brain!.home)).toBeLessThan(1.2);
    expect(b.vitals!.hp).toBe(BRUTE.hp);
    w.dispose();
  });

  it('never uses the same move three times running over a long fight (seeds 1–5)', async () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { w, p } = await combatWorld({ seed });
      const b = w.spawnEnemy('brute', { x: 0, y: 0, z: 3 }, Math.PI);
      const moves: string[] = [];
      for (let i = 0; i < 3000; i++) {
        // Nobody dies (a respawn would reset the Brute's move history).
        p.vitals!.hp = p.vitals!.hpMax;
        b.vitals!.hp = b.vitals!.hpMax;
        // The player keeps walking into melee range and swinging. (Against a player who stands
        // still the Brute never kicks: it attacks as soon as punch or slam is in range, ~2.65 m,
        // so it never closes to the kick's 2.5 m.)
        const d = flatDist(p.tf.pos, b.tf.pos);
        const c = cmd({ camYaw: yawTo(p.tf.pos, b.tf.pos), move: { x: 0, y: d > 1.7 ? 1 : 0 }, press: i % 30 === 0 ? BTN.light : 0 });
        for (const e of step(w, c)) if (e.type === 'telegraph' && e.entity === b.id) moves.push(e.move);
      }
      expect(moves.length, `seed ${seed}`).toBeGreaterThan(20);
      expect(new Set(moves), `seed ${seed}`).toEqual(new Set(['punch', 'kick', 'slam']));
      for (let i = 2; i < moves.length; i++) {
        expect(moves[i] === moves[i - 1] && moves[i] === moves[i - 2], `seed ${seed}: ${moves.slice(i - 2, i + 1).join(',')} at ${i}`).toBe(false);
      }
      w.dispose();
    }
  });
});
