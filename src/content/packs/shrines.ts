/**
 * The wider shrine network: shrines across every overworld region and two more in the Rootdeep, on
 * top of Sproutvale's first three and the cave's two (those stay in their own files, with the
 * tests that count them). Each is a rest, a respawn point and a Brick Phone destination.
 *
 * Every spot was checked against the baked terrain: level ground, clear of props and water, and
 * well away from any camp. `tests/content/shrines.test.ts` keeps that true. The y here is the
 * baked ground height; a streamed world settles each shrine onto the terrain anyway.
 *
 * Pure content module: no three.js, DOM, Math.random, timers, or Rapier.
 */
import { DUNGEON_LIST } from '../dungeons/catalog';
import type { Placement } from '../world/sproutvaleContent';
import { RD_X } from './rootdeep';

export interface ShrineDef {
  id: string;
  name: string;
  pos: [number, number, number];
}

export const EXTRA_SHRINES: readonly ShrineDef[] = [
  // Sproutvale: the orchard, the mill stream, the wood and the beanstalk.
  { id: 'shrine_orchard', name: 'Orchard Shrine', pos: [100, 9.86, 160] },
  { id: 'shrine_millrun', name: 'Millrun Shrine', pos: [424, 9.88, 176] },
  { id: 'shrine_thornwood', name: 'Thornwood Shrine', pos: [216, 11.18, 354] },
  { id: 'shrine_beanstalk', name: 'Beanstalk Shrine', pos: [90, 9.15, 430] },
  // Bellmere: the plaza, the keep, and the town's edges.
  { id: 'shrine_westgate', name: 'Westgate Shrine', pos: [580, 10.35, 180] },
  { id: 'shrine_bell_plaza', name: 'Bell Plaza Shrine', pos: [756, 14.5, 220] },
  { id: 'shrine_north_gardens', name: 'North Gardens Shrine', pos: [850, 11.02, 374] },
  { id: 'shrine_riverside', name: 'Riverside Shrine', pos: [1060, 9.08, 300] },
  { id: 'shrine_harbour', name: 'Harbour Shrine', pos: [1120, 8.22, 160] },
  { id: 'shrine_citadel_road', name: 'Citadel Road Shrine', pos: [1280, 10.08, 378] },
  { id: 'shrine_southeast_hill', name: 'Southeast Hill Shrine', pos: [1300, 16.09, 90] },
  { id: 'shrine_bellmere_keep', name: 'Keep Shrine', pos: [1432, 40.29, 288] },
  // The Maple Terraces: the three shrine clearings, the garden, and the slopes between.
  { id: 'shrine_maple_gate', name: 'Maple Gate Shrine', pos: [182, 13, 598] },
  { id: 'shrine_meadow', name: 'Meadow Shrine', pos: [413, 13, 710] },
  { id: 'shrine_garden', name: 'Garden Shrine', pos: [252, 25, 889] },
  { id: 'shrine_east_pond', name: 'East Pond Shrine', pos: [414, 33, 1160] },
  { id: 'shrine_lantern_slope', name: 'Lantern Slope Shrine', pos: [223, 36.7, 1182] },
  { id: 'shrine_high_terrace', name: 'High Terrace Shrine', pos: [118, 48, 1365] },
  { id: 'shrine_pine_heights', name: 'Pine Heights Shrine', pos: [298, 41.8, 1450] },
  // The Willowrun: the watermill, the clearings and both banks.
  { id: 'shrine_old_barn', name: 'Old Barn Shrine', pos: [620, 9.48, 628] },
  { id: 'shrine_south_bank', name: 'South Bank Shrine', pos: [1080, 9.82, 700] },
  { id: 'shrine_watermill', name: 'Watermill Shrine', pos: [1143, 9.37, 995] },
  { id: 'shrine_hilltop_clearing', name: 'Hilltop Clearing Shrine', pos: [680, 23.59, 1082] },
  { id: 'shrine_cliffside', name: 'Cliffside Shrine', pos: [1018, 10.76, 1088] },
  { id: 'shrine_east_clearing', name: 'East Clearing Shrine', pos: [1400, 19.58, 1150] },
  { id: 'shrine_pinewatch', name: 'Pinewatch Shrine', pos: [1460, 24.48, 1330] },
  { id: 'shrine_north_bank', name: 'North Bank Shrine', pos: [1120, 13.79, 1390] },
  { id: 'shrine_north_clearing', name: 'North Clearing Shrine', pos: [740, 19.16, 1420] },
  // The Frostspine: the low pass, the tarn, and up to the saddle.
  { id: 'shrine_lowpine', name: 'Lowpine Shrine', pos: [322, 44.43, 1700] },
  { id: 'shrine_south_pines', name: 'South Pines Shrine', pos: [622, 38, 1702] },
  { id: 'shrine_tarnhollow', name: 'Tarnhollow Shrine', pos: [370, 54.23, 1930] },
  { id: 'shrine_west_ridge', name: 'West Ridge Shrine', pos: [162, 112.39, 2012] },
  { id: 'shrine_east_forest', name: 'East Forest Shrine', pos: [646, 91.78, 2064] },
  { id: 'shrine_eyrie', name: 'Eyrie Shrine', pos: [324, 112, 2246] },
  { id: 'shrine_ruined_watch', name: 'Ruined Watch Shrine', pos: [466, 112, 2254] },
  { id: 'shrine_saddle', name: 'Saddle Shrine', pos: [426, 128, 2420] },
  // The Veilfalls: the amphitheatre, the stair, the plateau's pools and glades.
  { id: 'shrine_lowveil', name: 'Lowveil Shrine', pos: [1438, 19.2, 1596] },
  { id: 'shrine_amphitheatre', name: 'Amphitheatre Shrine', pos: [1156, 20, 1658] },
  { id: 'shrine_stair_top', name: 'Stair Top Shrine', pos: [1240, 66.52, 1724] },
  { id: 'shrine_west_slope', name: 'West Slope Shrine', pos: [900, 65.3, 1898] },
  { id: 'shrine_veil_tarn', name: 'Veil Tarn Shrine', pos: [1276, 68.42, 1898] },
  { id: 'shrine_cavern_mouth', name: 'Cavern Mouth Shrine', pos: [1158, 70.84, 1982] },
  { id: 'shrine_east_glade', name: 'East Glade Shrine', pos: [1330, 76.2, 2140] },
  { id: 'shrine_spring', name: 'Spring Shrine', pos: [1186, 87.2, 2322] },
  { id: 'shrine_north_glade', name: 'North Glade Shrine', pos: [1000, 115.93, 2384] },
  // The Rootdeep: two of the corner pockets, beside their chests.
  { id: 'shrine_rootdeep_northeast', name: 'North-East Pocket Shrine', pos: [RD_X + 472, 0, 36] },
  { id: 'shrine_rootdeep_southwest', name: 'South-West Pocket Shrine', pos: [RD_X + 32, 0, 476] },
];

export const EXTRA_SHRINE_PLACEMENTS: Placement[] = EXTRA_SHRINES.map((s) => ({ id: s.id, pos: [s.pos[0], s.pos[1], s.pos[2]], yaw: 0 }));

/** Display names of these shrines and of the ones inside the Campaign Dungeons, by id. */
export const SHRINE_TITLES: Readonly<Record<string, string>> = Object.fromEntries([
  ...EXTRA_SHRINES.map((s) => [s.id, s.name] as const),
  ...DUNGEON_LIST.flatMap((d) => d.shrines.map((s) => [s.id, s.name] as const)),
]);
