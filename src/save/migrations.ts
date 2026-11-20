import { ITEMS, STARTING_GEAR } from '../content/items';
import { emptyRelics } from '../content/relics';
import { LEVEL_CAP, SKILL_IDS, SKILL_MAX_RANK, pointsForLevel } from '../content/progression';
import { QUESTS } from '../content/quests';
import { LOADOUT_SLOTS, SPELLS } from '../content/spells';
import { reconcileRelics, validRelicProgress } from '../sim/systems/relics';
import { SAVE_SCHEMA, type SaveFile } from './schema';

/**
 * Save migrations (plan §2.8): one step per schema version, v → v + 1. Each has a fixture save and a
 * test (tests/save). Pure.
 *
 *   v1 (M3 draft): `player.potions: number` and no `tonics`; no `tracked`; no `discoveredShrines`.
 *   v2: `player.tonics: { charges, max }`, `tracked`, `discoveredShrines`.
 *   v3 (C1): `player.loadout` (4 spell slots) and `player.skills` (the skill tree) replace
 *       `player.attrs`; `points` are skill points (2 per level-up).
 *   v4: `player.relics` (3 relic sockets, 1 totem, the keepsakes won). Old saves start empty, and
 *       reconcile hands over the keepsakes their finished quests and steps already gave.
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
  3: (s) => {
    const player = { ...(s.player as Record<string, unknown>) };
    player.relics = emptyRelics();
    return { ...s, schema: 4, player };
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
  return reconcile(validate(s));
}

const isTable = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** A finite number, zero or more (JSON can spell Infinity as 1e999). */
const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isCount = (v: unknown): v is number => isAmount(v) && Number.isInteger(v);

/** Shape check: a save that would crash the game is treated as damaged. */
function validate(s: Raw): SaveFile {
  const p = s.player as Record<string, unknown> | undefined;
  const w = s.world as Record<string, unknown> | undefined;
  const ok =
    !!p && !!w && isCount(p.level) && p.level >= 1 && p.level <= LEVEL_CAP && isAmount(p.xp) && isAmount(p.sprouts) &&
    isCount(p.points) &&
    validSkills(p.skills) && validSpells(p.spells) && validLoadout(p.loadout, p.spells) && isTable(p.equipment) &&
    isTable(p.inventory) && Object.values(p.inventory).every(isCount) && isTable(p.quests) &&
    isTable(p.tonics) && isCount(p.tonics.charges) && isCount(p.tonics.max) && Array.isArray(p.discoveredShrines) &&
    validRelicProgress(p.relics) &&
    isTable(w.flags) && Array.isArray(w.openedChests) && Array.isArray(w.killedUniques);
  if (!ok) throw new SaveError('missing fields');
  return s as unknown as SaveFile;
}

/** Every known spell is one the game has. */
const validSpells = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string' && Object.hasOwn(SPELLS, x));

/**
 * A sound save can still outlive the content it names. What the game no longer has is let go, gear
 * that isn't owned comes off, and a quest that changed resumes where it can: the save plays on.
 */
function reconcile(s: SaveFile): SaveFile {
  const p = s.player;
  const inventory = Object.fromEntries(Object.entries(p.inventory).filter(([id]) => Object.hasOwn(ITEMS, id)));
  const owned = (id: string | null | undefined, kind: string): id is string => !!id && Object.hasOwn(ITEMS, id) && ITEMS[id].kind === kind && inventory[id] > 0;
  const worn = (id: string, kind: string, starter: string): string => {
    if (owned(id, kind)) return id;
    inventory[starter] = Math.max(1, inventory[starter] ?? 0);
    return starter;
  };
  const equipment = {
    staff: worn(p.equipment.staff, 'staff', STARTING_GEAR.staff),
    robe: worn(p.equipment.robe, 'robe', STARTING_GEAR.robe),
    charm: owned(p.equipment.charm, 'charm') ? p.equipment.charm : null,
  };
  const quests: SaveFile['player']['quests'] = {};
  for (const [id, q] of Object.entries(p.quests)) {
    if (!isTable(q) || !Object.hasOwn(QUESTS, id)) continue;
    const steps = QUESTS[id].steps;
    const step = Math.min(isCount(q.step) ? q.step : 0, steps.length - 1);
    const size = steps[step].objectives.length;
    const fits = step === q.step && Array.isArray(q.progress) && q.progress.length === size && q.progress.every(isAmount);
    quests[id] = q.status !== 'active' || fits ? q : { ...q, step, progress: new Array<number>(size).fill(0) };
  }
  const tracked = p.tracked && quests[p.tracked]?.status === 'active' ? p.tracked : null;
  // Keepsakes come from step onComplete, quest rewards and world flags (bonus feats, the mill lever),
  // which never fire again for finished work: a save from before v4 (or before a keepsake was added to
  // a step, or with a bonus flag set before the relics read it) is handed what it already won.
  const relics = reconcileRelics(p.relics ?? emptyRelics(), quests, s.world.flags);
  return { ...s, player: { ...p, inventory, equipment, quests, tracked, relics } };
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
