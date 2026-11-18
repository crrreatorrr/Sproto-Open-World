import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { SPELLS, WOVEN, type SpellId } from '../../src/content/spells';
import { flatDist } from '../../src/sim/combat/geometry';
import type { Entity } from '../../src/sim/entity';
import { BTN, combatWorld, hitsOn, hold, idle, ofType, press, step, stepN } from './combatHelpers';
import { evOf } from './m1bHelpers';

/** Plan §4.4 spells, §4.5 mana, §4.6 spell damage. Spell buttons: spell1..4 = bolt, blast, frostNova, chainZap. */

const BUTTON: Record<string, number> = { bolt: BTN.spell1, blast: BTN.spell2, frostNova: BTN.spell3, chainZap: BTN.spell4 };
const IDS: SpellId[] = ['bolt', 'blast', 'frostNova', 'chainZap'];
const REGEN = PLAYER_STATS.manaRegen / 60;

describe('casting (plan §4.4, §4.5)', () => {
  it('table values: cost, release (woven), cooldown', () => {
    expect(IDS.map((id) => [SPELLS[id].cost, SPELLS[id].release, SPELLS[id].wovenRelease, SPELLS[id].cooldown])).toEqual([
      [6, 10, 5, 8],
      [30, 24, 12, 180],
      [25, 14, 7, 480],
      [35, 18, 9, 360],
    ]);
    expect(WOVEN).toEqual({ window: 30, damage: 1.2 });
  });

  for (const id of IDS) {
    it(`${id}: costs its mana on the press tick, releases on tick ${SPELLS[id].release}, cooldown starts at release`, async () => {
      const { w, p } = await combatWorld();
      const def = SPELLS[id];
      const evs = stepN(w, 1, () => press(BUTTON[id]));
      expect(evOf(evs, 'castStart', p.id).map((x) => [x.tick, x.ev.spell, x.ev.release, x.ev.woven])).toEqual([[0, id, def.release, false]]);
      expect(p.vitals!.mana).toBeCloseTo(100 - def.cost + REGEN, 9);
      // Not on cooldown while it winds up.
      evs.push(...stepN(w, def.release - 1));
      expect(p.combat!.cooldowns[id] ?? 0).toBe(0);
      evs.push(...stepN(w, 1));
      expect(evOf(evs, 'cast', p.id).map((x) => [x.tick, x.ev.spell, x.ev.woven])).toEqual([[def.release, id, false]]);
      expect(p.combat!.cooldowns[id]).toBe(def.cooldown);
      // The caster is free again `recovery` ticks after the release.
      evs.push(...stepN(w, def.recovery - 1));
      expect(p.combat!.action?.kind).toBe('cast');
      step(w);
      expect(p.combat!.action).toBeNull();
      w.dispose();
    });

    it(`${id}: with too little mana it emits noMana and spends nothing`, async () => {
      const { w, p } = await combatWorld();
      p.vitals!.mana = SPELLS[id].cost - 1;
      const evs = stepN(w, 30, (i) => (i === 0 ? press(BUTTON[id]) : idle()));
      expect(evOf(evs, 'noMana', p.id).map((x) => [x.tick, x.ev.spell])).toEqual([[0, id]]);
      expect(evOf(evs, 'castStart').length).toBe(0);
      expect(p.combat!.action).toBeNull();
      expect(p.vitals!.mana).toBeCloseTo(SPELLS[id].cost - 1 + 30 * REGEN, 9);
      w.dispose();
    });
  }

  it('on cooldown it emits cooldown and spends nothing; it is castable again exactly release + cooldown after the press', async () => {
    const { w, p } = await combatWorld();
    const blast = SPELLS.blast;
    const again = blast.release + blast.cooldown; // 204
    const first = stepN(w, again - 1, (i) => (i === 0 ? press(BTN.spell2) : idle()));
    expect(evOf(first, 'castStart', p.id).length).toBe(1);
    const mana = p.vitals!.mana;
    let evs = stepN(w, 1, () => press(BTN.spell2)); // tick 203: 1 tick of cooldown left
    expect(evOf(evs, 'cooldown', p.id).map((x) => [x.tick, x.ev.spell])).toEqual([[again - 1, 'blast']]);
    expect(evOf(evs, 'castStart').length).toBe(0);
    expect(p.vitals!.mana).toBeCloseTo(mana + REGEN, 9);
    evs = stepN(w, 1, () => press(BTN.spell2)); // tick 204
    expect(evOf(evs, 'castStart', p.id).map((x) => [x.tick, x.ev.spell])).toEqual([[again, 'blast']]);
    w.dispose();
  });

  it('cooldowns are per spell: Blast on cooldown does not block a Bolt', async () => {
    const { w, p } = await combatWorld();
    const evs = stepN(w, 60, (i) => (i === 0 ? press(BTN.spell2) : i === 40 ? press(BTN.spell1) : idle()));
    expect(evOf(evs, 'castStart', p.id).map((x) => [x.tick, x.ev.spell])).toEqual([[0, 'blast'], [40, 'bolt']]);
    w.dispose();
  });

  it('mana regenerates 1.5/s and stops at the maximum', async () => {
    const { w, p } = await combatWorld();
    p.vitals!.mana = 0;
    stepN(w, 600);
    expect(p.vitals!.mana).toBeCloseTo(15, 6);
    p.vitals!.mana = 99.99;
    stepN(w, 60);
    expect(p.vitals!.mana).toBe(p.vitals!.manaMax);
    w.dispose();
  });
});

describe('woven casts (plan §1, §4.4: within 30 ticks of a melee hit, half cast time, ×1.2)', () => {
  /** Light at a dummy; press Bolt `after` ticks after the light's hit. Returns the bolt's cast and hit. */
  async function lightThenBolt(after: number) {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const evs = stepN(w, 1, () => press(BTN.light));
    let hitTick = -1;
    for (let i = 0; i < 40 && hitTick < 0; i++) {
      const tick = w.now;
      if (step(w).some((e) => e.type === 'hit' && e.attacker === p.id)) hitTick = tick;
    }
    expect(hitTick).toBeGreaterThan(0);
    while (w.now < hitTick + after) step(w);
    const pressTick = w.now;
    evs.push(...stepN(w, 40, (i) => (i === 0 ? press(BTN.spell1) : idle())));
    const start = evOf(evs, 'castStart', p.id)[0];
    const cast = evOf(evs, 'cast', p.id)[0];
    const bolt = hitsOn(evs, d.id).find((x) => x.ev.move === 'bolt');
    w.dispose();
    return { pressTick, start, cast, bolt };
  }

  it(`a Bolt pressed ${WOVEN.window} ticks after a landed light is woven: releases on tick 5 and deals 12 × 1.2 = 14`, async () => {
    const { pressTick, start, cast, bolt } = await lightThenBolt(WOVEN.window);
    expect([start.tick, start.ev.woven, start.ev.release]).toEqual([pressTick, true, SPELLS.bolt.wovenRelease]);
    expect([cast.tick, cast.ev.woven]).toEqual([pressTick + SPELLS.bolt.wovenRelease, true]);
    expect(bolt?.ev.damage).toBe(14);
  });

  it(`${WOVEN.window + 1} ticks after the hit it is not woven: release 10, damage 12`, async () => {
    const { pressTick, start, cast, bolt } = await lightThenBolt(WOVEN.window + 1);
    expect([start.tick, start.ev.woven, start.ev.release]).toEqual([pressTick, false, SPELLS.bolt.release]);
    expect([cast.tick, cast.ev.woven]).toEqual([pressTick + SPELLS.bolt.release, false]);
    expect(bolt?.ev.damage).toBe(12);
  });

  it('a spell hit does not refresh the weave (only melee hits do)', async () => {
    const { w, p } = await combatWorld();
    w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 3 }, Math.PI);
    const evs = stepN(w, 40, (i) => (i === 0 || i === 20 ? press(BTN.spell1) : idle()));
    expect(evOf(evs, 'castStart', p.id).map((x) => x.ev.woven)).toEqual([false, false]);
    w.dispose();
  });
});

describe('spell cancel rules (plan §4.4)', () => {
  it("a spell pressed during a light's active frames fires at the light's activeEnd (clip tick 16), not before", async () => {
    const { w, p } = await combatWorld(); // no enemy: no hit-stop, clip tick = world tick
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : i === 9 ? press(BTN.spell1) : idle()));
    expect(evOf(evs, 'castStart', p.id).map((x) => x.tick)).toEqual([16]);
    w.dispose();
  });

  it("a spell pressed in a light's recovery starts on the press tick", async () => {
    const { w, p } = await combatWorld();
    const evs = stepN(w, 40, (i) => (i === 0 ? press(BTN.light) : i === 24 ? press(BTN.spell1) : idle()));
    expect(evOf(evs, 'castStart', p.id).map((x) => x.tick)).toEqual([24]);
    w.dispose();
  });

  it('spells never cancel a heavy: a press in its recovery waits for the heavy to end (clip tick 70)', async () => {
    const { w, p } = await combatWorld();
    const evs = stepN(w, 90, (i) => (i === 0 ? press(BTN.heavy) : i === 40 ? press(BTN.spell1) : idle()));
    expect(evOf(evs, 'castStart', p.id).map((x) => x.tick)).toEqual([70]);
    w.dispose();
  });

  it('casting from a held block is legal on the press tick', async () => {
    const { w, p } = await combatWorld();
    const evs = stepN(w, 20, (i) => (i === 6 ? press(BTN.spell3, { hold: BTN.block }) : hold(BTN.block)));
    expect(evOf(evs, 'castStart', p.id).map((x) => [x.tick, x.ev.spell])).toEqual([[6, 'frostNova']]);
    w.dispose();
  });
});

describe('spell damage and areas (plan §4.4, §4.6)', () => {
  it('Arcane Bolt: 20 × 1.0 × 0.6 = 12 arcane on a normal-profile target', async () => {
    const { w } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 6 }, Math.PI);
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.spell1) : idle()));
    expect(hitsOn(evs, d.id).map((x) => [x.ev.move, x.ev.damage, x.ev.kind, x.ev.affinity])).toEqual([['bolt', 12, 'arcane', 'normal']]);
    w.dispose();
  });

  it('Blast explodes (3.5 m) and hits every enemy in the radius (40 each, plus Burn), and none outside', async () => {
    const { w, p } = await combatWorld();
    const target = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 8 }, Math.PI);
    const near = [w.spawnEnemy('dummy_passive', { x: 2.5, y: 0, z: 9 }, Math.PI), w.spawnEnemy('dummy_passive', { x: -2, y: 0, z: 6.2 }, Math.PI)];
    const far = [w.spawnEnemy('dummy_passive', { x: 6, y: 0, z: 8 }, Math.PI), w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 14 }, Math.PI)];
    const evs = stepN(w, 90, (i) => (i === 0 ? press(BTN.spell2) : idle()));
    const [ex] = evOf(evs, 'explode', p.id);
    expect(ex.ev.radius).toBe(3.5);
    const hit = new Set(ofType(evs, 'hit').map((x) => x.ev.target));
    expect(hit).toEqual(new Set([target.id, ...near.map((e) => e.id)]));
    for (const e of [target, ...near]) expect(flatDist(ex.ev.pos, e.tf.pos)).toBeLessThanOrEqual(3.5 + e.body!.radius);
    for (const e of far) expect(flatDist(ex.ev.pos, e.tf.pos)).toBeGreaterThan(3.5 + e.body!.radius);
    expect(ofType(evs, 'hit').map((x) => x.ev.damage)).toEqual([40, 40, 40]);
    expect(new Set(ofType(evs, 'status').filter((x) => x.ev.status === 'burn').map((x) => x.ev.entity))).toEqual(hit);
    w.dispose();
  });

  it('Frost Nova pushes a (non-dummy) enemy about 2 m out', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 2.5 }, Math.PI);
    g.combat!.action = { kind: 'stagger', t: 0, dur: 600 }; // hold it still so only the push moves it
    const before = flatDist(g.tf.pos, p.tf.pos);
    stepN(w, 40, (i) => (i === 0 ? press(BTN.spell3) : idle()));
    expect(flatDist(g.tf.pos, p.tf.pos) - before).toBeCloseTo(SPELLS.frostNova.nova!.push, 1);
    w.dispose();
  });

  it('Frost Nova hits enemies within 5 m and chills them; enemies beyond are untouched; training dummies stay put', async () => {
    const { w, p } = await combatWorld();
    const inside = [w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 2.5 }, Math.PI), w.spawnEnemy('dummy_passive', { x: -4.5, y: 0, z: 0 }, Math.PI / 2)];
    const outside = w.spawnEnemy('dummy_passive', { x: 4, y: 0, z: -4 }, 0); // 5.66 m
    const before = new Map([...inside, outside].map((e) => [e.id, flatDist(e.tf.pos, p.tf.pos)]));
    const evs = stepN(w, 40, (i) => (i === 0 ? press(BTN.spell3) : idle()));
    expect(evOf(evs, 'nova', p.id).map((x) => [x.tick, x.ev.radius])).toEqual([[SPELLS.frostNova.release, 5]]);
    expect(new Set(ofType(evs, 'hit').map((x) => x.ev.target))).toEqual(new Set(inside.map((e) => e.id)));
    // 20 × 0.8 = 16.
    expect(ofType(evs, 'hit').map((x) => x.ev.damage)).toEqual([16, 16]);
    for (const e of inside) {
      // Dummies are posts: no hit moves them, Frost Nova's push included.
      expect(flatDist(e.tf.pos, p.tf.pos)).toBeCloseTo(before.get(e.id)!, 6);
      expect(e.statuses?.chill?.stacks).toBe(2);
    }
    expect(flatDist(outside.tf.pos, p.tf.pos)).toBeCloseTo(before.get(outside.id)!, 6);
    expect(outside.statuses).toBeUndefined();
    w.dispose();
  });

  /** Dummies in a row at these distances, the caster facing them (x = 6: clear of the sandbox's step boxes). */
  async function chainRow(zs: number[], x = 0, playerPos = { x: 6, y: 0, z: 0 }, yaw = 0) {
    const { w, p } = await combatWorld({ pos: playerPos, yaw });
    const ds: Entity[] = zs.map((z) => w.spawnEnemy('dummy_passive', { x: playerPos.x + Math.sin(yaw) * z + x, y: 0, z: playerPos.z + Math.cos(yaw) * z }, yaw + Math.PI));
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.spell4) : idle()));
    const zap = evOf(evs, 'zap', p.id)[0];
    w.dispose();
    return { ds, evs, zap };
  }

  it('Chain Zap jumps to up to 3 more enemies within 8 m, each ×0.7 (20, 14, 10, 7), with Shock', async () => {
    const { ds, evs, zap } = await chainRow([5, 10, 15, 20, 25]);
    expect(zap.tick).toBe(SPELLS.chainZap.release);
    expect(zap.ev.targets).toEqual(ds.slice(0, 4).map((e) => e.id));
    expect(ofType(evs, 'hit').map((x) => [x.ev.target, x.ev.damage])).toEqual([
      [ds[0].id, 20],
      [ds[1].id, 14],
      [ds[2].id, 10],
      [ds[3].id, 7],
    ]);
    expect(ofType(evs, 'status').map((x) => [x.ev.entity, x.ev.status])).toEqual(ds.slice(0, 4).map((e) => [e.id, 'shock']));
  });

  it('Chain Zap never hits the same enemy twice', async () => {
    const { ds, evs, zap } = await chainRow([5, 10]);
    expect(zap.ev.targets).toEqual([ds[0].id, ds[1].id]);
    expect(ofType(evs, 'hit').length).toBe(2);
  });

  it('Chain Zap does not jump further than 8 m', async () => {
    const { ds, zap } = await chainRow([5, 13.5]);
    expect(zap.ev.targets).toEqual([ds[0].id]);
  });

  it('Chain Zap needs line of sight to jump (a wall blocks it; the same spacing in the open does not)', async () => {
    // The sandbox wall spans x -16.5..-15.5, z -6..6, 4 m tall. Cast facing −X.
    const west = -Math.PI / 2;
    const blocked = await chainRow([4, 9], 0, { x: -10, y: 0, z: 0 }, west);
    expect(blocked.zap.ev.targets).toEqual([blocked.ds[0].id]);
    const open = await chainRow([4, 9], 0, { x: -10, y: 0, z: 20 }, west);
    expect(open.zap.ev.targets).toEqual([open.ds[0].id, open.ds[1].id]);
  });
});
