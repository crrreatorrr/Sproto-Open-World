import { describe, expect, it } from 'vitest';
import { arena, fight } from './bot';

// Spells by the point of the main path: Bolt at the start, Blast after Pest Control (M2), Frost Nova
// from the Thornwood tome before the Gatekeeper (plan §6.2).

/**
 * Balance gates for camps (plan §8, M4 acceptance 2), 10 seeds each. Run with `npm run test:balance`
 * (not part of `npm test`): on any PR that touches `src/content/`.
 */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('camp gates (plan §8)', () => {
  it('a level-2 bot dies to a 5-Grunt camp in at most 3 of 10 seeds', async () => {
    const results = [];
    for (const seed of SEEDS) {
      const { w, p, enemies } = await arena(seed, 2, ['grunt', 'grunt', 'grunt', 'grunt', 'grunt'], ['bolt']);
      results.push(fight(w, p, enemies));
      w.dispose();
    }
    const deaths = results.filter((r) => r.died).length;
    console.log(`5 Grunts at L2: ${deaths}/10 deaths; times ${results.map((r) => r.seconds.toFixed(0)).join(' ')} s`);
    expect(results.every((r) => r.won || r.died)).toBe(true);
    expect(deaths).toBeLessThanOrEqual(3);
  }, 120_000);

  it('profiles matter: a melee-only bot takes ≥ 1.8× longer on a Wisp camp than the profile-aware bot', async () => {
    let aware = 0;
    let melee = 0;
    for (const seed of SEEDS) {
      const a = await arena(seed, 4, ['wisp', 'wisp', 'wisp'], ['bolt', 'blast']);
      const r1 = fight(a.w, a.p, a.enemies);
      a.w.dispose();
      const b = await arena(seed, 4, ['wisp', 'wisp', 'wisp'], ['bolt', 'blast']);
      const r2 = fight(b.w, b.p, b.enemies, { meleeOnly: true });
      b.w.dispose();
      expect(r1.won, `aware seed ${seed}`).toBe(true);
      aware += r1.seconds;
      melee += r2.seconds;
    }
    console.log(`Wisp camp: profile-aware ${(aware / 10).toFixed(1)} s, melee-only ${(melee / 10).toFixed(1)} s (×${(melee / aware).toFixed(2)})`);
    expect(melee / aware).toBeGreaterThanOrEqual(1.8);
  }, 120_000);

  it('the Gatekeeper: a level-5 profile-aware bot beats it in most seeds (reported; the owner signs off on the feel)', async () => {
    const results = [];
    for (const seed of SEEDS) {
      const { w, p, enemies } = await arena(seed, 5, ['gatekeeper'], ['bolt', 'blast', 'frostNova']);
      results.push(fight(w, p, enemies, {}, 300));
      w.dispose();
    }
    const wins = results.filter((r) => r.won);
    console.log(`Gatekeeper at L5: ${wins.length}/10 wins; times ${results.map((r) => (r.won ? r.seconds.toFixed(0) : r.died ? 'died' : 'timeout')).join(' ')} s`);
    expect(wins.length).toBeGreaterThanOrEqual(5);
  }, 180_000);

  it('the Gatekeeper is a weaving exam: a melee-only bot (physical-resisted, no Burn) loses in most seeds', async () => {
    let losses = 0;
    for (const seed of SEEDS) {
      const { w, p, enemies } = await arena(seed, 5, ['gatekeeper'], ['bolt', 'blast', 'frostNova']);
      if (!fight(w, p, enemies, { meleeOnly: true }, 300).won) losses++;
      w.dispose();
    }
    console.log(`Gatekeeper at L5, melee only: ${losses}/10 losses`);
    expect(losses).toBeGreaterThanOrEqual(7);
  }, 180_000);
});
