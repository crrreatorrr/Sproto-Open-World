import type { DamageKind, PlayerMoveId } from '../content/combat';
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
      /** Enemy moves: the projectile was fired. */
      fired?: boolean;
    }
  | { kind: 'dodge'; t: number; dir: { x: number; z: number } }
  | { kind: 'block'; t: number; parryTicks: number }
  | { kind: 'hitstun'; t: number; dur: number; knockdown: boolean }
  | { kind: 'stagger'; t: number; dur: number }
  | { kind: 'dead'; t: number };

export type BufferedAction = 'light' | 'heavy' | 'dodge';

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
  /** Tick of the last melee hit this entity landed (woven spells, M1b). */
  lastHitTick: number;
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
  /** Close to this gap (m) before attacking, for a short-reach move; 0 = attack from here; unset = not decided yet. */
  stepIn?: number;
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
  owner?: PlayerId;
  /** Presentation hint only: which model to draw. */
  view: { model: string; tint?: number };
}
