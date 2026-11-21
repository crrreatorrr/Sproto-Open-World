import { MountView } from './MountView';
import * as THREE from 'three';
import type { AssetLoader } from '../../assets/AssetLoader';
import type { ModelKey } from '../../assets/manifest';
import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import { affixedMove } from '../../content/enemyScale';
import type { Entity, EntityId } from '../../sim/entity';
import type { SimEvent } from '../../sim/events';
import type { Vec3 } from '../../sim/math';
import type { ReadonlySimView } from '../../sim/view';
import { HIT_FEEL, hitTier } from '../fx/feedback';
import type { HitFx } from '../fx/HitFx';
import { PowerFx } from '../fx/powers';
import { SpellFx } from '../fx/SpellFx';
import { StatusFx } from '../fx/StatusFx';
import { BodyGlow } from './BodyGlow';
import { makeBossView } from './BossViews';
import { makeBurrowmotherView } from './BurrowmotherView';
import { DrakeFlyover, makeDrakeView } from './DrakeViews';
import { EdgeWardenView } from './EdgeWardenView';
import { BlastOrbView, BoltView,
  BulletView, BruteView, CoinView, DummyView, FallbackView, HexView, HumanoidEnemyView, isHumanoidModel, type EntityView } from './EnemyViews';
import { portalShown } from '../portalShown';
import { ChestView, NpcView, PickupView, PortalView, ShrineView, objectView } from './RpgViews';
import { TelegraphDecal, type DecalShape } from './TelegraphDecal';
import { TOTEM_FADE_TICKS } from '../../content/relics';
import { decalLead, lanternShimmer, oracleEquipped } from '../relicCues';
import { QuestClues } from '../fx/questClues';
import { CHEST_SHIMMER_M, LENS_PREVIEW_FLAG } from '../../content/packs/encounterTune';
import { QUESTS } from '../../content/quests';
import { castsShadow, wantsView } from './viewCull';

const DECAL_COLOR: Record<DecalShape, number> = { circle: 0xffa23a, jagged: 0xff2a1a };

/** Enemy models outside the critical download: fetched the first time one comes into range. */
const LAZY_MODELS: ReadonlySet<string> = new Set<ModelKey>(['gatekeeper', 'grunt_vet', 'slinger_vet', 'big_coin', 'robot_shooter', 'robot_laser', 'scrapjaw', 'burrowmother', 'drake',
  // The first stage of each Duel boss (and the two enemies on them): the later stages are fetched by the view.
  'sahil_stage1', 'tinubu_stage1', 'broccoli_stage1', 'agent_stage1']);

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
  if (!def || scale === 1) return def;
  return { ...def, body: { radius: def.body.radius * scale, height: def.body.height * scale }, ...(def.hover ? { hover: def.hover * scale } : {}) };
}

/** The enemy definition behind an entity, if it has a brain. */
export function enemyDef(e: Readonly<Entity> | undefined): EnemyDef | undefined {
  const id = e?.brain?.def;
  return id ? ENEMIES[id] : undefined;
}

/** The bull is drawn within this flat distance of the player (m). */
const MOUNT_DRAW_RANGE = 150;

/**
 * Every drawn non-player entity: a view per enemy and projectile, made when the entity appears and
 * dropped when it leaves the sim, plus the telegraph decals under their attacks, status particles,
 * and the spell visuals that aren't sparks (SpellFx). Players have their own PlayerView.
 */
export class WorldViews {
  readonly root = new THREE.Group();
  private readonly clues = new QuestClues();
  readonly spells = new SpellFx();
  /** The C3 powers' visuals. */
  readonly powers: PowerFx;
  /** The Skyfire Drake's far passes over the valley before its fight (C6). */
  readonly flyover: DrakeFlyover;
  /** What statuses look like on a body (M6). */
  readonly status = new StatusFx(this.spells);
  /** The local player's drawn body (PlayerView's root), so statuses show on it too. */
  playerBody: THREE.Object3D | null = null;
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
  private rebuildViews = false;
  /** Lazy enemy models: requested (false) and ready to draw (true). */
  private readonly lazyModels = new Map<string, boolean>();
  /** The size each view was made at: a camp's new affix (after a rest) can change it. */
  private readonly viewScale = new Map<EntityId, number>();
  /** Which enemy views cast a shadow now (near the player only). */
  private readonly shadowCast = new Map<EntityId, boolean>();
  private frame = 0;
  /** World flags and the player, for portal mouths (set at the start of each sync). */
  private drawFlags: Readonly<Record<string, number>> = {};
  private drawPlayer: { x: number; z: number } | undefined;

  constructor(
    private readonly assets: AssetLoader,
    private readonly fx: HitFx | null = null,
  ) {
    this.powers = new PowerFx(assets, fx);
    this.flyover = new DrakeFlyover(assets);
    this.root.add(this.spells.root, this.powers.root, this.flyover.root, this.status.root);
    if (fx) BodyGlow.ash = (p) => fx.emit(p, 'ash', 1, 1, 1.2);
    // A model that failed has arrived: rebuild the views, so stand-ins become the real thing.
    this.assets.onRecovered(() => {
      this.rebuildViews = true;
    });
  }

  get(id: EntityId): EntityView | undefined {
    return this.views.get(id);
  }

  /** Far enemies skip the shadow pass. Re-applied now and then: a lazy model arrives after its view. */
  private enemyShadow(e: Readonly<Entity>, v: EntityView, me: Readonly<Entity> | undefined): void {
    const was = this.shadowCast.get(e.id) ?? true;
    const on = castsShadow(e, me, was);
    if (on === was && this.shadowCast.has(e.id) && this.frame % 20 !== e.id % 20) return;
    this.shadowCast.set(e.id, on);
    v.root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      // Parts that never cast (rings, glows) stay that way.
      o.userData.castsShadow ??= o.castShadow;
      o.castShadow = on && (o.userData.castsShadow as boolean);
    });
  }

  /** How far this mount's saddle has moved from its idle height (m), for the rider. */
  saddleLift(id: EntityId): number {
    const v = this.views.get(id);
    return v instanceof MountView ? v.saddleLift : 0;
  }

  /** How this mount's body is tilted this frame, for the rider. */
  saddleTilt(id: EntityId): { pitch: number; roll: number } {
    const v = this.views.get(id);
    return v instanceof MountView ? v.tilt : { pitch: 0, roll: 0 };
  }

  /** Make, update and drop views to match the sim. Call once per rendered frame. */
  sync(view: ReadonlySimView, alpha: number, dt: number): void {
    this.frame++;
    if (this.rebuildViews) {
      this.rebuildViews = false;
      for (const v of this.views.values()) v.dispose();
      this.views.clear();
      this.shrines.clear();
    }
    this.seen.clear();
    this.status.begin(dt);
    const me = view.playerEntity(0);
    this.drawFlags = view.world.flags;
    this.drawPlayer = me ? { x: me.tf.pos.x, z: me.tf.pos.z } : undefined;
    for (const e of view.entities) {
      if (e.kind === 'player') {
        // Single player for now: the one player's progress lights the shrines.
        const found = e.progress?.discoveredShrines;
        if (found && found.length !== this.discovered.size) for (const id of found) this.discovered.add(id);
        if (this.playerBody) this.status.track(e, this.playerBody, e.body?.height ?? 1.8, e.body?.radius ?? 0.4, dt);
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
      // A mouth's look follows the flags. Sealed (and motes out of range) returns null and is not cached.
      if (e.interactable?.kind === 'portal' && v instanceof PortalView) {
        const look = portalShown(e.interactable.id, e.interactable.used, this.drawFlags, e.tf.pos, this.drawPlayer);
        if (!look) continue;
        v.show(look);
        this.seen.add(e.id);
        v.update(e, alpha, dt);
        continue;
      }
      if (!v) {
        const made = this.make(e);
        if (!made) continue;
        v = made;
        this.views.set(e.id, v);
        this.viewScale.set(e.id, e.view.scale ?? 1);
        this.root.add(v.root);
      }
      this.seen.add(e.id);
      if (e.interactable?.id === 'quarry_gate_lock') v.keyed?.((me?.progress?.inventory.quarry_key ?? 0) > 0);
      if (e.interactable?.id.startsWith('relic_')) {
        const q = me?.progress?.quests.q_relics;
        const search = !!q && q.status === 'active' && QUESTS.q_relics.steps[q.step]?.clue === 'shimmer';
        const d = me ? Math.hypot(e.tf.pos.x - me.tf.pos.x, e.tf.pos.z - me.tf.pos.z) : 999;
        v.shimmer?.(search ? Math.max(0, 1 - d / CHEST_SHIMMER_M) : null);
      }
      // Skinned meshes aren't frustum culled: a bull left far behind shouldn't cost a draw.
      if (e.mount && me) v.root.visible = Math.hypot(e.tf.pos.x - me.tf.pos.x, e.tf.pos.z - me.tf.pos.z) <= MOUNT_DRAW_RANGE;
      v.update(e, alpha, dt);
      if (e.interactable?.kind === 'chest' && v instanceof ChestView && view.entities.some((p) => p.kind === 'player' && lanternShimmer(p, view.now, e.tf.pos))) v.lanternTwinkle();
      if (e.brain) this.enemyShadow(e, v, me);
      if (e.statuses) this.statusParticles(e, v, dt);
      if (e.combat) this.status.track(e, v.root, v.height, e.body?.radius ?? 0.4, dt);
    }
    this.status.end((id) => this.views.get(id)?.root);
    for (const [id, v] of this.views) {
      if (this.seen.has(id)) continue;
      v.dispose();
      this.views.delete(id);
      this.statusClock.delete(id);
      this.shadowCast.delete(id);
      this.status.drop(id);
      this.viewScale.delete(id);
      for (const [k, sv] of this.shrines) if (sv === v) this.shrines.delete(k);
    }
    this.updateDecals(view, dt);
    this.syncTotems(view);
    if (!this.clues.root.parent) this.root.add(this.clues.root);
    this.clues.sync(view, me);
    this.spells.update(dt);
    this.powers.sync(view, alpha, dt);
    this.flyover.update(view, me, dt);
  }

  /** React to a sim event (telegraphs, flinches and spell visuals; sounds and numbers live in the app). */
  event(view: ReadonlySimView, e: SimEvent): void {
    switch (e.type) {
      case 'telegraph': {
        const ent = view.get(e.entity);
        const authored = enemyDef(ent)?.moves.find((m) => m.id === e.move);
        // A Colossal's blow reaches further than its definition says: the decal sits on the real hitbox.
        const move = authored && affixedMove(authored, ent?.view.scale ?? 1);
        this.views.get(e.entity)?.telegraph?.(move, e.unblockable, e.ticks);
        const shape: DecalShape | null = e.decal ?? move?.decal ?? (e.unblockable ? 'jagged' : null);
        // A dive paints its own lane on the ground (DrakeView).
        const preview = !e.unblockable && (view.world.flags[LENS_PREVIEW_FLAG] ?? 0) > view.now;
        const shown = shape ?? (preview ? 'circle' : null);
        if (shown && move && !move.dive) {
          const decal = new TelegraphDecal(shown, preview ? 0xf0c548 : DECAL_COLOR[shown]);
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
        const tier = hitTier(e);
        this.views.get(e.target)?.flinch?.(from, tier !== 'light', HIT_FEEL[tier].flinch);
        return;
      }
      case 'stagger':
        this.views.get(e.entity)?.reel?.();
        return;
      case 'cue':
        if (e.cue === 'roar' && e.pos) {
          this.fx?.ring(e.pos, 0xc4b49a, 0.35, 7, 0.55);
          this.fx?.emit({ x: e.pos.x, y: e.pos.y + 0.4, z: e.pos.z }, 'ash', 28, 0.6, 1.2);
        } else if (e.cue === 'crack' && e.entity !== undefined) {
          const at = view.get(e.entity)?.tf.pos;
          if (at) this.fx?.emit({ x: at.x, y: at.y + 2, z: at.z }, 'ash', 10, 0.4, 0.4);
        } else if (e.cue === 'sizzle' && e.pos) {
          this.fx?.emit(e.pos, 'fire', 8, 0.5, 0.6);
        }
        return;
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
  /** Primitive stand-ins until models/totems/<id>.glb exists. Drawn only while a totem is planted. */
  private readonly totemGroups = new Map<number, THREE.Group>();

  private syncTotems(view: ReadonlySimView): void {
    if (!this.totemGroups.size && !view.entities.some((e) => e.placedTotem)) return;
    const live = new Set<number>();
    for (const e of view.entities) {
      const t = e.placedTotem;
      if (!t) continue;
      live.add(e.id);
      let g = this.totemGroups.get(e.id);
      if (!g || g.name !== t.id) {
        g?.removeFromParent();
        g = new THREE.Group();
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 5), new THREE.MeshStandardMaterial({ color: 0x8a7358, transparent: true }));
        mesh.position.y = 0.5;
        g.add(mesh);
        g.name = t.id;
        this.totemGroups.set(e.id, g);
        this.root.add(g);
      }
      g.position.set(t.x, t.y, t.z);
      const left = t.life - t.age;
      const fade = left < TOTEM_FADE_TICKS ? Math.max(0, left / TOTEM_FADE_TICKS) : 1;
      const mat = (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.opacity = fade;
    }
    if (!live.size && !this.totemGroups.size) return;
    for (const [id, g] of this.totemGroups) {
      if (live.has(id)) continue;
      g.removeFromParent();
      this.totemGroups.delete(id);
    }
  }

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
      const lead = decalLead(view.entities, e.tf.pos);
      const gold = oracleEquipped(view.entities) && d.move.decal !== 'jagged' && !d.move.unblockable;
      const progress = Math.min(1, (a.t + lead) / Math.max(1, d.move.windup));
      if (d.at) {
        d.decal.update(d.at.x, d.at.y, d.at.z, 0, d.radius, progress, dt, gold);
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
          d.decal.update(spot.x, spot.y, spot.z, yaw, d.radius, progress, dt, gold);
        } else d.decal.update(d.landing.x, d.landing.y, d.landing.z, d.landing.yaw, d.radius, progress, dt, gold);
        continue;
      }
      const f = d.move.hitbox.forward;
      d.decal.update(p.x + Math.sin(yaw) * f, p.y, p.z + Math.cos(yaw) * f, yaw, d.radius, progress, dt, gold);
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
    if (e.warden) return new EdgeWardenView(this.assets, this.fx);
    const bossView = makeBurrowmotherView(e, this.assets, this.fx) ?? makeDrakeView(e, this.assets, this.fx) ?? makeBossView(e, this.assets, this.fx);
    if (bossView) return bossView;
    const pr = e.projectile;
    if (e.kind === 'projectile' || pr) {
      // Spell projectiles by their spell (the sim names the models 'bolt' and 'blastOrb'); enemy
      // shots by their kind: homing or arcane ones are hexes, the rest coins.
      // A gun's shots (and a Soldier's shooting spells) are bullets, slugs and rockets.
      if (e.view.model === 'bullet' || e.view.model === 'slug' || e.view.model === 'rocket') return new BulletView(e.view.model);
      if (pr?.spell === 'blast' || e.view.model === 'blastOrb') return new BlastOrbView(this.fx, pr?.radius);
      if (pr?.spell || e.view.model === 'bolt') return new BoltView();
      if (pr?.homing || e.view.model === 'hex' || pr?.kind === 'arcane') return new HexView(this.fx);
      return new CoinView();
    }
    if (e.mount) return new MountView(this.assets);
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
    if (kind === 'portal') {
      const ia = e.interactable!;
      const look = portalShown(ia.id, ia.used, this.drawFlags, e.tf.pos, this.drawPlayer);
      if (!look) return null;
      const pv = new PortalView();
      pv.show(look);
      return pv;
    }
    if (e.pickup) return new PickupView(e, this.assets);
    const def = scaledDef(enemyDef(e), e.view.scale ?? 1);
    switch (e.view.model) {
      case 'brute':
      case 'gatekeeper':
        return def ? new BruteView(this.assets, def, e.view.model) : new FallbackView(e);
      case 'dummy':
        return def ? new DummyView(def) : new FallbackView(e);
      default:
        if (isHumanoidModel(e.view.model)) return def ? new HumanoidEnemyView(this.assets, def, e.view.model) : new FallbackView(e);
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
    this.flyover.clear();
    this.status.clear();
  }
}
