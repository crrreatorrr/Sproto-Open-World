/**
 * The RPG HUD's and menus' words and numbers, worked out from sim state and content data (plan §5):
 * the XP bar, the quest tracker's lines, the compass bearings, interact prompts, what a skill rank
 * buys, gear comparisons, spell cooldowns and the merchant's remaining stock. Pure (no DOM, no three.js), so tests/ui covers it.
 */
import { ENEMIES } from '../content/enemies';
import { ITEMS, type ItemDef, type ItemKind } from '../content/items';
import { MERCHANTS } from '../content/loot';
import { NPCS } from '../content/npcs';
import { LEVEL_CAP, SKILL_EFFECT, xpForLevel, xpToNext, type SkillId } from '../content/progression';
import { SPELLS, SWAP_MIN_COOLDOWN, type SpellId } from '../content/spells';
import { TICK_HZ } from '../content/tuning';
import { QUESTS, type Objective, type QuestDef, type QuestState } from '../content/quests';
import type { Progress } from '../sim/entity';

/** Where the player stands on the way to the next level: 0..1 of this level's XP, and the numbers. */
export function levelProgress(level: number, xp: number): { frac: number; into: number; need: number; capped: boolean } {
  if (level >= LEVEL_CAP) return { frac: 1, into: 0, need: 0, capped: true };
  const need = xpToNext(level);
  const into = Math.max(0, xp - xpForLevel(level));
  return { frac: Math.min(1, into / Math.max(1, need)), into, need, capped: false };
}

/** "Straw Dummy" → "Straw Dummies", "Grunt" → "Grunts" (English only; strings move to content with localization). */
export function plural(name: string, count: number): string {
  if (count === 1) return name;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

export interface ObjectiveLine {
  text: string;
  done: boolean;
}

/**
 * One line per objective of a step: counted ones ("Straw Dummies 1/3", "Sprout Seed 0/1") always,
 * the yes/no ones (talk, reach, interact) only when the step has several objectives — a lone one
 * is what the step's own text already says.
 */
export function objectiveLines(objectives: readonly Objective[], progress: readonly number[]): ObjectiveLine[] {
  const out: ObjectiveLine[] = [];
  const several = objectives.length > 1;
  objectives.forEach((o, i) => {
    const have = progress[i] ?? 0;
    switch (o.kind) {
      case 'kill': {
        const name = ENEMIES[o.tag]?.name ?? o.tag;
        out.push({ text: `${plural(name, o.count)} ${Math.min(have, o.count)}/${o.count}`, done: have >= o.count });
        return;
      }
      case 'collect': {
        const name = ITEMS[o.item]?.name ?? o.item;
        out.push({ text: `${o.count > 1 ? plural(name, o.count) : name} ${Math.min(have, o.count)}/${o.count}`, done: have >= o.count });
        return;
      }
      case 'talk':
        if (several) out.push({ text: `Talk to ${NPCS[o.npc]?.name ?? o.npc}`, done: have >= 1 });
        return;
      case 'reach':
        if (several) out.push({ text: `Reach ${humanize(o.trigger)}`, done: have >= 1 });
        return;
      case 'interact':
        if (several) out.push({ text: `Use ${humanize(o.object)}`, done: have >= 1 });
        return;
    }
  });
  return out;
}

/** `training_yard` → "the training yard": ids without a display name, said plainly. */
export function humanize(id: string): string {
  return `the ${id.replace(/_/g, ' ')}`;
}

export interface QuestLine {
  id: string;
  title: string;
  kind: QuestDef['kind'];
  status: QuestState['status'];
  /** The current step's text (the last step's on a complete quest), or ''. */
  step: string;
  lines: ObjectiveLine[];
  /** The current step's compass target, if any. */
  marker: string | null;
}

/** A quest as the tracker and the log show it, or null for an unknown id or a quest not yet started. */
export function questLine(id: string, state: QuestState | undefined): QuestLine | null {
  const def = QUESTS[id];
  if (!def || !state || state.status === 'locked' || state.status === 'available') return null;
  const done = state.status === 'complete' || state.step >= def.steps.length;
  const step = def.steps[Math.min(state.step, def.steps.length - 1)];
  return {
    id,
    title: def.title,
    kind: def.kind,
    status: done ? 'complete' : state.status,
    step: done ? 'Complete' : (step?.text ?? ''),
    lines: done || !step ? [] : objectiveLines(step.objectives, state.progress),
    marker: done ? null : (step?.marker ?? null),
  };
}

/** The tracked quest (or, with none tracked, the first active one), as the HUD tracker shows it. */
export function trackedQuest(p: Readonly<Progress>): QuestLine | null {
  const ids = p.tracked ? [p.tracked, ...Object.keys(p.quests)] : Object.keys(p.quests);
  for (const id of ids) {
    const q = questLine(id, p.quests[id]);
    if (q && q.status === 'active') return q;
  }
  return null;
}

/** Every started quest for the log: active first (main before side), then complete. */
export function questLog(p: Readonly<Progress>): QuestLine[] {
  const rank = (q: QuestLine) => (q.status === 'active' ? 0 : 2) + (q.kind === 'main' ? 0 : 1);
  return Object.keys(p.quests)
    .map((id) => questLine(id, p.quests[id]))
    .filter((q): q is QuestLine => q !== null)
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

// --- Compass (plan §5: the tracked objective drives a compass-bar marker) ---------------------

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  let r = ((a % t) + t) % t;
  if (r > Math.PI) r -= t;
  return r;
}

/**
 * Compass headings, clockwise from north as the player sees them. North is +z (the training yard
 * is "north of the Elder" at higher z). The camera's yaw faces (sin yaw, cos yaw) and turning right
 * lowers yaw, so 90° clockwise of north — east — is −x on screen. (The plan's §6.1 area chart
 * draws x growing east, which is this world seen in a mirror; the compass follows what the player
 * sees, so turning right always sweeps N → E → S → W.)
 */
export const CARDINALS = [
  { label: 'N', heading: 0 },
  { label: 'NE', heading: Math.PI / 4 },
  { label: 'E', heading: Math.PI / 2 },
  { label: 'SE', heading: (3 * Math.PI) / 4 },
  { label: 'S', heading: Math.PI },
  { label: 'SW', heading: (-3 * Math.PI) / 4 },
  { label: 'W', heading: -Math.PI / 2 },
  { label: 'NW', heading: -Math.PI / 4 },
] as const;

/** The compass heading (clockwise from north) the camera faces. */
export const cameraHeading = (camYaw: number): number => wrapAngle(-camYaw);

/** The compass heading from `from` to `to` (world x/z). */
export const headingTo = (from: { x: number; z: number }, to: { x: number; z: number }): number => wrapAngle(-Math.atan2(to.x - from.x, to.z - from.z));

/** Where a heading sits on the bar: radians right (+) or left (−) of straight ahead, in (-π, π]. */
export const compassOffset = (camYaw: number, heading: number): number => wrapAngle(heading - cameraHeading(camYaw));

// --- Prompts, level-ups, the shop ---------------------------------------------------------------

/** The verb on the interact prompt ("[F] Talk to Elder Pepe"). */
export function interactLabel(kind: 'npc' | 'shrine' | 'chest', name: string): string {
  switch (kind) {
    case 'npc':
      return `Talk to ${name}`;
    case 'shrine':
      return `Rest at ${name}`;
    case 'chest':
      return `Open ${name}`;
  }
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** What one rank of a skill gives (SKILL_EFFECT), for the Skills tab. */
export function skillGain(skill: SkillId): string {
  switch (skill) {
    case 'spellPower':
      return `+${pct(SKILL_EFFECT.spellPower)} spell damage`;
    case 'protection':
      return `+${pct(SKILL_EFFECT.protection)} protection spells (Frost Nova's push)`;
    case 'focus':
      return `+${SKILL_EFFECT.focusMana} mana, +${pct(SKILL_EFFECT.focusRegen)} mana regen`;
    case 'attack':
      return `+${pct(SKILL_EFFECT.attack)} melee damage`;
    case 'defense':
      return `+${SKILL_EFFECT.defense} defense, +${SKILL_EFFECT.defenseHp} health`;
    case 'stamina':
      return `+${SKILL_EFFECT.staminaMax} stamina`;
  }
}

/** "Ready in 3 s" for a cooldown in ticks (rounded up), or "Ready". */
export function readyText(ticks: number): string {
  return ticks > 0 ? `Ready in ${Math.ceil(ticks / TICK_HZ)} s` : 'Ready';
}

/** The swap rule in one line, for the Powers tab. */
export const SWAP_RULE = `A power you swap in starts on cooldown (at least ${SWAP_MIN_COOLDOWN / TICK_HZ} s). Swaps at a shrine are free.`;

/** The cooldown a power would get if swapped in now (the sim's rule, shown before you pick it). */
export function swapCooldown(spell: SpellId, remaining: number, atShrine: boolean): number {
  return atShrine ? remaining : Math.max(remaining, Math.max(SPELLS[spell].cooldown, SWAP_MIN_COOLDOWN));
}

export interface GearDelta {
  label: string;
  /** Candidate minus equipped. */
  delta: number;
  /** Shown as "+2" or "×1.35". */
  text: string;
}

/** A side-by-side compare of a staff or robe against the one worn: each stat's change (green up, red down). */
export function gearCompare(item: ItemDef, worn: ItemDef | undefined): GearDelta[] {
  const sign = (d: number, digits = 0) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(digits)}`;
  if (item.staff) {
    const w = worn?.staff ?? { damage: 0, spellPower: 0 };
    const dd = item.staff.damage - w.damage;
    const ds = Math.round((item.staff.spellPower - w.spellPower) * 100) / 100;
    return [
      { label: 'Damage', delta: dd, text: sign(dd) },
      { label: 'Spell power', delta: ds, text: sign(ds, 2) },
    ];
  }
  if (item.robe) {
    const w = worn?.robe ?? { physical: 0, arcane: 0 };
    const dp = item.robe.physical - w.physical, da = item.robe.arcane - w.arcane;
    return [
      { label: 'Physical', delta: dp, text: sign(dp) },
      { label: 'Arcane', delta: da, text: sign(da) },
    ];
  }
  return [];
}

export interface StockLine {
  item: ItemDef;
  price: number;
  /** How many the merchant still has. */
  left: number;
}

/**
 * The merchant's stock as the shop shows it: MERCHANTS' counts less what the world flags say was
 * bought (`bought:<merchant>:<item>`), and the item's price.
 */
export function shopStock(merchant: string, flags: Readonly<Record<string, number>>): StockLine[] {
  const m = MERCHANTS[merchant];
  if (!m) return [];
  return Object.entries(m.stock)
    .map(([id, count]) => ({ item: ITEMS[id], price: ITEMS[id]?.price ?? 0, left: Math.max(0, count - (flags[`bought:${merchant}:${id}`] ?? 0)) }))
    .filter((l) => !!l.item);
}

export const KIND_NAMES: Record<ItemKind, string> = { staff: 'Staffs', robe: 'Robes', charm: 'Charms', consumable: 'Consumables', quest: 'Quest items' };
const KIND_ORDER: readonly ItemKind[] = ['staff', 'robe', 'charm', 'consumable', 'quest'];

/** Owned items by category (equipped gear counts as owned even if the inventory doesn't list it). */
export function inventoryGroups(p: Readonly<Progress>): { kind: ItemKind; items: { item: ItemDef; count: number; equipped: boolean }[] }[] {
  const counts = new Map<string, number>();
  for (const [id, n] of Object.entries(p.inventory)) if (n > 0) counts.set(id, n);
  for (const id of [p.equipment.staff, p.equipment.robe, p.equipment.charm]) if (id && !counts.has(id)) counts.set(id, 1);
  const equipped = new Set([p.equipment.staff, p.equipment.robe, p.equipment.charm]);
  return KIND_ORDER.map((kind) => ({
    kind,
    items: [...counts]
      .map(([id, count]) => ({ item: ITEMS[id], count, equipped: equipped.has(id) }))
      .filter((x) => x.item?.kind === kind)
      .sort((a, b) => a.item.name.localeCompare(b.item.name)),
  })).filter((g) => g.items.length > 0);
}

/** One line of an item's numbers for the inventory and the shop. */
export function itemStats(item: ItemDef): string {
  if (item.staff) return `Damage ${item.staff.damage} · Spell power ×${item.staff.spellPower.toFixed(2)}`;
  if (item.robe) return `Defense ${item.robe.physical} physical · ${item.robe.arcane} arcane`;
  return '';
}
