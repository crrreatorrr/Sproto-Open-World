import { describe, expect, it } from 'vitest';
import { BACKSTAB, BREAK_CRIT, BUFFER, COUNTER, LUNGE, PLAYER_MOVES, ROLL, SWING_STEER, clipTiming } from '../../src/content/combat';
import { MOVE } from '../../src/content/tuning';
import { resolveHit } from '../../src/sim/combat/hits';
import { BTN, attack, cmd, combatWorld, forceEnemyAttack, hitsOn, idle, ofType, press, step, stepN, teleport, type CombatWorld, type TickEvents } from './combatHelpers';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';

/** Melee depth: sprint attacks, counters, break criticals, backstabs and how swings flow together. */

const FORWARD = { move: { x: 0, y: 1 } };
const SPRINT = { hold: BTN.sprint, ...FORWARD };

/** Run forward at full sprint until the player is at sprint speed. */
function sprintUp(w: SimWorld, p: Entity): void {
  stepN(w, 20, () => cmd(SPRINT));
  expect(p.loco!.sprinting).toBe(true);
  expect(p.loco!.speed).toBeCloseTo(MOVE.sprintSpeed, 1);
}

/** World tick a swinging dummy 1.5 m ahead first connects (see combat-dodge). */
const SWING_HIT = 54;

/** Roll forward into a swinging dummy so its hit lands on roll tick `k` (a perfect dodge for k in 3..9). */
async function perfectDodge(k = 5): Promise<CombatWorld & { d: Entity; evs: TickEvents[] }> {
  const { w, p } = await combatWorld();
  const d = w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
  const evs = stepN(w, SWING_HIT + 1, (i) => (i === SWING_HIT - k ? press(BTN.dodge, FORWARD) : idle()));
  expect(ofType(evs, 'dodgePerfect').length).toBe(1);
  return { w, p, d, evs };
}

/** A passive dummy in reach whose poise a light attack has just broken, with the player free again. */
async function brokenDummy(): Promise<CombatWorld & { d: Entity }> {
  const { w, p } = await combatWorld();
  const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
  breakPoise(w, p, d);
  return { w, p, d };
}

/** Break the dummy's poise with one light attack and let the swing finish. The stagger is made long enough to test. */
function breakPoise(w: SimWorld, p: Entity, d: Entity): void {
  d.combat!.poise = 1;
  d.combat!.poiseDelay = 999; // or it refills before the swing lands
  for (let i = 0; i < 60 && d.combat!.action?.kind !== 'stagger'; i++) step(w, i === 0 ? press(BTN.light) : idle());
  const a = d.combat!.action;
  if (a?.kind !== 'stagger') throw new Error('poise did not break');
  expect(a.reason).toBe('broken');
  a.dur = 600;
  for (let i = 0; i < 80 && p.combat!.action; i++) step(w);
  stepN(w, BUFFER.chainGrace + 1);
}

describe('sprint attacks', () => {
  it('light while sprinting is the sprint light, and it carries the player forward through the swing', async () => {
    const { w, p } = await combatWorld();
    sprintUp(w, p);
    const from = p.tf.pos.z;
    step(w, press(BTN.light, SPRINT));
    expect(attack(p)?.move).toBe('sprintLight');
    const tm = clipTiming('attack_light_1');
    stepN(w, tm.activeEnd);
    expect(p.tf.pos.z - from).toBeCloseTo(PLAYER_MOVES.sprintLight.drive!, 1);
    w.dispose();
  });

  it('heavy while sprinting is the sprint heavy: harder, with more poise damage than the light', async () => {
    const { w, p } = await combatWorld();
    sprintUp(w, p);
    step(w, press(BTN.heavy, SPRINT));
    expect(attack(p)?.move).toBe('sprintHeavy');
    expect(PLAYER_MOVES.sprintHeavy.poise).toBeGreaterThan(PLAYER_MOVES.sprintLight.poise);
    expect(PLAYER_MOVES.sprintHeavy.mv).toBeGreaterThan(PLAYER_MOVES.sprintLight.mv);
    expect(PLAYER_MOVES.sprintHeavy.poise).toBeGreaterThan(PLAYER_MOVES.heavy.poise);
    w.dispose();
  });

  it('closes on an enemy further off than a standing attack could reach, and lands', async () => {
    const standing = await combatWorld();
    const far = standing.w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 4.2 }, Math.PI);
    const missed = stepN(standing.w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(missed, far.id)).toEqual([]);
    standing.w.dispose();

    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: -3 } });
    sprintUp(w, p);
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: p.tf.pos.z + 4.2 }, Math.PI);
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.light, SPRINT) : idle()));
    expect(hitsOn(evs, d.id).map((x) => x.ev.move)).toEqual(['sprintLight']);
    w.dispose();
  });

  it('does not run through the target: the drive stops when the swing connects', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: -3 } });
    sprintUp(w, p);
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: p.tf.pos.z + 3 }, Math.PI);
    stepN(w, 40, (i) => (i === 0 ? press(BTN.light, SPRINT) : idle()));
    expect(p.tf.pos.z).toBeLessThan(d.tf.pos.z);
    w.dispose();
  });

  it('a free drive stops dead on whatever it connects with', async () => {
    const { w, p } = await combatWorld();
    sprintUp(w, p);
    step(w, press(BTN.light, SPRINT));
    // Set down after the press, so the swing has no target to close on: it is only driving.
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: p.tf.pos.z + 2.5 }, Math.PI);
    let at = -1;
    for (let i = 0; i < 12 && at < 0; i++) if (hitsOn(stepN(w, 1), d.id).length) at = p.tf.pos.z;
    expect(at).toBeGreaterThan(0);
    expect(attack(p)!.clipT).toBeLessThan(clipTiming('attack_light_1').activeEnd);
    stepN(w, 12);
    expect(p.tf.pos.z).toBe(at);
    w.dispose();
  });

  it('the stick can not turn a driving strike once it is active', async () => {
    const { w, p } = await combatWorld();
    sprintUp(w, p);
    step(w, press(BTN.light, SPRINT));
    stepN(w, clipTiming('attack_light_1').activeStart);
    const dir = { ...attack(p)!.lungeDir };
    stepN(w, 4, () => cmd({ move: { x: 1, y: 0 } }));
    expect(attack(p)!.lungeDir).toEqual(dir);
    w.dispose();
  });

  it('a walk or a run is not a sprint: the normal opener comes out', async () => {
    const { w, p } = await combatWorld();
    stepN(w, 20, () => cmd(FORWARD));
    expect(p.loco!.sprinting).toBe(false);
    step(w, press(BTN.light, FORWARD));
    expect(attack(p)?.move).toBe('light1');
    w.dispose();
  });

  it('letting go of sprint on the same tick as the press still counts', async () => {
    const { w, p } = await combatWorld();
    sprintUp(w, p);
    step(w, cmd(FORWARD));
    expect(p.loco!.sprinting).toBe(false);
    expect(p.loco!.speed).toBeGreaterThan(MOVE.runSpeed + LUNGE.sprintCarry);
    step(w, press(BTN.light, FORWARD));
    expect(attack(p)?.move).toBe('sprintLight');
    w.dispose();
  });
});

describe('perfect-dodge counter', () => {
  it('a light press just after a perfect dodge cuts the roll short with a fast critical counter', async () => {
    const { w, p } = await perfectDodge(5);
    // Roll tick 5 now: the counter comes out on the first tick past the perfect window (roll tick 10).
    stepN(w, ROLL.perfectEnd - 5, () => press(BTN.light));
    expect(p.combat!.action?.kind).toBe('dodge');
    step(w, press(BTN.light));
    expect(attack(p)?.move).toBe('counterLight');
    expect(ROLL.perfectEnd + 1).toBeLessThan(ROLL.attackFrom);
    w.dispose();
  });

  it('a heavy press is the heavy counter', async () => {
    const { w, p } = await perfectDodge(5);
    stepN(w, 8, () => press(BTN.heavy));
    expect(attack(p)?.move).toBe('counterHeavy');
    w.dispose();
  });

  it('lands as a critical and spends the perfect dodge', async () => {
    const { w, p, d } = await perfectDodge(5);
    const evs = stepN(w, 40, (i) => (i === 5 ? press(BTN.light) : idle()));
    const [hit] = hitsOn(evs, d.id);
    expect(hit.ev).toMatchObject({ move: 'counterLight', crit: true });
    expect(p.combat!.critNext).toBe(false);
    expect(p.combat!.counterUntil).toBe(0);
    w.dispose();
  });

  it('starts faster than any plain opener', () => {
    const startup = (id: keyof typeof PLAYER_MOVES) => {
      const def = PLAYER_MOVES[id];
      return Math.ceil((clipTiming(def.clip).activeStart - def.entry) / (def.rate ?? 1));
    };
    expect(startup('counterLight')).toBeLessThan(startup('light1'));
    expect(startup('counterHeavy')).toBeLessThan(startup('comboHeavy'));
  });

  it('the window closes: a press after it is a plain attack', async () => {
    const { w, p } = await perfectDodge(5);
    stepN(w, COUNTER.window);
    expect(p.combat!.action).toBeNull();
    step(w, press(BTN.light));
    expect(attack(p)?.move).toBe('light1');
    w.dispose();
  });

  it('an ordinary dodge gives no counter', async () => {
    const { w, p } = await combatWorld();
    stepN(w, ROLL.ticks + 1, (i) => (i === 0 ? press(BTN.dodge, FORWARD) : idle()));
    step(w, press(BTN.light));
    expect(attack(p)?.move).toBe('light1');
    w.dispose();
  });
});

describe('critical on a broken enemy', () => {
  it('the first melee hit after a poise break is a big critical', async () => {
    const { w, d } = await brokenDummy();
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    const [hit] = hitsOn(evs, d.id);
    expect(hit.ev).toMatchObject({ crit: true, strike: 'breakCrit', hitstop: BREAK_CRIT.hitstop });
    // 20 × 1.0 (light1) × 1.5 (critical) × 2 (break).
    expect(hit.ev.damage).toBe(20 * 1.5 * BREAK_CRIT.damage);
    w.dispose();
  });

  it('happens once per break', async () => {
    const { w, d } = await brokenDummy();
    const evs = stepN(w, 110, (i) => (i === 0 || i === 60 ? press(BTN.light) : idle()));
    const hits = hitsOn(evs, d.id);
    expect(hits.length).toBe(2);
    expect(hits[0].ev.strike).toBe('breakCrit');
    expect(hits[1].ev.strike).toBeUndefined();
    w.dispose();
  });

  it('the hit that breaks poise is not itself the critical', async () => {
    const { w, d } = await combatWorld().then((cw) => ({ ...cw, d: cw.w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI) }));
    d.combat!.poise = 1;
    d.combat!.poiseDelay = 999;
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(d.combat!.action).toMatchObject({ kind: 'stagger', reason: 'broken' });
    expect(hitsOn(evs, d.id)[0].ev.strike).toBeUndefined();
    expect(hitsOn(evs, d.id)[0].ev.crit).toBe(false);
    w.dispose();
  });

  it('a break can be earned again after it ends', async () => {
    const { w, p, d } = await brokenDummy();
    const first = stepN(w, 60, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(first, d.id)[0].ev.strike).toBe('breakCrit');
    d.combat!.action = null;
    breakPoise(w, p, d);
    const again = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(again, d.id)[0].ev.strike).toBe('breakCrit');
    w.dispose();
  });

  it('hits during the break neither cut it short nor break poise again', async () => {
    const { w, d } = await brokenDummy();
    const stagger = d.combat!.action;
    d.combat!.poise = 1;
    d.combat!.poiseDelay = 999;
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(evs, d.id).length).toBe(1);
    expect(d.combat!.action).toBe(stagger);
    expect(d.combat!.poise).toBe(1);
    w.dispose();
  });

  it('a spell landing first does not spend it', async () => {
    const { w, p, d } = await brokenDummy();
    const ctx = { now: w.now, entities: w.entities, get: (id: number) => w.get(id), events: [], motion: new Map(), frozen: new Set<number>() };
    resolveHit(ctx, p, d, {
      move: 'bolt', base: 10, kind: 'arcane', poise: 0, hitstun: 0, knockdown: false, pushback: 0, hitstop: 0, unblockable: false, heavy: false, crit: false, mana: 0, from: { ...p.tf.pos }, projectile: true,
    });
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(evs, d.id)[0].ev.strike).toBe('breakCrit');
    w.dispose();
  });
});

describe('backstab', () => {
  /** A passive dummy 1.5 m ahead of the player, facing `yaw`. */
  async function swingAt(yaw: number, setup?: (d: Entity) => void, enemy = 'dummy_passive') {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy(enemy, { x: 0, y: 0, z: 1.5 }, yaw);
    setup?.(d);
    // Dummies turn to face the player: hold this one where the test put it.
    const evs = stepN(w, 30, (i) => {
      d.tf.yaw = yaw;
      return i === 0 ? press(BTN.light) : idle();
    });
    const [hit] = hitsOn(evs, d.id);
    const poise = d.combat!.poiseMax - d.combat!.poise;
    w.dispose();
    return { hit, poise, p };
  }

  it('a hit from behind deals bonus damage and poise damage', async () => {
    const front = await swingAt(Math.PI);
    const back = await swingAt(0);
    expect(front.hit.ev.strike).toBeUndefined();
    expect(back.hit.ev.strike).toBe('backstab');
    expect(back.hit.ev.damage).toBe(Math.round(front.hit.ev.damage * BACKSTAB.damage));
    expect(back.poise).toBe(front.poise * BACKSTAB.poise);
    expect(back.hit.ev.hitstop).toBe(BACKSTAB.hitstop);
  });

  it('only counts inside the rear arc', async () => {
    const half = (BACKSTAB.arcDeg / 2) * (Math.PI / 180);
    expect((await swingAt(half - 0.05)).hit.ev.strike).toBe('backstab');
    expect((await swingAt(half + 0.05)).hit.ev.strike).toBeUndefined();
  });

  it('an enemy attacking you can not be backstabbed', async () => {
    const { hit } = await swingAt(0, (d) => forceEnemyAttack(d, 'swing'), 'dummy_swing');
    expect(hit.ev.strike).toBeUndefined();
  });

  it('a boss can not be backstabbed', async () => {
    const { w } = await combatWorld();
    const b = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, 0);
    b.kind = 'boss';
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(hitsOn(evs, b.id)[0].ev.strike).toBeUndefined();
    w.dispose();
  });
});

describe('flow', () => {
  /** Press `b` on tick `at` of a swing; returns the tick the next action started. */
  async function cancelTick(start: number, b: number, at: number, withTarget: boolean, ticks = 90) {
    const { w, p } = await combatWorld();
    if (withTarget) w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    let first: unknown = null;
    let started = -1;
    for (let i = 0; i < ticks && started < 0; i++) {
      step(w, i === 0 ? press(start) : i >= at ? cmd({ press: b, move: { x: 0, y: 1 } }) : idle());
      if (i === 0) first = p.combat!.action;
      else if (p.combat!.action !== first && p.combat!.action) started = i;
    }
    w.dispose();
    return started;
  }

  it('a heavy that connected dodges out sooner than one that whiffed', async () => {
    const hit = await cancelTick(BTN.heavy, BTN.dodge, 1, true);
    const whiff = await cancelTick(BTN.heavy, BTN.dodge, 1, false);
    const tm = clipTiming('attack_heavy');
    expect(whiff).toBe(tm.activeEnd + PLAYER_MOVES.heavy.whiffLock!);
    // The hit's cancel is at activeEnd, plus the hit-stop that froze the clock.
    expect(hit).toBe(tm.activeEnd + PLAYER_MOVES.heavy.hitstop);
    expect(hit).toBeLessThan(whiff);
  });

  it('a dodge never cancels startup or active frames, hit or whiff', async () => {
    const tm = clipTiming('attack_light_1');
    expect(await cancelTick(BTN.light, BTN.dodge, 1, false)).toBe(tm.activeEnd);
    // Connecting freezes the clip for the hit-stop, and the active frames still play out in full.
    expect(await cancelTick(BTN.light, BTN.dodge, 1, true)).toBe(tm.activeEnd + PLAYER_MOVES.light1.hitstop);
  });

  it('a light that connected chains sooner than one that whiffed, but after its active frames', async () => {
    const hit = await cancelTick(BTN.light, BTN.light, 9, true);
    const whiff = await cancelTick(BTN.light, BTN.light, 9, false);
    const tm = clipTiming('attack_light_1');
    expect(whiff).toBe(tm.cancel);
    expect(hit).toBe(tm.cancel - BUFFER.hitChainEarly + PLAYER_MOVES.light1.hitstop);
    expect(tm.cancel - BUFFER.hitChainEarly).toBeGreaterThanOrEqual(tm.activeEnd);
  });

  it('a press just before the swing comes out is held for the chain', async () => {
    const tm = clipTiming('attack_light_1');
    const { w, p } = await combatWorld();
    stepN(w, tm.cancel + 1, (i) => (i === 0 || i === tm.activeStart - BUFFER.earlyHold ? press(BTN.light) : idle()));
    expect(attack(p)?.move).toBe('light2');
    w.dispose();
  });

  it('a press just after a swing ends still continues the string', async () => {
    const tm = clipTiming('attack_light_1');
    const { w, p } = await combatWorld();
    stepN(w, tm.end + 1, (i) => (i === 0 ? press(BTN.light) : idle()));
    expect(p.combat!.action).toBeNull();
    stepN(w, BUFFER.chainGrace - 3);
    step(w, press(BTN.light));
    expect(attack(p)?.move).toBe('light2');
    w.dispose();
  });

  it('after the grace the string starts over', async () => {
    const tm = clipTiming('attack_light_1');
    const { w, p } = await combatWorld();
    stepN(w, tm.end + BUFFER.chainGrace + 1, (i) => (i === 0 ? press(BTN.light) : idle()));
    step(w, press(BTN.light));
    expect(attack(p)?.move).toBe('light1');
    w.dispose();
  });

  it('the stick turns a swing during startup, at a limited rate', async () => {
    const { w, p } = await combatWorld();
    step(w, press(BTN.light));
    const startYaw = p.tf.yaw;
    const startup = clipTiming('attack_light_1').activeStart - 1;
    stepN(w, startup, () => cmd({ move: { x: 1, y: 0 } }));
    const turned = Math.abs(p.tf.yaw - startYaw);
    expect(turned).toBeGreaterThan(0.3);
    expect(turned).toBeLessThanOrEqual(SWING_STEER.turnRate * ((startup + 1) / 60) + 1e-6);
    w.dispose();
  });

  it('the stick does nothing once the swing is active', async () => {
    const { w, p } = await combatWorld();
    stepN(w, clipTiming('attack_light_1').activeStart + 1, (i) => (i === 0 ? press(BTN.light) : idle()));
    const yaw = p.tf.yaw;
    const dir = { ...attack(p)!.lungeDir };
    stepN(w, 4, () => cmd({ move: { x: 1, y: 0 } }));
    expect(p.tf.yaw).toBe(yaw);
    expect(attack(p)!.lungeDir).toEqual(dir);
    w.dispose();
  });

  it('the lunge follows a target that moves during startup', async () => {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 2.4 }, Math.PI);
    step(w, press(BTN.light));
    teleport(w, d, { x: 1.2, y: 0, z: 2.2 });
    stepN(w, 5);
    expect(attack(p)!.lungeDir.x).toBeGreaterThan(0.2);
    expect(p.tf.pos.x).toBeGreaterThan(0.05);
    w.dispose();
  });
});

describe('determinism', () => {
  it('a snapshot taken mid-counter replays to the same hash', async () => {
    const { w } = await perfectDodge(5);
    stepN(w, 6, () => press(BTN.light));
    const snap = w.snapshot();
    stepN(w, 40, (i) => (i % 7 === 0 ? press(BTN.light) : idle()));
    const a = w.hash();
    w.restore(snap);
    stepN(w, 40, (i) => (i % 7 === 0 ? press(BTN.light) : idle()));
    expect(w.hash()).toBe(a);
    w.dispose();
  });
});
