import { PLAYER_STATS } from '../content/combat';
import { classOf, type ClassId } from '../content/classes';
import { ENEMIES, type EnemyMoveDef } from '../content/enemies';
import { affixedMove } from '../content/enemyScale';
import type { LevelDef } from '../content/sandbox';
import { WAVE_CENTRE, WAVE_GAP, WAVES } from '../content/waves';
import { cellKey, cellOf, type CellColliders } from '../content/world/format';
import { DIALOGUE } from '../content/dialogue';
import { MOUNT } from '../content/mounts';
import { NPCS } from '../content/npcs';
import { OBJECTS, usedFlag } from '../content/objects';
import { AFFIXES, CAMP_GENERATION_FLAG } from '../content/packs/c4';
import { DUNGEON_PORTAL_BY_PORTAL_ID } from '../content/packs/overworldMix';
import { ROOTDEEP_PORTALS, isRootdeep, portalUsable } from '../content/packs/rootdeep';
import type { ObstaclePlacement, RegionContent } from '../content/world/sproutvaleContent';
import { SAVE_SCHEMA, type SaveFile } from '../save/schema';
import { getDungeon } from '../content/dungeons/catalog';
import type { DungeonId } from '../content/dungeons/types';
import { gunDef, type GunType } from '../content/guns';
import { createGunRuntimeState, stepGunFire, type GunRuntimeState } from './combat/ballistics';
import { canDualWield, createDualWieldState, stepDualWieldFire } from './combat/dualWield';
import { createDungeonSession, stepDungeon, type DungeonEvent, type DungeonSessionState } from './dungeon/DungeonDirector';
import { computeClassModifiers } from './systems/classSkills';
import { createMovementTechState, stepMovementTech, type MovementTechState } from './systems/movementTech';
import { BTN, idleInput, type InputCommand } from './commands';
import {
  ALL_SPELLS, availableChoices, giveItem, grantXp, interactTarget, newProgress, onKill, pickups, playerRpg, questOffers, questTick, recompute, triggers, type RpgCtx,
  refillTonics,
} from './systems/rpg';
import { questPolish } from './systems/encounters';
import { LENS_PREVIEW_FLAG } from '../content/packs/encounterTune';
import { DT, MOVE, PLAYER_BODY } from '../content/tuning';
import { enemyBrains, muzzle } from './ai/brain';
import type { CommandMap } from './commands';
import { resolveAim } from './combat/aim';
import { kill, resolveAttacks, resolveHit } from './combat/hits';
import { lockOn } from './combat/lockon';
import { playerCombat, type CombatCtx, type Motion } from './combat/playerCombat';
import { wallBarrier } from './combat/powers/bramble';
import { stepPowers } from './combat/powers/index';
import { stepProjectiles } from './combat/projectiles';
import { applyStatus, tickStatuses } from './combat/statuses';
import { defaultAbilities, defaultAmmo, type Combat, type Entity, type EntityId, type Hazard, type PlayerId, type Team, type WorldState } from './entity';
import type { SimEvent } from './events';
import { hashValue } from './hash';
import type { Vec3 } from './math';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Rng, type RngState } from './rng';
import { applyAffix, rollCampAffix } from './systems/affixes';
import { stepHazards } from './combat/hazards';
import { bossArena, bossEngaged, newBossState, type BossHost } from './systems/boss';
import { locomotion } from './systems/locomotion';
import { gearLocked, markTargeted } from './systems/loadout';
import { relicSlowTick } from './systems/relics';
import { mountCalls, MOUNT_RUNNER } from './systems/mountCall';
import { cancelMount, followRiders, ridingMotion } from './systems/riding';
import { vitals } from './systems/vitals';
import { godVitals } from './systems/god';
import { SHRINE_ARRIVE_OFFSET, wieldsPhone } from './systems/travel';
import type { ReadonlySimView } from './view';

/** The wave runner's state (`?sandbox=1`). */
export interface WaveState {
  /** Index into WAVES of the current (or next) wave. */
  index: number;
  /** Times the wave list has looped (each loop adds a Grunt). */
  loop: number;
  enemiesLeft: number;
  /** Ticks until the next wave arrives (0 while a wave is being fought). */
  nextIn: number;
  /** The current wave's enemies. */
  ids: EntityId[];
}

export interface SimSnapshot {
  now: number;
  nextId: number;
  entities: Entity[];
  players: [PlayerId, EntityId][];
  rng: Record<string, RngState>;
  wave: WaveState | null;
  /** Camp members still waiting for their horn. */
  pendingWaves?: { camp: string; def: string; pos: Vec3; yaw: number; wave: number; carry?: string }[];
  world?: WorldState;
  /** `${entityId}:${triggerId}` for every player inside a trigger volume. */
  triggers?: string[];
}

/** Ticks a dead wave enemy lies there before it's removed (wave enemies don't respawn). */
const WAVE_CORPSE_TICKS = 150;
/** A dead camp enemy lies there until a rest, but its body is out of view after this long (render's `CORPSE_TICKS`). */
const CAMP_CORPSE_TICKS = 180;
/** The bull's body as `placeMountBody` wants it. */
const MOUNT_BODY = [MOUNT.bodyHalfWidth, MOUNT.bodyHalfLength, MOUNT.bodyHeight / 2] as const;
/** How far inside the bull's body someone must be to keep it from turning solid (m): leaning on it doesn't count. */
const MOUNT_OVERLAP = 0.03;
/** Settling content placements: rays start this high (m; above any terrain or prop) and go down twice as far. */
const SETTLE_FROM_Y = 200;
/** Most colliders created per tick when cells stream in (plan §3.2); a heightfield counts as one. */
export const CELL_COLLIDERS_PER_TICK = 96;

interface QueuedCell {
  key: string;
  cells: CellColliders;
  bodyMade: boolean;
  /** Next prop shape to add. */
  next: number;
}

/** World flags that hold a tick of this session (the clock restarts at 0 on load), never saved. */
const SESSION_FLAGS: readonly string[] = [LENS_PREVIEW_FLAG];

/** A copy of the world state for a save, or from one, without the session-only flags. */
function savedWorld(world: WorldState): WorldState {
  const copy = structuredClone(world);
  for (const k of SESSION_FLAGS) delete copy.flags[k];
  return copy;
}

/**
 * The whole gameplay simulation (plan §2.2). `tick()` advances exactly one 60 Hz step from the
 * commands it is given; nothing else changes gameplay state. Pure: no three.js, DOM, clock or
 * Math.random (tests/architecture.test.ts). Call `initPhysics()` before constructing one.
 */
export interface GunTickEvent {
  entity: EntityId;
  gunType: GunType;
  fired: boolean;
  hand: 'right' | 'left' | 'single';
  hit: boolean;
  crit: boolean;
  reloadStarted: boolean;
  reloadCompleted: boolean;
}

export class SimWorld {
  now = 0;
  entities: Entity[] = [];
  events: SimEvent[] = [];
  readonly rng: Rng;
  readonly physics: PhysicsWorld;
  private nextId = 1;
  /** Wave runner state, or null outside the wave runner. */
  wave: WaveState | null = null;
  /** Active instanced Campaign Dungeon session (L01-L10), or null outside dungeon mode. */
  dungeon: DungeonSessionState | null = null;
  /** Dungeon events emitted during the most recent tick. */
  dungeonEvents: readonly DungeonEvent[] = [];
  /** Gun fire/hit/reload events emitted during the most recent tick. */
  gunEvents: readonly GunTickEvent[] = [];
  /** Per-player ability-gated movement tech state (Slide, Dash, Double-Jump, Grapple). */
  private readonly moveTech = new Map<PlayerId, MovementTechState>();
  /** Per-player gun runtime state (magazine, reload progress). */
  private readonly gunState = new Map<PlayerId, { gunId: string; runtime: GunRuntimeState }>();
  /** Camp members that wait for a horn (the second Pest Control wave). Part of the snapshot. */
  private pendingWaves: { camp: string; def: string; pos: Vec3; yaw: number; wave: number; carry?: string }[] = [];
  /** World flags, opened chests, killed uniques (plan §2.8). */
  world: WorldState = { flags: {}, openedChests: [], killedUniques: [] };
  /** Region content for the RPG layer: trigger volumes, chest contents, shrine positions. */
  private triggerList: RegionContent['triggers'] = [];
  private readonly insideTriggers = new Set<string>();
  private readonly chests = new Map<string, { items: { item: string; count: number }[]; sprouts?: number }>();
  private readonly places = new Map<string, Vec3>();
  /** Streamed cells whose colliders are fully built, and the ones still being built. */
  private readonly readyCells = new Set<string>();
  private cellQueue: QueuedCell[] = [];
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
      get wave() {
        return get().wave;
      },
      cellAnchors: () => this.cellAnchors(),
      cellReady: (cx, cz) => this.cellReady(cx, cz),
      get waitingForGround() {
        return get().waitingForGround();
      },
      get world() {
        return get().world;
      },
      aimTarget: (pl, ray) => {
        const p = this.playerEntity(pl);
        return p ? (resolveAim(this.entities, this.physics, p, ray).target?.id ?? null) : null;
      },
      interactTarget: (pl) => {
        const p = this.playerEntity(pl);
        const t = p ? interactTarget(p, this.entities) : null;
        return t ? { entity: t.e.id, id: t.id, kind: t.kind, name: t.name } : null;
      },
      dialogueChoices: (pl) => {
        const p = this.playerEntity(pl)?.progress;
        if (!p?.dialogue) return [];
        const node = DIALOGUE[NPCS[p.dialogue.npc]?.dialogue ?? p.dialogue.npc]?.nodes[p.dialogue.node];
        return node ? availableChoices(node, p, this.world) : [];
      },
      locate: (id) => this.locate(id),
      questOffers: (pl) => {
        const p = this.playerEntity(pl)?.progress;
        return p ? questOffers(p, this.world).filter((o) => this.places.has(o.npc)) : [];
      },
      gearLocked: (pl) => {
        const p = this.playerEntity(pl);
        return !!p && gearLocked(p, this.now);
      },
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

  /** Spawn a player of a class (content/classes.ts). A save loaded after this keeps its own class. */
  spawnPlayer(player: PlayerId, pos: Vec3 = this.spawnPoint(), yaw = this.level.spawn.yaw, cls: ClassId = 'wizard'): Entity {
    const e: Entity = {
      id: this.nextId++,
      kind: 'player',
      owner: player,
      tf: { pos: { ...pos }, prevPos: { ...pos }, yaw, prevYaw: yaw, vel: { x: 0, y: 0, z: 0 } },
      body: { radius: PLAYER_BODY.radius, height: PLAYER_BODY.height },
      loco: { grounded: true, sprinting: false, jumpBuffer: 0, coyote: 0, speed: 0, landedTicks: 1 },
      vitals: { hp: PLAYER_STATS.hp, hpMax: PLAYER_STATS.hp, stamina: PLAYER_STATS.stamina, staminaMax: PLAYER_STATS.stamina, mana: PLAYER_STATS.mana, manaMax: PLAYER_STATS.mana, staminaDelay: 0 },
      combat: newCombat('player', 1, 1, PLAYER_STATS.defense, PLAYER_STATS.level),
      // The yard and the wave runner know every spell; a streamed world starts with Bolt.
      progress: newProgress(this.streamed ? ['bolt'] : ALL_SPELLS, cls),
      view: { model: classOf(cls).model },
    };
    recompute(e);
    this.add(e);
    this.players.set(player, e.id);
    this.events.push({ type: 'spawn', entity: e.id });
    return e;
  }

  /**
   * Spawn a streamed region's RPG content (plan M3): NPCs, shrines, chests, enemies and trigger
   * volumes. (A streamed world's player already starts with Bolt only; the rest are learned.)
   */
  populateWorld(content: RegionContent): void {
    for (const n of content.npcs) {
      const def = NPCS[n.npc];
      const pos = { x: n.pos[0], y: n.pos[1], z: n.pos[2] };
      this.add({
        id: this.nextId++, kind: 'npc', tf: { pos, prevPos: { ...pos }, yaw: n.yaw, prevYaw: n.yaw, vel: { x: 0, y: 0, z: 0 } },
        body: { ...def.body }, npc: { id: n.id }, view: { model: def.model }, ...(this.streamed ? { settle: true as const } : {}),
      });
      this.places.set(n.id, { ...pos });
    }
    for (const s of content.shrines) this.addInteractable(s.id, 'shrine', s.pos, s.yaw, false);
    for (const c of content.chests) {
      this.chests.set(c.id, { items: c.chest.items, sprouts: c.chest.sprouts });
      this.addInteractable(c.id, 'chest', c.pos, c.yaw, this.world.openedChests.includes(c.id));
    }
    for (const m of content.mounts ?? []) {
      const pos = { x: m.pos[0], y: m.pos[1], z: m.pos[2] };
      this.add({
        id: this.nextId++, kind: 'mount', tf: { pos, prevPos: { ...pos }, yaw: m.yaw, prevYaw: m.yaw, vel: { x: 0, y: 0, z: 0 } },
        mount: { rider: null, home: { ...pos }, homeYaw: m.yaw, speed: 0 }, view: { model: MOUNT.id },
        ...(this.streamed ? { settle: true as const } : {}),
      });
      this.places.set(m.id, { ...pos });
      this.physics.placeMountBody(this.nextId - 1, pos, MOUNT_BODY, m.yaw, false);
      this.physics.addMountRunner(this.nextId - 1, MOUNT_RUNNER, pos);
    }
    for (const o of content.objects ?? []) this.addInteractable(o.id, 'object', o.pos, o.yaw, (this.world.flags[usedFlag(o.id)] ?? 0) !== 0);
    // Hidden until syncPortals. A portal's `used` means sealed, not spent.
    for (const p of content.portals ?? []) this.addInteractable(p.id, 'portal', p.pos, p.yaw, true);
    for (const o of content.obstacles ?? []) this.addObstacle(o);
    for (const en of content.enemies) this.spawnEnemy(en.def, { x: en.pos[0], y: en.pos[1], z: en.pos[2] }, en.yaw);
    // Camps (M4): members around the camp centre; each stays dead until a rest or a respawn.
    for (const camp of content.camps ?? []) {
      for (const m of camp.members) {
        const pos = { x: camp.pos[0] + m.at[0], y: camp.pos[1], z: camp.pos[2] + m.at[1] };
        if ((m.wave ?? 1) > 1) {
          this.pendingWaves.push({ camp: camp.id, def: m.def, pos, yaw: m.yaw ?? 0, wave: m.wave!, ...(m.carry ? { carry: m.carry } : {}) });
          continue;
        }
        const e = this.spawnEnemy(m.def, pos, m.yaw ?? 0);
        e.brain!.camp = camp.id;
        if (m.unique) e.brain!.unique = m.unique;
        if (m.wave) e.brain!.wave = m.wave;
        if (m.carry) {
          e.brain!.carry = m.carry;
          e.brain!.carryHome = m.carry;
        }
      }
    }
    this.rollCampAffixes();
    this.triggerList = content.triggers;
    for (const t of content.triggers) this.places.set(t.id, { x: t.pos[0], y: t.pos[1], z: t.pos[2] });
  }

  /**
   * Give every camp the affix this generation rolled (expansion plan §3.6). Uniques are never
   * affixed; a champion affix (Colossal) goes on the camp's first member that isn't already an elite.
   */
  private rollCampAffixes(): void {
    const generation = this.world.flags[CAMP_GENERATION_FLAG] ?? 0;
    const champions = new Set<string>();
    for (const e of this.entities) {
      const camp = e.brain?.camp;
      if (!camp || e.brain!.unique) continue;
      let affix = rollCampAffix(this.seed, camp, generation);
      if (affix && AFFIXES[affix].champion) {
        if (champions.has(camp) || ENEMIES[e.brain!.def].elite) affix = null;
        else champions.add(camp);
      }
      if (applyAffix(e, affix)) this.physics.addCharacter(e.id, e.body!, e.tf.pos);
    }
  }

  private addInteractable(id: string, kind: 'shrine' | 'chest' | 'object' | 'portal', p: [number, number, number], yaw: number, used: boolean): void {
    const pos = { x: p[0], y: p[1], z: p[2] };
    this.add({
      id: this.nextId++, kind: 'interactable', tf: { pos, prevPos: { ...pos }, yaw, prevYaw: yaw, vel: { x: 0, y: 0, z: 0 } },
      interactable: { id, kind, used }, view: { model: kind === 'object' ? (OBJECTS[id]?.model ?? 'object') : kind },
      ...(this.streamed ? { settle: true as const } : {}),
    });
    this.places.set(id, { ...pos });
  }

  /** A gate barrier or a boss's pillar: an entity whose collider `syncObstacles` keeps up to date. */
  private addObstacle(o: ObstaclePlacement): void {
    const pos = { x: o.pos[0], y: o.pos[1], z: o.pos[2] };
    this.add({
      id: this.nextId++, kind: 'area', tf: { pos, prevPos: { ...pos }, yaw: o.yaw, prevYaw: o.yaw, vel: { x: 0, y: 0, z: 0 } },
      obstacle: { id: o.id, shape: o.shape, openFlag: o.openFlag, breakable: o.breakable, broken: false }, view: { model: o.model },
      ...(this.streamed ? { settle: true as const } : {}),
    });
  }

  /**
   * Rapier's obstacle colliders follow the entities (and so a restored snapshot): one stands while
   * its gate is shut and it isn't broken, once it has been set down on the ground.
   */
  private syncObstacles(): void {
    const live = new Set<EntityId>();
    for (const e of this.entities) {
      const o = e.obstacle;
      if (!o) continue;
      live.add(e.id);
      // An opened gate reads as broken for good (its view fades, and a fight's reset can't shut it).
      if (o.openFlag && this.world.flags[o.openFlag]) o.broken = true;
      const stands = !e.settle && !o.broken;
      if (stands && !this.physics.hasObstacle(e.id)) this.physics.addObstacle(e.id, e.tf.pos, o.shape);
      else if (!stands) this.physics.removeObstacle(e.id);
    }
    for (const id of this.physics.obstacleIds()) if (!live.has(id)) this.physics.removeObstacle(id);
  }

  /**
   * Rapier follows the entities here too. A bull nobody is riding is solid, once it is set down and
   * nobody is standing where it would be; in the saddle, the rider's collider is the bull's width.
   */
  private syncMountBodies(): void {
    for (const e of this.entities) {
      if (e.mount) {
        this.physics.placeMountBody(e.id, e.tf.pos, MOUNT_BODY, e.tf.yaw, !e.settle && e.mount.rider === null && !e.mount.call && this.mountSpotClear(e));
        this.physics.setMountRunning(e.id, e.tf.pos, !!e.mount.call);
      }
      else if (e.owner !== undefined && e.body) this.physics.setCharacterRadius(e.id, e.body, e.riding?.state === 'riding' ? MOUNT.rideRadius : e.body.radius);
    }
  }

  /** Nobody is inside the bull's body: someone just climbing down, or standing where it was called to. */
  private mountSpotClear(bull: Entity): boolean {
    const sin = Math.sin(bull.tf.yaw), cos = Math.cos(bull.tf.yaw);
    return !this.entities.some((e) => {
      if (!e.body || this.unseen(e) || !this.physics.hasCharacter(e.id)) return false;
      const dx = e.tf.pos.x - bull.tf.pos.x, dz = e.tf.pos.z - bull.tf.pos.z, dy = e.tf.pos.y - bull.tf.pos.y;
      // How far they are from the box, along the ground. Leaning on its side is not being inside it.
      const out = Math.hypot(Math.max(0, Math.abs(dx * cos - dz * sin) - MOUNT.bodyHalfWidth), Math.max(0, Math.abs(dx * sin + dz * cos) - MOUNT.bodyHalfLength));
      return out < e.body.radius - MOUNT_OVERLAP && dy < MOUNT.bodyHeight && dy > -e.body.height;
    });
  }

  /** What boss fights ask of the world: adds and hazards. */
  private readonly bossHost: BossHost = {
    spawnAdd: (def, pos, yaw) => this.spawnEnemy(def, pos, yaw),
    spawnHazard: (pos, hazard) => this.spawnHazard(pos, hazard),
    flag: (id) => this.world.flags[id] ?? 0,
    groundY: (x, z, near) => {
      const hit = this.physics.raycast({ x, y: near + 20, z }, { x: 0, y: -1, z: 0 }, 60);
      // Capped near where it was aimed: the ray can land on top of a pillar.
      return hit ? Math.min(hit.point.y + 0.02, near + 1.5) : near;
    },
  };

  /** Underground, or a camp's dead whose body has faded: there is nothing to see, so nothing to bump into. */
  private unseen(e: Entity): boolean {
    const a = e.combat?.action;
    return !!e.boss?.under || !!e.brain?.held || (!!e.brain?.camp && a?.kind === 'dead' && a.t > CAMP_CORPSE_TICKS);
  }

  /** What can't be seen has no collider; it gets its collider back when it can be. */
  private syncUnseen(): void {
    for (const e of this.entities) {
      if ((!e.boss && !e.brain?.camp) || !e.body) continue;
      const solid = this.physics.hasCharacter(e.id);
      if (this.unseen(e) && solid) this.physics.removeCharacter(e.id);
      else if (!this.unseen(e) && !solid) this.physics.addCharacter(e.id, e.body, e.tf.pos);
    }
  }

  private spawnHazard(pos: Vec3, hazard: Hazard): void {
    this.add({
      id: this.nextId++, kind: 'area', tf: { pos: { ...pos }, prevPos: { ...pos }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } },
      hazard, view: { model: `hazard_${hazard.kind}` },
    });
  }

  /** The player fell or left: every boss fight starts over (plan §4.10). */
  private resetBossFights(): void {
    for (const e of [...this.entities]) if (e.hazard || e.brain?.summoned) this.remove(e.id);
    for (const e of this.entities) {
      if (e.obstacle) e.obstacle.broken = false;
      if (e.boss && e.brain && e.combat?.action?.kind !== 'dead') {
        e.boss = newBossState();
        // Whole again and back at home, however the fight was left (a fall, or a teleport out of it).
        this.reset(e, e.brain.home, e.brain.homeYaw);
      }
    }
  }

  /** A boss died: its adds fall with it. */
  private bossDied(ctx: CombatCtx, boss: Entity): void {
    boss.boss!.state = 'dead';
    delete boss.boss!.under;
    ctx.events.push({ type: 'bossDefeated', boss: boss.id });
    for (const e of this.entities) if (e.brain?.summoned && e.combat?.action?.kind !== 'dead') kill(ctx, e, null);
  }

  /** Where a content id is (NPC, shrine, chest, trigger), for markers. */
  locate(id: string): Vec3 | null {
    const p = this.places.get(id);
    return p ? { ...p } : null;
  }

  private spawnPickup(pos: Vec3, pickup: NonNullable<Entity['pickup']>): void {
    this.add({
      id: this.nextId++, kind: 'pickup', tf: { pos: { ...pos }, prevPos: { ...pos }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } },
      pickup, view: { model: pickup.kind },
    });
  }

  /** The save file for the current state (plan §2.8). `savedAt` comes from the app's clock. */
  toSave(meta: { savedAt: string; build: string; region: string }, player: PlayerId = 0): SaveFile {
    const p = this.playerEntity(player)?.progress;
    if (!p) throw new Error('toSave: no player');
    // God mode is for this session only: a save never carries it.
    const { dialogue: _d, shop: _s, atShrine: _a, god: _g, phone: _ph, ...rest } = structuredClone(p);
    void _d;
    void _s;
    void _a;
    void _g;
    void _ph;
    return { schema: SAVE_SCHEMA, ...meta, player: rest, world: savedWorld(this.world) };
  }

  /** Load a save into the spawned player and the world (call after spawnPlayer / populateWorld). */
  applySave(save: SaveFile, player: PlayerId = 0): void {
    const e = this.playerEntity(player);
    if (!e) throw new Error('applySave: no player');
    e.progress = { ...structuredClone(save.player), dialogue: null, shop: null, atShrine: null };
    const p = e.progress;
    p.weapons ??= [p.equipment.staff, null, null, null];
    p.activeWeaponSlot ??= 0;
    p.guns ??= [];
    p.ammo ??= defaultAmmo();
    p.abilities ??= defaultAbilities();
    p.dungeonProgress ??= {};
    const activeWeapon = p.weapons[p.activeWeaponSlot];
    if (activeWeapon && !p.guns.some((g) => g.uid === activeWeapon)) p.equipment.staff = activeWeapon;
    else if (!activeWeapon) p.weapons[p.activeWeaponSlot] = p.equipment.staff;
    e.view = { ...e.view, model: classOf(e.progress.class).model };
    // A save made before session ticks were kept out still has them: drop them, the clock restarts.
    this.world = savedWorld(save.world);
    this.rollCampAffixes();
    for (const x of this.entities) {
      if (x.interactable?.kind === 'chest') x.interactable.used = this.world.openedChests.includes(x.interactable.id);
      if (x.interactable?.kind === 'object') x.interactable.used = (this.world.flags[usedFlag(x.interactable.id)] ?? 0) !== 0;
    }
    for (const x of [...this.entities]) if (x.brain?.unique && this.world.killedUniques.includes(x.brain.unique)) this.remove(x.id);
    recompute(e);
    e.vitals!.hp = e.vitals!.hpMax;
    e.vitals!.mana = e.vitals!.manaMax;
    e.vitals!.stamina = e.vitals!.staminaMax;
    const at = e.progress.lastShrine ? this.places.get(e.progress.lastShrine) : undefined;
    if (at) this.teleportPlayer(player, { x: at.x + 1.5, y: at.y + 0.05, z: at.z + 1.5 });
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
      // A flier moves itself: no ground movement, no gravity.
      ...(def.drake ? {} : { loco: { grounded: true, sprinting: false, jumpBuffer: 0, coyote: 0, speed: 0, landedTicks: 1 } }),
      vitals: { hp: def.hp, hpMax: def.hp, stamina: 100, staminaMax: 100, mana: 0, manaMax: 0, staminaDelay: 0 },
      combat: newCombat('enemy', def.poise, def.poise, def.defense, def.level),
      brain: { def: defId, home: { ...pos }, homeYaw: yaw, state: 'idle', target: null, cooldowns: {}, recent: [], circle: 0, circleDir: 1, timer: 30, meleeHitsTaken: 0, ...(def.boss ? { unique: def.id } : {}) },
      ...(def.boss ? { boss: newBossState() } : {}),
      view: { model: def.model },
      ...(this.streamed ? { settle: true as const } : {}),
    };
    this.add(e);
    this.events.push({ type: 'spawn', entity: e.id });
    return e;
  }

  private spawnProjectile(owner: Entity, move: EnemyMoveDef, target: Entity, angle = 0): void {
    if (!move.projectile) return;
    const from = muzzle(owner, affixedMove(move, owner.view.scale ?? 1));
    const aim = { x: target.tf.pos.x, y: target.tf.pos.y + (target.body?.height ?? 1.8) * 0.55, z: target.tf.pos.z };
    let d = { x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z };
    if (angle) {
      // Fan a volley out around the aim (rotation about +Y).
      const c = Math.cos(angle), s = Math.sin(angle);
      d = { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
    }
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const sp = move.projectile.speed;
    const e: Entity = {
      id: this.nextId++,
      kind: 'projectile',
      tf: { pos: from, prevPos: { ...from }, yaw: owner.tf.yaw, prevYaw: owner.tf.yaw, vel: { x: (d.x / len) * sp, y: (d.y / len) * sp, z: (d.z / len) * sp } },
      projectile: {
        owner: owner.id, team: owner.combat!.team, kind: move.kind, damage: move.damage, poise: move.poise, radius: move.projectile.radius,
        life: Math.ceil(move.projectile.range / (sp * DT)), reflected: false, sourceMove: move.id,
        homing: move.projectile.homing, target: move.projectile.homing ? target.id : undefined,
        ...(move.projectile.reflectBonus ? { reflectBonus: { ...move.projectile.reflectBonus, shooter: owner.id } } : {}),
        ...(move.projectile.status ? { status: { ...move.projectile.status } } : {}),
      },
      view: { model: move.projectile.model ?? (move.kind === 'arcane' ? 'hex' : 'coin') },
    };
    this.add(e);
    this.events.push({ type: 'fire', entity: owner.id, projectile: e.id });
  }

  /** What a player's spell puts in the world: a projectile (bolt, blast orb) or a power's ground effect. */
  private spawnSpellProjectile(p: Omit<Entity, 'id'>): Entity {
    const e = { ...p, id: this.nextId++ } as Entity;
    this.add(e);
    if (e.projectile) this.events.push({ type: 'fire', entity: e.projectile.owner, projectile: e.id });
    return e;
  }

  // ---------------------------------------------------------------- streamed cells (plan §3.2)

  /** A level without a ground plane takes its ground from streamed cells. */
  get streamed(): boolean {
    return !this.level.ground;
  }

  /**
   * Queue a cell's colliders. They're built at the top of coming ticks, at most
   * CELL_COLLIDERS_PER_TICK a tick, the player's own 3 × 3 first.
   */
  loadCell(c: CellColliders): void {
    const key = cellKey(c.cx, c.cz);
    if (this.readyCells.has(key) || this.cellQueue.some((q) => q.key === key)) return;
    this.cellQueue.push({ key, cells: c, bodyMade: false, next: 0 });
  }

  /** Drop a cell's colliders. Refused (false) for an anchored cell: someone stands on it. */
  unloadCell(cx: number, cz: number): boolean {
    if (this.cellAnchors().some(([x, z]) => x === cx && z === cz)) return false;
    const key = cellKey(cx, cz);
    this.cellQueue = this.cellQueue.filter((q) => q.key !== key);
    this.readyCells.delete(key);
    this.physics.removeCell(key);
    return true;
  }

  cellReady(cx: number, cz: number): boolean {
    return !this.streamed || this.readyCells.has(cellKey(cx, cz));
  }

  /**
   * Cells that must keep their colliders: every player's 3 × 3, plus the cell of any enemy that is
   * fighting or leashing home, so a fight or a leash never runs onto unloaded ground.
   */
  cellAnchors(): [number, number][] {
    if (!this.streamed) return [];
    const out = new Map<string, [number, number]>();
    for (const e of this.entities) {
      const busyEnemy = e.brain && (e.brain.state === 'engage' || e.brain.state === 'leash');
      if (e.kind !== 'player' && !busyEnemy) continue;
      const [cx, cz] = cellOf(e.tf.pos.x, e.tf.pos.z);
      const r = e.kind === 'player' ? 1 : 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.set(cellKey(cx + dx, cz + dz), [cx + dx, cz + dz]);
    }
    return [...out.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  /** The player stands over a cell whose colliders aren't built yet: it is held still (veil). */
  waitingForGround(): boolean {
    const p = this.entities.find((e) => e.kind === 'player');
    if (!p) return false;
    const [cx, cz] = cellOf(p.tf.pos.x, p.tf.pos.z);
    return !this.cellReady(cx, cz);
  }

  /** Build queued cells within the per-tick collider budget, player cells first. */
  private applyCellQueue(): void {
    if (!this.cellQueue.length) return;
    const near = new Set(this.entities.filter((e) => e.kind === 'player').flatMap((e) => {
      const [cx, cz] = cellOf(e.tf.pos.x, e.tf.pos.z);
      const keys: string[] = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) keys.push(cellKey(cx + dx, cz + dz));
      return keys;
    }));
    this.cellQueue.sort((a, b) => Number(near.has(b.key)) - Number(near.has(a.key)));
    let budget = CELL_COLLIDERS_PER_TICK;
    while (budget > 0 && this.cellQueue.length) {
      const q = this.cellQueue[0];
      if (!q.bodyMade) {
        this.physics.addCellBody(q.key, q.cells);
        q.bodyMade = true;
        budget--;
      }
      while (budget > 0 && q.next < q.cells.shapes.length) {
        this.physics.addCellShape(q.key, q.cells.shapes[q.next++]);
        budget--;
      }
      if (q.next >= q.cells.shapes.length) {
        this.readyCells.add(q.key);
        this.cellQueue.shift();
      }
    }
  }

  /** Bodies standing over a cell without colliders don't move or fall. */
  private groundless(): Set<number> {
    const out = new Set<number>();
    if (!this.streamed) return out;
    for (const e of this.entities) {
      if (!e.body) continue;
      const [cx, cz] = cellOf(e.tf.pos.x, e.tf.pos.z);
      // Without a collider it stays put too: there is nothing to move, or to stand on the ground.
      if (e.settle || this.unseen(e) || !this.readyCells.has(cellKey(cx, cz))) out.add(e.id);
    }
    return out;
  }

  /**
   * Set content placements down on the ground (M4): anything still marked `settle` over a cell
   * whose colliders exist gets a raycast from above. It runs before this tick's new colliders are
   * queued, so a cell built last tick has been through a physics step and the ray sees it. A miss
   * (a hole) keeps the mark and tries again next tick.
   */
  private settleOnGround(): void {
    if (!this.streamed) return;
    for (const e of this.entities) {
      if (!e.settle) continue;
      // A bull waits a tick for its own body to go, or the ray would land on its back.
      if (e.mount && this.physics.mountBodySolid(e.id)) continue;
      const [cx, cz] = cellOf(e.tf.pos.x, e.tf.pos.z);
      if (!this.readyCells.has(cellKey(cx, cz))) continue;
      const hit = this.physics.raycast({ x: e.tf.pos.x, y: SETTLE_FROM_Y, z: e.tf.pos.z }, { x: 0, y: -1, z: 0 }, SETTLE_FROM_Y * 2);
      if (!hit) continue;
      const y = hit.point.y + (e.body ? 0.02 : 0);
      e.tf.pos.y = e.tf.prevPos.y = y;
      if (e.body) this.physics.teleport(e.id, e.tf.pos);
      if (e.brain) e.brain.home.y = y;
      const id = e.npc?.id ?? e.interactable?.id;
      if (id && this.places.has(id)) this.places.set(id, { ...e.tf.pos });
      delete e.settle;
    }
  }

  /** Start the wave runner (`?sandbox=1`): mixed waves around the arena, one after another. */
  startWaves(): void {
    this.wave = { index: 0, loop: 0, enemiesLeft: 0, nextIn: 90, ids: [] };
  }

  private waveTick(): void {
    const w = this.wave;
    if (!w) return;
    if (w.nextIn > 0) {
      if (--w.nextIn === 0) this.spawnWave();
      return;
    }
    w.ids = w.ids.filter((id) => this.byId.has(id));
    w.enemiesLeft = w.ids.filter((id) => this.byId.get(id)!.combat?.action?.kind !== 'dead').length;
    if (w.enemiesLeft === 0 && w.ids.every((id) => (this.byId.get(id)!.combat!.action as { t: number }).t >= 30)) {
      this.events.push({ type: 'waveClear', wave: w.index + 1 + w.loop * WAVES.length });
      w.index = (w.index + 1) % WAVES.length;
      if (w.index === 0) w.loop++;
      w.nextIn = WAVE_GAP;
    }
  }

  private spawnWave(): void {
    const w = this.wave!;
    const spawns = [...WAVES[w.index]];
    for (let i = 0; i < w.loop; i++) spawns.push({ def: 'grunt', at: [(i % 2 ? 1 : -1) * (2 + i), -4] });
    const player = this.entities.find((e) => e.kind === 'player');
    w.ids = [];
    for (const sp of spawns) {
      const pos = { x: WAVE_CENTRE[0] + sp.at[0], y: 0, z: WAVE_CENTRE[1] + sp.at[1] };
      const yaw = player ? Math.atan2(player.tf.pos.x - pos.x, player.tf.pos.z - pos.z) : 0;
      const e = this.spawnEnemy(sp.def, pos, yaw);
      // Wave enemies come for you straight away.
      if (player) {
        e.brain!.state = 'engage';
        e.brain!.target = player.id;
      }
      w.ids.push(e.id);
    }
    w.enemiesLeft = w.ids.length;
    this.events.push({ type: 'wave', wave: w.index + 1 + w.loop * WAVES.length, loop: w.loop, enemies: w.ids.length });
  }

  private remove(id: EntityId): void {
    const i = this.entities.findIndex((e) => e.id === id);
    if (i < 0) return;
    const e = this.entities[i];
    if (e.body) this.physics.removeCharacter(id);
    if (e.powerArea?.kind === 'wall') this.physics.removeBarrier(id);
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
    if (e.powerArea?.kind === 'wall') {
      const b = wallBarrier(e);
      this.physics.addBarrier(e.id, b.centre, b.half, b.yaw);
    }
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
    this.settleOnGround();
    this.syncObstacles();
    this.syncMountBodies();
    this.applyCellQueue();
    // Hit-stop: frozen entities skip this tick entirely (their clocks don't run).
    const frozen = new Set<number>();
    for (const e of this.entities) {
      if (e.combat && e.combat.hitstop > 0) {
        e.combat.hitstop--;
        frozen.add(e.id);
      }
    }
    // Hopeglass: solo play skips every other tick; co-op adds a short freeze instead of slowing time.
    if (relicSlowTick(this.entities, this.now)) for (const e of this.entities) frozen.add(e.id);
    // RPG intents and interact / potion presses first. A player in a menu or talking sends no
    // gameplay input this tick.
    this.syncPortals();
    const rpg: RpgCtx = {
      now: this.now, entities: this.entities, events: this.events, world: this.world, rng: this.rng.stream('loot'),
      spawnPickup: (pos, pk) => this.spawnPickup(pos, pk),
    };
    const effective = new Map<PlayerId, InputCommand>(commands);
    for (const e of this.entities) {
      // Hit-stop freezes combat, not menus: intents and interact/potion presses still apply.
      if (!e.progress || e.owner === undefined) continue;
      const cmd = commands.get(e.owner);
      let uiActions = cmd?.ui ?? [];
      if (cmd && (cmd.weaponSlot !== undefined || (cmd.pressed & BTN.swapWeapon) !== 0)) {
        const bar = e.progress.weapons ?? [e.progress.equipment.staff, null, null, null];
        const cur = e.progress.activeWeaponSlot ?? 0;
        let next = cmd.weaponSlot;
        if (next === undefined) {
          for (let step = 1; step <= bar.length; step++) {
            const idx = (cur + step) % bar.length;
            if (bar[idx]) { next = idx; break; }
          }
        }
        if (next !== undefined && next !== cur) uiActions = [...uiActions, { kind: 'selectWeaponSlot', slot: next }];
      }
      const busy = playerRpg(rpg, e, cmd?.pressed ?? 0, uiActions, this.chests, cmd?.held ?? 0);
      if (busy) effective.set(e.owner, { ...idleInput(cmd?.camYaw ?? e.tf.yaw) });
      // The Brick Phone and equipped guns never swing on Light attack: Light triggers phone or gun fire.
      else if (cmd && (wieldsPhone(e) || gunDef(e.progress?.equipment.staff)) && ((cmd.pressed | cmd.held) & BTN.light)) {
        effective.set(e.owner, { ...cmd, pressed: cmd.pressed & ~BTN.light, held: cmd.held & ~BTN.light });
      }
    }
    // Travel is applied here, not through RpgCtx: the destination's arrive point, then a settle onto its floor.
    for (const ev of this.events) {
      if (ev.type === 'travel') {
        // Fast travel or a god's warp: off the bull if riding, then the same drop onto the floor as a portal.
        const who = this.byId.get(ev.entity);
        if (!who || who.owner === undefined) continue;
        this.teleportPlayer(who.owner, this.streamed ? { x: ev.x, y: SETTLE_FROM_Y, z: ev.z } : { x: ev.x, y: who.tf.pos.y, z: ev.z });
        if (this.streamed) who.settle = true;
        continue;
      }
      if (ev.type !== 'portalTravel' || ev.to.startsWith('dungeon:')) continue;
      const who = this.byId.get(ev.entity);
      const dest = ROOTDEEP_PORTALS[ev.to];
      if (!who || who.owner === undefined || !dest || who.riding) continue;
      this.teleportPlayer(who.owner, { x: dest.arrive[0], y: SETTLE_FROM_Y, z: dest.arrive[1] });
      who.settle = true;
    }
    const rawCommands = commands;
    commands = effective;
    const motion = new Map<number, Motion>();
    const ctx: CombatCtx = { now: this.now, entities: this.entities, get: (id) => this.byId.get(id), events: this.events, motion, frozen };
    lockOn(ctx, commands, this.physics);
    playerCombat(ctx, commands, this.physics, (e) => this.spawnSpellProjectile(e));
    ridingMotion(ctx);
    enemyBrains(ctx, this.rng.stream('ai'), this.physics, (o, m, t, a) => this.spawnProjectile(o, m, t, a), this.bossHost);
    this.syncUnseen();
    markTargeted(this.entities, this.now, (id) => this.byId.get(id));
    const noGround = this.groundless();
    locomotion(this.entities, commands, this.physics, this.events, motion, noGround.size ? new Set([...frozen, ...noGround]) : frozen, (x, z) => this.cellReady(...cellOf(x, z)));
    bossArena(this.entities, this.physics, (e) => (e.brain ? ENEMIES[e.brain.def] : undefined));
    mountCalls(this.entities, commands, this.physics, this.events, (id) => this.byId.get(id), (x, z) => this.cellReady(...cellOf(x, z)));
    this.physics.step();
    followRiders(this.entities, (id) => this.byId.get(id));
    resolveAttacks(ctx, this.physics);
    this.gunRuntimeTick(ctx, rawCommands);
    for (const id of stepProjectiles(ctx, this.physics)) this.remove(id);
    for (const id of stepPowers(ctx)) this.remove(id);
    for (const id of stepHazards(ctx)) this.remove(id);
    for (const { entity, source } of tickStatuses(ctx)) {
      if (entity.combat?.action?.kind !== 'dead') kill(ctx, entity, this.byId.get(source) ?? null);
    }
    vitals(this.entities, frozen, this.now);
    godVitals(this.entities);
    // Kills feed XP and loot; then pickups, triggers and the quest runtime see this tick's events.
    for (const ev of [...this.events]) {
      if (ev.type !== 'death' || ev.killer === null) continue;
      const killer = this.byId.get(ev.killer);
      const dead = this.byId.get(ev.entity);
      if (killer?.progress && dead) onKill(rpg, killer, dead);
    }
    for (const ev of this.events) {
      // A unique stays dead for good (saved); camps come back when the player rests.
      if (ev.type === 'death') {
        const dead = this.byId.get(ev.entity);
        const u = dead?.brain?.unique;
        if (u && !this.world.killedUniques.includes(u)) this.world.killedUniques.push(u);
        if (dead?.boss && dead.boss.state !== 'dead') this.bossDied(ctx, dead);
      } else if (ev.type === 'shrineRest') {
        this.respawnCamps();
        this.callMount(ev.shrine);
      }
    }
    for (const id of pickups(rpg)) this.remove(id);
    triggers(rpg, this.triggerList, this.insideTriggers);
    questPolish({
      now: this.now, entities: this.entities, events: this.events, world: this.world,
      spawnAdd: (def, pos, yaw) => this.spawnEnemy(def, pos, yaw),
      spawnPickup: (pos, pk) => rpg.spawnPickup(pos, pk),
    });
    this.releasePendingWaves();
    for (const e of this.entities) if (e.progress) questTick(rpg, e);
    this.respawns();
    this.waveTick();
    this.dungeonTick(rpg, commands);
    this.movementTechTick(effective);
    this.fallGuard();
    this.now++;
  }

  /** Readonly snapshot of a player's live gun magazine and reload state, or null if not holding a gun. */
  gunRuntime(player: PlayerId): { gunId: string; runtime: Readonly<GunRuntimeState> } | null {
    return this.gunState.get(player) ?? null;
  }

  /** Step ability-gated Slide, Dash, Double-Jump, and Grapple (no-op when all abilities are locked). */
  private movementTechTick(commands: CommandMap): void {
    const dungDef = this.dungeon ? getDungeon(this.dungeon.dungeonId) : null;
    for (const e of this.entities) {
      if (e.owner === undefined || !e.progress || !e.loco || e.combat?.action?.kind === 'dead') continue;
      const ab = e.progress.abilities;
      if (!ab || (!ab.slide && !ab.dash && !ab.doubleJump && !ab.grapple)) continue;
      let st = this.moveTech.get(e.owner);
      if (!st) {
        st = createMovementTechState();
        this.moveTech.set(e.owner, st);
      }
      const cmd = commands.get(e.owner);
      const mounted = e.riding !== undefined && e.riding.state !== 'dismounting';
      const mods = computeClassModifiers(e.progress.class, e.progress.skills);
      const yaw = cmd?.camYaw ?? e.tf.yaw;
      const wishX = cmd ? cmd.move.x * Math.cos(yaw) + cmd.move.y * Math.sin(yaw) : 0;
      const wishZ = cmd ? -cmd.move.x * Math.sin(yaw) + cmd.move.y * Math.cos(yaw) : 0;
      const vel = { x: e.tf.vel.x, y: e.tf.vel.y, z: e.tf.vel.z };
      const res = stepMovementTech(
        st,
        {
          pos: e.tf.pos,
          vel,
          yaw,
          aimDir: cmd?.aim?.dir,
          wishX,
          wishZ,
          grounded: e.loco.grounded,
          sprinting: e.loco.sprinting,
          slidePressed: !!((cmd?.pressed ?? 0) & BTN.slide),
          dashPressed: !!((cmd?.pressed ?? 0) & BTN.dash),
          jumpPressed: !!((cmd?.pressed ?? 0) & BTN.jump),
          grappleHeld: !!((cmd?.held ?? 0) & BTN.grapple),
          grappleAnchors: dungDef?.grappleAnchors.map((a) => ({ id: a.id, at: a.pos, r: a.radius })),
          noGrapple: dungDef?.noGrapple,
          dt: DT,
        },
        ab,
        mounted,
        mods.movementCooldownMult,
        (origin, dir, maxDist) => {
          const hit = this.physics.raycast(origin, dir, maxDist);
          return hit ? { point: hit.point, dist: hit.distance } : null;
        },
      );
      if (res.active !== null || res.doubleJumped || res.slideHopped) {
        e.tf.vel.x = res.vel.x;
        e.tf.vel.y = res.vel.y;
        e.tf.vel.z = res.vel.z;
        const m = this.physics.moveCharacter(e.id, e.tf.pos, { x: res.vel.x * DT, y: res.vel.y * DT, z: res.vel.z * DT });
        e.tf.pos.x += m.moved.x;
        e.tf.pos.y += m.moved.y;
        e.tf.pos.z += m.moved.z;
        e.loco.grounded = m.grounded;
      }
    }
  }

  /** Run per-player gun ballistics, dual-wield alternating fire, reloads, and elemental/crit-weave procs. */
  private gunRuntimeTick(ctx: CombatCtx, commands: CommandMap): void {
    const gunEvents: GunTickEvent[] = [];
    const liveEnemies = this.entities.filter(
      (x) => (x.kind === 'enemy' || x.kind === 'boss') && x.combat?.action?.kind !== 'dead',
    );
    for (const e of this.entities) {
      if (e.owner === undefined || !e.progress) continue;
      const gun = gunDef(e.progress.equipment.staff);
      if (!gun) {
        this.gunState.delete(e.owner);
        continue;
      }
      const activeSlot = e.progress.activeWeaponSlot ?? 0;
      const offhand = e.progress.weapons?.find((w, i) => i !== activeSlot && canDualWield(gun.itemId, w)) ?? null;
      const offhandDef = offhand ? gunDef(offhand) : undefined;
      const isDual = Boolean(offhandDef && canDualWield(gun.itemId, offhand));
      const mt = this.moveTech.get(e.owner);
      const slidingOrDashing = Boolean(mt && (mt.slidingTicks > 0 || mt.dashTicks > 0));
      const mods = computeClassModifiers(e.progress.class, e.progress.skills, {
        dualWielding: isDual,
        slidingOrDashing,
      });
      const skillMods = {
        dmgMult: mods.gunDmgMult,
        reloadMult: mods.reloadSpeedMult,
        fireRateMult: mods.fireRateMult,
        spreadMult: mods.recoilSpreadMult,
        critBonus: mods.gunCritBonus,
        weakspotMult: mods.weakspotMult,
        elementChanceBonus: mods.elementProcBonus,
        magMult: mods.ammoCapacityMult,
      };
      let entry = this.gunState.get(e.owner);
      if (!entry || entry.gunId !== gun.itemId) {
        entry = { gunId: gun.itemId, runtime: createGunRuntimeState(gun.id, e.progress.level, skillMods) };
        this.gunState.set(e.owner, entry);
      }
      if (isDual && offhandDef && !entry.runtime.dual) {
        entry.runtime.dual = createDualWieldState(offhandDef.id, e.progress.level, skillMods);
      } else if (!isDual && entry.runtime.dual) {
        entry.runtime.dual = undefined;
      }
      const cmd = commands.get(e.owner);
      const ammo = (e.progress.ammo ??= defaultAmmo());
      const canAct = e.combat?.action?.kind !== 'dead' && !e.riding && !e.progress.dialogue && !e.progress.shop && !e.progress.atShrine;
      const fireHeld = canAct && Boolean(cmd && ((cmd.held | cmd.pressed) & BTN.light));
      const reloadPressed = canAct && Boolean(cmd && (cmd.pressed & BTN.reload));
      entry.runtime.adsActive = canAct && !isDual && Boolean(cmd && (cmd.held & BTN.block));

      const origin = { x: e.tf.pos.x, y: e.tf.pos.y + 1.45, z: e.tf.pos.z };
      const aimDir = cmd?.aim?.dir ?? { x: Math.sin(e.tf.yaw), y: 0, z: Math.cos(e.tf.yaw) };
      const worldHit = fireHeld ? this.physics.raycast(origin, aimDir, 120) : null;
      const rng = this.rng.stream('combat');

      const res = isDual
        ? stepDualWieldFire({
            runtime: entry.runtime,
            rightGun: gun.id,
            ammo,
            fireHeld,
            reloadPressed,
            yaw: e.tf.yaw,
            origin,
            aimDir,
            enemies: liveEnemies,
            rng,
            playerLevel: e.progress.level,
            skillMods,
            worldHitDist: worldHit?.distance,
          })
        : stepGunFire({
            runtime: entry.runtime,
            gun: gun.id,
            ammo,
            fireHeld,
            reloadPressed,
            origin,
            aimDir,
            enemies: liveEnemies,
            rng,
            playerLevel: e.progress.level,
            skillMods,
            worldHitDist: worldHit?.distance,
          });

      let anyHit = false;
      let anyCrit = false;
      for (const hit of res.hits) {
        const target = this.byId.get(hit.entityId);
        if (!target || target.combat?.action?.kind === 'dead') continue;
        anyHit = true;
        if (hit.isCrit || hit.isWeak) anyCrit = true;
        resolveHit(ctx, e, target, {
          move: 'gun_shot',
          base: hit.damage,
          kind: 'physical',
          poise: hit.isCrit ? 18 : 8,
          hitstun: hit.isCrit ? 8 : 4,
          knockdown: false,
          pushback: 0.35,
          hitstop: hit.isCrit ? 2 : 0,
          unblockable: false,
          heavy: false,
          crit: hit.isCrit,
          mana: Math.round(mods.gunHitManaFrac * 20),
          from: hit.point,
          projectile: true,
          fixedDamage: Math.max(1, Math.round(hit.damage)),
        });
        if (hit.statusProc && target.vitals && target.vitals.hp > 0) {
          applyStatus(ctx, target, hit.statusProc.status, hit.statusProc.stacks, e.id);
        }
        for (const chain of hit.shockChains) {
          const ct = this.byId.get(chain.targetEntityId);
          if (!ct || ct.combat?.action?.kind === 'dead') continue;
          resolveHit(ctx, e, ct, {
            move: 'gun_shock_chain',
            base: chain.damage,
            kind: 'arcane',
            poise: 6,
            hitstun: 4,
            knockdown: false,
            pushback: 0.2,
            hitstop: 0,
            unblockable: true,
            heavy: false,
            crit: false,
            mana: 0,
            from: hit.point,
            projectile: true,
            fixedDamage: Math.max(1, Math.round(chain.damage)),
          });
        }
        if (e.combat && ((hit.critWeave && mods.gunCritTriggersWeave) || mods.gunHitTriggersWeave)) {
          e.combat.lastHitTick = this.now;
        }
      }

      for (const proj of res.projectiles) {
        const statusId = proj.element === 'fire' ? 'burn' : proj.element === 'shock' ? 'shock' : proj.element === 'goo' ? 'chill' : undefined;
        this.spawnSpellProjectile({
          kind: 'projectile',
          tf: { pos: { ...proj.origin }, prevPos: { ...proj.origin }, vel: { ...proj.vel }, yaw: e.tf.yaw, prevYaw: e.tf.yaw },
          projectile: {
            owner: e.id,
            team: 'player',
            kind: 'physical',
            damage: proj.damage,
            poise: 24,
            radius: proj.radius,
            life: proj.ttlTicks,
            reflected: false,
            explode: proj.splash?.radius,
            status: statusId ? { id: statusId, stacks: 1 } : undefined,
          },
          view: { model: proj.kind === 'rocket' ? 'rocket' : 'bullet' },
        });
      }

      if (res.fired || res.reloadStarted || res.reloadCompleted) {
        gunEvents.push({
          entity: e.id,
          gunType: gun.id,
          fired: res.fired,
          hand: res.hand,
          hit: anyHit,
          crit: anyCrit,
          reloadStarted: res.reloadStarted,
          reloadCompleted: res.reloadCompleted,
        });
      }
    }
    this.gunEvents = gunEvents;
  }

  /** Boot an instanced Campaign Dungeon (L01-L10): compiles Rapier colliders and places player at spawn. */
  startDungeon(id: DungeonId): void {
    const def = getDungeon(id);
    this.dungeon = createDungeonSession(id);
    this.dungeonEvents = [];
    this.physics.loadDungeon(def, this.dungeon.sealedDoorIds);
    for (const sh of def.shrines) this.addInteractable(sh.id, 'shrine', [sh.pos[0], sh.pos[1], sh.pos[2]], sh.yaw, false);
    const p = this.playerEntity(0);
    if (p) this.teleportPlayer(0, { x: def.spawn[0], y: def.spawn[1] + 0.15, z: def.spawn[2] });
  }

  /** Step active instanced dungeon encounters, lockdown doors, checkpoint respawns (no Second Wind), and clear rewards. */
  private dungeonTick(rpg: RpgCtx, commands: CommandMap): void {
    if (!this.dungeon) {
      this.dungeonEvents = [];
      return;
    }
    const p = this.playerEntity(0);
    if (!p) return;
    const cmd = commands.get(0);
    const dead = p.combat?.action?.kind === 'dead';
    const aliveEnemies = this.entities.filter((e) => (e.kind === 'enemy' || e.kind === 'boss') && e.combat?.action?.kind !== 'dead').length;
    const res = stepDungeon(
      this.dungeon,
      [p.tf.pos.x, p.tf.pos.y, p.tf.pos.z],
      dead,
      aliveEnemies,
      !!(cmd && (cmd.pressed & BTN.interact)),
    );
    this.dungeon = res.state;
    const def = getDungeon(this.dungeon.dungeonId);
    // A rest at a dungeon shrine makes its checkpoint the active one: you wake beside the stone.
    const rested: DungeonEvent[] = [];
    for (const ev of this.events) {
      if (ev.type !== 'shrineRest' || ev.entity !== p.id) continue;
      const sh = def.shrines.find((x) => x.id === ev.shrine);
      if (!sh) continue;
      this.dungeon.activeCheckpointId = sh.checkpointId;
      this.dungeon.activeCheckpointPos = [sh.pos[0] + SHRINE_ARRIVE_OFFSET, sh.pos[1], sh.pos[2] + SHRINE_ARRIVE_OFFSET];
      if (!this.dungeon.activatedCheckpoints.includes(sh.checkpointId)) {
        this.dungeon.activatedCheckpoints.push(sh.checkpointId);
        rested.push({ type: 'checkpointActivated', checkpointId: sh.checkpointId, pos: sh.pos });
      }
    }
    this.dungeonEvents = rested.length ? [...res.events, ...rested] : res.events;
    for (const ev of res.events) {
      if (ev.type === 'doorStateChanged') {
        this.physics.setDungeonDoorSealed(ev.doorId, ev.sealed);
      } else if (ev.type === 'encounterStarted') {
        const enc = def.encounters.find((x) => x.id === ev.encounterId);
        const cx = enc ? enc.triggerPos[0] : p.tf.pos.x;
        const cy = enc ? enc.triggerPos[1] : p.tf.pos.y;
        const cz = enc ? enc.triggerPos[2] : p.tf.pos.z;
        let idx = 0;
        for (const group of ev.enemies) {
          const enemyKey = Object.hasOwn(ENEMIES, group.kind)
            ? group.kind
            : /brute|obama|boss|tinubu|gate/i.test(group.kind) ? 'brute'
              : /wisp|sahil|hex|fly/i.test(group.kind) ? 'wisp'
                : /slinger|bot|sniper|gunner/i.test(group.kind) ? 'slinger'
                  : 'grunt';
          for (let n = 0; n < group.count; n++) {
            const angle = (idx++ * 2.39996) % (Math.PI * 2);
            const r = 4 + (idx % 4) * 1.4;
            this.spawnEnemy(enemyKey, { x: cx + Math.cos(angle) * r, y: cy + 0.1, z: cz + Math.sin(angle) * r }, angle + Math.PI);
          }
        }
      } else if (ev.type === 'playerRespawn') {
        this.reset(p, { x: ev.pos[0], y: ev.pos[1] + 0.1, z: ev.pos[2] }, 0);
        if (p.progress) {
          refillTonics(p.progress.tonics);
          p.progress.ammo = defaultAmmo();
        }
      } else if (ev.type === 'dungeonCleared' && p.progress) {
        grantXp(rpg, p, ev.rewardXp);
        p.progress.sprouts += ev.rewardSprouts;
        if (ev.unlockAbility) {
          p.progress.abilities = { ...(p.progress.abilities ?? defaultAbilities()), [ev.unlockAbility]: true };
        }
        if (ev.rewardGun) giveItem(rpg, p, ev.rewardGun, 1);
        const dp = { ...(p.progress.dungeonProgress ?? {}) };
        const prev = dp[ev.dungeonId];
        const ticks = this.dungeon.tick;
        dp[ev.dungeonId] = { cleared: true, bestTimeTicks: prev?.bestTimeTicks ? Math.min(prev.bestTimeTicks, ticks) : ticks };
        p.progress.dungeonProgress = dp;
      }
    }
  }

  /**
   * Sandbox deaths (plan §2.9): the player respawns at the spawn point after 2 s with full
   * resources and the yard resets; an enemy respawns at home after its own delay.
   */
  private respawns(): void {
    const player = this.entities.find((e) => e.kind === 'player' && e.combat?.action?.kind === 'dead');
    if (player && player.combat!.action!.kind === 'dead' && player.combat!.action!.t >= PLAYER_STATS.respawnTicks) {
      // A streamed world respawns you at the shrine you last rested at, tonics refilled.
      const shrine = player.progress?.lastShrine ? this.places.get(player.progress.lastShrine) : undefined;
      this.reset(player, shrine ? { x: shrine.x + 1.5, y: shrine.y + 0.05, z: shrine.z + 1.5 } : this.spawnPoint(), this.level.spawn.yaw);
      if (player.progress) {
        refillTonics(player.progress.tonics);
        player.progress.dialogue = player.progress.shop = player.progress.atShrine = null;
        delete player.progress.phone;
      }
      if (this.wave) {
        // The wave runner restarts the current wave (plan §2.9).
        for (const id of this.wave.ids) this.remove(id);
        this.wave.ids = [];
        this.wave.enemiesLeft = 0;
        this.wave.nextIn = 90;
      } else {
        this.resetBossFights();
        for (const e of this.entities) if (e.brain && !(e.brain.unique && this.world.killedUniques.includes(e.brain.unique))) this.reset(e, e.brain.home, e.brain.homeYaw);
      }
      for (const e of [...this.entities]) if (e.projectile || e.powerArea) this.remove(e.id);
      this.callMount(player.progress?.lastShrine ?? null);
      this.events.push({ type: 'respawn', entity: player.id });
    }
    for (const e of [...this.entities]) {
      const a = e.combat?.action;
      if (!e.brain || a?.kind !== 'dead') continue;
      // Wave enemies stay dead: their bodies are cleared after a moment. So do uniques (M4), for good,
      // and a boss's adds.
      if (this.wave?.ids.includes(e.id) || e.brain.unique || e.brain.summoned) {
        if (a.t >= WAVE_CORPSE_TICKS) this.remove(e.id);
        continue;
      }
      // Camp enemies stay down until the player rests at a shrine or respawns (plan §2.9).
      if (e.brain.camp) continue;
      if (a.t < ENEMIES[e.brain.def].respawnTicks) continue;
      this.reset(e, e.brain.home, e.brain.homeYaw);
      this.events.push({ type: 'respawn', entity: e.id });
    }
  }

  /**
   * A sealed mouth draws nothing and offers nothing. `used` is refreshed every tick, including for
   * old saves whose flags changed while the entity still said hidden.
   */
  private syncPortals(): void {
    for (const e of this.entities) {
      const ia = e.interactable;
      if (ia?.kind !== 'portal') continue;
      if (DUNGEON_PORTAL_BY_PORTAL_ID[ia.id]) {
        ia.used = false;
        continue;
      }
      const def = ROOTDEEP_PORTALS[ia.id];
      if (!def) continue;
      ia.used = !portalUsable(def, this.world.flags);
    }
  }

  /** An unridden bull comes to the shrine you rest or respawn at (home, if there is none), so it is never lost. */
  private callMount(shrine: string | null): void {
    const at = shrine ? this.places.get(shrine) : undefined;
    // Resting in the cave must not drag the bull underground. It stays where it is.
    if (at && isRootdeep(at.x)) return;
    for (const e of this.entities) {
      const m = e.mount;
      if (!m || m.rider !== null) continue;
      delete m.call;
      m.speed = 0;
      e.tf.pos = at ? { x: at.x + MOUNT.shrineOffset[0], y: at.y, z: at.z + MOUNT.shrineOffset[1] } : { ...m.home };
      e.tf.prevPos = { ...e.tf.pos };
      e.tf.yaw = e.tf.prevYaw = m.homeYaw;
      if (this.streamed) e.settle = true;
    }
  }

  /** A rest at a shrine (plan §2.9): every camp is back at home at full health; dead uniques stay dead. */
  private respawnCamps(): void {
    this.world.flags[CAMP_GENERATION_FLAG] = (this.world.flags[CAMP_GENERATION_FLAG] ?? 0) + 1;
    this.rollCampAffixes();
    for (const e of this.entities) {
      const b = e.brain;
      if (!b?.camp || (b.unique && this.world.killedUniques.includes(b.unique))) continue;
      const wasDead = e.combat?.action?.kind === 'dead';
      this.reset(e, b.home, b.homeYaw);
      if (wasDead) this.events.push({ type: 'respawn', entity: e.id });
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
      e.brain.meleeHitsTaken = 0;
      e.brain.called = false;
      e.brain.dodges = 0;
      delete e.brain.wasStaggered;
      e.brain.fleeTo = null;
      delete e.brain.fleeUntil;
      if (e.brain.carryHome) e.brain.carry = e.brain.carryHome;
    }
    delete e.statuses;
    delete e.powers;
  }

  /**
   * Move a player instantly (respawn points, debug teleports, later fast travel), stopping its
   * momentum and any pushback. The position is the feet.
   */
  teleportPlayer(player: PlayerId, pos: Vec3): void {
    const e = this.playerEntity(player);
    if (!e) return;
    e.tf.pos = { ...pos };
    e.tf.prevPos = { ...pos };
    e.tf.vel = { x: 0, y: 0, z: 0 };
    if (e.combat) e.combat.push = null;
    if (e.riding) cancelMount(e, this.get(e.riding.mount));
    this.physics.teleport(e.id, e.tf.pos);
    // Leaving a sealed arena this way abandons the fight, as falling in it does: otherwise the
    // arena's wall would drag the player straight back.
    const left = this.entities.some((b) => {
      const arena = b.boss && b.brain && bossEngaged(b) ? ENEMIES[b.brain.def].boss?.arenaRadius : undefined;
      return arena !== undefined && Math.hypot(pos.x - b.brain!.home.x, pos.z - b.brain!.home.z) > arena;
    });
    if (left) this.resetBossFights();
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

  /**
   * The next wave of a camp arrives when the one before it is down. Bodies stay out of the world
   * until then, so a waiting wave adds no colliders.
   */
  private releasePendingWaves(): void {
    const camps = [...new Set(this.pendingWaves.map((p) => p.camp))];
    for (const camp of camps) {
      const first = this.entities.filter((e) => e.brain?.camp === camp && e.brain.wave === 1);
      if (!first.length || first.some((e) => e.combat?.action?.kind !== 'dead')) continue;
      const due = this.pendingWaves.filter((p) => p.camp === camp);
      this.pendingWaves = this.pendingWaves.filter((p) => p.camp !== camp);
      for (const p of due) {
        const e = this.spawnEnemy(p.def, p.pos, p.yaw);
        e.brain!.camp = p.camp;
        e.brain!.wave = p.wave;
        if (p.carry) {
          e.brain!.carry = p.carry;
          e.brain!.carryHome = p.carry;
        }
        const affix = rollCampAffix(this.seed, p.camp, this.world.flags[CAMP_GENERATION_FLAG] ?? 0);
        if (applyAffix(e, affix)) this.physics.addCharacter(e.id, e.body!, e.tf.pos);
      }
      const at = due[0].pos;
      this.events.push({ type: 'cue', cue: 'horn', pos: { x: at.x, y: at.y, z: at.z } });
    }
  }

  /** Hash of the sim state (entities, players, rng streams, tick). Not Rapier's internals. */
  hash(): number {
    return hashValue({ now: this.now, entities: this.entities, players: [...this.players], rng: this.rng.streams, wave: this.wave, pendingWaves: this.pendingWaves, cells: [...this.readyCells].sort(), world: this.world, triggers: [...this.insideTriggers].sort() });
  }

  snapshot(): SimSnapshot {
    return structuredClone({
      now: this.now,
      nextId: this.nextId,
      entities: this.entities,
      players: [...this.players],
      rng: this.rng.streams,
      wave: this.wave,
      pendingWaves: this.pendingWaves,
      world: this.world,
      triggers: [...this.insideTriggers].sort(),
    });
  }

  /** Restore a snapshot; Rapier character bodies are rebuilt from the entities. */
  restore(s: SimSnapshot): void {
    const copy = structuredClone(s);
    this.physics.removeAllCharacters();
    this.physics.removeAllBarriers();
    this.now = copy.now;
    this.nextId = copy.nextId;
    this.entities = [];
    this.byId.clear();
    this.players.clear();
    for (const e of copy.entities) this.add(e);
    this.syncMountBodies();
    // Rapier's queries only see colliders after a step: without this, the first tick after a restore
    // moves characters as if the rebuilt capsules weren't there.
    this.physics.step();
    for (const [p, id] of copy.players) this.players.set(p, id);
    for (const k of Object.keys(this.rng.streams)) delete this.rng.streams[k];
    Object.assign(this.rng.streams, copy.rng);
    this.wave = copy.wave ?? null;
    this.pendingWaves = copy.pendingWaves ?? [];
    this.world = copy.world ?? { flags: {}, openedChests: [], killedUniques: [] };
    // Who stands in which trigger is sim state: a rewind before entering one must fire it again.
    this.insideTriggers.clear();
    for (const k of copy.triggers ?? []) this.insideTriggers.add(k);
    this.events = [];
  }

  dispose(): void {
    this.physics.dispose();
  }
}

function newCombat(team: Team, poise: number, poiseMax: number, defense: { physical: number; arcane: number }, level: number): Combat {
  return {
    team, action: null, buffer: null, hitstop: 0, poise, poiseMax, poiseDelay: 0, defense: { ...defense }, level,
    lastBlockTick: -999, blockHeld: false, blockPressTicks: 0, riposteUntil: 0, riposteTarget: null, guardCounterUntil: 0, critNext: false, lock: null, lockLostTicks: 0, push: null, lastHitTick: -999, cooldowns: {}, targetedAt: -999,
  };
}
