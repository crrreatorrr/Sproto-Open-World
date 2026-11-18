import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SaveError, migrate } from '../../src/save/migrations';
import { SAVE_SCHEMA } from '../../src/save/schema';
import { evs, interact, standBy, tick1, village } from '../sim/m3Helpers';

/** M3 acceptance 2 (plan §2.8): a fixture save per schema version, migrated v → v + 1. */

const fixture = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

describe('save migrations (M3 acceptance 2)', () => {
  it(`the current schema is ${SAVE_SCHEMA} and has a fixture`, () => {
    expect(SAVE_SCHEMA).toBe(2);
    expect(fixture(`save-v${SAVE_SCHEMA}.json`).schema).toBe(SAVE_SCHEMA);
  });

  it('every older schema has a fixture that migrates to the current one', () => {
    for (let v = 1; v < SAVE_SCHEMA; v++) expect(migrate(fixture(`save-v${v}.json`)).schema, `v${v}`).toBe(SAVE_SCHEMA);
  });

  it('v1 → v2: potions become tonics, tracked and discoveredShrines are added, the rest is kept', () => {
    const v1 = fixture('save-v1.json');
    const s = migrate(structuredClone(v1));
    expect(s.schema).toBe(2);
    expect(s.player.tonics).toEqual({ charges: 2, max: 3 });
    expect(s.player).not.toHaveProperty('potions');
    expect(s.player.tracked).toBeNull();
    expect(s.player.discoveredShrines).toEqual(['shrine_first_light']);
    // Untouched.
    const p1 = v1.player as Record<string, unknown>;
    for (const k of ['level', 'xp', 'attrs', 'points', 'sprouts', 'equipment', 'inventory', 'spells', 'quests', 'lastShrine'] as const) {
      expect(s.player[k], k).toEqual(p1[k]);
    }
    expect(s.world).toEqual(v1.world);
    expect({ savedAt: s.savedAt, build: s.build, region: s.region }).toEqual({ savedAt: v1.savedAt, build: v1.build, region: v1.region });
  });

  it('v1 → v2 edge cases: no potions → 3; more than 3 potions keeps them; no lastShrine → no shrines found', () => {
    const v1 = fixture('save-v1.json');
    const p = v1.player as Record<string, unknown>;
    const noPotions = structuredClone(v1);
    delete (noPotions.player as Record<string, unknown>).potions;
    expect(migrate(noPotions).player.tonics).toEqual({ charges: 3, max: 3 });
    const many = { ...structuredClone(v1), player: { ...p, potions: 5 } };
    expect(migrate(many).player.tonics).toEqual({ charges: 5, max: 5 });
    const none = { ...structuredClone(v1), player: { ...p, lastShrine: null } };
    expect(migrate(none).player.discoveredShrines).toEqual([]);
  });

  it('the migration does not mutate its input', () => {
    const v1 = fixture('save-v1.json');
    const copy = structuredClone(v1);
    migrate(v1);
    expect(v1).toEqual(copy);
  });

  it('the current schema passes unchanged', () => {
    const v2 = fixture('save-v2.json');
    expect(migrate(structuredClone(v2))).toEqual(v2);
  });

  it('a newer schema is rejected (SaveError)', () => {
    const v3 = { ...fixture('save-v2.json'), schema: SAVE_SCHEMA + 1 };
    expect(() => migrate(v3)).toThrow(SaveError);
    expect(() => migrate(v3)).toThrow(/newer/);
  });

  it('garbage is rejected (SaveError), never a crash', () => {
    const v2 = fixture('save-v2.json');
    const p = v2.player as Record<string, unknown>;
    const without = (k: string) => {
      const q = { ...p };
      delete q[k];
      return { ...v2, player: q };
    };
    const bad: unknown[] = [
      null, undefined, 0, 42, 'save', true, [], [1, 2],
      {}, { schema: '2' }, { schema: 0 }, { schema: -1 }, { schema: 1.5 }, { schema: Number.NaN }, { schema: 2 },
      { ...v2, player: null }, { ...v2, world: null }, { ...v2, player: 'x' },
      without('level'), without('xp'), without('sprouts'), without('attrs'), without('equipment'), without('inventory'), without('spells'), without('quests'), without('tonics'),
      { ...v2, player: { ...p, level: '2' } },
      { ...v2, world: { flags: {}, openedChests: 'chest_training', killedUniques: [] } },
      { ...v2, world: { flags: {}, openedChests: [] } },
      { schema: 1, player: null, world: null },
    ];
    for (const b of bad) expect(() => migrate(b), JSON.stringify(b)).toThrow(SaveError);
  });

  it('a migrated v1 save loads into the sim and plays on (the quest resumes)', async () => {
    const s = migrate(fixture('save-v1.json'));
    const { w, prog } = await village();
    w.applySave(s);
    expect(prog().tonics).toEqual({ charges: 2, max: 3 });
    expect(prog().level).toBe(3);
    expect(prog().equipment.staff).toBe('staff_nobu');
    // Seed step: the v1 player had already opened the chest but carries no seed (an old-draft save).
    expect(prog().quests.q_wake_up.step).toBe(3);
    prog().inventory.sprout_seed = 1;
    standBy(w, 'elder_pepe');
    const e = tick1(w, interact());
    expect(evs(e, 'questStep')).toMatchObject([{ quest: 'q_wake_up', step: 4 }]);
    w.dispose();
  });
});
