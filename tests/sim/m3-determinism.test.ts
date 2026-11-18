import { describe, expect, it } from 'vitest';
import { idleInput } from '../../src/sim/commands';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN } from './combatHelpers';
import { breakIt, choose, dummies, evs, interact, settle, stand, standBy, tick1, ui, village, VILLAGE_Y } from './m3Helpers';

/**
 * Plan §2.2 / §8 determinism with the RPG layer: a scripted session (the quest, a fight, shopping)
 * hashes the same twice, and the same when resumed from a snapshot in a fresh world.
 */

type Op = (w: SimWorld) => void;

/** A fight with a Grunt by the yard: lights on a beat, a block now and then, its AI on rng `ai`. */
const fight: Op = (w) => {
  stand(w, 230, 80, { x: 230, z: 84 });
  w.spawnEnemy('grunt', { x: 230, y: VILLAGE_Y, z: 84 }, Math.PI);
  for (let i = 0; i < 360; i++) {
    const c = idleInput(0);
    if (i % 24 === 0) c.pressed = c.held = BTN.light;
    else if (i % 90 > 70) c.held = BTN.block;
    if (i % 50 === 10) c.pressed |= BTN.lock;
    tick1(w, c);
  }
  settle(w);
};

const SESSION: Op[] = [
  (w) => {
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    tick1(w, choose(0));
    tick1(w, choose(0));
  },
  (w) => {
    const yard = w.locate('training_yard')!;
    stand(w, yard.x, yard.z - 5);
    tick1(w);
  },
  (w) => {
    for (const d of dummies(w)) {
      stand(w, d.tf.pos.x, d.tf.pos.z - 1.5, { x: d.tf.pos.x, z: d.tf.pos.z });
      breakIt(w, d);
    }
  },
  (w) => {
    standBy(w, 'chest_training');
    tick1(w, interact());
  },
  // ← snapshot here (index 4): the player has left the yard trigger.
  fight,
  (w) => {
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    tick1(w, choose(0));
    tick1(w, choose(0));
  },
  (w) => {
    w.playerEntity(0)!.progress!.sprouts += 200; // test setup: shopping money
    standBy(w, 'merchant_village');
    tick1(w, interact());
    tick1(w, choose(0));
    tick1(w, ui([{ kind: 'buy', merchant: 'merchant_village', item: 'charm_quick_step' }, { kind: 'buy', merchant: 'merchant_village', item: 'staff_nobu' }]));
    tick1(w, ui([{ kind: 'closeMenu' }]));
  },
  (w) => {
    standBy(w, 'shrine_first_light');
    tick1(w, interact());
    // The fight's Grunt may still be after you: gear changes at a shrine regardless (C1 gear lock).
    tick1(w, ui([{ kind: 'rest' }, { kind: 'equip', item: 'staff_nobu' }, { kind: 'spendSkill', skill: 'attack' }, { kind: 'equipSpell', slot: 1, spell: null }, { kind: 'closeMenu' }]));
  },
  fight,
];
const SNAP_AT = 4;

async function play(seed: number, from = 0, to = SESSION.length, into?: SimWorld) {
  const w = into ?? (await village({ seed })).w;
  const hashes: number[] = [];
  for (let i = from; i < to; i++) {
    SESSION[i](w);
    hashes.push(w.hash());
  }
  return { w, hashes };
}

/** The sim's state as plain data: what a rewind must reproduce. */
const rewindState = (w: SimWorld): unknown => JSON.parse(JSON.stringify({ now: w.now, entities: w.entities, world: w.world, rng: w.rng.streams }));

/** Where two states differ: any text, flag, count or shape exactly, and any number by more than `slack`. */
function differences(a: unknown, b: unknown, slack: number, path = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= slack ? [] : [`${path}: ${a} vs ${b}`];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], slack, `${path}.${k}`));
  }
  return a === b ? [] : [`${path}: ${String(a)} vs ${String(b)}`];
}

describe('determinism with the RPG layer', () => {
  it('the scripted session hashes the same twice (every step), and the quest really completed', async () => {
    const a = await play(7);
    const b = await play(7);
    expect(b.hashes).toEqual(a.hashes);
    const p = a.w.playerEntity(0)!.progress!;
    expect(p.quests.q_wake_up.status).toBe('complete');
    expect(p.equipment.staff).toBe('staff_nobu');
    expect(p.xp).toBeGreaterThanOrEqual(15 + 60);
    a.w.dispose();
    b.w.dispose();
  });

  it('a different seed diverges (the loot / ai streams matter)', async () => {
    const a = await play(7);
    const b = await play(8);
    expect(b.hashes[b.hashes.length - 1]).not.toBe(a.hashes[a.hashes.length - 1]);
    a.w.dispose();
    b.w.dispose();
  });

  it('resumed from a snapshot in a fresh world, the rest of the session hashes the same', async () => {
    const a = await play(7, 0, SNAP_AT);
    const snap = a.w.snapshot();
    const rest = await play(7, SNAP_AT, SESSION.length, a.w);

    const fresh = (await village({ seed: 7 })).w;
    fresh.restore(snap);
    expect(fresh.hash()).toBe((await (async () => {
      const c = await play(7, 0, SNAP_AT);
      const h = c.w.hash();
      c.w.dispose();
      return h;
    })()));
    const resumed = await play(7, SNAP_AT, SESSION.length, fresh);
    expect(resumed.hashes).toEqual(rest.hashes);
    a.w.dispose();
    fresh.dispose();
  });

  it('restoring into the same world (rewind) replays the same', async () => {
    const a = await play(7, 0, SNAP_AT);
    const snap = a.w.snapshot();
    await play(7, SNAP_AT, SESSION.length, a.w);
    const first = rewindState(a.w);
    a.w.restore(snap);
    await play(7, SNAP_AT, SESSION.length, a.w);
    const second = rewindState(a.w);
    // Exact but for a few millimetres of position. Rewinding in the same world puts characters in other
    // Rapier slots, which changes the order contacts resolve in (restore-replay.test.ts). The test above
    // holds a resume in a fresh world to exact hashes, so no sim state is missing from the snapshot.
    expect(differences(first, second, 0.005)).toEqual([]);
    a.w.dispose();
  });

  /**
   * SIM BUG (plan §2.2: "hash() and snapshot() cover sim entity state only: entities, rng streams,
   * quests and flags … Restoring a snapshot rebuilds the Rapier world from entity bodies plus the
   * loaded cells"): which trigger volumes each player is inside (SimWorld.insideTriggers) is not in
   * the snapshot. Rewinding to before a trigger was entered, after it was entered, never fires it
   * again, so the reach objective can't complete in the replay (lookahead() and replays diverge).
   */
  it('rewinding to before entering a trigger fires it again on the replay', async () => {
    const { w } = await village();
    standBy(w, 'elder_pepe');
    tick1(w, interact());
    tick1(w, choose(0));
    tick1(w, choose(0));
    const snap = w.snapshot();
    const yard = w.locate('training_yard')!;
    const enter = () => {
      stand(w, yard.x, yard.z - 5);
      return tick1(w);
    };
    expect(evs(enter(), 'trigger').length).toBe(1);
    w.restore(snap);
    expect(evs(enter(), 'trigger').length).toBe(1);
    expect(w.playerEntity(0)!.progress!.quests.q_wake_up.step).toBe(1);
    w.dispose();
  });
});
