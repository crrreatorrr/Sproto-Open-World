/**
 * Expansion milestone C5 (expansion plan §3.4, §4.2): the Burrowmother and the Deep Seam, with quests
 * A5 (The Elder's Garden), A8 (Tremors) and A9 (The Deep Seam), their miners, dialogue and rewards.
 *
 * Pure data, and only `import type` from the registries: each shared file merges its table from here
 * with one line, so this module never takes part in an import cycle.
 */
import type { DialogueGraph } from '../dialogue';
import type { EnemyDef, EnemyMoveDef } from '../enemies';
import type { ItemDef } from '../items';
import type { NpcDef } from '../npcs';
import type { QuestDef } from '../quests';
import type { RegionContent } from '../world/sproutvaleContent';

/** The pit's centre (the `deep_seam` bowl in world-src/sproutvale/terrain.json). */
export const DEEP_SEAM_CENTRE: readonly [number, number] = [388, 469];
/** Ground y guess on the pit floor and around the quarry (placements settle onto the terrain). */
const FLOOR_Y = -6;
const QUARRY_Y = 0;
/** Where the ramp reaches the floor: she sleeps facing it. */
const RAMP_FOOT: readonly [number, number] = [406, 463.8];
/** The fight is sealed just inside the 19 m flat floor. */
const ARENA_RADIUS = 18;
/** The world flag A9 sets on reaching the floor: she wakes. */
const WAKE_FLAG = 'seam.awake';

const melee = { kind: 'physical' } as const;

/** The spit's shots: Burn on a hit, and a parry or a Mirror Ward sends them back to stagger her. */
const GLOB: NonNullable<EnemyMoveDef['projectile']> = {
  speed: 17, radius: 0.55, range: 30, count: 3, interval: 20, spread: 0.16, model: 'burn_glob',
  status: { id: 'burn', stacks: 1 }, reflectBonus: { hpFrac: 0.03, stagger: 70 },
};
/** Her open mouth, while she spits. */
const MOUTH = [{ forward: 1.6, up: 3.4, radius: 1.3, mult: 1.4 }];

const MOVES: EnemyMoveDef[] = [
  // Phases 1 and 2: one heavy overhand. Sidestep it, then punish the long recovery.
  {
    ...melee, id: 'smash', phases: [1, 2], windup: 32, active: 6, recovery: 48, damage: 46, poise: 40, hitbox: { forward: 3, up: 1.6, radius: 2.2 },
    sweep: { forward: 3.4, up: 0.6 }, range: 5, weight: 3, cooldown: 90, knockback: 1.5, trackUntil: 0.55, hitstop: 7, clip: 'smash',
  },
  // Phase 3: the smash becomes a two-hit string.
  {
    ...melee, id: 'smash_a', phases: [3], windup: 26, active: 6, recovery: 10, damage: 46, poise: 40, hitbox: { forward: 3, up: 1.6, radius: 2.2 },
    sweep: { forward: 3.4, up: 0.6 }, range: 5, weight: 3, cooldown: 110, knockback: 1, trackUntil: 0.6, hitstop: 6, clip: 'smash', followUp: 'smash_b',
  },
  {
    ...melee, id: 'smash_b', chainOnly: true, windup: 24, active: 6, recovery: 54, damage: 46, poise: 40, hitbox: { forward: 3.2, up: 1.4, radius: 2.3 },
    sweep: { forward: 3.6, up: 0.5 }, range: 5, weight: 0, cooldown: 0, knockback: 2, hyperArmor: true, trackUntil: 0.7, hitstop: 7, clip: 'smash',
  },
  // A ring around her own feet, read from the jagged decal: roll out of it or through it.
  {
    ...melee, id: 'slam', windup: 44, active: 6, recovery: 60, damage: 60, poise: 50, hitbox: { forward: 0, up: 0.6, radius: 6.2 },
    range: 6.5, weight: 2, cooldown: 300, unblockable: true, knockback: 2.5, hyperArmor: true, trackUntil: 0, decal: 'jagged', hitstop: 9, clip: 'slam',
  },
  // The charge: tracks through most of its wind-up, then commits. Dodge late and let her hit a pillar.
  {
    ...melee, id: 'charge', phases: [1, 2], windup: 38, active: 70, recovery: 46, damage: 62, poise: 60, hitbox: { forward: 2.4, up: 1.4, radius: 2 },
    range: 20, minRange: 8, weight: 2.5, cooldown: 420, knockback: 4, hyperArmor: true, trackUntil: 0.85, hitstop: 8, clip: 'charge', charge: { speed: 15 },
  },
  // Phase 3: she turns round and comes straight back.
  {
    ...melee, id: 'charge_a', phases: [3], windup: 32, active: 70, recovery: 14, damage: 62, poise: 60, hitbox: { forward: 2.4, up: 1.4, radius: 2 },
    range: 20, minRange: 8, weight: 3, cooldown: 420, knockback: 4, hyperArmor: true, trackUntil: 0.85, hitstop: 8, clip: 'charge', charge: { speed: 15 }, followUp: 'charge_b',
  },
  {
    ...melee, id: 'charge_b', chainOnly: true, windup: 28, active: 70, recovery: 50, damage: 62, poise: 60, hitbox: { forward: 2.4, up: 1.4, radius: 2 },
    range: 20, weight: 0, cooldown: 0, knockback: 4, hyperArmor: true, trackUntil: 0.85, hitstop: 8, clip: 'charge', charge: { speed: 15 },
  },
  // Phase 2 on, the burrow: she digs in (hit her while she does), the dust runs at you, the ground
  // marks where she comes up, and she spits from there. The long recovery after the spit is the punish.
  {
    ...melee, id: 'burrow_sink', phases: [2, 3], windup: 40, active: 24, recovery: 0, damage: 0, poise: 0, hitbox: { forward: 0, up: 1, radius: 0.1 },
    range: 40, weight: 3.5, cooldown: 540, hyperArmor: true, trackUntil: 0, hitstop: 0, clip: 'slam', noHit: true, burrow: 'sink', followUp: 'burrow_rise',
  },
  {
    ...melee, id: 'burrow_rise', chainOnly: true, windup: 58, active: 6, recovery: 12, damage: 58, poise: 50, hitbox: { forward: 0, up: 0.5, radius: 0 },
    range: 40, weight: 0, cooldown: 0, unblockable: true, knockback: 3, hyperArmor: true, trackUntil: 1, hitstop: 9, clip: 'slam',
    area: { radius: 5 }, decal: 'jagged', shove: { radius: 6, distance: 3 }, burrow: 'rise', followUp: 'spit_volley',
  },
  {
    id: 'spit_volley', kind: 'arcane', chainOnly: true, windup: 30, active: 44, recovery: 72, damage: 24, poise: 18, hitbox: { forward: 2.2, up: 3.4, radius: 0.3 },
    range: 40, weight: 0, cooldown: 0, hyperArmor: true, trackUntil: 1, hitstop: 4, clip: 'shoot_start', projectile: GLOB, weakSpots: MOUTH,
  },
  // Keep your distance from her in phase 2 and she spits anyway.
  {
    id: 'spit_far', kind: 'arcane', phases: [2, 3], windup: 34, active: 44, recovery: 56, damage: 24, poise: 18, hitbox: { forward: 2.2, up: 3.4, radius: 0.3 },
    range: 24, minRange: 10, weight: 2, cooldown: 360, hyperArmor: true, trackUntil: 1, hitstop: 4, clip: 'shoot_start', projectile: GLOB, weakSpots: MOUTH,
  },
  // The roar at each phase change: shoves you back.
  {
    ...melee, id: 'roar', chainOnly: true, windup: 24, active: 30, recovery: 36, damage: 0, poise: 0, hitbox: { forward: 0, up: 3, radius: 0.1 },
    range: 0, weight: 0, cooldown: 0, hyperArmor: true, trackUntil: 1, hitstop: 0, clip: 'roar', noHit: true, shove: { radius: 14, distance: 4 },
  },
];

export const BURROWMOTHER: EnemyDef = {
  id: 'burrowmother',
  name: 'The Burrowmother',
  model: 'burrowmother',
  xp: 2600,
  hp: 6200,
  poise: 380,
  elite: true,
  body: { radius: 2, height: 5 },
  defense: { physical: 26, arcane: 22 },
  profile: { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'resist', chill: 'weak', shock: 'normal' } },
  level: 12,
  moveSpeed: 3.4,
  turnRate: Math.PI * 0.85,
  // Broken: 180 ticks, taking 25% more damage.
  staggerTicks: 180,
  brokenDamage: 1.25,
  aggroRange: 30,
  leashRange: 60,
  respawnTicks: 600,
  moves: MOVES,
  // Stunned against a pillar or the wall, her back opens up.
  weakSpots: [{ forward: -1.8, up: 2.2, radius: 2.2, mult: 1.5, when: 'stunned' }],
  lockPoint: { up: 3 },
  cameraScale: 1.6,
  boss: {
    title: 'Mother of the Deep Seam',
    arenaRadius: ARENA_RADIUS,
    introTicks: 130,
    phase2: 0.65,
    phase3: 0.3,
    enrage: 1.25,
    summon: { def: 'grunt', count: 2, below: 0.3 },
    roar: 'roar',
    stunTicks: 160,
    gapTicks: 18,
    // No falling rocks and no Burn patches in this fight: the burrow is her area attack.
    rocks: { ticks: 0, fuse: 54, radius: 2.6, damage: 0 },
    burnPatch: { radius: 0, ticks: 0 },
    wakeFlag: WAKE_FLAG,
  },
};

// ---------------------------------------------------------------- items

export const C5_ITEMS: Record<string, ItemDef> = {
  robe_moleskin: { id: 'robe_moleskin', name: 'Moleskin', kind: 'robe', rarity: 'epic', blurb: 'Warm, close, and smells of deep earth.', robe: { physical: 20, arcane: 14, tint: 0x4f4238 } },
  charm_seam_lamp: { id: 'charm_seam_lamp', name: 'Seam Lamp', kind: 'charm', rarity: 'epic', blurb: '+12% defense and +1 mana per melee hit.', charm: { defense: 1.12, manaPerHit: 1 } },
};

// ---------------------------------------------------------------- the miners

const BODY = { radius: 0.4, height: 1.8 };

export const C5_NPCS: Record<string, NpcDef> = {
  miner_bram: { id: 'miner_bram', name: 'Foreman Bram', model: 'npc_miner', dialogue: 'miner_bram', body: BODY },
  miner_ketta: { id: 'miner_ketta', name: 'Ketta the Driller', model: 'npc_miner', dialogue: 'miner_ketta', body: BODY },
  miner_odo: { id: 'miner_odo', name: 'Old Odo', model: 'npc_miner', dialogue: 'miner_odo', body: BODY },
};

// ---------------------------------------------------------------- quests (plan §4.2)

/**
 * The XP budget for the level 15 cap (quest rewards plus the kills each quest asks for). The raises
 * sit on A5, A7 and A8 because those open after Scrapjaw, so they can't over-level that fight:
 *   Scrapjaw's gate 1,605 (level 6) → Scrapjaw dead 2,805 → A1–A8 done 9,944 (level 12, the Burrowmother)
 *   → A9, A10, A11 done 14,644 (level 14, the Drake) → A12 done 18,544 (level 15).
 */
export const C5_QUESTS: Record<string, QuestDef> = {
  // A5: the shrine network.
  q_elders_garden: {
    id: 'q_elders_garden',
    title: "The Elder's Garden",
    giver: 'elder_pepe',
    kind: 'side',
    prereq: [{ questDone: 'q_scrapjaw' }],
    steps: [
      { id: 'brief', text: 'Hear out Elder Pepe.', objectives: [{ kind: 'talk', npc: 'elder_pepe', node: 'a5_brief' }], marker: 'elder_pepe' },
      {
        id: 'shrines', text: 'Lay a hand on the three shrines: First Light, the Watchtower and the Quarry Gate.',
        objectives: [{ kind: 'interact', object: 'shrine_first_light' }, { kind: 'interact', object: 'shrine_watchtower' }, { kind: 'interact', object: 'shrine_quarry_gate' }],
      },
      { id: 'return', text: 'Tell Elder Pepe the shrines are awake.', objectives: [{ kind: 'talk', npc: 'elder_pepe', node: 'a5_done' }], marker: 'elder_pepe' },
    ],
    rewards: [{ learnSpell: 'healingBloom' }, { xp: 1000 }, { currency: 80 }],
  },
  // A8: something is moving under the quarry.
  q_tremors: {
    id: 'q_tremors',
    title: 'Tremors',
    giver: 'miner_bram',
    kind: 'side',
    prereq: [{ flag: 'boss.scrapjaw.dead' }],
    steps: [
      {
        id: 'miners', text: 'Ask the three quarry miners about the tremors.', marker: 'miner_bram',
        objectives: [{ kind: 'talk', npc: 'miner_bram', node: 'a8_bram' }, { kind: 'talk', npc: 'miner_ketta', node: 'a8_ketta' }, { kind: 'talk', npc: 'miner_odo', node: 'a8_odo' }],
      },
      { id: 'seam', text: 'Go down the ramp into the Deep Seam.', objectives: [{ kind: 'reach', trigger: 'deep_seam' }], marker: 'deep_seam' },
    ],
    rewards: [{ give: 'charm_seam_lamp' }, { xp: 900 }, { currency: 80 }, { startQuest: 'q_deep_seam' }],
  },
  // A9: burrow tells and reflected spit. A12 (the Skyfire Drake) is gated on this id.
  q_deep_seam: {
    id: 'q_deep_seam',
    title: 'The Deep Seam',
    giver: 'miner_bram',
    kind: 'side',
    prereq: [{ questDone: 'q_tremors' }],
    steps: [
      {
        id: 'floor', text: 'Reach the floor of the pit.', objectives: [{ kind: 'reach', trigger: 'deep_seam_floor' }], marker: 'deep_seam_floor',
        onComplete: [{ setFlag: WAKE_FLAG }],
      },
      {
        id: 'boss', text: 'Defeat the Burrowmother.', objectives: [{ kind: 'kill', tag: 'burrowmother', count: 1 }], marker: 'deep_seam_floor',
        onComplete: [{ setFlag: 'boss.burrowmother.dead' }, { skillPoints: 1 }],
      },
    ],
    rewards: [{ learnSpell: 'emberBreath' }, { give: 'robe_moleskin' }, { xp: 1000 }, { currency: 250 }],
  },
};

// ---------------------------------------------------------------- dialogue

const T = 'q_tremors';

const C5_DIALOGUE: Record<string, DialogueGraph> = {
  miner_bram: {
    id: 'miner_bram',
    entry: [
      { if: [{ quest: 'q_deep_seam', status: 'complete' }], node: 'after' },
      { if: [{ quest: 'q_deep_seam', status: 'active' }], node: 'go' },
      { if: [{ quest: 'q_deep_seam', status: 'available' }], node: 'a9_offer' },
      { if: [{ quest: T, status: 'active', step: 1 }], node: 'go' },
      { if: [{ quest: T, status: 'active' }], node: 'a8_bram' },
      { if: [{ quest: T, status: 'available' }], node: 'offer' },
      { node: 'early' },
    ],
    nodes: {
      early: { speaker: 'Foreman Bram', text: 'Nobody digs while that scrap beast has the quarry. Deal with it, then we can talk about the ground.' },
      offer: {
        speaker: 'Foreman Bram',
        text: 'The beast is gone and the ground still shakes. It is coming from the Deep Seam, the old pit west of here. Ask my crew what they felt?',
        choices: [
          { text: "I'll ask them.", do: [{ startQuest: T }], next: 'a8_bram' },
          { text: 'Not yet.' },
        ],
      },
      a8_bram: { speaker: 'Foreman Bram', text: 'It comes in waves, and it moves. Ketta is over by the road and Old Odo is up the north slope. They have felt it closer than I have.' },
      // Finishing Tremors starts A9 by itself; this is the giver's own offer of it.
      a9_offer: {
        speaker: 'Foreman Bram',
        text: 'Whatever is shaking my quarry sleeps on the floor of that pit. Will you go down and end it?',
        choices: [
          { text: "I'll go down.", do: [{ startQuest: 'q_deep_seam' }], next: 'go' },
          { text: 'Not yet.' },
        ],
      },
      go: { speaker: 'Foreman Bram', text: 'The ramp is the only way back up from the pit floor. Rest before you go down.' },
      after: { speaker: 'Foreman Bram', text: 'The ground has gone still. First quiet shift we have had in years. There is smoke over the Orchard, though. Farmer Broccoli could use you.' },
    },
  },
  miner_ketta: {
    id: 'miner_ketta',
    entry: [
      { if: [{ quest: 'q_deep_seam', status: 'complete' }], node: 'after' },
      { if: [{ quest: T, status: 'active', step: 0 }], node: 'a8_ketta' },
      { if: [{ quest: T, status: 'complete' }], node: 'tip' },
      { if: [{ quest: T, status: 'active' }], node: 'tip' },
      { node: 'early' },
    ],
    nodes: {
      early: { speaker: 'Ketta the Driller', text: 'Talk to the foreman if you want work. I just drill.' },
      a8_ketta: { speaker: 'Ketta the Driller', text: 'The dust jumps before she does. Watch it run across the ground at you, then get off that spot, fast.', next: 'tip' },
      tip: { speaker: 'Ketta the Driller', text: 'When she spits fire, throw it back at her. She hates the taste of it.' },
      after: { speaker: 'Ketta the Driller', text: 'My drill has never run so straight. The rock has stopped flinching.' },
    },
  },
  miner_odo: {
    id: 'miner_odo',
    entry: [
      { if: [{ quest: 'q_deep_seam', status: 'complete' }], node: 'after' },
      { if: [{ quest: T, status: 'active', step: 0 }], node: 'a8_odo' },
      { if: [{ quest: T, status: 'complete' }], node: 'tip' },
      { if: [{ quest: T, status: 'active' }], node: 'tip' },
      { node: 'early' },
    ],
    nodes: {
      early: { speaker: 'Old Odo', text: 'Sixty years in this quarry. Ask the foreman, he likes talking.' },
      a8_odo: { speaker: 'Old Odo', text: 'We called her the Burrowmother when I was a lad, to scare the new hands. Turns out she was never a story.', next: 'tip' },
      tip: { speaker: 'Old Odo', text: 'She charges blind. Put a pillar between you and let the stone do the work, then hit her in the back.' },
      after: { speaker: 'Old Odo', text: 'I shall have to find a new story for the new hands.' },
    },
  },
};

/** The miners, and Elder Pepe's garden (placed before his other lines: the first passing rule wins). */
export function registerC5Dialogue(d: Record<string, DialogueGraph>): void {
  Object.assign(d, C5_DIALOGUE);
  const elder = d.elder_pepe;
  elder.entry.unshift(
    { if: [{ quest: 'q_elders_garden', status: 'active', step: 2 }], node: 'a5_done' },
    { if: [{ quest: 'q_elders_garden', status: 'active', step: 1 }], node: 'a5_busy' },
    { if: [{ quest: 'q_elders_garden', status: 'active', step: 0 }], node: 'a5_brief' },
    { if: [{ quest: 'q_elders_garden', status: 'available' }], node: 'a5_offer' },
  );
  elder.nodes.a5_offer = {
    speaker: 'Elder Pepe',
    text: 'The shrines went quiet while that beast was rumbling. Walk to all three for me and wake them, and I will teach you what my garden taught me.',
    choices: [
      { text: "I'll wake them.", do: [{ startQuest: 'q_elders_garden' }], next: 'a5_brief' },
      { text: 'Not yet.' },
    ],
  };
  elder.nodes.a5_brief = { speaker: 'Elder Pepe', text: 'First Light is close by, then the Watchtower, then the Quarry Gate. A hand on each stone is all they ask.' };
  elder.nodes.a5_busy = { speaker: 'Elder Pepe', text: 'First Light, the Watchtower, the Quarry Gate. A hand on each stone.' };
  elder.nodes.a5_done = { speaker: 'Elder Pepe', text: 'I can feel them humming from here. Take this: plant a bloom where you stand, and it will mend you while it lives.' };
}

// ---------------------------------------------------------------- where it all stands

/** Three pillars on the floor, turned so none stands in front of the ramp, and with room for her behind them. */
const PILLARS = 3;
const PILLAR_RING = 8;

/** The boss, her pillars, the miners and the quest volumes. Every villager has a mark in placements.json. */
export function addDeepSeamContent(c: RegionContent): void {
  const [x, z] = DEEP_SEAM_CENTRE;
  const toRamp = Math.atan2(RAMP_FOOT[0] - x, RAMP_FOOT[1] - z);
  c.enemies.push({ id: 'burrowmother', def: 'burrowmother', pos: [x, FLOOR_Y, z], yaw: toRamp });
  const obstacles = (c.obstacles ??= []);
  for (let i = 0; i < PILLARS; i++) {
    // 60° either side of the ramp, and one straight across from it.
    const a = toRamp + Math.PI / 3 + (i * Math.PI * 2) / PILLARS;
    obstacles.push({
      id: `seam_pillar_${i}`, model: 'quarry_pillar', pos: [x + Math.sin(a) * PILLAR_RING, FLOOR_Y, z + Math.cos(a) * PILLAR_RING], yaw: a,
      shape: { kind: 'cylinder', radius: 3, height: 8 }, breakable: true,
    });
  }
  c.npcs.push(
    { id: 'miner_bram', npc: 'miner_bram', pos: [419, QUARRY_Y, 470], yaw: -Math.PI / 2 },
    { id: 'miner_ketta', npc: 'miner_ketta', pos: [414, QUARRY_Y, 440], yaw: -Math.PI / 4 },
    { id: 'miner_odo', npc: 'miner_odo', pos: [428, QUARRY_Y, 482], yaw: (-3 * Math.PI) / 4 },
  );
  c.triggers.push(
    // Inside the rim and short of the miners, so walking down to it always counts as arriving.
    { id: 'deep_seam', pos: [x, FLOOR_Y, z], radius: 26 },
    { id: 'deep_seam_floor', pos: [x, FLOOR_Y, z], radius: ARENA_RADIUS },
  );
}
