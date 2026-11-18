import { SAVE_SCHEMA, type SaveFile } from './schema';

/**
 * Save migrations (plan §2.8): one step per schema version, v → v + 1. Each has a fixture save and a
 * test (tests/save). Pure.
 *
 *   v1 (M3 draft): `player.potions: number` and no `tonics`; no `tracked`; no `discoveredShrines`.
 *   v2: `player.tonics: { charges, max }`, `tracked`, `discoveredShrines`.
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
    !!p.attrs && typeof p.attrs === 'object' && !!p.equipment && typeof p.equipment === 'object' &&
    !!p.inventory && typeof p.inventory === 'object' && Array.isArray(p.spells) && !!p.quests && typeof p.quests === 'object' &&
    !!p.tonics && typeof p.tonics === 'object' && !!w.flags && Array.isArray(w.openedChests) && Array.isArray(w.killedUniques);
  if (!ok) throw new SaveError('missing fields');
  return s as unknown as SaveFile;
}
