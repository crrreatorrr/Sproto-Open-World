import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { SPROUTVALE_CONTENT } from '../../src/content/world/sproutvaleContent';
import { idleInput } from '../../src/sim/commands';
import { step, stepN } from './combatHelpers';
import { VILLAGE_Y, interact, standBy, ui, village } from './m3Helpers';
import { alive, campMembers, flatSproutvale, slay, standAt } from './m4Helpers';

/**
 * M4 camps (plan §2.9, §6.5): placements settle onto the ground when their cell's colliders exist;
 * camp enemies stay dead until a rest or a respawn; uniques (the Gatekeeper, Big Coin) never come
 * back, through a rest, a death and a save.
 */
describe('settling content onto the ground', () => {
  it('every camp member, villager and object stands on the terrain once its cell is built', async () => {
    const { w } = await flatSproutvale();
    const placed = w.entities.filter((e) => e.brain?.camp || e.npc || e.interactable);
    expect(placed.length).toBeGreaterThan(70);
    for (const e of placed) {
      expect(e.settle, `${e.brain?.camp ?? e.npc?.id ?? e.interactable?.id}`).toBeUndefined();
      expect(e.tf.pos.y).toBeCloseTo(VILLAGE_Y + (e.body ? 0.02 : 0), 1);
    }
    w.dispose();
  });

  it('a placement over a cell without colliders waits, held still, and settles when the cell arrives', async () => {
    // The village world only has the village cells: the Orchard camps wait.
    const { w } = await village();
    const orchard = campMembers(w, 'orchard_south');
    expect(orchard.length).toBe(4);
    for (const e of orchard) expect(e.settle).toBe(true);
    const before = orchard.map((e) => ({ ...e.tf.pos }));
    stepN(w, 30);
    orchard.forEach((e, i) => expect(e.tf.pos).toEqual(before[i]));
    w.dispose();
  });
});

describe('camps stay down until you rest (plan §2.9)', () => {
  it('a killed camp enemy stays dead past its respawn delay, and a shrine rest brings the camp back', async () => {
    const { w } = await flatSproutvale();
    const [g] = campMembers(w, 'orchard_south');
    slay(w, g);
    expect(alive(g)).toBe(false);
    stepN(w, ENEMIES[g.brain!.def].respawnTicks + 60);
    expect(alive(g)).toBe(false);
    const home = { ...g.brain!.home };
    standBy(w, 'shrine_first_light');
    step(w, interact());
    const ev = step(w, ui([{ kind: 'rest' }]));
    expect(ev.some((e) => e.type === 'respawn' && e.entity === g.id)).toBe(true);
    expect(alive(g)).toBe(true);
    expect(g.vitals!.hp).toBe(g.vitals!.hpMax);
    expect(g.tf.pos.x).toBeCloseTo(home.x, 3);
    expect(g.tf.pos.z).toBeCloseTo(home.z, 3);
    w.dispose();
  });

  it('dying brings the camps back too, but not a killed unique', async () => {
    const { w, p } = await flatSproutvale();
    const [g] = campMembers(w, 'orchard_south');
    const gk = campMembers(w, 'thornwood_clearing')[0];
    expect(gk.brain!.unique).toBe('gatekeeper');
    slay(w, g);
    slay(w, gk);
    expect(w.world.killedUniques).toEqual(['gatekeeper']);
    // Die.
    standAt(w, 256, 58);
    p.vitals!.hp = 0;
    p.combat!.action = { kind: 'dead', t: 0 };
    stepN(w, 200);
    expect(alive(p)).toBe(true);
    expect(alive(g)).toBe(true);
    expect(w.entities.includes(gk)).toBe(false);
    w.dispose();
  });

  it('a killed unique is gone after a rest, and stays gone in a save', async () => {
    const { w } = await flatSproutvale();
    const coin = campMembers(w, 'mill_yard').find((e) => e.brain!.unique === 'big_coin')!;
    slay(w, coin);
    stepN(w, 160);
    expect(w.entities.includes(coin)).toBe(false);
    standBy(w, 'shrine_first_light');
    step(w, interact());
    step(w, ui([{ kind: 'rest' }]));
    expect(w.entities.some((e) => e.brain?.unique === 'big_coin')).toBe(false);
    const save = w.toSave({ savedAt: 'now', build: 'test', region: 'sproutvale' });
    expect(save.world.killedUniques).toEqual(['big_coin']);

    const fresh = await flatSproutvale();
    expect(fresh.w.entities.some((e) => e.brain?.unique === 'big_coin')).toBe(true);
    fresh.w.applySave(save);
    expect(fresh.w.entities.some((e) => e.brain?.unique === 'big_coin')).toBe(false);
    w.dispose();
    fresh.w.dispose();
  });

  it('every camp in the content spawns all its members', async () => {
    const { w } = await flatSproutvale();
    for (const camp of SPROUTVALE_CONTENT.camps ?? []) expect(campMembers(w, camp.id).map((e) => e.brain!.def), camp.id).toEqual(camp.members.map((m) => m.def));
    w.dispose();
  });

  it('the world stays deterministic with the camps in it', async () => {
    const a = await flatSproutvale(5);
    const b = await flatSproutvale(5);
    for (let i = 0; i < 240; i++) {
      const c = idleInput(0);
      c.move = { x: Math.sin(i / 30), y: 1 };
      a.w.tick(new Map([[0, c]]));
      b.w.tick(new Map([[0, { ...c, move: { ...c.move } }]]));
    }
    expect(a.w.hash()).toBe(b.w.hash());
    a.w.dispose();
    b.w.dispose();
  });
});
