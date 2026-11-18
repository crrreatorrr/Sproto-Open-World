import { SKILL_IDS, SKILL_MAX_RANK, pointsForLevel } from '../content/progression';
import { LOADOUT_SLOTS } from '../content/spells';
import { SAVE_SCHEMA, type SaveFile } from './schema';

/**
 * Save migrations (plan §2.8): one step per schema version, v → v + 1. Each has a fixture save and a
 * test (tests/save). Pure.
 *
 *   v1 (M3 draft): `player.potions: number` and no `tonics`; no `tracked`; no `discoveredShrines`.
 *   v2: `player.tonics: { charges, max }`, `tracked`, `discoveredShrines`.
 *   v3 (C1): `player.loadout` (4 spell slots) and `player.skills` (the skill tree) replace
 *       `player.attrs`; `points` are skill points (2 per level-up).
 */
type Raw = Record<string, unknown> & { schema?: unknown };

const STEPS: Record<number, (s: Raw) => Raw> = {
  1: (s) => {
    const player = { ...(s.player as Record<string, unknown>) };
    const potions = typeof player.potions === 'number' ? player.potions : 3;
    delete player.potions;
    player.tonics = { charges: potions, max: Math.max(3, potions) };
    player.tracked ??= null;
    player.discoveredShrines ??= player.lastShrine ? [player.lastShrine] : [];
    return { ...s, schema: 2, player };
  },
  2: (s) => {
    const player = { ...(s.player as Record<string, unknown>) };
    // The loadout: every known spell in the slot it was fixed to before C1.
    const V2_SLOTS = ['bolt', 'blast', 'frostNova', 'chainZap'];
    const known = Array.isArray(player.spells) ? player.spells : [];
    player.loadout = V2_SLOTS.map((id) => (known.includes(id) ? id : null));
    // Attributes become skills rank for point; anything over the rank cap comes back as points.
    const attrs = (player.attrs && typeof player.attrs === 'object' ? player.attrs : {}) as Record<string, unknown>;
    const rank = (k: string) => (typeof attrs[k] === 'number' && Number.isFinite(attrs[k]) ? Math.max(0, Math.floor(attrs[k] as number)) : 0);
    const from = { spellPower: rank('arcana'), protection: 0, focus: 0, attack: rank('might'), defense: rank('vitality'), stamina: rank('endurance') };
    const skills = Object.fromEntries(Object.entries(from).map(([k, v]) => [k, Math.min(SKILL_MAX_RANK, v)]));
    const spent = Object.values(skills).reduce((a, b) => a + b, 0);
    delete player.attrs;
    player.skills = skills;
    // Nobody loses points: total points become the new rate's 2 per level-up.
    const level = typeof player.level === 'number' ? player.level : 1;
    const oldTotal = Object.values(from).reduce((a, b) => a + b, 0) + (typeof player.points === 'number' ? player.points : 0);
    player.points = Math.max(pointsForLevel(level), oldTotal) - spent;
    return { ...s, schema: 3, player };
  },
};

export class SaveError extends Error {}

/** Bring any known older save up to SAVE_SCHEMA. Throws SaveError for unknown or newer versions. */
export function migrate(raw: unknown): SaveFile {
  if (!raw || typeof raw !== 'object') throw new SaveError('not an object');
  let s = raw as Raw;
  if (typeof s.schema !== 'number' || !Number.isInteger(s.schema) || s.schema < 1) throw new SaveError('no schema version');
  if (s.schema > SAVE_SCHEMA) throw new SaveError(`made by a newer build (schema ${s.schema})`);
  while ((s.schema as number) < SAVE_SCHEMA) {
    const step = STEPS[s.schema as number];
    if (!step) throw new SaveError(`no migration from schema ${s.schema}`);
    s = step(s);
  }
  return validate(s);
}

/** Shape check: a save that would crash the game is treated as damaged. */
function validate(s: Raw): SaveFile {
  const p = s.player as Record<string, unknown> | undefined;
  const w = s.world as Record<string, unknown> | undefined;
  const ok =
    !!p && !!w && typeof p.level === 'number' && typeof p.xp === 'number' && typeof p.sprouts === 'number' &&
    typeof p.points === 'number' && Number.isInteger(p.points) && p.points >= 0 &&
    validSkills(p.skills) && validLoadout(p.loadout, p.spells) && !!p.equipment && typeof p.equipment === 'object' &&
    !!p.inventory && typeof p.inventory === 'object' && Array.isArray(p.spells) && !!p.quests && typeof p.quests === 'object' &&
    !!p.tonics && typeof p.tonics === 'object' && !!w.flags && Array.isArray(w.openedChests) && Array.isArray(w.killedUniques);
  if (!ok) throw new SaveError('missing fields');
  return s as unknown as SaveFile;
}

/** Every skill present, an integer rank 0–10. */
function validSkills(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return SKILL_IDS.every((k) => typeof s[k] === 'number' && Number.isInteger(s[k]) && (s[k] as number) >= 0 && (s[k] as number) <= SKILL_MAX_RANK);
}

/** Four slots, each null or a known spell, no spell twice. */
function validLoadout(v: unknown, spells: unknown): boolean {
  if (!Array.isArray(v) || v.length !== LOADOUT_SLOTS || !Array.isArray(spells)) return false;
  const used = v.filter((x) => x !== null);
  return used.every((x) => typeof x === 'string' && spells.includes(x)) && new Set(used).size === used.length;
}
