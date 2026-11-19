/**
 * M5: Scrapjaw, the Quarry Beast (plan §4.10, §6.2): the boss, its quest, the talk around it, the
 * gate's lock and everything placed at the Old Quarry. Pure data, registered by one line in each
 * shared table. Type-only imports keep this file free of import cycles.
 */
import type { DialogueGraph } from '../dialogue';
import type { EnemyDef, EnemyMoveDef } from '../enemies';
import type { ObjectDef } from '../objects';
import type { QuestDef } from '../quests';
import type { RegionContent } from '../world/sproutvaleContent';

/** The Old Quarry's floor: the bowl's centre (world-src/sproutvale/terrain.json). */
export const QUARRY_CENTRE: readonly [number, number] = [440, 452];
/** Ground y guess at the quarry and the gate (placements settle onto the terrain). */
const FLOOR_Y = 0;
const GATE_Y = 5;
/** The Quarry Gate stands in the ravine, turned across it (the `frost_gate` prop's yaw). */
const GATE_AT: readonly [number, number] = [352, 414];
const GATE_YAW = (62 * Math.PI) / 180;

const melee = { kind: 'physical' } as const;

const MOVES: EnemyMoveDef[] = [
  // Phase 1 and 2: one heavy overhand. Sidestep it, then punish the long recovery.
  {
    ...melee, id: 'smash', phases: [1, 2], windup: 30, active: 6, recovery: 46, damage: 40, poise: 40, hitbox: { forward: 3.2, up: 1.6, radius: 2.2 },
    sweep: { forward: 3.6, up: 0.6 }, range: 5, weight: 3, cooldown: 90, knockback: 1.5, trackUntil: 0.55, hitstop: 7, clip: 'smash',
  },
  // Phase 3: the smash becomes a two-hit string.
  {
    ...melee, id: 'smash_a', phases: [3], windup: 26, active: 6, recovery: 10, damage: 40, poise: 40, hitbox: { forward: 3.2, up: 1.6, radius: 2.2 },
    sweep: { forward: 3.6, up: 0.6 }, range: 5, weight: 3, cooldown: 110, knockback: 1, trackUntil: 0.6, hitstop: 6, clip: 'smash', followUp: 'smash_b',
  },
  {
    ...melee, id: 'smash_b', chainOnly: true, windup: 24, active: 6, recovery: 52, damage: 40, poise: 40, hitbox: { forward: 3.4, up: 1.4, radius: 2.3 },
    sweep: { forward: 3.8, up: 0.5 }, range: 5, weight: 0, cooldown: 0, knockback: 2, hyperArmor: true, trackUntil: 0.7, hitstop: 7, clip: 'smash',
  },
  // A ring around its own feet, read from the jagged decal: roll out of it or through it.
  {
    ...melee, id: 'slam', windup: 40, active: 6, recovery: 58, damage: 55, poise: 50, hitbox: { forward: 0, up: 0.6, radius: 6 },
    range: 6.5, weight: 2, cooldown: 300, unblockable: true, knockback: 2.5, hyperArmor: true, trackUntil: 0, decal: 'jagged', hitstop: 9, clip: 'slam', burnPatch: true,
  },
  // The charge: tracks through most of its wind-up, then commits. Dodge late and let it hit something.
  {
    ...melee, id: 'charge', phases: [1, 2], windup: 36, active: 80, recovery: 44, damage: 60, poise: 60, hitbox: { forward: 2.4, up: 1.4, radius: 2.0 },
    range: 22, minRange: 8, weight: 2.5, cooldown: 420, knockback: 4, hyperArmor: true, trackUntil: 0.85, hitstop: 8, clip: 'charge', charge: { speed: 15 },
  },
  // Phase 3: it turns round and comes straight back.
  {
    ...melee, id: 'charge_a', phases: [3], windup: 32, active: 80, recovery: 14, damage: 60, poise: 60, hitbox: { forward: 2.4, up: 1.4, radius: 2.0 },
    range: 22, minRange: 8, weight: 3, cooldown: 420, knockback: 4, hyperArmor: true, trackUntil: 0.85, hitstop: 8, clip: 'charge', charge: { speed: 15 }, followUp: 'charge_b',
  },
  {
    ...melee, id: 'charge_b', chainOnly: true, windup: 28, active: 80, recovery: 50, damage: 60, poise: 60, hitbox: { forward: 2.4, up: 1.4, radius: 2.0 },
    range: 22, weight: 0, cooldown: 0, knockback: 4, hyperArmor: true, trackUntil: 0.85, hitstop: 8, clip: 'charge', charge: { speed: 15 },
  },
  // Phase 2 on: a chunk of scrap, thrown straight. A parry sends it back for 8% of its health.
  {
    ...melee, id: 'scrap_throw', phases: [2, 3], windup: 28, active: 12, recovery: 40, damage: 35, poise: 25, hitbox: { forward: 1.4, up: 4.2, radius: 0.3 },
    range: 24, minRange: 6, weight: 2.5, cooldown: 240, hyperArmor: true, trackUntil: 1, hitstop: 5, clip: 'throw_start',
    projectile: { speed: 20, radius: 0.75, range: 36, model: 'scrap', reflectBonus: { hpFrac: 0.08, stagger: 90 } },
  },
  // The roar at each phase change: shoves you back; the first one also brings the rocks down.
  {
    ...melee, id: 'roar', chainOnly: true, windup: 24, active: 30, recovery: 36, damage: 0, poise: 0, hitbox: { forward: 0, up: 3, radius: 0.1 },
    range: 0, weight: 0, cooldown: 0, hyperArmor: true, trackUntil: 1, hitstop: 0, clip: 'roar', noHit: true, shove: { radius: 16, distance: 4 },
  },
];

export const SCRAPJAW: EnemyDef = {
  id: 'scrapjaw',
  name: 'Scrapjaw',
  model: 'scrapjaw',
  xp: 1200,
  hp: 3600,
  poise: 300,
  elite: true,
  body: { radius: 1.8, height: 5.4 },
  defense: { physical: 20, arcane: 20 },
  profile: { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'resist', chill: 'resist', shock: 'weak' } },
  level: 7,
  moveSpeed: 3.6,
  turnRate: Math.PI * 0.9,
  // Broken: 180 ticks, taking 25% more damage.
  staggerTicks: 180,
  brokenDamage: 1.25,
  aggroRange: 26,
  leashRange: 60,
  respawnTicks: 600,
  moves: MOVES,
  // Stunned against a pillar or the wall, its back opens up.
  weakSpots: [{ forward: -1.8, up: 2.4, radius: 2.2, mult: 1.5, when: 'stunned' }],
  lockPoint: { up: 3.2 },
  cameraScale: 1.55,
  boss: {
    title: 'The Quarry Beast',
    arenaRadius: 20,
    introTicks: 130,
    phase2: 0.6,
    phase3: 0.25,
    enrage: 1.2,
    summon: { def: 'grunt', count: 3, below: 0.45 },
    roar: 'roar',
    stunTicks: 150,
    gapTicks: 20,
    rocks: { ticks: 360, fuse: 54, radius: 2.6, damage: 30 },
    burnPatch: { radius: 5, ticks: 480 },
  },
};

export const Q_SCRAPJAW: QuestDef = {
  id: 'q_scrapjaw',
  title: 'The Scrap Rumble',
  giver: 'captain_agent',
  kind: 'main',
  prereq: [{ questDone: 'q_thornwood' }],
  steps: [
    { id: 'shrine', text: 'Reach the Quarry Gate Shrine in the ravine.', objectives: [{ kind: 'reach', trigger: 'quarry_gate_shrine' }], marker: 'quarry_gate_shrine' },
    { id: 'gate', text: 'Open the Quarry Gate with the Quarry Key.', objectives: [{ kind: 'interact', object: 'quarry_gate_lock' }], marker: 'quarry_gate_lock' },
    {
      id: 'boss', text: 'Defeat Scrapjaw in the Old Quarry.', objectives: [{ kind: 'kill', tag: 'scrapjaw', count: 1 }], marker: 'old_quarry',
      onComplete: [{ give: 'staff_fighters_might' }, { setFlag: 'boss.scrapjaw.dead' }, { skillPoints: 1 }, { give: 'relic_hopeglass' }],
    },
    { id: 'elder', text: 'Tell Elder Pepe the quarry is quiet.', objectives: [{ kind: 'talk', npc: 'elder_pepe', node: 'scrapjaw_return' }], marker: 'elder_pepe' },
  ],
  // Ember Heart has no other source: Scrapjaw's furnace, handed over by the Elder.
  rewards: [{ give: 'charm_ember_heart' }, { currency: 300 }, { give: 'relic_sprotos_stride' }],
};

/** The quest, and the Quarry Key's pickup starting it. */
export function registerScrapjawQuest(quests: Record<string, QuestDef>): void {
  quests.q_scrapjaw = Q_SCRAPJAW;
  quests.q_thornwood.rewards.push({ startQuest: 'q_scrapjaw' });
}

/** Elder Pepe's ending, and Captain Agent offering the quest to a save that already has the key. */
export function registerScrapjawDialogue(d: Record<string, DialogueGraph>): void {
  const elder = d.elder_pepe;
  elder.entry.unshift(
    { if: [{ quest: 'q_scrapjaw', status: 'complete' }], node: 'scrapjaw_after' },
    { if: [{ quest: 'q_scrapjaw', status: 'active', step: 3 }], node: 'scrapjaw_return' },
  );
  elder.nodes.scrapjaw_return = { speaker: 'Elder Pepe', text: "The rumbling's stopped. I felt it in my knees before I heard it. You did that, Sproto?", next: 'scrapjaw_thanks' };
  elder.nodes.scrapjaw_thanks = { speaker: 'Elder Pepe', text: "Then Sproutvale sleeps easy tonight. Take this ember from the beast's furnace, and keep that staff close. Foreman Bram's crew are back at the quarry, and he swears the ground still isn't right." };
  elder.nodes.scrapjaw_after = { speaker: 'Elder Pepe', text: 'Listen to that quiet. Best sound a harvest ever had.' };
  d.captain_agent.nodes.after.do = [{ startQuest: 'q_scrapjaw' }];
}

export const QUARRY_GATE_LOCK: ObjectDef = {
  id: 'quarry_gate_lock',
  name: 'Quarry Gate',
  verb: 'Unlock',
  model: 'gate_lock',
  requires: [{ flag: 'gate.quarry.key' }],
  refusal: 'The gate is locked. It takes the Quarry Key.',
  effects: [{ startQuest: 'q_scrapjaw' }, { openGate: 'quarry' }],
};

/** The four pillars, on the diagonals, close enough in for Scrapjaw to walk the gap behind them. */
const PILLAR_RING = 10.5;

/** The boss, the gate, the pillars and the quest's volumes. */
export function addScrapjawContent(c: RegionContent): void {
  const [x, z] = QUARRY_CENTRE;
  c.enemies.push({ id: 'scrapjaw', def: 'scrapjaw', pos: [x, FLOOR_Y, z], yaw: Math.PI });
  (c.objects ??= []).push({ id: 'quarry_gate_lock', pos: [347.6, GATE_Y, 411.7], yaw: GATE_YAW });
  const obstacles = (c.obstacles ??= []);
  obstacles.push({
    id: 'gate_quarry', model: 'gate_barrier', pos: [GATE_AT[0], GATE_Y, GATE_AT[1]], yaw: GATE_YAW,
    shape: { kind: 'box', half: [10, 7, 1.2], yaw: GATE_YAW }, openFlag: 'gate:quarry',
  });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    obstacles.push({
      id: `quarry_pillar_${i}`, model: 'quarry_pillar', pos: [x + Math.sin(a) * PILLAR_RING, FLOOR_Y, z + Math.cos(a) * PILLAR_RING], yaw: a,
      shape: { kind: 'cylinder', radius: 3, height: 8 }, breakable: true,
    });
  }
  c.triggers.push(
    { id: 'quarry_gate_shrine', pos: [318, 10.27, 390], radius: 14 },
    { id: 'old_quarry', pos: [x, FLOOR_Y, z], radius: 20 },
  );
}
