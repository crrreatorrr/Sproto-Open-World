/**
 * Levels and the skill tree (expansion plan §7). Fixed growth each level, plus 2 skill points per
 * level-up (and 1 per boss) to spend on the Magic and Combat branches anywhere. XP curve
 * round(60·L^1.45): the XP to go from level L to L + 1. Level cap 15. Pure.
 */
export type SkillId = 'spellPower' | 'protection' | 'focus' | 'attack' | 'defense' | 'stamina';
export type Branch = 'magic' | 'combat';

export interface SkillDef {
  id: SkillId;
  name: string;
  branch: Branch;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  spellPower: { id: 'spellPower', name: 'Spell Power', branch: 'magic' },
  protection: { id: 'protection', name: 'Protection', branch: 'magic' },
  focus: { id: 'focus', name: 'Focus', branch: 'magic' },
  attack: { id: 'attack', name: 'Attack', branch: 'combat' },
  defense: { id: 'defense', name: 'Defense', branch: 'combat' },
  stamina: { id: 'stamina', name: 'Stamina', branch: 'combat' },
};

export const BRANCHES: Record<Branch, { name: string; skills: readonly SkillId[] }> = {
  magic: { name: 'Magic', skills: ['spellPower', 'protection', 'focus'] },
  combat: { name: 'Combat', skills: ['attack', 'defense', 'stamina'] },
};

export const SKILL_IDS: readonly SkillId[] = [...BRANCHES.magic.skills, ...BRANCHES.combat.skills];

export type SkillRanks = Record<SkillId, number>;

export const noSkills = (): SkillRanks => ({ spellPower: 0, protection: 0, focus: 0, attack: 0, defense: 0, stamina: 0 });

export const LEVEL_CAP = 15;
/** Each rank costs one point; ranks 0–10. */
export const SKILL_MAX_RANK = 10;
export const SKILL_POINTS_PER_LEVEL = 2;
/** Respec at a shrine: this many Sprouts per level. */
export const RESPEC_SPROUTS_PER_LEVEL = 100;

/** XP needed to go from level `level` to the next. */
export const xpToNext = (level: number): number => Math.round(60 * Math.pow(level, 1.45));

/** Total XP needed to reach `level` from level 1. */
export function xpForLevel(level: number): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += xpToNext(l);
  return t;
}

/** Skill points the level-ups up to `level` give (bosses add their own on top). */
export const pointsForLevel = (level: number): number => SKILL_POINTS_PER_LEVEL * (Math.min(level, LEVEL_CAP) - 1);

export const GROWTH = {
  /** Per level above 1 (a player who never spends still grows). */
  hpPerLevel: 12,
  staminaPerLevel: 4,
  manaPerLevel: 4,
} as const;

/** What one rank of each skill gives (plan §7.2; first pass, tuned by the bot balance check). */
export const SKILL_EFFECT = {
  /** Spell damage ×(1 + 0.04 · Spell Power). */
  spellPower: 0.04,
  /** Protection-spell strength ×(1 + 0.08 · Protection): Frost Nova's push today. */
  protection: 0.08,
  focusMana: 5,
  /** Mana regen ×(1 + 0.03 · Focus). */
  focusRegen: 0.03,
  /** Melee damage ×(1 + 0.04 · Attack). */
  attack: 0.04,
  /** +1 defense (both kinds) and +10 max HP per rank. */
  defense: 1,
  defenseHp: 10,
  staminaMax: 5,
} as const;

export type PerkId = 'magic10' | 'magic20' | 'combat10' | 'combat20';

/** Milestone perks: free when a branch's total ranks reach `at`. */
export const PERKS: Record<PerkId, { id: PerkId; branch: Branch; at: number; name: string; text: string }> = {
  magic10: { id: 'magic10', branch: 'magic', at: 10, name: 'Weaver', text: 'Woven casts cost 15% less mana.' },
  magic20: { id: 'magic20', branch: 'magic', at: 20, name: 'Warding', text: 'Protection spells also cleanse one status from you.' },
  combat10: { id: 'combat10', branch: 'combat', at: 10, name: 'Riposte Rush', text: 'A parry restores 5% of your health.' },
  combat20: { id: 'combat20', branch: 'combat', at: 20, name: 'Unshaken', text: "You can't be knocked out of your attacks." },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];

export const PERK_EFFECT = {
  wovenCost: 0.85,
  parryHeal: 0.05,
} as const;

export const branchTotal = (s: Readonly<SkillRanks>, b: Branch): number => BRANCHES[b].skills.reduce((n, k) => n + (s[k] ?? 0), 0);

export const hasPerk = (s: Readonly<SkillRanks> | undefined, perk: PerkId): boolean => !!s && branchTotal(s, PERKS[perk].branch) >= PERKS[perk].at;

export const ranksSpent = (s: Readonly<SkillRanks>): number => SKILL_IDS.reduce((n, k) => n + (s[k] ?? 0), 0);

/** Protection-spell strength multiplier (Frost Nova's push, Mirror Ward, Bramble Wall, Healing Bloom). */
export const protectionMult = (s: Readonly<SkillRanks> | undefined): number => 1 + SKILL_EFFECT.protection * (s?.protection ?? 0);

/** Spells that count as protection spells (Magic 20 cleanses on them). */
export const PROTECTION_SPELLS: readonly string[] = ['frostNova', 'mirrorWard', 'brambleWall', 'healingBloom'];

/**
 * "In combat" for the gear lock (plan §1.1): an enemy targeted you within this many ticks (5 s).
 * Gear changes out of combat or at a shrine.
 */
export const GEAR_LOCK_TICKS = 300;
