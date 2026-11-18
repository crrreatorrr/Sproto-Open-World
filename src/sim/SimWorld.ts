import { PLAYER_STATS } from '../content/combat';
import { ENEMIES, type EnemyMoveDef } from '../content/enemies';
import type { LevelDef } from '../content/sandbox';
import { DT, MOVE, PLAYER_BODY } from '../content/tuning';
import { enemyBrains, muzzle } from './ai/brain';
import type { CommandMap } from './commands';
import { resolveAttacks } from './combat/hits';
import { lockOn } from './combat/lockon';
import { playerCombat, type CombatCtx, type Motion } from './combat/playerCombat';
import { stepProjectiles } from './combat/projectiles';
import type { Combat, Entity, EntityId, PlayerId, Team } from './entity';
import type { SimEvent } from './events';
import { hashValue } from './hash';
import type { Vec3 } from './math';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Rng, type RngState } from './rng';
import { locomotion } from './systems/locomotion';
import { vitals } from './systems/vitals';
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
      vitals: { hp: PLAYER_STATS.hp, hpMax: PLAYER_STATS.hp, stamina: PLAYER_STATS.stamina, staminaMax: PLAYER_STATS.stamina, mana: PLAYER_STATS.mana, manaMax: PLAYER_STATS.mana, staminaDelay: 0 },
      combat: newCombat('player', 1, 1, PLAYER_STATS.defense, PLAYER_STATS.level),
      view: { model: 'player' },
    };
    this.add(e);
    this.players.set(player, e.id);
    this.events.push({ type: 'spawn', entity: e.id });
    return e;
  }

  /** Spawn the level's enemies (the app calls this; bare test worlds stay empty). */
  populate(): void {
    for (const s of this.level.enemies ?? []) this.spawnEnemy(s.def, { x: s.pos[0], y: s.pos[1], z: s.pos[2] }, s.yaw);
  }

  spawnEnemy(defId: string, pos: Vec3, yaw = 0): Entity {
    const def = ENEMIES[defId];
    if (!def) throw new Error(`unknown enemy ${defId}`);
    const e: Entity = {
      id: this.nextId++,
      kind: 'enemy',
      tf: { pos: { ...pos }, prevPos: { ...pos }, yaw, prevYaw: yaw, vel: { x: 0, y: 0, z: 0 } },
      body: { ...def.body },
      loco: { grounded: true, sprinting: false, jumpBuffer: 0, coyote: 0, speed: 0, landedTicks: 1 },
      vitals: { hp: def.hp, hpMax: def.hp, stamina: 100, staminaMax: 100, mana: 0, manaMax: 0, staminaDelay: 0 },
      combat: newCombat('enemy', def.poise, def.poise, def.defense, def.level),
      brain: { def: defId, home: { ...pos }, homeYaw: yaw, state: 'idle', target: null, cooldowns: {}, recent: [], circle: 0, circleDir: 1, timer: 30 },
      view: { model: def.model },
    };
    this.add(e);
    this.events.push({ type: 'spawn', entity: e.id });
    return e;
  }

  private spawnProjectile(owner: Entity, move: EnemyMoveDef, target: Entity): void {
    if (!move.projectile) return;
    const from = muzzle(owner, move);
    const aim = { x: target.tf.pos.x, y: target.tf.pos.y + (target.body?.height ?? 1.8) * 0.55, z: target.tf.pos.z };
    const d = { x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const sp = move.projectile.speed;
    const e: Entity = {
      id: this.nextId++,
      kind: 'projectile',
      tf: { pos: from, prevPos: { ...from }, yaw: owner.tf.yaw, prevYaw: owner.tf.yaw, vel: { x: (d.x / len) * sp, y: (d.y / len) * sp, z: (d.z / len) * sp } },
      projectile: {
        owner: owner.id, team: owner.combat!.team, kind: move.kind, damage: move.damage, poise: move.poise, radius: move.projectile.radius,
        life: Math.ceil(move.projectile.range / (sp * DT)), reflected: false,
      },
      view: { model: 'coin' },
    };
    this.add(e);
    this.events.push({ type: 'fire', entity: owner.id, projectile: e.id });
  }

  private remove(id: EntityId): void {
    const i = this.entities.findIndex((e) => e.id === id);
    if (i < 0) return;
    const e = this.entities[i];
    if (e.body) this.physics.removeCharacter(id);
    this.entities.splice(i, 1);
    this.byId.delete(id);
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
    // Hit-stop: frozen entities skip this tick entirely (their clocks don't run).
    const frozen = new Set<number>();
    for (const e of this.entities) {
      if (e.combat && e.combat.hitstop > 0) {
        e.combat.hitstop--;
        frozen.add(e.id);
      }
    }
    const motion = new Map<number, Motion>();
    const ctx: CombatCtx = { now: this.now, entities: this.entities, get: (id) => this.byId.get(id), events: this.events, motion, frozen };
    lockOn(ctx, commands, this.physics);
    playerCombat(ctx, commands);
    enemyBrains(ctx, this.rng.stream('ai'), (o, m, t) => this.spawnProjectile(o, m, t));
    locomotion(this.entities, commands, this.physics, this.events, motion, frozen);
    this.physics.step();
    resolveAttacks(ctx, this.physics);
    for (const id of stepProjectiles(ctx, this.physics)) this.remove(id);
    vitals(this.entities, frozen);
    this.respawns();
    this.fallGuard();
    this.now++;
  }

  /**
   * Sandbox deaths (plan §2.9): the player respawns at the spawn point after 2 s with full
   * resources and the yard resets; an enemy respawns at home after its own delay.
   */
  private respawns(): void {
    const player = this.entities.find((e) => e.kind === 'player' && e.combat?.action?.kind === 'dead');
    if (player && player.combat!.action!.kind === 'dead' && player.combat!.action!.t >= PLAYER_STATS.respawnTicks) {
      this.reset(player, this.spawnPoint(), this.level.spawn.yaw);
      for (const e of this.entities) if (e.brain) this.reset(e, e.brain.home, e.brain.homeYaw);
      for (const e of [...this.entities]) if (e.projectile) this.remove(e.id);
      this.events.push({ type: 'respawn', entity: player.id });
    }
    for (const e of this.entities) {
      const a = e.combat?.action;
      if (!e.brain || a?.kind !== 'dead' || a.t < ENEMIES[e.brain.def].respawnTicks) continue;
      this.reset(e, e.brain.home, e.brain.homeYaw);
      this.events.push({ type: 'respawn', entity: e.id });
    }
  }

  private reset(e: Entity, pos: Readonly<Vec3>, yaw: number): void {
    e.tf.pos = { ...pos };
    e.tf.prevPos = { ...pos };
    e.tf.vel = { x: 0, y: 0, z: 0 };
    e.tf.yaw = e.tf.prevYaw = yaw;
    this.physics.teleport(e.id, e.tf.pos);
    const v = e.vitals;
    if (v) {
      v.hp = v.hpMax;
      v.stamina = v.staminaMax;
      v.mana = v.manaMax;
      v.staminaDelay = 0;
    }
    const c = e.combat;
    if (c) {
      c.action = null;
      c.buffer = null;
      c.hitstop = 0;
      c.poise = c.poiseMax;
      c.push = null;
      c.lock = null;
      c.critNext = false;
    }
    if (e.brain) {
      e.brain.state = 'idle';
      e.brain.target = null;
      e.brain.cooldowns = {};
      e.brain.recent = [];
      e.brain.circle = 0;
      e.brain.timer = 30;
      e.brain.stepIn = undefined;
    }
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

function newCombat(team: Team, poise: number, poiseMax: number, defense: { physical: number; arcane: number }, level: number): Combat {
  return {
    team, action: null, buffer: null, hitstop: 0, poise, poiseMax, poiseDelay: 0, defense: { ...defense }, level,
    lastBlockTick: -999, riposteUntil: 0, critNext: false, lock: null, lockLostTicks: 0, push: null, lastHitTick: -999,
  };
}
