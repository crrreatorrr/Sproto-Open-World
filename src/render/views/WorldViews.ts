import * as THREE from 'three';
import type { AssetLoader } from '../../assets/AssetLoader';
import type { ModelKey } from '../../assets/manifest';
import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import type { Entity, EntityId } from '../../sim/entity';
import type { SimEvent } from '../../sim/events';
import type { Vec3 } from '../../sim/math';
import type { ReadonlySimView } from '../../sim/view';
import type { HitFx } from '../fx/HitFx';
import { PowerFx } from '../fx/powers';
import { SpellFx } from '../fx/SpellFx';
import { makeBossView } from './BossViews';
import { makeBurrowmotherView } from './BurrowmotherView';
import { BlastOrbView, BoltView, BruteView, CoinView, DummyView, FallbackView, HexView, HumanoidEnemyView, type EntityView } from './EnemyViews';
import { ChestView, NpcView, PickupView, ShrineView, objectView } from './RpgViews';
import { TelegraphDecal, type DecalShape } from './TelegraphDecal';
import { wantsView } from './viewCull';

const DECAL_COLOR: Record<DecalShape, number> = { circle: 0xffa23a, jagged: 0xff2a1a };

/** Enemy models outside the critical download: fetched the first time one comes into range. */
const LAZY_MODELS: ReadonlySet<string> = new Set<ModelKey>(['gatekeeper', 'grunt_vet', 'slinger_vet', 'big_coin', 'robot_shooter', 'robot_laser', 'scrapjaw', 'burrowmother']);

/** Seconds between status particles on a burning, shocked or chilled enemy. */
const EMBER_EVERY = 0.07;
const SPARK_EVERY = 0.11;
const FROST_EVERY = 0.22;

interface LiveDecal {
  entity: EntityId;
  move: EnemyMoveDef;
  decal: TelegraphDecal;
  /** An area attack's circle on the ground (fixed where it was placed), else null: it sits on the hitbox. */
  at: Vec3 | null;
  radius: number;
  /** A leap's landing circle, fixed once the enemy takes off. */
  landing: { x: number; y: number; z: number; yaw: number } | null;
}

/** A definition with its body scaled (a Colossal enemy): views fit the model and the health bar to it. */
function scaledDef(def: EnemyDef | undefined, scale: number): EnemyDef | undefined {
  return def && scale !== 1 ? { ...def, body: { radius: def.body.radius * scale, height: def.body.height * scale } } : def;
}

/** The enemy definition behind an entity, if it has a brain. */
export function enemyDef(e: Readonly<Entity> | undefined): EnemyDef | undefined {
  const id = e?.brain?.def;
  return id ? ENEMIES[id] : undefined;
}

/**
 * Every drawn non-player entity: a view per enemy and projectile, made when the entity appears and
 * dropped when it leaves the sim, plus the telegraph decals under their attacks, status particles,
 * and the spell visuals that aren't sparks (SpellFx). Players have their own PlayerView.
 */
export class WorldViews {
  readonly root = new THREE.Group();
  readonly spells = new SpellFx();
  /** The C3 powers' visuals. */
  readonly powers: PowerFx;
  private readonly views = new Map<EntityId, EntityView>();
  private readonly decals: LiveDecal[] = [];
  private readonly seen = new Set<EntityId>();
  /** Per-entity status particle clocks. */
  private readonly statusClock = new Map<EntityId, { burn: number; shock: number; chill: number }>();
  private readonly p = { x: 0, y: 0, z: 0 };
  /** Shrines the local player has found (from their progress): those glow brighter. */
  private readonly discovered = new Set<string>();
  /** Shrine views by content id (a rest pulses its shrine). */
  private readonly shrines = new Map<string, ShrineView>();
  /** Lazy enemy models: requested (false) and ready to draw (true). */
  private readonly lazyModels = new Map<string, boolean>();
  /** The size each view was made at: a camp's new affix (after a rest) can change it. */
  private readonly viewScale = new Map<EntityId, number>();

  constructor(
    private readonly assets: AssetLoader,
    private readonly fx: HitFx | null = null,
  ) {
    this.powers = new PowerFx(assets, fx);
    this.root.add(this.spells.root, this.powers.root);
  }

  get(id: EntityId): EntityView | undefined {
    return this.views.get(id);
  }

  /** Make, update and drop views to match the sim. Call once per rendered frame. */
  sync(view: ReadonlySimView, alpha: number, dt: number): void {
    this.seen.clear();
    const me = view.playerEntity(0);
    for (const e of view.entities) {
      if (e.kind === 'player') {
        // Single player for now: the one player's progress lights the shrines.
        const found = e.progress?.discoveredShrines;
        if (found && found.length !== this.discovered.size) for (const id of found) this.discovered.add(id);
        continue;
      }
      let v = this.views.get(e.id);
      if (v && (e.view.scale ?? 1) !== (this.viewScale.get(e.id) ?? 1)) {
        v.dispose();
        this.views.delete(e.id);
        v = undefined;
      }
      // Not drawn (far away, not set down yet, a faded corpse): the sweep below drops any old view.
      if (!wantsView(e, me, v !== undefined)) continue;
      if (!v) {
        const made = this.make(e);
        if (!made) continue;
        v = made;
        this.views.set(e.id, v);
        this.viewScale.set(e.id, e.view.scale ?? 1);
        this.root.add(v.root);
      }
      this.seen.add(e.id);
      v.update(e, alpha, dt);
      if (e.statuses) this.statusParticles(e, v, dt);
    }
    for (const [id, v] of this.views) {
      if (this.seen.has(id)) continue;
      v.dispose();
      this.views.delete(id);
      this.statusClock.delete(id);
      this.viewScale.delete(id);
      for (const [k, sv] of this.shrines) if (sv === v) this.shrines.delete(k);
    }
    this.updateDecals(view, dt);
    this.spells.update(dt);
    this.powers.sync(view, alpha, dt);
  }

  /** React to a sim event (telegraphs, flinches and spell visuals; sounds and numbers live in the app). */
  event(view: ReadonlySimView, e: SimEvent): void {
    switch (e.type) {
      case 'telegraph': {
        const ent = view.get(e.entity);
        const move = enemyDef(ent)?.moves.find((m) => m.id === e.move);
        this.views.get(e.entity)?.telegraph?.(move, e.unblockable, e.ticks);
        const shape: DecalShape | null = e.decal ?? move?.decal ?? (e.unblockable ? 'jagged' : null);
        if (shape && move) {
          const decal = new TelegraphDecal(shape, DECAL_COLOR[shape]);
          this.root.add(decal.root);
          // Area attacks put their circle where they aim (the event's `at`, else the action's `aim`).
          const a = ent?.combat?.action;
          const aim = e.at ?? (move.area && a?.kind === 'attack' ? a.aim : undefined);
          const radius = e.radius ?? move.area?.radius ?? move.hitbox.radius;
          this.decals.push({ entity: e.entity, move, decal, at: aim ? { ...aim } : null, radius, landing: null });
        }
        return;
      }
      case 'hit': {
        const from = view.get(e.attacker)?.tf.pos ?? e.pos;
        this.views.get(e.target)?.flinch?.(from, e.heavy);
        return;
      }
      case 'explode':
        // Blast (plan §4.4): a fireball flash the size of the blast, a ground ring, and fire.
        this.fx?.flash(e.pos, 0xffb060, e.radius * 1.6, 0.22);
        this.fx?.flash(e.pos, 0xffffff, e.radius * 0.6, 0.1);
        // Orbs burst about chest height: the shock ring runs along the ground a metre below.
        this.fx?.ring({ x: e.pos.x, y: e.pos.y - 1, z: e.pos.z }, 0xff7a2a, 0.3, e.radius, 0.35);
        this.fx?.emit(e.pos, 'fire', 60, 1.1, 1);
        return;
      case 'nova': {
        // Frost Nova: an icy ring racing out to its radius, a second slower one, and ice thrown off the rim.
        const ground = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
        this.fx?.ring(ground, 0xbfeaff, 0.4, e.radius, 0.32);
        this.fx?.ring(ground, 0x6fb8ff, 0.2, e.radius * 0.8, 0.5);
        this.fx?.flash({ x: ground.x, y: ground.y + 1, z: ground.z }, 0xdff4ff, 2.4, 0.16);
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2;
          const r = e.radius * 0.85;
          this.p.x = ground.x + Math.sin(ang) * r;
          this.p.y = ground.y + 0.3;
          this.p.z = ground.z + Math.cos(ang) * r;
          this.fx?.emit(this.p, 'frost', 4, 0.6, 2);
        }
        return;
      }
      case 'power':
        this.powers.event(view, e);
        return;
      case 'zap':
        this.spells.zap(e.points);
        for (const p of e.points.slice(1)) this.fx?.burst(p, 'shock');
        return;
      case 'blink':
        // The Wisp vanishes in a puff and reappears in another.
        for (const p of [e.from, e.to]) {
          this.p.x = p.x;
          this.p.y = p.y + 1.2;
          this.p.z = p.z;
          this.fx?.burst(this.p, 'hex');
          this.fx?.emit(this.p, 'hex', 18, 0.8, 1);
        }
        return;
      case 'frozen': {
        const v = this.views.get(e.entity);
        if (v) this.fx?.burst(this.chest(v), 'frost');
        return;
      }
      case 'shrineRest': {
        const sv = this.shrines.get(e.shrine);
        if (!sv) return;
        sv.rested();
        const p = sv.root.position;
        this.fx?.ring({ x: p.x, y: p.y + 0.4, z: p.z }, 0x8fe8ff, 0.5, 4, 0.6);
        this.fx?.flash({ x: p.x, y: p.y + 2.2, z: p.z }, 0xdff8ff, 2.5, 0.3);
        return;
      }
      default:
        return;
    }
  }

  /** Burning enemies shed embers, shocked ones crackle, chilled ones drip frost (plan §4.7). */
  private statusParticles(e: Readonly<Entity>, v: EntityView, dt: number): void {
    const s = e.statuses;
    if (!s || !this.fx || e.combat?.action?.kind === 'dead') return;
    let c = this.statusClock.get(e.id);
    if (!c) {
      c = { burn: 0, shock: 0, chill: 0 };
      this.statusClock.set(e.id, c);
    }
    const r = (e.body?.radius ?? 0.4) * 0.9;
    const around = (lo: number, hi: number) => {
      const a = Math.random() * Math.PI * 2;
      const pos = v.root.position;
      this.p.x = pos.x + Math.sin(a) * r;
      this.p.y = pos.y + v.height * (lo + Math.random() * (hi - lo));
      this.p.z = pos.z + Math.cos(a) * r;
      return this.p;
    };
    if (s.burn && (c.burn += dt) >= EMBER_EVERY) {
      c.burn = 0;
      this.fx.emit(around(0.2, 0.8), 'fire', 2, 0.15, 2.8);
    }
    if (s.shock && (c.shock += dt) >= SPARK_EVERY) {
      c.shock = 0;
      this.fx.emit(around(0.3, 0.95), 'shock', 3, 0.5);
    }
    if (s.chill && e.combat?.action?.kind !== 'frozen' && (c.chill += dt) >= FROST_EVERY / Math.max(1, s.chill.stacks)) {
      c.chill = 0;
      this.fx.emit(around(0.4, 0.9), 'frost', 1, 0.1);
    }
  }

  private chest(v: EntityView): { x: number; y: number; z: number } {
    const p = v.root.position;
    this.p.x = p.x;
    this.p.y = p.y + v.height * 0.6;
    this.p.z = p.z;
    return this.p;
  }

  /**
   * Decals sit on the move's hitbox (forward / radius from its EnemyDef) and follow the enemy while
   * it still tracks; an area attack's circle stays where it was placed; a leap's sits where it
   * will land. They fill with the sim's tick counter, so hit-stop pauses them too, and go when the
   * active frames end or the attack is interrupted.
   */
  private updateDecals(view: ReadonlySimView, dt: number): void {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      const e = view.get(d.entity);
      const a = e?.combat?.action;
      const live = e && a?.kind === 'attack' && a.move === d.move.id && a.t < d.move.windup + d.move.active;
      if (!live) {
        d.decal.dispose();
        this.decals.splice(i, 1);
        continue;
      }
      const progress = a.t / Math.max(1, d.move.windup);
      if (d.at) {
        d.decal.update(d.at.x, d.at.y, d.at.z, 0, d.radius, progress, dt);
        continue;
      }
      const v = this.views.get(d.entity);
      const p = v?.root.position ?? e.tf.pos;
      const yaw = v?.root.rotation.y ?? e.tf.yaw;
      if (d.move.leap) {
        // Lands up to `leap.distance` ahead (short of the target if it's closer); fixed from take-off.
        if (!d.landing) {
          const tgt = e.brain?.target != null ? view.get(e.brain.target) : undefined;
          const far = tgt ? Math.min(d.move.leap.distance, Math.hypot(tgt.tf.pos.x - e.tf.pos.x, tgt.tf.pos.z - e.tf.pos.z)) : d.move.leap.distance;
          const f = far + d.move.hitbox.forward;
          const spot = { x: p.x + Math.sin(yaw) * f, y: p.y, z: p.z + Math.cos(yaw) * f, yaw };
          if (a.t >= d.move.windup) d.landing = spot;
          d.decal.update(spot.x, spot.y, spot.z, yaw, d.radius, progress, dt);
        } else d.decal.update(d.landing.x, d.landing.y, d.landing.z, d.landing.yaw, d.radius, progress, dt);
        continue;
      }
      const f = d.move.hitbox.forward;
      d.decal.update(p.x + Math.sin(yaw) * f, p.y, p.z + Math.cos(yaw) * f, yaw, d.radius, progress, dt);
    }
  }

  /** Has this lazy model arrived? Asks for it the first time; `sync` retries every frame until then. */
  private lazyReady(key: ModelKey): boolean {
    const state = this.lazyModels.get(key);
    if (state === undefined) {
      this.lazyModels.set(key, false);
      void this.assets.template(key).then(() => this.lazyModels.set(key, true));
    }
    return state === true;
  }

  private make(e: Readonly<Entity>): EntityView | null {
    if (LAZY_MODELS.has(e.view.model) && !this.lazyReady(e.view.model as ModelKey)) return null;
    const bossView = makeBurrowmotherView(e, this.assets, this.fx) ?? makeBossView(e, this.assets, this.fx);
    if (bossView) return bossView;
    const pr = e.projectile;
    if (e.kind === 'projectile' || pr) {
      // Spell projectiles by their spell (the sim names the models 'bolt' and 'blastOrb'); enemy
      // shots by their kind: homing or arcane ones are hexes, the rest coins.
      if (pr?.spell === 'blast' || e.view.model === 'blastOrb') return new BlastOrbView(this.fx, pr?.radius);
      if (pr?.spell || e.view.model === 'bolt') return new BoltView();
      if (pr?.homing || e.view.model === 'hex' || pr?.kind === 'arcane') return new HexView(this.fx);
      return new CoinView();
    }
    // World objects, by component (villagers by their `npc_*` model key; objects by theirs).
    if (e.npc) return new NpcView(e, this.assets);
    const kind: string | undefined = e.interactable?.kind;
    if (e.interactable && kind === 'shrine') {
      const v = new ShrineView(e.interactable.id, this.discovered, this.assets);
      this.shrines.set(e.interactable.id, v);
      return v;
    }
    if (kind === 'chest') return new ChestView(this.assets);
    if (kind === 'object') return objectView(e.view.model);
    if (e.pickup) return new PickupView(e, this.assets);
    const def = scaledDef(enemyDef(e), e.view.scale ?? 1);
    switch (e.view.model) {
      case 'brute':
      case 'gatekeeper':
        return def ? new BruteView(this.assets, def, e.view.model) : new FallbackView(e);
      case 'dummy':
        return def ? new DummyView(def) : new FallbackView(e);
      case 'grunt':
      case 'slinger':
      case 'wisp':
      case 'grunt_vet':
      case 'slinger_vet':
      case 'big_coin':
      case 'robot_shooter':
      case 'robot_laser':
        return def ? new HumanoidEnemyView(this.assets, def, e.view.model) : new FallbackView(e);
      default:
        return e.kind === 'enemy' || e.kind === 'boss' ? new FallbackView(e) : null;
    }
  }

  /** Drop everything (quit to title). */
  clear(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.statusClock.clear();
    this.viewScale.clear();
    this.shrines.clear();
    this.discovered.clear();
    for (const d of this.decals) d.decal.dispose();
    this.decals.length = 0;
    this.spells.clear();
    this.powers.clear();
  }
}
