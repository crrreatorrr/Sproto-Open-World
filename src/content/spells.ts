/**
 * The four starter spells (plan §4.4). Pure data. Damage = SPELL_BASE × staff.spellPower × mv
 * (× the §4.6 multipliers). Release and cooldown in 60 Hz ticks; woven casts (within
 * WOVEN.window ticks of landing a melee hit) release in half the time and hit 20% harder.
 */
import type { StatusId } from './statuses';

export type SpellId = 'bolt' | 'blast' | 'frostNova' | 'chainZap';

export interface SpellDef {
  id: SpellId;
  name: string;
  /** Home slot 1–4: where it's equipped when learned, if free. The loadout decides what casts. */
  slot: 1 | 2 | 3 | 4;
  cost: number;
  release: number;
  wovenRelease: number;
  /** Ticks after release before it can be cast again. */
  cooldown: number;
  mv: number;
  /** Upper-body clip, scrubbed so the release lands on the release tick. */
  clip: 'cast' | 'cast_big';
  /** Ticks after release until the caster is free again. */
  recovery: number;
  status?: { id: StatusId; stacks: number };
  projectile?: { speed: number; radius: number; range: number; explodeRadius?: number };
  /** Frost Nova: a ring around the caster. */
  nova?: { radius: number; push: number };
  /** Chain Zap: first target within `range`, then up to `jumps` more within `jumpRange`, each ×`falloff`. */
  chain?: { range: number; jumps: number; jumpRange: number; falloff: number };
  /** Knocks down non-elite enemies it hits. */
  knockdown?: boolean;
  /** Interrupts a ranged enemy's wind-up. */
  interruptsRanged?: boolean;
  poise: number;
}

/** Spell power before the staff and MV (the starter staff's melee damage, so the two tools match). */
export const SPELL_BASE = 20;

export const WOVEN = {
  /** A spell cast within this many ticks of a landed melee hit is woven. */
  window: 30,
  damage: 1.2,
} as const;

/** Spells can cancel a light attack's recovery from its activeEnd, never a heavy's (plan §4.4). */
export const SPELL_CANCELS_LIGHTS = true;

/** Moving while casting: speed multiplier (spells are upper body only). */
export const CAST_WALK_SCALE = 0.6;

export const SPELLS: Record<SpellId, SpellDef> = {
  bolt: {
    id: 'bolt', name: 'Arcane Bolt', slot: 1, cost: 6, release: 10, wovenRelease: 5, cooldown: 8, mv: 0.6, clip: 'cast', recovery: 8,
    projectile: { speed: 40, radius: 0.22, range: 30 }, interruptsRanged: true, poise: 6,
  },
  blast: {
    id: 'blast', name: 'Blast', slot: 2, cost: 30, release: 24, wovenRelease: 12, cooldown: 180, mv: 2.0, clip: 'cast_big', recovery: 14,
    projectile: { speed: 14, radius: 0.35, range: 25, explodeRadius: 3.5 }, knockdown: true, status: { id: 'burn', stacks: 1 }, poise: 30,
  },
  frostNova: {
    id: 'frostNova', name: 'Frost Nova', slot: 3, cost: 25, release: 14, wovenRelease: 7, cooldown: 480, mv: 0.8, clip: 'cast_big', recovery: 12,
    nova: { radius: 5, push: 2 }, status: { id: 'chill', stacks: 2 }, poise: 15,
  },
  chainZap: {
    id: 'chainZap', name: 'Chain Zap', slot: 4, cost: 35, release: 18, wovenRelease: 9, cooldown: 360, mv: 1.0, clip: 'cast', recovery: 10,
    chain: { range: 15, jumps: 3, jumpRange: 8, falloff: 0.7 }, status: { id: 'shock', stacks: 1 }, poise: 12,
  },
};

/** Each spell's home slot: where a newly learned spell goes when that slot is free (and the v2 save layout). */
export const SPELL_BY_SLOT: Record<1 | 2 | 3 | 4, SpellId> = { 1: 'bolt', 2: 'blast', 3: 'frostNova', 4: 'chainZap' };

/** The loadout (expansion plan §1.1): four slots you fill from the spells you know. */
export const LOADOUT_SLOTS = 4;
export type Loadout = (SpellId | null)[];

/** A power swapped into the loadout waits max(remaining, max(full cooldown, this)) ticks: at least 3 s. */
export const SWAP_MIN_COOLDOWN = 180;

/** The default loadout for a set of known spells: each in its home slot. */
export const defaultLoadout = (known: readonly SpellId[]): Loadout => ([1, 2, 3, 4] as const).map((n) => (known.includes(SPELL_BY_SLOT[n]) ? SPELL_BY_SLOT[n] : null));
