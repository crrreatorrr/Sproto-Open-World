/**
 * What lives in Sproutvale for M3: the village NPCs, the first shrine, the training yard (a trigger,
 * straw dummies and a chest). Camps, the other shrines' content and the main chain arrive in M4.
 * Positions are world metres on the village plateau (y 13.5); the shrines use the baked marks.
 */
import type { ChestDef } from '../loot';

export interface Placement {
  id: string;
  pos: [number, number, number];
  yaw: number;
}

export interface RegionContent {
  npcs: (Placement & { npc: string })[];
  shrines: Placement[];
  chests: (Placement & { chest: ChestDef })[];
  enemies: (Placement & { def: string })[];
  triggers: { id: string; pos: [number, number, number]; radius: number }[];
}

export const SPROUTVALE_CONTENT: RegionContent = {
  npcs: [
    { id: 'elder_pepe', npc: 'elder_pepe', pos: [262, 13.5, 68], yaw: Math.PI },
    { id: 'merchant_village', npc: 'merchant_village', pos: [246, 13.5, 74], yaw: Math.PI * 0.8 },
  ],
  shrines: [
    { id: 'shrine_first_light', pos: [240, 13.5, 62], yaw: 0.7854 },
    { id: 'shrine_watchtower', pos: [252, 31.01, 240], yaw: 3.1416 },
    { id: 'shrine_quarry_gate', pos: [318, 10.27, 390], yaw: 1.2217 },
  ],
  chests: [{ id: 'chest_training', pos: [270, 13.5, 92], yaw: Math.PI, chest: { id: 'chest_training', items: [{ item: 'sprout_seed', count: 1 }], sprouts: 10 } }],
  enemies: [
    { id: 'straw_1', def: 'dummy_straw', pos: [252, 13.5, 96], yaw: Math.PI },
    { id: 'straw_2', def: 'dummy_straw', pos: [256, 13.5, 98], yaw: Math.PI },
    { id: 'straw_3', def: 'dummy_straw', pos: [260, 13.5, 96], yaw: Math.PI },
  ],
  triggers: [{ id: 'training_yard', pos: [256, 13.5, 92], radius: 7 }],
};
