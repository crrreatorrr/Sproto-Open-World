import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/sim/entity';
import { CORPSE_TICKS, SHADOW_OFF_RANGE, SHADOW_ON_RANGE, VIEW_DROP_RANGE, VIEW_MAKE_RANGE, castsShadow, wantsView } from '../../src/render/views/viewCull';

const at = (x: number, extra: Partial<Entity> = {}): Entity => ({
  id: 1, kind: 'enemy', view: { model: 'grunt' },
  tf: { pos: { x, y: 0, z: 0 }, prevPos: { x, y: 0, z: 0 }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } },
  ...extra,
});
const brain = { brain: { def: 'grunt', camp: 'c' } } as unknown as Partial<Entity>;
const player = at(0, { kind: 'player' });

describe('wantsView', () => {
  it('makes an enemy view inside the make range only', () => {
    expect(wantsView(at(VIEW_MAKE_RANGE - 1, brain), player, false)).toBe(true);
    expect(wantsView(at(VIEW_MAKE_RANGE + 1, brain), player, false)).toBe(false);
  });

  it('keeps an existing view until the drop range', () => {
    expect(wantsView(at(VIEW_DROP_RANGE - 1, brain), player, true)).toBe(true);
    expect(wantsView(at(VIEW_DROP_RANGE + 1, brain), player, true)).toBe(false);
  });

  it('waits for anything not set down yet, near or far', () => {
    expect(wantsView(at(1, { ...brain, settle: true }), player, false)).toBe(false);
    expect(wantsView(at(1, { kind: 'npc', settle: true }), player, false)).toBe(false);
  });

  it('always draws settled villagers and objects, however far', () => {
    expect(wantsView(at(5000, { kind: 'npc' }), player, false)).toBe(true);
    expect(wantsView(at(5000, { kind: 'interactable' }), player, false)).toBe(true);
  });

  it('drops a dead camp enemy once its corpse has faded', () => {
    const dead = (t: number) => ({ ...brain, combat: { action: { kind: 'dead', t } } }) as unknown as Partial<Entity>;
    expect(wantsView(at(1, dead(CORPSE_TICKS)), player, true)).toBe(true);
    expect(wantsView(at(1, dead(CORPSE_TICKS + 1)), player, true)).toBe(false);
  });
});

describe('enemy shadows', () => {
  it('near enemies cast one, far ones do not, with a gap so nothing flickers', () => {
    expect(castsShadow(at(SHADOW_ON_RANGE - 1, brain), player, false)).toBe(true);
    expect(castsShadow(at(SHADOW_ON_RANGE + 1, brain), player, false)).toBe(false);
    expect(castsShadow(at(SHADOW_ON_RANGE + 1, brain), player, true)).toBe(true);
    expect(castsShadow(at(SHADOW_OFF_RANGE + 1, brain), player, true)).toBe(false);
  });

  it('a boss always casts one', () => {
    expect(castsShadow(at(100, { ...brain, boss: {} } as Partial<Entity>), player, false)).toBe(true);
  });
});
