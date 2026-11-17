import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { TOKENS } from '../../src/sim/ai/brain';
import { flatDist } from '../../src/sim/combat/geometry';
import type { InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, cmd, combatWorld, forceEnemyAttack, idle, step } from './combatHelpers';
import { inWindup, isAttacking, keepAlive, tokens } from './m1bHelpers';

/**
 * The M1b acceptance test for attack tokens (plan §4.8): per player, 2 melee and 1 ranged; a
 * Brute heavy costs 2; token-less melee enemies wait at 4–7 m.
 */

const CENTRE = { x: 0, y: 0, z: 30 };

/** `defs` spawned in a 6 m ring around a player at CENTRE. */
async function ring(defs: string[], seed = 1): Promise<{ w: SimWorld; p: Entity; es: Entity[] }> {
  const { w, p } = await combatWorld({ pos: CENTRE, seed });
  const es = defs.map((d, i) => w.spawnEnemy(d, { x: CENTRE.x + Math.sin(i * 1.3) * 6, y: 0, z: CENTRE.z + Math.cos(i * 1.3) * 6 }, 0));
  return { w, p, es };
}

/**
 * The player wanders (2 s walking in a slowly turning direction, 2 s standing and swinging) so the
 * enemies keep repositioning, leaping and attacking from all sides.
 */
function wander(t: number): InputCommand {
  const walking = t % 240 < 120;
  return cmd({ camYaw: t / 200, move: { x: 0, y: walking ? 0.6 : 0 }, press: !walking && t % 37 === 0 ? BTN.light : 0 });
}

describe('attack tokens (plan §4.8, M1b acceptance)', () => {
  it('TOKENS: 2 melee, 1 ranged; every archetype uses them and every move takes one', () => {
    expect(TOKENS).toEqual({ melee: 2, ranged: 1 });
    for (const id of ['grunt', 'slinger', 'wisp', 'brute']) {
      expect(ENEMIES[id].usesTokens, id).toBe(true);
      for (const m of ENEMIES[id].moves) expect(m.token, `${id} ${m.id}`).toBeDefined();
    }
    expect(ENEMIES.brute.moves.map((m) => [m.id, m.token!.cost])).toEqual([['punch', 1], ['kick', 2], ['slam', 2]]);
  });

  it('5 Grunts around one player for 10,000 ticks: never more than 2 melee attacks (or wind-ups) at once', async () => {
    const { w, p, es } = await ring(['grunt', 'grunt', 'grunt', 'grunt', 'grunt']);
    let maxTokens = 0, maxAttacking = 0, maxWindups = 0, telegraphs = 0;
    for (let t = 0; t < 10_000; t++) {
      keepAlive(w);
      for (const e of step(w, wander(t))) if (e.type === 'telegraph') telegraphs++;
      const used = tokens(w, p, 'melee');
      const attacking = es.filter(isAttacking).length;
      const windups = es.filter(inWindup).length;
      if (used > TOKENS.melee || attacking > TOKENS.melee || windups > TOKENS.melee) {
        throw new Error(`tick ${t}: tokens ${used}, attacking ${attacking}, wind-ups ${windups}`);
      }
      // Every grunt attack is a 1-token move aimed at the only player: the two counts agree.
      expect(used).toBe(attacking);
      maxTokens = Math.max(maxTokens, used);
      maxAttacking = Math.max(maxAttacking, attacking);
      maxWindups = Math.max(maxWindups, windups);
    }
    // The cap was actually reached, many times over.
    expect([maxTokens, maxAttacking, maxWindups]).toEqual([2, 2, 2]);
    expect(telegraphs).toBeGreaterThan(30);
    w.dispose();
  }, 20_000); // 10,000 simulated ticks: room for when the whole suite runs in parallel

  it('3 Slingers: never more than 1 ranged attack at once', async () => {
    const { w, p, es } = await ring(['slinger', 'slinger', 'slinger']);
    let max = 0, telegraphs = 0;
    for (let t = 0; t < 10_000; t++) {
      keepAlive(w);
      for (const e of step(w, wander(t))) if (e.type === 'telegraph') telegraphs++;
      const used = tokens(w, p, 'ranged');
      const attacking = es.filter(isAttacking).length;
      if (used > TOKENS.ranged || attacking > TOKENS.ranged) throw new Error(`tick ${t}: tokens ${used}, attacking ${attacking}`);
      max = Math.max(max, attacking);
    }
    expect(max).toBe(1);
    expect(telegraphs).toBeGreaterThan(100);
    w.dispose();
  });

  it('melee and ranged pools are separate: a Slinger may shoot while 2 Grunts swing', async () => {
    const { w, p, es } = await ring(['grunt', 'grunt', 'slinger', 'slinger']);
    let both = 0;
    for (let t = 0; t < 5000; t++) {
      keepAlive(w);
      step(w, wander(t));
      const m = tokens(w, p, 'melee'), r = tokens(w, p, 'ranged');
      if (m > TOKENS.melee || r > TOKENS.ranged) throw new Error(`tick ${t}: melee ${m}, ranged ${r}`);
      if (m === 2 && r === 1) both++;
    }
    expect(both).toBeGreaterThan(0);
    expect(es.length).toBe(4);
    w.dispose();
  });

  it('a Brute heavy (kick, slam: cost 2) starts only when no other melee token is in use', async () => {
    const { w, p, es } = await ring(['brute', 'grunt', 'grunt']);
    const brute = es[0];
    let heavies = 0, punchesWithAGrunt = 0;
    for (let t = 0; t < 5000; t++) {
      keepAlive(w);
      const before = es.filter((e) => e !== brute && isAttacking(e)).length;
      for (const e of step(w, wander(t))) {
        if (e.type !== 'telegraph' || e.entity !== brute.id) continue;
        const othersNow = es.filter((x) => x !== brute && isAttacking(x)).length;
        if (e.move === 'kick' || e.move === 'slam') {
          heavies++;
          // The brain runs in entity order and the Brute is first: nobody else was attacking.
          expect(before, `tick ${t}: ${e.move} with ${before} grunt(s) attacking`).toBe(0);
          expect(othersNow, `tick ${t}`).toBe(0);
        } else if (before > 0) punchesWithAGrunt++;
      }
      const used = tokens(w, p, 'melee');
      if (used > TOKENS.melee) throw new Error(`tick ${t}: melee tokens ${used}`);
    }
    expect(heavies).toBeGreaterThan(5);
    // A punch (cost 1) can share the pool with one Grunt.
    expect(punchesWithAGrunt).toBeGreaterThan(0);
    w.dispose();
  });

  it('a token-less Grunt in leap range waits in the 4–7 m band and circles instead of attacking', async () => {
    const { w, p } = await combatWorld({ pos: CENTRE });
    const holders = [w.spawnEnemy('grunt', { x: 3, y: 0, z: 30 }, -Math.PI / 2), w.spawnEnemy('grunt', { x: -3, y: 0, z: 30 }, Math.PI / 2)];
    const c = w.spawnEnemy('grunt', { x: 0, y: 0, z: 35.35 }, Math.PI); // gap 5: the leap is in range
    const yaw0 = Math.atan2(c.tf.pos.x - p.tf.pos.x, c.tf.pos.z - p.tf.pos.z);
    for (let t = 0; t < 180; t++) {
      for (const h of holders) forceEnemyAttack(h, 'swipe'); // they hold both tokens
      keepAlive(w);
      for (const e of step(w, idle())) expect(e.type === 'telegraph' && e.entity === c.id, `tick ${t}`).toBe(false);
      const gap = flatDist(c.tf.pos, p.tf.pos) - p.body!.radius;
      expect(gap, `tick ${t}`).toBeGreaterThanOrEqual(3.5);
      expect(gap, `tick ${t}`).toBeLessThanOrEqual(7.5);
    }
    const yaw1 = Math.atan2(c.tf.pos.x - p.tf.pos.x, c.tf.pos.z - p.tf.pos.z);
    expect(Math.abs(yaw1 - yaw0)).toBeGreaterThan(0.3); // it circled
    w.dispose();
  });

  /**
   * SIM BUG: plan §4.8 "Enemies without one [a token] circle at 4–7 m and feint." The wait band
   * only applies while a move is in range (brain.ts fighterThink: `options.length && !allowed.length`).
   * A token-less Grunt inside swipe range backs off only until it leaves swipe range (1.5 m), then
   * the "close in" branch walks it straight back: it hovers at ~1.5 m instead of 4–7 m.
   * Minimal scenario: two Grunts hold both melee tokens (wind-ups re-forced every tick); a third
   * starts 1 m from the player. After 3 s it should be in the 4–7 m band; it is at ~1.5 m.
   * (Over a 4000-tick, 5-Grunt fight, only ~13% of waiting-Grunt samples are in 3.5–7.5 m.)
   */
  it('a token-less Grunt that starts close backs off into the 4–7 m band', async () => {
    const { w, p } = await combatWorld({ pos: CENTRE });
    const holders = [w.spawnEnemy('grunt', { x: 3, y: 0, z: 30 }, -Math.PI / 2), w.spawnEnemy('grunt', { x: -3, y: 0, z: 30 }, Math.PI / 2)];
    const c = w.spawnEnemy('grunt', { x: 0, y: 0, z: 31.35 }, Math.PI);
    for (let t = 0; t < 180; t++) {
      for (const h of holders) forceEnemyAttack(h, 'swipe');
      keepAlive(w);
      step(w, idle());
      expect(tokens(w, p, 'melee')).toBe(2);
    }
    const gap = flatDist(c.tf.pos, p.tf.pos) - p.body!.radius;
    expect(gap).toBeGreaterThanOrEqual(3.5);
    expect(gap).toBeLessThanOrEqual(7.5);
    w.dispose();
  });

  /**
   * SIM BUG: plan §4.8 "Attack choice: … No move more than twice in a row" combined with the
   * Grunt's moveset (swipe: range 1.5; leap: minRange 3) stalls a Grunt for good. After two
   * swipes, `recent` is [swipe, swipe] so swipe is never `ready`; the leap needs ≥ 3 m but the
   * Grunt closes to 0.9 m ("close in until just inside the shortest reach") and stands there.
   * It never attacks a player who stands still again (§4.8 Engage{… | Attack | …}; §4.9 "melee swarm").
   * Minimal scenario: one Grunt 1.2 m from a player who stands still; 25 s; it telegraphs twice.
   */
  it('a lone Grunt keeps attacking a player who stands still', async () => {
    const { w, p } = await combatWorld({ pos: CENTRE });
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 31.2 }, Math.PI);
    const moves: string[] = [];
    for (let t = 0; t < 1500; t++) {
      keepAlive(w);
      for (const e of step(w, idle())) if (e.type === 'telegraph' && e.entity === g.id) moves.push(e.move);
    }
    expect(p.combat!.action?.kind).not.toBe('dead');
    expect(moves.length).toBeGreaterThanOrEqual(10);
    w.dispose();
  });
});
