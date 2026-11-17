import { describe, expect, it } from 'vitest';
import { CHARGE, PLAYER_MOVES, clipTiming } from '../../src/content/combat';
import { PLAYER_HITBOXES } from '../../src/content/generated/playerHitboxes';
import { PLAYER_MOVE_TIMING } from '../../src/content/generated/playerMoveTiming';
import { toWorld } from '../../src/sim/combat/geometry';
import { BTN, attack, combatWorld, hitsOn, hold, idle, ofType, press, step, stepN, teleport } from './combatHelpers';

/** Plan §4.2 moves table: the generated clip markers in 60 Hz ticks. */
describe('generated move timing (plan §4.2)', () => {
  it('matches the moves table', () => {
    expect(PLAYER_MOVE_TIMING.attack_light_1).toMatchObject({ start: 0, activeStart: 8, activeEnd: 16, cancel: 20, end: 38 });
    expect(PLAYER_MOVE_TIMING.attack_light_2).toMatchObject({ start: 0, activeStart: 7, activeEnd: 14, cancel: 19, end: 38 });
    expect(PLAYER_MOVE_TIMING.attack_light_3).toMatchObject({ start: 0, activeStart: 18, activeEnd: 24, cancel: 36, end: 55 });
    expect(PLAYER_MOVE_TIMING.attack_heavy).toMatchObject({ chargeStart: 18, chargeEnd: 29, activeStart: 31, activeEnd: 38, cancel: 48, end: 70 });
    expect(PLAYER_MOVE_TIMING.block).toMatchObject({ raised: 7, end: 30 });
    // Combo heavy and riposte enter the heavy clip at its charge start (18): startup 13, end 52.
    expect(PLAYER_MOVES.comboHeavy.entry).toBe(18);
    expect(PLAYER_MOVES.riposte.entry).toBe(18);
  });

  it('has exactly one generated hitbox per active tick, [activeStart, activeEnd)', () => {
    for (const clip of ['attack_light_1', 'attack_light_2', 'attack_light_3', 'attack_heavy'] as const) {
      const tm = clipTiming(clip);
      const want = Array.from({ length: tm.activeEnd - tm.activeStart }, (_, i) => tm.activeStart + i);
      expect(PLAYER_HITBOXES[clip].map((h) => h.tick), clip).toEqual(want);
    }
  });
});

describe('light 1 from free', () => {
  it('starts on the press tick, swings on clip tick 8 and ends on clip tick 38', async () => {
    const { w, p } = await combatWorld();
    const swings: number[] = [];
    for (let i = 0; i < 40; i++) {
      const ev = step(w, i === 0 ? press(BTN.light) : idle());
      if (ev.some((e) => e.type === 'swing' && e.entity === p.id)) swings.push(i);
      const a = attack(p);
      if (i < 38) {
        expect(a?.move, `tick ${i}`).toBe('light1');
        expect(a?.clipT, `tick ${i}`).toBe(i);
      } else expect(p.combat!.action, `tick ${i}`).toBeNull();
    }
    expect(swings).toEqual([8]);
    w.dispose();
  });

  /**
   * Put a dummy exactly where the staff is on clip tick `boxTick`, just before world tick `at`
   * runs, and report the clip tick it gets hit on (if any).
   */
  async function hitTickWithDummyAt(boxTick: number, at: number): Promise<number | null> {
    const { w, p } = await combatWorld();
    // Far away: not a soft target, out of its own aggro range.
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 40 }, Math.PI);
    step(w, press(BTN.light));
    stepN(w, at - 1);
    const box = PLAYER_HITBOXES.attack_light_1.find((h) => h.tick === boxTick)!;
    const mid: [number, number, number] = [(box.a[0] + box.b[0]) / 2, 0, (box.a[2] + box.b[2]) / 2];
    teleport(w, d, toWorld(p.tf.pos, p.tf.yaw, mid));
    for (let i = at; i < 40; i++) {
      const ev = step(w);
      if (ev.some((e) => e.type === 'hit' && e.target === d.id)) {
        const t = attack(p)!.clipT;
        w.dispose();
        return t;
      }
    }
    w.dispose();
    return null;
  }

  it('is active on exactly clip ticks [8, 16)', async () => {
    // A target sitting in tick 8's hitbox from tick 6 on is first hit on tick 8, not 7.
    expect(await hitTickWithDummyAt(8, 6)).toBe(8);
    for (let k = 8; k < 16; k++) expect(await hitTickWithDummyAt(k, k), `clip tick ${k}`).toBe(k);
    // Tick 15's hitbox is the last one: a target arriving there on tick 16 is never hit.
    expect(await hitTickWithDummyAt(15, 16)).toBeNull();
  });
});

describe('combo strings (empty yard, no hit-stop)', () => {
  it('light1 → light2 at 20 → light3 at 20+19, back to free after light3 ends', async () => {
    const { w, p } = await combatWorld();
    const starts: [number, string][] = [];
    let prev: unknown = null;
    for (let i = 0; i < 100; i++) {
      step(w, i === 0 || i === 20 || i === 39 ? press(BTN.light) : idle());
      const a = attack(p);
      if (a && a !== prev && a.t === 0) starts.push([i, a.move]);
      prev = a;
    }
    expect(starts).toEqual([[0, 'light1'], [20, 'light2'], [39, 'light3']]);
    // light3 ends 55 ticks after it started.
    expect(p.combat!.action).toBeNull();
    w.dispose();
  });

  it('light3 ends exactly at clip tick 55 when nothing follows', async () => {
    const { w, p } = await combatWorld();
    stepN(w, 40, (i) => (i === 0 || i === 20 || i === 39 ? press(BTN.light) : idle()));
    expect(attack(p)).toMatchObject({ move: 'light3', clipT: 0 });
    stepN(w, 54);
    expect(attack(p)).toMatchObject({ move: 'light3', clipT: 54 });
    step(w);
    expect(p.combat!.action).toBeNull();
    w.dispose();
  });

  it('a heavy at light1 cancel is a combo heavy that enters the heavy clip at 18', async () => {
    const { w, p } = await combatWorld();
    stepN(w, 20, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(attack(p)).toMatchObject({ move: 'light1', clipT: 19 });
    step(w, press(BTN.heavy));
    expect(attack(p)).toMatchObject({ move: 'comboHeavy', clipT: 18, t: 0 });
    // Startup 13 (swing on clip 31), active [31, 38), end at clip 70 = 52 ticks in.
    const evs = stepN(w, 52);
    const swing = ofType(evs, 'swing').filter((x) => x.ev.entity === p.id);
    expect(swing.map((x) => x.tick)).toEqual([20 + 13]);
    expect(p.combat!.action).toBeNull();
    w.dispose();
  });

  it('a heavy at light2 cancel is a combo heavy too', async () => {
    const { w, p } = await combatWorld();
    stepN(w, 39, (i) => (i === 0 || i === 20 ? press(BTN.light) : idle()));
    expect(attack(p)).toMatchObject({ move: 'light2', clipT: 18 });
    step(w, press(BTN.heavy));
    expect(attack(p)).toMatchObject({ move: 'comboHeavy', clipT: 18 });
    w.dispose();
  });

  it('a heavy from free is the plain heavy from clip tick 0', async () => {
    const { w, p } = await combatWorld();
    step(w, press(BTN.heavy));
    expect(attack(p)).toMatchObject({ move: 'heavy', clipT: 0 });
    w.dispose();
  });
});

describe('charged heavy (plan §4.2 Charge)', () => {
  const chargeEnd = PLAYER_MOVE_TIMING.attack_heavy.chargeEnd;

  it('holds the clip inside the charge window while held, then resumes from 29', async () => {
    const { w, p } = await combatWorld();
    step(w, press(BTN.heavy));
    let charging = 0;
    for (let i = 1; i < 18 + 45; i++) {
      step(w, hold(BTN.heavy));
      const a = attack(p)!;
      if (a.charging) {
        charging++;
        expect(a.clipT).toBeGreaterThanOrEqual(18);
        expect(a.clipT).toBeLessThanOrEqual(chargeEnd - 1);
      }
    }
    expect(charging).toBeGreaterThan(40);
    const a = attack(p)!;
    step(w); // release
    expect(a.charging).toBe(false);
    expect(a.charged).toBe(true);
    expect(a.clipT).toBe(chargeEnd - 1);
    step(w);
    expect(a.clipT).toBe(chargeEnd);
    w.dispose();
  });

  it('a short hold is not charged', async () => {
    const { w, p } = await combatWorld();
    step(w, press(BTN.heavy));
    stepN(w, 18 + 10, () => hold(BTN.heavy));
    const a = attack(p)!;
    expect(a.charging).toBe(true);
    step(w);
    expect(a.charging).toBe(false);
    expect(a.charged).toBe(false);
    w.dispose();
  });

  it('releases by itself after CHARGE.max (60) held ticks, charged', async () => {
    const { w, p } = await combatWorld();
    step(w, press(BTN.heavy));
    let released = -1;
    for (let i = 1; i < 120 && released < 0; i++) {
      step(w, hold(BTN.heavy));
      const a = attack(p)!;
      if (a.charge > 0 && !a.charging) released = a.charge;
    }
    expect(released).toBe(CHARGE.max);
    expect(attack(p)!.charged).toBe(true);
    w.dispose();
  });

  it('the charged heavy does more damage than a tap heavy on the same dummy', async () => {
    const { w } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const tap = stepN(w, 80, (i) => (i === 0 ? press(BTN.heavy) : idle()));
    // Let the dummy's stagger (the tap breaks its poise) run out before the charged one.
    stepN(w, 120);
    expect(d.combat!.action).toBeNull();
    const charged = stepN(w, 150, (i) => (i === 0 ? press(BTN.heavy) : i < 18 + 40 ? hold(BTN.heavy) : idle()));
    const [t] = hitsOn(tap, d.id);
    const [c] = hitsOn(charged, d.id);
    expect(t.ev.move).toBe('heavy');
    expect(t.ev.damage).toBe(44);
    expect(c.ev.damage).toBe(60);
    expect(c.ev.damage).toBeGreaterThan(t.ev.damage);
    w.dispose();
  });
});

describe('heavy hyper armor (plan §4.2: from charge start, clip 18)', () => {
  // The swinging dummy 1.5 m away connects on world tick 54; a heavy pressed on tick 54 − c is on
  // clip tick c when it lands.
  const SWING_HIT = 54;
  async function heavyHitOnClip(c: number) {
    const { w, p } = await combatWorld();
    w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const evs = stepN(w, SWING_HIT + 1, (i) => (i === SWING_HIT - c ? press(BTN.heavy) : idle()));
    const out = { hits: hitsOn(evs, p.id).map((x) => x.ev.damage), action: p.combat!.action?.kind, hp: p.vitals!.hp };
    w.dispose();
    return out;
  }

  /**
   * Hyper armor on the player's heavies: from charge start a hit does damage but doesn't put the
   * player into hitstun. (Was a bug: the player-hitstun branch ran before the armor check.)
   * Plan §4.2: "Hyper armor ignores hitstun."
   */
  it('a hit from clip 18 on does damage but does not interrupt the heavy', async () => {
    for (const c of [18, 25]) expect(await heavyHitOnClip(c), `clip ${c}`).toEqual({ hits: [8], action: 'attack', hp: 112 });
  });

  it('a hit before clip 18 interrupts it', async () => {
    expect(await heavyHitOnClip(10)).toEqual({ hits: [8], action: 'hitstun', hp: 112 });
  });
});
