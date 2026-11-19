/**
 * Expansion milestone C4 (expansion plan §3.2, §3.6, §4): the robot elites, the giant variants, the
 * stat affixes, and quests A1, A2, A3, A4, A6 and A7 with their villagers, dialogue, camps and marks.
 *
 * Pure data, and only `import type` from the registries: each shared file (enemies.ts, quests.ts,
 * dialogue.ts, ...) merges its table from here with one line, so this module never takes part in an
 * import cycle.
 *
 * Elite budget (at most 4 elite-tier characters in any 3 × 3 cells): the Orchard holds only the salvage
 * yard's 3 Rivet Gunners, because the Skyfire Drake is the fourth elite in those windows. The other 5
 * stand east of the village and over the river, which is why A3's 8 Gunners can't all be in the Orchard.
 * Colossal counts as elite, so it is only in the pools of camps whose windows have room for one more.
 */
import type { DialogueGraph, DialogueNode } from '../dialogue';
import type { EnemyDef } from '../enemies';
import type { ItemDef } from '../items';
import type { DropTable } from '../loot';
import type { NpcDef } from '../npcs';
import type { ObjectDef } from '../objects';
import type { QuestDef } from '../quests';
import type { SpellId } from '../spells';
import type { RegionContent } from '../world/sproutvaleContent';

/** Spells C3 defines: named here by id, so this pack doesn't depend on the order the two land in. */
const spell = (id: string) => id as SpellId;

// ---------------------------------------------------------------- enemies

export const C4_ENEMIES: Record<string, EnemyDef> = {
  /** A ranged elite: keeps 12–18 m away, bursts, and telegraphs a big shot worth reflecting. */
  rivet_gunner: {
    id: 'rivet_gunner',
    name: 'Rivet Gunner',
    model: 'robot_shooter',
    xp: 55,
    hp: 150,
    poise: 45,
    elite: true,
    body: { radius: 0.45, height: 2.0 },
    defense: { physical: 2, arcane: 0 },
    profile: { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'normal', chill: 'weak', shock: 'resist' } },
    level: 4,
    moveSpeed: 3.6,
    turnRate: Math.PI * 1.2,
    staggerTicks: 60,
    aggroRange: 24,
    leashRange: 40,
    respawnTicks: 300,
    usesTokens: true,
    keepRange: [12, 18],
    moves: [
      {
        id: 'rivet_burst', windup: 28, active: 20, recovery: 30, damage: 9, kind: 'physical', poise: 8, hitbox: { forward: 0.7, up: 1.5, radius: 0.2 }, range: 22, weight: 3, cooldown: 70,
        trackUntil: 1, hitstop: 3, clip: 'cast', projectile: { speed: 26, radius: 0.22, range: 28, count: 4, interval: 6, spread: 0.05 }, token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'charged_shot', windup: 54, active: 1, recovery: 36, damage: 28, kind: 'physical', poise: 20, hitbox: { forward: 0.7, up: 1.5, radius: 0.2 }, range: 22, minRange: 6, weight: 1.5, cooldown: 240,
        hyperArmor: true, trackUntil: 0.85, hitstop: 6, clip: 'cast_big', projectile: { speed: 34, radius: 0.4, range: 30 }, token: { pool: 'ranged', cost: 1 },
      },
    ],
  },
  /**
   * Slow, and sweeps a beam across you: the sim has no beam, so it is a fast fan of shots laid down
   * from one side to the other. Roll through it or Ward it.
   */
  lens_warden: {
    id: 'lens_warden',
    name: 'Lens Warden',
    model: 'robot_laser',
    xp: 160,
    hp: 420,
    poise: 80,
    elite: true,
    body: { radius: 0.5, height: 2.1 },
    defense: { physical: 0, arcane: 6 },
    profile: { damage: { physical: 'weak', arcane: 'resist' }, status: { burn: 'normal', chill: 'normal', shock: 'normal' } },
    level: 5,
    moveSpeed: 2.2,
    turnRate: Math.PI * 0.7,
    staggerTicks: 80,
    aggroRange: 22,
    leashRange: 34,
    respawnTicks: 600,
    usesTokens: true,
    keepRange: [9, 15],
    moves: [
      {
        id: 'beam_sweep', windup: 40, active: 52, recovery: 40, damage: 7, kind: 'arcane', poise: 8, hitbox: { forward: 0.7, up: 1.6, radius: 0.2 }, range: 18, weight: 3, cooldown: 150,
        hyperArmor: true, trackUntil: 1, hitstop: 2, clip: 'cast', projectile: { speed: 30, radius: 0.3, range: 22, count: 13, interval: 4, spread: 0.045 }, token: { pool: 'ranged', cost: 1 },
      },
      {
        id: 'lens_flare', windup: 48, active: 6, recovery: 40, damage: 26, kind: 'arcane', poise: 24, hitbox: { forward: 0, up: 0.5, radius: 0 }, range: 14, minRange: 4, weight: 1.5, cooldown: 260,
        trackUntil: 0, hitstop: 5, clip: 'cast', area: { radius: 3 }, decal: 'circle', token: { pool: 'ranged', cost: 1 },
      },
    ],
  },
  /** The Gatekeeper's model at ×1.5 (views fit it to this body): slow, with a huge reach. */
  hollow_giant: {
    id: 'hollow_giant',
    name: 'Hollow Giant',
    model: 'gatekeeper',
    xp: 500,
    hp: 1600,
    poise: 180,
    elite: true,
    body: { radius: 1.5, height: 4.8 },
    defense: { physical: 4, arcane: 2 },
    profile: { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'normal', chill: 'normal', shock: 'weak' } },
    level: 8,
    moveSpeed: 2.6,
    turnRate: Math.PI * 0.7,
    staggerTicks: 90,
    aggroRange: 24,
    leashRange: 45,
    respawnTicks: 900,
    usesTokens: true,
    moves: [
      { id: 'smash', windup: 46, active: 8, recovery: 44, damage: 42, kind: 'physical', poise: 40, hitbox: { forward: 3.0, up: 1.5, radius: 2.0 }, range: 5.2, weight: 2, cooldown: 60, knockback: 3, hyperArmor: true, trackUntil: 0.6, hitstop: 8, clip: 'smash', token: { pool: 'melee', cost: 2 } },
      { id: 'sweep', windup: 34, active: 8, recovery: 36, damage: 30, kind: 'physical', poise: 28, hitbox: { forward: 2.6, up: 1.4, radius: 2.4 }, range: 4.6, weight: 2, cooldown: 120, trackUntil: 0.7, hitstop: 6, clip: 'smash', token: { pool: 'melee', cost: 2 } },
      {
        id: 'ground_stomp', windup: 56, active: 8, recovery: 46, damage: 50, kind: 'physical', poise: 40, hitbox: { forward: 0, up: 0.4, radius: 0 }, range: 12, minRange: 4, weight: 1.2, cooldown: 300,
        unblockable: true, hyperArmor: true, trackUntil: 0, hitstop: 10, clip: 'smash', area: { radius: 4.5 }, decal: 'jagged', token: { pool: 'melee', cost: 2 },
      },
    ],
  },
  /** The Brute's model at ×1.6: a camp boss with a punch-kick string. */
  bramble_colossus: {
    id: 'bramble_colossus',
    name: 'Bramble Colossus',
    model: 'brute',
    xp: 320,
    hp: 1100,
    poise: 140,
    elite: true,
    body: { radius: 1.2, height: 3.84 },
    defense: { physical: 3, arcane: 2 },
    profile: { damage: { physical: 'normal', arcane: 'resist' }, status: { burn: 'weak', chill: 'normal', shock: 'normal' } },
    level: 7,
    moveSpeed: 3.0,
    turnRate: Math.PI * 0.85,
    staggerTicks: 80,
    aggroRange: 22,
    leashRange: 38,
    respawnTicks: 600,
    usesTokens: true,
    moves: [
      { id: 'haymaker', windup: 30, active: 6, recovery: 12, damage: 30, kind: 'physical', poise: 26, hitbox: { forward: 2.4, up: 1.8, radius: 1.4 }, range: 3.8, weight: 3, cooldown: 40, trackUntil: 0.65, hitstop: 5, clip: 'punch', followUp: 'haymaker_kick', token: { pool: 'melee', cost: 1 } },
      { id: 'haymaker_kick', windup: 22, active: 6, recovery: 34, damage: 34, kind: 'physical', poise: 30, hitbox: { forward: 2.2, up: 1.0, radius: 1.5 }, range: 3.8, weight: 0, cooldown: 0, knockback: 3, hyperArmor: true, trackUntil: 0.6, hitstop: 7, clip: 'kick', chainOnly: true, token: { pool: 'melee', cost: 2 } },
      { id: 'root_slam', windup: 46, active: 6, recovery: 44, damage: 46, kind: 'physical', poise: 40, hitbox: { forward: 3.0, up: 0.4, radius: 2.6 }, range: 4.4, weight: 1.5, cooldown: 180, unblockable: true, knockback: 2, hyperArmor: true, trackUntil: 0.5, decal: 'jagged', hitstop: 9, clip: 'punch', token: { pool: 'melee', cost: 2 } },
    ],
  },
  /** The Colossus's escort: a veteran Grunt in all but name. */
  bramble_thrall: {
    id: 'bramble_thrall',
    name: 'Bramble Thrall',
    model: 'grunt_vet',
    tags: ['grunt'],
    xp: 22,
    hp: 90,
    poise: 28,
    elite: false,
    body: { radius: 0.35, height: 1.3 },
    defense: { physical: 0, arcane: 0 },
    profile: { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'weak', chill: 'normal', shock: 'normal' } },
    level: 4,
    moveSpeed: 4.4,
    turnRate: Math.PI * 1.6,
    staggerTicks: 50,
    aggroRange: 18,
    leashRange: 35,
    respawnTicks: 300,
    usesTokens: true,
    moves: [
      { id: 'swipe', windup: 20, active: 5, recovery: 22, damage: 12, kind: 'physical', poise: 10, hitbox: { forward: 0.9, up: 0.7, radius: 0.65 }, range: 1.5, weight: 3, cooldown: 0, trackUntil: 0.6, hitstop: 3, clip: 'cast', token: { pool: 'melee', cost: 1 } },
      { id: 'leap', windup: 30, active: 14, recovery: 26, damage: 16, kind: 'physical', poise: 14, hitbox: { forward: 0.6, up: 0.6, radius: 0.8 }, range: 6, minRange: 3, weight: 1, cooldown: 240, trackUntil: 0.8, hitstop: 4, clip: 'cast_big', decal: 'circle', leap: { distance: 5.5 }, token: { pool: 'melee', cost: 1 } },
    ],
  },
};

// ---------------------------------------------------------------- stat affixes (plan §3.6)

export type AffixId = 'colossal' | 'swift' | 'hardy' | 'frail';

export interface AffixDef {
  id: AffixId;
  /** Shown before the enemy's name on its health bar. */
  name: string;
  /** Multipliers on the enemy's HP, ground speed, kill XP and size (default 1). */
  hp?: number;
  speed?: number;
  xp?: number;
  scale?: number;
  /** Counts as elite: no hitstun until its poise breaks. */
  elite?: boolean;
  /** Its weak element only does normal damage (×1 instead of ×1.5). */
  hardy?: boolean;
  /** One member per camp carries it (the first that isn't already an elite), not the whole camp. */
  champion?: boolean;
}

export const AFFIXES: Record<AffixId, AffixDef> = {
  colossal: { id: 'colossal', name: 'Colossal', hp: 2, speed: 0.8, scale: 2, elite: true, champion: true },
  swift: { id: 'swift', name: 'Swift', hp: 0.8, speed: 1.3 },
  hardy: { id: 'hardy', name: 'Hardy', hardy: true },
  frail: { id: 'frail', name: 'Frail', hp: 0.7, xp: 1.2 },
};

/** An enemy's name on its health bar, with its affix in front. */
export const affixName = (affix: AffixId | undefined, name: string): string => (affix ? `${AFFIXES[affix].name} ${name}` : name);

/** The world flag counting shrine rests: a camp's `spawnGeneration` (saved with the world). */
export const CAMP_GENERATION_FLAG = 'camps.generation';

/**
 * What each camp can roll. A camp not listed never has an affix (the tuned Thornwood patrols and the
 * Gatekeeper's clearing). Colossal is only listed where its 3 × 3 windows have room for an elite.
 */
export const CAMP_AFFIX_POOLS: Record<string, AffixId[]> = {
  orchard_south: ['frail', 'swift'],
  orchard_scarecrow: ['frail', 'swift'],
  orchard_west: ['frail', 'swift', 'hardy'],
  millrun_west: ['swift', 'hardy'],
  millrun_east: ['swift', 'hardy'],
  mill_yard: ['swift', 'hardy', 'colossal'],
  watchtower_squad: ['swift', 'hardy', 'colossal'],
  thorn_perch_west: ['swift', 'hardy'],
  thorn_perch_far: ['hardy', 'colossal'],
  salvage_yard: ['swift', 'hardy'],
  salvage_midway: ['swift', 'hardy'],
  salvage_east: ['swift', 'hardy'],
  salvage_far: ['swift', 'hardy'],
  bramble_west: ['swift', 'hardy'],
  bramble_east: ['swift', 'hardy'],
};

// ---------------------------------------------------------------- items, drops and the shop

export const C4_ITEMS: Record<string, ItemDef> = {
  rivet: { id: 'rivet', name: 'Rivet', kind: 'quest', rarity: 'common', blurb: 'Still warm from the barrel.', stacks: true },
  giant_pumpkin: { id: 'giant_pumpkin', name: 'Giant Pumpkin', kind: 'quest', rarity: 'rare', blurb: 'Takes both arms to carry.', stacks: true },
  thorn_seed: { id: 'thorn_seed', name: 'Thorn Seed', kind: 'quest', rarity: 'common', blurb: 'Hums when a Wisp is near.', stacks: true },
  tome_seeker_swarm: { id: 'tome_seeker_swarm', name: 'Seeker Swarm Tome', kind: 'consumable', rarity: 'epic', blurb: 'Teaches Seeker Swarm: your Bolts home on the locked target.', price: 150, teaches: spell('seekerSwarm') },
};

export const C4_DROPS: Record<string, DropTable> = {
  rivet_gunner: { sprouts: [10, 18], heartChance: 0.25, items: [{ item: 'rivet', chance: 0.8 }] },
  lens_warden: { sprouts: [40, 70], heartChance: 1 },
  hollow_giant: { sprouts: [100, 160], heartChance: 1 },
  bramble_colossus: { sprouts: [60, 90], heartChance: 1, items: [{ item: 'giant_pumpkin', chance: 1 }] },
  bramble_thrall: { sprouts: [6, 10], heartChance: 0.2 },
};

/** Extra items on drop tables that already exist: A7's Thorn Seeds come from Hex Wisps. */
export const C4_EXTRA_DROPS: Record<string, { item: string; chance: number }[]> = {
  wisp: [{ item: 'thorn_seed', chance: 0.45 }],
};

/** Added to Trader Pepe's stock. */
export const C4_STOCK: Record<string, number> = { tome_seeker_swarm: 1 };
/** Stock on sale only once a world flag is set: Seeker Swarm after Scrapjaw. */
export const C4_STOCK_AFTER: Record<string, string> = { tome_seeker_swarm: 'boss.scrapjaw.dead' };

// ---------------------------------------------------------------- villagers and objects

const BODY = { radius: 0.4, height: 1.8 };

export const C4_NPCS: Record<string, NpcDef> = {
  watch_captain: { id: 'watch_captain', name: 'Watch Captain', model: 'npc_watch', dialogue: 'watch_captain', body: BODY },
  ranger_moss: { id: 'ranger_moss', name: 'Ranger Moss', model: 'npc_ranger', dialogue: 'ranger_moss', body: BODY },
  weaver_tansy: { id: 'weaver_tansy', name: 'Tansy the Weaver', model: 'npc_weaver', dialogue: 'weaver_tansy', body: BODY },
};

export const C4_OBJECTS: Record<string, ObjectDef> = {
  mill_lens: { id: 'mill_lens', name: "Warden's Lens", verb: 'Study', model: 'tome', effects: [{ setFlag: 'mill.lens.studied' }] },
};

// ---------------------------------------------------------------- quests (plan §4.2)

export const C4_QUESTS: Record<string, QuestDef> = {
  // A1: reflecting projectiles.
  q_rivet_volley: {
    id: 'q_rivet_volley',
    title: 'The Rivet Volley',
    giver: 'watch_captain',
    kind: 'side',
    prereq: [{ questDone: 'q_pest_control' }],
    steps: [
      { id: 'brief', text: 'Hear out the Watch Captain.', objectives: [{ kind: 'talk', npc: 'watch_captain', node: 'a1_brief' }], marker: 'watch_captain' },
      { id: 'yard', text: 'Reach the salvage yard at the east end of the Orchard.', objectives: [{ kind: 'reach', trigger: 'salvage_yard_gate' }], marker: 'salvage_yard_gate' },
      { id: 'gunners', text: 'Destroy the Rivet Gunners.', objectives: [{ kind: 'kill', tag: 'rivet_gunner', count: 3 }], marker: 'salvage_yard_gate' },
      { id: 'return', text: 'Report to the Watch Captain.', objectives: [{ kind: 'talk', npc: 'watch_captain', node: 'a1_done' }], marker: 'watch_captain', onComplete: [{ give: 'totem_turnstone' }] },
    ],
    rewards: [{ learnSpell: spell('mirrorWard') }, { xp: 260 }, { currency: 50 }],
  },
  // A2: Ward or dodge through a beam.
  q_lens_flare: {
    id: 'q_lens_flare',
    title: 'Lens Flare',
    giver: 'watch_captain',
    kind: 'side',
    prereq: [{ questDone: 'q_rivet_volley' }],
    steps: [
      { id: 'loft', text: 'Climb the ridge behind the Old Mill.', objectives: [{ kind: 'reach', trigger: 'mill_loft' }], marker: 'mill_loft' },
      { id: 'warden', text: 'Destroy the Lens Warden.', objectives: [{ kind: 'kill', tag: 'lens_warden', count: 1 }], marker: 'mill_loft' },
      { id: 'lens', text: "Study the Warden's lens.", objectives: [{ kind: 'interact', object: 'mill_lens' }], marker: 'mill_lens', onComplete: [{ give: 'relic_oracles_eye' }] },
    ],
    rewards: [{ learnSpell: spell('staticSnare') }, { xp: 320 }, { currency: 60 }],
  },
  // A3: ranged pressure.
  q_iron_gallery: {
    id: 'q_iron_gallery',
    title: 'Iron Gallery',
    giver: 'watch_captain',
    kind: 'side',
    prereq: [{ questDone: 'q_rivet_volley' }],
    steps: [
      { id: 'gunners', text: 'Destroy 8 Rivet Gunners at the salvage camps.', objectives: [{ kind: 'kill', tag: 'rivet_gunner', count: 8 }], marker: 'salvage_yard_gate' },
      { id: 'rivets', text: 'Collect 5 Rivets from the wrecks.', objectives: [{ kind: 'collect', item: 'rivet', count: 5, consume: true }], marker: 'salvage_yard_gate' },
      { id: 'return', text: 'Bring the Rivets to the Watch Captain.', objectives: [{ kind: 'talk', npc: 'watch_captain', node: 'a3_done' }], marker: 'watch_captain' },
    ],
    rewards: [{ give: 'staff_shooter' }, { xp: 360 }, { currency: 80 }],
  },
  // A4: the Bramble Colossus.
  q_pumpkin_strength: {
    id: 'q_pumpkin_strength',
    title: 'Pumpkin Strength',
    giver: 'farmer_broccoli',
    kind: 'side',
    prereq: [{ questDone: 'q_pumpkins' }],
    steps: [
      { id: 'pumpkins', text: 'Take 3 Giant Pumpkins from the Bramble camps.', objectives: [{ kind: 'collect', item: 'giant_pumpkin', count: 3, consume: true }], marker: 'bramble_fields' },
      { id: 'return', text: 'Bring the pumpkins to Farmer Broccoli.', objectives: [{ kind: 'talk', npc: 'farmer_broccoli', node: 'a4_done' }], marker: 'farmer_broccoli' },
    ],
    rewards: [{ learnSpell: spell('vinePull') }, { xp: 300 }, { currency: 40 }],
  },
  // A6: a giant's tells.
  q_hollow_giant: {
    id: 'q_hollow_giant',
    title: 'The Hollow Giant',
    giver: 'ranger_moss',
    kind: 'side',
    prereq: [{ level: 6 }],
    steps: [
      { id: 'track1', text: 'Follow the giant tracks west from the Ranger.', objectives: [{ kind: 'reach', trigger: 'giant_track_1' }], marker: 'giant_track_1' },
      { id: 'track2', text: 'Follow the tracks deeper into the Thornwood.', objectives: [{ kind: 'reach', trigger: 'giant_track_2' }], marker: 'giant_track_2' },
      { id: 'track3', text: 'The tracks turn past the Brute patrol.', objectives: [{ kind: 'reach', trigger: 'giant_track_3' }], marker: 'giant_track_3' },
      { id: 'track4', text: 'The prints are fresh here.', objectives: [{ kind: 'reach', trigger: 'giant_track_4' }], marker: 'giant_track_4' },
      { id: 'giant', text: 'Bring down the Hollow Giant.', objectives: [{ kind: 'kill', tag: 'hollow_giant', count: 1 }], marker: 'giant_track_4' },
    ],
    rewards: [{ give: 'staff_fighter' }, { xp: 600 }, { currency: 120 }],
  },
  // A7: Wisps, and walling a charge.
  q_weavers_thorns: {
    id: 'q_weavers_thorns',
    title: "The Weaver's Thorns",
    giver: 'weaver_tansy',
    kind: 'side',
    prereq: [{ flag: 'boss.scrapjaw.dead' }],
    steps: [
      { id: 'brief', text: 'Hear out Tansy the Weaver.', objectives: [{ kind: 'talk', npc: 'weaver_tansy', node: 'a7_brief' }], marker: 'weaver_tansy' },
      { id: 'seeds', text: 'Collect 4 Thorn Seeds from Hex Wisps in the Thornwood.', objectives: [{ kind: 'collect', item: 'thorn_seed', count: 4, consume: true }], marker: 'wisp_wood' },
      { id: 'return', text: 'Bring the seeds to Tansy.', objectives: [{ kind: 'talk', npc: 'weaver_tansy', node: 'a7_done' }], marker: 'weaver_tansy', onComplete: [{ give: 'relic_surgebriar' }] },
    ],
    rewards: [{ learnSpell: spell('brambleWall') }, { xp: 1100 }, { currency: 90 }],
  },
};

// ---------------------------------------------------------------- dialogue

export const C4_DIALOGUE: Record<string, DialogueGraph> = {
  watch_captain: {
    id: 'watch_captain',
    entry: [
      { if: [{ quest: 'q_rivet_volley', status: 'active', step: 3 }], node: 'a1_done' },
      { if: [{ quest: 'q_rivet_volley', status: 'active' }], node: 'a1_busy' },
      { if: [{ quest: 'q_iron_gallery', status: 'active', step: 2 }], node: 'a3_done' },
      // The offers come before the busy lines, so one job under way never hides the other.
      { if: [{ quest: 'q_lens_flare', status: 'available' }, { quest: 'q_iron_gallery', status: 'available' }], node: 'next_offer' },
      { if: [{ quest: 'q_lens_flare', status: 'available' }], node: 'a2_offer' },
      { if: [{ quest: 'q_iron_gallery', status: 'available' }], node: 'a3_offer' },
      { if: [{ quest: 'q_iron_gallery', status: 'active' }], node: 'a3_busy' },
      { if: [{ quest: 'q_lens_flare', status: 'active' }], node: 'a2_busy' },
      { if: [{ quest: 'q_rivet_volley', status: 'available' }], node: 'a1_offer' },
      { if: [{ quest: 'q_rivet_volley', status: 'locked' }], node: 'early' },
      { node: 'after' },
    ],
    nodes: {
      early: { speaker: 'Watch Captain', text: 'The Orchard comes first, recruit. Help the Elder clear it, then we will talk about what is rusting past it.' },
      a1_offer: {
        speaker: 'Watch Captain',
        text: 'Rivet Gunners have dug into the old salvage yard. They shoot straight and they never get tired. Will you break them?',
        choices: [
          { text: "I'll break them.", do: [{ startQuest: 'q_rivet_volley' }], next: 'a1_brief' },
          { text: 'Not yet.' },
        ],
      },
      a1_brief: { speaker: 'Watch Captain', text: 'Close the gap when they reload, and watch for the big shot: when one glows, get out of the line or throw it back at them.' },
      a1_busy: { speaker: 'Watch Captain', text: 'The salvage yard is at the east end of the Orchard. Three Gunners. Keep moving.' },
      a1_done: { speaker: 'Watch Captain', text: 'Three Gunners down, and you are still standing. Take this ward. Raise it as the shot lands and the shot goes home.' },
      next_offer: {
        speaker: 'Watch Captain',
        text: 'Two jobs left. A Lens Warden has climbed the ridge behind the Old Mill, and the salvage camps still need thinning. Which will it be?',
        choices: [
          { text: 'The Lens Warden.', do: [{ startQuest: 'q_lens_flare' }], next: 'a2_brief' },
          { text: 'The salvage camps.', do: [{ startQuest: 'q_iron_gallery' }], next: 'a3_brief' },
          { text: 'Neither, for now.' },
        ],
      },
      a2_offer: {
        speaker: 'Watch Captain',
        text: 'A Lens Warden has climbed the ridge behind the Old Mill. Its beam sweeps slowly. Go and put it out?',
        choices: [
          { text: "I'll put it out.", do: [{ startQuest: 'q_lens_flare' }], next: 'a2_brief' },
          { text: 'Not yet.' },
        ],
      },
      a2_brief: { speaker: 'Watch Captain', text: 'Roll through the beam or ward it, then hit the thing with your staff. Spells barely scratch that lens. Then study it, and see what it was looking at.' },
      a2_busy: { speaker: 'Watch Captain', text: 'The ridge behind the Old Mill, east of the river. Staff, not spells.' },
      a3_offer: {
        speaker: 'Watch Captain',
        text: 'The salvage camps keep refilling. Destroy eight Gunners and bring me five Rivets, and the armoury has a staff for you.',
        choices: [
          { text: 'Eight it is.', do: [{ startQuest: 'q_iron_gallery' }], next: 'a3_brief' },
          { text: 'Not yet.' },
        ],
      },
      a3_brief: { speaker: 'Watch Captain', text: 'There is the yard in the Orchard, and more camps east of the village and over the river. If you run short of Gunners, rest at a shrine and they will be back.' },
      a3_busy: { speaker: 'Watch Captain', text: 'Eight Gunners, five Rivets. The camps refill whenever you rest at a shrine.' },
      a3_done: { speaker: 'Watch Captain', text: 'Five Rivets, and the camps are quiet. This staff was made by people who hated those things as much as you do.' },
      after: { speaker: 'Watch Captain', text: 'The road is safer for your work. Mind the ridge after dark.' },
    },
  },
  ranger_moss: {
    id: 'ranger_moss',
    entry: [
      { if: [{ quest: 'q_hollow_giant', status: 'complete' }], node: 'after' },
      { if: [{ quest: 'q_hollow_giant', status: 'active' }], node: 'busy' },
      { if: [{ quest: 'q_hollow_giant', status: 'available' }], node: 'offer' },
      { node: 'early' },
    ],
    nodes: {
      early: { speaker: 'Ranger Moss', text: 'Something huge walks the west of this wood. You are not ready to meet it. Come back when you have a few more scars.' },
      offer: {
        speaker: 'Ranger Moss',
        text: 'Those prints belong to the Hollow Giant. Follow them west and you will find it. It swings slow and it reaches far. Lightning makes it stumble.',
        choices: [
          { text: "I'll track it.", do: [{ startQuest: 'q_hollow_giant' }] },
          { text: 'Not today.' },
        ],
      },
      busy: { speaker: 'Ranger Moss', text: 'Follow the prints west. When the ground shakes, stop walking and start rolling.' },
      after: { speaker: 'Ranger Moss', text: 'The wood is quieter without it. I almost miss the footsteps.' },
    },
  },
  weaver_tansy: {
    id: 'weaver_tansy',
    entry: [
      { if: [{ quest: 'q_weavers_thorns', status: 'complete' }], node: 'after' },
      { if: [{ quest: 'q_weavers_thorns', status: 'active', step: 2 }], node: 'a7_done' },
      { if: [{ quest: 'q_weavers_thorns', status: 'active' }], node: 'busy' },
      { if: [{ quest: 'q_weavers_thorns', status: 'available' }], node: 'offer' },
      { node: 'early' },
    ],
    nodes: {
      early: { speaker: 'Tansy the Weaver', text: 'I can feel that scrap heap rumbling from here. Nobody has time for weaving until it stops.' },
      offer: {
        speaker: 'Tansy the Weaver',
        text: 'The rumbling has stopped, thanks to you. Now I can weave again, but I need Thorn Seeds, and the Wisps have swallowed them all.',
        choices: [
          { text: "I'll get them back.", do: [{ startQuest: 'q_weavers_thorns' }], next: 'a7_brief' },
          { text: 'Maybe later.' },
        ],
      },
      a7_brief: { speaker: 'Tansy the Weaver', text: 'Four seeds will do. Hex Wisps drift through the Thornwood. Bring them down with spells and the seeds fall loose.' },
      busy: { speaker: 'Tansy the Weaver', text: 'Four Thorn Seeds, from the Wisps in the Thornwood.' },
      a7_done: { speaker: 'Tansy the Weaver', text: 'Lovely, still humming. Here: a wall of thorns, grown where you need it. Anything that charges into it will regret the hurry.' },
      after: { speaker: 'Tansy the Weaver', text: 'Walls are only patient hedges. Remember that.' },
    },
  },
};

/** Additions to a graph that already exists: new entry rules, placed before the rule that goes to `before`. */
export interface DialoguePatch {
  graph: string;
  before: string;
  entry: DialogueGraph['entry'];
  nodes: Record<string, DialogueNode>;
}

export const C4_DIALOGUE_PATCHES: DialoguePatch[] = [
  // A turn-in goes ahead of every busy line, so another job under way never blocks handing this in.
  {
    graph: 'farmer_broccoli',
    before: 'pumpkins_busy',
    entry: [{ if: [{ quest: 'q_pumpkin_strength', status: 'active', step: 1 }], node: 'a4_done' }],
    nodes: {},
  },
  {
    graph: 'farmer_broccoli',
    before: 'after',
    entry: [
      { if: [{ quest: 'q_pumpkin_strength', status: 'active' }], node: 'a4_busy' },
      { if: [{ quest: 'q_pumpkin_strength', status: 'available' }], node: 'a4_offer' },
    ],
    nodes: {
      a4_offer: {
        speaker: 'Farmer Broccoli',
        text: 'Those brambly brutes have been growing pumpkins the size of carts. Bring me three and I will show you how the vines here really behave.',
        choices: [
          { text: 'Three giant pumpkins.', do: [{ startQuest: 'q_pumpkin_strength' }] },
          { text: 'Another time.' },
        ],
      },
      a4_busy: { speaker: 'Farmer Broccoli', text: 'Bramble camps, far west and far east. The big ones carry the pumpkins. Fire does them no favours.' },
      a4_done: { speaker: 'Farmer Broccoli', text: 'Would you look at the size of them! Here, a vine for your trouble. Pull the small ones to you, and yourself to the big ones.' },
    },
  },
];

// ---------------------------------------------------------------- where it all stands

const G = 12;

/** Placements for Sproutvale. Every one has a mark in world-src/sproutvale/placements.json. */
export const C4_WORLD: Required<Pick<RegionContent, 'npcs' | 'chests' | 'objects' | 'camps' | 'triggers'>> = {
  npcs: [
    { id: 'watch_captain', npc: 'watch_captain', pos: [196, G, 100], yaw: -Math.PI * 0.6 },
    { id: 'ranger_moss', npc: 'ranger_moss', pos: [246, G, 318], yaw: -Math.PI * 0.5 },
    { id: 'weaver_tansy', npc: 'weaver_tansy', pos: [284, 13.5, 88], yaw: -Math.PI * 0.5 },
  ],
  chests: [
    // A4's third pumpkin is guaranteed: the two Colossi drop one each, this holds the last.
    { id: 'chest_bramble', pos: [72, G, 466], yaw: 0, chest: { id: 'chest_bramble', items: [{ item: 'giant_pumpkin', count: 1 }], sprouts: 20 } },
  ],
  objects: [{ id: 'mill_lens', pos: [474, G, 306], yaw: Math.PI }],
  camps: [
    // The Orchard's salvage: 3 Gunners, which with the Drake overhead is the 3 × 3 budget.
    {
      id: 'salvage_yard', pos: [130, G, 92],
      members: [{ def: 'rivet_gunner', at: [-6, -3], yaw: Math.PI }, { def: 'rivet_gunner', at: [6, -3], yaw: Math.PI }, { def: 'rivet_gunner', at: [0, 6], yaw: 0 }],
    },
    // East of the village and across the river: the other 5 Gunners.
    {
      id: 'salvage_midway', pos: [310, G, 170],
      members: [{ def: 'rivet_gunner', at: [0, 0], yaw: Math.PI / 2 }, { def: 'grunt', at: [-4, 3] }, { def: 'grunt', at: [4, 3] }],
    },
    { id: 'salvage_east', pos: [345, G, 62], members: [{ def: 'rivet_gunner', at: [-5, 0], yaw: -Math.PI / 2 }, { def: 'rivet_gunner', at: [5, 0], yaw: -Math.PI / 2 }] },
    { id: 'salvage_far', pos: [470, G, 85], members: [{ def: 'rivet_gunner', at: [-5, 2], yaw: -Math.PI / 2 }, { def: 'rivet_gunner', at: [5, -2], yaw: -Math.PI / 2 }] },
    // A2: the ridge behind the Old Mill.
    { id: 'mill_loft', pos: [470, G, 300], members: [{ def: 'lens_warden', at: [0, 0], yaw: Math.PI }] },
    // A6: the far west of the Thornwood.
    { id: 'giant_hollow', pos: [36, G, 292], members: [{ def: 'hollow_giant', at: [0, 0], yaw: Math.PI / 2 }] },
    // A4: the Bramble camps, at opposite corners of the wood.
    {
      id: 'bramble_west', pos: [60, G, 472],
      members: [{ def: 'bramble_colossus', at: [0, 0], yaw: Math.PI }, { def: 'bramble_thrall', at: [-5, -3] }, { def: 'bramble_thrall', at: [5, -3] }],
    },
    {
      id: 'bramble_east', pos: [476, G, 386],
      members: [{ def: 'bramble_colossus', at: [0, 0], yaw: -Math.PI / 2 }, { def: 'bramble_thrall', at: [-5, 3] }, { def: 'bramble_thrall', at: [-5, -3] }],
    },
  ],
  triggers: [
    { id: 'salvage_yard_gate', pos: [130, G, 92], radius: 16 },
    { id: 'mill_loft', pos: [470, G, 300], radius: 16 },
    { id: 'bramble_fields', pos: [60, G, 472], radius: 20 },
    { id: 'giant_track_1', pos: [190, G, 345], radius: 7 },
    { id: 'giant_track_2', pos: [150, G, 330], radius: 7 },
    { id: 'giant_track_3', pos: [105, G, 300], radius: 7 },
    { id: 'giant_track_4', pos: [66, G, 296], radius: 7 },
    // A7's marker: the Wisps of the Thornwood's middle patrol.
    { id: 'wisp_wood', pos: [300, G, 330], radius: 20 },
  ],
};
