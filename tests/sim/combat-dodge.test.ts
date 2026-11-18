import { describe, expect, it } from 'vitest';
import { MANA, ROLL } from '../../src/content/combat';
import { BTN, combatWorld, hitsOn, idle, ofType, press, step, stepN, stepUntil } from './combatHelpers';

/**
 * Plan §4.3 roll: ~34 ticks, i-frames on roll ticks 3–17, perfect dodge on 3–9, 22 stamina.
 * A swinging dummy 1.5 m in front of the player first connects on world tick SWING_HIT (its
 * telegraph is on tick 30, wind-up 24). Rolling forward presses the player into the dummy, so it
 * stays inside the swing's hitbox: roll tick k at the hit means pressing dodge on SWING_HIT - k.
 */
const SWING_HIT = 54;
/** A roll needs a stick direction: dodge with none is a backstep. */
const FORWARD = { move: { x: 0, y: 1 } };

async function swingYard() {
  const cw = await combatWorld();
  const d = cw.w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
  return { ...cw, d };
}

/** `atPress` runs just before the dodge press tick. */
async function rollIntoSwing(k: number, atPress?: (cw: Awaited<ReturnType<typeof swingYard>>) => void) {
  const cw = await swingYard();
  const { w, p } = cw;
  const evs = stepN(w, SWING_HIT + 1, (i) => {
    if (i !== SWING_HIT - k) return idle();
    atPress?.(cw);
    return press(BTN.dodge, FORWARD);
  });
  const swing = ofType(evs, 'swing').find((x) => x.ev.entity === cw.d.id);
  return { ...cw, evs, hp: p.vitals!.hp, swingTick: swing?.tick };
}

describe('roll i-frames (plan §4.3)', () => {
  it('the probe: an unprotected player is hit on tick SWING_HIT', async () => {
    const { w, p } = await swingYard();
    const hitTick = stepUntil(w, (ev) => ev.some((e) => e.type === 'hit' && e.target === p.id), 200);
    expect(hitTick).toBe(SWING_HIT);
    expect(p.vitals!.hp).toBe(120 - 8);
    w.dispose();
  });

  it('a hit on roll ticks 3–17 does no damage; ticks 2 and 18 are not covered', async () => {
    for (const k of [3, 4, 9, 10, 16, 17]) {
      const r = await rollIntoSwing(k);
      expect(r.swingTick, `k=${k}`).toBe(SWING_HIT);
      expect(r.p.combat!.action?.kind === 'dodge' || r.p.combat!.action === null, `k=${k}`).toBe(true);
      expect(hitsOn(r.evs, r.p.id), `roll tick ${k}`).toEqual([]);
      expect(r.hp, `roll tick ${k}`).toBe(120);
      r.w.dispose();
    }
    for (const k of [2, 18]) {
      const r = await rollIntoSwing(k);
      expect(hitsOn(r.evs, r.p.id).length, `roll tick ${k}`).toBe(1);
      expect(r.hp, `roll tick ${k}`).toBe(112);
      r.w.dispose();
    }
  });

  it('a hit on roll ticks 3–9 is a perfect dodge (event, stamina refund, +10 mana, crit next); 10–17 is not', async () => {
    for (const k of [3, 9]) {
      const r = await rollIntoSwing(k, ({ p }) => {
        p.vitals!.stamina = 50;
        p.vitals!.mana = 40;
      });
      const perfect = ofType(r.evs, 'dodgePerfect');
      expect(perfect.map((x) => [x.tick, x.ev.entity, x.ev.attacker]), `k=${k}`).toEqual([[SWING_HIT, r.p.id, r.d.id]]);
      // 50 − 22 for the roll + 22 back; the 15-tick regen delay hasn't run out (k ≤ 9).
      expect(r.p.vitals!.stamina, `k=${k}`).toBe(50);
      expect(r.p.vitals!.mana, `k=${k}`).toBeCloseTo(40 + MANA.perfectDodge + (k + 1) * (1.5 / 60), 6);
      expect(r.p.combat!.critNext, `k=${k}`).toBe(true);
      r.w.dispose();
    }
    for (const k of [10, 17]) {
      const r = await rollIntoSwing(k);
      expect(ofType(r.evs, 'dodgePerfect'), `k=${k}`).toEqual([]);
      expect(r.p.combat!.critNext, `k=${k}`).toBe(false);
      r.w.dispose();
    }
  });

  it('after a perfect dodge the next landed hit is a crit (×1.5), and only that one', async () => {
    const r = await rollIntoSwing(5);
    const { w, p, d } = r;
    expect(p.combat!.critNext).toBe(true);
    // Finish the roll, then light1 → light2 on the swinging dummy (it is in recovery/cooldown).
    stepN(w, ROLL.ticks);
    expect(p.combat!.action).toBeNull();
    const evs = stepN(w, 50, (i) => (i === 0 || i === 22 ? press(BTN.light) : idle()));
    const hits = hitsOn(evs, d.id);
    expect(hits.map((x) => [x.ev.move, x.ev.crit, x.ev.damage])).toEqual([['light1', true, 30], ['light2', false, 22]]);
    expect(p.combat!.critNext).toBe(false);
    w.dispose();
  });

  it('a roll costs 22 stamina and lasts 34 ticks', async () => {
    const { w, p } = await combatWorld();
    const evs = stepN(w, 1, () => press(BTN.dodge, FORWARD));
    expect(ofType(evs, 'dodge').length).toBe(1);
    expect(p.vitals!.stamina).toBe(100 - ROLL.stamina);
    expect(ROLL.stamina).toBe(22);
    stepN(w, 33);
    expect(p.combat!.action?.kind).toBe('dodge');
    step(w);
    expect(p.combat!.action).toBeNull();
    w.dispose();
  });

  it('dodge with 0 stamina emits noStamina and does not roll', async () => {
    const { w, p } = await combatWorld();
    p.vitals!.stamina = 0;
    p.vitals!.staminaDelay = 30;
    const evs = stepN(w, 1, () => press(BTN.dodge));
    expect(ofType(evs, 'noStamina').map((x) => x.ev.entity)).toEqual([p.id]);
    expect(ofType(evs, 'dodge')).toEqual([]);
    expect(p.combat!.action).toBeNull();
    expect(p.combat!.buffer).toBeNull();
    w.dispose();
  });

  it('dodge cancels an attack at activeEnd, not before', async () => {
    // Press dodge on light1 clip tick 14: it waits to 16 (activeEnd).
    const { w, p } = await combatWorld();
    stepN(w, 15, (i) => press(i === 0 ? BTN.light : i === 14 ? BTN.dodge : 0));
    expect(p.combat!.action).toMatchObject({ kind: 'attack', move: 'light1', clipT: 14 });
    step(w);
    expect(p.combat!.action).toMatchObject({ kind: 'attack', move: 'light1', clipT: 15 });
    step(w);
    expect(p.combat!.action?.kind).toBe('dodge');
    w.dispose();
  });
});
