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
    expect(SAVE_SCHEMA).toBe(4);
    expect(fixture(`save-v${SAVE_SCHEMA}.json`).schema).toBe(SAVE_SCHEMA);
  });

  it('every older schema has a fixture that migrates to the current one', () => {
    for (let v = 1; v < SAVE_SCHEMA; v++) expect(migrate(fixture(`save-v${v}.json`)).schema, `v${v}`).toBe(SAVE_SCHEMA);
  });

  it('v1 → v2: potions become tonics, tracked and discoveredShrines are added, the rest is kept', () => {
    const v1 = fixture('save-v1.json');
    const s = migrate(structuredClone(v1));
    expect(s.schema).toBe(SAVE_SCHEMA);
    expect(s.player.tonics).toEqual({ charges: 2, max: 3 });
    expect(s.player).not.toHaveProperty('potions');
    expect(s.player.tracked).toBeNull();
    expect(s.player.discoveredShrines).toEqual(['shrine_first_light']);
    // Untouched.
    const p1 = v1.player as Record<string, unknown>;
    for (const k of ['level', 'xp', 'sprouts', 'equipment', 'inventory', 'spells', 'quests', 'lastShrine'] as const) {
      expect(s.player[k], k).toEqual(p1[k]);
    }
    expect(s.world).toEqual(v1.world);
    expect({ savedAt: s.savedAt, build: s.build, region: s.region }).toEqual({ savedAt: v1.savedAt, build: v1.build, region: v1.region });
  });

  it('v1 → v3: the attributes become skills and the points are topped up to 2 per level-up', () => {
    const s = migrate(fixture('save-v1.json'));
    // Level 3, Might 1 and Vitality 1: Attack 1, Defense 1, and 2 × 2 − 2 = 2 points to spend.
    expect(s.player.skills).toEqual({ spellPower: 0, protection: 0, focus: 0, attack: 1, defense: 1, stamina: 0 });
    expect(s.player.points).toBe(2);
    expect(s.player.loadout).toEqual(['bolt', null, null, null]);
    expect(s.player).not.toHaveProperty('attrs');
  });

  it('v2 → v3: known spells go to their old slots; attributes map to skills; total points = 2 × (level − 1)', () => {
    const v2 = fixture('save-v2.json');
    const s = migrate(structuredClone(v2));
    expect(s.schema).toBe(SAVE_SCHEMA);
    expect(s.player.loadout).toEqual(['bolt', 'blast', null, null]);
    expect(s.player.skills).toEqual({ spellPower: 1, protection: 0, focus: 0, attack: 0, defense: 0, stamina: 0 });
    expect(s.player.points).toBe(1);
    expect(s.player).not.toHaveProperty('attrs');
    const p2 = v2.player as Record<string, unknown>;
    for (const k of ['level', 'xp', 'sprouts', 'equipment', 'inventory', 'spells', 'tonics', 'quests', 'tracked', 'lastShrine', 'discoveredShrines'] as const) {
      expect(s.player[k], k).toEqual(p2[k]);
    }
    expect(s.world).toEqual(v2.world);
  });

  it('v2 → v3 keeps total power: every attribute point is a rank, nobody has fewer points than before', () => {
    const v2 = fixture('save-v2.json');
    const p = v2.player as Record<string, unknown>;
    const cases: [Record<string, number>, number, number][] = [
      // attrs, unspent points, level
      [{ might: 2, arcana: 3, vitality: 1, endurance: 3 }, 0, 10],
      [{ might: 0, arcana: 0, vitality: 0, endurance: 0 }, 4, 5],
      [{ might: 4, arcana: 0, vitality: 0, endurance: 0 }, 1, 6],
      [{ might: 0, arcana: 0, vitality: 0, endurance: 0 }, 0, 1],
    ];
    for (const [attrs, points, level] of cases) {
      const s = migrate({ ...structuredClone(v2), player: { ...p, attrs, points, level } });
      const sk = s.player.skills;
      expect([sk.attack, sk.spellPower, sk.defense, sk.stamina], JSON.stringify(attrs)).toEqual([attrs.might, attrs.arcana, attrs.vitality, attrs.endurance]);
      const ranks = Object.values(sk).reduce((a, b) => a + b, 0);
      expect(ranks + s.player.points, `level ${level}`).toBe(2 * (level - 1));
      expect(s.player.points).toBeGreaterThanOrEqual(points);
    }
  });

  it('v2 → v3: a loadout from all four spells, and from none', () => {
    const v2 = fixture('save-v2.json');
    const p = v2.player as Record<string, unknown>;
    expect(migrate({ ...structuredClone(v2), player: { ...p, spells: ['chainZap', 'frostNova', 'bolt', 'blast'] } }).player.loadout).toEqual(['bolt', 'blast', 'frostNova', 'chainZap']);
    expect(migrate({ ...structuredClone(v2), player: { ...p, spells: [] } }).player.loadout).toEqual([null, null, null, null]);
  });

  it('a migrated v2 save loads into the sim: the loadout casts, the skills count', async () => {
    const s = migrate(fixture('save-v2.json'));
    const { w, p, prog } = await village();
    w.applySave(s);
    expect(prog().loadout).toEqual(['bolt', 'blast', null, null]);
    expect(prog().skills.spellPower).toBe(1);
    expect(p.vitals!.manaMax).toBe(100 + 4);
    w.dispose();
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
    const v4 = fixture('save-v4.json');
    expect(migrate(structuredClone(v4))).toEqual(v4);
  });

  it('v3 → v4: an old save grows empty relic sockets and keeps everything else', () => {
    const v3 = fixture('save-v3.json');
    const s = migrate(structuredClone(v3));
    expect(s.schema).toBe(4);
    expect(s.player.relics).toEqual({ sockets: [null, null, null], totem: null, owned: [], seedSpent: false, introduced: false, giantDodges: 0, bonus: {} });
    const p3 = v3.player as Record<string, unknown>;
    for (const k of ['level', 'xp', 'sprouts', 'equipment', 'inventory', 'spells', 'loadout', 'skills', 'points', 'tonics', 'quests', 'tracked', 'lastShrine', 'discoveredShrines'] as const) {
      expect(s.player[k], k).toEqual(p3[k]);
    }
    expect(s.world).toEqual(v3.world);
  });

  it('a newer schema is rejected (SaveError)', () => {
    const v4 = { ...fixture('save-v3.json'), schema: SAVE_SCHEMA + 1 };
    expect(() => migrate(v4)).toThrow(SaveError);
    expect(() => migrate(v4)).toThrow(/newer/);
  });

  it('validate() checks the loadout (4 entries, null or known, no duplicates) and the skill ranks', () => {
    const v3 = fixture('save-v3.json');
    const p = v3.player as Record<string, unknown>;
    const withP = (q: Record<string, unknown>) => ({ ...structuredClone(v3), player: { ...p, ...q } });
    const sk = p.skills as Record<string, number>;
    const bad = [
      withP({ loadout: ['bolt', null, null] }),
      withP({ loadout: ['bolt', null, null, null, null] }),
      withP({ loadout: ['bolt', 'bolt', null, null] }),
      withP({ loadout: ['chainZap', null, null, null] }), // not known
      withP({ loadout: ['bolt', 3, null, null] }),
      withP({ loadout: 'bolt' }),
      withP({ loadout: undefined }),
      withP({ skills: undefined }),
      withP({ skills: { ...sk, attack: 11 } }),
      withP({ skills: { ...sk, attack: -1 } }),
      withP({ skills: { ...sk, attack: 1.5 } }),
      withP({ skills: { ...sk, attack: '1' } }),
      withP({ skills: { spellPower: 1 } }),
      withP({ points: -1 }),
      withP({ points: '1' }),
    ];
    for (const b of bad) expect(() => migrate(b), JSON.stringify(b.player)).toThrow(SaveError);
    expect(() => migrate(withP({ loadout: [null, null, null, null] }))).not.toThrow();
    expect(() => migrate(withP({ skills: { ...sk, attack: 10 } }))).not.toThrow();
  });

  it('garbage is rejected (SaveError), never a crash', () => {
    const v2 = fixture('save-v3.json');
    const p = v2.player as Record<string, unknown>;
    const without = (k: string) => {
      const q = { ...p };
      delete q[k];
      return { ...v2, player: q };
    };
    const bad: unknown[] = [
      null, undefined, 0, 42, 'save', true, [], [1, 2],
      {}, { schema: '2' }, { schema: 0 }, { schema: -1 }, { schema: 1.5 }, { schema: Number.NaN }, { schema: 2 }, { schema: 3 },
      { ...v2, player: null }, { ...v2, world: null }, { ...v2, player: 'x' },
      without('level'), without('xp'), without('sprouts'), without('skills'), without('loadout'), without('points'), without('equipment'), without('inventory'), without('spells'), without('quests'), without('tonics'),
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
