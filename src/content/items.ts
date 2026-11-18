/**
 * Items (plan §5): staffs, robes, charms, consumables and quest items, with fixed stats per item
 * (no procedural affixes). Pure data.
 */
export type ItemKind = 'staff' | 'robe' | 'charm' | 'consumable' | 'quest';
export type Rarity = 'common' | 'rare' | 'epic';
export type Slot = 'staff' | 'robe' | 'charm';

export interface CharmEffects {
  /** Dodge stamina cost multiplier. */
  dodgeStamina?: number;
  /** Extra Sprout Tonic charges. */
  tonicCharges?: number;
  /** Extra woven damage bonus (added to WOVEN.damage − 1). */
  wovenBonus?: number;
  /** Defense multiplier (both kinds). */
  defense?: number;
  /** Extra mana per landed melee hit. */
  manaPerHit?: number;
  /** A parry applies Burn to the attacker. */
  burnOnParry?: boolean;
}

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  /** One line for the inventory. */
  blurb: string;
  /** Staff: melee damage and spell power (plan §4.6 table); model key for the view. */
  staff?: { damage: number; spellPower: number; model: string };
  /** Robe: defense and a body tint. */
  robe?: { physical: number; arcane: number; tint: number };
  charm?: CharmEffects;
  /** Sale price at the merchant (Sprouts). */
  price?: number;
  /** Stacks in the inventory (consumables, quest items). */
  stacks?: boolean;
}

export const ITEMS: Record<string, ItemDef> = {
  // Staffs.
  staff_sproto: { id: 'staff_sproto', name: 'Sprout Staff', kind: 'staff', rarity: 'common', blurb: 'Your first staff. Balanced.', staff: { damage: 20, spellPower: 1.0, model: 'staff_sproto' } },
  staff_momentum: { id: 'staff_momentum', name: 'Momentum', kind: 'staff', rarity: 'rare', blurb: 'Quick in the hand.', staff: { damage: 22, spellPower: 0.9, model: 'staff_momentum' } },
  staff_nobu: { id: 'staff_nobu', name: 'Nobu', kind: 'staff', rarity: 'rare', blurb: 'Heavy, honest wood.', staff: { damage: 26, spellPower: 1.0, model: 'staff_nobu' }, price: 120 },
  staff_moonward: { id: 'staff_moonward', name: 'Moonward', kind: 'staff', rarity: 'rare', blurb: 'Hums with spellwork.', staff: { damage: 18, spellPower: 1.35, model: 'staff_moonward' } },
  staff_fighters_might: { id: 'staff_fighters_might', name: "Fighter's Might", kind: 'staff', rarity: 'epic', blurb: 'Scrapjaw\'s bane.', staff: { damage: 32, spellPower: 1.1, model: 'staff_fighters_might' } },
  // Robes (tints of the player's material).
  robe_apprentice: { id: 'robe_apprentice', name: 'Apprentice Robe', kind: 'robe', rarity: 'common', blurb: 'Patched at the elbows.', robe: { physical: 0, arcane: 0, tint: 0x222222 } },
  robe_warden: { id: 'robe_warden', name: 'Warden Robe', kind: 'robe', rarity: 'rare', blurb: 'Watchtower issue.', robe: { physical: 8, arcane: 4, tint: 0x2b4a7a } },
  robe_thornweave: { id: 'robe_thornweave', name: 'Thornweave', kind: 'robe', rarity: 'rare', blurb: 'Woven with briar.', robe: { physical: 12, arcane: 2, tint: 0x3d5a2a } },
  robe_quarryproof: { id: 'robe_quarryproof', name: 'Quarry-proof', kind: 'robe', rarity: 'epic', blurb: 'Dust never settles on it.', robe: { physical: 16, arcane: 10, tint: 0x6b4a2a } },
  // Charms.
  charm_quick_step: { id: 'charm_quick_step', name: 'Quick Step', kind: 'charm', rarity: 'rare', blurb: 'Rolls cost 15% less stamina.', charm: { dodgeStamina: 0.85 }, price: 80 },
  charm_second_wind: { id: 'charm_second_wind', name: 'Second Wind', kind: 'charm', rarity: 'rare', blurb: '+1 Sprout Tonic charge.', charm: { tonicCharges: 1 }, price: 90 },
  charm_scholars_knot: { id: 'charm_scholars_knot', name: "Scholar's Knot", kind: 'charm', rarity: 'epic', blurb: 'Woven spells hit 25% harder.', charm: { wovenBonus: 0.25 } },
  charm_iron_root: { id: 'charm_iron_root', name: 'Iron Root', kind: 'charm', rarity: 'rare', blurb: '+10% defense.', charm: { defense: 1.1 } },
  charm_spark_catcher: { id: 'charm_spark_catcher', name: 'Spark Catcher', kind: 'charm', rarity: 'rare', blurb: '+2 mana per melee hit.', charm: { manaPerHit: 2 } },
  charm_ember_heart: { id: 'charm_ember_heart', name: 'Ember Heart', kind: 'charm', rarity: 'epic', blurb: 'A parry sets the attacker burning.', charm: { burnOnParry: true } },
  // Consumables and quest items.
  tonic_upgrade: { id: 'tonic_upgrade', name: 'Tonic Flask', kind: 'consumable', rarity: 'rare', blurb: '+1 Sprout Tonic charge, for good.', price: 150 },
  heart: { id: 'heart', name: 'Heart', kind: 'consumable', rarity: 'common', blurb: 'A little health.', stacks: true },
  stolen_pumpkin: { id: 'stolen_pumpkin', name: 'Stolen Pumpkin', kind: 'quest', rarity: 'common', blurb: "Farmer Broccoli's.", stacks: true },
  quarry_key: { id: 'quarry_key', name: 'Quarry Key', kind: 'quest', rarity: 'epic', blurb: 'Opens the Quarry Gate.' },
  sprout_seed: { id: 'sprout_seed', name: 'Sprout Seed', kind: 'quest', rarity: 'common', blurb: 'For the Elder.', stacks: true },
};

export const STARTING_GEAR = { staff: 'staff_sproto', robe: 'robe_apprentice', charm: null } as const;

export const TONIC = {
  charges: 3,
  /** Heals this fraction of max HP over `healTicks`, during a drink lock of `lockTicks`. */
  heal: 0.45,
  healTicks: 30,
  lockTicks: 40,
} as const;

/** Inventory cap (plan §5). */
export const INVENTORY_CAP = 40;

/** A heart pickup heals this fraction of max HP. */
export const HEART_HEAL = 0.15;
