/**
 * Levels and the skill tree (expansion plan §7, unification plan §4.1). Fixed growth each level,
 * plus 2 skill points per level-up (and 1 per boss) to spend on the Magic, Combat and Gunslinger
 * branches anywhere. XP curve round(60·L^1.45): the XP to go from level L to L + 1. Level cap 30. Pure.
 */
import type { ClassId } from './classes';

export type SkillId =
  | 'spellPower' | 'protection' | 'focus'
  | 'attack' | 'defense' | 'stamina'
  | 'marksmanship' | 'handling' | 'logistics';
export type Branch = 'magic' | 'combat' | 'gunslinger';

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
  marksmanship: { id: 'marksmanship', name: 'Marksmanship', branch: 'gunslinger' },
  handling: { id: 'handling', name: 'Handling', branch: 'gunslinger' },
  logistics: { id: 'logistics', name: 'Logistics', branch: 'gunslinger' },
};

export const BRANCHES: Record<Branch, { name: string; skills: readonly SkillId[] }> = {
  magic: { name: 'Magic', skills: ['spellPower', 'protection', 'focus'] },
  combat: { name: 'Combat', skills: ['attack', 'defense', 'stamina'] },
  gunslinger: { name: 'Gunslinger', skills: ['marksmanship', 'handling', 'logistics'] },
};

export const BRANCH_IDS: readonly Branch[] = ['magic', 'combat', 'gunslinger'];

export const SKILL_IDS: readonly SkillId[] = [
  ...BRANCHES.magic.skills,
  ...BRANCHES.combat.skills,
  ...BRANCHES.gunslinger.skills,
];

export type SkillRanks = Record<SkillId, number>;

export const noSkills = (): SkillRanks => ({
  spellPower: 0, protection: 0, focus: 0,
  attack: 0, defense: 0, stamina: 0,
  marksmanship: 0, handling: 0, logistics: 0,
});

export const LEVEL_CAP = 30;
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

/** What one rank of each skill gives (plan §7.2, unification plan §4.1). */
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
  /** Gun damage & crit scaling per rank of Marksmanship. */
  marksmanship: 0.04,
  /** Reload / fire rate & recoil control scaling per rank of Handling. */
  handling: 0.04,
  /** Max ammo capacity & pickup scaling per rank of Logistics. */
  logistics: 0.08,
} as const;

export type PerkId = 'magic10' | 'magic20' | 'combat10' | 'combat20' | 'gunslinger10' | 'gunslinger20';
export type PerkTier = 10 | 20;

/** Milestone perks: free when a branch's total ranks reach `at`. */
export const PERKS: Record<PerkId, { id: PerkId; branch: Branch; at: PerkTier; name: string; text: string }> = {
  magic10: { id: 'magic10', branch: 'magic', at: 10, name: 'Weaver', text: 'Woven casts cost 15% less mana.' },
  magic20: { id: 'magic20', branch: 'magic', at: 20, name: 'Warding', text: 'Protection spells also cleanse one status from you.' },
  combat10: { id: 'combat10', branch: 'combat', at: 10, name: 'Riposte Rush', text: 'A parry restores 5% of your health.' },
  combat20: { id: 'combat20', branch: 'combat', at: 20, name: 'Unshaken', text: "You can't be knocked out of your attacks." },
  gunslinger10: { id: 'gunslinger10', branch: 'gunslinger', at: 10, name: 'Quickdraw', text: 'Swapping guns auto-reloads stowed guns and boosts fire rate.' },
  gunslinger20: { id: 'gunslinger20', branch: 'gunslinger', at: 20, name: 'Deadeye', text: 'Weak-spot hits refund ammo and stack crit chance.' },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];

export const PERK_EFFECT = {
  wovenCost: 0.85,
  parryHeal: 0.05,
} as const;

export interface ClassSkillDef extends SkillDef {
  /** True when this node is the class's signature skill replacement. */
  signature: boolean;
  text: string;
}

export interface ClassPerkDef {
  id: PerkId;
  classId: ClassId;
  branch: Branch;
  at: PerkTier;
  name: string;
  text: string;
}

const DEFAULT_SKILL_TEXT: Record<SkillId, string> = {
  spellPower: '+4% spell damage per rank.',
  protection: '+8% protection spell strength per rank.',
  focus: '+5 max mana and +3% mana regen per rank.',
  attack: '+4% melee damage per rank.',
  defense: '+1 physical & arcane defense and +10 max HP per rank.',
  stamina: '+5 max stamina per rank.',
  marksmanship: '+4% gun damage and crit chance per rank.',
  handling: '+4% reload/fire rate and -4% recoil/spread per rank.',
  logistics: '+8% max ammo capacity and ammo pickups per rank.',
};

const SIGNATURE_SKILLS: Record<ClassId, { skill: SkillId; name: string; text: string }> = {
  wizard: {
    skill: 'protection',
    name: 'Arcane Surge',
    text: '+6% spell crit & elemental proc potency (scales both spells and elemental guns) plus protection strength.',
  },
  soldier: {
    skill: 'handling',
    name: 'Tactical Handling',
    text: '+4% reload/fire rate, -4% recoil/spread, and boosts Dual-Wield accuracy & fire rate.',
  },
  pepe_warrior: {
    skill: 'attack',
    name: "Warlord's Might",
    text: '+5% melee damage, +6% poise/stagger damage, and boosts plunge, guard-counter & riposte multipliers.',
  },
  pepe: {
    skill: 'stamina',
    name: 'Trickster Tempo',
    text: '+5 max stamina, faster stamina regen, and -3% Slide/Dash/Grapple cooldown per rank.',
  },
};

const CLASS_PERKS: Record<ClassId, Record<Branch, Record<PerkTier, { name: string; text: string }>>> = {
  wizard: {
    magic: {
      10: { name: 'Weaver', text: 'Woven casts cost 15% less mana & cast 25% faster (triggered by melee hits or gun crits).' },
      20: { name: "Archmage's Ward", text: 'Protection spells cleanse 1 status + grant a brief shield; elemental gun procs echo a mini Arcane Bolt.' },
    },
    combat: {
      10: { name: 'Spellblade', text: 'Melee hits refund 8% max mana.' },
      20: { name: 'Aegis Parry', text: 'Parrying triggers a free Frost/Arcane shockwave.' },
    },
    gunslinger: {
      10: { name: 'Runic Rounds', text: 'Gun elemental proc chance +15% and gun hits refresh Burn/Shock/Chill.' },
      20: { name: 'Mana-Fed Mag', text: 'Reloading spends a sliver of mana to empower the first 3 shots with bonus arcane damage.' },
    },
  },
  soldier: {
    magic: {
      10: { name: 'Ordnance Caster', text: "Spells inherit 25% of your active gun's crit chance & element." },
      20: { name: 'Suppressive Barrage', text: "Casting a spell immediately refills 30% of your active gun's magazine." },
    },
    combat: {
      10: { name: 'CQC Specialist', text: 'Quick gun-butt melee & staff heavies deal +35% poise damage and stagger.' },
      20: { name: 'Unshaken', text: 'Uninterruptible during attacks and reloads; +15% damage resistance while sliding/dashing.' },
    },
    gunslinger: {
      10: { name: 'Quickdraw', text: 'Swapping guns auto-reloads your stowed gun after 3 s and grants +15% fire rate for 2 s.' },
      20: { name: 'Deadeye', text: 'Weak-spot hits refund 1 round to the mag and stack +20% crit chance for 3 s (up to 3×).' },
    },
  },
  pepe_warrior: {
    magic: {
      10: { name: 'War-Cast', text: 'Casting a spell right after a melee hit or block deals bonus poise damage and knocks back nearby foes.' },
      20: { name: 'Battle Ward', text: 'Protection/close-range spells grant brief super-armor and reflect 20% melee damage.' },
    },
    combat: {
      10: { name: 'Riposte Rush', text: 'Parrying or guard-countering heals 6% HP and empowers your next attack (+35% damage).' },
      20: { name: 'Unstoppable Juggernaut', text: 'Uninterruptible during heavy/charged melee attacks & plunges; melee kills grant brief damage reduction.' },
    },
    gunslinger: {
      10: { name: 'Point-Blank Breacher', text: 'Gunshots within 8 m deal +25% damage and heavy stagger.' },
      20: { name: 'Bayonet Momentum', text: 'A melee kill immediately reloads your active gun and boosts its next 2 shots (+20% damage & knockback).' },
    },
  },
  pepe: {
    magic: {
      10: { name: 'Chaos Weave', text: 'Weaving a spell after either a melee hit or gunshot trims 1 s off your other spell cooldowns.' },
      20: { name: 'Wild Surge', text: 'Every 4th spell cast is free and applies a random Burn/Shock/Chill status.' },
    },
    combat: {
      10: { name: 'Evasive Counter', text: 'Perfect-dodging or parrying restores 5% HP and guarantees your next gunshot or spell crits.' },
      20: { name: 'Freestyle Finisher', text: 'Killing an enemy with a different weapon type than your previous hit bursts bonus Sprouts, ammo, and stamina.' },
    },
    gunslinger: {
      10: { name: 'Akimbo Ace', text: 'Dual-wielding sidearms gains +20% fire rate, tighter spread, and faster dual reloads.' },
      20: { name: 'Wacky Overdrive', text: 'Legendary gun wacky perks trigger 50% more often; non-legendary guns gain a random mini-proc on crit.' },
    },
  },
};

const normClass = (cls: ClassId | undefined): ClassId => cls ?? 'wizard';

/** Resolve a skill's display name and description for a given class (applying its signature skill). */
export function classSkillDef(cls: ClassId | undefined, skillId: SkillId): ClassSkillDef {
  const c = normClass(cls);
  const base = SKILLS[skillId];
  const sig = SIGNATURE_SKILLS[c];
  if (sig.skill === skillId) return { ...base, name: sig.name, signature: true, text: sig.text };
  return { ...base, signature: false, text: DEFAULT_SKILL_TEXT[skillId] };
}

/** Resolve a branch milestone perk (tier 10 or 20) for a given class (24 class-tailored perks). */
export function classPerkDef(cls: ClassId | undefined, branch: Branch, tier: PerkTier): ClassPerkDef {
  const c = normClass(cls);
  const id = `${branch}${tier}` as PerkId;
  const entry = CLASS_PERKS[c][branch][tier];
  return { id, classId: c, branch, at: tier, name: entry.name, text: entry.text };
}

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
