/**
 * Drop tables (plan §5, rng stream `loot`): Sprouts always, a heart 15% of the time, then items from
 * a short list. Chests have fixed contents. The merchant's stock.
 */
import { C4_DROPS, C4_EXTRA_DROPS, C4_STOCK, C4_STOCK_AFTER } from './packs/c4';

export interface DropTable {
  sprouts: [number, number];
  heartChance: number;
  items?: { item: string; chance: number; /** `spell`: only a spell's kill. `stagger`: only a kill while staggered. */ when?: 'spell' | 'stagger' }[];
}

export const DROPS: Record<string, DropTable> = {
  grunt: { sprouts: [3, 6], heartChance: 0.15 },
  slinger: { sprouts: [5, 9], heartChance: 0.15, items: [{ item: 'charm_spark_catcher', chance: 0.03 }] },
  wisp: { sprouts: [5, 9], heartChance: 0.15, items: [{ item: 'charm_iron_root', chance: 0.03 }] },
  brute: { sprouts: [15, 25], heartChance: 0.3, items: [{ item: 'robe_thornweave', chance: 0.1 }] },
  dummy_straw: { sprouts: [1, 2], heartChance: 0 },
  // M4: the Orchard Grunts carry Farmer Broccoli's pumpkins (S1: 60%, plan §6.3).
  // Pumpkins sit on the carriers' heads and fall off when they're struck (encounters.ts), not as a roll.
  grunt_orchard: { sprouts: [3, 6], heartChance: 0.15 },
  grunt_vet: { sprouts: [6, 10], heartChance: 0.2 },
  big_coin: { sprouts: [40, 60], heartChance: 1, items: [{ item: 'charm_spark_catcher', chance: 0.5 }] },
  gatekeeper: { sprouts: [80, 120], heartChance: 1 },
};

Object.assign(DROPS, C4_DROPS);
for (const [id, items] of Object.entries(C4_EXTRA_DROPS)) (DROPS[id].items ??= []).push(...items);

/**
 * `onKill` reads `DROPS[def.id]` and nothing else, so a variant does not inherit by id. Each cave
 * enemy gets a copy of the table its base drops in the game, including extras already pushed on
 * (a Hex Wisp's Thorn Seed). The copy is taken once, here, after those extras.
 */
function inheritDrop(id: string, base: string): void {
  const src = DROPS[base];
  DROPS[id] = {
    sprouts: [src.sprouts[0], src.sprouts[1]],
    heartChance: src.heartChance,
    ...(src.items ? { items: src.items.map((it) => ({ ...it })) } : {}),
  };
}
inheritDrop('rd_grunt', 'grunt_vet');
inheritDrop('rd_slinger', 'slinger');
inheritDrop('rd_wisp', 'wisp');
inheritDrop('rd_brute', 'brute');
inheritDrop('rootdeep_digger', 'grunt_vet');
inheritDrop('deep_warden', 'hollow_giant');

export interface ChestDef {
  id: string;
  items: { item: string; count: number }[];
  sprouts?: number;
}

export interface MerchantDef {
  id: string;
  /** Item → how many the merchant has (each bought once at most when 1). */
  stock: Record<string, number>;
  /** Stock that is only on sale once this world flag is set (item → flag). */
  after?: Record<string, string>;
}

export const MERCHANTS: Record<string, MerchantDef> = {
  merchant_village: { id: 'merchant_village', stock: { staff_nobu: 1, charm_quick_step: 1, charm_second_wind: 1, tonic_upgrade: 1, waystone: 1 } },
};

Object.assign(MERCHANTS.merchant_village.stock, C4_STOCK);
MERCHANTS.merchant_village.after = { ...MERCHANTS.merchant_village.after, ...C4_STOCK_AFTER };
