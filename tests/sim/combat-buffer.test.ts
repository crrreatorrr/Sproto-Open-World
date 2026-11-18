import { describe, expect, it } from 'vitest';
import { BTN, attack, cmd, combatWorld, hitsOn, idle, press, step, stepN, type CombatWorld } from './combatHelpers';

/**
 * Plan §4.2 buffer rule (C2). World tick i of these tests is light1's clip tick i (empty yard, no
 * hit-stop): the press on tick 0 starts light1 at clip 0.
 */

/** Light 1 on tick 0, then `extra(i)` from tick 1; returns the tick each new action started. */
async function script(extra: (i: number) => number, ticks = 60, setup?: (cw: CombatWorld) => void) {
  const cw = await combatWorld();
  setup?.(cw);
  const { w, p } = cw;
  const starts: [number, string][] = [];
  let prev: unknown = null;
  for (let i = 0; i < ticks; i++) {
    step(w, press(i === 0 ? BTN.light : extra(i)));
    const a = p.combat!.action;
    if (a && a !== prev) starts.push([i, a.kind === 'attack' ? a.move : a.kind]);
    prev = a;
  }
  w.dispose();
  return starts;
}

describe('buffer rule (plan §4.2)', () => {
  it('a light pressed on every tick from activeStart through end fires light2 exactly on cancel (20)', async () => {
    const starts = await script((i) => (i >= 8 && i <= 38 ? BTN.light : 0), 39);
    expect(starts[0]).toEqual([0, 'light1']);
    expect(starts[1]).toEqual([20, 'light2']);
  });

  it('a single light press on any tick of light1 after activeStart fires on max(tick, cancel)', async () => {
    for (let k = 9; k < 38; k++) {
      const starts = await script((i) => (i === k ? BTN.light : 0));
      expect(starts.slice(0, 2), `press on clip tick ${k}`).toEqual([[0, 'light1'], [Math.max(k, 20), 'light2']]);
    }
  });

  /**
   * A press on activeStart itself (clip tick 8, the first active frame) is held until cancel,
   * like every later press. (Was a bug: presses are read before the tick's advance, so it was
   * classed as a startup press and expired.) Plan §4.2: a light pressed on every tick of the
   * previous light's active and recovery frames fires on the first legal tick.
   */
  it('a single light press on activeStart (clip tick 8) is held until cancel', async () => {
    const starts = await script((i) => (i === 8 ? BTN.light : 0));
    expect(starts.slice(0, 2)).toEqual([[0, 'light1'], [20, 'light2']]);
  });

  it('a light pressed during startup lives 10 ticks and is dropped before cancel', async () => {
    const starts = await script((i) => (i === 3 ? BTN.light : 0));
    expect(starts).toEqual([[0, 'light1']]);
  });

  it('an attack press lives exactly 10 ticks (roll → roll attack from roll tick 26)', async () => {
    // Roll from free on tick 0; roll tick r = world tick. A light pressed on roll tick 17 is still
    // alive on its 10th tick (26); one on roll tick 16 expired on 25.
    const run = async (k: number) => {
      const { w, p } = await combatWorld();
      const starts: [number, string][] = [];
      let prev: unknown = null;
      for (let i = 0; i < 40; i++) {
        // A roll needs a stick direction (with none, Dodge is a backstep).
        step(w, cmd({ press: i === 0 ? BTN.dodge : i === k ? BTN.light : 0, move: i === 0 ? { x: 0, y: 1 } : undefined }));
        const a = p.combat!.action;
        if (a && a !== prev) starts.push([i, a.kind === 'attack' ? a.move : a.kind]);
        prev = a;
      }
      w.dispose();
      return starts;
    };
    expect(await run(17)).toEqual([[0, 'dodge'], [26, 'rollAttack']]);
    expect(await run(16)).toEqual([[0, 'dodge']]);
  });

  it('dodge lives 6 ticks: pressed on clip 11 it cancels light1 at activeEnd (16); on clip 10 it is dropped', async () => {
    expect(await script((i) => (i === 11 ? BTN.dodge : 0))).toEqual([[0, 'light1'], [16, 'dodge']]);
    expect(await script((i) => (i === 10 ? BTN.dodge : 0))).toEqual([[0, 'light1']]);
  });

  it('dodge pressed in the same tick as an attack wins', async () => {
    const { w, p } = await combatWorld();
    step(w, press(BTN.dodge | BTN.light));
    expect(p.combat!.action?.kind).toBe('dodge');
    step(w, idle());
    w.dispose();
    // Also mid-move: a same-tick dodge + light replaces a buffered light, and fires at activeEnd.
    expect(await script((i) => (i === 12 ? BTN.light : i === 13 ? BTN.dodge | BTN.light : 0))).toEqual([[0, 'light1'], [16, 'dodge']]);
    expect(await script((i) => (i === 12 ? BTN.light | BTN.dodge : 0))).toEqual([[0, 'light1'], [16, 'dodge']]);
  });

  it('the newest press replaces an older one across ticks', async () => {
    // Dodge on 13, then a light on 14 replaces it: no roll, light2 on cancel.
    expect(await script((i) => (i === 13 ? BTN.dodge : i === 14 ? BTN.light : 0))).toEqual([[0, 'light1'], [20, 'light2']]);
    // Light on 12, then a dodge on 14 replaces it: roll at activeEnd, no light2.
    expect(await script((i) => (i === 12 ? BTN.light : i === 14 ? BTN.dodge : 0))).toEqual([[0, 'light1'], [16, 'dodge']]);
  });

  it('presses during hitstun are dropped, not buffered', async () => {
    const { w, p } = await combatWorld();
    w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
    // The swinging dummy hits the player on tick 54 (telegraph 30, wind-up 24).
    stepN(w, 55);
    expect(p.combat!.action?.kind).toBe('hitstun');
    let pressedInStun = 0;
    while (p.combat!.action?.kind === 'hitstun') {
      step(w, press(BTN.light));
      pressedInStun++;
    }
    expect(pressedInStun).toBeGreaterThan(15);
    expect(p.combat!.buffer).toBeNull();
    // Nothing comes out after the hitstun.
    for (let i = 0; i < 20; i++) {
      step(w, idle());
      expect(p.combat!.action).toBeNull();
    }
    w.dispose();
  });

  it('the buffer clock stops during hit-stop: a dodge pressed on clip 11 still fires after the freeze', async () => {
    // light1 hits a dummy at 1.5 m on clip tick 12 (world tick 12): both freeze for 3 ticks
    // (13–15), so clip 16 comes on world tick 19. Six live ticks of a clip-11 dodge press would
    // have run out on tick 16 if the clock ran during the freeze.
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const starts: [number, string][] = [];
    let prev: unknown = null;
    const evs = [];
    for (let i = 0; i < 30; i++) {
      for (const ev of step(w, press(i === 0 ? BTN.light : i === 11 ? BTN.dodge : 0))) evs.push({ tick: i, ev });
      const a = p.combat!.action;
      if (a && a !== prev) starts.push([i, a.kind === 'attack' ? a.move : a.kind]);
      prev = a;
    }
    expect(hitsOn(evs, d.id).map((x) => x.tick)).toEqual([12]);
    expect(starts).toEqual([[0, 'light1'], [19, 'dodge']]);
    w.dispose();
  });

  it('a press made during the hit-stop freeze is kept and fires', async () => {
    const { w, p } = await combatWorld();
    w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    stepN(w, 14, (i) => press(i === 0 ? BTN.light : 0));
    expect(p.combat!.hitstop).toBeGreaterThan(0); // frozen (hit on tick 12)
    const clip = attack(p)!.clipT;
    step(w, press(BTN.dodge));
    expect(attack(p)!.clipT).toBe(clip); // still frozen
    expect(p.combat!.buffer?.action).toBe('dodge');
    let rolled = -1;
    for (let i = 0; i < 20 && rolled < 0; i++) {
      step(w, idle());
      if (p.combat!.action?.kind === 'dodge') rolled = i;
    }
    expect(rolled).toBeGreaterThanOrEqual(0);
    w.dispose();
  });
});
