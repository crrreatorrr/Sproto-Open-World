import type { LevelDef } from '../content/sandbox';
import { MOVE, PLAYER_BODY } from '../content/tuning';
import type { CommandMap } from './commands';
import type { Entity, EntityId, PlayerId } from './entity';
import type { SimEvent } from './events';
import { hashValue } from './hash';
import type { Vec3 } from './math';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Rng, type RngState } from './rng';
import { locomotion } from './systems/locomotion';
import type { ReadonlySimView } from './view';

export interface SimSnapshot {
  now: number;
  nextId: number;
  entities: Entity[];
  players: [PlayerId, EntityId][];
  rng: Record<string, RngState>;
}

/**
 * The whole gameplay simulation (plan §2.2). `tick()` advances exactly one 60 Hz step from the
 * commands it is given; nothing else changes gameplay state. Pure: no three.js, DOM, clock or
 * Math.random (tests/architecture.test.ts). Call `initPhysics()` before constructing one.
 */
export class SimWorld {
  now = 0;
  entities: Entity[] = [];
  events: SimEvent[] = [];
  readonly rng: Rng;
  readonly physics: PhysicsWorld;
  private nextId = 1;
  private readonly byId = new Map<EntityId, Entity>();
  private readonly players = new Map<PlayerId, EntityId>();
  private readonly roView: ReadonlySimView;

  constructor(readonly level: LevelDef, readonly seed = 1) {
    this.rng = new Rng(seed);
    this.physics = new PhysicsWorld(level);
    // Closures over the world (not `this` aliases): the view stays live as state changes.
    const get = () => this;
    this.roView = {
      get now() {
        return get().now;
      },
      get entities() {
        return get().entities;
      },
      get events() {
        return get().events;
      },
      get: (id) => this.byId.get(id),
      playerEntity: (p) => this.playerEntity(p),
      raycast: (o, d, m) => this.physics.raycast(o, d, m),
      sphereCast: (o, d, r) => this.physics.sphereCast(o, d, r),
      hash: () => this.hash(),
    };
  }

  view(): ReadonlySimView {
    return this.roView;
  }

  get(id: EntityId): Entity | undefined {
    return this.byId.get(id);
  }

  playerEntity(player: PlayerId): Entity | undefined {
    const id = this.players.get(player);
    return id === undefined ? undefined : this.byId.get(id);
  }

  spawnPlayer(player: PlayerId, pos: Vec3 = this.spawnPoint(), yaw = this.level.spawn.yaw): Entity {
    const e: Entity = {
      id: this.nextId++,
      kind: 'player',
      owner: player,
      tf: { pos: { ...pos }, prevPos: { ...pos }, yaw, prevYaw: yaw, vel: { x: 0, y: 0, z: 0 } },
      body: { radius: PLAYER_BODY.radius, height: PLAYER_BODY.height },
      loco: { grounded: true, sprinting: false, jumpBuffer: 0, coyote: 0, speed: 0, landedTicks: 1 },
      view: { model: 'player' },
    };
    this.add(e);
    this.players.set(player, e.id);
    this.events.push({ type: 'spawn', entity: e.id });
    return e;
  }

  private spawnPoint(): Vec3 {
    const [x, y, z] = this.level.spawn.pos;
    return { x, y, z };
  }

  private add(e: Entity): void {
    this.entities.push(e);
    this.byId.set(e.id, e);
    if (e.body) this.physics.addCharacter(e.id, e.body, e.tf.pos);
  }

  /** Advance one tick (plan §2.3 system order; later milestones fill in the other systems). */
  tick(commands: CommandMap): void {
    this.events = [];
    for (const e of this.entities) {
      e.tf.prevPos.x = e.tf.pos.x;
      e.tf.prevPos.y = e.tf.pos.y;
      e.tf.prevPos.z = e.tf.pos.z;
      e.tf.prevYaw = e.tf.yaw;
    }
    locomotion(this.entities, commands, this.physics, this.events);
    this.physics.step();
    this.fallGuard();
    this.now++;
  }

  /** Anything that falls out of the world goes back to the spawn point. */
  private fallGuard(): void {
    for (const e of this.entities) {
      if (e.tf.pos.y >= MOVE.killY) continue;
      const p = this.spawnPoint();
      e.tf.pos = { ...p };
      e.tf.prevPos = { ...p };
      e.tf.vel = { x: 0, y: 0, z: 0 };
      this.physics.teleport(e.id, p);
    }
  }

  /** Hash of the sim state (entities, players, rng streams, tick). Not Rapier's internals. */
  hash(): number {
    return hashValue({ now: this.now, entities: this.entities, players: [...this.players], rng: this.rng.streams });
  }

  snapshot(): SimSnapshot {
    return structuredClone({
      now: this.now,
      nextId: this.nextId,
      entities: this.entities,
      players: [...this.players],
      rng: this.rng.streams,
    });
  }

  /** Restore a snapshot; Rapier character bodies are rebuilt from the entities. */
  restore(s: SimSnapshot): void {
    const copy = structuredClone(s);
    this.physics.removeAllCharacters();
    this.now = copy.now;
    this.nextId = copy.nextId;
    this.entities = [];
    this.byId.clear();
    this.players.clear();
    for (const e of copy.entities) this.add(e);
    for (const [p, id] of copy.players) this.players.set(p, id);
    for (const k of Object.keys(this.rng.streams)) delete this.rng.streams[k];
    Object.assign(this.rng.streams, copy.rng);
    this.events = [];
  }

  dispose(): void {
    this.physics.dispose();
  }
}
