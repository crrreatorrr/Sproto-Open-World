/**
 * Expansion milestone C6 (expansion plan §3.5, §4.2): the Skyfire Drake, boss 3, fought in the air
 * over the Orchard, and quests A10 Smoke on the Hills, A11 Bait and A12 Skyfire.
 *
 * Pure data, and only `import type` from the registries: each shared file merges its table from here
 * with one line, so this module never takes part in an import cycle.
 */
import type { DialogueGraph } from '../dialogue';
import type { EnemyDef, EnemyMoveDef } from '../enemies';
import type { ItemDef } from '../items';
import type { ObjectDef } from '../objects';
import type { QuestDef } from '../quests';
import type { RegionContent } from '../world/sproutvaleContent';

/** How the Drake flies (the brain is sim/systems/drake.ts). */
export interface DrakeDef {
  /** The circle it cruises around the player (m), its speed (m/s), and its height above the ground (m). */
  orbitRadius: number;
  orbitSpeed: number;
  altitude: readonly [number, number];
  /** How much further (flat, m) spells reach it up there. */
  spellReach: number;
  /** Broken: ticks to come down, then ticks gliding `height` m above the field at `speed` m/s (the melee window). */
  glide: { descendTicks: number; ticks: number; height: number; speed: number };
  /** The world flag that brings it down to fight. */
  wakeFlag: string;
}

/** The middle of the Orchard's open field, where the bait post stands. */
export const DRAKE_ARENA: readonly [number, number] = [126, 160];
const ARENA_RADIUS = 30;
/** Ground y guess (placements settle onto the terrain). */
const G = 9.5;
/** The flag the bait post sets. */
export const DRAKE_WAKE_FLAG = 'drake.baited';

const DESCEND_TICKS = 90;
/** The melee window: 6 s low over the field. */
const GLIDE_TICKS = 360;

/** Three reflected fireballs break its stance; each also takes 3% of its health. */
const REFLECT = { hpFrac: 0.03, stagger: 0, poiseFrac: 0.34, homing: 6 };
const FIREBALL = { speed: 15, radius: 0.7, range: 46, model: 'fireball', reflectBonus: REFLECT };
const MOUTH = { forward: 4.5, up: 2.2, radius: 0.3 };
const shot = { kind: 'arcane', poise: 18, hitbox: MOUTH, range: 60, hyperArmor: true, trackUntil: 1, hitstop: 4, clip: 'fireball' } as const;
/** A dive: unblockable, read from the lane on the ground. Step out of it or roll through it. */
const dive = {
  kind: 'physical', active: 108, damage: 62, poise: 60, hitbox: { forward: 0, up: 0, radius: 2.6 }, range: 60, unblockable: true, knockback: 3, hyperArmor: true,
  trackUntil: 0, hitstop: 8, clip: 'fly', dive: { length: 38, low: 1 },
} as const;

const MOVES: EnemyMoveDef[] = [
  // Three fireballs in a fan, far enough apart that one Mirror Ward can only catch one.
  { ...shot, id: 'volley', windup: 46, active: 32, recovery: 40, damage: 28, weight: 3, cooldown: 150, projectile: { ...FIREBALL, count: 3, interval: 16, spread: 0.09 } },
  // One big, slow fireball: the easiest to send back.
  { ...shot, id: 'lance', windup: 60, active: 1, recovery: 50, damage: 48, weight: 2, cooldown: 240, projectile: { ...FIREBALL, speed: 13, radius: 1.1 } },
  // Phase 2 on: five, wider.
  { ...shot, id: 'barrage', phases: [2, 3], windup: 52, active: 48, recovery: 46, damage: 24, weight: 2.5, cooldown: 300, projectile: { ...FIREBALL, count: 5, interval: 12, spread: 0.16 } },
  { ...dive, id: 'dive', phases: [1, 2], windup: 84, recovery: 30, weight: 3, cooldown: 360 },
  // Phase 3: it turns at the end of the lane and comes straight back down a new one.
  { ...dive, id: 'dive_a', phases: [3], windup: 72, recovery: 6, weight: 3.5, cooldown: 420, followUp: 'dive_b' },
  { ...dive, id: 'dive_b', chainOnly: true, windup: 60, recovery: 34, weight: 0, cooldown: 0 },
  // The cry at each phase change.
  {
    id: 'roar', chainOnly: true, kind: 'arcane', windup: 30, active: 40, recovery: 30, damage: 0, poise: 0, hitbox: { forward: 0, up: 3, radius: 0.1 },
    range: 0, weight: 0, cooldown: 0, hyperArmor: true, trackUntil: 1, hitstop: 0, clip: 'fireball', noHit: true,
  },
];

export const DRAKE: EnemyDef = {
  id: 'skyfire_drake',
  name: 'Skyfire Drake',
  model: 'drake',
  xp: 2400,
  hp: 6000,
  // Only reflected fireballs move this much: everything else barely dents it.
  poise: 900,
  elite: true,
  body: { radius: 2.4, height: 5 },
  defense: { physical: 24, arcane: 24 },
  profile: { damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'resist', chill: 'resist', shock: 'weak' } },
  level: 15,
  moveSpeed: 9,
  turnRate: Math.PI * 1.1,
  // Broken: it comes down, then glides for the melee window.
  staggerTicks: DESCEND_TICKS + GLIDE_TICKS,
  brokenDamage: 1.5,
  aggroRange: 60,
  leashRange: 200,
  respawnTicks: 600,
  moves: MOVES,
  lockPoint: { up: 2.6 },
  cameraScale: 1.35,
  boss: {
    title: 'Terror of the Orchard',
    arenaRadius: ARENA_RADIUS,
    introTicks: 200,
    phase2: 0.65,
    phase3: 0.3,
    enrage: 1.25,
    // It fights alone, and nothing falls but itself.
    summon: { def: 'grunt', count: 0, below: 0 },
    roar: 'roar',
    stunTicks: 0,
    gapTicks: 80,
    rocks: { ticks: 0, fuse: 1, radius: 1, damage: 0 },
    // Phase 3's dives leave the lane burning.
    burnPatch: { radius: 3, ticks: 300 },
  },
  drake: {
    orbitRadius: 14,
    orbitSpeed: 9,
    altitude: [12, 20],
    spellReach: 8,
    glide: { descendTicks: DESCEND_TICKS, ticks: GLIDE_TICKS, height: 0.35, speed: 3.4 },
    wakeFlag: DRAKE_WAKE_FLAG,
  },
};

// ---------------------------------------------------------------- items

export const C6_ITEMS: Record<string, ItemDef> = {
  sheep_decoy: { id: 'sheep_decoy', name: 'Sheep Decoy', kind: 'quest', rarity: 'common', blurb: 'Wool on a frame. Convincing from a long way up.', stacks: true },
  charm_drake_scale: { id: 'charm_drake_scale', name: 'Drake Scale', kind: 'charm', rarity: 'epic', blurb: '+12% defense. Rolls cost 10% less stamina.', charm: { defense: 1.12, dodgeStamina: 0.9 } },
  charm_skyfire_heart: {
    id: 'charm_skyfire_heart', name: 'Skyfire Heart', kind: 'charm', rarity: 'epic', blurb: 'Woven spells hit 20% harder, +3 mana per melee hit, and a parry sets the attacker burning.',
    charm: { wovenBonus: 0.2, manaPerHit: 3, burnOnParry: true },
  },
};

// ---------------------------------------------------------------- objects and where they stand

const HAY: readonly (readonly [number, number])[] = [[92, 122], [118, 120], [152, 118], [166, 152], [88, 176]];
const DECOYS: readonly (readonly [number, number])[] = [[184, 138], [62, 178], [142, 216]];

const hayId = (i: number) => `burning_hay_${i + 1}`;
const decoyId = (i: number) => `sheep_decoy_${i + 1}`;

export const C6_OBJECTS: Record<string, ObjectDef> = {
  ...Object.fromEntries(HAY.map((_, i): [string, ObjectDef] => [hayId(i), {
    id: hayId(i), name: 'Burning Haystack', verb: 'Douse', model: 'haystack',
    requires: [{ quest: 'q_smoke_hills', status: 'active', step: 0 }],
    refusal: 'It smoulders. Farmer Broccoli will want to know about this first.',
  }])),
  ...Object.fromEntries(DECOYS.map((_, i): [string, ObjectDef] => [decoyId(i), {
    id: decoyId(i), name: 'Sheep Decoy', verb: 'Take', model: 'sheep_decoy',
    requires: [{ quest: 'q_bait', status: 'active', step: 0 }],
    refusal: 'A wooden sheep. Someone must have a use for it.',
    effects: [{ give: 'sheep_decoy' }],
  }])),
  drake_bait_post: {
    id: 'drake_bait_post', name: 'Bait Post', verb: 'Set', model: 'bait_post',
    requires: [{ quest: 'q_bait', status: 'active', step: 1 }],
    refusal: 'The post is bare. It needs something worth swooping for.',
    effects: [{ setFlag: DRAKE_WAKE_FLAG }],
  },
};

/** The Drake, the quest objects and the arena's volume. */
export function addDrakeContent(c: RegionContent): void {
  const [x, z] = DRAKE_ARENA;
  c.enemies.push({ id: 'skyfire_drake', def: 'skyfire_drake', pos: [x, G, z], yaw: 0 });
  const objects = (c.objects ??= []);
  HAY.forEach(([hx, hz], i) => objects.push({ id: hayId(i), pos: [hx, G, hz], yaw: i * 1.3 }));
  DECOYS.forEach(([dx, dz], i) => objects.push({ id: decoyId(i), pos: [dx, G, dz], yaw: i * 2.1 }));
  objects.push({ id: 'drake_bait_post', pos: [x, G, z], yaw: 0 });
  c.triggers.push({ id: 'drake_arena', pos: [x, G, z], radius: ARENA_RADIUS });
}

// ---------------------------------------------------------------- quests (plan §4.2)

export const C6_QUESTS: Record<string, QuestDef> = {
  // A10: something is setting the Orchard alight.
  q_smoke_hills: {
    id: 'q_smoke_hills',
    title: 'Smoke on the Hills',
    giver: 'farmer_broccoli',
    kind: 'side',
    prereq: [{ questDone: 'q_deep_seam' }],
    steps: [
      {
        id: 'hay', text: 'Douse the 5 burning haystacks around the Orchard.', marker: 'orchard_fields',
        objectives: HAY.map((_, i) => ({ kind: 'interact' as const, object: hayId(i) })),
      },
      { id: 'return', text: 'Tell Farmer Broccoli the fires are out.', objectives: [{ kind: 'talk', npc: 'farmer_broccoli', node: 'a10_done' }], marker: 'farmer_broccoli' },
    ],
    rewards: [{ learnSpell: 'sproutSurge' }, { xp: 700 }, { currency: 120 }],
  },
  // A11: draw it down.
  q_bait: {
    id: 'q_bait',
    title: 'Bait',
    giver: 'farmer_broccoli',
    kind: 'side',
    prereq: [{ questDone: 'q_smoke_hills' }],
    steps: [
      { id: 'decoys', text: 'Collect the 3 Sheep Decoys set out around the Orchard.', objectives: [{ kind: 'collect', item: 'sheep_decoy', count: 3, consume: true }], marker: 'orchard_fields' },
      { id: 'post', text: 'Set the decoys on the bait post in the open field.', objectives: [{ kind: 'interact', object: 'drake_bait_post' }], marker: 'drake_bait_post' },
    ],
    rewards: [{ give: 'charm_drake_scale' }, { xp: 400 }, { startQuest: 'q_skyfire' }],
  },
  // A12: the whole kit.
  q_skyfire: {
    id: 'q_skyfire',
    title: 'Skyfire',
    giver: 'elder_pepe',
    kind: 'main',
    prereq: [{ questDone: 'q_bait' }, { questDone: 'q_deep_seam' }],
    steps: [
      {
        id: 'boss', text: 'Bring down the Skyfire Drake over the Orchard.', objectives: [{ kind: 'kill', tag: 'skyfire_drake', count: 1 }], marker: 'drake_arena',
        onComplete: [{ setFlag: 'boss.drake.dead' }, { skillPoints: 1 }],
      },
      { id: 'elder', text: 'Tell Elder Pepe the sky is clear.', objectives: [{ kind: 'talk', npc: 'elder_pepe', node: 'a12_return' }], marker: 'elder_pepe' },
    ],
    rewards: [{ give: 'charm_skyfire_heart' }, { xp: 1500 }, { currency: 500 }],
  },
};

/** The end card after A12 (the Scrap Rumble's is the first). */
export const SKYFIRE_END_CARD = {
  quest: 'q_skyfire',
  title: 'Skyfire',
  text: 'The Drake is down and the Orchard breathes again. Sproutvale owes you a harvest. Thank you for playing.',
} as const;

// ---------------------------------------------------------------- dialogue

/** Farmer Broccoli gives A10 and A11; Elder Pepe closes A12. Call after M5's and C4's dialogue is in. */
export function registerDrakeDialogue(d: Record<string, DialogueGraph>): void {
  const farmer = d.farmer_broccoli;
  // Ahead of A4's standing offer, so turning that down never hides these.
  const at = farmer.entry.findIndex((r) => r.node === 'a4_offer' || r.node === 'after');
  farmer.entry.splice(
    at, 0,
    { if: [{ quest: 'q_smoke_hills', status: 'active', step: 1 }], node: 'a10_done' },
    { if: [{ quest: 'q_smoke_hills', status: 'active' }], node: 'a10_busy' },
    { if: [{ quest: 'q_bait', status: 'active', step: 1 }], node: 'a11_post' },
    { if: [{ quest: 'q_bait', status: 'active' }], node: 'a11_busy' },
    { if: [{ quest: 'q_bait', status: 'available' }], node: 'a11_offer' },
    { if: [{ quest: 'q_smoke_hills', status: 'available' }], node: 'a10_offer' },
  );
  Object.assign(farmer.nodes, {
    a10_offer: {
      speaker: 'Farmer Broccoli',
      text: 'My haystacks are burning, Sproto, and there is not a cloud in the sky. Five of them, all over the Orchard. Help me put them out?',
      choices: [
        { text: "I'll douse them.", do: [{ startQuest: 'q_smoke_hills' }] },
        { text: 'Another time.' },
      ],
    },
    a10_busy: { speaker: 'Farmer Broccoli', text: 'Five stacks, all smoking. Look up while you work. Something keeps crossing the sun.' },
    a10_done: { speaker: 'Farmer Broccoli', text: 'A drake! I saw it turn over the hills, breathing fire on my hay. Here, take this: all that anger you are carrying, let it out in one great wave.' },
    a11_offer: {
      speaker: 'Farmer Broccoli',
      text: 'That Drake will not come down for hay. It wants meat. I set three wooden sheep around the fields. Put them on the post in the open and it will swoop.',
      choices: [
        { text: "I'll set the bait.", do: [{ startQuest: 'q_bait' }] },
        { text: 'Not yet.' },
      ],
    },
    a11_busy: { speaker: 'Farmer Broccoli', text: 'Three decoys, scattered around the Orchard. Bring them to the post in the open field.' },
    a11_post: { speaker: 'Farmer Broccoli', text: 'The post stands in the middle of the field. Rest first. When those sheep go up, it will come, and it throws fire. Throw it back.' },
  } satisfies DialogueGraph['nodes']);

  const elder = d.elder_pepe;
  // Before the Scrap Rumble's closing line, which would otherwise answer first for good.
  elder.entry.splice(Math.max(0, elder.entry.findIndex((r) => r.node === 'scrapjaw_after')), 0, { if: [{ quest: 'q_skyfire', status: 'complete' }], node: 'a12_after' });
  elder.entry.unshift(
    { if: [{ quest: 'q_skyfire', status: 'active', step: 1 }], node: 'a12_return' },
    { if: [{ quest: 'q_skyfire', status: 'active' }], node: 'a12_busy' },
    { if: [{ quest: 'q_skyfire', status: 'available' }], node: 'a12_offer' },
  );
  Object.assign(elder.nodes, {
    a12_offer: {
      speaker: 'Elder Pepe',
      text: 'The Drake has tasted Sproutvale, and it will not stop at haystacks. Bring it down, Sproto, before it finds the village.',
      choices: [
        { text: 'It ends over the Orchard.', do: [{ startQuest: 'q_skyfire' }] },
        { text: 'Not yet.' },
      ],
    },
    a12_busy: { speaker: 'Elder Pepe', text: 'Throw its fire back at it. When it falters it will come down low, and then your staff can reach it.' },
    a12_return: { speaker: 'Elder Pepe', text: 'I watched it fall from here. The whole valley watched. In all my years, Sproto, I never thought to see the sky so quiet.', next: 'a12_thanks' },
    a12_thanks: { speaker: 'Elder Pepe', text: "This was at the heart of its fire. It's yours now. Sproutvale will tell this one for a long, long time." },
    a12_after: { speaker: 'Elder Pepe', text: 'Blue sky, full barns and no smoke. Best harvest I can remember.' },
  } satisfies DialogueGraph['nodes']);
}
