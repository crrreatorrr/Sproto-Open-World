import * as THREE from 'three';
import type { AssetLoader, ModelInstance } from '../../assets/AssetLoader';
import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../content/enemies';
import { DRAKE_WAKE_FLAG } from '../../content/packs/c6';
import { TICK_HZ } from '../../content/tuning';
import type { DrakeFlight, Entity } from '../../sim/entity';
import type { ReadonlySimView } from '../../sim/view';
import { Animator, ENTRY_FADE } from '../anim/Animator';
import type { HitFx } from '../fx/HitFx';
import { glowTexture } from '../fx/textures';
import { BodyGlow } from './BodyGlow';
import { fogMaterial } from './BossViews';
import { attackClipTime, fitToBody, glowStatusOf, growToStage, type EntityView } from './EnemyViews';
import { placeEntity, spring } from './interp';

/** Where the spit leaves in the `fireball` clip (seconds; the shooter's 20 of 30 frames). */
const FIREBALL_RELEASE = 20 / 30;
/** Dead: it lies where it fell for this long, then sinks and fades (ticks; the corpse goes at 150). */
const SINK_DELAY = 90;
const SINK_TICKS = 55;
const SINK_DEPTH = 4;
/** The lane's height above the ground (m), and the arena's fog wall (m). */
const LANE_LIFT = 0.14;
const WALL_HEIGHT = 16;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Seams on the Drake. Each reflected fireball takes 0.34 of its poise, so two show before the
 * break. The break refills the bar on that hit, and the third seam stays up while it glides.
 */
export function drakeCrackCount(poise: number, poiseMax: number, broken: boolean): number {
  if (broken) return 3;
  if (!(poiseMax > 0)) return 0;
  return Math.min(3, Math.round((1 - poise / poiseMax) / 0.34));
}

/**
 * The Skyfire Drake (expansion plan §3.5). The model only has `fly` and `fireball`, so the body does
 * the rest: it banks into its turns, tips its nose along its flight, and paints each dive's lane on
 * the ground through the wind-up. The arena's fog wall stands while the fight is on.
 */
export class DrakeView implements EntityView {
  readonly root = new THREE.Group();
  readonly height: number;
  private readonly body = new THREE.Group();
  private readonly glow = new BodyGlow();
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  private readonly recoil = { x: 0, v: 0 };
  private pitch = 0;
  private bank = 0;
  private time = 0;
  private embers = 0;
  private disposed = false;
  private readonly at = new THREE.Vector3();
  private readonly laneGeo = new THREE.BufferGeometry();
  private readonly laneMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly lane: THREE.Mesh;
  /** The lane the ribbon was built for. */
  private laneFor: DrakeFlight['lane'] = null;
  private readonly wall: THREE.Mesh;
  private readonly wallMat = fogMaterial(0xffb070);
  private wallOn = 0;
  /** One dark seam per reflected fireball. Three and the stance breaks. */
  private readonly cracks: THREE.Mesh[];

  constructor(assets: AssetLoader, readonly def: EnemyDef, private readonly fx: HitFx | null) {
    this.height = def.body.height;
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x1a100c, side: THREE.DoubleSide });
    this.cracks = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15 * this.height, 0.55 * this.height), crackMat);
      m.position.set((i - 1) * 0.35 * (def.size ?? 1), this.height * 0.55, 0.4 * (def.size ?? 1));
      m.rotation.z = (i - 1) * 0.4;
      m.visible = false;
      return m;
    });
    this.root.add(this.body, this.glow.glint, ...this.cracks);
    this.glow.glint.position.set(0, this.height * 0.7, 3 * (def.size ?? 1));
    this.lane = new THREE.Mesh(this.laneGeo, this.laneMat);
    this.lane.frustumCulled = false;
    this.lane.visible = false;
    const r = def.boss?.arenaRadius ?? 30;
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, WALL_HEIGHT, 72, 1, true), this.wallMat);
    this.wall.visible = false;
    void assets.instance('drake').then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      fitToBody(m, 'drake', def);
      this.model = m;
      this.glow.adopt(m.root);
      this.body.add(m.root);
      this.animator = new Animator(m.root, m.clips);
    });
  }

  telegraph(_move: EnemyMoveDef | undefined, unblockable: boolean, ticks: number): void {
    this.glow.telegraph(unblockable, ticks / TICK_HZ);
  }

  flinch(_from: { x: number; z: number }, heavy: boolean): void {
    this.glow.hit();
    this.recoil.v -= heavy ? 1.2 : 0.6;
  }

  /** Thrown off a blow (a parry) or its poise broke: the whole body rocks back. */
  reel(): void {
    this.recoil.v -= 1.6;
  }

  /** Spitting: the wind-up opens the jaw to the release frame, and each shot of a volley replays the spit. */
  private playSpit(mv: EnemyMoveDef, t: number): void {
    const anim = this.animator;
    if (!anim?.has('fireball')) return;
    const d = anim.duration('fireball');
    const every = mv.projectile?.interval ?? 0;
    const shots = mv.projectile?.count ?? 1;
    if (every > 0 && t >= mv.windup && t < mv.windup + every * (shots - 1)) {
      const u = ((t - mv.windup) % every) / every;
      anim.scrub('fireball', FIREBALL_RELEASE + u * Math.min(d - FIREBALL_RELEASE, every / TICK_HZ), ENTRY_FADE);
      return;
    }
    anim.scrub('fireball', attackClipTime(mv, t, d, FIREBALL_RELEASE / d), ENTRY_FADE);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.time += dt;
    const poise = e.combat;
    // A break refills the bar on the same hit, so the third seam has to stay up through the glide.
    const broken = poise?.action?.kind === 'stagger' && poise.action.reason === 'broken';
    const cracks = drakeCrackCount(poise?.poise ?? 0, poise?.poiseMax ?? 0, broken);
    this.cracks.forEach((c, i) => (c.visible = i < cracks));
    const a = e.combat?.action ?? null;
    const anim = this.animator;
    const flight = e.boss?.flight;
    const hspeed = Math.hypot(e.tf.vel.x, e.tf.vel.z);
    let nose = clamp(Math.atan2(-e.tf.vel.y, Math.max(1, hspeed)), -0.6, 0.85) * 0.8;
    let bank = clamp(-wrap(e.tf.yaw - e.tf.prevYaw) * TICK_HZ * 0.45, -0.55, 0.55);
    let sink = 0;
    let lane = 0;
    if (a?.kind === 'attack') {
      const mv = this.def.moves.find((m) => m.id === a.move);
      if (mv && (mv.projectile || mv.noHit)) this.playSpit(mv, a.t);
      else anim?.loop('fly', 1.5);
      if (mv?.dive && a.t < mv.windup) lane = a.t / mv.windup;
      if (mv && a.t >= mv.windup) this.glow.endTelegraph();
    } else {
      this.glow.endTelegraph();
      if (a?.kind === 'dead') {
        anim?.scrub('fly', 0.4, 0.3);
        nose = 0.5;
        bank = 0.5;
        sink = clamp((a.t - SINK_DELAY) / SINK_TICKS, 0, 1);
      } else if (flight?.mode === 'glide') {
        // Broken: wings barely moving, trailing sparks, low enough to reach.
        anim?.loop('fly', 0.5);
        nose = 0.08;
        bank *= 0.4;
        this.embers += dt;
        if (this.fx && this.embers > 0.09) {
          this.embers = 0;
          this.fx.emit(this.root.getWorldPosition(this.at).setY(this.at.y + this.height * 0.48), 'fire', 3, 0.5, 2);
        }
      } else if (a?.kind === 'stagger' && a.reason === 'parried') {
        // Thrown off its dive: nose up, wings stalling for a moment.
        anim?.loop('fly', 0.6);
        nose = -0.4;
      } else if (a?.kind !== 'frozen') anim?.loop('fly', 1 + Math.min(0.5, hspeed / 40));
    }
    this.pitch += (nose - this.pitch) * (1 - Math.exp(-6 * dt));
    this.bank += (bank - this.bank) * (1 - Math.exp(-5 * dt));
    spring(this.recoil, 160, 14, dt);
    this.body.rotation.x = this.pitch + this.recoil.x;
    this.body.rotation.z = this.bank;
    growToStage(this.body, e, this.def, dt, !this.model);
    this.body.position.y = -sink * SINK_DEPTH * (this.def.size ?? 1);
    this.glow.setOpacity(1 - sink);
    this.root.visible = sink < 1;
    this.glow.setStatus(glowStatusOf(e));
    this.glow.update(dt);
    if (a?.kind !== 'frozen') anim?.update(dt);
    this.paintLane(flight?.lane ?? null, lane);
    this.fogWall(e, dt);
  }

  /** The dive's line on the ground, brightening through the wind-up. */
  private paintLane(l: DrakeFlight['lane'], fill: number): void {
    const on = !!l && fill > 0;
    this.lane.visible = on;
    if (!on || !l) return;
    if (!this.lane.parent) this.root.parent?.add(this.lane);
    if (this.laneFor !== l) {
      this.laneFor = l;
      this.buildLane(l);
    }
    this.laneMat.opacity = 0.12 + 0.42 * fill * (0.8 + 0.2 * Math.sin(this.time * 26));
  }

  private buildLane(l: NonNullable<DrakeFlight['lane']>): void {
    const n = l.ys.length;
    const half = this.def.moves.find((m) => m.dive)?.hitbox.radius ?? 2.6;
    const yaw = Math.atan2(l.bx - l.ax, l.bz - l.az);
    const sx = Math.cos(yaw) * half, sz = -Math.sin(yaw) * half;
    const pos = new Float32Array(n * 6);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = l.ax + (l.bx - l.ax) * u, z = l.az + (l.bz - l.az) * u, y = l.ys[i] + LANE_LIFT;
      pos.set([x + sx, y, z + sz, x - sx, y, z - sz], i * 6);
      if (i < n - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.laneGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.laneGeo.setIndex(index);
  }

  /** The arena's fog wall: on the world, not on the boss, and up while the fight is on. */
  private fogWall(e: Readonly<Entity>, dt: number): void {
    const on = e.boss?.state === 'intro' || e.boss?.state === 'fight';
    this.wallOn += ((on ? 1 : 0) - this.wallOn) * (1 - Math.exp(-3 * dt));
    this.wall.visible = this.wallOn > 0.01;
    if (!this.wall.visible) return;
    if (!this.wall.parent) this.root.parent?.add(this.wall);
    const home = e.brain?.home;
    if (home) this.wall.position.set(home.x, home.y + WALL_HEIGHT / 2 - 1, home.z);
    this.wallMat.opacity = this.wallOn * (0.3 + 0.08 * Math.sin(this.time * 2.2));
  }

  dispose(): void {
    this.disposed = true;
    this.animator?.dispose();
    this.glow.dispose();
    this.model?.dispose();
    this.lane.removeFromParent();
    this.laneGeo.dispose();
    this.laneMat.dispose();
    this.wall.removeFromParent();
    this.wall.geometry.dispose();
    this.wallMat.dispose();
    const crackMat = this.cracks[0]?.material;
    for (const c of this.cracks) c.geometry.dispose();
    if (crackMat && !Array.isArray(crackMat)) crackMat.dispose();
    this.root.removeFromParent();
  }
}

/** A fireball: a white-hot core in a roaring glow, shedding embers. It burns cyan once it is sent back. */
export class FireballView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 0.8;
  private readonly geo = new THREE.SphereGeometry(1, 14, 10);
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
  private readonly haloMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff6a1a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly core = new THREE.Mesh(this.geo, this.coreMat);
  private readonly halo = new THREE.Sprite(this.haloMat);
  private readonly at = new THREE.Vector3();
  private time = Math.random() * 10;
  private trail = 0;
  private back = false;

  constructor(private readonly fx: HitFx | null) {
    this.halo.renderOrder = 5;
    this.root.add(this.core, this.halo);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.time += dt;
    const r = e.projectile?.radius ?? 0.7;
    if (e.projectile?.reflected && !this.back) {
      this.back = true;
      this.haloMat.color.setHex(0x4fe0ff);
      this.coreMat.color.setHex(0xe8fbff);
    }
    this.core.scale.setScalar(r * 0.6);
    const pulse = r * 4.6 * (1 + 0.14 * Math.sin(this.time * 31));
    this.halo.scale.set(pulse, pulse, 1);
    this.trail += dt;
    if (this.fx && this.trail > 0.035) {
      this.trail = 0;
      this.fx.emit(this.root.getWorldPosition(this.at), this.back ? 'arcane' : 'fire', 3, 0.25, 1.2);
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.coreMat.dispose();
    this.haloMat.dispose();
    this.root.removeFromParent();
  }
}

/** The view of a C6 fight entity (by its view model), or null for anything else. */
export function makeDrakeView(e: Readonly<Entity>, assets: AssetLoader, fx: HitFx | null): EntityView | null {
  if (e.view.model === 'fireball') return new FireballView(fx);
  if (e.view.model !== 'drake') return null;
  const def = e.brain ? ENEMIES[e.brain.def] : undefined;
  return def ? new DrakeView(assets, def, fx) : null;
}

// ---------------------------------------------------------------- the flyover

/** Seconds before the first pass, and between passes. */
const FIRST_PASS = 5;
const PASS_GAP: readonly [number, number] = [45, 80];
/** Each pass: half its length (m), speed (m/s), height above the player (m) and how far to the side (m). */
const PASS_HALF = 260;
const PASS_SPEED = 30;
const PASS_HEIGHT: readonly [number, number] = [38, 52];
const PASS_SIDE: readonly [number, number] = [42, 70];
/** It reads as a big shape at that distance: at least its true size, and no smaller than this. */
const PASS_SCALE = 1.7;

const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);

/**
 * The Drake before its fight (expansion plan §3.5): from the day the haystacks burn until the bait
 * brings it down, its far LOD crosses the sky above the player now and then. Presentation only: the
 * sim knows nothing about it. The far LOD is fetched when the quest starts, and the boss model when
 * the bait quest starts, so neither is in the critical download and the fight doesn't wait for one.
 */
export class DrakeFlyover {
  readonly root = new THREE.Group();
  private model: ModelInstance | null = null;
  private animator: Animator | null = null;
  private loading = false;
  private bossRequested = false;
  private wait = FIRST_PASS;
  /** Seconds left of the current pass (0: none under way). */
  private left = 0;
  private duration = 1;
  private cried = true;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();

  constructor(private readonly assets: AssetLoader) {
    this.root.visible = false;
  }

  /** The Drake called out as it went over (once per pass). */
  takeCry(): boolean {
    if (this.cried) return false;
    if (this.left > this.duration * 0.55) return false;
    this.cried = true;
    return this.root.visible;
  }

  update(view: ReadonlySimView, me: Readonly<Entity> | undefined, dt: number): void {
    const quests = me?.progress?.quests;
    if (quests?.q_bait?.status === 'active' && !this.bossRequested) {
      this.bossRequested = true;
      void this.assets.template('drake');
    }
    const smoke = quests?.q_smoke_hills?.status;
    const want = (smoke === 'active' || smoke === 'complete') && !view.world.flags[DRAKE_WAKE_FLAG];
    if (!want || !me) {
      this.clear();
      return;
    }
    if (!this.model) {
      this.load();
      return;
    }
    if (this.left <= 0) {
      this.root.visible = false;
      this.wait -= dt;
      if (this.wait <= 0) this.startPass(me);
      return;
    }
    this.left = Math.max(0, this.left - dt);
    this.root.position.lerpVectors(this.from, this.to, 1 - this.left / this.duration);
    this.animator?.loop('fly', 1.1);
    this.animator?.update(dt);
    if (this.left <= 0) this.wait = between(PASS_GAP);
  }

  private load(): void {
    if (this.loading) return;
    this.loading = true;
    void this.assets.instance('drake_far').then((m) => {
      this.loading = false;
      // The bait may have been set, or the session left, while it was on its way.
      if (this.model) {
        m.dispose();
        return;
      }
      this.model = m;
      m.root.scale.multiplyScalar(Math.max(PASS_SCALE, ENEMIES.skyfire_drake.size ?? 1));
      this.root.add(m.root);
      this.animator = new Animator(m.root, m.clips);
    });
  }

  private startPass(me: Readonly<Entity>): void {
    const yaw = Math.random() * Math.PI * 2;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const side = between(PASS_SIDE) * (Math.random() < 0.5 ? -1 : 1);
    const p = me.tf.pos;
    const x = p.x + dz * side, z = p.z - dx * side;
    const y = p.y + between(PASS_HEIGHT);
    this.from.set(x - dx * PASS_HALF, y, z - dz * PASS_HALF);
    this.to.set(x + dx * PASS_HALF, y, z + dz * PASS_HALF);
    this.root.rotation.y = yaw;
    this.root.position.copy(this.from);
    this.root.visible = true;
    this.duration = this.left = (PASS_HALF * 2) / PASS_SPEED;
    this.cried = false;
  }

  /** The Drake has come down, or the session ended: nothing left to draw. */
  clear(): void {
    this.animator?.dispose();
    this.animator = null;
    this.model?.dispose();
    this.model = null;
    this.left = 0;
    this.wait = FIRST_PASS;
    this.cried = true;
    this.root.visible = false;
  }
}

// ---------------------------------------------------------------- the quests' objects

const HAY_COLOR = new THREE.Color(0xc9a24a);
const CHARRED = new THREE.Color(0x2a2520);

/** One flickering tongue of flame. */
function flame(color: number): THREE.Sprite {
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
}

/** A burning haystack (A10): a mound of hay in flames, a blackened heap once doused. */
class HaystackView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1.7;
  private readonly geo = new THREE.SphereGeometry(1.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 1, flatShading: true });
  private readonly flames = [flame(0xff7a1e), flame(0xffa63a), flame(0xff5a14)];
  private time = Math.random() * 10;
  private lit = 1;

  constructor() {
    const heap = new THREE.Mesh(this.geo, this.mat);
    heap.scale.y = 1.15;
    heap.castShadow = true;
    this.root.add(heap, ...this.flames);
  }

  update(e: Readonly<Entity>, alpha: number, dt: number): void {
    placeEntity(this.root, e, alpha);
    this.time += dt;
    this.lit += ((e.interactable?.used ? 0 : 1) - this.lit) * (1 - Math.exp(-3 * dt));
    this.mat.color.copy(HAY_COLOR).lerp(CHARRED, 1 - this.lit);
    this.flames.forEach((f, i) => {
      const t = this.time * (7 + i * 2) + i * 2;
      const s = (1.5 + 0.35 * Math.sin(t)) * this.lit;
      f.visible = this.lit > 0.03;
      f.position.set(Math.sin(i * 2.1) * 0.5, 1.15 + 0.3 * i + 0.14 * Math.sin(t * 1.3), Math.cos(i * 2.1) * 0.5);
      f.scale.set(s, s * 1.5, 1);
      f.material.opacity = 0.8 * this.lit;
    });
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    for (const f of this.flames) f.material.dispose();
    this.root.removeFromParent();
  }
}

/** Shared box for the decoys and the post. */
const box = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
};

/** A Sheep Decoy (A11): wool on a wooden frame, gone once taken. */
class SheepDecoyView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 1.1;
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly wool = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 1 });
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.9 });

  constructor() {
    this.root.add(box(this.geo, this.wool, 0, 0.72, 0, 0.62, 0.5, 1), box(this.geo, this.wood, 0, 0.92, 0.62, 0.3, 0.32, 0.36));
    for (const [x, z] of [[-0.2, 0.34], [0.2, 0.34], [-0.2, -0.34], [0.2, -0.34]]) this.root.add(box(this.geo, this.wood, x, 0.26, z, 0.1, 0.52, 0.1));
  }

  update(e: Readonly<Entity>, alpha: number): void {
    placeEntity(this.root, e, alpha);
    this.root.visible = !e.interactable?.used;
  }

  dispose(): void {
    this.geo.dispose();
    this.wool.dispose();
    this.wood.dispose();
    this.root.removeFromParent();
  }
}

/** The bait post (A11): a tall stake in the open field, with the decoys hung on it once they are set. */
class BaitPostView implements EntityView {
  readonly root = new THREE.Group();
  readonly height = 3;
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.9 });
  private readonly wool = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 1 });
  private readonly bait = new THREE.Group();

  constructor() {
    this.root.add(box(this.geo, this.wood, 0, 1.5, 0, 0.24, 3, 0.24), box(this.geo, this.wood, 0, 2.7, 0, 1.8, 0.16, 0.16));
    for (const [x, y] of [[-0.75, 2.2], [0.75, 2.2], [0, 1.5]]) this.bait.add(box(this.geo, this.wool, x, y, 0.1, 0.46, 0.42, 0.7));
    this.bait.visible = false;
    this.root.add(this.bait);
  }

  update(e: Readonly<Entity>, alpha: number): void {
    placeEntity(this.root, e, alpha);
    this.bait.visible = !!e.interactable?.used;
  }

  dispose(): void {
    this.geo.dispose();
    this.wood.dispose();
    this.wool.dispose();
    this.root.removeFromParent();
  }
}

/** The view of one of A10's and A11's objects, or null for any other model. */
export function drakeObjectView(model: string): EntityView | null {
  if (model === 'haystack') return new HaystackView();
  if (model === 'sheep_decoy') return new SheepDecoyView();
  if (model === 'bait_post') return new BaitPostView();
  return null;
}
