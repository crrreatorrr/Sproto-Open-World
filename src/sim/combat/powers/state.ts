import type { EntityId } from '../../entity';

/** A combatant's running C3 effects. Absent until a power touches it; every field goes when it ends. */
export interface PowerState {
  /** Mirror Ward's bubble: ticks since it rose, and how long it lasts. */
  ward?: { t: number; dur: number };
  /** Seeker Swarm: ticks left. */
  swarm?: number;
  /** Static Snare: ticks left rooted. */
  rooted?: number;
  /** Sprout Surge's meter, 0 to POWER.surge.max. */
  surge?: number;
}

export interface WallArea {
  kind: 'wall';
  owner: EntityId;
  age: number;
  life: number;
  /** Ticks until the thorns next bite. */
  pulse: number;
  /** One thorn pulse's damage before defense. */
  thorns: number;
}

export interface BloomArea {
  kind: 'bloom';
  owner: EntityId;
  age: number;
  life: number;
  /** Fraction of max HP per tick. */
  healPerTick: number;
  /** Ticks left of the pause a cast causes. */
  pause: number;
}

export interface WaveArea {
  kind: 'surge';
  owner: EntityId;
  radius: number;
  damage: number;
  /** Enemies the wave already passed. */
  hit: EntityId[];
}

/** A power's ground effect: its own entity, so snapshots and the state hash carry it. */
export type PowerArea = WallArea | BloomArea | WaveArea;
