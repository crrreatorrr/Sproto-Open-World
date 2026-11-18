import { describe, expect, it } from 'vitest';
import { xpForLevel, xpToNext } from '../../src/content/progression';
import type { Progress } from '../../src/sim/entity';
import {
  attrGain, compassOffset, headingTo, interactLabel, inventoryGroups, levelProgress, objectiveLines, plural, questLog, shopStock, trackedQuest, wrapAngle,
} from '../../src/ui/rpgText';

function progress(over: Partial<Progress> = {}): Progress {
  return {
    level: 1, xp: 0, attrs: { might: 0, arcana: 0, vitality: 0, endurance: 0 }, points: 0, sprouts: 0,
    equipment: { staff: 'staff_sproto', robe: 'robe_apprentice', charm: null }, inventory: {}, spells: ['bolt'],
    tonics: { charges: 3, max: 3 }, quests: {}, tracked: null, lastShrine: null, discoveredShrines: [], dialogue: null, shop: null, atShrine: null,
    ...over,
  };
}

describe('XP bar', () => {
  it('fills through the current level and caps at 10', () => {
    expect(levelProgress(1, 0)).toMatchObject({ frac: 0, into: 0, need: 60 });
    expect(levelProgress(1, 30).frac).toBeCloseTo(0.5);
    const l3 = xpForLevel(3);
    expect(levelProgress(3, l3 + xpToNext(3) / 4).frac).toBeCloseTo(0.25, 2);
    expect(levelProgress(10, 99999)).toMatchObject({ frac: 1, capped: true });
  });
});

describe('quest tracker text', () => {
  it('counts kills and items, hides lone yes/no objectives', () => {
    expect(objectiveLines([{ kind: 'kill', tag: 'dummy_straw', count: 3 }], [1])).toEqual([{ text: 'Straw Dummies 1/3', done: false }]);
    expect(objectiveLines([{ kind: 'reach', trigger: 'training_yard' }], [0])).toEqual([]);
    expect(objectiveLines([{ kind: 'collect', item: 'sprout_seed', count: 1 }, { kind: 'talk', npc: 'elder_pepe' }], [1, 0])).toEqual([
      { text: 'Sprout Seed 1/1', done: true },
      { text: 'Talk to Elder Pepe', done: false },
    ]);
    // Progress never reads past the goal.
    expect(objectiveLines([{ kind: 'kill', tag: 'grunt', count: 8 }], [9])[0].text).toBe('Sprout Grunts 8/8');
  });

  it('pluralizes plainly', () => {
    expect(plural('Straw Dummy', 3)).toBe('Straw Dummies');
    expect(plural('Grunt', 2)).toBe('Grunts');
    expect(plural('Grunt', 1)).toBe('Grunt');
  });

  it('tracks the tracked quest, else the first active one; the log puts active first', () => {
    const p = progress({ quests: { q_wake_up: { status: 'active', step: 1, progress: [2] } } });
    const t = trackedQuest(p)!;
    expect(t.title).toBe('Wake Up, Sproto');
    expect(t.step).toBe('Break three straw dummies.');
    expect(t.lines[0].text).toBe('Straw Dummies 2/3');
    expect(t.marker).toBe('training_yard');
    expect(trackedQuest(progress({ tracked: 'q_wake_up', quests: { q_wake_up: { status: 'complete', step: 5, progress: [] } } }))).toBeNull();
    const log = questLog(progress({ quests: { q_wake_up: { status: 'complete', step: 5, progress: [] } } }));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: 'complete', step: 'Complete', marker: null });
  });
});

describe('compass', () => {
  it('wraps angles into (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });

  it('north is +z; east sits to the right when facing north, as the camera shows it', () => {
    const o = { x: 0, z: 0 };
    expect(headingTo(o, { x: 0, z: 10 })).toBeCloseTo(0);
    // Facing +z (yaw 0) the camera's right is −x, so −x is east.
    expect(headingTo(o, { x: -10, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(compassOffset(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    // Turning right lowers yaw: a quarter turn right faces east, putting north on the left.
    expect(compassOffset(-Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2);
    // A marker straight ahead whatever the facing.
    const yaw = 0.7;
    const ahead = { x: Math.sin(yaw) * 5, z: Math.cos(yaw) * 5 };
    expect(compassOffset(yaw, headingTo(o, ahead))).toBeCloseTo(0);
  });
});

describe('prompts, level-up, shop, inventory', () => {
  it('words the interact prompt by kind', () => {
    expect(interactLabel('npc', 'Elder Pepe')).toBe('Talk to Elder Pepe');
    expect(interactLabel('shrine', 'Shrine of First Light')).toBe('Rest at Shrine of First Light');
    expect(interactLabel('chest', 'Old Chest')).toBe('Open Old Chest');
  });

  it('says what a point buys', () => {
    expect(attrGain('vitality')).toBe('+15 health, +0.5 defense');
    expect(attrGain('might')).toBe('+4% melee damage');
  });

  it('takes bought items out of the stock', () => {
    const s = shopStock('merchant_village', { 'bought:merchant_village:staff_nobu': 1 });
    expect(s.find((l) => l.item.id === 'staff_nobu')).toMatchObject({ left: 0, price: 120 });
    expect(s.find((l) => l.item.id === 'charm_quick_step')).toMatchObject({ left: 1, price: 80 });
    expect(shopStock('nobody', {})).toEqual([]);
  });

  it('groups owned items, counting equipped gear', () => {
    const g = inventoryGroups(progress({ inventory: { charm_iron_root: 1, sprout_seed: 2 } }));
    expect(g.map((x) => x.kind)).toEqual(['staff', 'robe', 'charm', 'quest']);
    expect(g[0].items[0]).toMatchObject({ equipped: true, count: 1 });
    expect(g[3].items[0]).toMatchObject({ count: 2 });
  });
});
