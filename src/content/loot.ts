/**
 * Drop tables (plan §5, rng stream `loot`): Sprouts always, a heart 15% of the time, then items from
 * a short list. Chests have fixed contents. The merchant's stock.
 */
export interface DropTable {
  sprouts: [number, number];
  heartChance: number;
  items?: { item: string; chance: number }[];
}

export const DROPS: Record<string, DropTable> = {
  grunt: { sprouts: [3, 6], heartChance: 0.15 },
  slinger: { sprouts: [5, 9], heartChance: 0.15, items: [{ item: 'charm_spark_catcher', chance: 0.03 }] },
  wisp: { sprouts: [5, 9], heartChance: 0.15, items: [{ item: 'charm_iron_root', chance: 0.03 }] },
  brute: { sprouts: [15, 25], heartChance: 0.3, items: [{ item: 'robe_thornweave', chance: 0.1 }] },
  dummy_straw: { sprouts: [1, 2], heartChance: 0 },
  // M4: the Orchard Grunts carry Farmer Broccoli's pumpkins (S1: 60%, plan §6.3).
  grunt_orchard: { sprouts: [3, 6], heartChance: 0.15, items: [{ item: 'stolen_pumpkin', chance: 0.6 }] },
  grunt_vet: { sprouts: [6, 10], heartChance: 0.2 },
  big_coin: { sprouts: [40, 60], heartChance: 1, items: [{ item: 'charm_spark_catcher', chance: 0.5 }] },
  gatekeeper: { sprouts: [80, 120], heartChance: 1, items: [{ item: 'robe_quarryproof', chance: 1 }] },
};

export interface ChestDef {
  id: string;
  items: { item: string; count: number }[];
  sprouts?: number;
}

export interface MerchantDef {
  id: string;
  /** Item → how many the merchant has (each bought once at most when 1). */
  stock: Record<string, number>;
}

export const MERCHANTS: Record<string, MerchantDef> = {
  merchant_village: { id: 'merchant_village', stock: { staff_nobu: 1, charm_quick_step: 1, charm_second_wind: 1, tonic_upgrade: 1 } },
};
