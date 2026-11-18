import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { STATUS } from '../../src/content/statuses';
import { kill, resolveHit, type HitInfo } from '../../src/sim/combat/hits';
import { applyStatus } from '../../src/sim/combat/statuses';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, combatWorld, forceEnemyAttack, hitsOn, idle, ofType, press, step, stepN } from './combatHelpers';
import { ctxOf, evOf } from './m1bHelpers';

/** Plan §4.7 statuses, scaled by the target's status affinity (§4.6): weak ×1.5, resist ×0.5. */

const FAR = { x: 0, y: 0, z: 40 }; // beyond every aggro range from a player at the origin

/** Apply a status from player `p` between ticks; returns the events it emitted. */
function apply(w: SimWorld, target: Entity, id: 'burn' | 'chill' | 'shock', stacks: number, p: Entity) {
  const ctx = ctxOf(w);
  applyStatus(ctx, target, id, stacks, p.id);
  return ctx.events;
}

/** Ticks until `pred` holds after a tick (at most `max`). */
function ticksUntil(w: SimWorld, pred: () => boolean, max = 1000): number {
  for (let i = 1; i <= max; i++) {
    step(w);
    if (pred()) return i;
  }
  throw new Error(`not within ${max} ticks`);
}

describe('Burn: 3% max HP per second for 4 s (plan §4.7)', () => {
  const cases = [
    { id: 'dummy_passive', aff: 'normal', k: 1 },
    { id: 'grunt', aff: 'weak', k: 1.5 },
    { id: 'brute', aff: 'resist', k: 0.5 },
  ] as const;
  for (const { id, aff, k } of cases) {
    it(`${id} (${aff}): ${(3 * k).toFixed(2)}%/s for ${4 * k} s`, async () => {
      const { w, p } = await combatWorld();
      const e = w.spawnEnemy(id, FAR, 0);
      const hp = ENEMIES[id].hp;
      expect(apply(w, e, 'burn', 1, p)).toEqual([{ type: 'status', entity: e.id, status: 'burn', stacks: 1, affinity: aff }]);
      const ticks = Math.round(STATUS.burn.ticks * k);
      const evs = stepN(w, ticks - 1);
      expect(e.statuses?.burn).toBeDefined();
      expect(hp - e.vitals!.hp).toBeCloseTo((STATUS.burn.dps * hp * k * (ticks - 1)) / 60, 6);
      evs.push(...stepN(w, 1));
      expect(evOf(evs, 'statusEnd', e.id).map((x) => [x.tick, x.ev.status])).toEqual([[ticks - 1, 'burn']]);
      expect(e.statuses?.burn).toBeUndefined();
      expect(hp - e.vitals!.hp).toBeCloseTo(STATUS.burn.dps * hp * k * 4 * k, 6);
      stepN(w, 30);
      expect(hp - e.vitals!.hp).toBeCloseTo(STATUS.burn.dps * hp * k * 4 * k, 6);
      w.dispose();
    });
  }

  it('refreshes (does not stack) when reapplied', async () => {
    const { w, p } = await combatWorld();
    const e = w.spawnEnemy('dummy_passive', FAR, 0);
    apply(w, e, 'burn', 1, p);
    stepN(w, 100);
    apply(w, e, 'burn', 1, p);
    expect(e.statuses!.burn!.ticks).toBe(STATUS.burn.ticks);
    expect(e.statuses!.burn!.perTick).toBeCloseTo((0.03 * 400) / 60, 9);
    w.dispose();
  });

  it('can kill, and the kill is credited to the caster', async () => {
    const { w, p } = await combatWorld();
    const e = w.spawnEnemy('grunt', FAR, 0);
    e.vitals!.hp = 1;
    apply(w, e, 'burn', 1, p);
    const evs = stepN(w, 120);
    expect(evOf(evs, 'death', e.id).map((x) => x.ev.killer)).toEqual([p.id]);
    expect(e.combat!.action?.kind).toBe('dead');
    expect(e.statuses).toBeUndefined();
    w.dispose();
  });

  it('Blast applies it: a Grunt in the blast burns for 6 s (burn-weak)', async () => {
    const { w } = await combatWorld();
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 5 }, Math.PI);
    const evs = stepN(w, 40, (i) => (i === 0 ? press(BTN.spell2) : idle()));
    const st = evOf(evs, 'status', g.id);
    expect(st.map((x) => [x.ev.status, x.ev.affinity])).toEqual([['burn', 'weak']]);
    // 360 ticks, the first of which is the tick it lands on.
    expect(g.statuses!.burn!.ticks).toBe(360 - (w.now - st[0].tick));
    w.dispose();
  });
});

describe('Chill and Frozen (plan §4.7)', () => {
  const cases = [
    { id: 'grunt', aff: 'normal', frozen: 90, chill: 300 },
    { id: 'wisp', aff: 'resist', frozen: 45, chill: 150 },
  ] as const;
  for (const { id, aff, frozen, chill } of cases) {
    it(`${id} (${aff}): stacks to 3, then Frozen for ${frozen} ticks with no action`, async () => {
      const { w, p } = await combatWorld();
      const e = w.spawnEnemy(id, { x: 0, y: 0, z: 1.6 }, Math.PI); // in reach: it would attack if it could
      expect(apply(w, e, 'chill', 2, p)).toEqual([{ type: 'status', entity: e.id, status: 'chill', stacks: 2, affinity: aff }]);
      expect(e.statuses!.chill).toEqual({ ticks: chill, stacks: 2 });
      const ev = apply(w, e, 'chill', 1, p);
      expect(ev).toEqual([{ type: 'frozen', entity: e.id, ticks: frozen }]);
      expect(e.combat!.action).toEqual({ kind: 'frozen', t: 0, dur: frozen });
      expect(e.statuses!.chill).toBeUndefined(); // freezing uses the chill up
      const evs = stepN(w, frozen - 1);
      expect(e.combat!.action?.kind).toBe('frozen');
      expect(evOf(evs, 'telegraph', e.id).length).toBe(0);
      expect(e.tf.pos.z).toBeCloseTo(1.6, 6); // rooted
      step(w);
      expect(e.combat!.action?.kind).not.toBe('frozen');
      w.dispose();
    });
  }

  it('a chill-weak Brute gets 3 stacks from one Frost Nova and freezes for 135 ticks', async () => {
    const { w, p } = await combatWorld();
    const b = w.spawnEnemy('brute', { x: 0, y: 0, z: 3.5 }, Math.PI);
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.spell3) : idle()));
    expect(evOf(evs, 'nova', p.id).length).toBe(1);
    expect(evOf(evs, 'frozen', b.id).map((x) => [x.tick, x.ev.ticks])).toEqual([[14, 135]]);
    expect(b.combat!.action).toMatchObject({ kind: 'frozen', dur: 135 });
    w.dispose();
  });

  it('a Frost Nova on a normal Grunt leaves 2 stacks (no freeze)', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 3.5 }, Math.PI);
    const evs = stepN(w, 20, (i) => (i === 0 ? press(BTN.spell3) : idle()));
    expect(evOf(evs, 'frozen').length).toBe(0);
    expect(g.statuses?.chill?.stacks).toBe(2);
    expect(evOf(evs, 'nova', p.id).length).toBe(1);
    w.dispose();
  });

  it('a frozen target takes ×1.25 damage', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', FAR, 0);
    apply(w, g, 'chill', 3, p);
    expect(g.combat!.action?.kind).toBe('frozen');
    const ctx = ctxOf(w);
    const info: HitInfo = {
      move: 'test', base: 20, kind: 'arcane', poise: 0, hitstun: 0, knockdown: false, pushback: 0, hitstop: 0, unblockable: true, heavy: false, crit: false, mana: 0, from: { ...p.tf.pos }, projectile: true,
    };
    resolveHit(ctx, p, g, info);
    expect(ctx.events.find((e) => e.type === 'hit')).toMatchObject({ damage: 25 });
    expect(g.combat!.action?.kind).toBe('frozen'); // the hit lands; it doesn't flinch out of the freeze
    w.dispose();
  });

  it('a melee hit on a chilled target deals ×1.3 and consumes the chill; the next hit is normal', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 1.5 }, Math.PI);
    apply(w, g, 'chill', 1, p);
    const evs = stepN(w, 50, (i) => (i === 0 || i === 22 ? press(BTN.light) : idle()));
    expect(hitsOn(evs, g.id).map((x) => [x.ev.move, x.ev.damage])).toEqual([['light1', 26], ['light2', 22]]);
    const first = hitsOn(evs, g.id)[0].tick;
    expect(evOf(evs, 'statusEnd', g.id).map((x) => [x.tick, x.ev.status])).toEqual([[first, 'chill']]);
    expect(g.statuses?.chill).toBeUndefined();
    w.dispose();
  });

  it('a spell hit on a chilled target is not ×1.3 and does not consume the chill', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 5 }, Math.PI);
    apply(w, g, 'chill', 1, p);
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.spell1) : idle()));
    expect(hitsOn(evs, g.id).map((x) => [x.ev.move, x.ev.damage])).toEqual([['bolt', 12]]);
    expect(g.statuses?.chill?.stacks).toBe(1);
    w.dispose();
  });

  /** Ticks from a forced Grunt swipe to its swing (first active tick), with `stacks` of chill. */
  async function swingAfter(id: string, move: string, stacks: number): Promise<number> {
    const { w, p } = await combatWorld();
    const e = w.spawnEnemy(id, FAR, 0);
    if (stacks) apply(w, e, 'chill', stacks, p);
    forceEnemyAttack(e, move);
    const n = ticksUntil(w, () => w.events.some((x) => x.type === 'swing' && x.entity === e.id), 200);
    w.dispose();
    return n;
  }

  it("chill slows an enemy's attack clock by 30% per stack", async () => {
    const windup = ENEMIES.grunt.moves[0].windup; // 20
    expect(await swingAfter('grunt', 'swipe', 0)).toBe(windup);
    expect(Math.abs((await swingAfter('grunt', 'swipe', 1)) - windup / 0.7)).toBeLessThanOrEqual(1);
    expect(Math.abs((await swingAfter('grunt', 'swipe', 2)) - windup / 0.4)).toBeLessThanOrEqual(1);
  });

  it('chill slows movement by 30% per stack', async () => {
    const travelled = async (stacks: number) => {
      const { w, p } = await combatWorld();
      const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 16 }, Math.PI);
      if (stacks) apply(w, g, 'chill', stacks, p);
      stepN(w, 20); // notice, turn and get going
      const z0 = g.tf.pos.z;
      stepN(w, 30);
      const d = z0 - g.tf.pos.z;
      w.dispose();
      return d;
    };
    const free = await travelled(0);
    expect(free).toBeCloseTo((ENEMIES.grunt.moveSpeed * 30) / 60, 1);
    expect((await travelled(1)) / free).toBeCloseTo(0.7, 1);
    expect((await travelled(2)) / free).toBeCloseTo(0.4, 1);
  });

  /**
   * SIM BUG (spec mismatch): plan §4.6 "a weakness multiplies duration and potency by 1.5 (Burn
   * damage per second, Chill slow, Shock poise penalty) … A resistance multiplies by 0.5." The
   * Chill slow is not scaled by affinity (statuses.ts clockTicks/moveScale use slowPerStack as is):
   * a chill-resist Wisp with 1 stack is slowed 30%, not 15%.
   */
  it('a chill-resist Wisp with 1 stack is slowed 15% (×0.5 potency), not 30%', async () => {
    const windup = ENEMIES.wisp.moves[0].windup; // 26
    expect(Math.abs((await swingAfter('wisp', 'homingHex', 1)) - windup / 0.85)).toBeLessThanOrEqual(1);
  });
});

describe('Shock (plan §4.7)', () => {
  async function shockAt(id: string, move: string, t: number) {
    const { w, p } = await combatWorld();
    const e = w.spawnEnemy(id, FAR, 0);
    forceEnemyAttack(e, move);
    stepN(w, t);
    const a = e.combat!.action;
    expect(a).toMatchObject({ kind: 'attack', t });
    const ev = apply(w, e, 'shock', 1, p);
    const action = e.combat!.action;
    w.dispose();
    return { ev, action, p, e };
  }

  it('interrupts a wind-up less than 50% done, with an interrupt event', async () => {
    const { ev, action, p, e } = await shockAt('grunt', 'swipe', 9); // 9 / 20
    expect(ev.filter((x) => x.type === 'interrupt')).toEqual([{ type: 'interrupt', entity: e.id, by: p.id }]);
    expect(action?.kind).toBe('hitstun');
  });

  it('does not interrupt one at or past 50%', async () => {
    for (const t of [10, 15]) {
      const { ev, action } = await shockAt('grunt', 'swipe', t);
      expect(ev.some((e) => e.type === 'interrupt'), `t ${t}`).toBe(false);
      expect(action, `t ${t}`).toMatchObject({ kind: 'attack', move: 'swipe' });
    }
  });

  it('does not interrupt a hyper-armor move (Brute kick, slam), even early', async () => {
    for (const move of ['kick', 'slam']) {
      const { ev, action } = await shockAt('brute', move, 2);
      expect(ev.some((e) => e.type === 'interrupt'), move).toBe(false);
      expect(action, move).toMatchObject({ kind: 'attack', move });
    }
  });

  it("in play: Chain Zap interrupts an elite Brute's early punch (hits alone never flinch an elite)", async () => {
    const { w, p } = await combatWorld();
    const b = w.spawnEnemy('brute', { x: 0, y: 0, z: 4 }, Math.PI);
    const evs = stepN(w, 10, (i) => (i === 0 ? press(BTN.spell4) : idle()));
    forceEnemyAttack(b, 'punch'); // t = 8 of 24 when the zap releases on tick 18
    evs.push(...stepN(w, 10));
    expect(evOf(evs, 'zap', p.id).map((x) => x.ev.targets)).toEqual([[b.id]]);
    expect(evOf(evs, 'interrupt', b.id).map((x) => [x.tick, x.ev.by])).toEqual([[18, p.id]]);
    expect(b.combat!.action?.kind).toBe('hitstun');
    w.dispose();
  });

  /** Ticks for poise to refill from a 60-tick delay, optionally shocked. */
  async function poiseRefill(id: string, shocked: boolean): Promise<number> {
    const { w, p } = await combatWorld();
    const e = w.spawnEnemy(id, FAR, 0);
    if (shocked) apply(w, e, 'shock', 1, p);
    e.combat!.poise = 1;
    e.combat!.poiseDelay = 60;
    const n = ticksUntil(w, () => e.combat!.poise === e.combat!.poiseMax, 400);
    w.dispose();
    return n;
  }

  it('halves poise regen while it lasts', async () => {
    const free = await poiseRefill('grunt', false);
    expect(free).toBe(61);
    const shocked = await poiseRefill('grunt', true);
    expect(Math.abs(shocked - 2 * free)).toBeLessThanOrEqual(2);
  });

  it('lasts 3 s (×1.5 on the shock-weak Slinger and Wisp)', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', FAR, 0);
    const s = w.spawnEnemy('slinger', { x: 3, y: 0, z: 40 }, 0);
    const wi = w.spawnEnemy('wisp', { x: -3, y: 0, z: 40 }, 0);
    for (const e of [g, s, wi]) apply(w, e, 'shock', 1, p);
    expect([g, s, wi].map((e) => e.statuses!.shock!.ticks)).toEqual([180, 270, 270]);
    w.dispose();
  });

  /**
   * SIM BUG (spec mismatch): plan §4.6 lists "Shock poise penalty" among the potencies a weakness
   * multiplies by 1.5; vitals.ts applies a fixed 50% penalty whatever the affinity. A shock-weak
   * Slinger should regenerate poise at 25% speed (penalty 75%), i.e. take ~4× as long, not 2×.
   */
  it('a shock-weak Slinger takes ~4× as long to refill poise (penalty ×1.5 = 75%)', async () => {
    const free = await poiseRefill('slinger', false);
    const shocked = await poiseRefill('slinger', true);
    expect(shocked / free).toBeGreaterThan(3.5);
  });
});

describe('statuses clear (plan §4.7, §2.9)', () => {
  it('on death', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', FAR, 0);
    apply(w, g, 'burn', 1, p);
    apply(w, g, 'chill', 1, p);
    apply(w, g, 'shock', 1, p);
    const ctx = ctxOf(w);
    kill(ctx, g, p);
    expect(g.statuses).toBeUndefined();
    const evs = stepN(w, 10);
    expect(g.statuses).toBeUndefined();
    expect(ofType(evs, 'statusEnd').length).toBe(0);
    w.dispose();
  });

  it('on reset: the player respawns and the yard resets, statuses and all', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', FAR, 0);
    apply(w, g, 'chill', 1, p);
    apply(w, p, 'burn', 1, p);
    kill(ctxOf(w), p, null);
    const evs = stepN(w, 130);
    expect(evOf(evs, 'respawn', p.id).length).toBe(1);
    expect(g.statuses).toBeUndefined(); // chill had 170 ticks left
    expect(p.statuses).toBeUndefined();
    w.dispose();
  });

  it('on an enemy respawn (sandbox)', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', FAR, 0);
    kill(ctxOf(w), g, p);
    // A status landing on a corpse is ignored.
    apply(w, g, 'chill', 1, p);
    expect(g.statuses).toBeUndefined();
    const evs = stepN(w, ENEMIES.grunt.respawnTicks + 2);
    expect(evOf(evs, 'respawn', g.id).length).toBe(1);
    expect(g.combat!.action).toBeNull();
    w.dispose();
  });
});
