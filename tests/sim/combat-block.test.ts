import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../src/content/combat';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, combatWorld, forceEnemyAttack, hitsOn, hold, idle, ofType, press, step, stepN, stepUntil, type TickEvents } from './combatHelpers';

/**
 * Plan §4.3 block and parry. The swinging dummy 1.5 m in front of the player connects on world
 * tick SWING_HIT; raising block on tick SWING_HIT - k means the block is k ticks old at the hit.
 */
const SWING_HIT = 54;
const deg = (d: number) => (d * Math.PI) / 180;

interface Yard {
  w: SimWorld;
  p: Entity;
  d: Entity;
}

async function swingYard(playerYaw = 0): Promise<Yard> {
  const { w, p } = await combatWorld({ yaw: playerYaw });
  const d = w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
  return { w, p, d };
}

/** Run to the end of `last`, holding block on the ticks `blockOn(i)` says, pressing `extra(i)`. */
function play(w: SimWorld, last: number, blockOn: (i: number) => boolean, extra: (i: number) => number = () => 0): TickEvents[] {
  const out: TickEvents[] = [];
  for (let i = w.now; i <= last; i++) {
    const c = blockOn(i) ? hold(BTN.block) : idle();
    const e = extra(i);
    c.pressed |= e;
    c.held |= e;
    for (const ev of step(w, c)) out.push({ tick: i, ev });
  }
  return out;
}

const parries = (evs: TickEvents[]) => ofType(evs, 'parry');
const blocks = (evs: TickEvents[]) => ofType(evs, 'block');

describe('parry (plan §4.3)', () => {
  it('a block raised 0–9 ticks before a frontal melee hit parries it', async () => {
    for (const k of [0, 5, 9]) {
      const { w, p, d } = await swingYard();
      const evs = play(w, SWING_HIT, (i) => i >= SWING_HIT - k);
      expect(parries(evs).map((x) => [x.tick, x.ev.attacker, x.ev.target, x.ev.projectile]), `k=${k}`).toEqual([[SWING_HIT, d.id, p.id, false]]);
      expect(p.vitals!.hp, `k=${k}`).toBe(120);
      w.dispose();
    }
  });

  it('a parry staggers the attacker 60, hit-stops both 10, gives +15 mana and opens the riposte window', async () => {
    const k = 5;
    const { w, p, d } = await swingYard();
    play(w, SWING_HIT - k - 1, () => false);
    p.vitals!.mana = 40;
    const evs = play(w, SWING_HIT, () => true);
    expect(parries(evs).length).toBe(1);
    expect(d.combat!.action).toMatchObject({ kind: 'stagger', t: 0, dur: BLOCK.parryStagger });
    expect(BLOCK.parryStagger).toBe(60);
    expect(p.combat!.hitstop).toBe(10);
    expect(d.combat!.hitstop).toBe(10);
    expect(p.vitals!.mana).toBeCloseTo(40 + 15 + (k + 1) * (1.5 / 60), 6);
    expect(p.combat!.riposteUntil).toBe(SWING_HIT + 40);
    w.dispose();
  });

  it('a heavy within 40 ticks of the parry is a riposte that crits', async () => {
    const { w, p, d } = await swingYard();
    play(w, SWING_HIT, (i) => i >= SWING_HIT - 5);
    // Pressed during the parry freeze: it fires on the first free tick.
    let staggered = false;
    const evs: TickEvents[] = [];
    for (let i = SWING_HIT + 1; i < SWING_HIT + 60; i++) {
      staggered = d.combat!.action?.kind === 'stagger';
      const ev = play(w, i, () => true, (t) => (t === SWING_HIT + 3 ? BTN.heavy : 0));
      evs.push(...ev);
      if (hitsOn(ev, d.id).length) break;
    }
    const [hit] = hitsOn(evs, d.id);
    expect(hit.ev.move).toBe('riposte');
    expect(hit.ev.crit).toBe(true);
    // 20 × 2.5 × 1.5 (crit) = 75 (§4.2 table). The stagger from the parry is not "stunned" (a status).
    expect(staggered).toBe(true);
    expect(hit.ev.damage).toBe(75);
    expect(p.combat!.riposteUntil).toBe(0);
    w.dispose();
  });

  it('the riposte window is 40 ticks: heavy started on parry+39 is a riposte, on parry+40 a plain heavy', async () => {
    for (const [at, want] of [[SWING_HIT + 39, 'riposte'], [SWING_HIT + 40, 'heavy']] as const) {
      const { w, p } = await swingYard();
      play(w, SWING_HIT, (i) => i >= SWING_HIT - 5);
      play(w, at, () => true, (t) => (t === at ? BTN.heavy : 0));
      expect(p.combat!.action, `heavy on parry+${at - SWING_HIT}`).toMatchObject({ kind: 'attack', move: want, t: 0 });
      w.dispose();
    }
  });
});

describe('block (plan §4.3)', () => {
  it('after the parry window a frontal hit is blocked: 20% chip and stamina = poise / 2', async () => {
    for (const k of [10, 25]) {
      const { w, p, d } = await swingYard();
      const evs = play(w, SWING_HIT, (i) => i >= SWING_HIT - k);
      expect(parries(evs), `k=${k}`).toEqual([]);
      expect(blocks(evs).map((x) => [x.tick, x.ev.attacker, x.ev.damage, x.ev.guardBreak]), `k=${k}`).toEqual([[SWING_HIT, d.id, 2, false]]);
      expect(hitsOn(evs, p.id), `k=${k}`).toEqual([]);
      expect(p.vitals!.hp, `k=${k}`).toBe(120 - 2); // round(8 × 0.2) = 2
      expect(p.vitals!.stamina, `k=${k}`).toBe(100 - 10 / 2); // swing poise 10; no regen while blocking
      expect(p.combat!.action?.kind, `k=${k}`).toBe('block');
      w.dispose();
    }
  });

  it('only the 150° frontal arc blocks: 70° off is blocked, 80° off and behind are hits', async () => {
    for (const [yaw, blocked] of [[deg(70), true], [deg(-70), true], [deg(80), false], [deg(180), false]] as const) {
      const { w, p } = await swingYard(yaw);
      // Inside what would be the parry window: from behind it must not parry either.
      const evs = play(w, SWING_HIT, (i) => i >= SWING_HIT - 5);
      const label = `yaw ${(yaw * 180) / Math.PI}°`;
      if (blocked) {
        expect(parries(evs).length, label).toBe(1);
      } else {
        expect(parries(evs), label).toEqual([]);
        expect(blocks(evs), label).toEqual([]);
        expect(hitsOn(evs, p.id).map((x) => x.ev.damage), label).toEqual([8]);
        expect(p.combat!.action?.kind, label).toBe('hitstun');
      }
      w.dispose();
    }
  });

  it('re-raising within 20 ticks of the last raise gives only a 4-tick parry window', async () => {
    const reraise = async (first: number, again: number) => {
      const { w, p } = await swingYard();
      const evs = play(w, SWING_HIT, (i) => i === SWING_HIT - first || i >= SWING_HIT - again);
      const parryTicks = p.combat!.action?.kind === 'block' ? p.combat!.action.parryTicks : -1;
      w.dispose();
      return { parried: parries(evs).length === 1, blocked: blocks(evs).length === 1, parryTicks };
    };
    // Raised for one tick, lowered, raised again 8 ticks after the first raise.
    expect(await reraise(13, 5)).toEqual({ parried: false, blocked: true, parryTicks: 4 });
    expect(await reraise(11, 3)).toEqual({ parried: true, blocked: false, parryTicks: 4 });
    // 22 ticks after the first raise (21 after lowering) the full window is back.
    expect(await reraise(31, 9)).toEqual({ parried: true, blocked: false, parryTicks: 10 });
  });

  it("the Brute's slam is unblockable (even in the parry window); its punch is not", async () => {
    const probe = async (move: string) => {
      const { w, p } = await combatWorld();
      const b = w.spawnEnemy('brute', { x: 0, y: 0, z: 2.2 }, Math.PI);
      forceEnemyAttack(b, move);
      return { w, p, b };
    };
    for (const move of ['slam', 'punch']) {
      const pr = await probe(move);
      const hitAt = stepUntil(pr.w, (ev) => ev.some((e) => e.type === 'hit' && e.target === pr.p.id), 120);
      pr.w.dispose();
      const { w, p, b } = await probe(move);
      const evs = play(w, hitAt, (i) => i >= hitAt - 5);
      if (move === 'slam') {
        expect(parries(evs)).toEqual([]);
        expect(blocks(evs)).toEqual([]);
        const [hit] = hitsOn(evs, p.id);
        expect(hit.ev.attacker).toBe(b.id);
        expect(hit.ev.damage).toBe(Math.round(45 * 1.05)); // level 2 vs 1: +5%
      } else {
        expect(parries(evs).map((x) => x.ev.attacker)).toEqual([b.id]);
        expect(hitsOn(evs, p.id)).toEqual([]);
      }
      w.dispose();
    }
  });
});

describe('projectile parry (plan §4.3)', () => {
  it('a parried coin is reflected at the shooter at 1.5× speed and damage, and hits it', async () => {
    const setup = async () => {
      const { w, p } = await combatWorld();
      const s = w.spawnEnemy('dummy_shooter', { x: 0, y: 0, z: 8 }, Math.PI);
      return { w, p, s };
    };
    const probe = await setup();
    const isPlayerHit = (ev: SimEvent[]) => ev.some((e) => e.type === 'hit' && e.target === probe.p.id);
    const hitAt = stepUntil(probe.w, isPlayerHit, 200);
    probe.w.dispose();

    const { w, p, s } = await setup();
    const evs = play(w, hitAt, (i) => i >= hitAt - 5);
    const [parry] = parries(evs);
    expect(parry.ev.projectile).toBe(true);
    expect(parry.ev.attacker).toBe(s.id);
    expect(p.vitals!.hp).toBe(120);
    // No melee stagger for the shooter from a projectile parry.
    expect(s.combat!.action?.kind).not.toBe('stagger');

    const coin = w.entities.find((e) => e.projectile)!;
    const pr = coin.projectile!;
    expect(pr.reflected).toBe(true);
    expect(pr.team).toBe('player');
    expect(pr.owner).toBe(p.id);
    expect(pr.damage).toBe(6 * 1.5);
    expect(pr.kind).toBe('physical');
    expect(Math.hypot(coin.tf.vel.x, coin.tf.vel.y, coin.tf.vel.z)).toBeCloseTo(14 * 1.5, 9);
    const toShooter = { x: s.tf.pos.x - coin.tf.pos.x, z: s.tf.pos.z - coin.tf.pos.z };
    expect(coin.tf.vel.x * toShooter.x + coin.tf.vel.z * toShooter.z).toBeGreaterThan(0);

    const back = stepN(w, 60, () => hold(BTN.block));
    const [hit] = hitsOn(back, s.id);
    expect(hit).toBeDefined();
    expect(hit.ev.attacker).toBe(p.id);
    expect(hit.ev.move).toBe('projectile');
    expect(hit.ev.kind).toBe('physical');
    expect(hit.ev.damage).toBe(9);
    expect(s.vitals!.hp).toBe(400 - 9);
    expect(w.entities.some((e) => e.projectile && e.id === coin.id)).toBe(false);
    w.dispose();
  });

  it('a coin that hits a block after the parry window is blocked and destroyed, not reflected', async () => {
    const setup = async () => {
      const { w, p } = await combatWorld();
      const s = w.spawnEnemy('dummy_shooter', { x: 0, y: 0, z: 8 }, Math.PI);
      return { w, p, s };
    };
    const probe = await setup();
    const hitAt = stepUntil(probe.w, (ev) => ev.some((e) => e.type === 'hit' && e.target === probe.p.id), 200);
    probe.w.dispose();
    const { w, p, s } = await setup();
    const evs = play(w, hitAt, (i) => i >= hitAt - 20);
    expect(parries(evs)).toEqual([]);
    expect(blocks(evs).map((x) => x.ev.attacker)).toEqual([s.id]);
    expect(p.vitals!.hp).toBe(120 - 1); // round(6 × 0.2) = 1
    expect(w.entities.some((e) => e.projectile)).toBe(false);
    w.dispose();
  });
});

describe('press-only block', () => {
  it('a block press raises the guard the same tick', async () => {
    const { w, p } = await combatWorld();
    step(w, press(BTN.block));
    expect(p.combat!.action).toMatchObject({ kind: 'block', t: 0, parryTicks: BLOCK.parryTicks });
    w.dispose();
  });
});
