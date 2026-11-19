import { describe, expect, it } from 'vitest';
import { newProgress } from '../../src/sim/systems/rpg';
import {
  equipRelic, equipTotem, grantKeepsake, holdTotem, parryWindowTicks, proc, relicSlowTick, rollFrames, tickTotems,
} from '../../src/sim/systems/relics';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';

function player(): Entity {
  return {
    id: 1, kind: 'player',
    tf: { pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } },
    progress: newProgress(['bolt']),
    vitals: { hp: 100, hpMax: 100, stamina: 100, staminaMax: 100, mana: 100, manaMax: 100, staminaDelay: 0 },
    view: { model: 'player' },
  } as Entity;
}

const ctx = (e: Entity, now = 0) => ({ now, entities: [e], events: [] as SimEvent[] });

describe('relic sockets', () => {
  it('earns a keepsake once and equips it into the first empty socket', () => {
    const e = player();
    const c = ctx(e);
    expect(grantKeepsake(c, e, 'relic_drowned_coins')).toBe(true);
    expect(grantKeepsake(c, e, 'relic_drowned_coins')).toBe(false);
    expect(c.events.filter((x) => x.type === 'itemGained')).toHaveLength(1);
    equipRelic(c, e, 'relic_drowned_coins');
    expect(e.progress!.relics!.sockets).toEqual(['relic_drowned_coins', null, null]);
    equipRelic(c, e, 'relic_drowned_coins');
    expect(e.progress!.relics!.sockets[0]).toBeNull();
  });

  it('swaps the one totem', () => {
    const e = player();
    const c = ctx(e);
    grantKeepsake(c, e, 'totem_elders_hearth');
    grantKeepsake(c, e, 'totem_field_warden');
    equipTotem(c, e, 'totem_elders_hearth');
    equipTotem(c, e, 'totem_field_warden');
    expect(e.progress!.relics!.totem).toBe('totem_field_warden');
    expect(c.events.some((x) => x.type === 'refused' && x.reason === 'Totem swapped.')).toBe(true);
  });

  it('lengthens the parry window and the roll when the relics are on', () => {
    const e = player();
    const c = ctx(e);
    grantKeepsake(c, e, 'relic_drowned_coins');
    grantKeepsake(c, e, 'relic_sprotos_stride');
    equipRelic(c, e, 'relic_drowned_coins');
    equipRelic(c, e, 'relic_sprotos_stride');
    e.combat = { blockPressTicks: 12 } as Entity['combat'];
    expect(parryWindowTicks(e, { parryTicks: 12 })).toBe(16);
    e.combat = { blockPressTicks: 4 } as Entity['combat'];
    grantKeepsake(c, e, 'relic_gatekeepers_grip');
    equipRelic(c, e, 'relic_gatekeepers_grip');
    expect(parryWindowTicks(e, { parryTicks: 4 })).toBe(8);
    expect(rollFrames(e, {}).iframeEnd).toBe(20);
    expect(rollFrames(e, { back: true }).iframeEnd).toBe(8);
  });
});

describe('placed totems', () => {
  it('plants on a held interact and heals inside the hearth', () => {
    const e = player();
    const c = ctx(e);
    grantKeepsake(c, e, 'totem_elders_hearth');
    equipTotem(c, e, 'totem_elders_hearth');
    e.vitals!.hp = 50;
    for (let i = 0; i < 18; i++) holdTotem({ ...c, now: i }, e, true, false);
    expect(e.placedTotem?.id).toBe('totem_elders_hearth');
    tickTotems([e], 20);
    expect(e.vitals!.hp).toBeGreaterThan(50);
    for (let i = 0; i < 20 * 60; i++) tickTotems([e], 30 + i);
    expect(e.placedTotem).toBeUndefined();
  });

  it('slows the world on odd ticks while Hopeglass is up, and only for one player', () => {
    const e = player();
    e.relicRun = { hopeglassUntil: 30, hopeglassReadyAt: 0, coopFreezeUntil: 0, rivetReadyAt: 0, briarReadyAt: 0, burnImmuneUntil: 0, holdTicks: 0, totemReadyAt: 0, lanternUntil: 0, chainSeen: -1 };
    expect(relicSlowTick([e], 1)).toBe(true);
    expect(relicSlowTick([e], 2)).toBe(false);
    expect(relicSlowTick([e], 30)).toBe(false);
    const other = player();
    other.id = 2;
    expect(relicSlowTick([e, other], 1)).toBe(false);
  });

  it('procs are deterministic', () => {
    expect(proc(4, 1, 2, 0)).toBe(false);
    expect(proc(4, 1, 2, 1)).toBe(true);
    expect(proc(4, 1, 2, 0.5)).toBe(proc(4, 1, 2, 0.5));
  });
});
