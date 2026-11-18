import { describe, expect, it } from 'vitest';
import { BLOCK, PLAYER_MOVES } from '../../src/content/combat';
import { ENEMIES } from '../../src/content/enemies';
import { MOUNT } from '../../src/content/mounts';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, combatWorld, ent, forceEnemyAttack, hitsOn, hold, idle, lookahead, ofType, press, step, stepN, type TickEvents } from './combatHelpers';
import { interact } from './m3Helpers';
import { flatSproutvale, standAt } from './m4Helpers';

/**
 * The parry as a mechanic: a press just before the blow stuns the attacker for a time set by its
 * tier, a heavy during the stun is a riposte, and a heavy right after a plain block is a counter.
 * The swinging dummy 1.5 m in front of the player connects on world tick SWING_HIT.
 */
const SWING_HIT = 54;
const { normal, elite, boss } = BLOCK.parryStun;

const hitMe = (id: number) => (ev: SimEvent[]) => ev.some((e) => e.type === 'hit' && e.target === id);

async function yard() {
  const { w, p } = await combatWorld();
  const d = w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
  return { w, p, d };
}

/** Run to the end of `last`: block held on the ticks `blockOn` says, `extra` buttons pressed on top. */
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

/** Parry the dummy's swing with a press `k` ticks before it lands. */
async function parried(k = 5) {
  const y = await yard();
  const evs = play(y.w, SWING_HIT, (i) => i >= SWING_HIT - k);
  return { ...y, evs };
}

/** `def` a few metres in front of the player, already swinging `move`; `hitAt` is when it connects. */
async function swungAt(def: string, move: string, dist: number) {
  const setup = async () => {
    const { w, p } = await combatWorld();
    const e = w.spawnEnemy(def, { x: 0, y: 0, z: dist }, Math.PI);
    forceEnemyAttack(e, move);
    return { w, p, e };
  };
  const probe = await setup();
  const hitAt = probe.w.now + lookahead(probe.w, hitMe(probe.p.id), 200);
  probe.w.dispose();
  return { ...(await setup()), hitAt };
}

describe('the parry window', () => {
  it('a press 11 ticks before the blow parries it; 12 ticks before is a plain block', async () => {
    expect(BLOCK.parryTicks).toBe(12);
    for (const [k, want] of [[0, 'parry'], [11, 'parry'], [12, 'block']] as const) {
      const { w, evs } = await parried(k);
      expect(ofType(evs, 'parry').length, `k=${k}`).toBe(want === 'parry' ? 1 : 0);
      expect(ofType(evs, 'block').length, `k=${k}`).toBe(want === 'block' ? 1 : 0);
      w.dispose();
    }
  });

  it('a guard held from early is a block: chip damage and stamina, and the enemy keeps its feet', async () => {
    const { w, p, d, evs } = await parried(40);
    expect(ofType(evs, 'parry')).toEqual([]);
    expect(ofType(evs, 'block').map((x) => x.ev.damage)).toEqual([2]);
    expect(p.vitals!.hp).toBe(118);
    expect(p.vitals!.stamina).toBeLessThan(100);
    expect(d.combat!.action?.kind).not.toBe('stagger');
    expect(p.combat!.riposteUntil).toBe(0);
    w.dispose();
  });

  it('block held down through a stagger rises with no parry window', async () => {
    const { w, p } = await yard();
    // Held all along: the guard goes up by itself 10 ticks before the blow, inside what would be the window.
    p.combat!.action = { kind: 'hitstun', t: 0, dur: SWING_HIT - 10, knockdown: false };
    const evs = play(w, SWING_HIT, () => true);
    expect(p.combat!.action).toMatchObject({ kind: 'block', parryTicks: 0 });
    expect(ofType(evs, 'parry')).toEqual([]);
    expect(ofType(evs, 'block').length).toBe(1);
    w.dispose();
  });

  it('a press late in a recovery counts from the press, not from when the guard can rise', async () => {
    const { w, p } = await combatWorld();
    p.combat!.action = { kind: 'hitstun', t: 0, dur: 4, knockdown: false };
    step(w, press(BTN.block));
    expect(p.combat!.action?.kind).toBe('hitstun');
    stepN(w, 3, () => hold(BTN.block));
    // Up on the fourth tick after the press: the window has only what is left of the press's 12.
    expect(p.combat!.action).toMatchObject({ kind: 'block', t: 0, parryTicks: BLOCK.parryTicks - 3 });
    w.dispose();
  });

  it('mashing block keeps the window at 4 ticks', async () => {
    const { w, p } = await combatWorld();
    for (let i = 0; i < 3; i++) {
      step(w, press(BTN.block));
      step(w, idle());
    }
    step(w, press(BTN.block));
    expect(p.combat!.action).toMatchObject({ kind: 'block', parryTicks: BLOCK.spamParryTicks });
    w.dispose();
  });

  it('unblockable moves cannot be parried, even inside the window', async () => {
    const { w, p, e, hitAt } = await swungAt('brute', 'slam', 2.2);
    const evs = play(w, hitAt, (i) => i >= hitAt - 3);
    expect(ofType(evs, 'parry')).toEqual([]);
    expect(hitsOn(evs, p.id).map((x) => x.ev.attacker)).toEqual([e.id]);
    expect(e.combat!.action?.kind).toBe('attack');
    w.dispose();
  });
});

describe('the stun', () => {
  it('a normal enemy is stunned for 75 ticks with the parried reason', async () => {
    const { w, d, evs } = await parried();
    expect(normal.ticks).toBe(75);
    expect(d.combat!.action).toMatchObject({ kind: 'stagger', t: 0, dur: 75, reason: 'parried' });
    expect(ofType(evs, 'stagger').map((x) => x.ev)).toEqual([{ type: 'stagger', entity: d.id, ticks: 75, reason: 'parried' }]);
    expect(ofType(evs, 'parry')[0].ev.stun).toBe(75);
    // The clock runs after the 10 ticks of hit-stop, and the enemy is free once it runs out.
    stepN(w, BLOCK.parryHitstop + 74);
    expect(d.combat!.action?.kind).toBe('stagger');
    stepN(w, 1);
    expect(d.combat!.action?.kind).not.toBe('stagger');
    w.dispose();
  });

  it('an elite is stunned for less, and loses poise', async () => {
    const { w, e, hitAt } = await swungAt('brute', 'punch', 2.2);
    expect(ENEMIES.brute.elite).toBe(true);
    const poise = e.combat!.poiseMax;
    play(w, hitAt, (i) => i >= hitAt - 5);
    expect(elite.ticks).toBeLessThan(normal.ticks);
    expect(e.combat!.action).toMatchObject({ kind: 'stagger', dur: elite.ticks, reason: 'parried' });
    expect(e.combat!.poise).toBeCloseTo(poise * (1 - elite.poise), 6);
    w.dispose();
  });

  it('a boss only flinches, and repeated parries break its poise', async () => {
    const { w, e, hitAt } = await swungAt('scrapjaw', 'smash', 3.5);
    expect(ENEMIES.scrapjaw.boss).toBeDefined();
    const max = e.combat!.poiseMax;
    play(w, hitAt, (i) => i >= hitAt - 5);
    expect(boss.ticks).toBeLessThan(elite.ticks);
    expect(e.combat!.action).toMatchObject({ kind: 'stagger', dur: boss.ticks, reason: 'parried' });
    expect(e.combat!.poise).toBeCloseTo(max * (1 - boss.poise), 6);
    expect(e.combat!.poiseDelay).toBeGreaterThan(0);

    // A parry that takes the last of its poise is a real poise break.
    e.combat!.poise = max * boss.poise * 0.5;
    forceEnemyAttack(e, 'smash');
    const again = w.now + lookahead(w, (ev) => ev.some((x) => x.type === 'hit' || x.type === 'block'), 200, () => hold(BTN.block));
    const boss2 = ent(w, e.id);
    play(w, again, (i) => i >= again - 5);
    expect(boss2.combat!.action).toMatchObject({ kind: 'stagger', dur: ENEMIES.scrapjaw.staggerTicks, reason: 'broken' });
    expect(boss2.combat!.poise).toBe(max);
    w.dispose();
  });

  it('the parried attack is cancelled and can never land', async () => {
    const { w, p, d, evs } = await parried();
    expect(d.combat!.action?.kind).toBe('stagger');
    const after = stepN(w, BLOCK.parryHitstop + normal.ticks - 1);
    expect(hitsOn([...evs, ...after], p.id)).toEqual([]);
    expect(ofType(after, 'block')).toEqual([]);
    expect(p.vitals!.hp).toBe(120);
    w.dispose();
  });

  it('the same swing does not go on to hit a second player beside the one who parried', async () => {
    const setup = async () => {
      const { w, p } = await combatWorld();
      const other = w.spawnPlayer(1, { x: 0.85, y: 0, z: 0 }, 0);
      const d = w.spawnEnemy('dummy_swing', { x: 0.4, y: 0, z: 1.5 }, Math.PI);
      return { w, p, other, d };
    };
    // Unparried, the one swing reaches both players on the same tick.
    const probe = await setup();
    const hitAt = probe.w.now + lookahead(probe.w, hitMe(probe.p.id), 200);
    const unparried: SimEvent[] = [];
    for (let i = probe.w.now; i <= hitAt; i++) unparried.push(...step(probe.w));
    expect(unparried.filter((e) => e.type === 'hit').map((e) => (e.type === 'hit' ? e.target : -1)).sort()).toEqual([probe.p.id, probe.other.id].sort());
    probe.w.dispose();

    const { w, p, other, d } = await setup();
    const seen: SimEvent[] = [];
    for (let i = w.now; i <= hitAt + 30; i++) seen.push(...step(w, i >= hitAt - 5 ? hold(BTN.block) : idle()));
    expect(seen.filter((e) => e.type === 'parry').length).toBe(1);
    expect(d.combat!.action?.kind).toBe('stagger');
    expect(seen.filter((e) => e.type === 'hit' && e.target === other.id)).toEqual([]);
    expect(p.vitals!.hp).toBe(120);
    w.dispose();
  });
});

describe('the riposte', () => {
  it('lands for big damage on the stunned enemy, at the last moment the window allows', async () => {
    const last = SWING_HIT + BLOCK.parryHitstop + normal.ticks - BLOCK.riposteStartup - 1;
    const { w, p, d } = await parried();
    play(w, last, () => true, (i) => (i === last ? BTN.heavy : 0));
    expect(p.combat!.action).toMatchObject({ kind: 'attack', move: 'riposte' });
    // Committed: the stun now outlasts the swing, however late in it the staff connects.
    const stun = d.combat!.action;
    expect(stun?.kind === 'stagger' && stun.dur - stun.t).toBeGreaterThanOrEqual(BLOCK.riposteReach);
    const evs = stepN(w, BLOCK.riposteStartup + 24, () => hold(BTN.block));
    const [hit] = hitsOn(evs, d.id);
    expect(hit.ev.move).toBe('riposte');
    expect(hit.ev.damage).toBe(Math.round(20 * PLAYER_MOVES.riposte.mv * 1.5 * BLOCK.riposteBonus));
    w.dispose();
  });

  it('is a plain heavy once the window has closed', async () => {
    const late = SWING_HIT + BLOCK.parryHitstop + normal.ticks - BLOCK.riposteStartup;
    const { w, p } = await parried();
    play(w, late, () => true, (i) => (i === late ? BTN.heavy : 0));
    expect(p.combat!.action).toMatchObject({ kind: 'attack', move: 'heavy' });
    w.dispose();
  });

  it('gets no bonus on an enemy that is no longer stunned', async () => {
    const { w, p, d } = await parried();
    play(w, SWING_HIT + 12, () => true, (i) => (i === SWING_HIT + 12 ? BTN.heavy : 0));
    expect(p.combat!.action).toMatchObject({ kind: 'attack', move: 'riposte' });
    d.combat!.action = null;
    const [hit] = hitsOn(stepN(w, BLOCK.riposteStartup + 24, () => hold(BTN.block)), d.id);
    expect(hit.ev.damage).toBe(Math.round(20 * PLAYER_MOVES.riposte.mv * 1.5));
    w.dispose();
  });

  it('goes for the enemy the parry stunned, even with another one closer to the swing', async () => {
    const { w, p, d } = await parried();
    const near = w.spawnEnemy('dummy_passive', { x: 0.9, y: 0, z: 0.4 }, Math.PI);
    play(w, SWING_HIT + 11, () => true, (i) => (i === SWING_HIT + 11 ? BTN.heavy : 0));
    const a = p.combat!.action;
    expect(a).toMatchObject({ kind: 'attack', move: 'riposte' });
    if (a?.kind !== 'attack') throw new Error('no riposte');
    const dx = d.tf.pos.x - p.tf.pos.x, dz = d.tf.pos.z - p.tf.pos.z;
    const len = Math.hypot(dx, dz);
    expect(a.lungeDir.x).toBeCloseTo(dx / len, 6);
    expect(a.lungeDir.z).toBeCloseTo(dz / len, 6);
    expect(near.vitals!.hp).toBe(near.vitals!.hpMax);
    w.dispose();
  });

  it('a boss flinch is still long enough for a riposte pressed during the freeze', async () => {
    const { w, p, e, hitAt } = await swungAt('scrapjaw', 'smash', 3.5);
    play(w, hitAt, (i) => i >= hitAt - 5);
    const hp = e.vitals!.hp;
    const evs = play(w, hitAt + BLOCK.parryHitstop + BLOCK.riposteStartup + 24, () => true, (i) => (i === hitAt + 3 ? BTN.heavy : 0));
    const [hit] = hitsOn(evs, e.id);
    expect(hit.ev.move).toBe('riposte');
    expect(e.vitals!.hp).toBeLessThan(hp);
    expect(p.combat!.riposteUntil).toBe(0);
    // Riposte bonus applied: it landed inside the flinch.
    expect(hit.ev.damage).toBeGreaterThan(Math.round((20 * PLAYER_MOVES.riposte.mv * 1.5 * 100) / (100 + e.combat!.defense.physical) * 1.2));
    w.dispose();
  });
});

describe('the guard counter', () => {
  /** Block the swing with a guard held from early, then press heavy `after` ticks later. */
  async function counter(after: number) {
    const { w, p, d } = await yard();
    const at = SWING_HIT + after;
    const evs = play(w, at, (i) => i >= SWING_HIT - 30, (i) => (i === at ? BTN.heavy : 0));
    return { w, p, d, evs };
  }

  it('a heavy right after a block is a guard counter, and hits hard', async () => {
    const { w, p, d } = await counter(5);
    expect(p.combat!.action).toMatchObject({ kind: 'attack', move: 'guardCounter' });
    expect(p.combat!.guardCounterUntil).toBe(0);
    const [hit] = hitsOn(stepN(w, BLOCK.riposteStartup + 24), d.id);
    expect(hit.ev.move).toBe('guardCounter');
    expect(hit.ev.damage).toBe(Math.round(20 * PLAYER_MOVES.guardCounter.mv));
    expect(PLAYER_MOVES.guardCounter.mv).toBeGreaterThan(PLAYER_MOVES.heavy.mv);
    w.dispose();
  });

  it('the window edges: last tick is a counter, the next is a plain heavy', async () => {
    const last = 3 + BLOCK.guardCounterWindow - 1;
    const on = await counter(last);
    expect(on.p.combat!.action).toMatchObject({ kind: 'attack', move: 'guardCounter' });
    on.w.dispose();
    const off = await counter(last + 1);
    expect(off.p.combat!.action).toMatchObject({ kind: 'attack', move: 'heavy' });
    off.w.dispose();
  });

  it('a blocked coin opens no counter, and a broken guard opens none', async () => {
    const shot = await combatWorld();
    const s = shot.w.spawnEnemy('dummy_shooter', { x: 0, y: 0, z: 8 }, Math.PI);
    const evs = stepN(shot.w, 200, () => hold(BTN.block));
    expect(ofType(evs, 'block').some((x) => x.ev.attacker === s.id)).toBe(true);
    expect(shot.p.combat!.guardCounterUntil).toBe(0);
    shot.w.dispose();

    const { w, p } = await yard();
    play(w, SWING_HIT - 1, (i) => i >= SWING_HIT - 30);
    p.vitals!.stamina = 1;
    const broke = play(w, SWING_HIT, () => true);
    expect(ofType(broke, 'block')[0].ev.guardBreak).toBe(true);
    expect(p.combat!.guardCounterUntil).toBe(0);
    w.dispose();
  });
});

describe('projectiles and blasts', () => {
  it('a parried coin is still reflected, and stuns nobody', async () => {
    const setup = async () => {
      const { w, p } = await combatWorld();
      const s = w.spawnEnemy('dummy_shooter', { x: 0, y: 0, z: 8 }, Math.PI);
      return { w, p, s };
    };
    const probe = await setup();
    const hitAt = probe.w.now + lookahead(probe.w, hitMe(probe.p.id), 200);
    probe.w.dispose();
    const { w, p, s } = await setup();
    const evs = play(w, hitAt, (i) => i >= hitAt - 5);
    const [parry] = ofType(evs, 'parry');
    expect(parry.ev.projectile).toBe(true);
    expect(parry.ev.stun).toBeUndefined();
    expect(w.entities.find((e) => e.projectile)!.projectile!.reflected).toBe(true);
    expect(s.combat!.action?.kind).not.toBe('stagger');
    expect(p.combat!.riposteUntil).toBe(0);
    w.dispose();
  });

  it('a blast on the ground can be parried, but its far-off caster is not stunned', async () => {
    const found = Object.values(ENEMIES).flatMap((d) => d.moves.filter((m) => m.area && !m.unblockable).map((m) => ({ def: d.id, move: m })))[0];
    const setup = async () => {
      const { w, p } = await combatWorld();
      const e = w.spawnEnemy(found.def, { x: 0, y: 0, z: 10 }, Math.PI);
      forceEnemyAttack(e, found.move.id);
      const a = e.combat!.action;
      if (a?.kind === 'attack') a.aim = { x: 0, y: 0, z: 0.5 };
      return { w, p, e };
    };
    const probe = await setup();
    const hitAt = probe.w.now + lookahead(probe.w, hitMe(probe.p.id), 200);
    probe.w.dispose();
    const { w, p, e } = await setup();
    const evs = play(w, hitAt, (i) => i >= hitAt - 5);
    const [parry] = ofType(evs, 'parry');
    expect(parry.ev.attacker).toBe(e.id);
    expect(parry.ev.stun).toBeUndefined();
    expect(e.combat!.action?.kind).not.toBe('stagger');
    expect(p.combat!.riposteUntil).toBe(0);
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });
});

describe('from the saddle', () => {
  async function mounted(): Promise<{ w: SimWorld; p: Entity; foe: Entity }> {
    const { w, p } = await flatSproutvale();
    const bull = w.entities.find((e) => e.mount)!;
    standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
    step(w, interact());
    stepN(w, MOUNT.mountTicks + 1);
    expect(p.riding?.state).toBe('riding');
    const at = { x: p.tf.pos.x + Math.sin(p.tf.yaw) * 2.2, y: p.tf.pos.y, z: p.tf.pos.z + Math.cos(p.tf.yaw) * 2.2 };
    const foe = w.spawnEnemy('brute', at, p.tf.yaw + Math.PI);
    forceEnemyAttack(foe, 'punch');
    return { w, p, foe };
  }

  it('a parry on the bull stuns the attacker, and the riposte comes from the saddle', async () => {
    const { w, p, foe } = await mounted();
    const hold0 = () => { const c = idle(); c.camYaw = p.tf.yaw; return c; };
    const until = lookahead(w, hitMe(p.id), 200, hold0);
    const rider = ent(w, p.id), brute = ent(w, foe.id);
    const blockCmd = () => { const c = hold(BTN.block); c.camYaw = rider.tf.yaw; return c; };
    const evs = stepN(w, until + 1, (i) => (i >= until - 5 ? blockCmd() : hold0()));
    expect(ofType(evs, 'parry').map((x) => x.ev.attacker)).toEqual([brute.id]);
    expect(rider.riding?.state).toBe('riding');
    expect(rider.vitals!.hp).toBe(rider.vitals!.hpMax);
    expect(brute.combat!.action).toMatchObject({ kind: 'stagger', dur: elite.ticks, reason: 'parried' });

    step(w, press(BTN.heavy, { camYaw: rider.tf.yaw }));
    stepN(w, BLOCK.parryHitstop);
    expect(rider.combat!.action).toMatchObject({ kind: 'attack', move: 'riposte' });
    expect(rider.riding?.state).toBe('riding');
    w.dispose();
  });
});

describe('determinism', () => {
  it('a rewind through a parry, stun and riposte replays to the same hash', async () => {
    const { w } = await yard();
    play(w, SWING_HIT - 6, () => false);
    const snap = w.snapshot();
    const run = () => {
      const from = w.now;
      play(w, from + 60, (i) => i >= SWING_HIT - 5, (i) => (i === SWING_HIT + 4 ? BTN.heavy : 0));
      return w.hash();
    };
    const first = run();
    w.restore(snap);
    expect(run()).toBe(first);
    w.dispose();
  });
});
