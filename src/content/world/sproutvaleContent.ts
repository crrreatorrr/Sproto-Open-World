/**
 * What lives in Sproutvale (plan §6): the villagers, the shrines, chests and quest objects, the
 * training yard, the camps (about 60 enemies, §6.5) and the quest trigger volumes.
 *
 * Positions are world metres. A streamed world sets every placement down on the terrain the tick
 * its cell's colliders exist (`settle`), so the y given here is only a first guess; the village
 * plateau is y 13.5 and the shrines use their baked marks. Every camp, villager, chest and object
 * also has a mark in `world-src/sproutvale/placements.json` that keeps props off it (a content
 * test checks both agree).
 */
import type { ChestDef } from '../loot';
import { C4_WORLD } from '../packs/c4';

export interface Placement {
  id: string;
  pos: [number, number, number];
  yaw: number;
}

/** A camp (plan §6.5): enemies around a centre, sharing a leash; it comes back when you rest. */
export interface CampDef {
  id: string;
  pos: [number, number, number];
  /** Members at an offset (dx, dz) from the centre; `unique` ones never come back once killed. */
  members: { def: string; at: [number, number]; yaw?: number; unique?: string }[];
}

export interface RegionContent {
  npcs: (Placement & { npc: string })[];
  shrines: Placement[];
  chests: (Placement & { chest: ChestDef })[];
  /** One-use quest objects (`content/objects.ts`). */
  objects?: Placement[];
  enemies: (Placement & { def: string })[];
  camps?: CampDef[];
  /** Trigger volumes: a vertical cylinder (only x and z count unless `halfHeight` is given). */
  triggers: { id: string; pos: [number, number, number]; radius: number; halfHeight?: number }[];
}

/** Ground y guesses by zone (the sim settles each placement onto the terrain). */
const V = 13.5;
const G = 12;

/** A ring of `n` members `r` m from the centre, facing out (camps idle facing their surroundings). */
function ring(def: string, n: number, r: number, from = 0): CampDef['members'] {
  return Array.from({ length: n }, (_, i) => {
    const a = from + (i / n) * Math.PI * 2;
    return { def, at: [Math.round(Math.sin(a) * r * 10) / 10, Math.round(Math.cos(a) * r * 10) / 10] as [number, number], yaw: a };
  });
}

export const SPROUTVALE_CONTENT: RegionContent = {
  npcs: [
    { id: 'elder_pepe', npc: 'elder_pepe', pos: [262, V, 68], yaw: Math.PI },
    { id: 'merchant_village', npc: 'merchant_village', pos: [246, V, 74], yaw: Math.PI * 0.8 },
    { id: 'collector_pepe', npc: 'collector_pepe', pos: [278, V, 70], yaw: -Math.PI * 0.6 },
    { id: 'captain_agent', npc: 'captain_agent', pos: [268, V, 84], yaw: -Math.PI * 0.5 },
    { id: 'farmer_broccoli', npc: 'farmer_broccoli', pos: [174, G, 124], yaw: -Math.PI * 0.7 },
    { id: 'miller_pepe', npc: 'miller_pepe', pos: [386, G, 132], yaw: Math.PI * 0.6 },
  ],
  shrines: [
    { id: 'shrine_first_light', pos: [240, V, 62], yaw: 0.7854 },
    { id: 'shrine_watchtower', pos: [252, 31.01, 240], yaw: 3.1416 },
    { id: 'shrine_quarry_gate', pos: [318, 10.27, 390], yaw: 1.2217 },
  ],
  chests: [
    { id: 'chest_training', pos: [270, V, 92], yaw: Math.PI, chest: { id: 'chest_training', items: [{ item: 'sprout_seed', count: 1 }], sprouts: 10 } },
    // Thornwood: the Momentum staff, behind the first Brute patrol (plan §4.6 table).
    { id: 'chest_thornwood', pos: [118, G, 372], yaw: 0, chest: { id: 'chest_thornwood', items: [{ item: 'staff_momentum', count: 1 }], sprouts: 25 } },
    // S3 "Lost Relics": the mill waterfall, the Thornwood root arch, the Beanstalk base.
    { id: 'relic_mill', pos: [420, G, 232], yaw: Math.PI, chest: { id: 'relic_mill', items: [], sprouts: 15 } },
    { id: 'relic_rootarch', pos: [176, G, 360], yaw: 0.5, chest: { id: 'relic_rootarch', items: [], sprouts: 15 } },
    { id: 'relic_beanstalk', pos: [106, G, 400], yaw: -0.6, chest: { id: 'relic_beanstalk', items: [], sprouts: 15 } },
  ],
  objects: [
    { id: 'watchtower_beacon', pos: [256, 32, 270], yaw: 0 },
    { id: 'mill_lever', pos: [436, G, 242], yaw: Math.PI },
    // The Frost Nova tome on the Thornwood path, before the first mixed camp (plan §6.2 M4).
    { id: 'frost_tome', pos: [240, G, 334], yaw: -Math.PI / 2 },
  ],
  enemies: [
    { id: 'straw_1', def: 'dummy_straw', pos: [252, V, 96], yaw: Math.PI },
    { id: 'straw_2', def: 'dummy_straw', pos: [256, V, 98], yaw: Math.PI },
    { id: 'straw_3', def: 'dummy_straw', pos: [260, V, 96], yaw: Math.PI },
    // M3 "Light the Watchtower" starts with a parry drill against a swinging dummy.
    { id: 'swing_1', def: 'dummy_swing', pos: [246, V, 100], yaw: Math.PI * 0.75 },
  ],
  camps: [
    // Orchard Fields: Grunts only (neutral profile), the first real fights (plan §6.4).
    { id: 'orchard_south', pos: [70, G, 100], members: ring('grunt_orchard', 4, 3.5) },
    { id: 'orchard_scarecrow', pos: [150, G, 190], members: ring('grunt_orchard', 5, 4, 0.4) },
    { id: 'orchard_west', pos: [55, G, 215], members: ring('grunt_orchard', 5, 4, 1.1) },
    // Millrun: two Slinger outposts, and Big Coin at the mill (S2).
    { id: 'millrun_west', pos: [380, G, 186], members: [...ring('slinger', 3, 6), ...ring('grunt', 2, 2.5, 0.8)] },
    { id: 'millrun_east', pos: [452, G, 162], members: [...ring('slinger', 3, 6, 0.5), ...ring('grunt', 2, 2.5)] },
    { id: 'mill_yard', pos: [446, G, 236], members: [{ def: 'big_coin', at: [0, 0], yaw: Math.PI, unique: 'big_coin' }, ...ring('slinger', 2, 7, 1.6)] },
    // Watchtower Hill: five Slingers in two tiers around the shrine and beacon.
    {
      id: 'watchtower_squad', pos: [256, 28, 240],
      members: [
        { def: 'slinger', at: [-22, -24], yaw: Math.PI },
        { def: 'slinger', at: [14, -22], yaw: Math.PI },
        { def: 'slinger', at: [-16, 22], yaw: Math.PI },
        { def: 'slinger', at: [20, 8], yaw: Math.PI },
        { def: 'slinger', at: [2, 40], yaw: Math.PI },
      ],
    },
    // Thornwood (plan §6.5): two lone Wisps at the edge, three Brute + Wisp patrols, one Brute with
    // veteran Grunts, two Slinger perches, the Gatekeeper. Spaced so no Active ring holds more than
    // 4 elites (a content test checks it).
    { id: 'thorn_wisp_a', pos: [200, G, 296], members: [{ def: 'wisp', at: [0, 0], yaw: Math.PI }] },
    { id: 'thorn_wisp_b', pos: [340, G, 285], members: [{ def: 'wisp', at: [0, 0], yaw: Math.PI }] },
    { id: 'thorn_patrol_a', pos: [90, G, 330], members: [{ def: 'brute', at: [0, 0] }, ...ring('wisp', 2, 6, 1.2)] },
    { id: 'thorn_patrol_b', pos: [300, G, 330], members: [{ def: 'brute', at: [0, 0] }, ...ring('wisp', 2, 6, 0.3)] },
    { id: 'thorn_patrol_c', pos: [360, G, 380], members: [{ def: 'brute', at: [0, 0] }, ...ring('wisp', 2, 6, 2)] },
    { id: 'thorn_veterans', pos: [140, G, 440], members: [{ def: 'brute', at: [0, 0] }, ...ring('grunt_vet', 2, 3.5, 0.9)] },
    { id: 'thorn_perch_west', pos: [130, G, 280], members: ring('slinger', 2, 4) },
    { id: 'thorn_perch_far', pos: [50, G, 395], members: ring('slinger', 2, 4, 0.7) },
    { id: 'thornwood_clearing', pos: [222, G, 384], members: [{ def: 'gatekeeper', at: [0, 0], yaw: Math.PI, unique: 'gatekeeper' }] },
    // The Quarry Ravine: a Brute and three Grunts on the path below the gate shrine.
    { id: 'quarry_ravine', pos: [300, G, 402], members: [{ def: 'brute', at: [0, 0] }, ...ring('grunt', 3, 4)] },
  ],
  triggers: [
    { id: 'training_yard', pos: [256, V, 92], radius: 7 },
    { id: 'orchard_fields', pos: [130, G, 150], radius: 30 },
    { id: 'watchtower_hill', pos: [256, 28, 250], radius: 24 },
    { id: 'thornwood_clearing', pos: [222, G, 384], radius: 22 },
    { id: 'mill', pos: [436, G, 248], radius: 18 },
  ],
};

/** Add an expansion pack's placements to the region. */
function addContent(into: RegionContent, pack: Partial<RegionContent>): void {
  into.npcs.push(...(pack.npcs ?? []));
  into.chests.push(...(pack.chests ?? []));
  (into.objects ??= []).push(...(pack.objects ?? []));
  (into.camps ??= []).push(...(pack.camps ?? []));
  into.triggers.push(...(pack.triggers ?? []));
}

addContent(SPROUTVALE_CONTENT, C4_WORLD);
