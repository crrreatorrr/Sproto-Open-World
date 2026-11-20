import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/content/items';
import { isRootdeep } from '../../src/content/packs/rootdeep';
import { KEEPSAKES } from '../../src/content/relics';
import { SPELLS } from '../../src/content/spells';
import { CAVE_AREAS, SURFACE_AREAS } from '../../src/content/world/areas';
import { idleInput } from '../../src/sim/commands';
import { GOD } from '../../src/sim/systems/god';
import { bakedWorld } from './quests-helpers';
import { evs, tick1, ui, village } from './m3Helpers';

/** God mode (testing): every item at once, no death, travel anywhere, never saved. */

const godOn = ui([{ kind: 'godMode', on: true }]);
const godOff = ui([{ kind: 'godMode', on: false }]);

describe('god mode', () => {
  it('hands out level 99, 99 skill points, Sprouts, every item, spell and relic', async () => {
    const { w, p, prog } = await village();
    const ev = tick1(w, godOn);
    expect(evs(ev, 'godMode')).toEqual([{ type: 'godMode', entity: p.id, on: true }]);
    const pr = prog();
    expect(pr.god).toBe(true);
    expect(pr.level).toBe(GOD.level);
    expect(pr.points).toBe(GOD.points);
    expect(pr.sprouts).toBe(GOD.sprouts);
    for (const def of Object.values(ITEMS)) {
      if (def.teaches) expect(pr.inventory[def.id] ?? 0).toBe(0);
      else expect(pr.inventory[def.id]).toBe(def.stacks ? GOD.stack : 1);
    }
    expect([...pr.spells].sort()).toEqual(Object.keys(SPELLS).sort());
    expect(pr.loadout.every((s) => s !== null)).toBe(true);
    expect([...pr.relics!.owned].sort()).toEqual(KEEPSAKES.map((k) => k.id).sort());
    // Level 99's growth is in the numbers, and the bar is full.
    expect(p.vitals!.hpMax).toBeGreaterThan(1000);
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
  });

  it("can't die while on, and dies again once it is off", async () => {
    const { w, p } = await village();
    tick1(w, godOn);
    p.statuses = { burn: { ticks: 30, perTick: 1e6, source: p.id } };
    for (let i = 0; i < 40; i++) tick1(w);
    expect(p.combat!.action?.kind).not.toBe('dead');
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);

    tick1(w, godOff);
    expect(p.progress!.god).toBeUndefined();
    p.statuses = { burn: { ticks: 30, perTick: 1e6, source: p.id } };
    const ev = tick1(w);
    expect(evs(ev, 'death').map((d) => d.entity)).toEqual([p.id]);
  });

  it('is never saved', async () => {
    const { w } = await village();
    tick1(w, godOn);
    const save = w.toSave({ savedAt: 'test', build: 'test', region: 'sproutvale' });
    expect('god' in save.player).toBe(false);
  });

  it('refuses a warp without god mode', async () => {
    const { w, p } = await village();
    const before = { ...p.tf.pos };
    const ev = tick1(w, ui([{ kind: 'godWarp', x: 100, z: 100 }]));
    expect(evs(ev, 'refused').map((r) => r.action)).toEqual(['godWarp']);
    expect(evs(ev, 'travel')).toEqual([]);
    expect(p.tf.pos.x).toBeCloseTo(before.x, 5);
  });

  it('warps to every named area, on the surface and in the Rootdeep, and lands on the floor', async () => {
    const w = await bakedWorld();
    const p = () => w.playerEntity(0)!;
    w.tick(new Map([[0, godOn]]));
    for (const a of [...SURFACE_AREAS, ...CAVE_AREAS]) {
      w.tick(new Map([[0, ui([{ kind: 'godWarp', x: a.x, z: a.z }])]]));
      expect(evs(w.events, 'travel'), a.name).toHaveLength(1);
      for (let i = 0; i < 30 && p().settle; i++) w.tick(new Map([[0, idleInput(0)]]));
      expect(p().settle, `${a.name} settled`).toBeUndefined();
      expect(Math.hypot(p().tf.pos.x - a.x, p().tf.pos.z - a.z), a.name).toBeLessThan(1);
      expect(isRootdeep(p().tf.pos.x), a.name).toBe(isRootdeep(a.x));
      // On the floor, not left up at the drop height.
      expect(p().tf.pos.y, a.name).toBeLessThan(100);
    }
    w.dispose();
  }, 60_000);
});
