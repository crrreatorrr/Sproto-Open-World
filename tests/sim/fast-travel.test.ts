import { describe, expect, it } from 'vitest';
import { WAYSTONE } from '../../src/content/items';
import { MERCHANTS } from '../../src/content/loot';
import { isRootdeep } from '../../src/content/packs/rootdeep';
import { WORLD_CONTENT } from '../../src/content/world/worldContent';
import { idleInput } from '../../src/sim/commands';
import type { SimWorld } from '../../src/sim/SimWorld';
import { SHRINE_ARRIVE_OFFSET } from '../../src/sim/systems/travel';
import { bakedWorld } from './quests-helpers';
import { evs, interact, standBy, tick1, ui, village } from './m3Helpers';

/** Fast travel: the Waystone, to shrines you have used, out of combat. God mode: any shrine, any time. */

const travel = (shrine: string) => ui([{ kind: 'fastTravel', shrine }]);
const refusals = (ev: ReturnType<typeof tick1>) => evs(ev, 'refused').filter((r) => r.action === 'fastTravel').map((r) => r.reason);

/** Touch the Shrine of First Light (its menu opens), then close the menu again. */
function touchFirstLight(w: SimWorld): void {
  standBy(w, 'shrine_first_light');
  tick1(w, interact());
  tick1(w, ui([{ kind: 'closeMenu' }]));
}

describe('fast travel', () => {
  it('the Waystone is on sale at Trader Pepe', () => {
    expect(MERCHANTS.merchant_village.stock[WAYSTONE]).toBe(1);
  });

  it('needs the Waystone, then a shrine you have used', async () => {
    const { w, prog } = await village();
    expect(refusals(tick1(w, travel('shrine_first_light')))).toEqual(['You need a Waystone to fast travel.']);
    prog().inventory[WAYSTONE] = 1; // test setup: bought
    expect(refusals(tick1(w, travel('shrine_first_light')))).toEqual(["You haven't used that shrine yet."]);
    expect(refusals(tick1(w, travel('no_such_shrine')))).toEqual(['There is no such shrine.']);
  });

  it('goes to a used shrine and sets you down beside it', async () => {
    const { w, p, prog } = await village();
    prog().inventory[WAYSTONE] = 1;
    touchFirstLight(w);
    expect(prog().discoveredShrines).toContain('shrine_first_light');
    w.teleportPlayer(0, { x: 300, y: 13.55, z: 110 });
    const ev = tick1(w, travel('shrine_first_light'));
    expect(evs(ev, 'travel')).toHaveLength(1);
    for (let i = 0; i < 30 && p.settle; i++) tick1(w);
    const at = w.locate('shrine_first_light')!;
    expect(p.tf.pos.x).toBeCloseTo(at.x + SHRINE_ARRIVE_OFFSET, 1);
    expect(p.tf.pos.z).toBeCloseTo(at.z + SHRINE_ARRIVE_OFFSET, 1);
    expect(p.tf.pos.y).toBeCloseTo(13.5, 0);
  });

  it('is refused in combat, but not in god mode', async () => {
    const { w, p, prog } = await village();
    prog().inventory[WAYSTONE] = 1;
    touchFirstLight(w);
    p.combat!.targetedAt = w.now; // an enemy just targeted you
    expect(refusals(tick1(w, travel('shrine_first_light')))).toEqual(["You can't travel in combat."]);
    tick1(w, ui([{ kind: 'godMode', on: true }]));
    p.combat!.targetedAt = w.now;
    expect(evs(tick1(w, travel('shrine_first_light')), 'travel')).toHaveLength(1);
  });

  it('in god mode goes to every shrine, used or not, including the Rootdeep', async () => {
    const w = await bakedWorld();
    const p = () => w.playerEntity(0)!;
    w.tick(new Map([[0, ui([{ kind: 'godMode', on: true }])]]));
    expect(p().progress!.discoveredShrines).toEqual([]);
    for (const s of WORLD_CONTENT.shrines) {
      w.tick(new Map([[0, travel(s.id)]]));
      expect(evs(w.events, 'travel'), s.id).toHaveLength(1);
      for (let i = 0; i < 30 && p().settle; i++) w.tick(new Map([[0, idleInput(0)]]));
      const at = w.locate(s.id)!;
      expect(Math.hypot(p().tf.pos.x - at.x, p().tf.pos.z - at.z), s.id).toBeLessThan(3);
      expect(Math.abs(p().tf.pos.y - at.y), s.id).toBeLessThan(3);
      expect(isRootdeep(p().tf.pos.x), s.id).toBe(isRootdeep(at.x));
    }
    w.dispose();
  }, 60_000);
});
