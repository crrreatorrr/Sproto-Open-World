import { C4_NPCS } from './packs/c4';
import { C5_NPCS } from './packs/c5';
import { WEAPON_BOX_SHOPS } from './packs/overworldMix';

/** NPCs (plan §6): who they are, how they look, what they say. */
export interface NpcDef {
  id: string;
  name: string;
  /** View model key (`src/assets/manifest.ts`). */
  model: string;
  dialogue: string;
  merchant?: string;
  body: { radius: number; height: number };
}

const BODY = { radius: 0.4, height: 1.8 };

export const NPCS: Record<string, NpcDef> = {
  elder_pepe: { id: 'elder_pepe', name: 'Elder Pepe', model: 'npc_elder', dialogue: 'elder_pepe', body: BODY },
  merchant_village: { id: 'merchant_village', name: 'Trader Pepe', model: 'npc_trader', dialogue: 'merchant_village', merchant: 'merchant_village', body: BODY },
  captain_agent: { id: 'captain_agent', name: 'Captain Agent', model: 'npc_captain', dialogue: 'captain_agent', body: BODY },
  farmer_broccoli: { id: 'farmer_broccoli', name: 'Farmer Broccoli', model: 'npc_farmer', dialogue: 'farmer_broccoli', body: BODY },
  miller_pepe: { id: 'miller_pepe', name: 'Miller Pepe', model: 'npc_miller', dialogue: 'miller_pepe', body: BODY },
  collector_pepe: { id: 'collector_pepe', name: 'Collector Pepe', model: 'npc_collector', dialogue: 'collector_pepe', body: BODY },
};

Object.assign(NPCS, C4_NPCS);
Object.assign(NPCS, C5_NPCS);
for (const b of WEAPON_BOX_SHOPS) {
  NPCS[b.id] = { id: b.id, name: b.name, model: 'npc_trader', dialogue: b.id, merchant: b.id, body: BODY };
}
