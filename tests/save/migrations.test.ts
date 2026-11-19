import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SaveError, migrate } from '../../src/save/migrations';
import { QUESTS } from '../../src/content/quests';
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
    // The fixture finished Wake Up, Sproto, whose shrine step gives Elder's Hearth.
    expect(s.player.relics).toEqual({ sockets: [null, null, null], totem: null, owned: ['totem_elders_hearth'], seedSpent: false, introduced: false });
    const p3 = v3.player as Record<string, unknown>;
    for (const k of ['level', 'xp', 'sprouts', 'equipment', 'inventory', 'spells', 'loadout', 'skills', 'points', 'tonics', 'quests', 'tracked', 'lastShrine', 'discoveredShrines'] as const) {
      expect(s.player[k], k).toEqual(p3[k]);
    }
    expect(s.world).toEqual(v3.world);
  });

  it('v3 → v4: keepsakes already won are handed over (steps done, quests done, fallback givers)', () => {
    const v3 = fixture('save-v3.json');
    const p = v3.player as Record<string, unknown>;
    const done = { status: 'complete', step: 99, progress: [] };
    const quests = { q_wake_up: done, q_pest_control: done, q_thornwood: done, q_scrapjaw: done };
    const s = migrate({ ...structuredClone(v3), player: { ...p, quests } });
    // In catalog order: Coins (Thornwood's fallback reward), the Grip (Thornwood's Gatekeeper step),
    // Hopeglass (Scrapjaw's boss step), Stride (Scrapjaw's fallback reward), then the two totems.
    expect(s.player.relics!.owned).toEqual([
      'relic_drowned_coins', 'relic_gatekeepers_grip', 'relic_hopeglass', 'relic_sprotos_stride', 'totem_elders_hearth', 'totem_field_warden',
    ]);
    expect(s.player.relics!.sockets).toEqual([null, null, null]);
    expect(s.player.relics!.totem).toBeNull();
  });

  it('v3 → v4: an active quest owns what its finished steps gave, not what is ahead or a bonus not won', () => {
    const v3 = fixture('save-v3.json');
    const p = v3.player as Record<string, unknown>;
    const at = (quest: string, stepId: string) => {
      const steps = QUESTS[quest].steps;
      const step = steps.findIndex((x) => x.id === stepId);
      return { status: 'active', step, progress: new Array<number>(steps[step].objectives.length).fill(0) };
    };
    const quests = {
      // Past the Gatekeeper: the Grip was given.
      q_thornwood: at('q_thornwood', 'key'),
      // Facing Scrapjaw: Hopeglass comes when the boss step is done.
      q_scrapjaw: at('q_scrapjaw', 'boss'),
      // Watchtower done: its Coins are a bonus (three reflect kills), not a step reward.
      q_watchtower: { status: 'complete', step: QUESTS.q_watchtower.steps.length, progress: [] },
    };
    const s = migrate({ ...structuredClone(v3), player: { ...p, quests } });
    expect(s.player.relics!.owned).toEqual(['relic_gatekeepers_grip']);
  });

  it('a save whose bonus flag (or mill lever) is already set owns that keepsake after reconcile', () => {
    const v4 = fixture('save-v4.json');
    const world = v4.world as { flags: Record<string, number> };
    const flagged = (flags: Record<string, number>) => migrate({ ...structuredClone(v4), world: { ...world, flags: { ...world.flags, ...flags } } }).player.relics!.owned;
    expect(flagged({ 'bonus.q_watchtower.reflect': 1 })).toContain('relic_drowned_coins');
    expect(flagged({ 'bonus.q_iron_gallery.reflect': 1 })).toContain('relic_elder_iron_rivet');
    expect(flagged({ 'bonus.q_hollow_giant.dodge': 1 })).toContain('relic_sprotos_stride');
    expect(flagged({ 'hook.tinubu_seal': 1 })).toContain('relic_tinubus_broken_seal');
    // A save from before the lever's hook flag: the lever's used flag says it was pulled.
    expect(flagged({ 'used:mill_lever': 1 })).toContain('relic_tinubus_broken_seal');
    // Progress toward a bonus is not the bonus.
    expect(flagged({ 'bonus.q_watchtower.reflect.n': 2 })).not.toContain('relic_drowned_coins');
    expect(flagged({})).toEqual(['totem_elders_hearth']);
  });

  it('a v4 save with the old relic feat counters loads, and the counters are dropped', () => {
    const v4 = fixture('save-v4.json');
    const p = v4.player as { relics: Record<string, unknown> };
    const old = { ...structuredClone(v4), player: { ...p, relics: { ...p.relics, giantDodges: 2, bonus: { relic_drowned_coins: 1 } } } };
    const s = migrate(old);
    expect(s.player.relics).toEqual(p.relics);
    expect(s.player.relics).not.toHaveProperty('giantDodges');
    expect(s.player.relics).not.toHaveProperty('bonus');
  });

  it('a fresh save owns no keepsakes', async () => {
    const { w } = await village();
    const s = migrate(JSON.parse(JSON.stringify(w.toSave({ savedAt: 'now', build: 'test', region: 'sproutvale' }))));
    expect(s.player.relics!.owned).toEqual([]);
    w.dispose();
  });

  it('keepsakes are handed over once: reconciling again adds nothing, and owned ones keep their order', () => {
    const v3 = fixture('save-v3.json');
    const p = v3.player as Record<string, unknown>;
    const done = { status: 'complete', step: 99, progress: [] };
    const once = migrate({ ...structuredClone(v3), player: { ...p, quests: { q_wake_up: done, q_thornwood: done } } });
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(new Set(twice.player.relics!.owned).size).toBe(twice.player.relics!.owned.length);
    // A keepsake won in play keeps its place; what the log says was won goes after it, once.
    const played = structuredClone(once);
    played.player.relics!.owned = ['totem_elders_hearth', 'relic_hopeglass', 'relic_hopeglass'];
    expect(migrate(played).player.relics!.owned).toEqual(['totem_elders_hearth', 'relic_hopeglass', 'relic_drowned_coins', 'relic_gatekeepers_grip']);
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
