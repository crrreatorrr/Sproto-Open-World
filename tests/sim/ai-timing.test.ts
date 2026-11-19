import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { idle, step } from './combatHelpers';
import { duel, immortal } from './aiHelpers';

/** Delayed swings and feints: a rhythm you can read but can't memorise, and every attack is telegraphed. */

interface Attack {
  move: string;
  /** Tick of the telegraph, what it promised, and the tick of the swing (null: it never swung). */
  tick: number;
  ticks: number;
  swing: number | null;
  /** The wind-up tick it stood still on, if it was held. */
  heldAt: number | null;
}

/** A long fight against a player who stands still, every attack recorded. */
async function attacks(def: string, seed: number, ticks = 6000): Promise<Attack[]> {
  const { w, p, e } = await duel(def, 3.5, 0, seed);
  const out: Attack[] = [];
  let last = -1;
  for (let t = 0; t < ticks; t++) {
    immortal(p);
    e.vitals!.hp = e.vitals!.hpMax;
    for (const ev of step(w, idle())) {
      if (ev.type === 'telegraph' && ev.entity === e.id) out.push({ move: ev.move, tick: t, ticks: ev.ticks, swing: null, heldAt: null });
      if (ev.type === 'swing' && ev.entity === e.id) out[out.length - 1].swing = t;
    }
    const a = e.combat!.action;
    if (a?.kind === 'attack' && out.length) {
      if (a.t === last && (a.hold ?? 0) > 0) out[out.length - 1].heldAt = a.t;
      last = a.t;
    } else last = -1;
  }
  w.dispose();
  return out;
}

const windup = (def: string, move: string) => ENEMIES[def].moves.find((m) => m.id === move)!.windup;

describe('varied timing', () => {
  for (const def of ['grunt', 'grunt_vet', 'brute', 'gatekeeper', 'slinger']) {
    it(`${def}: every swing lands exactly when its telegraph said it would`, async () => {
      const all = await attacks(def, 1);
      const swung = all.filter((a) => a.swing !== null);
      expect(swung.length).toBeGreaterThan(20);
      for (const a of swung) {
        expect(a.swing! - a.tick, `${a.move} at ${a.tick}`).toBe(a.ticks);
        expect(a.ticks, `${a.move} at ${a.tick}`).toBeGreaterThanOrEqual(windup(def, a.move));
      }
    });
  }

  it('some swings are delayed, by different amounts, and the rest of the wind-up still plays after the wait', async () => {
    const all = await attacks('grunt_vet', 2);
    const held = all.filter((a) => a.swing !== null && a.ticks > windup('grunt_vet', a.move));
    expect(held.length).toBeGreaterThan(5);
    expect(new Set(held.map((a) => a.ticks)).size).toBeGreaterThan(2);
    for (const a of held) {
      expect(a.heldAt, `${a.move} at ${a.tick}`).not.toBeNull();
      const w = windup('grunt_vet', a.move);
      expect(w - a.heldAt!, `${a.move} at ${a.tick}`).toBeGreaterThanOrEqual(Math.floor(w * 0.4));
    }
  });

  it('the gaps between attacks vary', async () => {
    const all = await attacks('grunt', 3);
    const gaps = all.slice(1).map((a, i) => a.tick - all[i].tick);
    expect(new Set(gaps).size).toBeGreaterThan(10);
  });

  it('marked attacks keep their exact timing: a circle on the ground lands when it says', async () => {
    for (let seed = 1; seed <= 4; seed++) {
      for (const a of await attacks('gatekeeper', seed)) {
        if (a.move === 'ground_wave') expect(a.ticks).toBe(windup('gatekeeper', 'ground_wave'));
      }
    }
    for (const a of await attacks('brute', 2)) {
      if (a.move === 'slam') expect(a.ticks).toBe(windup('brute', 'slam'));
    }
  });
});

describe('feints', () => {
  it('tougher enemies feint now and then, and a real attack always follows', async () => {
    for (const def of ['grunt_vet', 'gatekeeper']) {
      const all = await attacks(def, 1, 9000);
      const feints = all.filter((a, i) => a.swing === null && i < all.length - 1);
      expect(feints.length, def).toBeGreaterThan(1);
      expect(feints.length, def).toBeLessThan(all.length / 3);
      all.forEach((a, i) => {
        if (a.swing !== null || i === all.length - 1) return;
        const next = all[i + 1];
        expect(next.swing, `${def} after the feint at ${a.tick}`).not.toBeNull();
        expect(next.tick - a.tick, `${def} after the feint at ${a.tick}`).toBeLessThan(120);
      });
    }
  });

  it('plain Grunts never feint', async () => {
    const all = await attacks('grunt', 1);
    expect(all.slice(0, -1).filter((a) => a.swing === null)).toEqual([]);
  });
});
