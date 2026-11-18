import { describe, expect, it } from 'vitest';
import { HITSTOP_CAP, PLAYER_MOVES } from '../../src/content/combat';
import { addHitstop, resolveHit, type HitInfo } from '../../src/sim/combat/hits';
import type { CombatCtx } from '../../src/sim/combat/playerCombat';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, attack, combatWorld, hitsOn, idle, press, step, stepN } from './combatHelpers';

/** Plan §1 pillar: hit-stop freezes attacker and victim; overlaps take the max, capped at 10. */

function ctxOf(w: SimWorld): CombatCtx {
  return { now: w.now, entities: w.entities, get: (id) => w.get(id), events: [], motion: new Map(), frozen: new Set() };
}

const hitInfo = (over: Partial<HitInfo>): HitInfo => ({
  move: 'test', base: 10, kind: 'physical', poise: 0, hitstun: 0, knockdown: false, pushback: 0, hitstop: 3,
  unblockable: false, heavy: false, crit: false, mana: 0, from: { x: 0, y: 0, z: 0 }, projectile: false, ...over,
});

describe('hit-stop', () => {
  it('a light hit freezes the player and the dummy for exactly the move hit-stop (3)', async () => {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    // A swinging dummy 6 m away keeps counting down its timer: nothing freezes the world.
    const other = w.spawnEnemy('dummy_swing', { x: -6, y: 0, z: 0 }, Math.PI / 2);
    const evs = stepN(w, 13, (i) => (i === 0 ? press(BTN.light) : idle()));
    const [hit] = hitsOn(evs, d.id);
    expect(hit.tick).toBe(12);
    expect(hit.ev.hitstop).toBe(PLAYER_MOVES.light1.hitstop);
    expect(p.combat!.hitstop).toBe(3);
    expect(d.combat!.hitstop).toBe(3);
    const clip = attack(p)!.clipT;
    const stun = d.combat!.action!;
    expect(stun.kind).toBe('hitstun');
    const pPos = { ...p.tf.pos }, dPos = { ...d.tf.pos };
    for (let i = 0; i < 3; i++) {
      const timer = other.brain!.timer;
      step(w);
      expect(attack(p)!.clipT, `frozen tick ${i}`).toBe(clip);
      expect(stun.t, `frozen tick ${i}`).toBe(0);
      expect(p.tf.pos).toEqual(pPos);
      expect(d.tf.pos).toEqual(dPos);
      expect(p.combat!.hitstop).toBe(2 - i);
      expect(other.brain!.timer).toBe(timer - 1);
    }
    step(w);
    expect(attack(p)!.clipT).toBe(clip + 1);
    expect(stun.t).toBe(1);
    w.dispose();
  });

  it('light3 (finisher) hit-stop is 8', async () => {
    const { w } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const evs = stepN(w, 100, (i) => (i === 0 || i === 22 || i === 46 ? press(BTN.light) : idle()));
    expect(hitsOn(evs, d.id).map((x) => [x.ev.move, x.ev.hitstop])).toEqual([['light1', 3], ['light2', 3], ['light3', 8]]);
    w.dispose();
  });

  it('overlapping hit-stops take the max, never the sum, capped at HITSTOP_CAP (10)', async () => {
    const { w } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 5 }, Math.PI);
    expect(HITSTOP_CAP).toBe(10);
    addHitstop(d, 6);
    addHitstop(d, 3);
    expect(d.combat!.hitstop).toBe(6);
    addHitstop(d, 8);
    expect(d.combat!.hitstop).toBe(8);
    addHitstop(d, 8);
    expect(d.combat!.hitstop).toBe(8);
    addHitstop(d, 25);
    expect(d.combat!.hitstop).toBe(10);
    w.dispose();
  });

  it('two hits landing on a frozen target take the max through resolveHit', async () => {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 5 }, Math.PI);
    const ctx = ctxOf(w);
    resolveHit(ctx, p, d, hitInfo({ hitstop: 8, from: { ...p.tf.pos } }));
    expect(d.combat!.hitstop).toBe(8);
    expect(p.combat!.hitstop).toBe(8);
    resolveHit(ctx, p, d, hitInfo({ hitstop: 6, from: { ...p.tf.pos } }));
    expect(d.combat!.hitstop).toBe(8);
    resolveHit(ctx, p, d, hitInfo({ hitstop: 9, from: { ...p.tf.pos } }));
    resolveHit(ctx, p, d, hitInfo({ hitstop: 9, from: { ...p.tf.pos } }));
    expect(d.combat!.hitstop).toBe(9);
    resolveHit(ctx, p, d, hitInfo({ hitstop: 40, from: { ...p.tf.pos } }));
    expect(d.combat!.hitstop).toBe(10);
    expect(p.combat!.hitstop).toBe(10);
    w.dispose();
  });

  it('one swing that hits two dummies on the same tick freezes the player for 3, not 6', async () => {
    const { w, p } = await combatWorld();
    // light1's tick-12 staff runs from behind the player's back to 1.15 m in front of it.
    const front = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const back = w.spawnEnemy('dummy_passive', { x: -0.2, y: 0, z: -1.2 }, 0);
    const evs = stepN(w, 13, (i) => (i === 0 ? press(BTN.light) : idle()));
    const ticks = [...hitsOn(evs, front.id), ...hitsOn(evs, back.id)].map((x) => x.tick);
    expect(ticks).toEqual([12, 12]);
    expect(p.combat!.hitstop).toBe(3);
    w.dispose();
  });
});
