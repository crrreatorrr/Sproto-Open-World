import { describe, expect, it } from 'vitest';
import { BTN, combatWorld, idle, press, step } from './combatHelpers';
import { evs, interact, stand, standBy, tick1, ui, village, VILLAGE_Y } from './m3Helpers';

/**
 * Plan §2.2 "commands carry intents": a menu intent or an interact / potion press is applied or
 * refused, never silently lost.
 */

describe('intents are never silently dropped', () => {
  /**
   * SIM BUG (plan §2.2 "commands carry intents … the sim … evaluates the conditions"; commands.ts
   * "`pressed` … latched by the client so a tap between two ticks is never lost"): SimWorld.tick
   * skips playerRpg for an entity in hit-stop, so the UiActions and the interact / potion presses
   * of that tick vanish with no event. Minimal scenario: land light1 on a dummy (3 ticks of
   * hit-stop), send equip{staff_nobu} (owned) on the next tick → no equip, no refused.
   */
  it('a menu intent sent during hit-stop is applied (or refused)', async () => {
    const { w, p } = await combatWorld();
    p.progress!.inventory.staff_nobu = 1;
    w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 1.5 }, Math.PI);
    step(w, press(BTN.light));
    for (let i = 0; i < 30 && p.combat!.hitstop === 0; i++) step(w, idle());
    expect(p.combat!.hitstop).toBeGreaterThan(0);
    const c = idle();
    c.ui = [{ kind: 'equip', item: 'staff_nobu' }];
    const e = step(w, c);
    expect(evs(e, 'equip').length + evs(e, 'refused').length).toBe(1);
    expect(p.progress!.equipment.staff).toBe('staff_nobu');
    w.dispose();
  });

  it('an interact press during hit-stop is not lost (same bug: talk to an NPC right after a hit)', async () => {
    const { w, p } = await village();
    const pepe = w.locate('elder_pepe')!;
    standBy(w, 'elder_pepe');
    // A dummy just to the side to hit: then turn to Pepe while still in hit-stop.
    w.spawnEnemy('dummy_passive', { x: pepe.x + 1.2, y: VILLAGE_Y, z: pepe.z - 1.5 }, Math.PI);
    stand(w, pepe.x, pepe.z - 1.5, { x: pepe.x + 1.2, z: pepe.z - 1.5 });
    tick1(w, ui([], BTN.light));
    for (let i = 0; i < 30 && p.combat!.hitstop === 0; i++) tick1(w);
    expect(p.combat!.hitstop).toBeGreaterThan(0);
    stand(w, pepe.x, pepe.z - 1.5, pepe);
    const e = tick1(w, interact());
    expect(evs(e, 'talk').length).toBe(1);
    w.dispose();
  });

  it('several intents in one tick are all applied in order', async () => {
    const { w, p } = await combatWorld();
    p.progress!.inventory.staff_nobu = 1;
    p.progress!.inventory.charm_iron_root = 1;
    const c = idle();
    c.ui = [{ kind: 'equip', item: 'staff_nobu' }, { kind: 'equip', item: 'staff_moonward' }, { kind: 'equip', item: 'charm_iron_root' }];
    const e = step(w, c);
    expect(e.filter((x) => x.type === 'equip' || x.type === 'refused').map((x) => x.type)).toEqual(['equip', 'refused', 'equip']);
    expect(p.progress!.equipment).toEqual({ staff: 'staff_nobu', robe: 'robe_apprentice', charm: 'charm_iron_root' });
    w.dispose();
  });

  it('a dead player still has its menu intents validated (equip works, nothing crashes)', async () => {
    const { w, p } = await combatWorld();
    p.progress!.inventory.staff_nobu = 1;
    p.combat!.action = { kind: 'dead', t: 0 };
    const c = idle();
    c.ui = [{ kind: 'equip', item: 'staff_nobu' }];
    expect(evs(step(w, c), 'equip').length).toBe(1);
    w.dispose();
  });
});
