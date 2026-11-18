import { describe, expect, it } from 'vitest';
import { makeWorld, run } from './helpers';

describe('sim determinism', () => {
  it('two runs of the same commands give the same hash at every checkpoint', async () => {
    const a = await makeWorld();
    const b = await makeWorld();
    for (let i = 0; i < 6; i++) {
      run(a, 200);
      run(b, 200);
      expect(a.hash()).toBe(b.hash());
    }
    a.dispose();
    b.dispose();
  });

  it('a restored snapshot continues exactly like the original', async () => {
    const a = await makeWorld();
    run(a, 300);
    const snap = a.snapshot();
    run(a, 400);
    const want = a.hash();
    a.restore(snap);
    run(a, 400);
    expect(a.hash()).toBe(want);
    a.dispose();
  });

  it('a different seed gives different rng streams', async () => {
    const a = await makeWorld(undefined, 1);
    const b = await makeWorld(undefined, 2);
    expect(a.rng.float('loot')).not.toBe(b.rng.float('loot'));
    a.dispose();
    b.dispose();
  });
});
