import { describe, expect, it } from 'vitest';
import { LOCK } from '../../src/content/combat';
import { flatDist } from '../../src/sim/combat/geometry';
import type { Vec3 } from '../../src/sim/math';
import { BTN, atYaw, cmd, combatWorld, hitsOn, idle, ofType, press, step, stepN, teleport } from './combatHelpers';

/**
 * Plan §4.1 hard lock. Player at the origin; yaw 0 faces +Z and +90° is +X (the player's left).
 * Passive dummies don't move, so they make fixed targets. Sandbox pillars stand at (±9, 0, ±9).
 */
const DEG = Math.PI / 180;

async function yard(targets: Vec3[]) {
  const { w, p } = await combatWorld();
  const ids = targets.map((pos) => w.spawnEnemy('dummy_passive', pos, Math.PI).id);
  return { w, p, ids };
}

/** Press lock once with the camera at `camDeg`; returns the locked id (or null). */
async function acquire(targets: Vec3[], camDeg = 0) {
  const { w, p, ids } = await yard(targets);
  step(w, press(BTN.lock, { camYaw: camDeg * DEG }));
  const lock = p.combat!.lock;
  w.dispose();
  return lock === null ? null : ids.indexOf(lock);
}

describe('lock-on acquire (score = angle° + 0.5·distance, 70° cone, 20 m, line of sight)', () => {
  it('only inside the 70° camera cone', async () => {
    expect(await acquire([atYaw(30, 3)])).toBe(0);
    expect(await acquire([atYaw(-34, 3)])).toBe(0);
    expect(await acquire([atYaw(40, 3)])).toBeNull();
    expect(await acquire([atYaw(-40, 3)])).toBeNull();
    // The cone follows the camera, not the player's facing.
    expect(await acquire([atYaw(40, 3)], 40)).toBe(0);
    expect(await acquire([atYaw(180, 5)], 180)).toBe(0);
  });

  it('only within 20 m', async () => {
    expect(await acquire([atYaw(0, 19.5)])).toBe(0);
    expect(await acquire([atYaw(0, 20.5)])).toBeNull();
  });

  it('the lowest angle° + 0.5·distance wins', async () => {
    // 0° at 10 m scores 5; 8° at 2 m scores 9.
    expect(await acquire([atYaw(8, 2), atYaw(0, 10)])).toBe(1);
    // 0° at 16 m scores 8; 6° at 2 m scores 7.
    expect(await acquire([atYaw(0, 16), atYaw(6, 2)])).toBe(1);
    // Nearest is not best: 20° at 2 m (21) loses to −5° at 12 m (11).
    expect(await acquire([atYaw(20, 2), atYaw(-5, 12)])).toBe(1);
  });

  it('needs line of sight: a target behind a pillar is skipped', async () => {
    // (12, 0, 12) sits straight behind the pillar at (9, 0, 9): score 0 + 8.5 if it were visible.
    const hidden = { x: 12, y: 0, z: 12 };
    const visible = atYaw(45 + 25, 5); // 25° off the camera, score 27.5
    expect(await acquire([hidden, visible], 45)).toBe(1);
    expect(await acquire([hidden], 45)).toBeNull();
  });

  it('a second lock press releases the lock', async () => {
    const { w, p, ids } = await yard([atYaw(0, 6)]);
    const e1 = stepN(w, 1, () => press(BTN.lock));
    expect(p.combat!.lock).toBe(ids[0]);
    expect(ofType(e1, 'lock').map((x) => x.ev.target)).toEqual([ids[0]]);
    stepN(w, 5);
    const e2 = stepN(w, 1, () => press(BTN.lock));
    expect(p.combat!.lock).toBeNull();
    expect(ofType(e2, 'lock').map((x) => x.ev.target)).toEqual([null]);
    w.dispose();
  });
});

describe('lock-on switch', () => {
  it('lockSwitch +1 picks the nearest target to the right, −1 to the left; nothing there keeps the lock', async () => {
    // Right is negative yaw (−X). All 10 m away so "nearest" by angle and by distance agree.
    const { w, p, ids } = await yard([atYaw(0, 10), atYaw(-10, 10), atYaw(-30, 10), atYaw(15, 10), atYaw(40, 10)]);
    const [centre, r1, r2, l1, l2] = ids;
    step(w, press(BTN.lock));
    expect(p.combat!.lock).toBe(centre);
    const sw = (dir: number) => {
      step(w, cmd({ lockSwitch: dir }));
      step(w, idle());
      return p.combat!.lock;
    };
    expect(sw(+1)).toBe(r1);
    expect(sw(+1)).toBe(r2);
    expect(sw(+1)).toBe(r2); // nothing further right
    expect(sw(-1)).toBe(r1);
    expect(sw(-1)).toBe(centre);
    expect(sw(-1)).toBe(l1);
    expect(sw(-1)).toBe(l2); // outside the acquire cone, but in range and in sight
    expect(sw(-1)).toBe(l2);
    w.dispose();
  });

  it('switching skips targets out of sight', async () => {
    // Centre at 55°. (12, 0, 12) is straight behind the pillar at (9, 0, 9), 10° to the right of
    // the centre; a visible target sits 35° to the right.
    const hiddenRight = { x: 12, y: 0, z: 12 };
    const { w, p, ids } = await yard([atYaw(55, 8), hiddenRight, atYaw(20, 8)]);
    const [centre, , visibleRight] = ids;
    step(w, press(BTN.lock, { camYaw: 55 * DEG }));
    expect(p.combat!.lock).toBe(centre);
    step(w, cmd({ lockSwitch: +1 }));
    expect(p.combat!.lock).toBe(visibleRight);
    w.dispose();
  });
});

describe('lock-on break rules', () => {
  it('breaks beyond 28 m', async () => {
    const { w, p, ids } = await yard([atYaw(0, 10)]);
    step(w, press(BTN.lock));
    expect(p.combat!.lock).toBe(ids[0]);
    const target = w.get(ids[0])!;
    // Back away (camera-relative −Y is world −Z); the lock keeps the player facing the target.
    let lastDist = 0;
    let brokeAt = -1;
    for (let i = 0; i < 400 && brokeAt < 0; i++) {
      lastDist = flatDist(p.tf.pos, target.tf.pos); // what lockOn sees this tick (before moving)
      const ev = step(w, cmd({ move: { x: 0, y: -1 } }));
      if (ofType(ev.map((e) => ({ tick: i, ev: e })), 'lock').length) brokeAt = i;
      else expect(lastDist, `still locked at tick ${i}`).toBeLessThanOrEqual(LOCK.breakRange);
    }
    expect(p.combat!.lock).toBeNull();
    expect(lastDist).toBeGreaterThan(28);
    expect(lastDist).toBeLessThan(28 + 0.2);
    w.dispose();
  });

  it('breaks after more than 60 ticks without line of sight, and sight resets the count', async () => {
    const { w, p, ids } = await yard([atYaw(45, 12)]);
    const target = w.get(ids[0])!;
    step(w, press(BTN.lock, { camYaw: 45 * DEG }));
    expect(p.combat!.lock).toBe(ids[0]);
    const behindPillar = { x: 12, y: 0, z: 12 };
    teleport(w, target, behindPillar);
    stepN(w, 30);
    expect(p.combat!.lock).toBe(ids[0]);
    expect(p.combat!.lockLostTicks).toBe(30);
    // Back in sight for a tick: the count starts over.
    teleport(w, target, atYaw(45, 12));
    step(w);
    expect(p.combat!.lockLostTicks).toBe(0);
    teleport(w, target, behindPillar);
    for (let i = 1; i <= LOCK.losGraceTicks; i++) {
      step(w);
      expect(p.combat!.lock, `${i} ticks out of sight`).toBe(ids[0]);
    }
    const ev = step(w);
    expect(p.combat!.lock).toBeNull();
    expect(ev.filter((e) => e.type === 'lock')).toEqual([{ type: 'lock', entity: p.id, target: null }]);
    w.dispose();
  });

  it('on the target dying the lock passes to the nearest enemy within 10 m', async () => {
    const { w, p } = await combatWorld();
    const brute = w.spawnEnemy('brute', { x: 0, y: 0, z: 1.9 }, Math.PI);
    const near = w.spawnEnemy('dummy_passive', { x: 6, y: 0, z: -3 }, 0); // 6.7 m
    w.spawnEnemy('dummy_passive', { x: -8, y: 0, z: -2 }, 0); // 8.2 m
    w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: -12 }, 0); // 12 m
    brute.vitals!.hp = 1;
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.lock | BTN.light) : idle()));
    const death = ofType(evs, 'death').find((x) => x.ev.entity === brute.id)!;
    expect(death).toBeDefined();
    expect(hitsOn(evs, brute.id).length).toBe(1);
    const locks = ofType(evs, 'lock').map((x) => [x.tick, x.ev.target]);
    expect(locks).toEqual([[0, brute.id], [death.tick + 1, near.id]]);
    expect(p.combat!.lock).toBe(near.id);
    w.dispose();
  });

  it('on the target dying with nobody within 10 m the lock releases', async () => {
    const { w, p } = await combatWorld();
    const brute = w.spawnEnemy('brute', { x: 0, y: 0, z: 1.9 }, Math.PI);
    w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: -12 }, 0);
    brute.vitals!.hp = 1;
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.lock | BTN.light) : idle()));
    const death = ofType(evs, 'death')[0];
    expect(ofType(evs, 'lock').map((x) => [x.tick, x.ev.target])).toEqual([[0, brute.id], [death.tick + 1, null]]);
    expect(p.combat!.lock).toBeNull();
    w.dispose();
  });
});
