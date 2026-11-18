import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/events';
import { Tutorial, tipFor, tipText } from '../../src/ui/tutorial';

const ME = 1;
const hit = (attacker: number, affinity: 'weak' | 'normal' | 'resist'): SimEvent => ({
  type: 'hit', attacker, target: 9, move: 'light1', damage: 10, kind: 'physical', affinity, crit: false, heavy: false, pos: { x: 0, y: 0, z: 0 }, hitstop: 0,
});
const telegraph = (unblockable: boolean): SimEvent => ({ type: 'telegraph', entity: 9, move: 'slam', ticks: 40, unblockable });

describe('first-time hints (plan §6.4)', () => {
  it('each moment earns its tip', () => {
    expect(tipFor(telegraph(true), ME)).toBe('unblockable');
    expect(tipFor(telegraph(false), ME)).toBe('lockOn');
    expect(tipFor(hit(ME, 'resist'), ME)).toBe('resisted');
    expect(tipFor(hit(ME, 'weak'), ME)).toBe('weak');
    expect(tipFor(hit(ME, 'normal'), ME)).toBeNull();
    expect(tipFor({ type: 'noMana', entity: ME, spell: 'bolt' }, ME)).toBe('noMana');
    expect(tipFor({ type: 'parry', attacker: 9, target: ME, projectile: false, pos: { x: 0, y: 0, z: 0 } }, ME)).toBe('parried');
    expect(tipFor({ type: 'spellLearned', entity: ME, spell: 'blast' }, ME)).toBe('newSpell');
  });

  it("another entity's moments don't count", () => {
    expect(tipFor(hit(5, 'resist'), ME)).toBeNull();
    expect(tipFor({ type: 'noMana', entity: 5, spell: 'bolt' }, ME)).toBeNull();
    expect(tipFor({ type: 'parry', attacker: ME, target: 5, projectile: false, pos: { x: 0, y: 0, z: 0 } }, ME)).toBeNull();
  });

  it('a tip shows once per session', () => {
    const t = new Tutorial();
    expect(t.tip(hit(ME, 'resist'), ME, 'pad')).toMatch(/Resisted/);
    expect(t.tip(hit(ME, 'resist'), ME, 'pad')).toBeNull();
    expect(t.tip(hit(ME, 'weak'), ME, 'pad')).toMatch(/Weak spot/);
  });

  it('button names follow the device', () => {
    expect(tipText('unblockable', 'pad')).toContain('B');
    expect(tipText('unblockable', 'kbm')).toContain('with C');
    expect(tipText('lockOn', 'pad')).toContain('RS');
    expect(tipText('parried', 'kbm')).toContain('right mouse');
  });
});
