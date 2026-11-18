import type { DamageKind, PlayerMoveId } from '../content/combat';
import type { Attr } from '../content/progression';
import type { QuestState } from '../content/quests';
import type { SpellId } from '../content/spells';
import type { StatusId } from '../content/statuses';
import type { Vec3 } from './math';

export type EntityId = number;
export type PlayerId = number;
export type EntityKind = 'player' | 'enemy' | 'boss' | 'npc' | 'projectile' | 'area' | 'pickup' | 'interactable';
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
    }
  | { kind: 'dodge'; t: number; dir: { x: number; z: number } }
  | { kind: 'block'; t: number; parryTicks: number }
  | { kind: 'hitstun'; t: number; dur: number; knockdown: boolean }
  | { kind: 'stagger'; t: number; dur: number }
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
  /** Tick the last block was raised (parry spam). */
  lastBlockTick: number;
  /** A heavy press before this tick is a riposte. */
  riposteUntil: number;
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
}

/** The player's RPG state (plan §5). Saved in the SaveFile. */
export interface Progress {
  level: number;
  /** Total XP earned. */
  xp: number;
  attrs: Record<Attr, number>;
  /** Attribute points to spend at a shrine. */
  points: number;
  sprouts: number;
  equipment: { staff: string; robe: string; charm: string | null };
  /** Item id → count. */
  inventory: Record<string, number>;
  spells: SpellId[];
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
  /** At a shrine (Rest / Level up menu): which one. */
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
  progress?: Progress;
  interactable?: Interactable;
  npc?: Npc;
  pickup?: Pickup;
  owner?: PlayerId;
  /**
   * Placed by content at a guessed height: set down on the ground (a raycast) on the tick its cell's
   * colliders are built (M4 camps, villagers, objects). Cleared once settled.
   */
  settle?: true;
  /** Presentation hint only: which model to draw. */
  view: { model: string; tint?: number };
}
