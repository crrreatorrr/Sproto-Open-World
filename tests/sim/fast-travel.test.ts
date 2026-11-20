import { describe, expect, it } from 'vitest';
import { ITEMS, TRAVEL_DEVICE } from '../../src/content/items';
import { MERCHANTS } from '../../src/content/loot';
import { isRootdeep } from '../../src/content/packs/rootdeep';
import { WORLD_CONTENT } from '../../src/content/world/worldContent';
import { BTN, idleInput } from '../../src/sim/commands';
import type { SimWorld } from '../../src/sim/SimWorld';
import { SHRINE_ARRIVE_OFFSET } from '../../src/sim/systems/travel';
import { bakedWorld } from './quests-helpers';
import { evs, interact, standBy, tick1, ui, village, type Village } from './m3Helpers';

/**
 * Fast travel by the Brick Phone: wield it, Light attack opens it, and it calls a shrine you have
 * used, out of combat. God mode calls any shrine, any time.
 */

const travel = (shrine: string) => ui([{ kind: 'fastTravel', shrine }]);
const refusals = (ev: ReturnType<typeof tick1>) => evs(ev, 'refused').filter((r) => r.action === 'fastTravel').map((r) => r.reason);
const light = () => ui([], BTN.light);

/** Touch the Shrine of First Light (its menu opens), then close the menu again. */
function touchFirstLight(w: SimWorld): void {
  standBy(w, 'shrine_first_light');
  tick1(w, interact());
  tick1(w, ui([{ kind: 'closeMenu' }]));
}

/** Test setup: the phone bought and wielded (out of combat). */
function wieldPhone(v: Village): void {
  v.prog().inventory[TRAVEL_DEVICE] = 1;
  tick1(v.w, ui([{ kind: 'equip', item: TRAVEL_DEVICE }]));
  expect(v.prog().equipment.staff).toBe(TRAVEL_DEVICE);
}

describe('the Brick Phone', () => {
  it('is a staff-slot item with its own model, on sale at Trader Pepe', () => {
    const def = ITEMS[TRAVEL_DEVICE];
    expect(def.kind).toBe('staff');
    expect(def.staff?.model).toBe('staff_brick_phone');
    expect(MERCHANTS.merchant_village.stock[TRAVEL_DEVICE]).toBe(1);
  });

  it('opens on Light attack when wielded, instead of a swing, and Hang up closes it', async () => {
    const v = await village();
    const { w, p, prog } = v;
    // With the staff, Light attack swings.
    tick1(w, light());
    expect(p.combat!.action?.kind).toBe('attack');
    for (let i = 0; i < 90; i++) tick1(w);
    wieldPhone(v);
    const ev = tick1(w, light());
    expect(evs(ev, 'phoneOpen')).toHaveLength(1);
    expect(prog().phone).toBe(true);
    expect(p.combat!.action).toBeNull();
    tick1(w, ui([{ kind: 'closeMenu' }]));
    expect(prog().phone).toBeUndefined();
  });

  it('never swings on Light attack, even mid-roll: the phone opens under it', async () => {
    const v = await village();
    const { w, p, prog } = v;
    wieldPhone(v);
    tick1(w, ui([], BTN.dodge));
    expect(p.combat!.action?.kind).toBe('dodge');
    tick1(w, light());
    expect(prog().phone).toBe(true);
    // Hang up and hold Light: nothing swings.
    tick1(w, ui([{ kind: 'closeMenu' }]));
    for (let i = 0; i < 60; i++) {
      const c = ui([]);
      c.held = BTN.light;
      tick1(w, c);
      expect(p.combat!.action?.kind ?? null).not.toBe('attack');
    }
  });

  it('is never saved open', async () => {
    const v = await village();
    wieldPhone(v);
    tick1(v.w, light());
    expect(v.prog().phone).toBe(true);
    const save = v.w.toSave({ savedAt: 'test', build: 'test', region: 'sproutvale' });
    expect('phone' in save.player).toBe(false);
  });
});

describe('fast travel', () => {
  it('needs the phone in hand, then a shrine you have used', async () => {
    const v = await village();
    const { w, prog } = v;
    prog().inventory[TRAVEL_DEVICE] = 1; // owned but not wielded
    expect(refusals(tick1(w, travel('shrine_first_light')))).toEqual(['Wield the Brick Phone to fast travel.']);
    wieldPhone(v);
    expect(refusals(tick1(w, travel('shrine_first_light')))).toEqual(["You haven't used that shrine yet."]);
    expect(refusals(tick1(w, travel('no_such_shrine')))).toEqual(['There is no such shrine.']);
  });

  it('calls a used shrine from the phone, sets you down beside it and hangs up', async () => {
    const v = await village();
    const { w, p, prog } = v;
    wieldPhone(v);
    touchFirstLight(w);
    expect(prog().discoveredShrines).toContain('shrine_first_light');
    w.teleportPlayer(0, { x: 300, y: 13.55, z: 110 });
    tick1(w, light());
    expect(prog().phone).toBe(true);
    const ev = tick1(w, travel('shrine_first_light'));
    expect(evs(ev, 'travel')).toHaveLength(1);
    expect(prog().phone).toBeUndefined();
    for (let i = 0; i < 30 && p.settle; i++) tick1(w);
    const at = w.locate('shrine_first_light')!;
    expect(p.tf.pos.x).toBeCloseTo(at.x + SHRINE_ARRIVE_OFFSET, 1);
    expect(p.tf.pos.z).toBeCloseTo(at.z + SHRINE_ARRIVE_OFFSET, 1);
    expect(p.tf.pos.y).toBeCloseTo(13.5, 0);
  });

  it('is refused in combat, but not in god mode', async () => {
    const v = await village();
    const { w, p } = v;
    wieldPhone(v);
    touchFirstLight(w);
    p.combat!.targetedAt = w.now; // an enemy just targeted you
    expect(refusals(tick1(w, travel('shrine_first_light')))).toEqual(["You can't travel in combat."]);
    tick1(w, ui([{ kind: 'godMode', on: true }]));
    p.combat!.targetedAt = w.now;
    expect(evs(tick1(w, travel('shrine_first_light')), 'travel')).toHaveLength(1);
  });

  it('in god mode goes to every shrine, used or not and without the phone, including the Rootdeep', async () => {
    const w = await bakedWorld();
    const p = () => w.playerEntity(0)!;
    w.tick(new Map([[0, ui([{ kind: 'godMode', on: true }])]]));
    expect(p().progress!.discoveredShrines).toEqual([]);
    expect(p().progress!.equipment.staff).not.toBe(TRAVEL_DEVICE);
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
