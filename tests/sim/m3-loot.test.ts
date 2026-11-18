import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { HEART_HEAL, INVENTORY_CAP } from '../../src/content/items';
import { DROPS } from '../../src/content/loot';
import type { Entity } from '../../src/sim/entity';
import { next, range, seedStream } from '../../src/sim/rng';
import { giveItem, onKill, pickups } from '../../src/sim/systems/rpg';
import type { SimWorld } from '../../src/sim/SimWorld';
import { evs, interact, rpgCtx, stand, standBy, tick1, ui, village, VILLAGE_Y } from './m3Helpers';
import { BTN } from './combatHelpers';

/** Plan §5 drops (rng `loot`), pickups and the inventory cap. */

/** A Grunt in the village, one light from death, 1.5 m in front of the player. */
function gruntAhead(w: SimWorld): Entity {
  stand(w, 230, 40, { x: 230, z: 50 });
  const g = w.spawnEnemy('grunt', { x: 230, y: VILLAGE_Y, z: 41.5 }, Math.PI);
  g.vitals!.hp = 1;
  return g;
}

function killWithLight(w: SimWorld, target: Entity) {
  const out = [];
  for (let i = 0; i < 40 && target.combat!.action?.kind !== 'dead'; i++) out.push(...tick1(w, ui([], i === 0 ? BTN.light : 0)));
  expect(target.combat!.action?.kind).toBe('dead');
  return out;
}

const pickupsOnGround = (w: SimWorld) => w.entities.filter((e) => e.pickup);

describe('kills: XP and drops (plan §5)', () => {
  it("a killed Grunt grants its 12 XP and drops Sprouts in [3, 6] (and a heart 15%) from the 'loot' stream, as the seed predicts", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { w, p, prog } = await village({ seed });
      const g = gruntAhead(w);
      const out = killWithLight(w, g);
      expect(evs(out, 'xp')).toMatchObject([{ entity: p.id, amount: ENEMIES.grunt.xp }]);
      expect(ENEMIES.grunt.xp).toBe(12);
      expect(prog().xp).toBe(12);
      // Replay the loot stream: sprouts first, then the heart roll (Grunts carry no items).
      const s = seedStream(seed, 'loot');
      const sprouts = range(s, DROPS.grunt.sprouts[0], DROPS.grunt.sprouts[1]);
      const heart = next(s) < DROPS.grunt.heartChance;
      const drops = pickupsOnGround(w).map((e) => [e.pickup!.kind, e.pickup!.amount]);
      expect(drops, `seed ${seed}`).toEqual(heart ? [['sprouts', sprouts], ['heart', 1]] : [['sprouts', sprouts]]);
      expect(sprouts).toBeGreaterThanOrEqual(3);
      expect(sprouts).toBeLessThanOrEqual(6);
      w.dispose();
    }
  });

  it('drops are deterministic by seed: the same kill twice gives the same pickups', async () => {
    const once = async () => {
      const { w } = await village({ seed: 42 });
      killWithLight(w, gruntAhead(w));
      const out = pickupsOnGround(w).map((e) => ({ ...e.pickup!, pos: e.tf.pos }));
      w.dispose();
      return out;
    };
    expect(await once()).toEqual(await once());
  });

  it('hearts drop about 15% of the time (2,000 Grunt kills through onKill)', async () => {
    const { w, p } = await village();
    const g = w.spawnEnemy('grunt', { x: 230, y: VILLAGE_Y, z: 41.5 }, Math.PI);
    const ctx = rpgCtx(w);
    for (let i = 0; i < 2000; i++) onKill(ctx, p, g);
    const hearts = ctx.spawned.filter((s) => s.pickup.kind === 'heart').length;
    expect(hearts / 2000).toBeGreaterThan(0.12);
    expect(hearts / 2000).toBeLessThan(0.18);
    expect(ctx.spawned.filter((s) => s.pickup.kind === 'sprouts').length).toBe(2000);
    w.dispose();
  });

  it('a kill by nobody (a status tick with no source, a fall) grants nothing', async () => {
    const { w, prog } = await village();
    const g = w.spawnEnemy('grunt', { x: 230, y: VILLAGE_Y, z: 41.5 }, Math.PI);
    g.statuses = { burn: { ticks: 30, perTick: 100, source: 99999 } };
    for (let i = 0; i < 40 && g.combat!.action?.kind !== 'dead'; i++) tick1(w);
    expect(g.combat!.action?.kind).toBe('dead');
    expect(prog().xp).toBe(0);
    expect(pickupsOnGround(w)).toEqual([]);
    w.dispose();
  });
});

describe('pickups (plan §5)', () => {
  it('walking over the Sprouts collects them (total and event); the pickup is removed', async () => {
    const { w, p, prog } = await village({ seed: 3 });
    killWithLight(w, gruntAhead(w));
    const sp = pickupsOnGround(w).find((e) => e.pickup!.kind === 'sprouts')!;
    const amount = sp.pickup!.amount;
    stand(w, sp.tf.pos.x, sp.tf.pos.z);
    const e = tick1(w);
    expect(evs(e, 'pickup')).toMatchObject([{ entity: p.id, kind: 'sprouts', amount }]);
    expect(evs(e, 'currency')).toMatchObject([{ amount, total: amount }]);
    expect(prog().sprouts).toBe(amount);
    expect(w.get(sp.id)).toBeUndefined();
    w.dispose();
  });

  it('a heart heals 15% of max HP (capped at max)', async () => {
    const { w, p } = await village();
    const heart: Entity = { id: 9001, kind: 'pickup', tf: { pos: { ...p.tf.pos }, prevPos: { ...p.tf.pos }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } }, pickup: { kind: 'heart', amount: 1, life: 100 }, view: { model: 'heart' } };
    p.vitals!.hp = 20;
    const ctx = rpgCtx(w);
    const gone = pickups({ ...ctx, entities: [...w.entities, heart] });
    expect(gone).toEqual([9001]);
    expect(p.vitals!.hp).toBeCloseTo(20 + p.vitals!.hpMax * HEART_HEAL, 9);
    expect(HEART_HEAL).toBe(0.15);
    p.vitals!.hp = p.vitals!.hpMax - 1;
    pickups({ ...ctx, entities: [...w.entities, { ...heart, pickup: { ...heart.pickup! } }] });
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });

  it('pickups out of reach are not collected and expire when their life runs out', async () => {
    const { w } = await village({ seed: 3 });
    killWithLight(w, gruntAhead(w));
    stand(w, 200, 10);
    const ids = pickupsOnGround(w).map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    // A minute of life (3,600 ticks) is long to simulate: shorten what is left (test setup).
    for (const e of pickupsOnGround(w)) e.pickup!.life = 5;
    for (let i = 0; i < 4; i++) tick1(w);
    expect(pickupsOnGround(w).length).toBe(ids.length);
    tick1(w);
    expect(pickupsOnGround(w)).toEqual([]);
    w.dispose();
  });

  it('a dead player collects nothing', async () => {
    const { w, p } = await village();
    const heart: Entity = { id: 9002, kind: 'pickup', tf: { pos: { ...p.tf.pos }, prevPos: { ...p.tf.pos }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } }, pickup: { kind: 'heart', amount: 1, life: 100 }, view: { model: 'heart' } };
    p.combat!.action = { kind: 'dead', t: 0 };
    const gone = pickups({ ...rpgCtx(w), entities: [...w.entities, heart] });
    expect(gone).toEqual([]);
    expect(heart.pickup!.life).toBe(99);
    w.dispose();
  });
});

describe(`inventory cap (plan §5: ${INVENTORY_CAP})`, () => {
  /** Fill the bags with 40 kinds of something (test setup: real ids aren't needed to count kinds). */
  const fill = (p: Entity) => {
    const inv = p.progress!.inventory;
    for (let i = Object.keys(inv).length; i < INVENTORY_CAP; i++) inv[`junk_${i}`] = 1;
  };

  it('a new kind past 40 is refused; more of a kind you already hold is still taken', async () => {
    const { w, p, prog } = await village();
    fill(p);
    const events: ReturnType<typeof rpgCtx>['events'] = [];
    expect(giveItem(rpgCtx(w, events), p, 'heart')).toBe(false);
    expect(evs(events, 'refused')).toMatchObject([{ action: 'give', reason: 'Your bags are full.' }]);
    expect(prog().inventory.heart).toBeUndefined();
    expect(giveItem(rpgCtx(w, events), p, 'staff_sproto')).toBe(true);
    expect(prog().inventory.staff_sproto).toBe(2);
    w.dispose();
  });

  it('buying with full bags is refused and costs nothing', async () => {
    const { w, p, prog } = await village();
    prog().sprouts = 500;
    standBy(w, 'merchant_village');
    tick1(w, interact());
    tick1(w, ui([{ kind: 'dialogueChoose', choice: 0 }]));
    expect(prog().shop).toBe('merchant_village');
    fill(p);
    const e = tick1(w, ui([{ kind: 'buy', merchant: 'merchant_village', item: 'charm_quick_step' }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'give' }]);
    expect(evs(e, 'bought')).toEqual([]);
    expect(prog().sprouts).toBe(500);
    expect(w.world.flags['bought:merchant_village:charm_quick_step'] ?? 0).toBe(0);
    w.dispose();
  });

  /**
   * SIM BUG? (plan §5 "Chest contents are fixed" + "capped at 40 items"): opening a chest with full
   * bags refuses its items but still marks the chest used (world.openedChests), so its contents —
   * here q_wake_up's Sprout Seed — are lost for good. Expected: the chest stays closed (or keeps
   * what didn't fit).
   */
  it('a chest opened with full bags does not lose its contents', async () => {
    const { w, p, prog } = await village();
    fill(p);
    standBy(w, 'chest_training');
    tick1(w, interact());
    const kept = (prog().inventory.sprout_seed ?? 0) > 0;
    const reopenable = !w.world.openedChests.includes('chest_training');
    expect(kept || reopenable).toBe(true);
    w.dispose();
  });
});
