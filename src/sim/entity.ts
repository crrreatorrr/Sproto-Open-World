import type { DamageKind, PlayerMoveId } from '../content/combat';
import type { AffixId } from '../content/packs/c4';
import type { SkillRanks } from '../content/progression';
import type { QuestState } from '../content/quests';
import type { SpellId } from '../content/spells';
import type { StatusId } from '../content/statuses';
import type { PowerArea, PowerState } from './combat/powers/state';
import type { Vec3 } from './math';

export type EntityId = number;
export type PlayerId = number;
export type EntityKind = 'player' | 'enemy' | 'boss' | 'npc' | 'projectile' | 'area' | 'pickup' | 'interactable' | 'mount';
export type Team = 'player' | 'enemy';

/** Transform. `prevPos` is the position at the start of the tick (render interpolation). */
export interface Transform {
  pos: Vec3;
  prevPos: Vec3;
  yaw: number;
  prevYaw: number;
  vel: Vec3;
}

/** A capsule body. Its Rapier collider lives in sim/physics, keyed by entity id. */
export interface Body {
  radius: number;
  height: number;
}

/** Ground movement state. */
export interface Locomotion {
  grounded: boolean;
  sprinting: boolean;
  /** Ticks left in which a jump press still counts (pressed just before landing). */
  jumpBuffer: number;
  /** Ticks left after walking off a ledge in which a jump still works. */
  coyote: number;
  /** Planar speed this tick (m/s), for animation. */
  speed: number;
  /** Ticks since the last landing (0 while airborne). */
  landedTicks: number;
}

export interface Vitals {
  hp: number;
  hpMax: number;
  stamina: number;
  staminaMax: number;
  mana: number;
  manaMax: number;
  /** Ticks until stamina regenerates again. */
  staminaDelay: number;
}

/** What a combatant is doing. `null` means free (locomotion). Ticks count from the action's start. */
export type Action =
  /** Getting on or off the bull (the rider's `riding.state` says which). */
  | { kind: 'mounting'; t: number; dur: number }
  | {
      kind: 'attack';
      /** Player move id, or an enemy move id. */
      move: PlayerMoveId | string;
      t: number;
      /** Clip tick (player moves; frozen while charging). */
      clipT: number;
      /** Ticks the heavy has been held in its charge window. */
      charge: number;
      charging: boolean;
      /** The charged version (decided on release). */
      charged: boolean;
      /** Entities already hit by this attack. */
      hit: EntityId[];
      /** Lunge left to apply during startup (m), and its direction. */
      lunge: number;
      lungeDir: { x: number; z: number };
      /** Player moves: the enemy the lunge follows through startup, and how far it may still go (m). */
      lungeTarget?: EntityId;
      lungeLeft?: number;
      /** Player moves: the swing has landed on someone. */
      connected?: true;
      /** Enemy moves: projectiles fired so far. */
      fired?: number;
      /** Enemy area moves: where the circle was placed when the wind-up started. */
      aim?: Vec3;
    }
  | {
      /** Casting a spell (upper body; the player may walk slowly). */
      kind: 'cast';
      spell: SpellId;
      t: number;
      /** Tick the spell releases (half for a woven cast). */
      release: number;
      woven: boolean;
      released: boolean;
      /** Charged Bolt: ticks the release has been held back. */
      charge?: number;
      /** A held power (Ember Breath) after its release: ticks breathed, and the longest it can go. */
      channel?: { t: number; dur: number };
    }
  /** A roll, or with `back` a backstep (dodge with no stick direction): its frames are `dodgeFrames`. */
  | { kind: 'dodge'; t: number; dir: { x: number; z: number }; back?: boolean }
  /** The Momentum staff's blink: already moved, untouchable until it ends. */
  | { kind: 'blink'; t: number }
  /** The plunge attack: diving from `fromY`; `landT` counts from the landing (−1 while in the air). */
  | { kind: 'plunge'; t: number; fromY: number; landT: number }
  | { kind: 'block'; t: number; parryTicks: number }
  | { kind: 'hitstun'; t: number; dur: number; knockdown: boolean }
  /**
   * `broken`: its poise broke (bosses take more damage). `stunned`: it ran into something (weak spots
   * open). `parried`: its blow was parried (a riposte hits it hardest).
   */
  | { kind: 'stagger'; t: number; dur: number; reason?: 'broken' | 'stunned' | 'parried'; /** This break's critical has been dealt. */ critTaken?: true }
  | { kind: 'frozen'; t: number; dur: number }
  /** Drinking a Sprout Tonic: locked for TONIC.lockTicks, healing over TONIC.healTicks. */
  | { kind: 'drink'; t: number; healPerTick: number }
  | { kind: 'dead'; t: number };

export type BufferedAction = 'light' | 'heavy' | 'dodge' | 'spell1' | 'spell2' | 'spell3' | 'spell4';

export interface Buffered {
  action: BufferedAction;
  /** Ticks it still lives (counts down; frozen during hit-stop). */
  ttl: number;
  /** Pressed after the current attack's activeStart: held until its cancel opens. */
  untilCancel: boolean;
}

export interface Combat {
  team: Team;
  action: Action | null;
  buffer: Buffered | null;
  /** Ticks of hit-stop left: the entity is frozen (action, buffer and movement). */
  hitstop: number;
  poise: number;
  poiseMax: number;
  /** Ticks until poise refills. */
  poiseDelay: number;
  defense: { physical: number; arcane: number };
  level: number;
  /** Tick of the last block press (parry spam). */
  lastBlockTick: number;
  /** Block was held last tick: a press is block going down, whatever the entity was doing. */
  blockHeld: boolean;
  /** How long the last block press can parry for, counted from `lastBlockTick` (ticks). */
  blockPressTicks: number;
  /** A heavy press before this tick is a riposte. */
  riposteUntil: number;
  /** The enemy the last parry stunned: the riposte goes for it. */
  riposteTarget: EntityId | null;
  /** A heavy press before this tick is a guard counter (a melee blow was just blocked). */
  guardCounterUntil: number;
  /** The next landed hit is a critical (perfect dodge). */
  critNext: boolean;
  /** Hard lock target. */
  lock: EntityId | null;
  /** Ticks the lock target has been out of sight. */
  lockLostTicks: number;
  /** Pushback still to apply (m/tick) and ticks left. */
  push: { x: number; z: number; ticks: number } | null;
  /** Tick of the last melee hit this entity landed (a spell within WOVEN.window of it is woven). */
  lastHitTick: number;
  /** Spell cooldowns: ticks left per spell. */
  cooldowns: Partial<Record<SpellId, number>>;
  /** The last tick an enemy targeted this entity (the gear lock, expansion plan §1.1). */
  targetedAt: number;
  /** The Momentum staff's blink is ready again from this tick. */
  blinkReadyAt?: number;
  /** A light or heavy press before this tick is a counter (a perfect dodge just happened). */
  counterUntil?: number;
  /** The swing that just finished: a press before `comboUntil` continues its string. */
  comboFrom?: PlayerMoveId;
  comboUntil?: number;
}

/** The player's RPG state (plan §5). Saved in the SaveFile. */
export interface Progress {
  level: number;
  /** Total XP earned. */
  xp: number;
  /** Skill ranks (expansion plan §7): Magic (Spell Power, Protection, Focus) and Combat (Attack, Defense, Stamina). */
  skills: SkillRanks;
  /** Skill points to spend (anywhere, on the Skills tab). */
  points: number;
  sprouts: number;
  equipment: { staff: string; robe: string; charm: string | null };
  /** Item id → count. */
  inventory: Record<string, number>;
  /** Known spells. */
  spells: SpellId[];
  /** The four equipped spell slots (expansion plan §1.1): each null or a known spell, no duplicates. */
  loadout: (SpellId | null)[];
  tonics: { charges: number; max: number };
  quests: Record<string, QuestState>;
  tracked: string | null;
  /** The shrine the player last rested at (respawn point), and every shrine found. */
  lastShrine: string | null;
  discoveredShrines: string[];
  /** Talking: the NPC and the dialogue node the sim's cursor is on. */
  dialogue: { npc: string; node: string } | null;
  /** An open merchant shop (buy commands are accepted only while it is open). */
  shop: string | null;
  /** At a shrine (Rest / Skills menu): which one. */
  atShrine: string | null;
}

/** World flags and per-session world state (plan §2.8). */
export interface WorldState {
  flags: Record<string, number>;
  openedChests: string[];
  killedUniques: string[];
}

/** `object`: a one-use world object a quest points at (a beacon, a lever, a tome). */
export type InteractKind = 'shrine' | 'chest' | 'object';

/** Something the player can interact with (F / pad Y) in reach. */
export interface Interactable {
  /** Content id (the shrine's or chest's id). */
  id: string;
  kind: InteractKind;
  /** Chests and objects: used already (then not interactable). */
  used: boolean;
}

/** A rideable animal. It has no body of its own: while ridden it follows its rider. */
export interface Mount {
  rider: EntityId | null;
  home: Vec3;
  homeYaw: number;
  /** Planar speed (m/s), for its legs. */
  speed: number;
}

/** On a mount, or getting on or off it. */
export interface Riding {
  mount: EntityId;
  state: 'mounting' | 'riding' | 'dismounting';
  /** Dismounting: the way off (unit, world). */
  dir: { x: number; z: number };
}

/** A talkable NPC. */
export interface Npc {
  id: string;
}

/** Something lying on the ground, picked up by walking over it. */
export interface Pickup {
  kind: 'sprouts' | 'heart' | 'item';
  item?: string;
  amount: number;
  /** Ticks left before it disappears. */
  life: number;
}

/** Status effects on an entity (plan §4.7). Absent = not affected. */
export interface Statuses {
  burn?: { ticks: number; /** HP per tick. */ perTick: number; source: EntityId };
  chill?: { ticks: number; stacks: number };
  shock?: { ticks: number };
  /** Chill's slow accumulates fractional ticks here (an action only advances on whole ticks). */
  slowAcc?: number;
}

/** Enemy brain state (plan §4.8). */
export interface EnemyBrain {
  def: string;
  home: Vec3;
  homeYaw: number;
  state: 'idle' | 'engage' | 'leash';
  target: EntityId | null;
  /** Ticks until the next attack may start. */
  cooldowns: Record<string, number>;
  /** The last two moves, so none repeats more than twice in a row. */
  recent: string[];
  /** Strafe ticks left, and direction (+1 / -1). */
  circle: number;
  circleDir: number;
  /** Generic attack timer (dummies). */
  timer: number;
  /** Melee hits taken in a row (the Hex Wisp blinks away after enough). */
  meleeHitsTaken: number;
  /** Close to this gap (m) before attacking, for a short-reach move; 0 = attack from here; unset = not decided yet. */
  stepIn?: number;
  /** The world camp it belongs to (M4): stays dead until the player rests or respawns. */
  camp?: string;
  /** A unique (named) enemy: once killed it never comes back (`WorldState.killedUniques`). */
  unique?: string;
  /** The stat affix its camp rolled (expansion plan §3.6). */
  affix?: AffixId;
  /** Called in by a boss: gone for good once dead, and gone when the fight resets. */
  summoned?: boolean;
}

/** A boss fight in progress (plan §4.10). Lives on the boss, so snapshots and hashes carry it. */
export interface BossState {
  state: 'idle' | 'intro' | 'fight' | 'dead';
  /** Ticks in the intro. */
  t: number;
  phase: number;
  /** Falling rocks stop at this tick; the next one may start at `nextRock`. */
  rocksUntil: number;
  nextRock: number;
  /** The add wave has been called. */
  summoned: boolean;
  /** Underground (dormant, or mid-burrow): nothing can touch it, and it has no collider. */
  under?: boolean;
  /** A boss that flies (the Skyfire Drake): where it is in the air. */
  flight?: DrakeFlight;
}

/** The Skyfire Drake's flight (expansion plan §3.5). */
export interface DrakeFlight {
  /** `orbit`: circling the player. `dive`: on a lane. `glide`: Broken, low over the field. `stall`: held by a stagger. */
  mode: 'orbit' | 'dive' | 'glide' | 'stall';
  /** The circle it flies: where on it (radians), which way round (+1 / -1) and its centre. */
  angle: number;
  dir: number;
  cx: number;
  cz: number;
  /** The ground under it, smoothed (m). */
  ground: number;
  /** The dive's line on the ground: its two ends and the ground height along it, end to end. */
  lane: { ax: number; az: number; bx: number; bz: number; ys: number[] } | null;
  /** The line of a Broken glide. */
  glide: { ax: number; az: number; bx: number; bz: number } | null;
}

/** A danger on the ground that belongs to a boss (plan §4.10). */
export interface Hazard {
  /** `rock`: lands after `fuse` ticks and hits once. `burn`: burns whoever stands in it until `life` runs out. */
  kind: 'rock' | 'burn';
  owner: EntityId;
  radius: number;
  /** Ticks until a rock lands (0 once it has). */
  fuse: number;
  /** The fuse at the start (the telegraph's fill). */
  fuseMax: number;
  /** Ticks until it is removed. */
  life: number;
  damage: number;
}

/**
 * A static collider that can come and go (expansion plan §3.3): a gate barrier that stands until its
 * world flag is set, or a pillar a boss's charge can smash. Rapier's copy is derived from this.
 */
export interface Obstacle {
  id: string;
  shape: { kind: 'box'; half: [number, number, number]; yaw: number } | { kind: 'cylinder'; radius: number; height: number };
  /** The world flag that opens it for good (a gate). */
  openFlag?: string;
  /** A boss's charge smashes it. */
  breakable?: boolean;
  /** Smashed: no collider, until the fight resets. */
  broken: boolean;
}

export interface Projectile {
  owner: EntityId;
  team: Team;
  kind: DamageKind;
  damage: number;
  poise: number;
  radius: number;
  /** Ticks left before it fizzles. */
  life: number;
  reflected: boolean;
  /** A player spell (bolt, blast orb) rather than an enemy shot. */
  spell?: SpellId;
  /** Explodes on impact (or at the end of its range) with this radius. */
  explode?: number;
  /** Turns toward `target` at this rate (rad/s). */
  homing?: number;
  target?: EntityId;
  /** Status applied on hit: id and stacks. */
  status?: { id: StatusId; stacks: number };
  /** Interrupts a ranged wind-up it hits. */
  interrupts?: boolean;
  knockdown?: boolean;
  woven?: boolean;
  /** Parried back into `shooter`: takes this fraction of its max HP and staggers it (Scrap Throw). */
  reflectBonus?: { hpFrac: number; stagger: number; shooter: EntityId; poiseFrac?: number; homing?: number };
}

/**
 * Plain-data entity with optional components (plan §2.4). Everything here is cloneable and
 * hashable; nothing holds a class instance, a function or a three.js object.
 */
export interface Entity {
  id: EntityId;
  kind: EntityKind;
  tf: Transform;
  body?: Body;
  loco?: Locomotion;
  vitals?: Vitals;
  combat?: Combat;
  brain?: EnemyBrain;
  projectile?: Projectile;
  statuses?: Statuses;
  /** Running C3 power effects (a ward, a root, the Surge meter). */
  powers?: PowerState;
  /** This entity is a C3 power's ground effect (a thorn wall, a flower patch, a surge wave). */
  powerArea?: PowerArea;
  progress?: Progress;
  interactable?: Interactable;
  npc?: Npc;
  mount?: Mount;
  riding?: Riding;
  pickup?: Pickup;
  boss?: BossState;
  hazard?: Hazard;
  obstacle?: Obstacle;
  owner?: PlayerId;
  /**
   * Placed by content at a guessed height: set down on the ground (a raycast) on the tick its cell's
   * colliders are built (M4 camps, villagers, objects). Cleared once settled.
   */
  settle?: true;
  /** Presentation hint only: which model to draw. */
  view: { model: string; tint?: number; scale?: number };
}
