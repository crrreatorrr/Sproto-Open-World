/** NPCs (plan §6): who they are, how they look, what they say. */
export interface NpcDef {
  id: string;
  name: string;
  /** View model key (placeholder until M4 brings the Pepe models). */
  model: string;
  dialogue: string;
  merchant?: string;
  body: { radius: number; height: number };
}

export const NPCS: Record<string, NpcDef> = {
  elder_pepe: { id: 'elder_pepe', name: 'Elder Pepe', model: 'npc', dialogue: 'elder_pepe', body: { radius: 0.4, height: 1.8 } },
  merchant_village: { id: 'merchant_village', name: 'Trader Pepe', model: 'npc', dialogue: 'merchant_village', merchant: 'merchant_village', body: { radius: 0.4, height: 1.8 } },
};
