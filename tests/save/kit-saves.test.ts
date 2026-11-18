import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUESTS } from '../../src/content/quests';
import { SaveError, migrate } from '../../src/save/migrations';
import { loadSave, writeSave } from '../../src/save/SaveStore';
import { SAVE_BAK_KEY, SAVE_KEY, type SaveFile } from '../../src/save/schema';
import { BTN, press, step, stepN } from '../sim/combatHelpers';
import { evs, tick1, ui, village } from '../sim/m3Helpers';

/** Saves as they really arrive: damaged, out of date, or made at an awkward moment. */

const fixture = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const v3 = () => fixture('save-v3.json');
const withPlayer = (q: Record<string, unknown>) => {
  const s = v3();
  return { ...s, player: { ...(s.player as Record<string, unknown>), ...q } };
};
const player = (s: SaveFile) => s.player;
const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('a damaged save is refused, not played', () => {
  const tonics = { charges: 1, max: 3 };
  it.each<[string, Record<string, unknown>]>([
    ['level 0', { level: 0 }],
    ['a level past the cap', { level: 99 }],
    ['a fractional level', { level: 2.5 }],
    ['infinite Sprouts', { sprouts: Infinity }],
    ['negative Sprouts', { sprouts: -5 }],
    ['negative XP', { xp: -1 }],
    ['tonics without numbers', { tonics: {} }],
    ['negative tonic charges', { tonics: { ...tonics, charges: -1 } }],
    ['a spell that does not exist', { spells: ['bolt', 'blast', 'frostNova', 'fireball'] }],
    ['an inherited name as a spell', { spells: ['bolt', 'blast', 'frostNova', 'constructor'] }],
    ['an item count that is no number', { inventory: { staff_sproto: 'lots', robe_apprentice: 1 } }],
    ['a negative item count', { inventory: { staff_sproto: 1, robe_apprentice: -1 } }],
    ['no list of shrines', { discoveredShrines: undefined }],
  ])('%s', (_name, q) => {
    expect(() => migrate(withPlayer(q))).toThrow(SaveError);
  });

  it('world flags that are not a table', () => {
    const s = v3();
    expect(() => migrate({ ...s, world: { ...(s.world as object), flags: 'x' } })).toThrow(SaveError);
  });

  it('falls back to the backup, and says so', () => {
    const good = JSON.stringify(v3());
    const r = loadSave(memory({ [SAVE_KEY]: JSON.stringify(withPlayer({ level: 99 })), [SAVE_BAK_KEY]: good }));
    expect(r.fromBackup).toBe(true);
    expect(r.save).not.toBeNull();
    expect(r.error).toMatch(/damaged/);
  });

  it('a damaged save never replaces the backup', () => {
    const good = JSON.stringify(v3());
    const store = memory({ [SAVE_KEY]: '{oops', [SAVE_BAK_KEY]: good });
    expect(writeSave(migrate(v3()), store)).toBe(true);
    expect(store.getItem(SAVE_BAK_KEY)).toBe(good);
  });
});

describe('a save that outlived the content still loads', () => {
  it('gear you no longer own comes off; the starter staff and robe are always there', () => {
    const s = migrate(withPlayer({
      equipment: { staff: 'staff_nobu', robe: 'robe_gone', charm: 'charm_second_wind' },
      inventory: {},
    }));
    expect(player(s).equipment).toEqual({ staff: 'staff_sproto', robe: 'robe_apprentice', charm: null });
    expect(player(s).inventory.staff_sproto).toBe(1);
    expect(player(s).inventory.robe_apprentice).toBe(1);
  });

  it('items the game no longer has are dropped, the rest kept', () => {
    const s = migrate(withPlayer({ inventory: { staff_sproto: 1, robe_apprentice: 1, relic_gone: 2, heart: 0 } }));
    expect(player(s).inventory).not.toHaveProperty('relic_gone');
    expect(player(s).inventory.heart).toBe(0);
  });

  it('a quest the game no longer has is forgotten, and stops being tracked', () => {
    const s = migrate(withPlayer({ quests: { q_gone: { status: 'active', step: 0, progress: [0] } }, tracked: 'q_gone' }));
    expect(player(s).quests).toEqual({});
    expect(player(s).tracked).toBeNull();
  });

  it('a quest that got shorter resumes on its last step, with a counter per objective', () => {
    const id = Object.keys(QUESTS)[0];
    const steps = QUESTS[id].steps;
    const s = migrate(withPlayer({ quests: { [id]: { status: 'active', step: steps.length + 4, progress: [] } }, tracked: id }));
    const q = player(s).quests[id];
    expect(q.step).toBe(steps.length - 1);
    expect(q.progress).toEqual(steps[steps.length - 1].objectives.map(() => 0));
    expect(player(s).tracked).toBe(id);
  });

  it('progress kept on a quest whose step still fits', () => {
    const id = Object.keys(QUESTS).find((k) => QUESTS[k].steps[0].objectives.length === 1)!;
    const s = migrate(withPlayer({ quests: { [id]: { status: 'active', step: 0, progress: [1] } } }));
    expect(player(s).quests[id].progress).toEqual([1]);
  });

  it('plays on after loading: the world ticks with such a quest in the save', async () => {
    const id = Object.keys(QUESTS)[0];
    const s = migrate(withPlayer({ quests: { q_gone: { status: 'active', step: 1, progress: [] }, [id]: { status: 'active', step: 99, progress: [] } } }));
    const { w } = await village();
    w.applySave(s);
    expect(() => stepN(w, 5)).not.toThrow();
    w.dispose();
  });
});

describe('every field comes back', () => {
  it('a played character survives the round trip through JSON', async () => {
    const { w, prog } = await village();
    const p = prog();
    Object.assign(p, { level: 7, xp: 1234, points: 3, sprouts: 321, tracked: null, lastShrine: 'shrine_first_light', discoveredShrines: ['shrine_first_light'] });
    p.skills.focus = 4;
    p.spells.push('blast', 'mirrorWard');
    p.loadout = ['mirrorWard', 'blast', null, 'bolt'];
    p.inventory.charm_second_wind = 1;
    p.equipment.charm = 'charm_second_wind';
    p.tonics = { charges: 2, max: 4 };
    w.world.flags.some_flag = 3;
    w.world.openedChests.push('chest_training');
    w.world.killedUniques.push('gatekeeper');
    const file = JSON.parse(JSON.stringify(w.toSave({ savedAt: 'then', build: 'test', region: 'sproutvale' })));
    const back = migrate(file);
    expect(back).toEqual(file);
    const b = await village();
    b.w.applySave(back);
    const { dialogue: _d, shop: _s, atShrine: _a, ...kept } = b.prog();
    expect(kept).toEqual(file.player);
    expect(b.w.world).toMatchObject({ openedChests: file.world.openedChests, killedUniques: file.world.killedUniques });
    w.dispose();
    b.w.dispose();
  });
});

describe('saves made at awkward moments load clean', () => {
  it('mid-cast, with a cooldown running: a fresh body, nothing in flight', async () => {
    const { w, p } = await village();
    p.vitals!.mana = 50;
    step(w, press(BTN.spell1));
    expect(p.combat!.action?.kind).toBe('cast');
    const file = migrate(JSON.parse(JSON.stringify(w.toSave({ savedAt: 'then', build: 'test', region: 'sproutvale' }))));
    const b = await village();
    b.w.applySave(file);
    expect(b.p.combat!.action).toBeNull();
    expect(b.p.vitals!.mana).toBe(b.p.vitals!.manaMax);
    expect(b.w.entities.filter((e) => e.projectile)).toEqual([]);
    expect(evs(tick1(b.w, ui([])), 'refused')).toEqual([]);
    w.dispose();
    b.w.dispose();
  });
});
