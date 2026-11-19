/**
 * Milestone C2 (expansion plan §2): one trait per staff, its numbers, and the staffs that arrive
 * with the traits. The rules live in sim/combat/staffTraits.ts. Pure data.
 */
import type { ItemDef } from '../items';

export type StaffTraitId = 'emberSwing' | 'blink' | 'shove' | 'moonlit' | 'crusher' | 'chargedBolt' | 'brawler' | 'abduct' | 'sunder';

/** Each trait in words, for the Gear tab. */
export const STAFF_TRAITS: Record<StaffTraitId, { name: string; text: string }> = {
  emberSwing: { name: 'Ember Swing', text: 'The third light hit sets the target burning.' },
  blink: { name: 'Blink', text: 'Sprint + Dodge blinks 6 m, untouchable, every 4 s. A plain dodge still rolls.' },
  shove: { name: 'Shove', text: 'Heavy attacks and Bolts knock light enemies back 1.5 m.' },
  moonlit: { name: 'Moonlit', text: 'Spells cost 15% less mana.' },
  crusher: { name: 'Crusher', text: '+25% poise damage. A heavy attack that breaks poise stuns 0.5 s longer.' },
  chargedBolt: { name: 'Charged Bolt', text: 'Hold the Bolt button to charge: up to ×3 damage for ×2 mana.' },
  brawler: { name: 'Brawler', text: 'Light strings get a fourth hit. Spells deal 10% less damage.' },
  abduct: { name: 'Abduct', text: 'Bolt hits lift a light enemy for 1 s. It can\'t act.' },
  sunder: { name: 'Sunder', text: 'A fully charged heavy attack sends a shockwave 8 m along the ground.' },
};

/** The trait numbers (ticks at 60 Hz). */
export const TRAIT = {
  blink: {
    /** Metres: the longest blink, the shortest worth taking (else it's a roll), and the search step. */
    distance: 6,
    minDistance: 1.5,
    step: 0.5,
    /** How far the landing may rise above or drop below the feet (m). */
    climb: 2.2,
    drop: 3,
    /** Ticks until the next blink, and the ticks of the blink itself (untouchable throughout). */
    cooldown: 240,
    ticks: 14,
  },
  shove: { pushback: 1.5 },
  moonlit: { cost: 0.85 },
  crusher: { poise: 1.25, staggerTicks: 30 },
  chargedBolt: {
    /** Ticks held past the release for a full charge; it fires by itself then. */
    ticks: 60,
    damage: 3,
    mana: 2,
    /** A pulse of light and sound every this many ticks of charge. */
    pulseEvery: 20,
  },
  brawler: { spellDamage: 0.9 },
  abduct: { ticks: 60 },
  /** Metres, metres per second, metres, and the fraction of the sword's melee power. */
  sunder: { range: 8, speed: 16, radius: 1.2, damage: 0.8 },
} as const;

/** Item id → trait. The Sprout Staff has none. */
const TRAIT_OF: Readonly<Record<string, StaffTraitId>> = {
  staff_gourd: 'emberSwing',
  staff_momentum: 'blink',
  staff_nobu: 'shove',
  staff_moonward: 'moonlit',
  staff_fighters_might: 'crusher',
  staff_shooter: 'chargedBolt',
  staff_fighter: 'brawler',
  staff_alien_ray: 'abduct',
  staff_rootcleaver: 'sunder',
};

/** A staff's trait, or null. Saves are outside data: an inherited name like `constructor` is no staff. */
export const staffTrait = (staff: string | undefined): StaffTraitId | null => (staff !== undefined && Object.hasOwn(TRAIT_OF, staff) ? TRAIT_OF[staff] : null);

/** What the staff multiplies spell costs by (Moonlit). */
export const staffCostMult = (staff: string | undefined): number => (staffTrait(staff) === 'moonlit' ? TRAIT.moonlit.cost : 1);

/** What the staff multiplies spell damage by (Brawler). */
export const staffSpellMult = (staff: string | undefined): number => (staffTrait(staff) === 'brawler' ? TRAIT.brawler.spellDamage : 1);

/**
 * The staffs C2 adds. Quests A3 and A6 give the Shooter and the Fighter. Alien Ray is held for area
 * 2: nothing places it and its model isn't imported yet (the app shows the Sprout Staff for it).
 */
export const C2_ITEMS: Record<string, ItemDef> = {
  staff_shooter: { id: 'staff_shooter', name: 'Shooter', kind: 'staff', rarity: 'epic', blurb: 'Patient. Then very loud.', staff: { damage: 21, spellPower: 1.05, model: 'staff_shooter' } },
  staff_fighter: { id: 'staff_fighter', name: 'Fighter', kind: 'staff', rarity: 'epic', blurb: 'Made for people who stay close.', staff: { damage: 28, spellPower: 0.95, model: 'staff_fighter' } },
  staff_alien_ray: { id: 'staff_alien_ray', name: 'Alien Ray', kind: 'staff', rarity: 'epic', blurb: 'Nobody remembers making it.', staff: { damage: 24, spellPower: 1.2, model: 'staff_alien_ray' } },
};
