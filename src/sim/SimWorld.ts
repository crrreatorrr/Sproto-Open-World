import { PLAYER_STATS } from '../content/combat';
import { ENEMIES, type EnemyMoveDef } from '../content/enemies';
import type { LevelDef } from '../content/sandbox';
import { WAVE_CENTRE, WAVE_GAP, WAVES } from '../content/waves';
import { cellKey, cellOf, type CellColliders } from '../content/world/format';
import { DIALOGUE } from '../content/dialogue';
import { NPCS } from '../content/npcs';
import type { RegionContent } from '../content/world/sproutvaleContent';
import { SAVE_SCHEMA, type SaveFile } from '../save/schema';
import { idleInput, type InputCommand } from './commands';
import {
  ALL_SPELLS, availableChoices, interactTarget, newProgress, onKill, pickups, playerRpg, questTick, recompute, triggers, type RpgCtx,
} from './systems/rpg';
import { DT, MOVE, PLAYER_BODY } from '../content/tuning';
import { enemyBrains, muzzle } from './ai/brain';
import type { CommandMap } from './commands';
import { kill, resolveAttacks } from './combat/hits';
import { lockOn } from './combat/lockon';
import { playerCombat, type CombatCtx, type Motion } from './combat/playerCombat';
import { stepProjectiles } from './combat/projectiles';
import { tickStatuses } from './combat/statuses';
import type { Combat, Entity, EntityId, PlayerId, Team, WorldState } from './entity';
import type { SimEvent } from './events';
import { hashValue } from './hash';
import type { Vec3 } from './math';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Rng, type RngState } from './rng';
import { locomotion } from './systems/locomotion';
import { vitals } from './systems/vitals';
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
  world?: WorldState;
  /** `${entityId}:${triggerId}` for every player inside a trigger volume. */
  triggers?: string[];
}

/** Ticks a dead wave enemy lies there before it's removed (wave enemies don't respawn). */
const WAVE_CORPSE_TICKS = 150;
/** Most colliders created per tick when cells stream in (plan §3.2); a heightfield counts as one. */
export const CELL_COLLIDERS_PER_TICK = 96;

interface QueuedCell {
  key: string;
  cells: CellColliders;
  bodyMade: boolean;
  /** Next prop shape to add. */
  next: number;
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
  /** Wave runner state, or null outside the wave runner. */
  wave: WaveState | null = null;
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
      // The yard and the wave runner know every spell; a streamed world starts with Bolt.
      progress: newProgress(this.streamed ? ['bolt'] : ALL_SPELLS),
      view: { model: 'player' },
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
        body: { ...def.body }, npc: { id: n.id }, view: { model: def.model },
      });
      this.places.set(n.id, { ...pos });
    }
    for (const s of content.shrines) this.addInteractable(s.id, 'shrine', s.pos, s.yaw, false);
    for (const c of content.chests) {
      this.chests.set(c.id, { items: c.chest.items, sprouts: c.chest.sprouts });
      this.addInteractable(c.id, 'chest', c.pos, c.yaw, this.world.openedChests.includes(c.id));
    }
    for (const en of content.enemies) this.spawnEnemy(en.def, { x: en.pos[0], y: en.pos[1], z: en.pos[2] }, en.yaw);
    this.triggerList = content.triggers;
    for (const t of content.triggers) this.places.set(t.id, { x: t.pos[0], y: t.pos[1], z: t.pos[2] });
  }

  private addInteractable(id: string, kind: 'shrine' | 'chest', p: [number, number, number], yaw: number, used: boolean): void {
    const pos = { x: p[0], y: p[1], z: p[2] };
    this.add({
      id: this.nextId++, kind: 'interactable', tf: { pos, prevPos: { ...pos }, yaw, prevYaw: yaw, vel: { x: 0, y: 0, z: 0 } },
      interactable: { id, kind, used }, view: { model: kind },
    });
    this.places.set(id, { ...pos });
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
    const { dialogue: _d, shop: _s, atShrine: _a, ...rest } = structuredClone(p);
    void _d;
    void _s;
    void _a;
    return { schema: SAVE_SCHEMA, ...meta, player: rest, world: structuredClone(this.world) };
  }

  /** Load a save into the spawned player and the world (call after spawnPlayer / populateWorld). */
  applySave(save: SaveFile, player: PlayerId = 0): void {
    const e = this.playerEntity(player);
    if (!e) throw new Error('applySave: no player');
    e.progress = { ...structuredClone(save.player), dialogue: null, shop: null, atShrine: null };
    this.world = structuredClone(save.world);
    for (const x of this.entities) if (x.interactable?.kind === 'chest') x.interactable.used = this.world.openedChests.includes(x.interactable.id);
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
      loco: { grounded: true, sprinting: false, jumpBuffer: 0, coyote: 0, speed: 0, landedTicks: 1 },
      vitals: { hp: def.hp, hpMax: def.hp, stamina: 100, staminaMax: 100, mana: 0, manaMax: 0, staminaDelay: 0 },
      combat: newCombat('enemy', def.poise, def.poise, def.defense, def.level),
      brain: { def: defId, home: { ...pos }, homeYaw: yaw, state: 'idle', target: null, cooldowns: {}, recent: [], circle: 0, circleDir: 1, timer: 30, meleeHitsTaken: 0 },
      view: { model: def.model },
    };
    this.add(e);
    this.events.push({ type: 'spawn', entity: e.id });
    return e;
  }

  private spawnProjectile(owner: Entity, move: EnemyMoveDef, target: Entity, angle = 0): void {
    if (!move.projectile) return;
    const from = muzzle(owner, move);
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
        life: Math.ceil(move.projectile.range / (sp * DT)), reflected: false,
        homing: move.projectile.homing, target: move.projectile.homing ? target.id : undefined,
      },
      view: { model: move.kind === 'arcane' ? 'hex' : 'coin' },
    };
    this.add(e);
    this.events.push({ type: 'fire', entity: owner.id, projectile: e.id });
  }

  /** A player spell's projectile (bolt, blast orb). */
  private spawnSpellProjectile(p: Omit<Entity, 'id'>): Entity {
    const e = { ...p, id: this.nextId++ } as Entity;
    this.add(e);
    this.events.push({ type: 'fire', entity: e.projectile!.owner, projectile: e.id });
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
      if (!this.readyCells.has(cellKey(cx, cz))) out.add(e.id);
    }
    return out;
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
    this.applyCellQueue();
    // Hit-stop: frozen entities skip this tick entirely (their clocks don't run).
    const frozen = new Set<number>();
    for (const e of this.entities) {
      if (e.combat && e.combat.hitstop > 0) {
        e.combat.hitstop--;
        frozen.add(e.id);
      }
    }
    // RPG intents and interact / potion presses first. A player in a menu or talking sends no
    // gameplay input this tick.
    const rpg: RpgCtx = {
      now: this.now, entities: this.entities, events: this.events, world: this.world, rng: this.rng.stream('loot'),
      spawnPickup: (pos, pk) => this.spawnPickup(pos, pk),
    };
    const effective = new Map<PlayerId, InputCommand>(commands);
    for (const e of this.entities) {
      // Hit-stop freezes combat, not menus: intents and interact/potion presses still apply.
      if (!e.progress || e.owner === undefined) continue;
      const cmd = commands.get(e.owner);
      const busy = playerRpg(rpg, e, cmd?.pressed ?? 0, cmd?.ui ?? [], this.chests);
      if (busy) effective.set(e.owner, { ...idleInput(cmd?.camYaw ?? e.tf.yaw) });
    }
    commands = effective;
    const motion = new Map<number, Motion>();
    const ctx: CombatCtx = { now: this.now, entities: this.entities, get: (id) => this.byId.get(id), events: this.events, motion, frozen };
    lockOn(ctx, commands, this.physics);
    playerCombat(ctx, commands, this.physics, (e) => this.spawnSpellProjectile(e));
    enemyBrains(ctx, this.rng.stream('ai'), this.physics, (o, m, t, a) => this.spawnProjectile(o, m, t, a));
    const noGround = this.groundless();
    locomotion(this.entities, commands, this.physics, this.events, motion, noGround.size ? new Set([...frozen, ...noGround]) : frozen);
    this.physics.step();
    resolveAttacks(ctx, this.physics);
    for (const id of stepProjectiles(ctx, this.physics)) this.remove(id);
    for (const { entity, source } of tickStatuses(ctx)) {
      if (entity.combat?.action?.kind !== 'dead') kill(ctx, entity, this.byId.get(source) ?? null);
    }
    vitals(this.entities, frozen);
    // Kills feed XP and loot; then pickups, triggers and the quest runtime see this tick's events.
    for (const ev of [...this.events]) {
      if (ev.type !== 'death' || ev.killer === null) continue;
      const killer = this.byId.get(ev.killer);
      const dead = this.byId.get(ev.entity);
      if (killer?.progress && dead) onKill(rpg, killer, dead);
    }
    for (const id of pickups(rpg)) this.remove(id);
    triggers(rpg, this.triggerList, this.insideTriggers);
    for (const e of this.entities) if (e.progress) questTick(rpg, e);
    this.respawns();
    this.waveTick();
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
      // A streamed world respawns you at the shrine you last rested at, tonics refilled.
      const shrine = player.progress?.lastShrine ? this.places.get(player.progress.lastShrine) : undefined;
      this.reset(player, shrine ? { x: shrine.x + 1.5, y: shrine.y + 0.05, z: shrine.z + 1.5 } : this.spawnPoint(), this.level.spawn.yaw);
      if (player.progress) {
        player.progress.tonics.charges = player.progress.tonics.max;
        player.progress.dialogue = player.progress.shop = player.progress.atShrine = null;
      }
      if (this.wave) {
        // The wave runner restarts the current wave (plan §2.9).
        for (const id of this.wave.ids) this.remove(id);
        this.wave.ids = [];
        this.wave.enemiesLeft = 0;
        this.wave.nextIn = 90;
      } else for (const e of this.entities) if (e.brain) this.reset(e, e.brain.home, e.brain.homeYaw);
      for (const e of [...this.entities]) if (e.projectile) this.remove(e.id);
      this.events.push({ type: 'respawn', entity: player.id });
    }
    for (const e of [...this.entities]) {
      const a = e.combat?.action;
      if (!e.brain || a?.kind !== 'dead') continue;
      // Wave enemies stay dead: their bodies are cleared after a moment.
      if (this.wave?.ids.includes(e.id)) {
        if (a.t >= WAVE_CORPSE_TICKS) this.remove(e.id);
        continue;
      }
      if (a.t < ENEMIES[e.brain.def].respawnTicks) continue;
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
      e.brain.meleeHitsTaken = 0;
    }
    delete e.statuses;
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
    this.physics.teleport(e.id, e.tf.pos);
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
    return hashValue({ now: this.now, entities: this.entities, players: [...this.players], rng: this.rng.streams, wave: this.wave, cells: [...this.readyCells].sort(), world: this.world, triggers: [...this.insideTriggers].sort() });
  }

  snapshot(): SimSnapshot {
    return structuredClone({
      now: this.now,
      nextId: this.nextId,
      entities: this.entities,
      players: [...this.players],
      rng: this.rng.streams,
      wave: this.wave,
      world: this.world,
      triggers: [...this.insideTriggers].sort(),
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
    this.wave = copy.wave ?? null;
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
    lastBlockTick: -999, riposteUntil: 0, critNext: false, lock: null, lockLostTicks: 0, push: null, lastHitTick: -999, cooldowns: {},
  };
}
